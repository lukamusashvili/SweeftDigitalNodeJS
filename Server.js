require('isomorphic-fetch');
const dotenv = require('dotenv');
const Koa = require('koa');
const next = require('next');
const fs = require('fs');
const { default: createShopifyAuth } = require('@shopify/koa-shopify-auth');
const { verifyRequest } = require('@shopify/koa-shopify-auth');
const { default: Shopify, ApiVersion } = require('@shopify/shopify-api');
const Router = require('koa-router');
const path=require ("path");
const multer = require('@koa/multer');
const koaBody = require('koa-body');
const XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;
const cors = require('@koa/cors');
const request = require('request-promise');
const https = require('https');
dotenv.config();

//#region Shopify initialize
Shopify.Context.initialize({
  API_KEY: process.env.SHOPIFY_API_KEY,
  API_SECRET_KEY: process.env.SHOPIFY_API_SECRET,
  SCOPES: process.env.SHOPIFY_API_SCOPES.split(","),
  HOST_NAME: process.env.SHOPIFY_APP_URL.replace(/https:\/\//, ""),
  API_VERSION: ApiVersion.April21,
  IS_EMBEDDED_APP: true,
  SESSION_STORAGE: new Shopify.Session.MemorySessionStorage(),
});
//#endregion
//#region Server Config
const port = parseInt(process.env.PORT, 10) || 3000;
const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();
var theAccessToken = process.env.SHOPIFY_API_ACCESSTOKEN //shop0
var theAccessTokenOMV = process.env.SHOPIFY_API_ACCESSTOKEN_OMV; //shop1
var theAccessTokenAOM = process.env.SHOPIFY_API_ACCESSTOKEN_AOM; //shop2...

const ACTIVE_SHOPIFY_SHOPS = {};

app.prepare().then(() => {
  const server = new Koa();
  server.use(cors());
  const router = new Router();
  server.keys = [Shopify.Context.API_SECRET_KEY];
//#endregion
//#region Webhooks
  server.use(
    createShopifyAuth({
      accessMode: 'offline',
      async afterAuth(ctx) {
        const shop = ctx.query.shop; console.log(shop)
        const { scope, accessToken } = ctx.state.shopify; console.log(ctx.state.shopify); console.log(accessToken); console.log(scope); 
        ACTIVE_SHOPIFY_SHOPS[shop] = scope;
        /* Register webhook for orders paid */
        const registrationOrderPaid = await Shopify.Webhooks.Registry.register({
          shop,
          accessToken,
          path: '/getorders',
          topic: 'ORDERS_PAID',
          apiVersion: ApiVersion.April21,
          webhookHandler: (_topic, _shop, body) => {
          console.log('received order paid webhook: ');
          const obj = JSON.parse(body); console.log(obj)
          //filter(obj);
          function filter(obj){
            var countryCode = obj.shipping_address.country_code;
            var ProductNum = obj.line_items.length;
            var VENDORTrue = 0;
            var holdTag = 0;
            //var issueTag = 0;
            var VENDOR = "";
            var SKU = "";
            if(typeof(obj.tags) === "string"){
              var orderTags = obj.tags;
              orderTags = orderTags.replace(/\s/g, '');
              var listOfTags = orderTags.split(",")
              console.log(listOfTags)
              for(i=0;i<listOfTags.length;i++){
                if(listOfTags[i] == "broken" || listOfTags[i] == "wrong" || listOfTags[i] == "DHLissue" || listOfTags[i] == "Missingparts"){
                    issueTag = 1;
                  }
              }
            }
            for (i=0;i<ProductNum;i++){
              SKU = obj.line_items[i].sku;
              VENDOR = obj.line_items[i].vendor;
              if(SKU.toString().length > 3){
                if(SKU.toString().slice(SKU.toString().length - 4) == "HOLD"){
                  holdTag += 1
                }
              }
              if(VENDOR == "OMV1"){
                VENDORTrue += 1;
              }
            }
            if((countryCode == "AT" || countryCode == "DE" || countryCode == "CH") && ProductNum == VENDORTrue){ // || issueTag == 1
              //#region If hold
              if(holdTag > 0){
                const obj1 = {
                  case: 'hold',
                  order: obj.name,
                  orderId: obj.id
                };
                fs.writeFile(path.join(__dirname ,'/holdOrders/hold-' + obj.name + `-` + obj.id + '.json'), JSON.stringify(obj1), err => {
                  if (err) {
                    console.log(err);
                  } else {
                    console.log("successfully added hold order");
                  }
                })
              }
              //#endregion
              else{
                console.log("Sending To Poland")
                STG(obj);
                console.log("Adding The Tag")
                addTag(obj.id);
              }
            } else{
            console.log('dont send it' + countryCode + ' ' + ProductNum + ' '  +  VENDORTrue)
            }
          }
        },
      });

      if (registrationOrderPaid.success) {
      console.log('Successfully registered Order Paid webhook!');
      } else {
      console.log('Failed to register Order Paid webhook', registrationOrderPaid.result);
      }
      ctx.redirect("/");
      },
    }),
  );

function STG(x){
  //#region send it
  var xhttp = new XMLHttpRequest();
  xhttp.onreadystatechange = function() {
    if (this.readyState == 4 && this.status == 200) {
      console.log("responseFromPoland - "  + this.response)
      console.log("responseTextFromPoland - "  + this.responseText)
      console.log("successFromPoland - " + this.status.toString(), this.readyState.toString());
    }
    else if (this.readyState == 4 && this.status !== 200){
      console.log("responseFromPoland - "  + this.response)
      console.log("failureFromPoland - " + this.status.toString(), this.readyState.toString());
    }
  };
  xhttp.open("POST", "*****", true);
  xhttp.setRequestHeader('Access-Control-Allow-Origin', '*');
  xhttp.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');
  xhttp.setRequestHeader('user', '*****');
  xhttp.setRequestHeader('pass', '*****');
  x["company_id"]=1; //Poland ID
  console.log(x);
  xhttp.send(JSON.stringify(x));
  //#endregion 
}

function addTag(id){
  console.log("The Tag Has Been Added")
  var xhttp = new XMLHttpRequest();
  xhttp.onreadystatechange = function() {
    if (this.readyState == 4 && this.status == 200) {
      var theOrder = JSON.parse(this.responseText)
      var tags = theOrder.order.tags;
      var data = JSON.stringify({
        "order": {
          "id": id,
          "tags": tags+", sentToPoland"
        }
      });
      var xhr = new XMLHttpRequest();
      xhr.withCredentials = true;
      xhr.addEventListener("readystatechange", function() {
        if(this.readyState === 4) {
          console.log(this.responseText);
        }
      });
      xhr.open("PUT", "*****" + id + ".json");
      xhr.setRequestHeader("X-Shopify-Access-Token", theAccessToken);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.send(data);
    }
    else if (this.readyState == 4 && this.status !== 200){
      console.log(this.responseText);
    }
  }
  let url = '"*****"' + id + '.json';
  xhttp.open("GET", url, true);
  xhttp.setRequestHeader('X-Shopify-Access-Token', theAccessToken);
  xhttp.setRequestHeader('Content-type', 'application/json');
  xhttp.send();
}

router.post('/getorders', async (ctx) => {
  try{
  await Shopify.Webhooks.Registry.process(ctx.req, ctx.res);
  console.log(`Webhook processed with status code 200`);
  }
  catch (error){
  console.log(`Failed to process webhook: ${error}`);
  }
});
//#endregion
//#region handle
const handleRequest = async (ctx) => {
  await handle(ctx.req, ctx.res);
  ctx.respond = false;
  ctx.res.statusCode = 200;
};
//#endregion
//#region index
router.get("/", async (ctx) => {
  const shop = 'testing-the-app-1.myshopify.com'; //testing security features
  if (ACTIVE_SHOPIFY_SHOPS[shop] === undefined) {
    console.log("ActiveShopsUndefined");
    ctx.redirect(`/auth?shop=${shop}`);
  } else {
    console.log("handleRequest");
    await handleRequest(ctx);
  }
});
//#endregion
//#region Multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname ,'/public'))
  },
  filename: function (req, file, cb) {
    var e = req.body.email
    var fn = req.body.fn
    var ln = req.body.ln
    var c = req.body.case
    gorgias(e, fn, ln, c)
    cb(null, c + `-` + req.body.order + `-` + Date.now() + `-` + req.body.product  + `-` + file.originalname)
  }
})
//#region Gorgias
function gorgias(e, fn, ln, c){
  var data = "";

  var xhr = new XMLHttpRequest();
  xhr.withCredentials = true;

  xhr.addEventListener("readystatechange", function() {
    if(this.readyState === 4) {
      var JSONT = JSON.parse(this.responseText)
      console.log(JSONT.data.length)
      if(JSONT.data.length == 0){
        createCustomer()
      }
      else{
        createTicket(JSONT.data[0].id)
      }
    }
  });

  xhr.open("GET", "https://*****.gorgias.com/api/customers/?email=" + e);
  xhr.setRequestHeader("Authorization", "Basic *****==");

  xhr.send(data);
  function createCustomer(){
    var data = JSON.stringify({
      "channels": [
        {
          "address": e,
          "preferred": true,
          "type": "email"
        }
      ],
      "email": e,
      "name": fn + " " + ln,
      "timezone": "UTC"
    });
    
    var xhr = new XMLHttpRequest();
    xhr.withCredentials = true;
    
    xhr.addEventListener("readystatechange", function() {
      if(this.readyState === 4) {
        var respJSON = JSON.parse(this.responseText)
        createTicket(respJSON.id)
      }
    });
    
    xhr.open("POST", "https://*****.gorgias.com/api/customers");
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("Authorization", "Basic *****==");
    
    xhr.send(data);
  }

  function createTicket(id){
    console.log(id);
    if(c == "wrong"){
      var subj= "wrong"
      var cs = "<div>Hallo "+fn+",<br><br>danke für die Fotos und entschuldige bitte vielmals. Offensichtlich ist hier eine Verwechslung passiert. 😣 Wir schicken dir natürlich kostenlos einen Ersatz zu! Die Lieferzeit beträgt 5-7 Werktage. <br><br>Sobald ein Trackinglink verfügbar ist, erhälst du diesen dann wieder per Email.<br><br>Außerdem möchte ich dir einen Gutschein über 10% als kleine Entschädigung schenken:<br><br>OopsSorry<br><br>Die falsch bedruckten Tassen darfst du gerne behalten oder spenden 🙂"
      createMessage(cs, subj)
    }
    else if(c == "broken"){
      var subj= "broken"
      var cs = "<div>Hallo "+fn+",<br><br>danke für die Fotos und entschuldige bitte vielmals, das soll natürlich nicht passieren!<br><br>Ich habe deine Tasse nun wieder an unsere Grafiker weitergeleitet und sie kümmern sich schnellstmöglich um Ersatz für dich.<br><br>Sobald deine Bestellung versandbereit ist, erhältst du einen Trackinglink per Email.<br><br>Ich möchte dir außerdem einen 10% Gutschein auf deine nächste Bestellung als kleine Entschädigung schenken.<br><br>Dein Gutscheincode lautet:<br><br>SoSorry<br><br>Ich wünsche dir bald viel Freude an deiner Tasse und melde dich gerne bei Fragen wieder bei mir!<br><br>Vielen Dank!<br><br>Ich freue mich auf deine Antwort!"
      createMessage(cs, subj)
    }
    else{
      var subj = "lost"
      var cs = "<div>Hallo "+fn+",<br><br>vielen Dank für deine Nachricht. Es tut mir sehr leid, dass du eine unvollständige Bestellung erhalten hast. Natürlich erhältst du umgehend Ersatz. Sobald die Bestellung versendet wurde erhälst du wieder wie gewohnt eine Email mit Trackinglink<br><br>Als Entschädigung möchte ich dir außerdem gerne einen 15% Gutschein auf deine nächste Bestellung schenken.<br><br>Dein Gutscheincode lautet:<br><br>OhMy<br><br>Einfach bei der nächsten Bestellung angeben!<br><br>"
      createMessage(cs, subj)
    }
    function createMessage(cs, subj){
      var HTMLB = cs + "<div><br></div><div>Kreative Grüße 👩🏻‍🎨</div><div><br></div><div>Luka</div><div><br></div><div>vom ***** Support Team ☎️</div><div><br></div><div>Kundensupport</div><div><br></div><figure style=\"display:inline-block;margin:0\"><img src=\"https://uploads.gorgias.io/*****-11d4036a66b3.png\" width=\"400px\" style=\"max-width: 100%\"></figure><div><br></div><div>corso commerce UG (haftungsbeschränkt)</div><div><a href=\"http://*****/\" target=\"_blank\">*****</a></div><div><a href=\"mailto:support@*****.com\" target=\"_blank\">support@*****.com</a></div><div><br></div><div>Albrechtstr. 102</div><div>12103 Berlin</div><div>📞+49 (0) 17659888284</div><div><br></div><div>Registergericht: Amtsgericht Charlottenburg </div><div>Registernummer: HR B 207644 </div><div><br></div><div>Geschäftsführer: Laura Francesca Pastore</div>"
      var data = JSON.stringify({
        "messages": [
          {
            "channel": "email",
            "from_agent": true,
            "via": "api",
            "body_html": HTMLB,
            "failed_datetime": null,
            "receiver": {
              "id": id
            },
            "sender": {
              "id": 501325358
            },
            "source": {
              "type": "email",
              "from": {
                "id": 501325358,
                "name": "***** Support",
                "address": "support@*****.com"
              },
              "to": [
                {
                  "id": id,
                  "name": fn + " " + ln,
                  "address": e
                }
              ]
            },
            "stripped_html": null,
            "stripped_text": null,
            "subject": subj
          }
        ],
        "assignee_team": null,
        "assignee_user": null,
        "channel": "email",
        "customer": {
          "id": id,
          "email": e,
          "name": fn,
          "lastname": ln,
          "note": "Created by Poland"
        },
        "from_agent": true,
        "tags": [
          {
            "id": 489524,
            "name": "Poland_Auto",
            "uri": "/api/tags/489524/",
            "decoration": {
              "color": "#A5673F"
            }
          }
        ],
        "via": "email"
      });
      
      var xhr = new XMLHttpRequest();
      xhr.withCredentials = true;
      
      xhr.addEventListener("readystatechange", function() {
        if(this.readyState === 4) {
          console.log(this.responseText);
        }
      });
      
      xhr.open("POST", "https://*****.*****.com/api/tickets");
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.setRequestHeader("Authorization", "Basic &*****==");
      
      xhr.send(data);
    }
  }
}
//#endregion
const limits = {
  fields: 10,//Number of non-file fields
  FileSize: 500 * 1024,// fileSize in b
  files: 1//Number of documents
}
const upload = multer({storage,limits})
//#endregion
//#region post /user/file (user -> server)
router.post('/user/file', koaBody(), upload.single('file'), async (ctx, next)=>{
  if(typeof(ctx.file) === 'undefined'){
    const obj = {
      case: 'lost',
      order: ctx.request.body.order,
      email: ctx.request.body.email
    };
    fs.writeFile(path.join(__dirname ,'/lostOrders/lost-' + ctx.request.body.order + `-` + Date.now() + '.json'), JSON.stringify(obj), err => {
      if (err) {
        console.log(err);
      } else {
        console.log("successfully added lost order");
      }
    })
    var c = "lost";
    var fn = ctx.request.body.fn
    var ln = ctx.request.body.ln
    var e = ctx.request.body.email
    gorgias(e, fn, ln, c)
  }
  ctx.body = "success";
  ctx.error
  await next();
})
//#endregion
//#region refreshlist
var orders = [];
const Folder = './public/';
var lostOrders = [];
const Folder1 = './lostOrders/';
var holdOrders = [];
const Folder2 = './holdOrders/';
var corruptOrders = [];
const Folder3 = './corruptOrders/';
// refresh when user admin clicks on "Request", "Accept", "Reject"
router.post('/refreshList', async (ctx,next) => {
  fs.readdir(Folder, (err, files) => {
    orders = files;
  });
  fs.readdir(Folder1, (err, files) => {
    lostOrders = files;
  });
  fs.readdir(Folder2, (err, files) => {
    holdOrders = files;
  });
  fs.readdir(Folder3, (err, files) => {
    corruptOrders = files;
  });
  ctx.body = "the list refreshed successfully";
  ctx.error
  await next();
})
//#endregion
//#region get orders
router.post('/user/files', async (ctx,next) => {
  ctx.body = orders;
  ctx.error
  await next();
})
//#endregion
//#region get lostOrders
router.post('/user/lost', async (ctx,next) => {
  ctx.body = lostOrders;
  ctx.error
  await next();
})
//#endregion
//#region get holdOrders
router.post('/user/hold', async (ctx,next) => {
  ctx.body = holdOrders;
  ctx.error
  await next();
})
//#endregion
//#region get corruptOrders
router.post('/user/corrupt', async (ctx,next) => {
  ctx.body = corruptOrders;
  ctx.error
  await next();
})
//#endregion
//#region ordersreceiver
router.post('/get/files', koaBody(), async (ctx,next) => {
  var requestedBody = ctx.request.body;
  fs.readFile('./public/'+requestedBody, function(err, data) {
      router.post('/get/image', async (ctx,next) => {
        ctx.body = data;
        ctx.error
        await next();
      })
  })
  ctx.body = 1
  ctx.error
  await next();
})
//#endregion
//#region wrongremover
router.post('/delete/wrong', koaBody(), async (ctx,next) => {
  console.log('/delete/files hit')
  var requestedBody = ctx.request.body;
  fs.unlink('./public/'+requestedBody, (err) => {
    if (err) {
      console.error(err)
      return
    }
  })
  ctx.body = "The file has been removed successfully"
  ctx.error
  await next();
})
//#endregion
//#region brokenremover
router.post('/delete/broken', koaBody(), async (ctx,next) => {
  console.log('/delete/files hit')
  var requestedBody = ctx.request.body;
  fs.unlink('./public/'+requestedBody, (err) => {
    if (err) {
      console.error(err)
      return
    }
  })
  ctx.body = "The file has been removed successfully"
  ctx.error
  await next();
})
//#endregion
//#region lostremover
router.post('/delete/lost', koaBody(), async (ctx,next) => {
  console.log('/delete/lost hit')
  var requestedBody = ctx.request.body;
  fs.unlink(path.join(__dirname ,'/lostOrders/')+requestedBody, (err) => {
    if (err) {
      console.error(err)
      return
    }
  })
  ctx.body = "The file has been removed successfully"
  ctx.error
  await next();
})
//#endregion
//#region holdremover
router.post('/delete/hold', koaBody(), async (ctx,next) => {
  console.log('/delete/hold hit')
  var requestedBody = ctx.request.body;
  fs.unlink('./holdOrders/'+requestedBody, (err) => {
    if (err) {
      console.error(err)
      return
    }
  })
  ctx.body = "The file has been removed successfully"
  ctx.error
  await next();
})
//#endregion
//#region corruptremover
  router.post('/delete/corrupt', koaBody(), async (ctx,next) => {
    console.log('/delete/corrupt hit')
    var requestedBody = ctx.request.body;
    fs.unlink('./corruptOrders/'+requestedBody, (err) => {
      if (err) {
        console.error(err)
        return
      }
    })
    ctx.body = "The file has been removed successfully"
    ctx.error
    await next();
  })
  //#endregion
//#region accept
  var theCase = "";
  var requestedBody = "";
  router.post('/accept/files', koaBody(), async (ctx, next) => {
    requestedBody = ctx.request.body
    var orderName = requestedBody.toString().split("-")[1]
    theCase = requestedBody.toString().split("-")[0]
    var caseTag = ""
    if(theCase == "lost"){
      caseTag = "DHLissue"
    }
    else{
      caseTag = theCase
    }
    if(orderName.charAt(0)=="#"){
      var orderN = orderName.slice(1, orderName.length)
    }
    else{
      var orderN = orderName
    }
    var xhttp1 = new XMLHttpRequest();
    xhttp1.onreadystatechange = function() {
      if (this.readyState == 4 && this.status == 200) {
        var data = JSON.parse(this.responseText)
        delete data.orders[1]
        delete data.orders[0].id
        delete data.orders[0].app_id
        delete data.orders[0].name
        delete data.orders[0].number
        delete data.orders[0].order_number
        delete data.orders[0].order_status_url
        delete data.orders[0].token
        delete data.orders[0].tax_lines
        delete data.orders[0].created_at
        delete data.orders[0].processed_at
        delete data.orders[0].updated_at
        delete data.orders[0].source_name
        delete data.orders[0].admin_graphql_api_id
        delete data.orders[0].financial_status
        delete data.orders[0].tags
        data.orders[0].financial_status = "paid"
        data.orders[0].send_receipt = false
        data.orders[0].tags = caseTag
        var stringData = JSON.stringify(data)
        var orderget = stringData.slice(0, 7) + stringData.slice(8, stringData.length)
        var orderget1 = orderget.slice(0, 9) + orderget.slice(10, orderget.length)
        if(stringData[stringData.length - 4] == "u"){
          var orderget2 = orderget1.slice(0, orderget1.length - 7) + orderget1.slice(orderget1.length - 1, orderget1.length)
        }
        else{
          var orderget2 = orderget1.slice(0, orderget1.length - 2) + orderget1.slice(orderget1.length - 1, orderget1.length)
        }
        duplicate(orderget2)
      }
      else if (this.readyState == 4 && this.status !== 200){
        console.log("failed to get the order");
      }
    };
    let url1 = '*****' + orderN + '&status=any';
    xhttp1.open("GET", url1, true);
    xhttp1.setRequestHeader('X-Shopify-Access-Token', theAccessToken);
    xhttp1.setRequestHeader('Content-type', 'application/json');
    xhttp1.send();
    ctx.body = false
    ctx.error
    await next();
  });
  function duplicate(x){
    console.log("consolingOutX");
    console.log(x)
    var xhr = new XMLHttpRequest();
    xhr.withCredentials = true;
    xhr.onreadystatechange = function() {
      if (this.readyState == 4) {
        sendToGeorge(this.responseText)
      }
    };
    xhr.open("POST", "*****");
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("X-Shopify-Access-Token", theAccessToken);
    xhr.send(x);
  }
  function sendToGeorge(y){
    console.log("consolingOutY");
    console.log(y)
    var x = JSON.parse(y)
    var xhttp = new XMLHttpRequest();
    xhttp.onreadystatechange = function() {
      if (this.readyState == 4 && this.status == 200) {
        console.log("successfully send to George");
      }
      else if (this.readyState == 4 && this.status !== 200){
        console.log("error while sending to George");
      }
    };
    xhttp.open("POST", "*****", true);
    xhttp.setRequestHeader('Access-Control-Allow-Origin', '*');
    xhttp.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');
    xhttp.setRequestHeader('user', '*****');
    xhttp.setRequestHeader('pass', '*****');
    var z = JSON.stringify(x)
    var zzz = z.slice(9, z.length - 1)
    var zz = JSON.parse(zzz)
    zz["company_id"]=1;
    if(theCase == "wrong" || theCase == "broken" || theCase == "lost"){
      zz["case"]= theCase;
    }
    xhttp.send(JSON.stringify(zz));
  }
  //#endregion
//#region changeTrack
router.post('/changeTrack', koaBody(), async (ctx, next) => {
  requestedBody = JSON.parse(ctx.request.body)
  var orderID = requestedBody.orderID
  var trackID = requestedBody.trackID
  console.log(orderID)
  console.log(trackID)
  var data =
  {
    fulfillment: {
      location_id: 61489610905,
      tracking_company: "DHL PAKET",
      tracking_number: trackID,
      tracking_url: "https:\/\/dhlshipping.app\/api\/tracking\/PAKET\/"+trackID,
    }
  }
  var xhr = new XMLHttpRequest();
  xhr.withCredentials = true;
  xhr.onreadystatechange = function() {
    if (this.readyState == 4){
      console.log(this.responseText)
    }
  };
  xhr.open("POST", "*****" + orderID + "/fulfillments.json");
  xhr.setRequestHeader("Content-Type", "application/json");
  xhr.setRequestHeader("X-Shopify-Access-Token", theAccessToken);
  xhr.send(JSON.stringify(data));
  ctx.body = "Successfully changed the track number"
  ctx.error
  await next();
})
//#endregion
//#region corruptedOrders
  router.post('/corruptedOrders', koaBody(), async (ctx, next) => {
    var requestedBody = JSON.parse(ctx.request.body)
    var orderName = requestedBody.orderName
    var reason = requestedBody.reason
    fs.writeFile(path.join(__dirname ,'/corruptOrders/corrupt-' + orderName + "-" + reason + "-" +'.json'), JSON.stringify(requestedBody), err => {
      if (err) {
        console.log(err);
      } else {
        console.log("successfully added corrupt order");
      }
    })
    ctx.body = "Successfully added to corrupted orders"
    ctx.error
    await next();
  })
  //#endregion

//#region oneTime
router.post('/manualSendToGeorge', koaBody(), async (ctx,next) => {
var requestedBody = ctx.request.body
var ordersArray = requestedBody

var myVar = setInterval(myTimer, 5000);
var n = 0

function myTimer() {
    myFunction(ordersArray[n])
    n += 1
    if(n == ordersArray.length){
      myStopFunction()
    }
}

function myStopFunction() {
  clearInterval(myVar);
}

function myFunction(value) {
console.log(n)
console.log(value)
var xhttp1 = new XMLHttpRequest();
xhttp1.onreadystatechange = function() {
  if (this.readyState == 4 && this.status == 200) {
    var data = JSON.parse(this.responseText)
    var xhttp = new XMLHttpRequest();
    xhttp.onreadystatechange = function() {
      if (this.readyState == 4 && this.status == 200) {
        console.log(this.responseText);
      }
      else if (this.readyState == 4 && this.status !== 200){
        console.log(this.responseText);
      }
    };
    xhttp.open("POST", "*****", true);
    xhttp.setRequestHeader('Access-Control-Allow-Origin', '*');
    xhttp.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');
    xhttp.setRequestHeader('user', '*****');
    xhttp.setRequestHeader('pass', '******');
    var z = JSON.stringify(data)
    var zzz = z.slice(9, z.length - 1)
    var zz = JSON.parse(zzz)
    zz["company_id"]=1;
    //console.log(zz.line_items[0].properties)
    console.log(zz)
    xhttp.send(JSON.stringify(zz));
  }
  else if (this.readyState == 4 && this.status !== 200){
    console.log(this.responseText);
  }
}
let url1 = '*****/' + value +'.json';
xhttp1.open("GET", url1, true);
xhttp1.setRequestHeader('X-Shopify-Access-Token', theAccessToken);
xhttp1.setRequestHeader('Content-type', 'application/json');
xhttp1.send();
};
ctx.body = false
ctx.error
await next();
})
//#endregion
//#region updateAnOrder
router.post('/updateAnOrder', koaBody(), async (ctx,next) => {
  console.log("updateAnOrder triggered")
  var id = "4037970362561"
  var data = JSON.stringify({
    "order": {
      "id": id,
      "tags": "sentToPoland"
    }
  });
  var xhr = new XMLHttpRequest();
  xhr.withCredentials = true;
  xhr.addEventListener("readystatechange", function() {
    if(this.readyState === 4) {
      console.log(this.responseText);
    }
  });
  xhr.open("PUT", "******" + id + ".json");
  xhr.setRequestHeader("X-Shopify-Access-Token", "*****");
  xhr.setRequestHeader("Content-Type", "application/json");
  xhr.send(data);
ctx.body = "meow"
await next();
})
//#endregion


  router.get("(/_next/static/.*)", handleRequest);
  router.get("/_next/webpack-hmr", handleRequest);
  router.get("(.*)", verifyRequest(), handleRequest);

  server.use(router.allowedMethods());
  server.use(router.routes());
  //#region trash
  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });

  // const sslServer = https.createServer(
  //   {
  //     key: fs.readFileSync(path.join(__dirname, 'cert/privkey.pem')),
  //     cert: fs.readFileSync(path.join(__dirname, 'cert/cert.pem')),
  //   },
  //   server
  // )
  // sslServer.listen(port, () => console.log(`> Ready on http://localhost:${port}`))
  //#endregion

  // const options = {
  //   key: fs.readFileSync(path.join(__dirname, 'cert/privkey.pem')),
  //   ca: fs.readFileSync(path.join(__dirname, 'cert/chain.pem')),
  //   cert: fs.readFileSync(path.join(__dirname, 'cert/cert.pem'))
  // }
  // https.createServer(options, server.callback()).listen(port, () => console.log(`> Ready on https://localhost:${port}`));
});
const botmgr    = require('node-red-viseo-bot-manager')
const helper    = require('node-red-viseo-helper');
const CARRIER   = "Alexa"

// --------------------------------------------------------------------------
//  NODE-RED
// --------------------------------------------------------------------------

let BOTNAME = "Alexa";

module.exports = function(RED) {
    const register = function(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        BOTNAME = config.title;

        start(RED, node, config);
        this.on('close', (done)  => { stop(node, config, done)     });
    }
    RED.nodes.registerType("amazon-alexa", register, {});
}

// ------------------------------------------
//  MAIN FUNCTIONS
// ------------------------------------------

let LISTENERS_REPLY = {};
let LISTENERS_PROMPT = {};

const start = (RED, node, config) => {

    var cookieParser = require("cookie-parser")
    var bodyParser = require("body-parser");

    var httpMiddleware = function(req, res, next) { next();}
    var corsHandler = function(req,res,next) { next(); }
    var metricsHandler = function(req,res,next) { next(); }
    var multipartParser = function(req,res,next) { next(); }
    var callback = function(req,res,next) { 
        receive(node, config, req, res);
    }
    var errorHandler = function(err,req,res,next) {
        node.warn(err);
        res.sendStatus(500);
    };
    function rawBodyParser(req, res, next) {
        if (req.skipRawBodyParser) { next(); } // don't parse this if told to skip
        if (req._body) { return next(); }
        req.body = "";
        req._body = true;

        var isText = true;
        var checkUTF = false;

        if (req.headers['content-type']) {
            var parsedType = typer.parse(req.headers['content-type'])
            if (parsedType.type === "text") {
                isText = true;
            } else if (parsedType.subtype === "xml" || parsedType.suffix === "xml") {
                isText = true;
            } else if (parsedType.type !== "application") {
                isText = false;
            } else if (parsedType.subtype !== "octet-stream") {
                checkUTF = true;
            } else {
                // applicatino/octet-stream
                isText = false;
            }
        }

        getBody(req, {
            length: req.headers['content-length'],
            encoding: isText ? "utf8" : null
        }, function (err, buf) {
            if (err) { return next(err); }
            if (!isText && checkUTF && isUtf8(buf)) {
                buf = buf.toString()
            }
            req.body = buf;
            next();
        });
    }
    var maxApiRequestSize = RED.settings.apiMaxLength || '5mb';
    var jsonParser = bodyParser.json({limit:maxApiRequestSize});
    var urlencParser = bodyParser.urlencoded({limit:maxApiRequestSize,extended:true});
    
    // Add listener to reply
    let listenerReply = LISTENERS_REPLY[node.id] = (srcNode, data, srcConfig) => { reply(node, data, config) }
    helper.listenEvent('reply', listenerReply)

    let listenerPrompt = LISTENERS_PROMPT[node.id] = (srcNode, data, srcConfig) => { prompt(node, data, config) }
    helper.listenEvent('prompt', listenerPrompt)

    // Prompt
    RED.httpNode.post('/amazon-alexa', cookieParser(), httpMiddleware, corsHandler, metricsHandler, jsonParser, urlencParser, multipartParser, rawBodyParser, callback, errorHandler);
}

const stop = (node, config, done) => {
    let listenerReply = LISTENERS_REPLY[node.id]
    helper.removeListener('reply', listenerReply)

    let listenerPrompt = LISTENERS_PROMPT[node.id]
    helper.removeListener('prompt', listenerPrompt)
    done();
}

// ------------------------------------------
//  LRU REQUESTS
// ------------------------------------------

const LRUMap = require('./lru.js').LRUMap;
const uuidv4 = require('uuid/v4');

let _CONTEXTS    = new LRUMap(CONFIG.server.contextLRU || 10000);
let _CONTEXT_KEY = 'contextId';

const getMessageContext = (message) => {
    if (message === undefined) return;

    let uuid    = helper.getByString(message, _CONTEXT_KEY);
    let context = _CONTEXTS.get(uuid);
    if (!context) {
        context = {};
        let convId = helper.getByString(message, 'address.conversation.id');
              uuid = convId + '-' + uuidv4();
              helper.setByString(message, _CONTEXT_KEY, uuid);
        _CONTEXTS.set(uuid, context);
    }
    return context;
}

// ------------------------------------------
//  MIDDLEWARE
// ------------------------------------------

const receive = (node, config, req, res) => { 

    // Log activity
    try { setTimeout(function() { helper.trackActivities(node)},0); }
    catch(err) { console.log(err); }

    let json = req.body;
    if (!json || !json.request) {
        node.warn(req)
        node.warn('Empty request received');
        return;
    }

    node.warn({'received': json.request})

    let data = botmgr.buildMessageFlow({ message : json }, {
        userLocale: 'message.request.locale',
        userId:     'message.session.user.userId', 
        convId:     'message.session.sessionId',
        payload:    'message.request.intent',
        inputType:  'message.request.type',
        source:     CARRIER
    })

    
    data.user.accessToken = data.message.session.user.accessToken;
    
    let context = getMessageContext(data.message);
    context.req = req;
    context.res = res;

    if (json.request.intent && json.request.intent.name === "RawText") {
        data.message.text = json.request.intent.slots.Text.value;
        data.payload = json.request.intent.slots.Text.value;
    }
    if (json.request.type === "LaunchRequest") { 
        data.message.text = "START CONVERSATION";
        data.payload =      "START CONVERSATION";
    }
    if (json.request.type === "SessionEndedRequest") {
        data.message.text = "END CONVERSATION";
        data.payload =      "END CONVERSATION";
    }

    // Handle Prompt
    let convId  = botmgr.getConvId(data);
    if (botmgr.hasDelayedCallback(convId, data.message)) return;

    // Trigger received message
    helper.emitEvent('received', node, data, config);
    node.send([data, data]);

}


// ------------------------------------------
// PROMPT
// ------------------------------------------

const prompt = (node, data, config) => {

    const next = function() {
        if (helper.countListeners('prompt') === 1) {
            helper.fireAsyncCallback(data);
        }
    }

    let address = botmgr.getUserAddress(data)
    if (!address || address.carrier !== CARRIER) return next();

    if (data.prompt.request.intent && data.prompt.request.intent.name === "RawText") {
        data.prompt.message.text = json.request.intent.slots.Text.value;
    }
    if (data.prompt.request.type === "LaunchRequest")       data.prompt.message.text = "START CONVERSATION";
    if (data.prompt.request.type === "SessionEndedRequest")data.prompt.message.text = "END CONVERSATION";

    next();
}
    

// ------------------------------------------
//  REPLY
// ------------------------------------------

const reply = (node, data, config) => {

    // Assume we send the message to the current user address
    let address = botmgr.getUserAddress(data)
    if (!address || address.carrier !== CARRIER) return false;

    try {
        // The address is not used because we reply to HTTP Response
        let context = data.prompt ? getMessageContext(data.prompt)
                                  : getMessageContext(data.message) ;

        let res = context.res ;

        // Assume we send the message to the current user address
        let address = botmgr.getUserAddress(data)
        if (!address || address.carrier !== CARRIER) return false;

        // Building the message
        let message = getMessage(data.reply, context);
        if (!message) return false;
        
        // Write the message to the response
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(message));

        // Trap the event in order to continue
        helper.fireAsyncCallback(data);

    } catch(ex){ console.log(ex) }
}

const getMessage = exports.getMessage = (replies, context) => { 
    if (!replies) return;
    let reply = replies[0];

    let msg = {
        "version": "1.0",
        "sessionAttributes": {},
        "response": {
            "outputSpeech": {},
            "card": {},
            "shouldEndSession": !reply.prompt
        }
    }

    if (reply.speech) {
        if (!reply.speech.startsWith('<speak>')) reply.speech = '<speak>' + reply.speech;
        if (!reply.speech.endsWith('</speak>')) reply.speech = reply.speech + '</speak>';
    }

    if (reply.type === "text") {
    
        msg.response.outputSpeech = {
            "type":     "SSML",
            "ssml":     (reply.speech) ? reply.speech : '<speak>' + reply.text + '</speak>'
        };
        msg.response.card = {
            "type":     "Simple",
            "title":    BOTNAME + " said",
            "content":  reply.text
        };
    }

    if (reply.type === "card") {
        let cardText = reply.subtext || reply.subtitle;

        let cardImage = {
            "smallImageUrl": reply.attach,
            "largeImageUrl": reply.attach
        }

        msg.response.outputSpeech = {
            "type":     "SSML",
            "ssml":     (reply.speech === false) ? reply.speech : '<speak>' + cardText + '</speak>'
        };

        msg.response.card = {
            "type":     (reply.attach) ? "Standard" : "Simple",
            "title":    reply.title,
            "content":  (reply.attach) ? undefined : cardText,
            "text":     (reply.attach) ? cardText  : undefined,
            "image":    (reply.attach) ? cardImage : undefined
        };
    }

    if (reply.type === "media") {
        msg.response.outputSpeech = {
            "type":     "SSML",
            "ssml":     '<speak>I sent you an image</speak>'
        };

        msg.response.card = {
            "type":     "Standard",
            "title":    BOTNAME + " sent",
            "content":  "",
            "image":    {
                "smallImageUrl": reply.media,
                "largeImageUrl": reply.media
            }
        };
    }

    if (reply.type === "signin") {
        msg.response.outputSpeech = {
            "type":     "SSML",
            "ssml":     (reply.speech === false) ? reply.speech : '<speak>' + reply.text + '</speak>' 
        };

        msg.response.card = {
            "type":     "LinkAccount"
        };
    }

    if (!msg.response.card.type) {
        msg.response.outputSpeech = {
            "type":     "SSML",
            "ssml":     '<speak>Oops, something wrong happened...</speak>'
        };
        msg.response.card = {
            "type":     "Simple",
            "title":    BOTNAME + " said",
            "content":  "Oops, something wrong happened..."
        };
    }
    
    return msg;
}

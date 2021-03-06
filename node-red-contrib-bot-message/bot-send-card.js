const mustache = require('mustache');
const i18n     = require('./lib/i18n.js');
const botmgr   = require('node-red-viseo-bot-manager');
const helper   = require('node-red-viseo-helper');

require('./lib/i18n.js').init();

const marshall = (locale, str, data, def) => {
    if (!str) return def;

    str = i18n.translate(locale, str);
    str = mustache.render(str, data);
    str = helper.resolve(str, data, def);

    return str;
}

// --------------------------------------------------------------------------
//  NODE-RED
// --------------------------------------------------------------------------

module.exports = function(RED) {
    const register = function(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        this.repeat = (data)  => { input(RED, node, data, config, data.reply) };
        this.on('input', (data)  => { input(RED, node, data, config, null)  });
    }
    RED.nodes.registerType("send-card", register, {});

    updateFields = function(opts) {
        if (opts.name) this.name = opts.name;
        return;
    }
}

const buttonsStack = {
    push: function(data, buttons) {
        if(data._buttonsStack === undefined) {
            data._buttonsStack = [];
        }
        data._buttonsStack = data._buttonsStack.concat(buttons);
    },
    popAll: function(data) {
        let buttons = data._buttonsStack;       
        data._buttonsStack = []; 
        return buttons;
    }
};

const getButtons = (RED, locale, config, data) => {
    if (data.buttons) return data.buttons
    
    let buttons = [];
    if (config.sendType === 'quick'){
        buttons = JSON.parse(JSON.stringify(config.quickreplies));
    } else if (config.sendType === 'card'){
        buttons = JSON.parse(JSON.stringify(config.buttons));
    }

    if (!buttons || buttons.length <= 0) {
        return [];
    }
    for (let button of buttons){
        if (button.action === "share") {
            button.action = marshall(locale, button.action, data, '');

            let shcardtitle =  helper.getContextValue(RED, node, data, config.shcardtitle, config.shcardtitleType || 'str');
            let shcardimage =  helper.getContextValue(RED, node, data, config.shcardimage, config.shcardimageType || 'str');
            let shcardurl =  helper.getContextValue(RED, node, data, config.shcardurl, config.shcardurlType || 'str');
            let shcardbutton =  helper.getContextValue(RED, node, data, config.shcardbutton, config.shcardbuttonType || 'str');

            button.sharedCard = {
                title:  marshall(locale, shcardtitle,  data, ''),
                text:   marshall(locale, config.shcardtext,   data, ''),
                media:  marshall(locale, shcardimage,  data, ''),
                button: marshall(locale, shcardbutton,  data, ''),
                url:    marshall(locale, shcardurl,  data, '')
            }
            continue;
        }
        else if (!button.title || !button.action || !button.value) continue;

        button.title  = marshall(locale, button.title,  data, '')
        button.action = marshall(locale, button.action, data, '')
        button.value  = marshall(locale, button.value,  data, '')
        button.regexp = marshall(locale, button.regexp, data, '')

    }
    return buttons;
}

const input = (RED, node, data, config, reply) => {

    // Log activity
    try { setTimeout(function() { helper.trackActivities(node)},0); }
    catch(err) { console.log(err); }
    
    let convId = botmgr.getConvId(data)

    // Prepare the prompt
    if (config.prompt){
        botmgr.delayCallback(convId, (prompt) => {
            data.prompt = prompt
            sendData(node, data, config)
        })
    }

    // Retrieve replies
    let replies = reply || buildReply(RED, node, data, config);

    if (!replies){ 
        sendData(node, data, config); 
        return;
    }
    
    // Emit reply message
    data.reply = replies;
    data._replyid = node.id;
    
    if (config.metadata) {
        switch (config.metadataType) {
            case 'msg':
                data.metadata = data[config.metadata];
                break;
            case 'flow':
                data.metadata = node.context().flow.get(config.metadata);
                break;
            case 'global':
                data.metadata = node.context().global.get(config.metadata);
                break;
            case 'str':
                data.metadata = config.metadata;
                break;
            case 'num':
                data.metadata = +config.metadata;
                break;
            case 'bool':
                data.metadata = config.metadata === 'true';
                break;
            case 'json':
                data.metadata = JSON.parse(config.metadata);
                break;
        }
        data.metadataType = config.metadataType;
    }

    helper.emitAsyncEvent('before-reply', node, data, config, (beforeData) => {
        helper.emitAsyncEvent('reply', node, beforeData, config, (newData) => {
            helper.emitAsyncEvent('replied', node, newData, config, () => {})
            if (config.prompt) return; 
            sendData(node, newData, config);
        });
    });
}

const buildReply = (RED, node, data, config) => {
    let locale = botmgr.getLocale(data);
    let reply = {
        "type"      : config.sendType,
        "prompt"    : config.prompt,
        "receipt"   : data._receipt,
        "notification": data.notification
    };

    // Simple event message
    if (config.sendType === 'event'){
        let value = helper.getContextValue(RED, node, data, config.eventValue, config.eventValueType || 'str');
        let event = { 
            name: config.eventName,
            value: (typeof value === "string") ? marshall(locale, value,  data, '') : value
        }
        reply.event = event;
    }
    else { // Prepare speech
        reply.speech = (config.speech) ? "" : marshall(locale, config.speechText, data, '');
        delete data._receipt;
        delete data.notification;
    }

    // Simple text message
    if (config.sendType === 'text'){
        let text = marshall(locale, config.text, data, '');
        if (config.random){
            let txt = text.split('\n');
            text = txt[Math.round(Math.random() * (txt.length-1))]
        }

        reply.text = text;
        if (reply.speech === undefined) reply.speech = text;
    }

    // Simple media message
    if (config.sendType === 'media'){
        let media = helper.getContextValue(RED, node, data, config.media, config.mediaType || 'str');
        reply.media = marshall(locale, media,  data, '');


        reply.media = media;
        reply.mediaContentType = config.mediaContent;


        if (reply.speech === undefined) reply.speech = "";
    }

    // Card "signin" message
    if (config.sendType === 'signin'){


        let signintitle = helper.getContextValue(RED, node, data, config.signintitle, config.signintitleType || 'str');
        let signinurl = helper.getContextValue(RED, node, data, config.signinurl, config.signinurlType || 'str');

        reply.text  = marshall(locale, config.signintext,  data, '');
        reply.title = marshall(locale, signintitle,  data, '');
        reply.url   = marshall(locale, signinurl,  data, '');

        if (reply.speech === undefined) reply.speech = reply.text;
    }

    if(config.sendType === 'confirm') {
        reply.text = marshall(locale, config.confirmtext,  data, '');
    }
    
    // Other card message
    if (config.sendType === 'quick' || config.sendType === 'card' || config.sendType === 'adaptiveCard') {
    
        let buttons = getButtons(RED, locale, config, data);
        buttonsStack.push(data, buttons);
        reply.buttons = buttons;

        if (config.sendType === 'quick') {
            reply.quicktext = marshall(locale, config.quicktext, data, '');
            if (config.random){
                let txt = reply.quicktext.split('\n');
                reply.quicktext = txt[Math.round(Math.random() * (txt.length-1))]
            }
            if (reply.speech === undefined) reply.speech = reply.quicktext;
        } 
        else if (config.sendType === 'card') {

            let title  = helper.getContextValue(RED, node, data, config.title, config.titleType || 'str');
            let attach = helper.getContextValue(RED, node, data, config.attach, config.attachType || 'str');
            
            reply.title =    marshall(locale, title,  data, '');
            reply.subtitle = marshall(locale, config.subtitle,  data, '');
            reply.subtext =  marshall(locale, config.subtext,   data, '');
            reply.attach =   marshall(locale, attach,  data, '');
            if (reply.speech === undefined) reply.speech = reply.subtitle || reply.subtext;
        }
        else if (config.sendType === 'adaptiveCard') {
            buildReplyAdaptiveCard(RED, node, locale, data, config, reply);

        }
    }
    
    // Forward data without sending anything
    let context = botmgr.getContext(data);
    if (config.carousel){
        let carousel = context.carousel = context.carousel || [];
        carousel.push(reply);
        return;    
    }
    
    // Handle carousel
    let carousel = context.carousel = context.carousel || [];
    if (carousel.length > 0){
        carousel.push(reply)
        context.carousel = []; // clean
    }

    if (!config.prompt) {
        buttonsStack.popAll(data);
    } //else, buttons popped on prompt

    return carousel.length > 0 ? carousel : [ reply ];
}

const sendData = (node, data, config) => {

    let out  = new Array(parseInt(config.outputs || 1));
    let promptText = undefined;

    if (config.promptText) {
        promptText = helper.resolve(config.promptText, data, undefined);
    }

    let _continue = (data) => {
        // 3. REPEAT: the latest output
        if (config.repeat && config.repeat > 0){
            data._tmp = data._tmp || {}
            let cpt = data._tmp['rpt_'+node.id] || 0
            let rpt = parseInt(config.repeat)

            data._tmp['rpt_'+node.id] = cpt + 1;
            if (cpt >= rpt){
                out[out.length -1] = data;
                return node.send(out);        
            }
        }

        // 4. DEFAULT: the first output
        out[0] = data;
        return node.send(out);
    }


    if (config.prompt) {

        // 1. BUTTONS: the middle outputs
        let buttons = buttonsStack.popAll(data);

        config.promptText = promptText;

        let acceptValue = false;
        
        if (buttons && buttons.length > 0) {

            for (let i = 0 ; i < buttons.length ; i++){
                let button = buttons[i]; 
                let buttonValue = (button.value || '').replace(new RegExp(/\:/g),"\\:")
                let rgxp = new RegExp(button.regexp || '^'+buttonValue+'$', 'i');
                let testValue = data.prompt.text

                if(button.unaccentuate) {
                    testValue = testValue.replace(new RegExp(/\s/g),"");
                    testValue = testValue.replace(new RegExp(/[àáâãäå]/g),"a");
                    testValue = testValue.replace(new RegExp(/æ/g),"ae");
                    testValue = testValue.replace(new RegExp(/ç/g),"c");
                    testValue = testValue.replace(new RegExp(/[èéêë]/g),"e");
                    testValue = testValue.replace(new RegExp(/[ìíîï]/g),"i");
                    testValue = testValue.replace(new RegExp(/ñ/g),"n");                
                    testValue = testValue.replace(new RegExp(/[òóôõö]/g),"o");
                    testValue = testValue.replace(new RegExp(/œ/g),"oe");
                    testValue = testValue.replace(new RegExp(/[ùúûü]/g),"u");
                    testValue = testValue.replace(new RegExp(/[ýÿ]/g),"y");
                }

                if (!rgxp.test(testValue)) {
                    rgxp = new RegExp('^'+buttonValue+'$', 'i');

                    if (!rgxp.test(testValue)) {
                        continue;
                    }
                }

                acceptValue = true;

                if (promptText){ 
                    helper.setByString(data, promptText, button.value, (ex) => { node.warn(ex) });
                } else {
                    helper.setByString(data, "prompt.text", button.value, (ex) => { node.warn(ex) });
                }

                if (config.btnOutput || config.quickOutput){ 
                    out[i+1] = data;
                    // Even if the button match, emit a prompt event for logs, etc ...
                    helper.emitAsyncEvent('prompt', node, data, config, (data) => { 
                        node.send(out);
                    });
                    return 
                } 
            }
        } else {

            acceptValue = true;

            if (promptText) { 
                helper.setByString(data, promptText, data.prompt.text, (ex) => { node.warn(ex) });
            }
        }

        if(acceptValue === false) {
            //if we get here, it means that the prompted text doesn't match any button and wasn't expected
            helper.emitAsyncEvent('prompt', node, data, config, (data) => {
                helper.emitAsyncEvent('prompt-unexpected', node, data, config, (data) => {
                    _continue(data);
                });
            });

        } else {
            helper.emitAsyncEvent('prompt', node, data, config, (data) => {  
                _continue(data); 
            });
        }

    } else {
        _continue(data);
    }
}

/**
 * Render text block to AdaptiveCard
 * @param {String} textToShow text populated to card
 * @param {Array} body AdaptiveCard body
 */
const addTextBlockToAdaptiveCard = (textToShow, body) => {
    const textBlock = {
        "type": "TextBlock",
        "wrap": true,
        "size": "default",
        "text": textToShow
    }
    body.push({
        "type": "Container",
        "items": [ textBlock ]
    });
};

/**
 * Add button to AdaptiveCard
 * @param {String} textToShow button text to display, by default with a prefix and won't show the first 4 characters
 * @param {Array} body AdaptiveCard reply body
 */
const addButtonToAdaptiveCard = (textButtonMarker, prefix, textToShow, body) => {
    const textBlock = {
        "type": "TextBlock",
        "wrap": true,
        "size": "default",
        "text": textToShow						
    };
    let button;
    const btnVal = textToShow.substring(textButtonMarker.length).trim(); // remove text marker ('- ') ahead of string
    if (btnVal && btnVal !== '') {
        button = {
            "type": "Action.Submit",
            "title": "cool link",
            "data":{"__isBotFrameworkCardAction": true, "type": "postBack", "value": `${prefix + btnVal}`}
        };
        body.push({
            "type": "Container",
            "items": [ textBlock],
            "selectAction": button
        });
    } else {
        body.push({
            "type": "Container",
            "items": [ textBlock]
        });
    }
};

/**
 * Takes the "wholeText" text and builds a "body" for the adaptive card.
 * @param {*} wholeText The wholeText text to process
 * @param {*} body The parameter in which to put the processed text, see adaptive card documentation
 * @param {*} separator The parameter used as a section separator. Each line of text is finally a container, with title containers non-clickable and item container clickable.
 */
const buildAdaptiveCardJson = function(wholeText, body, separator, textButtonMarker, textButtonPrefix) {
    /**
    textButtonMarker = '- ', Original text is:
    
    **Memory**:                       <---  this line as Text because this line do NOT start with textButtonMarker '- '
    - 1. Item memory 1                <---  this line as Button because this line starts with textButtonMarker '- '
    **Storage**:
    - 1. Item storage 1               <---  Button
    - 2. Item storage 2               <---  Button
    **Note**:
    - 1. Item Note 1                  <---  Button
    **Standard**:
    - 1. Item Standard 1              <---  Button
    -----------------------------------------
        Set text as button if one line contains 'clickable Text Marker ${textButtonMarker}',
        Otherwise, pure text as it is
    **/
    wholeText.split(separator).forEach((section) => {
        section.split('\n')
            .filter(line => line !== '' && line)
            .forEach((line) => {
                if (line.search(textButtonMarker) === 0) {
                    // line starts with textButtonMarker, means this line is clickable, means this line actually is a button
                    addButtonToAdaptiveCard(textButtonMarker, textButtonPrefix, line, body);
                } else {
                    // line is pure text
                    addTextBlockToAdaptiveCard(`${line}`, body);
                }
            });
    });
}

/**
 * Add image to AdaptiveCard, by default the image will be appended to the 1st Container
 * @param {String} imageUrl image URL
 * @param {String} imageSize image size, possible values: "auto", "stretch", "small", "medium", "large"
 * @param {String} imageHorizontalAlignment Controls how this element is horizontally positioned within its parent. Possilbe values: left, center, right
 * @param {String} imageWidth image width, this overrides the size property.
 * @param {String} imageHeight image height, this overrides the size property.
 * @param {Array} itemsOfFirstContainer items Array of the first container inside AdaptiveCard JSON schema,
 *                         an exmple of which via https://docs.microsoft.com/en-us/adaptive-cards/getting-started/bots
 *                         Document image https://adaptivecards.io/explorer/Image.html
 */
const addImageToAdaptiveCard = (imageUrl, imageSize, imageHorizontalAlignment, imageWidth, imageHeight, body) => {
    const image = {
        type: "Image",
        url: imageUrl,
        style: "default"
    };

    if (imageSize) image.size = `${imageSize}`;
    if (imageHorizontalAlignment) image.horizontalAlignment = `${imageHorizontalAlignment}`;
    // {number} pixelWidth & {number} pixelHeight, refer to funciton toJSON() n applySize() in:
    // pixelWidth and pixelHeight are only parsed for backwards compatibility.
    // https://github.com/microsoft/AdaptiveCards/blob/f9b405a4c2090dfefc7aafa88b2817582a5fa2fd/source/nodejs/adaptivecards/src/card-elements.ts
    if (imageWidth) {
        image.width = `${imageWidth}px`;
        image.pixelWidth = parseInt(imageWidth); // type Number
    }
    if (imageHeight) {
        image.height = `${imageHeight}px`;
        image.pixelHeight = parseInt(imageHeight); // type Number
    }

    const firstContainer = body[0].type === "Container" ? body[0] : null;

    // If there exists a Container: append image directly to tail of Array ${items} inside the first Container 
    if (firstContainer) {
        firstContainer.items.push(image);
    } else {
        // If there is no Container yet: create a Container; then fold image into this Container; finally append it to ${body}
        body.push({
            "type": "Container",
            "items": [ image ]
        });
    }
};

const buildReplyAdaptiveCard = (RED, node, locale, data, config, reply) => {
    let title = config.titleAdaptiveCard;
    let attach = config.attachAdaptiveCard;
    let attachSize = config.attachSizeAdaptiveCard;
    let imageHorizontalAlignment = config.attachHorizontalAlignment;
    let imageWidth = config.attachWidthAdaptiveCard;
    let imageHeight = config.attachHeightAdaptiveCard;
    let subtext = config.textAdaptiveCard;
    let separator = config.containerSeparatorAdaptiveCard;
    let displayedTextSize = config.displayedTextSizeAdaptiveCard;
    let titleShowCardAction = config.titleShowCardAction;
    let textButtonMarker = config.textButtonMarker;
    let textButtonPrefix = config.textButtonPrefix;
   
    /* 
    '\n\n' is a default Section marker, '- ' is clickable text marker by default)
    This is an exmaple of text to display:
        {Title}
        \n\n
        {Subtitle1} (this is Section1)
        - {some text}
        - {some other text} 
        \n\n
        {Subtitle2} (this is Section2)
        - {some text}
        - {some other text}
        \n\n 
        {Subtitle3} (this is Section3)
        - {some text}
        - {some other text}
    */
    if (!separator) {
        // if not defined value, then consider sections are surrounded by '\n\n'.
        separator = "\n\n";
    }

    if (!displayedTextSize) {
        // if not defined value, then don't wrap, display up to 100k characters.
        displayedTextSize = 100000;
    }

    textButtonMarker = helper.getContextValue(RED, node, data, textButtonMarker || '- ', 'str');
    textButtonPrefix = helper.getContextValue(RED, node, data, textButtonPrefix || '', config.textButtonPrefixType || 'str');

    titleShowCardAction = helper.getContextValue(RED, node, data, titleShowCardAction || 'More', config.titleShowCardActionType || 'str');
    titleShowCardAction = marshall(locale, titleShowCardAction,  data, '');

    title = helper.getContextValue(RED, node, data, title || '', config.titleTypeAdaptiveCard || 'str');
    title = marshall(locale, title,  data, '');

    attach = helper.getContextValue(RED, node, data, attach || '', config.attachTypeAdaptiveCard || 'str');
    attach = marshall(locale, attach,  data, '');

    attachSize = helper.getContextValue(RED, node, data, attachSize, 'str');
    imageHorizontalAlignment = helper.getContextValue(RED, node, data, imageHorizontalAlignment, 'str');
    imageWidth = helper.getContextValue(RED, node, data, imageWidth, 'str');
    imageHeight = helper.getContextValue(RED, node, data, imageHeight, 'str');

    reply.type = 'AdaptiveCard';
    reply.title = title;
    reply.version = "1.0";
    reply.body = [];

    /*customized text to display*/
    const textToShow = marshall(locale, subtext,  data, '');

    if (textToShow.length > displayedTextSize) {
        // if textToShow is too big and has to be wrapped up to <displayedTextSize> characters
        let tmp = textToShow.substring(0, displayedTextSize);

        // To avoid displaying the UNCOMPLETED N th item, display onlt the (N - 1)th item
        /* For exmaple: 
                tmp = "productbot.before_colon_series\n\n**Processor**:
                - 1. Intel® Xeon® Gold 5222 (3.8 GHz base frequency, up to 3.9 GHz with Intel® Turbo Boost Technology, 16.5 MB cache, 4 cores)
                - 2. Intel® Xeon® Silver 4114 (2.2 GHz base freque";

            To avoid displaying the 2nd item(which is uncomplete), display onlt the 1st item
        */
        const attrIndex = tmp.lastIndexOf('\n');
        tmp = textToShow.substring(0, attrIndex);

        // primary card
        buildAdaptiveCardJson(tmp, reply.body, separator, textButtonMarker, textButtonPrefix);
        if (attach) addImageToAdaptiveCard(attach, attachSize, imageHorizontalAlignment, imageWidth, imageHeight, reply.body);

        // expandable card
        reply.actions = [];
        tmp = textToShow.substring(attrIndex);
        reply.actions.push({"type": "Action.ShowCard", "title": titleShowCardAction, "card": {"type": 'AdaptiveCard', "body": []}});
        buildAdaptiveCardJson(tmp, reply.actions[0].card.body, separator, textButtonMarker, textButtonPrefix);
    } else {
        // otherwise show all the text within the primary card, no expandable card
        buildAdaptiveCardJson(textToShow, reply.body, separator, textButtonMarker, textButtonPrefix);
        if (attach) addImageToAdaptiveCard(attach, attachSize, imageHorizontalAlignment, imageWidth, imageHeight, reply.body);
    }
}
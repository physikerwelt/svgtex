'use strict';

var BBPromise = require('bluebird');
var texvcInfo = require('texvcinfo');
var sre = require('speech-rule-engine');
var SVGO = require('svgo');
var Readable = require('stream').Readable;
var HTTPError = require('./util').HTTPError;
var svgo = new SVGO({
    plugins: [
        {convertTransform: false}
    ]
});

function verifyOutFormat(fmt, type, conf) {
    if (!fmt) {
        return 'json';
    }
    var outFormat;

    function setOutFormat(fmt) {
        if (conf[fmt] || (fmt === 'graph' && conf.texvcinfo)) {
            outFormat = fmt;
        } else {
            emitFormatError(fmt);
        }
    }

    switch (fmt.toLowerCase()) {
        case "svg":
            setOutFormat('svg');
            break;
        case "png":
            setOutFormat('png');
            break;
        case "texvcinfo":
            setOutFormat('texvcinfo');
            if (!/(chem|tex$)/i.test(type)) {
                emitError('texvcinfo accepts only tex, inline-tex, or chem as the input type, "' + type + '" given!');
            }
            break;
        case "graph":
            setOutFormat('graph');
            if (!/tex$/i.test(type)) {
                emitError('graph accepts only tex or inline-tex as the input type, "' + type + '" given!');
            }
            break;
        case "json":
            outFormat = "json";
            break;
        case 'complete':
            outFormat = 'complete';
            break;
        case "mml":
        case "mathml":
            outFormat = "mml";
            break;
        case "speech":
            setOutFormat('speech');
            break;
        default:
            emitError("Output format \"" + fmt + "\" is not recognized!");
    }
    return outFormat;
}
// From https://github.com/pkra/mathjax-node-sre/blob/master/lib/main.js
var srePostProcessor = function (config, result) {
    if (result.error) throw result.error;
    if (!result.mml) throw new Error('No MathML found. Please check the mathjax-node configuration');
    if (!result.svgNode && !result.htmlNode && !result.mmlNode) throw new Error('No suitable output found. Please check the mathjax-node configuration');
    // add semantic tree
    if (config.semantic) {
        result.streeJson = sre.toJson(result.mml);
        var xml = sre.toSemantic(result.mml).toString();
        result.streeXml = config.minSTree ? xml : sre.pprintXML(xml);
    }
    // return if no speakText is requested
    if (!config.speakText) {
        return result;
    }
    // enrich output
    sre.setupEngine(config);
    result.speakText = sre.toSpeech(result.mml);
    if (result.svgNode) {
        result.svgNode.querySelector('title').innerHTML = result.speakText;
        // update serialization
        // HACK add lost xlink namespaces TODO file jsdom bug
        if (result.svg) result.svg = result.svgNode.outerHTML
            .replace(/(<(?:use|image) [^>]*)(href=)/g, ' $1xlink:$2');
    }
    if (result.htmlNode) {
        result.htmlNode.firstChild.setAttribute("aria-label", result.speakText);
        // update serialization
        if (result.html) result.html = result.htmlNode.outerHTML;
    }
    if (result.mmlNode) {
        result.mmlNode.setAttribute("alttext", result.speakText);
        // update serialization
        if (result.mml) result.mml = result.mmlNode.outerHTML;
    }
    if (config.enrich) {
        result.mml = sre.toEnriched(result.mml).toString();
    }
    return result;
};

//
//  Create the PNG file asynchronously, reporting errors.
//
function GetPNG(result, resolve, conf) {
    var rsvg = require('librsvg').Rsvg;
    var s = new Readable();
    var pngScale = conf.dpi / 90; // 90 DPI is the effective setting used by librsvg
    var ex = 6;
    var width = result.svgNode.getAttribute("width").replace("ex", "") * ex;
    var height = result.svgNode.getAttribute("height").replace("ex", "") * ex;

    var svgRenderer = new rsvg();
    s._read = function () {
        s.push(result.svg.replace(/="currentColor"/g, '="black"'));
        s.push(null);
    };
    svgRenderer.on('finish', function () {
        try {
            var buffer = svgRenderer.render({
                format: 'png',
                width: width * pngScale,
                height: height * pngScale
            }).data;
            result.png = buffer || new Buffer();
        } catch (e) {
            result.errors = e.message;
        }
        resolve(result);
    });
    s.pipe(svgRenderer);
    return resolve;  // This keeps the queue from continuing until the readFile() is complete
}

/* The response headers for different render types */
var outHeaders = function (data) {
    return {
        svg: {
            'content-type': 'image/svg+xml'
        },
        png: {
            'content-type': 'image/png'
        },
        mml: {
            'content-type': 'application/mathml+xml',
            'x-mathoid-style': data.mathoidStyle
        }
    };
};


function emitError(txt, detail) {
    if (detail === undefined) {
        detail = txt;
    }
    throw new HTTPError({
        status: 400,
        success: false,
        title: 'Bad Request',
        type: 'bad_request',
        detail: detail,
        error: txt
    });
}

function emitFormatError(format) {
    emitError("Output format " + format + " is disabled via config, try setting \"" +
        format + ": true\" to enable " + format + "rendering.");
}

var optimizeSvg = function (data, logger, cb) {
    try {
        svgo.optimize(data.svg, function (result) {
            if (!result.error) {
                data.svg = result.data;
            } else {
                logger.log('warn/svgo', result.error);
            }
            cb();
        });
    } catch (e) {
        logger.log('warn/svgo', e);
        cb();
    }
};

var verifyRequestType = function (type) {
    type = (type || 'tex').toLowerCase();
    switch (type) {
        case "tex":
            type = "TeX";
            break;
        case "inline-tex":
            type = "inline-TeX";
            break;
        case "mml":
        case "mathml":
            type = "MathML";
            break;
        case "ascii":
        case "asciimathml":
        case "asciimath":
            type = "AsciiMath";
            break;
        case "chem":
            type = "chem";
            break;
        default :
            emitError("Input format \"" + type + "\" is not recognized!");
    }
    return type;
};

function handleRequest(res, q, type, outFormat, features, logger, conf, mjAPI) {
    // First some rudimentary input validation
    if (!q) {
        emitError("q (query) parameter is missing!");
    }
    type = verifyRequestType(type);
    outFormat = verifyOutFormat(outFormat, type, conf);
    features = features || {speech: conf.speech_on};

    var sanitizedTex, feedback;
    var svg = conf.svg && /^svg|json|complete|png$/.test(outFormat);
    var mml = (type !== "MathML") && /^mml|json|complete$/.test(outFormat);
    var png = conf.png && /^png|json|complete$/.test(outFormat);
    var info = conf.texvcinfo && /^graph|texvcinfo$/.test(outFormat);
    var img = conf.img && /^mml|json|complete$/.test(outFormat);
    var speech = (outFormat !== "png") && features.speech || outFormat === "speech";
    var chem = type === "chem";
    if (chem) {
        type = "inline-TeX";
    }
    if ((!conf.no_check && /^TeX|inline-TeX$/.test(type)) || info) {
        feedback = texvcInfo.feedback(q, {usemhchem: chem});
        // XXX properly handle errors here!
        if (feedback.success) {
            sanitizedTex = feedback.checked || '';
            q = sanitizedTex;
        } else {
            emitError(feedback.error.name + ': ' + feedback.error.message, feedback);
        }
        if (info) {
            if (outFormat === "graph") {
                res.json(texvcInfo.texvcinfo(q, {"format": "json", "compact": true}));
                return;
            }
            if (info && outFormat === "texvcinfo") {
                res.set("Cache-Control", "max-age=2592000");
                res.json(feedback).end();
                return;
            }
        }
    }

    var mathJaxOptions = {
        math: q,
        format: type,
        svg: svg,
        svgNode: img + png,
        mml: mml
    };
    if (speech) {
        mathJaxOptions.mmlNode = true;
        mathJaxOptions.mml = true;
    }
    return new BBPromise(function (resolve, reject) {
        mjAPI.typeset(mathJaxOptions, function (data) {
            resolve(data);
        });
    }).then(function (data) {
        return new BBPromise(function (resolve, reject) {
            if (png) {
                GetPNG(data, resolve, conf);
            } else {
                resolve(data);
            }
        });
    })
        .then(function (data) {
            if (data.errors) {
                emitError(data.errors);
            }
            if (speech) {
                data = srePostProcessor(conf.speech_config, data);
            }
            data.success = true;
            // @deprecated
            data.log = "success";
            if (data.svgNode) {
                data.mathoidStyle = [
                    data.svgNode.style.cssText,
                    " width:", data.svgNode.getAttribute("width"), "; height:", data.svgNode.getAttribute("height"), ';'
                ].join("");
            }


            // make sure to delete non serializable objects
            delete data.svgNode;
            delete data.mmlNode;
            // Return the sanitized TeX to the client
            if (sanitizedTex !== undefined) {
                data.sanetex = sanitizedTex;
            }
            if (speech) {
                data.speech = data.speakText;
            }

            function outputResponse() {
                switch (outFormat) {
                    case 'json':
                        res.json(data).end();
                        break;
                    case 'complete':
                        var headers = outHeaders(data);
                        Object.keys(headers).forEach(function (outType) {
                            if (data[outType]) {
                                data[outType] = {
                                    headers: headers[outType],
                                    body: data[outType]
                                };
                            }
                        });
                        res.json(data).end();
                        break;
                    default:
                        res.set(outHeaders(data)[outFormat]);
                        res.send(data[outFormat]).end();
                }
            }

            if (data.svg && conf.svgo) {
                optimizeSvg(data, logger, outputResponse);
            } else {
                outputResponse();
            }
        });
}


module.exports = {
    handleRequest: handleRequest,
    emitError: emitError
};
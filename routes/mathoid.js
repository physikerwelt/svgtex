'use strict';


var BBPromise = require('bluebird');
var sUtil = require('../lib/util');
var mathoid = require('../lib/math');
var emitError = mathoid.emitError;


/**
 * The main router object
 */
var router = sUtil.router();

/**
 * The main application object reported when this module is require()d
 */
var app;

/**
 * GET /
 * Performs the check get request
 */
router.get('/get/:outformat?/:type?/:q?', function (req, res) {
    if (!(req.params.q)) {
        emitError("q (query) parameter is missing!");
    }
    return mathoid.handleRequest(res,
        req.params.q,
        req.params.type,
        req.params.outformat,
        {},
        req.logger, app.conf,
        app.mjAPI);
});

/**
 * POST /
 * Performs the rendering request
 */
router.post('/:outformat?/', function (req, res) {
    // First some rudimentary input validation
    if (!(req.body.q)) {
        emitError("q (query) post parameter is missing!");
    }
    var speech = app.conf.speech_on;
    if (req.body.nospeech) {
        speech = false;
    }
    return mathoid.handleRequest(res, req.body.q, req.body.type, req.params.outformat, {speech: speech}, req.logger, app.conf, app.mjAPI);

});


module.exports = function (appObj) {

    app = appObj;

    return {
        path: '/',
        skip_domain: true,
        router: router
    };

};


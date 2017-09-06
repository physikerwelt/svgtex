#!/usr/bin/env node
'use strict';
var program = require('commander');

var BBPromise = require('bluebird');
var json = require('./package.json');
var preq = require('preq');

var fs = BBPromise.promisifyAll(require('fs'));
var path = require('path');

var mjAPI = require('mathoid-mathjax-node');
var yaml = require('js-yaml');
var fileOrStdin = require('file-or-stdin');
var fileOrStdout = require('file-or-stdout');
var mocks = require('mock-express-response');
var mathoid = require('./lib/math');

program
    .version(json.version)
    .usage('[options]')
    .option('-v, --verbose', 'Show verbose error information')
    .option('-c, --config [config]', 'YAML-formatted configuration file', './config.dev.yaml');
program.parse(process.argv);

var config = yaml.safeLoad(fs.readFileSync(program.config));
var myServiceIdx = config.services.length - 1;
var conf = config.services[myServiceIdx].conf;


mjAPI.config(conf.mj_config);

// This call is not required but it might improve the performance slightly
mjAPI.start();


fileOrStdin(program.args[0], 'utf8').then(function (data) {
    var inp = JSON.parse(data);
    if (!inp) {
        return {"error": "no valid data sent"};
    }
    var renderings = BBPromise.map(inp, function (req) {
        var response = new mocks();
        return mathoid.handleRequest(response, req.query.q, req.query.type, req.query.outformat, req.query.features, {}, conf, mjAPI)
            .then(function () {
                return {req: req, res: response._getJSON()};
            })
            .catch(function (err) {
                return {req: req, res: {success: false, log: err.message}};
            });
    });
    BBPromise.reduce(renderings, function (out, el) {
        if (el.req.query.hash) {
            var key = el.req.query.hash;
            out[key] = el.res;
        } else {
            out.nohash.push(el);
        }
        return out;
    }, {nohash: [], success: true}).then(function (out) {
        return fileOrStdout(program.args[1], JSON.stringify(out));
    }).then(function (isFile) {
        // If no output file was given, wait until all data was written to stdout
        if (!isFile) {
            process.stdout.on('drain', function () {
                process.exit();
            });
        }
    });
})
    .catch(function (err) {
            throw err;
        }
    )
;


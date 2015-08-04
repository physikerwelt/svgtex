"use strict";
var preq = require('preq');
var assert = require('../../../utils/assert.js');
var server = require('../../../utils/server.js');
var baseURL = server.config.uri;

var fs = require('fs');
var path = require('path');


describe('Run test for all mathjax-texvc commands:', function () {
    this.timeout(0);
    before(function (cb) {
        // Wait for MathJax startup, as that's somewhat async but has a sync
        // interface
        setTimeout(cb, 2000);
    });
    // read test cases
    var formulae = require('./mathjax-texvc.json');
    // create a mocha test case for each chunk
    describe('Run texvc tests', function () {
        formulae.forEach(function (testcase) {
            if (testcase.ignore !== true) {
                it(testcase.id + " $" + testcase.input + "$", function () {
                    return preq.post({
                        uri: baseURL + "png/",
                        body: {q: testcase.input, noSpeak: true}
                    }).then(function (res) {
                        assert.status(res, 200);
                        fs.writeFile("/tmp/png/" + testcase.id + ".png", res.body.toString().replace(/^data:image\/png;base64,/, ""), 'base64'
                            , function (err) {
                                if (err) {
                                    return console.log(err);
                                }
                                console.log("The file was saved!");
                            });
                        fs.appendFile("/tmp/test-p.md", "\n * Test " + testcase.id + " $" + testcase.input
                            + "$ ![Test-image](" + testcase.id + ".png)",
                            function (err) {
                                if (err) {
                                    return console.log(err);
                                }
                                console.log("The file was saved!");
                            });
                        //var referenceSvg = fs.readFileSync(path.resolve(__dirname, "svg", testcase.id + ".svg"));
                        //assert.deepEqual(res.body, referenceSvg, testcase.id + " failed. SVG is different!" );
                    });
                });
            }
        });
    });
});

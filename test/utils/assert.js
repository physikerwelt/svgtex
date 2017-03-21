'use strict';


var assert = require('assert');
var xmldom = require("xmldom");
var parser = new xmldom.DOMParser();
var compare = require('dom-compare').compare;
var reporter = require('dom-compare').GroupingReporter;


/**
 * Asserts whether the return status was as expected
 */
function status(res, expected) {

    deepEqual(res.status, expected,
        'Expected status to be ' + expected + ', but was ' + res.status);

}


/**
 * Asserts whether content type was as expected
 */
function contentType(res, expected) {

    var actual = res.headers['content-type'];
    deepEqual(actual, expected,
        'Expected content-type to be ' + expected + ', but was ' + actual);

}


function isDeepEqual(result, expected, message) {

    try {
        if (typeof expected === 'string') {
            assert.ok(result === expected || (new RegExp(expected).test(result)), message);
        } else {
            assert.deepEqual(result, expected, message);
        }
        return true;
    } catch (e) {
        return false;
    }

}


function deepEqual(result, expected, message) {

    try {
        if (typeof expected === 'string') {
            assert.ok(result === expected || (new RegExp(expected).test(result)));
        } else {
            assert.deepEqual(result, expected, message);
        }
    } catch (e) {
        // Temporary remove the large debug output and rely on the IDE features
        // console.log('Expected:\n' + JSON.stringify(expected, null, 2));
        // console.log('Result:\n' + JSON.stringify(result, null, 2));
        assert.equal(result, expected, message);
        throw e;
    }

}

function xEqual(result,expected,message) {
    var domReal = parser.parseFromString(result);
    var domRef = parser.parseFromString(expected);
    var cmp = compare(domRef, domReal);
    if(!cmp.getResult() ){
        console.log(reporter.report(cmp));
        assert.deepEqual(result,expected,message);

    }
}


function notDeepEqual(result, expected, message) {

    try {
        assert.notDeepEqual(result, expected, message);
    } catch (e) {
        console.log('Not expected:\n' + JSON.stringify(expected, null, 2));
        console.log('Result:\n' + JSON.stringify(result, null, 2));
        throw e;
    }

}


function fails(promise, onRejected) {

    var failed = false;

    function trackFailure(e) {
        failed = true;
        return onRejected(e);
    }

    function check() {
        if (!failed) {
            throw new Error('expected error was not thrown');
        }
    }

    return promise.catch(trackFailure).then(check);

}


module.exports.ok             = assert.ok;
module.exports.fails          = fails;
module.exports.deepEqual      = deepEqual;
module.exports.isDeepEqual    = isDeepEqual;
module.exports.notDeepEqual   = notDeepEqual;
module.exports.xEqual         = xEqual;
module.exports.contentType    = contentType;
module.exports.status         = status;
module.exports.throws         = assert.throws;


#!/usr/bin/env node

/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Mozilla BrowserID.
 *
 * The Initial Developer of the Original Code is Mozilla.
 * Portions created by the Initial Developer are Copyright (C) 2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

require('./lib/test_env.js');

const assert =
require('assert'),
vows = require('vows'),
start_stop = require('./lib/start-stop.js'),
wsapi = require('./lib/wsapi.js'),
db = require('../lib/db.js'),
config = require('../lib/configuration.js'),
jwk = require('jwcrypto/jwk.js'),
jwt = require('jwcrypto/jwt.js'),
vep = require('jwcrypto/vep.js'),
jwcert = require('jwcrypto/jwcert.js'),
http = require('http'),
querystring = require('querystring'),
path = require("path");

var suite = vows.describe('auth-with-assertion');

// disable vows (often flakey?) async error behavior
suite.options.error = false;

start_stop.addStartupBatches(suite);

const TEST_DOMAIN = 'example.domain',
      TEST_EMAIL = 'testuser@' + TEST_DOMAIN,
      TEST_ORIGIN = 'http://127.0.0.1:10002';

var token = undefined;

// here we go!  let's authenticate with an assertion from
// a primary.

// now we need to generate a keypair and a certificate
// signed by our in tree authority
var g_keypair, g_cert;

suite.addBatch({
  "generating a keypair": {
    topic: function() {
      return jwk.KeyPair.generate("DS", 256)
    },
    "succeeds": function(r, err) {
      assert.isObject(r);
      assert.isObject(r.publicKey);
      assert.isObject(r.secretKey);
      g_keypair = r;
    }
  }
});

// for this trick we'll need the "secret" key of our built in
// primary
var g_privKey = jwk.SecretKey.fromSimpleObject(
  JSON.parse(require('fs').readFileSync(
    path.join(__dirname, '..', 'example', 'primary', 'sample.privatekey'))));


suite.addBatch({
  "generting a certificate": {
    topic: function() {
      var domain = process.env['SHIMMED_DOMAIN'];

      var expiration = new Date();
      expiration.setTime(new Date().valueOf() + 60 * 60 * 1000);
      g_cert = new jwcert.JWCert(TEST_DOMAIN, expiration, new Date(),
                                 g_keypair.publicKey, {email: TEST_EMAIL}).sign(g_privKey);
      return g_cert;
    },
    "works swimmingly": function(cert, err) {
      assert.isString(cert);
      assert.lengthOf(cert.split('.'), 3);
    }
  }
});

// now let's generate an assertion using the cert
suite.addBatch({
  "generating an assertion": {
    topic: function() {
      var expirationDate = new Date(new Date().getTime() + (2 * 60 * 1000));
      var tok = new jwt.JWT(null, expirationDate, TEST_ORIGIN);
      return vep.bundleCertsAndAssertion([g_cert], tok.sign(g_keypair.secretKey));
    },
    "succeeds": function(r, err) {
      assert.isString(r);
    },
    "and logging in with the assertion succeeds": {
      topic: function(assertion)  {
        wsapi.post('/wsapi/auth_with_assertion', {
          email: TEST_EMAIL,
          assertion: assertion
        }).call(this);
      },
      "works": function(r, err) {
        var resp = JSON.parse(r.body);
        assert.isObject(resp);
        assert.isTrue(resp.success);
      }
    }
  }
});

start_stop.addShutdownBatches(suite);

// run or export the suite.
if (process.argv[1] === __filename) suite.run();
else suite.export(module);

// Copyright © 2017, 2018 IBM Corp. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/* global describe it before after afterEach */
'use strict';

const assert = require('assert');
const nock = require('./nock.js');
const Client = require('../lib/client.js');
const Cloudant = require('../cloudant.js');
const uuidv4 = require('uuid/v4');

const ME = process.env.cloudant_username || 'nodejs';
const PASSWORD = process.env.cloudant_password || 'sjedon';
const SERVER = `https://${ME}.cloudant.com`;
const DBNAME = `nodejs-cloudant-${uuidv4()}`;

describe('ChangesReader', function() {
  afterEach(function() {
    if (!process.env.NOCK_OFF) {
      nock.cleanAll();
    }
  });

  before(function(done) {
    var mocks = nock(SERVER)
      .put(`/${DBNAME}`)
      .reply(201, { ok: true });

    var cloudantClient = new Client({ plugins: 'retry' });

    var options = {
      url: `${SERVER}/${DBNAME}`,
      auth: { username: ME, password: PASSWORD },
      method: 'PUT'
    };
    cloudantClient.request(options, function(err, resp) {
      assert.equal(err, null);
      assert.equal(resp.statusCode, 201);
      mocks.done();
      done();
    });
  });

  after(function(done) {
    var mocks = nock(SERVER)
      .delete(`/${DBNAME}`)
      .reply(200, { ok: true });

    var cloudantClient = new Client({ plugins: 'retry' });

    var options = {
      url: `${SERVER}/${DBNAME}`,
      auth: { username: ME, password: PASSWORD },
      method: 'DELETE'
    };
    cloudantClient.request(options, function(err, resp) {
      assert.equal(err, null);
      assert.equal(resp.statusCode, 200);
      mocks.done();
      done();
    });
  });

  describe('polling', function() {
    it('one poll no changes', function(done) {
      var changeURL = `/${DBNAME}/_changes`;
      nock(SERVER)
        .get(changeURL)
        .query({feed: 'longpoll', timeout: 60000, since: 'now', limit: 100, heartbeat: 5000, seq_interval: 100, include_docs: false})
        .reply(200, { results: [], last_seq: '1-0', pending: 0 })
        .get(changeURL)
        .delay(2000)
        .reply(500);
      var cloudant = Cloudant({ account: ME });
      var db = cloudant.db.use(DBNAME);
      var cr = db.changesReader.start();
      cr.on('seq', function(seq) {
        // after our initial call with since=now, we should get a reply with last_seq=0-1
        assert.equal(seq, '1-0');
        db.changesReader.stop();
        done();
      });
    });

    it('one poll multi changes', function(done) {
      var changeURL = `/${DBNAME}/_changes`;
      var changes = [{seq: null, id: '1', changes: ['1-1']},
                     {seq: null, id: '2', changes: ['1-1']},
                     {seq: null, id: '3', changes: ['1-1']},
                     {seq: null, id: '4', changes: ['1-1']},
                     {seq: null, id: '5', changes: ['1-1']}];
      nock(SERVER)
        .get(changeURL)
        .query({feed: 'longpoll', timeout: 60000, since: 'now', limit: 100, heartbeat: 5000, seq_interval: 100, include_docs: false})
        .reply(200, { results: changes, last_seq: '1-0', pending: 0 })
        .get(changeURL)
        .delay(2000)
        .reply(500);
      var cloudant = Cloudant({ account: ME });
      var db = cloudant.db.use(DBNAME);
      var cr = db.changesReader.start();
      var i = 0;
      cr
      .on('change', function(c) {
        assert.deepEqual(c, changes[i++]);
      }).on('batch', function(b) {
        assert.deepEqual(b, changes);
      }).on('seq', function(seq) {
        // after our initial call with since=now, we should get a reply with last_seq=0-1
        assert.equal(seq, '1-0');
        db.changesReader.stop();
        done();
      });
    });

    it('multiple polls', function(done) {
      var changeURL = `/${DBNAME}/_changes`;
      var change = {seq: null, id: 'a', changes: ['1-1']};
      nock(SERVER)
        .get(changeURL)
        .query({feed: 'longpoll', timeout: 60000, since: 'now', limit: 100, heartbeat: 5000, seq_interval: 100, include_docs: false})
        .reply(200, { results: [], last_seq: '1-0', pending: 0 })
        .get(changeURL)
        .query({feed: 'longpoll', timeout: 60000, since: '1-0', limit: 100, heartbeat: 5000, seq_interval: 100, include_docs: false})
        .reply(200, { results: [], last_seq: '1-0', pending: 0 })
        .get(changeURL)
        .query({feed: 'longpoll', timeout: 60000, since: '1-0', limit: 100, heartbeat: 5000, seq_interval: 100, include_docs: false})
        .reply(200, { results: [change], last_seq: '2-0', pending: 0 })
        .get(changeURL)
        .delay(2000)
        .reply(500);
      var cloudant = Cloudant({ account: ME });
      var db = cloudant.db.use(DBNAME);
      var cr = db.changesReader.start();
      cr.on('change', function(c) {
        // ensure we get a change on the third poll
        assert.deepEqual(c, change);
        db.changesReader.stop();
        done();
      });
    });
  });

  describe('parameters', function() {
    it('batchSize', function(done) {
      var changeURL = `/${DBNAME}/_changes`;
      var limit = 44;
      nock(SERVER)
        .get(changeURL)
        .query({feed: 'longpoll', timeout: 60000, since: 'now', limit: limit, heartbeat: 5000, seq_interval: limit, include_docs: false})
        .reply(200, { results: [], last_seq: '1-0', pending: 0 })
        .get(changeURL)
        .delay(2000)
        .reply(500);
      var cloudant = Cloudant({ account: ME });
      var db = cloudant.db.use(DBNAME);
      var cr = db.changesReader.start({batchSize: limit});
      cr.on('seq', function(seq) {
        // after our initial call with since=now, we should get a reply with last_seq=0-1
        assert.equal(seq, '1-0');
        db.changesReader.stop();
        done();
      });
    });

    it('since', function(done) {
      var changeURL = `/${DBNAME}/_changes`;
      var limit = 44;
      var since = 'thedawnoftime';
      nock(SERVER)
        .get(changeURL)
        .query({feed: 'longpoll', timeout: 60000, since: since, limit: limit, heartbeat: 5000, seq_interval: limit, include_docs: false})
        .reply(200, { results: [], last_seq: '1-0', pending: 0 })
        .get(changeURL)
        .delay(2000)
        .reply(500);
      var cloudant = Cloudant({ account: ME });
      var db = cloudant.db.use(DBNAME);
      var cr = db.changesReader.start({batchSize: limit, since: since});
      cr.on('seq', function(seq) {
        // after our initial call with since=now, we should get a reply with last_seq=0-1
        assert.equal(seq, '1-0');
        db.changesReader.stop();
        done();
      });
    });

    it('include_docs', function(done) {
      var changeURL = `/${DBNAME}/_changes`;
      var limit = 44;
      var since = 'thedawnoftime';
      var id = true;
      nock(SERVER)
        .get(changeURL)
        .query({feed: 'longpoll', timeout: 60000, since: since, limit: limit, heartbeat: 5000, seq_interval: limit, include_docs: id})
        .reply(200, { results: [], last_seq: '1-0', pending: 0 })
        .get(changeURL)
        .delay(2000)
        .reply(500);
      var cloudant = Cloudant({ account: ME });
      var db = cloudant.db.use(DBNAME);
      var cr = db.changesReader.start({batchSize: limit, since: since, include_docs: id});
      cr.on('seq', function(seq) {
        // after our initial call with since=now, we should get a reply with last_seq=0-1
        assert.equal(seq, '1-0');
        db.changesReader.stop();
        done();
      });
    });
  });

  describe('maxChanges', function() {
    it('setting maxChanges affects limit', function(done) {
      var changeURL = `/${DBNAME}/_changes`;
      var since = 'thedawnoftime';
      var id = true;
      var maxChanges = 22;
      var batchSize = 45;
      nock(SERVER)
        .get(changeURL)
        .query({feed: 'longpoll', timeout: 60000, since: since, limit: maxChanges, heartbeat: 5000, seq_interval: batchSize, include_docs: id})
        .reply(200, { results: [], last_seq: '1-0', pending: 0 })
        .get(changeURL)
        .delay(2000)
        .reply(500);
      var cloudant = Cloudant({ account: ME });
      var db = cloudant.db.use(DBNAME);
      var cr = db.changesReader.start({batchSize: batchSize, maxChanges: maxChanges, limit: batchSize, since: since, include_docs: id});
      cr.on('seq', function(seq) {
        // after our initial call with since=now, we should get a reply with last_seq=0-1
        assert.equal(seq, '1-0');
        db.changesReader.stop();
        done();
      });
    });

    it('maxChanges across multiple batches', function(done) {
      var changeURL = `/${DBNAME}/_changes`;
      var since = 'now';
      var id = true;
      var maxChanges = 22;
      var batchSize = 45;
      var batch1 = [];
      var batch2 = [];
      for (var i = 0; i < 20; i++) {
        batch1.push({seq: null, id: 'a' + i, changes: ['1-1']});
      }
      batch2.push({seq: null, id: 'b0', changes: ['1-1']});
      batch2.push({seq: null, id: 'b1', changes: ['1-1']});
      nock(SERVER)
        .get(changeURL)
        .query({feed: 'longpoll', timeout: 60000, since: since, limit: maxChanges, heartbeat: 5000, seq_interval: batchSize, include_docs: id})
        .reply(200, { results: batch1, last_seq: '20-0', pending: 0 })
        .get(changeURL)
        .query({feed: 'longpoll', timeout: 60000, since: '20-0', limit: 2, heartbeat: 5000, seq_interval: batchSize, include_docs: id})
        .reply(200, { results: batch2, last_seq: '22-0', pending: 0 })
        .get(changeURL)
        .delay(2000)
        .reply(500);
      var cloudant = Cloudant({ account: ME });
      var db = cloudant.db.use(DBNAME);
      var cr = db.changesReader.start({batchSize: batchSize, maxChanges: maxChanges, limit: batchSize, since: since, include_docs: id});
      var batchCount = 0;
      cr.on('seq', function(seq) {
        if (batchCount === 0) {
          assert.equal(seq, '20-0');
          batchCount++;
        } else {
          db.changesReader.stop();
          assert.equal(seq, '22-0');
          done();
        }
      });
    });
  });

  describe('survival', function() {
    it('survives 500', function(done) {
      var changeURL = `/${DBNAME}/_changes`;
      var change = {seq: null, id: 'a', changes: ['1-1']};
      nock(SERVER)
        .get(changeURL)
        .query({feed: 'longpoll', timeout: 60000, since: 'now', limit: 100, heartbeat: 5000, seq_interval: 100, include_docs: false})
        .reply(200, { results: [], last_seq: '1-0', pending: 0 })
        .get(changeURL)
        .query({feed: 'longpoll', timeout: 60000, since: '1-0', limit: 100, heartbeat: 5000, seq_interval: 100, include_docs: false})
        .reply(500)
        .get(changeURL)
        .query({feed: 'longpoll', timeout: 60000, since: '1-0', limit: 100, heartbeat: 5000, seq_interval: 100, include_docs: false})
        .reply(200, { results: [change], last_seq: '2-0', pending: 0 })
        .get(changeURL)
        .delay(2000)
        .reply(500);
      var cloudant = Cloudant({ account: ME });
      var db = cloudant.db.use(DBNAME);
      var cr = db.changesReader.start();
      cr.on('change', function(c) {
        // ensure we get a change on the third poll
        assert.deepEqual(c, change);
        db.changesReader.stop();
        done();
      }).on('error', function(err) {
        assert.equal(err.statusCode, 500);
      });
    });

    it('survives 429', function(done) {
      var changeURL = `/${DBNAME}/_changes`;
      var change = {seq: null, id: 'a', changes: ['1-1']};
      nock(SERVER)
        .get(changeURL)
        .query({feed: 'longpoll', timeout: 60000, since: 'now', limit: 100, heartbeat: 5000, seq_interval: 100, include_docs: false})
        .reply(200, { results: [], last_seq: '1-0', pending: 0 })
        .get(changeURL)
        .query({feed: 'longpoll', timeout: 60000, since: '1-0', limit: 100, heartbeat: 5000, seq_interval: 100, include_docs: false})
        .reply(429, {error: 'too_many_requests', reason: 'You\'ve exceeded your current limit of x requests per second for x class. Please try later.', class: 'x', rate: 1})
        .get(changeURL)
        .query({feed: 'longpoll', timeout: 60000, since: '1-0', limit: 100, heartbeat: 5000, seq_interval: 100, include_docs: false})
        .reply(200, { results: [change], last_seq: '2-0', pending: 0 })
        .get(changeURL)
        .delay(2000)
        .reply(500);
      var cloudant = Cloudant({ account: ME });
      var db = cloudant.db.use(DBNAME);
      var cr = db.changesReader.start();
      cr.on('change', function(c) {
        // ensure we get a change on the third poll
        assert.deepEqual(c, change);
        db.changesReader.stop();
        done();
      }).on('error', function(err) {
        assert.equal(err.statusCode, 429);
      });
    });

    it('survives malformed JSON', function(done) {
      var changeURL = `/${DBNAME}/_changes`;
      var change = {seq: null, id: 'a', changes: ['1-1']};
      nock(SERVER)
        .get(changeURL)
        .query({feed: 'longpoll', timeout: 60000, since: 'now', limit: 100, heartbeat: 5000, seq_interval: 100, include_docs: false})
        .reply(200, '{ results: [], last_seq: "1-0", pending: 0') // missing bracket } - malformed JSON
        .get(changeURL)
        .query({feed: 'longpoll', timeout: 60000, since: 'now', limit: 100, heartbeat: 5000, seq_interval: 100, include_docs: false})
        .reply(200, { results: [change], last_seq: '1-0', pending: 0 })
        .get(changeURL)
        .delay(2000)
        .reply(500);
      var cloudant = Cloudant({ account: ME });
      var db = cloudant.db.use(DBNAME);
      var cr = db.changesReader.start();
      cr.on('change', function(c) {
        assert.deepEqual(c, change);
        db.changesReader.stop();
        done();
      }).on('error', function(err) {
      });
    });

    it('survives zombie apocolypse', function(done) {
      done();
    });
  });
});

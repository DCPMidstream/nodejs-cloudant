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
'use strict';

var EventEmitter = require('events').EventEmitter;
var async = require('async');

/**
 * Monitors the changes feed (after calling .start()) and emits events
 *  - 'change' - per change
 *  - 'batch' - per batch of changes
 *  - 'seq' - per change of sequence number
 *  - 'error' - per 4xx error (except 429)
 *
 * @param {String} db - Name of the database.
 * @param {Object} request - The HTTP request object.
 */
class ChangesReader {
  // constructor
  constructor(db, request) {
    this.db = db;
    this.request = request;
    this.setDefaults();
  }

  // set defaults
  setDefaults() {
    this.ee = new EventEmitter();
    this.batchSize = 100;
    this.since = 'now';
    this.include_docs = false;
    this.timeout = 60000;
    this.heartbeat = 5000;
    this.started = false;
    this.maxChanges = 0; // indefinite
    this.numChanges = 0; // count the number of changes we have handled
  }

  // called to start listening to the changes feed. The opts object can contain:
  // - batchSize - the number of records to return per HTTP request
  // - since - the the sequence token to start from (defaults to 'now')
  // - include_docs - if true, returns document bodies too
  start(opts) {
    var self = this;

    // if we're already listening for changes
    if (self.started) {
      // return the existing event emitter
      return self.ee;
    }
    self.started = true;

    // handle overidden defaults
    opts = opts || {};
    if (opts.batchSize) {
      self.batchSize = opts.batchSize;
    }
    if (opts.since) {
      self.since = opts.since;
    }
    if (opts.include_docs) {
      self.include_docs = opts.include_docs;
    }
    if (opts.maxChanges) {
      self.maxChanges = opts.maxChanges;
    }

    // monitor the changes feed forever
    async.doWhilst(function(next) {
      // calculate this batchsize. Usually it's 'batchSize', but if
      // we have a maxChanges limit, we don't want to fetch too
      // many changes in the last batch
      var limit = self.batchSize;
      if (self.maxChanges) {
        limit = Math.min(self.batchSize, self.maxChanges - self.numChanges);
      }

      // formulate changes feed longpoll HTTP request
      var req = {
        method: 'get',
        path: encodeURIComponent(self.db) + '/_changes',
        qs: {
          feed: 'longpoll',
          timeout: self.timeout,
          since: self.since,
          limit: limit,
          heartbeat: self.heartbeat,
          seq_interval: self.batchSize,
          include_docs: self.include_docs
        }
      };

      // make HTTP request to get up to batchSize changes from the feed
      self.request(req, function(err, data) {
        // if there was no error
        if (!err && data) {
          // and we have some results
          if (data.results && data.results.length > 0) {
            // emit 'change' events
            for (var i in data.results) {
              self.ee.emit('change', data.results[i]);
            }

            // emit 'batch' event
            self.ee.emit('batch', data.results);

            // increment counter
            self.numChanges += data.results.length;
          }

          // update the since state
          if (data.last_seq && data.last_seq !== self.since) {
            self.since = data.last_seq;
            self.ee.emit('seq', self.since);
          }
          next();
        } else {
          // error (wrong password, bad since value etc)
          self.ee.emit('error', err);
          if (err.statusCode && err.statusCode >= 400 && err.statusCode !== 429) {
            return next(err.reason);
          }
        }
      });
    },

    // function that decides if the doWhilst loop will continue to repeat
    function() {
      // continue if we're in indefinte mode or we haven't met or changes quota yet
      if (self.maxChanges === 0 || self.numChanges < self.maxChanges) {
        return true;
      }
      return false;
    },
    function() {
      // reset
      self.setDefaults();
    });

    // return the event emitter to the caller
    return self.ee;
  }
}

module.exports = ChangesReader;

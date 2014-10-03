/**
 * @todo: recursively send requests until all contacts are fetched
 *
 * @see https://developers.google.com/google-apps/contacts/v3/reference#ContactsFeed
 *
 * To API test requests: 
 *
 * @see https://developers.google.com/oauthplayground/
 *
 * To format JSON nicely:
 *
 * @see http://jsonviewer.stack.hu/
 *
 * Note: The Contacts API has a hard limit to the number of results it can return at a 
 * time even if you explicitly request all possible results. If the requested feed has 
 * more fields than can be returned in a single response, the API truncates the feed and adds 
 * a "Next" link that allows you to request the rest of the response.
 */
var EventEmitter = require('events').EventEmitter,
  qs = require('querystring'),
  util = require('util'),
  url = require('url'),
  https = require('https'),
  _ = require('lodash');

var GoogleContacts = function (opts) {
  if (typeof opts === 'string') {
    opts = { token: opts }
  }
  if (!opts) {
    opts = {};
  }

  this.contacts = [];
  this.consumerKey = opts.consumerKey ? opts.consumerKey : null;
  this.consumerSecret = opts.consumerSecret ? opts.consumerSecret : null;
  this.token = opts.token ? opts.token : null;
  this.refreshToken = opts.refreshToken ? opts.refreshToken : null;
};

GoogleContacts.prototype = {};

util.inherits(GoogleContacts, EventEmitter);


GoogleContacts.prototype._get = function (params, cb) {
  var self = this;


  if (typeof params === 'function') {
    cb = params;
    params = {};
  }

  var req = {
    host: 'www.google.com',
    port: 443,
    path: this._buildPath(params),
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + this.token 
    }
  };

  https.request(req, function (res) {
    var data = '';



    res.on('end', function () {

      if (res.statusCode < 200 || res.statusCode >= 300) {
        var error = new Error('Bad client request status: ' + res.statusCode);
        return cb(error);
      }
      try {
        data = JSON.parse(data);
        cb(null, data);
      }
      catch (err) {
        cb(err);
      }
    });

    res.on('data', function (chunk) {
      data += chunk;
    });

    res.on('error', function (err) {
      cb(err);
    });

    //res.on('close', onFinish);
  }).on('error', function (err) {
    cb(err);
  }).end();
};

GoogleContacts.prototype.getContacts = function (cb, params, contacts) {
  var self = this;

  if (Array.isArray(params)) { contacts = params; params = {} }

  this._get(params, receivedContacts);
  function receivedContacts(err, data) {
    if (err) return cb(err);

    self._saveContactsFromFeed(data.feed);

    var next = false;
    data.feed.link.forEach(function (link) {
      if (link.rel === 'next') {
        next = true;
        var path = url.parse(link.href).path;
        self._get({ path: path }, receivedContacts);
      }
    });
    if (!next) {
      cb(null, self.contacts);
    }
  };
};

GoogleContacts.prototype._saveContactsFromFeed = function (feed) {
  var self = this;
  feed.entry.forEach(function (entry) {

    try {
      var name = entry.title['$t'];
      var email = entry['gd$email'][0].address; // only save first email
      self.contacts.push({ name: name, email: email });
    }
    catch (e) {
      // property not available...
    }
  });
}

GoogleContacts.prototype._buildPath = function (params) {

  params = _.defaults(params, {
    type: 'contacts',
    alt : 'json',
    projection: 'thin',
    email : 'default',
    'max-results' : 2000
  });

  if (params.path) return params.path;

  var query = {
    alt: params.alt,
    'max-results': params['max-results']
  };

  var path = '/m8/feeds/';
  path += params.type + '/';
  path += params.email + '/'; 
  path += params.projection;
  path += '?' + qs.stringify(query);

  return path;
};

GoogleContacts.prototype.refreshAccessToken = function (refreshToken, cb) {
  if (typeof params === 'function') {
    cb = params;
    params = {};
  }

  var data = {
    refresh_token: refreshToken,
    client_id: this.consumerKey,
    client_secret: this.consumerSecret,
    grant_type: 'refresh_token'

  }

  var body = qs.stringify(data);

  var opts = {
    host: 'accounts.google.com',
    port: 443,
    path: '/o/oauth2/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': body.length
    }
  };


  var req = https.request(opts, function (res) {
    var data = '';
    res.on('end', function () {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        var error = new Error('Bad client request status: ' + res.statusCode);
        return cb(error);
      }
      try {
        data = JSON.parse(data);
        cb(null, data.access_token);
      }
      catch (err) {
        cb(err);
      }
    });

    res.on('data', function (chunk) {
      data += chunk;
    });

    res.on('error', function (err) {
      cb(err);
    });

    //res.on('close', onFinish);
  }).on('error', function (err) {
    cb(err);
  });

  req.write(body);
  req.end();
}

exports.GoogleContacts = GoogleContacts;

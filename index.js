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

  }).on('error', function (err) {
    cb(err);
  }).end();
};

GoogleContacts.prototype.getContacts = function (params, cb, contacts) {
  var self = this;

  if (typeof params == "function") { cb = params; params = {}; }

  this._get(params, receivedContacts);
  function receivedContacts(err, data) {
    if (err) return cb(err);

    self._saveContactsFromFeed(data.feed, params);

    var next = false;
    data.feed.link.forEach(function (link) {
      if (link.rel === 'next') {
        next = true;
        var path = url.parse(link.href).path;
        self._get(_.extend(params, { path: path }), receivedContacts);
      }
    });
    if (!next) {
      cb(null, self.contacts);
    }
  };
};


// grab a property off an entry
function val(entry, name, attr, delimiter) {
  if (!entry[name]) return;
  if (!Array.isArray(entry[name])) {
    return entry[name][attr];
  } else if (delimiter) {
    return entry[name].map(function(item) {
      return {
        label : item.rel ? item.rel.split(delimiter)[1] : "default",
        field : item[attr]
      }
    });
  } else {
    return entry[name][0][attr];
  }
}


var processors = {
  'thin' : function(contacts) { return function(entry) {
    contacts.push({ 
      name : val(entry, 'title', '$t'),
      email : val(entry, 'gd$email', 'address')
    });
  } },
  'full' : function(contacts) { return function(entry) {
    contacts.push({ 
      name : val(entry, 'title', '$t'),
      email : val(entry, 'gd$email', 'address'),
      phones: val(entry, 'gd$phoneNumber', '$t', '#')
    });
  } },
  'custom': function(contacts, projection) {

    // pull apart the properties
    var props = projection.split(',').map(function(prop) { 
      return prop.replace('property-', ''); 
    });

    // always include name
    props.unshift("name");

    // https://developers.google.com/google-apps/contacts/v3/reference#ProjectionsAndExtended

    // a map of property names to places on the contact
    var prop_names = {
      "name" : "title",
      "email" : "gd$email",
      "phoneNumber": "gd$phoneNumber",
      "postalAddress": "gd$postalAddress",
    }

    var prop_attr = {
      "name" : "$t",
      "email" : "address",
      "phoneNumber" : "$t",
      "postalAddress" : "$t",
    }

    // generating a collection of functions
    var objector = { };
    _.each(props, function(prop) {
      objector[prop] = _.partialRight(val, prop_names[prop], prop_attr[prop]);
    });

    return function(entry) {
      var obj = {};
      _.each(props, function(prop) {
        obj[prop] = objector[prop](entry);
      });
      contacts.push(obj);
    } 
  }
}



GoogleContacts.prototype._saveContactsFromFeed = function (feed, params) {
  var self = this;

  // detect which type of projection is being used
  var processor;

  // dynamic detection of processor type
  if (processors[params.projection]) {
    processor = processors[params.projection](self.contacts)
  } else {
    processor = processors.custom(self.contacts, params.projection);
  }

  // run the processor over each entry
  feed.entry.forEach(processor);
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

module.exports = GoogleContacts;

/*
# ***** BEGIN LICENSE BLOCK *****
# Version: MPL 1.1/GPL 2.0/LGPL 2.1
#
# The contents of this file are subject to the Mozilla Public License Version
# 1.1 (the "License"); you may not use this file except in compliance with
# the License. You may obtain a copy of the License at
# http://www.mozilla.org/MPL/
#
# Software distributed under the License is distributed on an "AS IS" basis,
# WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
# for the specific language governing rights and limitations under the
# License.
#
# The Original Code is TwitterXUL.
#
# The Initial Developer of the Original Code is
# Dave Townsend <dtownsend@oxymoronical.com>.
# Portions created by the Initial Developer are Copyright (C) 2009
# the Initial Developer. All Rights Reserved.
#
# Contributor(s):
#
# Alternatively, the contents of this file may be used under the terms of
# either the GNU General Public License Version 2 or later (the "GPL"), or
# the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
# in which case the provisions of the GPL or the LGPL are applicable instead
# of those above. If you wish to allow use of your version of this file only
# under the terms of either the GPL or the LGPL, and not to allow others to
# use your version of this file under the terms of the MPL, indicate your
# decision by deleting the provisions above and replace them with the notice
# and other provisions required by the GPL or the LGPL. If you do not delete
# the provisions above, a recipient may use your version of this file under
# the terms of any one of the MPL, the GPL or the LGPL.
#
# ***** END LICENSE BLOCK *****
*/

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

const TWITTER = "https://twitter.com";
const TIMEOUT = 2 * 60 * 1000;

function ERROR(str) {
  Components.utils.reportError(str);
  LOG(str);
}

function LOG(str) {
  dump("Twitter.jsm: " + str + "\n");
}

var EXPORTED_SYMBOLS = [ "Twitter" ];

// Protects a call to an unknown function
function safecall(callback) {
  if (!callback)
    return;

  try {
    callback.apply(null, Array.splice(arguments, 1));
  }
  catch (e) {
    ERROR("Error calling callback " + e);
  }
}

function buildURL(url, args) {
  if (!args)
    return url;

  var query = "";
  for (var key in args) {
    query += "&" + key + "=" + encodeURIComponent(args[key]);
  }
  if (query.length == 0)
    return url;
  return url + "?" + query.substring(1);
}

function unescapeText(text) {
  text = text.replace("&lt;", "<", "g");
  return text.replace("&gt;", ">", "g");
}

function escapeText(text) {
  text = text.replace("<", "&lt;", "g");
  return text.replace(">", "&gt;", "g");
}

// The Authenticator deals with responding to authentication requests from the
// Twitter request. It should be set as the notificationCallbacks on the channel.
function Authenticator(username, password) {
  this.username = username;
  this.password = password;
  this.count = 0;
}

Authenticator.prototype = {
  username: null,
  password: null,
  count: null,

  // nsIAuthPrompt implementation
  prompt: function(dialogTitle, text, passwordRealm, savePasword, defaultText,
                   result) {
    return false;
  },

  promptPassword: function(dialogTitle, text, passwordRealm, savePasword,
                           password) {
    return false;
  },

  promptUsernameAndPassword: function(dialogTitle, text, passwordRealm,
                                      savePasword, username, password) {
    this.count++;
    if (this.count > 1)
      return false;
    username.value = this.username;
    password.value = this.password;
    return true;
  },

  // nsIAuthPrompt2 implementation
  asyncPromptAuth: function(channel, callback, context, level, authInfo) {
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
  },

  promptAuth: function(channel, level, authInfo) {
    this.count++;
    if (this.count > 1)
      return false;
    authInfo.username = this.username;
    authInfo.password = this.password;
    return true;
  },

  // nsIInterfaceRequestor implementation
  getInterface: function(iid) {
    return this.QueryInterface(iid);
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIAuthPrompt,
                                         Ci.nsIAuthPrompt2,
                                         Ci.nsIInterfaceRequestor])
};

function TimedRequest(username, password, method, url, observer) {
  this.observer = observer;

  LOG("Requesting " + url);
  this.request = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].
                 createInstance(Ci.nsIXMLHttpRequest);
  this.request.open(method, url, true);
  this.request.channel.notificationCallbacks = new Authenticator(username, password);
  var self = this;
  this.request.onerror = function(event) { self.onError() };
  this.request.onload = function(event) { self.onLoad() };
  this.request.send(null);

  this.timer = Cc["@mozilla.org/timer;1"].
               createInstance(Ci.nsITimer);
  this.timer.initWithCallback(this, TIMEOUT, Ci.nsITimer.TYPE_ONE_SHOT);
}

TimedRequest.prototype = {
  request: null,
  timer: null,
  observer: null,

  // Called when the http request completes
  onLoad: function() {
    this.timer.cancel();
    this.timer = null;

    if (this.request.status != 200) {
      var statusText = "Unknown error";
      try {
        statusText = this.request.statusText;
      }
      catch (e) { }
      ERROR("Request failed: " + this.request.status + " " + statusText);
      if ("onError" in this.observer)
        this.observer.onError(this.request, this.request.status, statusText);
      return;
    }
    else if ("onLoad" in this.observer) {
      this.observer.onLoad(this.request);
    }

    this.request = null;
  },

  // Called when the http request fails
  onError: function() {
    if (!this.timer)
      return;

    this.timer.cancel();
    this.timer = null;

    var statusText = "Unknown error";
    try {
      statusText = this.request.statusText;
    }
    catch (e) { }
    ERROR("Request failed: " + this.request.status + " " + statusText);
    if ("onError" in this.observer)
      this.observer.onError(this.request, this.request.status, statusText);
    this.request = null;
  },

  notify: function(timer) {
    this.timer = null;
    this.request.abort();

    ERROR("Request timed out");
    if ("onError" in this.observer)
      this.observer.onError(this.request, 408, "Request Timeout");
    this.request = null;
  }
};

// A twIPerson implementation
function Person(item) {
  if (item)
    this._parse(item);
}

Person.prototype = {
  id: null,
  username: null,
  name: null,
  location: null,
  description: null,
  imageURL: null,
  homeURL: null,

  _parse: function(item) {
    this.id = item.id;
    this.username = item.screen_name;
    this.name = item.name;
    this.location = item.location;
    this.description = item.description;
    this.imageURL = item.profile_image_url;
    this.homeURL = item.url;
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.twIPerson])
}

// A twIMessage implementation
function Status(item) {
  if (item)
    this._parse(item);
}

Status.prototype = {
  id: null,
  created: null,
  author: null,
  text: null,
  source: null,

  toString: function() {
    return "[Status: " + this.toSource() + "]";
  },

  _parse: function(item) {
    this.id = item.id;
    this.created = Date.parse(item.created_at);
    this.text = unescapeText(item.text);
    this.source = item.source;
    if ("user" in item)
      this.author = new Person(item.user);
    else if ("sender" in item)
      this.author = new Person(item.sender);
    else
      ERROR("No author found for item " + item.toSource());
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.twIMessage])
};

// A twIReply implementation
function Reply(item) {
  Status.call(this, item);
}

Reply.prototype = new Status();
Reply.prototype.inReplyTo = null;
Reply.prototype.toString = function() {
  return "[Reply: " + this.toSource() + "]";
};
Reply.prototype._parse = function(item) {
  Status.prototype._parse.call(this, item);
  this.inReplyTo = new Person();
  this.inReplyTo.id = item.in_reply_to_user_id;
  this.inReplyTo.username = item.in_reply_to_screen_name;
};
Reply.prototype.QueryInterface = XPCOMUtils.generateQI([Ci.twIReply,
                                                        Ci.twIMessage]);

// A twIDirectMessage implementation
function DirectMessage(item) {
  Status.call(this, item);
}

DirectMessage.prototype = new Status();
DirectMessage.prototype.recipient = null;
DirectMessage.prototype.toString = function() {
  return "[Direct Message: " + this.toSource() + "]";
};
DirectMessage.prototype._parse = function(item) {
  Status.prototype._parse.call(this, item);
  this.recipient = new Person(item.recipient);
};
DirectMessage.prototype.QueryInterface = XPCOMUtils.generateQI([Ci.twIDirectMessage,
                                                                Ci.twIMessage]);

// Parsers are responsible for parsing the json stream returned from Twitter.
// Then should all extend this abstract implementation and implement parseData.
function Parser(successCallback, errorCallback) {
  this.successCallback = successCallback;
  this.errorCallback = errorCallback;
}

Parser.prototype = {
  successCallback: null,
  errorCallback: null,

  // Should be implemented by specific implementations
  parseData: function(json) {
    ERROR("Should never get here");
  },

  // Called when the http request completes
  onLoad: function(request) {
    try {
      var json = JSON.parse(request.responseText);
      if (json) {
        var items = this.parseData(json);
        if (items) {
          safecall(this.successCallback, items);
        }
        else {
          ERROR("Server returned unparseable data: " + request.responseText);
          safecall(this.errorCallback, 500, "Unexpected data returned from server");
        }
      }
      else {
        ERROR("Server returned bad JSON data: " + request.responseText);
        safecall(this.errorCallback, 500, "Unexpected data returned from server");
      }
    }
    catch (e) {
      ERROR("Failed to parse: " + e);
      safecall(this.errorCallback, 500, e.toString());
    }
  },

  // Called when the http request fails
  onError: function(request, statusCode, statusText) {
    safecall(this.errorCallback, statusCode, statusText);
  },

  // Starts a new request.
  // TODO maybe move this to the constructor?
  startRequest: function(username, password, url) {
    new TimedRequest(username, password, "GET", url, this);
  }
};

// A Parser for regular status updates
function TimelineParser(successCallback, errorCallback) {
  Parser.call(this, successCallback, errorCallback);
}

TimelineParser.prototype = new Parser();
TimelineParser.prototype.parseData = function(items) {
  if (!(items instanceof Array)) {
    ERROR("JSON data wasn't an array");
    throw "Unexpected data returned from server.";
  }

  var results = [];
  items.forEach(function(item) {
    var message = null;
    if (item.in_reply_to_user_id)
      message = new Reply(item);
    else
      message = new Status(item);
    results.push(message);
  });
  return results;
};

// A Parser for direct messages
function DirectMessageParser(successCallback, errorCallback) {
  Parser.call(this, successCallback, errorCallback);
}

DirectMessageParser.prototype = new Parser();
DirectMessageParser.prototype.parseData = function(items) {
  if (!(items instanceof Array)) {
    ERROR("JSON data wasn't an array");
    throw "Unexpected data returned from server.";
  }

  var results = [];
  items.forEach(function(item) {
    var message = new DirectMessage(item);
    results.push(message);
  });
  return results;
};

// A Parser for direct messages
function PersonParser(successCallback, errorCallback) {
  Parser.call(this, successCallback, errorCallback);
}

PersonParser.prototype = new Parser();
PersonParser.prototype.parseData = function(items) {
  if (!(items instanceof Array)) {
    ERROR("JSON data wasn't an array");
    throw "Unexpected data returned from server.";
  }

  var results = [];
  items.forEach(function(item) {
    var person = new Person(item);
    results.push(person);
  });
  return results;
};

// The public interface starts here
var Twitter = {
  /**
   * Gets a TwitterAccount object for a user.
   * @param username
   *        The Twitter username.
   * @param password
   *        The Twitter password.
   */
  getTwitterAccount: function(username, password) {
    return new TwitterAccount(username, password);
  }
};

function TwitterAccount(username, password) {
  this._username = username;
  this._password = password;
}

TwitterAccount.prototype = {
  _username: null,
  _password: null,

  /**
   * Sends a direct message to a specified user.
   * @param successCallback
   *        A callback to call when the request finishes.
   * @param errorCallback
   *        A callback that will be called if the request fails for some reason.
   *        It will be passed a status code and a status message.
   * @param recipient
   *        The username of the user to send to.
   * @param text
   *        The text of the message to send.
   */
  sendDirectMessage: function(successCallback, errorCallback, recipient, text) {
    var args = { user: recipient, text: text };
    var url = buildURL(TWITTER + "/direct_messages/new.json", args);
    new TimedRequest(this._username, this._password, "POST", url, {
      onLoad: function(request) {
        safecall(successCallback);
      },
      onError: function(request, statusCode, statusText) {
        safecall(errorCallback, statusCode, statusText);
      }
    });
  },

  /**
   * Sets the status message for a user.
   * @param successCallback
   *        A callback to call when the request finishes.
   * @param errorCallback
   *        A callback that will be called if the request fails for some reason.
   *        It will be passed a status code and a status message.
   * @param status
   *        The text of the status message.
   * @param replyID
   *        An optional status message that this is the reply to.
   */
  setStatus: function(successCallback, errorCallback, status, replyID) {
    var args = { status: status };
    if (replyID)
      args.in_reply_to_status_id = replyID;
    var url = buildURL(TWITTER + "/statuses/update.json", args);
    new TimedRequest(this._username, this._password, "POST", url, {
      onLoad: function(request) {
        safecall(successCallback);
      },
      onError: function(request, statusCode, statusText) {
        safecall(errorCallback, statusCode, statusText);
      }
    });
  },

  /**
   * Retrieves the direct messages sent by a user.
   * @param successCallback
   *        A callback to call when the request finishes. It will be passed an
   *        array of the twIMessage items retrieved.
   * @param errorCallback
   *        A callback that will be called if the request fails for some reason.
   *        It will be passed a status code and a status message.
   * @param since
   *        Retrieve all messages with an id greater than this. May be null.
   */
  fetchSentDirectMessages: function(successCallback, errorCallback, since) {
    var args = {};
    if (since)
      args.since_id = since;
    var url = buildURL(TWITTER + "/direct_messages.json", args);

    var parser = new DirectMessageParser(successCallback, errorCallback);
    parser.startRequest(this._username, this._password, url);
  },

  /**
   * Retrieves the direct messages received by a user.
   * @param successCallback
   *        A callback to call when the request finishes. It will be passed an
   *        array of the twIMessage items retrieved.
   * @param errorCallback
   *        A callback that will be called if the request fails for some reason.
   *        It will be passed a status code and a status message.
   * @param since
   *        Retrieve all messages with an id greater than this. May be null.
   */
  fetchReceivedDirectMessages: function(successCallback, errorCallback, since) {
    var args = {};
    if (since)
      args.since_id = since;
    var url = buildURL(TWITTER + "/direct_messages/sent.json", args);

    var parser = new DirectMessageParser(successCallback, errorCallback);
    parser.startRequest(this._username, this._password, url);
  },

  /**
   * Retrieves a list of users who are following a user.
   * @param successCallback
   *        A callback to call when the request finishes. It will be passed an
   *        array of the twIPerson followers.
   * @param errorCallback
   *        A callback that will be called if the request fails for some reason.
   *        It will be passed a status code and a status message.
   */
  fetchFollowers: function(successCallback, errorCallback) {
    var url = buildURL(TWITTER + "/statuses/followers.json");

    var parser = new PersonParser(successCallback, errorCallback);
    parser.startRequest(this._username, this._password, url);
  },

  /**
   * Retrieves a list of a user's friends.
   * @param successCallback
   *        A callback to call when the request finishes. It will be passed an
   *        array of the twIPerson friends.
   * @param errorCallback
   *        A callback that will be called if the request fails for some reason.
   *        It will be passed a status code and a status message.
   */
  fetchFriends: function(successCallback, errorCallback) {
    var url = buildURL(TWITTER + "/statuses/friends.json");

    var parser = new PersonParser(successCallback, errorCallback);
    parser.startRequest(this._username, this._password, url);
  },

  /**
   * Retrieves replies to the user.
   * @param successCallback
   *        A callback to call when the request finishes. It will be passed an
   *        array of the twIMessage items retrieved.
   * @param errorCallback
   *        A callback that will be called if the request fails for some reason.
   *        It will be passed a status code and a status message.
   * @param since
   *        Retrieve all messages with an id greater than this. May be null.
   */
  fetchReplies: function(successCallback, errorCallback, since) {
    var args = {};
    if (since)
      args.since_id = since;
    var url = buildURL(TWITTER + "/statuses/replies.json", args);

    var parser = new TimelineParser(successCallback, errorCallback);
    parser.startRequest(this._username, this._password, url);
  },

  /**
   * Retrieves the status messages set by a user.
   * @param successCallback
   *        A callback to call when the request finishes. It will be passed an
   *        array of the twIMessage items retrieved.
   * @param errorCallback
   *        A callback that will be called if the request fails for some reason.
   *        It will be passed a status code and a status message.
   * @param since
   *        Retrieve all messages with an id greater than this. May be null.
   * @param count
   *        The number of messages to retrieve. May be null.
   */
  fetchUserTimeline: function(successCallback, errorCallback, since, count) {
    var args = {};
    if (since)
      args.since_id = since;
    if (count)
      args.count = count;
    var url = buildURL(TWITTER + "/statuses/user_timeline.json", args);

    var parser = new TimelineParser(successCallback, errorCallback);
    parser.startRequest(this._username, this._password, url);
  },

  /**
   * Retrieves the status messages set by a user and the users they follow.
   * @param successCallback
   *        A callback to call when the request finishes. It will be passed an
   *        array of the twIMessage items retrieved.
   * @param errorCallback
   *        A callback that will be called if the request fails for some reason.
   *        It will be passed a status code and a status message.
   * @param since
   *        Retrieve all messages with an id greater than this. May be null.
   * @param count
   *        The number of messages to retrieve. May be null.
   */
  fetchFriendsTimeline: function(successCallback, errorCallback, since, count) {
    var args = {};
    if (since)
      args.since_id = since;
    if (count)
      args.count = count;
    var url = buildURL(TWITTER + "/statuses/friends_timeline.json", args);

    var parser = new TimelineParser(successCallback, errorCallback);
    parser.startRequest(this._username, this._password, url);
  }
};

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

function LOG(str) {
  dump("Twitter.jsm: " + str + "\n");
}

var EXPORTED_SYMBOLS = [ "Twitter" ];

// Protects a call to an unknown function
function safecall(callback) {
  try {
    callback.apply(null, Array.splice(arguments, 1));
  }
  catch (e) {
    LOG("Error calling callback " + e);
  }
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

// A twIPerson implementation
function Person() {
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
function Status() {
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
    this.text = item.text;
    this.source = item.source;
    if ("user" in item) {
      this.author = new Person();
      this.author._parse(item.user);
    }
    else if ("sender" in item) {
      this.author = new Person();
      this.author._parse(item.sender);
    }
    else {
      LOG("No author found for item " + item.toSource());
    }
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.twIMessage])
};

// A twIReply implementation
function Reply() {
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
function DirectMessage() {
}

DirectMessage.prototype = new Status();
DirectMessage.prototype.recipient = null;
DirectMessage.prototype.toString = function() {
  return "[Direct Message: " + this.toSource() + "]";
};
DirectMessage.prototype._parse = function(item) {
  Status.prototype._parse.call(this, item);
  this.recipient = new Person();
  this.recipient._parse(item.recipient);
};
DirectMessage.prototype.QueryInterface = XPCOMUtils.generateQI([Ci.twIDirectMessage,
                                                                Ci.twIMessage]);

// Parsers are responsible for parsing the json stream returned from Twitter.
// Then should all extend this abstract implementation and implement parseData.
function Parser(callback) {
  this.callback = callback;
}

Parser.prototype = {
  callback: null,

  // Should be implemented by specific implementations
  parseData: function(json) {
    LOG("Should never get here");
  },

  // Called when the http request completes
  onLoad: function(event) {
    var request = event.target;
    if (request.status != 200) {
      LOG("Request failed: " + request.statusText);
      safecall(this.callback, null, request.statusText);
      return;
    }

    try {
      var json = JSON.parse(request.responseText);
      if (json) {
        var items = this.parseData(json);
        if (items) {
          safecall(this.callback, items, null);
        }
        else {
          LOG("Server returned unparseable data: " + request.responseText);
          safecall(this.callback, null, "Unexpected data returned from server.");
        }
      }
      else {
        LOG("Server returned bad JSON data: " + request.responseText);
        safecall(this.callback, null, "Unexpected data returned from server.");
      }
    }
    catch (e) {
      LOG("Failed to parse: " + e);
      safecall(this.callback, null, e.toString());
    }
  },

  // Called when the http request fails
  onError: function(event) {
    LOG("Request failed: " + event.target.statusText);
    safecall(this.callback, null, event.target.statusText);
  },

  // Starts a new request.
  // TODO maybe move this to the constructor?
  startRequest: function(username, password, url) {
    LOG("Requesting " + url);
    var request = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].
                  createInstance(Ci.nsIXMLHttpRequest);
    request.open("GET", url, true);
    request.channel.notificationCallbacks = new Authenticator(username, password);
    var self = this;
    request.onerror = function(event) { self.onError(event) };
    request.onload = function(event) { self.onLoad(event) };
    request.send(null);
  }
};

// A Parser for regular status updates
function TimelineParser(callback) {
  Parser.call(this, callback);
}

TimelineParser.prototype = new Parser();
TimelineParser.prototype.parseData = function(items) {
  if (!(items instanceof Array)) {
    LOG("JSON data wasn't an array");
    throw "Unexpected data returned from server.";
  }

  var results = [];
  items.forEach(function(item) {
    var message = null;
    if (item.in_reply_to_user_id)
      message = new Reply();
    else
      message = new Status();
    message._parse(item);
    results.push(message);
  });
  return results;
};

// A Parser for direct messages
function DirectMessageParser(callback) {
  Parser.call(this, callback);
}

DirectMessageParser.prototype = new Parser();
DirectMessageParser.prototype.parseData = function(items) {
  if (!(items instanceof Array)) {
    LOG("JSON data wasn't an array");
    throw "Unexpected data returned from server.";
  }

  var results = [];
  items.forEach(function(item) {
    var message = new DirectMessage();
    message._parse(item);
    results.push(message);
  });
  return results;
};

// The public interface starts here
var Twitter = {
  /**
   * Sends a direct message to a specified user.
   * @param username
   *        The Twitter username to send from.
   * @param password
   *        The password of the user to send from.
   * @param recipient
   *        The username of the user to send to.
   * @param text
   *        The text of the message to send.
   */
  sendDirectMessage: function(username, password, recipient, text) {
    var url = "http://twitter.com/direct_messages/new.json?user=" + recipient + "&text=" + encodeURIComponent(text);
    LOG("Requesting " + url);
    var request = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].
                  createInstance(Ci.nsIXMLHttpRequest);
    request.open("POST", url, true);
    request.channel.notificationCallbacks = new Authenticator(username, password);
    request.onload = function(event) {
      if (event.target.status != 200)
        LOG("Request failed: " + event.target.statusText);
    };
    request.onerror = function(event) {
      LOG("Request failed: " + event.target.statusText);
    };
    request.send(null);
  },

  /**
   * Sets the status message for a user.
   * @param username
   *        The Twitter username to set the status of.
   * @param password
   *        The password of the user to set the status of.
   * @param status
   *        The text of the status message.
   */
  setStatus: function(username, password, status) {
    var url = "http://twitter.com/statuses/update.json?status=" + encodeURIComponent(status);
    LOG("Requesting " + url);
    var request = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].
                  createInstance(Ci.nsIXMLHttpRequest);
    request.open("POST", url, true);
    request.channel.notificationCallbacks = new Authenticator(username, password);
    request.onload = function(event) {
      if (event.target.status != 200)
        LOG("Request failed: " + event.target.statusText);
    };
    request.onerror = function(event) {
      LOG("Request failed: " + event.target.statusText);
    };
    request.send(null);
  },

  /**
   * Retrieves the direct messages sent by a user.
   * @param username
   *        The Twitter username to get the messages for.
   * @param password
   *        The password of the user.
   * @param callback
   *        A callback to call when the request finishes. It should expect two
   *        arguments. The first is an array of the twIMessage items retrieved.
   *        The second is any error that occured during the request. Only
   *        one of the arguments will be non-null.
   * @param since
   *        Retrieve all messages with an id greater than this. May be null.
   */
  fetchSentDirectMessages: function(username, password, callback, since) {
    var url = "http://twitter.com/direct_messages.json";
    if (since)
      url += "?since_id=" + since;

    var parser = new DirectMessageParser(callback);
    parser.startRequest(username, password, url);
  },

  /**
   * Retrieves the direct messages received by a user.
   * @param username
   *        The Twitter username to get the messages for.
   * @param password
   *        The password of the user.
   * @param callback
   *        A callback to call when the request finishes. It should expect two
   *        arguments. The first is an array of the twIMessage items retrieved.
   *        The second is any error that occured during the request. Only
   *        one of the arguments will be non-null.
   * @param since
   *        Retrieve all messages with an id greater than this. May be null.
   */
  fetchReceivedDirectMessages: function(username, password, callback, since) {
    var url = "http://twitter.com/direct_messages/sent.json";
    if (since)
      url += "?since_id=" + since;

    var parser = new DirectMessageParser(callback);
    parser.startRequest(username, password, url);
  },

  /**
   * Retrieves the status messages set by a user.
   * @param username
   *        The Twitter username to get the messages for.
   * @param password
   *        The password of the user.
   * @param callback
   *        A callback to call when the request finishes. It should expect two
   *        arguments. The first is an array of the twIMessage items retrieved.
   *        The second is any error that occured during the request. Only
   *        one of the arguments will be non-null.
   * @param since
   *        Retrieve all messages with an id greater than this. May be null.
   */
  fetchUserTimeline: function(username, password, callback, since) {
    var url = "http://twitter.com/statuses/user_timeline.json";
    if (since)
      url += "?since_id=" + since;

    var parser = new TimelineParser(callback);
    parser.startRequest(username, password, url);
  },

  /**
   * Retrieves the status messages set by a user and the users they follow.
   * @param username
   *        The Twitter username to get the messages for.
   * @param password
   *        The password of the user.
   * @param callback
   *        A callback to call when the request finishes. It should expect two
   *        arguments. The first is an array of the twIMessage items retrieved.
   *        The second is any error that occured during the request. Only
   *        one of the arguments will be non-null.
   * @param since
   *        Retrieve all messages with an id greater than this. May be null.
   */
  fetchFriendsTimeline: function(username, password, callback, since) {
    var url = "http://twitter.com/statuses/friends_timeline.json";
    if (since)
      url += "?since_id=" + since;

    var parser = new TimelineParser(callback);
    parser.startRequest(username, password, url);
  }
};

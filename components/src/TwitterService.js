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
Components.utils.import("resource:///modules/Twitter.jsm");

// Message types
const TYPE_STATUS = 0;
const TYPE_REPLY = 1;
const TYPE_DIRECT = 2;

// Person types
const TYPE_USER = 0;
const TYPE_FRIEND = 1;  // This is not really friend, just not the current user

function LOG(str) {
  dump("TwitterService.js: " + str + "\n");
}

function TwitterService() {
  this.listeners = [];
}

TwitterService.prototype = {
  // The db connection
  db: null,
  // The current username
  user: null,
  // The current password
  pass: null,
  // The refreshrate in seconds
  refreshRate: null,
  // An XPCOM timer used to trigger refreshes
  timer: null,
  // The current number of Twitter requests waiting to be heard back from
  opCount: null,
  // The status of the currently running updates
  updateStatus: null,
  // An array of items added during the current refresh
  addedItems: null,
  // The registered update listeners
  listeners: null,

  startup: function() {
    this.timer = Cc["@mozilla.org/timer;1"].
                 createInstance(Ci.nsITimer);

    this.prefs = Cc["@mozilla.org/preferences-service;1"].
                 getService(Ci.nsIPrefService).
                 getBranch("twitter.").
                 QueryInterface(Ci.nsIPrefBranch2);
    this.prefs.addObserver("", this, false);
    if (this.prefs.prefHasUserValue("username"))
      this.user = this.prefs.getCharPref("username");
    if (this.prefs.prefHasUserValue("password"))
      this.pass = this.prefs.getCharPref("password");
    this.refreshRate = this.prefs.getIntPref("refreshRate");

    var dbfile = Cc["@mozilla.org/file/directory_service;1"].
                 getService(Ci.nsIProperties).
                 get("ProfD", Ci.nsIFile);
    dbfile.append("twitter.sqlite");
    
    var storageService = Cc["@mozilla.org/storage/service;1"].
                         getService(Ci.mozIStorageService);
    this.db = storageService.openDatabase(dbfile);

    switch (this.db.schemaVersion) {
    case 0:
      this.createSchema();
      break;
    case 1:
      break;
    default:
      // TODO figure out something smart to do here, probably wipe the db and
      // start again
      LOG("Unknown database schema " + this.db.schemaVersion);
      return;
    }

    var observerService = Cc["@mozilla.org/observer-service;1"].
                          getService(Ci.nsIObserverService);
    observerService.addObserver(this, "final-ui-startup", false);
    observerService.addObserver(this, "network:offline-status-changed", false);
    observerService.addObserver(this, "xpcom-shutdown", false);
  },

  // Creates the database
  createSchema: function() {
    this.db.createTable("People",
      "id INTEGER PRIMARY KEY," +
      "username TEXT," +
      "type INTEGER," +
      "name TEXT," +
      "location TEXT," +
      "description TEXT," +
      "imageURL TEXT," +
      "homeURL TEXT");
    this.db.createTable("Messages",
      "id INTEGER," +
      "type INTEGER," +
      "created INTEGER," +
      "author INTEGER," +
      "text TEXT," +
      "source TEXT," +
      "target INTEGER");
    this.db.createStatement("CREATE UNIQUE INDEX MessageType ON Messages (id, type)").execute();
    this.db.schemaVersion = 1;
  },

  // Gets a type number for a twIMessage
  getTypeForMessage: function(message) {
    try {
      if (message.QueryInterface(Ci.twIDirectMessage))
        return TYPE_DIRECT;
    } catch (e) { }
    try {
      if (message.QueryInterface(Ci.twIReply))
        return TYPE_REPLY;
    } catch (e) { }
    return TYPE_STATUS;
  },

  // Tests whether a given twIMessage exists in the database
  isMessageInDatabase: function(message) {
    var stmt = this.db.createStatement("SELECT id FROM Messages WHERE id=? AND type=?");
    stmt.bindInt64Parameter(0, message.id);
    stmt.bindInt64Parameter(1, this.getTypeForMessage(message));
    var result = stmt.executeStep();
    stmt.reset();
    return result;
  },

  // Adds a twIMessage to the database, it should not be there already
  addMessageToDatabase: function(message) {
    var type = this.getTypeForMessage(message);
    var cols = "id,type,created,author,text,source";
    var params = "?,?,?,?,?,?";
    switch (type) {
    case TYPE_DIRECT:
    case TYPE_REPLY:
      cols += ",target";
      params += ",?";
    }

    this.addPersonToDatabase(message.author);
    var stmt = this.db.createStatement("INSERT INTO Messages (" + cols + ") VALUES (" + params +")");
    stmt.bindInt64Parameter(0, message.id);
    stmt.bindInt64Parameter(1, type);
    // Bug 476634 means the template builder can't really handle 64 bit values
    stmt.bindInt64Parameter(2, Math.round(message.created / 1000));
    stmt.bindInt64Parameter(3, message.author.id);
    stmt.bindStringParameter(4, message.text);
    stmt.bindStringParameter(5, message.source);

    switch (type) {
    case TYPE_DIRECT:
      this.addPersonToDatabase(message.recipient);
      stmt.bindInt64Parameter(6, message.recipient.id);
      break;
    case TYPE_REPLY:
      this.addPersonToDatabase(message.inReplyTo);
      stmt.bindInt64Parameter(6, message.inReplyTo.id);
      break;
    }

    stmt.execute();
  },

  // Adds a twIPerson to the database or updates their details there
  addPersonToDatabase: function(person) {
    var stmt = this.db.createStatement("SELECT id FROM People WHERE id=?");
    stmt.bindInt64Parameter(0, person.id);
    var result = stmt.executeStep();
    stmt.reset();

    // Some twiPerson objects will only have id and username set
    if (!person.name) {
      // If the person is already in the db then there isn't anything to update
      if (result)
        return;
      stmt = this.db.createStatement("INSERT INTO People (id,username,type) VALUES (?,?,?)");
      stmt.bindInt64Parameter(0, person.id);
      stmt.bindStringParameter(1, person.username);
      stmt.bindInt64Parameter(2, person.username == this.username ? TYPE_USER : TYPE_FRIEND);
      stmt.execute();
      return;
    }

    if (result) {
      var str = "UPDATE People SET username=?,name=?,location=?," +
                                  "description=?,imageURL=?,homeURL=?,type=? WHERE id=?";
    }
    else {
      str = "INSERT INTO People (username,name,location,description,imageURL," +
                                "homeURL,type,id) VALUES (?,?,?,?,?,?,?,?)";
    }
    stmt = this.db.createStatement(str);
    stmt.bindStringParameter(0, person.username);
    stmt.bindStringParameter(1, person.name);
    stmt.bindStringParameter(2, person.location);
    stmt.bindStringParameter(3, person.description);
    stmt.bindStringParameter(4, person.imageURL);
    stmt.bindStringParameter(5, person.homeURL);
    stmt.bindInt64Parameter(6, person.username == this.username ? TYPE_USER : TYPE_FRIEND);
    stmt.bindInt64Parameter(7, person.id);
    stmt.execute();
  },

  // This callback is called for every successful Twitter request we make
  successCallback: function(items) {
    this.opCount--;
    items.forEach(function(item) {
      if (!this.isMessageInDatabase(item)) {
        this.addMessageToDatabase(item);
        this.addedItems.push(item);
      }
    }, this);

    this.maybeCallListeners();
  },

  // This callback is called for every failed Twitter request we make
  errorCallback: function(statusCode, statusText) {
    this.opCount--;
    this.updateStatus++;

    this.maybeCallListeners();
  },

  maybeCallListeners: function() {
    if (this.opCount != 0)
      return;

    LOG("Retrieved " + this.addedItems.length + " items");
    if (this.addedItems.length > 0) {
      this.addedItems.sort(function (a, b) {
        return a.created - b.created;
      });
      this.callListeners("onNewItemsAdded", this.addedItems, this.addedItems.length);
    }
    this.callListeners("onUpdateEnded", this.updateStatus);
    this.addedItems = null;
    this.timer.init(this, this.refreshRate * 1000, Ci.nsITimer.TYPE_ONE_SHOT);
    this.prefs.setIntPref("lastUpdate", Date.now() / 1000);
  },

  // This calls all the registered listeners protecting against any exceptions
  callListeners: function(method) {
    var args = Array.splice(arguments, 1);
    this.listeners.forEach(function(listener) {
      try {
        listener[method].apply(listener, args);
      }
      catch (e) {
        LOG("Error calling update listener: " + e);
      }
    });
  },

  scheduleRefresh: function() {
    if (this.user && this.pass) {
      if (this.prefs.prefHasUserValue("lastUpdate")) {
        var next = this.prefs.getIntPref("lastUpdate");
        next += this.refreshRate;
        next -= Date.now() / 1000;
        if (next <= 0)
          this.refresh();
        else
          this.timer.init(this, next * 1000, Ci.nsITimer.TYPE_ONE_SHOT);
      }
      else {
        // Never refreshed before, just do it
        this.refresh();
      }
    }
  },

  // twITwitterService implementation
  get database() {
    return this.db;
  },

  get busy() {
    return this.opCount > 0;
  },

  get username() {
    return this.user;
  },

  get password() {
    return this.pass;
  },

  refresh: function() {
    var ioservice = Cc["@mozilla.org/network/io-service;1"].
                    getService(Ci.nsIIOService);
    if (ioservice.offline)
      return;
    if (this.opCount)
      return;

    this.timer.cancel();

    this.callListeners("onUpdateStarted");

    var statusSince, sentSince, receivedSince;

    // Pull the most recent id for each message type out of the database.
    var stmt = this.db.createStatement("SELECT id FROM people WHERE username=?");
    stmt.bindStringParameter(0, this.user);
    if (stmt.executeStep()) {
      var id = stmt.getInt64(0);
      stmt.reset();

      stmt = this.db.createStatement("SELECT MAX(id) FROM Messages WHERE type=? AND author=?");
      stmt.bindInt64Parameter(0, TYPE_DIRECT);
      stmt.bindInt64Parameter(1, id);
      if (stmt.executeStep())
        sentSince = stmt.getInt64(0);
      stmt.reset();

      stmt = this.db.createStatement("SELECT MAX(id) FROM Messages WHERE type=? AND author<>?");
      stmt.bindInt64Parameter(0, TYPE_DIRECT);
      stmt.bindInt64Parameter(1, id);
      if (stmt.executeStep())
        receivedSince = stmt.getInt64(0);
      stmt.reset();

      stmt = this.db.createStatement("SELECT MAX(id) FROM Messages WHERE type<?");
      stmt.bindInt64Parameter(0, TYPE_DIRECT);
      if (stmt.executeStep())
        statusSince = stmt.getInt64(0);
      stmt.reset();
    }
    else {
      stmt.reset();
    }

    this.updateStatus = 0;
    var account = Twitter.getTwitterAccount(this.user, this.pass);
    this.addedItems = [];
    var self = this;
    var successCallback = function(items) {
      self.successCallback(items);
    }
    var errorCallback = function(statusCode, statusText) {
      self.errorCallback(statusCode, statusText);
    }
    if (statusSince)
      account.fetchFriendsTimeline(successCallback, errorCallback, statusSince, 200);
    else
      account.fetchFriendsTimeline(successCallback, errorCallback, null, 200);
    account.fetchReceivedDirectMessages(successCallback, errorCallback, receivedSince);
    account.fetchSentDirectMessages(successCallback, errorCallback, sentSince);
    account.fetchReplies(successCallback, errorCallback, statusSince);
    this.opCount += 4;
  },

  addUpdateListener: function(listener) {
    if (!this.listeners.some(function(item) { return item == listener; }))
      this.listeners.push(listener);
  },

  removeUpdateListener: function(listener) {
    this.listeners = this.listeners.filter(function(item) {
      return item != listener;
    });
  },

  // nsIObserver implementation
  observe: function(subject, topic, data) {
    switch (topic) {
    case "profile-after-change":
      this.startup();
      break;
    case "final-ui-startup":
      var ioservice = Cc["@mozilla.org/network/io-service;1"].
                      getService(Ci.nsIIOService);
      if (!ioservice.offline)
        this.scheduleRefresh();
      break;
    case "network:offline-status-changed":
      if (data == "offline")
        this.timer.cancel();
      else
        this.scheduleRefresh();
      break;
    case "xpcom-shutdown":
      var observerService = Cc["@mozilla.org/observer-service;1"].
                            getService(Ci.nsIObserverService);
      observerService.removeObserver(this, "final-ui-startup");
      observerService.removeObserver(this, "network:offline-status-changed");
      observerService.removeObserver(this, "xpcom-shutdown");
      this.prefs.removeObserver("", this);
      this.prefs = null;
      this.db.close();
      this.db = null;
      break;
    case "timer-callback":
      this.refresh();
      break;
    case "nsPref:changed":
      switch (data) {
      case "username":
        var olduser = this.user;
        this.user = null;
        if (this.prefs.prefHasUserValue("username"))
          this.user = this.prefs.getCharPref("username");

        // If the user has changed then delete the database
        if (!this.user ||
            (olduser && (this.user.toLowerCase() != olduser.toLowerCase()))) {
          this.db.createStatement("DELETE FROM People").execute();
          this.db.createStatement("DELETE FROM Messages").execute();
        }

        if (!this.user)
          this.timer.cancel();
        else if (!olduser)
          this.scheduleRefresh();
        break;
      case "password":
        var oldpass = this.pass;
        this.pass = null;
        if (this.prefs.prefHasUserValue("password"))
          this.pass = this.prefs.getCharPref("password");

        if (!this.pass)
          this.timer.cancel();
        else if (!oldpass)
          this.scheduleRefresh();
        break;
      case "refreshRate":
        var oldrate = this.refreshRate;
        this.refreshRate = this.prefs.getIntPref("refreshRate");
        if (oldrate != this.refreshRate) {
          this.timer.cancel();
          this.scheduleRefresh();
        }
        break;
      }
      break;
    }
  },

  classDescription: "TwitterXUL Background Service",
  contractID: "@fractalbrew.com/twitterxul/service;1",
  classID: Components.ID("{08c3f4a6-60b0-41f7-a889-61ad916d7c67}"),
  _xpcom_categories: [{category: "profile-after-change"}],
  QueryInterface: XPCOMUtils.generateQI([Ci.twITwitterService,
                                         Ci.nsIObserver])
};

function NSGetModule(compMgr, fileSpec)
  XPCOMUtils.generateModule([TwitterService]);

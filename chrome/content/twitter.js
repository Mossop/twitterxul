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

Components.utils.import("resource:///modules/Twitter.jsm");

function LOG(str) {
  dump("twitter.js: " + str + "\n");
}

// A regex to detect "d <username> <message>"
var gDirectMessage = /^d\s+(\S*)\s+(.*)/;

var gDBFields = "Messages.id AS id," +
                "Messages.type AS type," +
                "Messages.created AS date," +
                "Messages.text AS text," +
                "Messages.source AS source," +
                "Author.id AS author_id," +
                "Author.username AS author_username," +
                "Author.type AS author_type," +
                "Author.name AS author_name," +
                "Author.location AS author_location," +
                "Author.description AS author_description," +
                "Author.imageURL AS author_imageURL," +
                "Author.homeURL AS author_homeURL," +
                "Target.id AS target_id," +
                "Target.username AS target_username," +
                "Target.type AS target_type," +
                "Target.name AS target_name," +
                "Target.location AS target_location," +
                "Target.description AS target_description," +
                "Target.imageURL AS target_imageURL," +
                "Target.homeURL AS target_homeURL";

var gDBTables = "Messages JOIN People AS Author ON Messages.author=Author.id " +
                "LEFT JOIN People AS Target ON Messages.target=Target.id";

// The update listener updates the throbber and rebuilds the status list if
// new items have been added.
var UpdateListener = {
  onUpdateStarted: function() {
    document.documentElement.setAttribute("busy", "true");
    document.getElementById("refresh-button").disabled = true;
  },

  onNewItemsAdded: function(items, count) {
    document.getElementById("status-list").builder.rebuild();
  },

  onUpdateEnded: function() {
    document.documentElement.setAttribute("busy", "false");
    document.getElementById("refresh-button").disabled = false;
  }
};

// Called during window open
function onStartup() {
  var service = Cc["@fractalbrew.com/twitterxul/service;1"].
                getService(Ci.twITwitterService);
  document.documentElement.setAttribute("busy", service.busy ? "true" : "false");
  document.getElementById("refresh-button").disabled = service.busy;
  service.addUpdateListener(UpdateListener);

  var prefs = Cc["@mozilla.org/preferences-service;1"].
              getService(Ci.nsIPrefService).
              getBranch("twitter.");
  document.getElementById("direct-checkbox").checked = prefs.getBoolPref("display.direct");
  document.getElementById("reply-checkbox").checked = prefs.getBoolPref("display.reply");
  document.getElementById("own-checkbox").checked = prefs.getBoolPref("display.own");
  document.getElementById("status-checkbox").checked = prefs.getBoolPref("display.status");
  document.getElementById("limit-menulist").value = prefs.getIntPref("display.count");
  buildQuery();

  // Reusing the same database connection is much faster
  document.getElementById("status-list").builder.datasource = service.database;

  // Load a stylesheet for overriding scrollbars
  var ios = Cc["@mozilla.org/network/io-service;1"].
            getService(Ci.nsIIOService);
  var styleSheets = Cc["@mozilla.org/content/style-sheet-service;1"].
                    getService(Ci.nsIStyleSheetService);
  var styleURI = ios.newURI("chrome://twitter/skin/scrollbars.css", null, null);
  styleSheets.loadAndRegisterSheet(styleURI, styleSheets.AGENT_SHEET);

  if ("arguments" in window && window.arguments.length > 0) {
    if (!(window.arguments[0] instanceof Ci.nsICommandLine))
      selectItemWithId(window.arguments[0]);
  }
}

// Called during window close
function onShutdown() {
  var service = Cc["@fractalbrew.com/twitterxul/service;1"].
                getService(Ci.twITwitterService);
  service.removeUpdateListener(UpdateListener);
}

// Selects the status with the given id.
function selectItemWithId(id) {
  var items = document.getElementsByAttribute("msgid", id);
  if (items && items.length > 0) {
    var list = document.getElementById("status-list");
    list.ensureElementIsVisible(items[0]);
  }
}

// Called whenever the SQL query needs to be generated
function buildQuery() {
  var where = "";
  if (document.getElementById("own-checkbox").checked)
    where += " OR (Messages.type in (0,1) AND Author.type=0)";
  if (document.getElementById("status-checkbox").checked)
    where += " OR (Messages.type=0 AND Author.type<>0) OR (Messages.type=1 AND Author.type<>0 AND Target.type<>0)";
  if (document.getElementById("reply-checkbox").checked)
    where += " OR (Messages.type=1 AND Target.type=0)";
  if (document.getElementById("direct-checkbox").checked)
    where += " OR Messages.type=2";
  if (where)
    where = where.substring(4);
  else
    where = "0=1";
  var query="SELECT " + gDBFields + " FROM " + gDBTables + " WHERE " + where +
            " ORDER BY created DESC " + 
            "LIMIT " + document.getElementById("limit-menulist").value;
  document.getElementById("status-query").textContent = query;
}

// Called when some of the filter UI has been changed
function updateFilter() {
  var prefs = Cc["@mozilla.org/preferences-service;1"].
              getService(Ci.nsIPrefService).
              getBranch("twitter.");
  prefs.setBoolPref("display.direct", document.getElementById("direct-checkbox").checked);
  prefs.setBoolPref("display.reply", document.getElementById("reply-checkbox").checked);
  prefs.setBoolPref("display.own", document.getElementById("own-checkbox").checked);
  prefs.setBoolPref("display.status", document.getElementById("status-checkbox").checked);
  prefs.setIntPref("display.count", document.getElementById("limit-menulist").value);
  buildQuery();
  document.getElementById("status-list").builder.rebuild();
}

function getStatusItem(node) {
  while (node && node.className != "status-item")
    node = node.parentNode;
  return node;
}

// Called to fill out the tooltip for a status item
function populateTooltip() {
  var item = getStatusItem(document.tooltipNode);
  if (!item)
    return;

  var source = item.source;
  source = source.replace("</a>", "");
  source = source.replace(/<a.*>/, "");
  source = document.getElementById("main-strings").getFormattedString("source-label.text", [source]);

  document.getElementById("source-label").value = source;
  document.getElementById("date-label").value = (new Date(item.date)).toLocaleString();
}

// Called to fill out the context menu for a status item
function populateContextMenu() {
  var item = getStatusItem(document.popupNode);
  if (!item)
    return;

  document.getElementById("home-menu").hidden = !item.hasAttribute("author_homeURL");
}

// Called to refresh the status list
function refresh() {
  var service = Cc["@fractalbrew.com/twitterxul/service;1"].
                getService(Ci.twITwitterService);
  service.refresh();
}

// Called to send a direct message to a user
function directMessage(username) {
  var messageBox = document.getElementById("message-textbox");
  messageBox.value = "d " + username + " ";

  messageBox.selectionStart = messageBox.value.length;
  messageBox.selectionEnd = messageBox.value.length;
  messageBox.focus();
  afterKeyPressed();
}

// Called to publicly reply to a user
function replyTo(username) {
  var messageBox = document.getElementById("message-textbox");
  messageBox.value += "@" + username + " ";

  messageBox.selectionStart = messageBox.value.length;
  messageBox.selectionEnd = messageBox.value.length;
  messageBox.focus();
  afterKeyPressed();
}

// Called to send the current contents of the message to Twitter
function sendMessage(message) {
  var service = Cc["@fractalbrew.com/twitterxul/service;1"].
                getService(Ci.twITwitterService);
  var act = Twitter.getTwitterAccount(service.username, service.password);

  var errorCallback = function(request, statusCode, statusText) {
    var strings = document.getElementById("main-strings");
    var title = strings.getString("sendfailed.title");
    var text = strings.getFormattedString("sendfailed.message", [statusText]);

    var prompts = Cc["@mozilla.org/embedcomp/prompt-service;1"].
                  getService(Ci.nsIPromptService);
    if (prompts.confirm(window, title, text))
      sendMessage(message);
  };

  var results = gDirectMessage.exec(message);
  if (results)
    act.sendDirectMessage(null, errorCallback, results[1], results[2]);
  else
    act.setStatus(null, errorCallback, message);
}

// Update the UI state based on what is in the message box
function afterKeyPressed(event) {
  var text = document.getElementById("message-textbox").value;
  document.getElementById("send-button").disabled = text == "";
  document.getElementById("count-label").value = 140 - text.length;
}

// Called when the send button is clicked
function onSendPressed() {
  var textbox = document.getElementById("message-textbox");
  sendMessage(textbox.value);
  textbox.value = "";
  afterKeyPressed();
}

// Sends the message when return is pressed
function onKeyPressed(event) {
  if (event.keyCode == Ci.nsIDOMKeyEvent.DOM_VK_RETURN) {
    onSendPressed();
    return false;
  }
  return true;
}

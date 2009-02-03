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
  var service = Cc["@oxymoronical.com/twitterservice;1"].
                getService(Ci.twITwitterService);
  document.documentElement.setAttribute("busy", service.busy ? "true" : "false");
  document.getElementById("refresh-button").disabled = service.busy;
  service.addUpdateListener(UpdateListener);

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
  var service = Cc["@oxymoronical.com/twitterservice;1"].
                getService(Ci.twITwitterService);
  service.removeUpdateListener(UpdateListener);
}

// Selects the status with the given id.
function selectItemWithId(id) {
  var items = document.getElementsByAttribute("msgid", id);
  if (items && items.length > 0) {
    var list = document.getElementById("status-list");
    list.selectItem(items[0]);
    list.ensureElementIsVisible(items[0]);
    list.focus();
  }
}

// Called to fill out the tooltip for a status item
function populateTooltip() {
  var item = document.tooltipNode;
  while (item && item.className != "status-item")
    item = item.parentNode;
  if (!item)
    return;

  var source = item.source;
  source = source.replace("</a>", "");
  source = source.replace(/<a.*>/, "");
  source = document.getElementById("main-strings").getFormattedString("source-label.text", [source]);

  document.getElementById("source-label").value = source;
  document.getElementById("date-label").value = (new Date(item.date)).toLocaleString();
}

// Called to refresh the status list
function refresh() {
  var service = Cc["@oxymoronical.com/twitterservice;1"].
                getService(Ci.twITwitterService);
  service.refresh();
}

// Called by a click on a reply button in the list
function replyTo(item) {
  // For now just replace the existing text with a new message
  var messageBox = document.getElementById("message-textbox");
  if (item.type == 2)
    messageBox.value = "d " + item.getAttribute("author_username") + " ";
  else
    messageBox.value += "@" + item.getAttribute("author_username") + " ";

  messageBox.selectionStart = messageBox.value.length;
  messageBox.selectionEnd = messageBox.value.length;
  messageBox.focus();
  afterKeyPressed();
}

// Called to send the current contents of the message to Twitter
function sendMessage() {
  var service = Cc["@oxymoronical.com/twitterservice;1"].
                getService(Ci.twITwitterService);
  var message = document.getElementById("message-textbox").value;

  var results = gDirectMessage.exec(message);
  if (results) {
    Twitter.sendDirectMessage(service.username, service.password, results[1], results[2]);
  }
  else {
    Twitter.setStatus(service.username, service.password, message);
  }

  document.getElementById("message-textbox").value = "";
  afterKeyPressed();
}

// Update the UI state based on what is in the message box
function afterKeyPressed(event) {
  var text = document.getElementById("message-textbox").value;
  document.getElementById("send-button").disabled = text == "";
  document.getElementById("count-label").value = 140 - text.length;
}

// Sends the message when return is pressed
function onKeyPressed(event) {
  if (event.keyCode == Ci.nsIDOMKeyEvent.DOM_VK_RETURN) {
    sendMessage();
    return false;
  }
  return true;
}

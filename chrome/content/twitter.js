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

// If a window with the type exists just focus it otherwise open a new window
function openWindowForType(type, uri, features) {
  var topWindow = Cc['@mozilla.org/appshell/window-mediator;1'].
                  getService(Ci.nsIWindowMediator).
                  getMostRecentWindow(type);

  if (topWindow)
    topWindow.focus();
  else if (features)
    window.open(uri, "_blank", features);
  else
    window.open(uri, "_blank", "chrome,extrachrome,menubar,resizable,scrollbars,status,toolbar");
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

  var em = Cc["@mozilla.org/extensions/manager;1"].
           getService(Ci.nsIExtensionManager);
  if (em.getItemForID("inspector@mozilla.org")) {
    document.getElementById("inspector-separator").hidden = false;
    document.getElementById("inspector-menu").hidden = false;
  }
}

// Called during window close
function onShutdown() {
  var service = Cc["@oxymoronical.com/twitterservice;1"].
                getService(Ci.twITwitterService);
  service.removeUpdateListener(UpdateListener);
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

// Updates the check for updates menu item based on the current update state
function buildHelpMenu()
{
  var updates = Cc["@mozilla.org/updates/update-service;1"].
                getService(Ci.nsIApplicationUpdateService);
  var um = Cc["@mozilla.org/updates/update-manager;1"].
           getService(Ci.nsIUpdateManager);

  // Disable the UI if the update enabled pref has been locked by the 
  // administrator or if we cannot update for some other reason
  var checkForUpdates = document.getElementById("update-menu");
  var canUpdate = updates.canUpdate;
  checkForUpdates.setAttribute("disabled", !canUpdate);
  if (!canUpdate)
    return; 

  var strings = document.getElementById("main-strings");
  var activeUpdate = um.activeUpdate;
  
  // If there's an active update, substitute its name into the label
  // we show for this item, otherwise display a generic label.
  function getStringWithUpdateName(key) {
    if (activeUpdate && activeUpdate.name)
      return strings.getFormattedString(key, [activeUpdate.name]);
    return strings.getString(key + "Fallback");
  }
  
  // By default, show "Check for Updates..."
  var key = "default";
  if (activeUpdate) {
    switch (activeUpdate.state) {
    case "downloading":
      // If we're downloading an update at present, show the text:
      // "Downloading Firefox x.x..." otherwise we're paused, and show
      // "Resume Downloading Firefox x.x..."
      key = updates.isDownloading ? "downloading" : "resume";
      break;
    case "pending":
      // If we're waiting for the user to restart, show: "Apply Downloaded
      // Updates Now..."
      key = "pending";
      break;
    }
  }
  checkForUpdates.label = getStringWithUpdateName("updatesItem_" + key);
  if (um.activeUpdate && updates.isDownloading)
    checkForUpdates.setAttribute("loading", "true");
  else
    checkForUpdates.removeAttribute("loading");
}

// Opens the update manager and checks for updates to the application.
function openUpdates()
{
  var um = Cc["@mozilla.org/updates/update-manager;1"].
           getService(Ci.nsIUpdateManager);
  var prompter = Cc["@mozilla.org/updates/update-prompt;1"].
                 createInstance(Ci.nsIUpdatePrompt);

  // If there's an update ready to be applied, show the "Update Downloaded"
  // UI instead and let the user know they have to restart the browser for
  // the changes to be applied. 
  if (um.activeUpdate && um.activeUpdate.state == "pending")
    prompter.showUpdateDownloaded(um.activeUpdate);
  else
    prompter.checkForUpdates();
}

// Opens the add-ons manager
function openAddons() {
  openWindowForType("Extension:Manager",
                    "chrome://mozapps/content/extensions/extensions.xul");
}

// Opens the error console
function openErrorConsole() {
  openWindowForType("global:console", "chrome://global/content/console.xul");
}

// Opens about:config
function openConfig() {
  openWindowForType("Preferences:ConfigManager", "chrome://global/content/config.xul");
}

// Opens the DOM Inspector
function openDOMInspector() {
  window.openDialog("chrome://inspector/content/", "_blank",
                    "chrome,all,dialog=no", document);
}

// Opens the options dialog
function openOptions() {
  openWindowForType("Twitter:Options", "chrome://twitter/content/options.xul",
                    "chrome,dialog,centerscreen");
}

// Opens the about dialog
function openAbout() {
  openWindowForType("Twitter:About", "chrome://twitter/content/about.xul",
                    "chrome,dialog,centerscreen");
}

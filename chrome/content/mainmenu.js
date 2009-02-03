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

var TwitterMenu = {
// If a window with the type exists just focus it otherwise open a new window
openWindowForType: function(type, uri, features) {
  var topWindow = Components.classes['@mozilla.org/appshell/window-mediator;1']
                            .getService(Components.interfaces.nsIWindowMediator)
                            .getMostRecentWindow(type);

  if (topWindow)
    topWindow.focus();
  else if (features)
    window.open(uri, "_blank", features);
  else
    window.open(uri, "_blank", "chrome,extrachrome,menubar,resizable,scrollbars,status,toolbar");
},

init: function() {
  var em = Components.classes["@mozilla.org/extensions/manager;1"]
                     .getService(Components.interfaces.nsIExtensionManager);
  if (em.getItemForID("inspector@mozilla.org")) {
    document.getElementById("inspector-separator").hidden = false;
    document.getElementById("inspector-menu").hidden = false;
  }
},

// Updates the check for updates menu item based on the current update state
buildHelpMenu: function()
{
  var bs = Components.classes["@mozilla.org/intl/stringbundle;1"]
                     .getService(Components.interfaces.nsIStringBundleService);
  var strings = bs.createBundle("chrome://twitter/locale/menu.properties");
  var updates = Components.classes["@mozilla.org/updates/update-service;1"]
                          .getService(Components.interfaces.nsIApplicationUpdateService);
  var um = Components.classes["@mozilla.org/updates/update-manager;1"]
                     .getService(Components.interfaces.nsIUpdateManager);

  // Disable the UI if the update enabled pref has been locked by the 
  // administrator or if we cannot update for some other reason
  var checkForUpdates = document.getElementById("update-menu");
  var canUpdate = updates.canUpdate;
  checkForUpdates.setAttribute("disabled", !canUpdate);
  if (!canUpdate)
    return; 

  var activeUpdate = um.activeUpdate;
  
  // If there's an active update, substitute its name into the label
  // we show for this item, otherwise display a generic label.
  function getStringWithUpdateName(key) {
    if (activeUpdate && activeUpdate.name)
      return strings.formatStringFromName(key, [activeUpdate.name], 1);
    return strings.GetStringFromName(key + "Fallback");
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
},

// Opens the update manager and checks for updates to the application.
openUpdates: function() {
  var um = Components.classes["@mozilla.org/updates/update-manager;1"]
                     .getService(Components.interfaces.nsIUpdateManager);
  var prompter = Components.classes["@mozilla.org/updates/update-prompt;1"]
                           .createInstance(Components.interfaces.nsIUpdatePrompt);

  // If there's an update ready to be applied, show the "Update Downloaded"
  // UI instead and let the user know they have to restart the browser for
  // the changes to be applied. 
  if (um.activeUpdate && um.activeUpdate.state == "pending")
    prompter.showUpdateDownloaded(um.activeUpdate);
  else
    prompter.checkForUpdates();
},

// Opens the add-ons manager
openAddons: function() {
  this.openWindowForType("Extension:Manager",
                         "chrome://mozapps/content/extensions/extensions.xul");
},

// Opens the error console
openErrorConsole: function() {
  this.openWindowForType("global:console", "chrome://global/content/console.xul");
},

// Opens the DOM Inspector
openDOMInspector: function() {
  window.openDialog("chrome://inspector/content/", "_blank",
                    "chrome,all,dialog=no", document);
},

// Opens the options dialog
openOptions: function() {
  this.openWindowForType("Twitter:Options", "chrome://twitter/content/options.xul",
                         "chrome,dialog,centerscreen");
},

// Opens the about dialog
openAbout: function() {
  this.openWindowForType("Twitter:About", "chrome://twitter/content/about.xul",
                         "chrome,dialog,centerscreen");
}
};

window.addEventListener("load", TwitterMenu.init, false);

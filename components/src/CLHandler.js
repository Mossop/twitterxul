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

function CommandLineHandler() {
}

CommandLineHandler.prototype = {
  handle: function(commandLine) {
    // For the initial launch tell the application that it should remain
    // open despite the absence of a main window.
    if (commandLine.state == Ci.nsICommandLine.STATE_INITIAL_LAUNCH) {
      var appStartup = Cc["@mozilla.org/toolkit/app-startup;1"].
                       getService(Ci.nsIAppStartup);
      appStartup.enterLastWindowClosingSurvivalArea();
      commandLine.preventDefault = true;

      var prefService = Cc["@mozilla.org/preferences-service;1"].
                        getService(Ci.nsIPrefBranch);
      if (!prefService.prefHasUserValue("twitter.username")) {
        var bs = Cc["@mozilla.org/intl/stringbundle;1"].
                 getService(Ci.nsIStringBundleService);
        var bundle = bs.createBundle("chrome://twitter/locale/options.properties");

        var prompt = Cc["@mozilla.org/embedcomp/prompt-service;1"].
                     getService(Ci.nsIPromptService);
        var user = {};
        var pass = {};
        if (prompt.promptUsernameAndPassword(null,
                                             bundle.GetStringFromName("username.title"),
                                             bundle.GetStringFromName("username.text"),
                                             user, pass, null, {})) {
          prefService.setCharPref("twitter.password", pass.value);
          prefService.setCharPref("twitter.username", user.value);
        }
        else {
          throw Cr.NS_ERROR_ABORT;
        }
      }
    }
  },

  // XULRunner app command line handlers can't output help :(
  helpInfo: "",

  classDescription: "TwitterXUL Command Line Handler",
  contractID: "@oxymoronical.com/taskhandler;1",
  classID: Components.ID("{a18d7b0a-540e-466d-b5a4-88bebcb5594f}"),
  _xpcom_categories: [{
    category: "command-line-handler",
    entry: "m-twitter",
  }],
  QueryInterface: XPCOMUtils.generateQI([Ci.nsICommandLineHandler])
};

function NSGetModule(compMgr, fileSpec)
  XPCOMUtils.generateModule([CommandLineHandler]);

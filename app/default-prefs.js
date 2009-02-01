pref("toolkit.defaultChromeURI", "chrome://twitter/content");
pref("toolkit.defaultChromeFeatures", "chrome,resizable,centerscreen,dialog=no");
pref("toolkit.singletonWindowType", "Canary:Main");
pref("browser.hiddenWindowChromeURL", "chrome://twitter/content/hiddenWindow.xul");
pref("network.protocol-handler.expose-all", false);
pref("network.protocol-handler.warn-external-default", false);

pref("app.update.enabled", true);
// Automatically download updates
pref("app.update.auto", true);
// Prompt if installed extensions are incompatible with the update
pref("app.update.mode", 1);
pref("app.update.url", "https://www.oxymoronical.com/aus/3/%PRODUCT%/%VERSION%/%BUILD_ID%/%BUILD_TARGET%/%LOCALE%/%CHANNEL%/%OS_VERSION%/%DISTRIBUTION%/%DISTRIBUTION_VERSION%/update.xml");
pref("app.update.url.manual", "http://www.oxymoronical.com/%PRODUCT%");
pref("app.update.url.details", "http://www.oxymoronical.com/%PRODUCT%");
// Check once a day
pref("app.update.interval", 86400);
// Time before prompting to download (i.e. installed extensions are incompatible with the new version)
pref("app.update.nagTimer.download", 86400);
// Time before prompting to restart
pref("app.update.nagTimer.restart", 600);
// Check if an update check needs to be run once a minute
pref("app.update.timer", 60000);
// The post install UI appears to be broken
pref("app.update.showInstalledUI", false);

pref("javascript.options.showInConsole", true);
pref("javascript.options.strict", true);
pref("browser.dom.window.dump.enabled", true);

pref("twitter.refreshRate", 300);

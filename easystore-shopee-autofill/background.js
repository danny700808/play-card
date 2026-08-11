(function configureSessionStorageAccess() {
  "use strict";

  function enableContentScriptAccess() {
    try {
      const pending = chrome.storage.session.setAccessLevel({
        accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS"
      });
      if (pending && typeof pending.catch === "function") {
        pending.catch(() => {});
      }
    } catch (error) {
      // Content scripts will surface a storage error if this browser is too old.
    }
  }

  enableContentScriptAccess();
  chrome.runtime.onInstalled.addListener(enableContentScriptAccess);
  chrome.runtime.onStartup.addListener(enableContentScriptAccess);
})();

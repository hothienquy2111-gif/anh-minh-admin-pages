(function () {
  "use strict";

  const SIDEBAR_STORAGE_KEY = "am-admin-sidebar-pinned";
  const PERSISTENCE_DISABLED = /(?:^|\/)invoice\.html$/.test(window.location.pathname);
  const root = document.documentElement;
  let pinned = false;

  if (!PERSISTENCE_DISABLED) {
    try {
      pinned = window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
    } catch (_error) {
      pinned = false;
    }
  }

  root.classList.add("am-ui-redesign");
  root.setAttribute("data-am-sidebar-pinned", String(pinned));
  root.setAttribute("data-am-sidebar-expanded", String(pinned));
  root.setAttribute("data-sidebar-state", pinned ? "pinned" : "collapsed");
})();

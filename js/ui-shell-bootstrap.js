(function () {
  "use strict";

  const SIDEBAR_STORAGE_KEY = "am-admin-sidebar-pinned";
  const root = document.documentElement;
  let pinned = false;

  try {
    pinned = window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
  } catch (_error) {
    pinned = false;
  }

  root.classList.add("am-ui-redesign");
  root.setAttribute("data-am-sidebar-pinned", String(pinned));
  root.setAttribute("data-am-sidebar-expanded", String(pinned));
  root.setAttribute("data-sidebar-state", pinned ? "pinned" : "collapsed");
})();

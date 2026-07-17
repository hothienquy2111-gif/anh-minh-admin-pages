(function () {
  "use strict";

  const BACK_BUTTON_DISABLED_PAGES = new Set([
    "index.html",
    "login.html",
    "dashboard.html"
  ]);

  const ALLOWED_BACK_TARGET_PAGES = new Set([
    "ticket-activity.html",
    "appointment-reminders.html",
    "user-guide.html",
    "repairing-tickets.html",
    "warranty-search.html",
    "dashboard.html",
    "attention-summary.html",
    "overview.html",
    "ticket-history.html",
    "new-ticket.html",
    "search.html",
    "print-delivery-receipt.html",
    "print-label.html"
  ]);

  const FALLBACKS = {
    "ticket-activity.html": "dashboard.html",
    "appointment-reminders.html": "dashboard.html",
    "user-guide.html": "dashboard.html",
    "repairing-tickets.html": "dashboard.html",
    "warranty-search.html": "dashboard.html",
    "attention-summary.html": "dashboard.html",
    "overview.html": "dashboard.html",
    "ticket-history.html": "dashboard.html",
    "new-ticket.html": "dashboard.html",
    "search.html": "dashboard.html",
    "print-delivery-receipt.html": "dashboard.html",
    "print-label.html": "dashboard.html"
  };

  const UNSAVED_MESSAGE = "Thông tin chưa được lưu. Bạn có chắc muốn rời trang?";

  function pageNameFromUrl(url) {
    const pathname = url.pathname || "";
    const name = pathname.split("/").filter(Boolean).pop();
    return name || "index.html";
  }

  function currentPageName() {
    return pageNameFromUrl(window.location);
  }

  function routeSignature(url) {
    return `${url.pathname}${url.search}`;
  }

  function isAllowedBackTargetUrl(url) {
    return url.origin === window.location.origin && ALLOWED_BACK_TARGET_PAGES.has(pageNameFromUrl(url));
  }

  function isSameRoute(url) {
    return routeSignature(url) === routeSignature(window.location);
  }

  function formSnapshot(form) {
    const data = new FormData(form);
    return Array.from(data.entries())
      .map(([key, value]) => `${key}=${String(value)}`)
      .join("&");
  }

  function isCreatedTicketState() {
    const createdActions = document.getElementById("createdActions");
    return Boolean(createdActions && !createdActions.classList.contains("hidden"));
  }

  function isFormEffectivelyDisabled(form) {
    const controls = Array.from(form.querySelectorAll("input, select, textarea, button"));
    const editableControls = controls.filter((control) => control.type !== "button");
    return editableControls.length > 0 && editableControls.every((control) => control.disabled);
  }

  function setupDirtyChecks() {
    document.querySelectorAll("form[data-back-dirty-check]").forEach((form) => {
      let baseline = formSnapshot(form);

      function refreshBaseline() {
        baseline = formSnapshot(form);
      }

      form.addEventListener("reset", function () {
        window.setTimeout(refreshBaseline, 0);
      });

      form.dataset.backDirtyReady = "true";

      form.isBackNavigationDirty = function () {
        if (isCreatedTicketState() || isFormEffectivelyDisabled(form)) {
          return false;
        }

        return formSnapshot(form) !== baseline;
      };
    });
  }

  function hasUnsavedChanges() {
    return Array.from(document.querySelectorAll("form[data-back-dirty-check]"))
      .some((form) => {
        if (typeof form.isBackNavigationDirty === "function") {
          return form.isBackNavigationDirty();
        }

        return false;
      });
  }

  function getFallbackUrl() {
    const page = currentPageName();
    return FALLBACKS[page] || "dashboard.html";
  }

  function canUseHistoryBack() {
    if (currentPageName() === "dashboard.html") {
      return false;
    }

    if (window.history.length <= 1 || !document.referrer) {
      return false;
    }

    try {
      const referrer = new URL(document.referrer);
      return isAllowedBackTargetUrl(referrer) && !isSameRoute(referrer);
    } catch (error) {
      return false;
    }
  }

  function goBack() {
    if (currentPageName() === "dashboard.html") {
      return;
    }

    if (hasUnsavedChanges() && !window.confirm(UNSAVED_MESSAGE)) {
      return;
    }

    if (canUseHistoryBack()) {
      window.history.back();
      return;
    }

    window.location.href = getFallbackUrl();
  }

  function createButton() {
    const button = document.createElement("button");
    const icon = document.createElement("span");
    const text = document.createElement("span");

    button.type = "button";
    button.className = "admin-back-button";
    button.setAttribute("aria-label", "Quay lại trang trước");

    icon.className = "admin-back-button-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "←";

    text.textContent = "Quay lại";

    button.append(icon, text);
    button.addEventListener("click", goBack);
    return button;
  }

  function insertBackButton() {
    if (BACK_BUTTON_DISABLED_PAGES.has(currentPageName())) {
      return;
    }

    if (document.querySelector(".admin-back-button")) {
      return;
    }

    const actions = document.createElement("div");
    actions.className = "admin-page-actions";
    actions.appendChild(createButton());

    const pageHeader = document.querySelector(".page-header");

    if (pageHeader && pageHeader.parentElement) {
      pageHeader.parentElement.insertBefore(actions, pageHeader);
      return;
    }

    const authPanel = document.querySelector(".auth-panel");

    if (authPanel) {
      authPanel.insertBefore(actions, authPanel.firstElementChild);
      return;
    }

    document.body.insertBefore(actions, document.body.firstElementChild);
  }

  document.addEventListener("DOMContentLoaded", function () {
    setupDirtyChecks();
    insertBackButton();
  });
})();

(function () {
  "use strict";

  if (window.AMUI) {
    return;
  }

  const MAX_TOASTS = 3;
  const DEFAULT_DURATION = 4200;
  const SECTION_STATES = Object.freeze([
    "loading",
    "refreshing",
    "data",
    "empty",
    "unavailable",
    "error",
    "info"
  ]);

  function prefersReducedMotion() {
    return Boolean(
      window.matchMedia
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function ensureToastRegion() {
    let region = document.querySelector(".am-toast-region");

    if (region) {
      return region;
    }

    region = document.createElement("div");
    region.className = "am-toast-region no-print";
    region.setAttribute("role", "region");
    region.setAttribute("aria-label", "Thông báo hệ thống");
    region.setAttribute("aria-live", "polite");
    region.setAttribute("aria-relevant", "additions text");
    document.body.appendChild(region);
    return region;
  }

  function dismissToast(toast, options) {
    if (!toast || toast.dataset.dismissing === "true") {
      return;
    }

    toast.dataset.dismissing = "true";
    if (toast._amTimer) {
      window.clearTimeout(toast._amTimer);
    }

    const shouldRestoreFocus = options && options.restoreFocus;
    const returnFocus = toast._amReturnFocus;
    const remove = function () {
      toast.remove();
      if (shouldRestoreFocus && returnFocus && document.contains(returnFocus)) {
        returnFocus.focus({ preventScroll: true });
      }
    };

    if (prefersReducedMotion()) {
      remove();
      return;
    }

    toast.classList.add("is-leaving");
    window.setTimeout(remove, 150);
  }

  function toast(message, options) {
    const text = String(message || "").trim();
    if (!text) {
      return null;
    }

    const config = options || {};
    const region = ensureToastRegion();
    const item = document.createElement("div");
    const content = document.createElement("p");
    const close = document.createElement("button");
    const type = ["success", "error", "info", "warning"].includes(config.type)
      ? config.type
      : "info";

    item.className = `am-toast am-toast--${type}`;
    item._amReturnFocus = document.activeElement;
    item.setAttribute("role", type === "error" ? "alert" : "status");
    content.className = "am-toast__message";
    content.textContent = text;
    close.className = "am-toast__close";
    close.type = "button";
    close.setAttribute("aria-label", "Đóng thông báo");
    close.textContent = "×";
    close.addEventListener("click", function () {
      dismissToast(item, { restoreFocus: true });
    });
    item.append(content, close);
    region.appendChild(item);

    while (region.children.length > MAX_TOASTS) {
      dismissToast(region.firstElementChild);
    }

    const duration = Number.isFinite(config.duration)
      ? Math.max(1800, config.duration)
      : DEFAULT_DURATION;
    item._amTimer = window.setTimeout(() => dismissToast(item), duration);
    return item;
  }

  function setButtonBusy(button, isBusy, options) {
    if (!button) {
      return;
    }

    const config = options || {};
    const busy = Boolean(isBusy);

    if (busy) {
      if (!button.dataset.amIdleLabel) {
        button.dataset.amIdleLabel = String(
          config.idleText !== undefined ? config.idleText : button.textContent
        ).trim();
        button.dataset.amPreviousMinInlineSize = button.style.minInlineSize || "";
      }
      if (!button.style.minInlineSize) {
        const width = button.getBoundingClientRect().width;
        if (width > 0) {
          button.style.minInlineSize = `${Math.ceil(width)}px`;
        }
      }
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.classList.add("is-busy");
      if (config.busyText) {
        button.textContent = config.busyText;
      }
      return;
    }

    button.disabled = false;
    button.setAttribute("aria-busy", "false");
    button.classList.remove("is-busy");
    button.textContent = String(
      config.idleText !== undefined
        ? config.idleText
        : button.dataset.amIdleLabel || button.textContent
    ).trim();
    delete button.dataset.amIdleLabel;
    const previousMinInlineSize = button.dataset.amPreviousMinInlineSize || "";
    if (previousMinInlineSize) {
      button.style.minInlineSize = previousMinInlineSize;
    } else {
      button.style.removeProperty("min-inline-size");
    }
    delete button.dataset.amPreviousMinInlineSize;
  }

  function setSectionState(elements, nextState) {
    const config = elements || {};
    const stateElement = config.stateElement || config.state || null;
    const dataElement = config.dataElement || config.data || null;
    const section = config.section
      || (stateElement && stateElement.closest("section"))
      || (dataElement && dataElement.closest("section"));
    const state = SECTION_STATES.includes(nextState) ? nextState : "error";
    const busy = state === "loading" || state === "refreshing";
    const showData = state === "data" || state === "refreshing";

    if (stateElement) {
      stateElement.classList.remove(...SECTION_STATES);
      if (!showData) {
        stateElement.classList.add(state);
      }
      stateElement.hidden = showData;
    }

    if (dataElement) {
      dataElement.hidden = !showData;
    }

    if (config.refreshingElement) {
      config.refreshingElement.hidden = state !== "refreshing";
    }

    if (section) {
      section.setAttribute("aria-busy", String(busy));
      section.dataset.sectionState = state;
      section.classList.toggle("is-refreshing", state === "refreshing");
    }

    return state;
  }

  window.AMUI = Object.freeze({
    dismissToast,
    prefersReducedMotion,
    setButtonBusy,
    setSectionState,
    toast
  });

  document.documentElement.classList.add("am-ui-ready");
})();

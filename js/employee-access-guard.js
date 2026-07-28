(function () {
  "use strict";

  const STORAGE_PREFIX = "am-employee-module-unlock:v1:";
  const CHANNEL_NAME = "am-employee-module-access:v1";
  const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
  const SERVER_TOUCH_INTERVAL_MS = 2 * 60 * 1000;
  const PEER_WAIT_MS = 180;
  const REVOKE_TIMEOUT_MS = 900;
  const EMPLOYEES_PAGE = "employees.html";
  const DASHBOARD_PAGE = "dashboard.html";
  const GENERIC_ERROR = "Không thể xác thực quyền truy cập lúc này.";
  const WRONG_PIN_ERROR = "Mã PIN không đúng.";
  const DEFAULT_LOCKED_ERROR = "Bạn đã nhập sai nhiều lần. Vui lòng thử lại sau 60 giây.";

  const state = {
    userId: "",
    entry: null,
    unlocked: false,
    protectedRoute: false,
    lastServerValidationAt: 0,
    expiryTimer: null,
    modal: null,
    listeners: new Set(),
    activityBound: false,
    channel: null,
    instanceId: "",
    pendingPeerRequests: new Map(),
    authSubscription: null
  };

  function currentPageName() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    return (parts.pop() || "index.html").toLowerCase();
  }

  function createOpaqueId() {
    if (!window.crypto || typeof window.crypto.randomUUID !== "function") {
      throw new Error(GENERIC_ERROR);
    }
    return window.crypto.randomUUID();
  }

  function storageKey(userId) {
    return `${STORAGE_PREFIX}${String(userId || "").trim()}`;
  }

  function parseTimestamp(value) {
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function sanitizeEntry(value, expectedUserId) {
    if (!value || typeof value !== "object") {
      return null;
    }

    const entry = {
      userId: String(value.userId || "").trim(),
      token: String(value.token || "").trim(),
      expiresAt: String(value.expiresAt || "").trim(),
      absoluteExpiresAt: String(value.absoluteExpiresAt || "").trim(),
      localIdleExpiresAt: String(value.localIdleExpiresAt || "").trim(),
      pinVersion: Number(value.pinVersion) || 0,
      verifiedAt: String(value.verifiedAt || "").trim()
    };

    if (
      !entry.userId
      || entry.userId !== String(expectedUserId || "").trim()
      || entry.token.length < 32
      || !parseTimestamp(entry.expiresAt)
      || !parseTimestamp(entry.absoluteExpiresAt)
      || !parseTimestamp(entry.localIdleExpiresAt)
      || entry.pinVersion < 1
    ) {
      return null;
    }

    return entry;
  }

  function removeStoredEntriesExcept(currentUserId) {
    const keepUserId = String(currentUserId || "").trim();
    try {
      for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
        const key = sessionStorage.key(index);
        if (!key || !key.startsWith(STORAGE_PREFIX)) {
          continue;
        }
        if (!keepUserId || key !== storageKey(keepUserId)) {
          sessionStorage.removeItem(key);
        }
      }
    } catch (error) {
      // A blocked storage API must not grant access.
    }
  }

  function readStoredEntry(userId) {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) {
      return null;
    }

    try {
      const parsed = JSON.parse(sessionStorage.getItem(storageKey(normalizedUserId)) || "null");
      const entry = sanitizeEntry(parsed, normalizedUserId);
      if (!entry) {
        sessionStorage.removeItem(storageKey(normalizedUserId));
      }
      return entry;
    } catch (error) {
      try {
        sessionStorage.removeItem(storageKey(normalizedUserId));
      } catch (storageError) {
        // Access remains locked.
      }
      return null;
    }
  }

  function writeStoredEntry(entry) {
    const safeEntry = sanitizeEntry(entry, entry && entry.userId);
    if (!safeEntry) {
      return false;
    }

    try {
      sessionStorage.setItem(storageKey(safeEntry.userId), JSON.stringify(safeEntry));
      return true;
    } catch (error) {
      return false;
    }
  }

  function clearExpiryTimer() {
    if (state.expiryTimer) {
      window.clearTimeout(state.expiryTimer);
      state.expiryTimer = null;
    }
  }

  function dispatchAccessChange(unlocked, reason) {
    const detail = {
      unlocked: Boolean(unlocked),
      reason: String(reason || "")
    };

    state.listeners.forEach((listener) => {
      try {
        listener(detail);
      } catch (error) {
        // A consumer cannot break the access boundary.
      }
    });

    document.dispatchEvent(new CustomEvent("am:employee-access-change", { detail }));
  }

  function broadcast(message) {
    if (!state.channel) {
      return;
    }
    try {
      state.channel.postMessage(Object.assign({
        senderId: state.instanceId
      }, message || {}));
    } catch (error) {
      // BroadcastChannel is an enhancement, not an access authority.
    }
  }

  function clearLocalUnlock(reason, options) {
    const settings = options || {};
    const previousUserId = state.userId || (state.entry && state.entry.userId) || "";
    clearExpiryTimer();
    state.entry = null;
    state.unlocked = false;
    state.lastServerValidationAt = 0;

    if (settings.allUsers) {
      removeStoredEntriesExcept("");
    } else if (previousUserId) {
      try {
        sessionStorage.removeItem(storageKey(previousUserId));
      } catch (error) {
        // Access remains locked in memory.
      }
    }

    if (settings.broadcast !== false && previousUserId) {
      broadcast({
        type: "lock",
        userId: previousUserId,
        reason: String(reason || "locked")
      });
    }

    dispatchAccessChange(false, reason || "locked");
  }

  function isEntryLocallyCurrent(entry) {
    if (!entry) {
      return false;
    }
    const now = Date.now();
    return parseTimestamp(entry.expiresAt) > now
      && parseTimestamp(entry.absoluteExpiresAt) > now
      && parseTimestamp(entry.localIdleExpiresAt) > now;
  }

  function scheduleExpiry() {
    clearExpiryTimer();
    if (!state.unlocked || !state.entry) {
      return;
    }

    const deadline = Math.min(
      parseTimestamp(state.entry.expiresAt),
      parseTimestamp(state.entry.absoluteExpiresAt),
      parseTimestamp(state.entry.localIdleExpiresAt)
    );
    const delay = Math.max(deadline - Date.now(), 0);
    state.expiryTimer = window.setTimeout(() => {
      clearLocalUnlock("expired");
      if (state.protectedRoute) {
        openPinModal({ mode: "route", initialError: "" }).catch(() => {});
      }
    }, Math.min(delay + 25, 2147483647));
  }

  function entryFromVerification(userId, result) {
    const now = Date.now();
    const absoluteExpiresAt = String(result && result.absolute_expires_at || "");
    const serverExpiresAt = String(result && result.expires_at || "");
    const localIdleDeadline = Math.min(
      now + INACTIVITY_TIMEOUT_MS,
      parseTimestamp(serverExpiresAt),
      parseTimestamp(absoluteExpiresAt)
    );

    return sanitizeEntry({
      userId,
      token: result && result.unlock_token,
      expiresAt: serverExpiresAt,
      absoluteExpiresAt,
      localIdleExpiresAt: new Date(localIdleDeadline).toISOString(),
      pinVersion: result && result.pin_version,
      verifiedAt: new Date(now).toISOString()
    }, userId);
  }

  function entryFromValidation(previousEntry, result) {
    const now = Date.now();
    const absoluteExpiresAt = String(result && result.absolute_expires_at || "");
    const serverExpiresAt = String(result && result.expires_at || "");
    const localIdleDeadline = Math.min(
      now + INACTIVITY_TIMEOUT_MS,
      parseTimestamp(serverExpiresAt),
      parseTimestamp(absoluteExpiresAt)
    );

    return sanitizeEntry({
      userId: previousEntry && previousEntry.userId,
      token: previousEntry && previousEntry.token,
      expiresAt: serverExpiresAt,
      absoluteExpiresAt,
      localIdleExpiresAt: new Date(localIdleDeadline).toISOString(),
      pinVersion: result && result.pin_version,
      verifiedAt: new Date(now).toISOString()
    }, previousEntry && previousEntry.userId);
  }

  function acceptEntry(entry, reason, options) {
    const settings = options || {};
    const safeEntry = sanitizeEntry(entry, entry && entry.userId);
    if (!safeEntry || !isEntryLocallyCurrent(safeEntry) || !writeStoredEntry(safeEntry)) {
      clearLocalUnlock("storage_unavailable", { broadcast: false });
      return false;
    }

    state.userId = safeEntry.userId;
    state.entry = safeEntry;
    state.unlocked = true;
    state.lastServerValidationAt = Date.now();
    scheduleExpiry();

    if (settings.broadcast !== false) {
      broadcast({
        type: "unlock",
        userId: safeEntry.userId,
        entry: safeEntry
      });
    }

    dispatchAccessChange(true, reason || "verified");
    return true;
  }

  async function currentUserId() {
    if (!window.AMApi || typeof window.AMApi.getCurrentUser !== "function") {
      throw new Error(GENERIC_ERROR);
    }
    const user = await window.AMApi.getCurrentUser();
    const userId = String(user && user.id || "").trim();
    if (!userId) {
      throw new Error(GENERIC_ERROR);
    }

    if (state.userId && state.userId !== userId) {
      clearLocalUnlock("auth_changed", { allUsers: true });
    }
    state.userId = userId;
    removeStoredEntriesExcept(userId);
    return userId;
  }

  async function validateEntry(entry, options) {
    const settings = options || {};
    if (!entry || !isEntryLocallyCurrent(entry)) {
      clearLocalUnlock("expired", { broadcast: settings.broadcast !== false });
      return false;
    }

    const result = await window.AMApi.validateEmployeeModuleUnlock(entry.token);
    if (!result || result.success !== true) {
      clearLocalUnlock("invalid_session", { broadcast: settings.broadcast !== false });
      return false;
    }

    const refreshed = entryFromValidation(entry, result);
    return acceptEntry(refreshed, settings.reason || "validated", {
      broadcast: settings.broadcast !== false
    });
  }

  function waitForPeerEntry(userId) {
    if (!state.channel) {
      return Promise.resolve(null);
    }

    let requestId;
    try {
      requestId = createOpaqueId();
    } catch (error) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      const timeoutId = window.setTimeout(() => {
        state.pendingPeerRequests.delete(requestId);
        resolve(null);
      }, PEER_WAIT_MS);

      state.pendingPeerRequests.set(requestId, (entry) => {
        window.clearTimeout(timeoutId);
        state.pendingPeerRequests.delete(requestId);
        resolve(sanitizeEntry(entry, userId));
      });

      broadcast({
        type: "request-state",
        requestId,
        userId
      });
    });
  }

  async function findAndValidateUnlock(userId) {
    let entry = readStoredEntry(userId);
    if (!entry) {
      entry = await waitForPeerEntry(userId);
      if (entry) {
        writeStoredEntry(entry);
      }
    }

    if (!entry) {
      return false;
    }

    return validateEntry(entry, { reason: "restored" });
  }

  function lockMessage(seconds) {
    const remaining = Math.max(Math.ceil(Number(seconds) || 0), 1);
    if (remaining === 60) {
      return DEFAULT_LOCKED_ERROR;
    }
    return `Bạn đã nhập sai nhiều lần. Vui lòng thử lại sau ${remaining} giây.`;
  }

  function createElement(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) {
      node.className = className;
    }
    if (text !== undefined && text !== null) {
      node.textContent = String(text);
    }
    return node;
  }

  function focusableElements(root) {
    return Array.from(root.querySelectorAll(
      "button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"
    )).filter((node) => node.offsetParent !== null);
  }

  function openPinModal(options) {
    const settings = options || {};
    const mode = settings.mode === "route" ? "route" : "menu";

    if (state.modal) {
      if (mode === "route") {
        state.modal.mode = "route";
      }
      if (settings.initialError) {
        state.modal.showError(settings.initialError);
      }
      state.modal.input.focus({ preventScroll: true });
      return state.modal.promise;
    }

    const returnFocus = settings.returnFocus || document.activeElement;
    const pageShell = document.querySelector(".page-shell");
    const backdrop = createElement("div", "employee-access-backdrop");
    const dialog = createElement("section", "employee-access-dialog");
    const header = createElement("header", "employee-access-dialog__header");
    const icon = createElement("span", "employee-access-dialog__icon");
    const headingCopy = createElement("div");
    const title = createElement("h2", "", "Xác thực quyền truy cập");
    const description = createElement(
      "p",
      "",
      "Nhập mã PIN 6 số để mở module Nhân viên."
    );
    const form = createElement("form", "employee-access-form");
    const label = createElement("label", "employee-access-field");
    const labelText = createElement("span", "", "Mã PIN");
    const inputRow = createElement("span", "employee-access-input-row");
    const input = document.createElement("input");
    const visibilityButton = createElement("button", "employee-access-visibility", "Hiện");
    const errorMessage = createElement("p", "employee-access-error");
    const actions = createElement("div", "employee-access-actions");
    const cancelButton = createElement("button", "btn secondary", "Hủy");
    const submitButton = createElement("button", "btn primary", "Mở khóa");
    const titleId = "employeeAccessDialogTitle";
    const descriptionId = "employeeAccessDialogDescription";
    const errorId = "employeeAccessDialogError";
    let busy = false;
    let cooldownTimer = null;
    let verificationRequestId = "";
    let resolvePromise;

    icon.setAttribute("aria-hidden", "true");
    icon.append(
      createElement("span", "employee-access-dialog__lock-body"),
      createElement("span", "employee-access-dialog__lock-shackle")
    );
    title.id = titleId;
    description.id = descriptionId;
    headingCopy.append(title, description);
    header.append(icon, headingCopy);

    input.type = "password";
    input.name = "employee_pin";
    input.inputMode = "numeric";
    input.autocomplete = "one-time-code";
    input.maxLength = 6;
    input.minLength = 6;
    input.pattern = "[0-9]{6}";
    input.required = true;
    input.setAttribute("aria-describedby", errorId);
    input.setAttribute("aria-label", "Mã PIN 6 số");
    visibilityButton.type = "button";
    visibilityButton.setAttribute("aria-label", "Hiện mã PIN");
    visibilityButton.setAttribute("aria-pressed", "false");
    inputRow.append(input, visibilityButton);
    label.append(labelText, inputRow);

    errorMessage.id = errorId;
    errorMessage.setAttribute("role", "alert");
    errorMessage.setAttribute("aria-live", "assertive");
    errorMessage.hidden = true;

    cancelButton.type = "button";
    submitButton.type = "submit";
    actions.append(cancelButton, submitButton);
    form.append(label, errorMessage, actions);

    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", titleId);
    dialog.setAttribute("aria-describedby", descriptionId);
    dialog.tabIndex = -1;
    dialog.append(header, form);
    backdrop.appendChild(dialog);

    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    function clearCooldown() {
      if (cooldownTimer) {
        window.clearInterval(cooldownTimer);
        cooldownTimer = null;
      }
    }

    function showError(message) {
      errorMessage.textContent = String(message || "");
      errorMessage.hidden = !message;
    }

    function setBusy(nextBusy) {
      busy = Boolean(nextBusy);
      input.disabled = busy;
      visibilityButton.disabled = busy;
      cancelButton.disabled = busy;
      submitButton.disabled = busy;
      submitButton.textContent = busy ? "Đang xác thực..." : "Mở khóa";
      form.setAttribute("aria-busy", String(busy));
    }

    function startCooldown(seconds) {
      clearCooldown();
      let remaining = Math.max(Math.ceil(Number(seconds) || 60), 1);
      input.disabled = true;
      submitButton.disabled = true;
      showError(lockMessage(remaining));

      cooldownTimer = window.setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          clearCooldown();
          input.disabled = false;
          submitButton.disabled = false;
          showError("");
          input.focus({ preventScroll: true });
          return;
        }
        showError(lockMessage(remaining));
      }, 1000);
    }

    function cleanup() {
      clearCooldown();
      input.value = "";
      backdrop.remove();
      document.body.classList.remove("employee-access-modal-open");
      if (pageShell) {
        pageShell.inert = false;
      }
      if (state.modal && state.modal.backdrop === backdrop) {
        state.modal = null;
      }
    }

    function finish(result, closeOptions) {
      const finishOptions = closeOptions || {};
      cleanup();
      resolvePromise(Boolean(result));
      if (
        finishOptions.restoreFocus !== false
        && returnFocus
        && document.contains(returnFocus)
      ) {
        returnFocus.focus({ preventScroll: true });
      }
    }

    function cancel() {
      if (busy) {
        return;
      }
      if (state.modal && state.modal.mode === "route") {
        finish(false, { restoreFocus: false });
        window.location.replace(DASHBOARD_PAGE);
        return;
      }
      finish(false);
    }

    visibilityButton.addEventListener("click", () => {
      const shouldShow = input.type === "password";
      input.type = shouldShow ? "text" : "password";
      visibilityButton.textContent = shouldShow ? "Ẩn" : "Hiện";
      visibilityButton.setAttribute("aria-label", shouldShow ? "Ẩn mã PIN" : "Hiện mã PIN");
      visibilityButton.setAttribute("aria-pressed", String(shouldShow));
      input.focus({ preventScroll: true });
    });

    input.addEventListener("input", () => {
      const digits = input.value.replace(/\D+/g, "").slice(0, 6);
      if (input.value !== digits) {
        input.value = digits;
      }
      if (!busy && errorMessage.textContent === WRONG_PIN_ERROR) {
        showError("");
      }
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy || input.disabled) {
        return;
      }

      const pin = input.value.replace(/\D+/g, "").slice(0, 6);
      if (!/^[0-9]{6}$/.test(pin)) {
        showError("Vui lòng nhập đủ 6 số.");
        input.focus({ preventScroll: true });
        return;
      }

      try {
        if (!verificationRequestId) {
          verificationRequestId = createOpaqueId();
        }
        setBusy(true);
        showError("");
        const result = await window.AMApi.verifyEmployeeModulePin(pin, verificationRequestId);

        if (result && result.success === true) {
          const entry = entryFromVerification(state.userId, result);
          verificationRequestId = "";
          input.value = "";
          if (!entry || !acceptEntry(entry, "pin_verified")) {
            throw new Error(GENERIC_ERROR);
          }
          finish(true, { restoreFocus: false });
          return;
        }

        verificationRequestId = "";
        input.value = "";
        if (result && result.result_code === "locked") {
          setBusy(false);
          startCooldown(result.retry_after_seconds || 60);
          return;
        }

        setBusy(false);
        showError(WRONG_PIN_ERROR);
        input.focus({ preventScroll: true });
      } catch (error) {
        setBusy(false);
        input.value = "";
        showError(GENERIC_ERROR);
        input.focus({ preventScroll: true });
      }
    });

    cancelButton.addEventListener("click", cancel);
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop && state.modal && state.modal.mode !== "route") {
        cancel();
      }
    });
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (state.modal && state.modal.mode !== "route") {
          cancel();
        }
        return;
      }

      if (event.key !== "Tab") {
        return;
      }
      const focusable = focusableElements(dialog);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    });

    state.modal = {
      backdrop,
      dialog,
      input,
      mode,
      promise,
      showError,
      cancel,
      completeFromPeer: function () {
        finish(true, { restoreFocus: false });
      }
    };

    document.body.appendChild(backdrop);
    document.body.classList.add("employee-access-modal-open");
    if (pageShell) {
      pageShell.inert = true;
    }
    if (settings.initialError) {
      showError(settings.initialError);
    }
    window.requestAnimationFrame(() => input.focus({ preventScroll: true }));
    return promise;
  }

  async function requireUnlock(options) {
    const settings = options || {};
    const mode = settings.mode === "route" ? "route" : "menu";
    if (mode === "route") {
      state.protectedRoute = true;
    }

    let userId;
    try {
      userId = await currentUserId();
    } catch (error) {
      return openPinModal({
        mode,
        returnFocus: settings.returnFocus,
        initialError: GENERIC_ERROR
      });
    }

    try {
      if (state.unlocked && state.entry && state.entry.userId === userId) {
        if (await validateEntry(state.entry, { reason: "revalidated" })) {
          return true;
        }
      } else if (await findAndValidateUnlock(userId)) {
        return true;
      }
    } catch (error) {
      return openPinModal({
        mode,
        returnFocus: settings.returnFocus,
        initialError: GENERIC_ERROR
      });
    }

    return openPinModal({
      mode,
      returnFocus: settings.returnFocus,
      initialError: ""
    });
  }

  async function validateCurrentUnlock() {
    if (!state.unlocked || !state.entry) {
      return false;
    }
    try {
      const valid = await validateEntry(state.entry, { reason: "activity" });
      if (!valid && state.protectedRoute) {
        openPinModal({ mode: "route", initialError: "" }).catch(() => {});
      }
      return valid;
    } catch (error) {
      clearLocalUnlock("validation_error");
      if (state.protectedRoute) {
        openPinModal({ mode: "route", initialError: GENERIC_ERROR }).catch(() => {});
      }
      return false;
    }
  }

  function handleProtectedActivity() {
    if (!state.protectedRoute || !state.unlocked || !state.entry) {
      return;
    }

    const now = Date.now();
    const localIdleDeadline = Math.min(
      now + INACTIVITY_TIMEOUT_MS,
      parseTimestamp(state.entry.expiresAt),
      parseTimestamp(state.entry.absoluteExpiresAt)
    );
    state.entry.localIdleExpiresAt = new Date(localIdleDeadline).toISOString();
    writeStoredEntry(state.entry);
    scheduleExpiry();

    if (now - state.lastServerValidationAt >= SERVER_TOUCH_INTERVAL_MS) {
      state.lastServerValidationAt = now;
      validateCurrentUnlock().catch(() => {});
    }
  }

  function bindProtectedActivity() {
    if (state.activityBound) {
      return;
    }
    state.activityBound = true;
    ["pointerdown", "keydown", "input"].forEach((eventName) => {
      document.addEventListener(eventName, handleProtectedActivity, { passive: true });
    });
    window.addEventListener("scroll", handleProtectedActivity, { passive: true });
  }

  async function beforeSignOut() {
    const entry = state.entry || readStoredEntry(state.userId);
    const token = entry && entry.token;
    clearLocalUnlock("logout", { allUsers: true });

    if (!token || !window.AMApi || typeof window.AMApi.revokeEmployeeModuleUnlock !== "function") {
      return;
    }

    await Promise.race([
      window.AMApi.revokeEmployeeModuleUnlock(token).catch(() => false),
      new Promise((resolve) => window.setTimeout(resolve, REVOKE_TIMEOUT_MS))
    ]);
  }

  async function lockModule() {
    await beforeSignOut();
    if (state.protectedRoute) {
      openPinModal({ mode: "route", initialError: "" }).catch(() => {});
    }
  }

  function subscribe(listener) {
    if (typeof listener !== "function") {
      return function () {};
    }
    state.listeners.add(listener);
    return function () {
      state.listeners.delete(listener);
    };
  }

  function setupBroadcastChannel() {
    if (typeof window.BroadcastChannel !== "function") {
      return;
    }

    try {
      state.instanceId = createOpaqueId();
      state.channel = new BroadcastChannel(CHANNEL_NAME);
      state.channel.addEventListener("message", (event) => {
        const message = event.data || {};
        if (!message || message.senderId === state.instanceId) {
          return;
        }

        if (
          message.type === "request-state"
          && state.unlocked
          && state.entry
          && state.entry.userId === message.userId
          && isEntryLocallyCurrent(state.entry)
        ) {
          broadcast({
            type: "state",
            requestId: message.requestId,
            userId: state.entry.userId,
            entry: state.entry
          });
          return;
        }

        if (message.type === "state" && message.requestId) {
          const resolver = state.pendingPeerRequests.get(message.requestId);
          if (resolver) {
            resolver(message.entry || null);
          }
          return;
        }

        if (
          message.type === "lock"
          && (!state.userId || message.userId === state.userId)
        ) {
          clearLocalUnlock(message.reason || "peer_locked", { broadcast: false });
          if (state.protectedRoute) {
            openPinModal({ mode: "route", initialError: "" }).catch(() => {});
          }
          return;
        }

        if (
          message.type === "unlock"
          && message.userId
          && message.userId === state.userId
          && !state.unlocked
        ) {
          const candidate = sanitizeEntry(message.entry, state.userId);
          if (candidate) {
            writeStoredEntry(candidate);
            validateEntry(candidate, {
              reason: "peer_unlocked",
              broadcast: false
            }).then((unlocked) => {
              if (
                unlocked
                && state.modal
                && typeof state.modal.completeFromPeer === "function"
              ) {
                state.modal.completeFromPeer();
              }
            }).catch(() => {});
          }
        }
      });
    } catch (error) {
      state.channel = null;
    }
  }

  function setupAuthSync() {
    if (!window.AMApi || typeof window.AMApi.getClient !== "function") {
      return;
    }
    try {
      const client = window.AMApi.getClient();
      if (!client.auth || typeof client.auth.onAuthStateChange !== "function") {
        return;
      }
      const response = client.auth.onAuthStateChange((_event, session) => {
        const nextUserId = String(session && session.user && session.user.id || "").trim();
        if (!nextUserId || (state.userId && nextUserId !== state.userId)) {
          clearLocalUnlock("auth_changed", { allUsers: true });
        }
        state.userId = nextUserId;
      });
      state.authSubscription = response && response.data && response.data.subscription;
    } catch (error) {
      // The primary auth guard remains authoritative.
    }
  }

  setupBroadcastChannel();
  setupAuthSync();
  bindProtectedActivity();

  window.addEventListener("pageshow", (event) => {
    if (event.persisted && state.protectedRoute) {
      requireUnlock({ mode: "route" }).catch(() => {
        openPinModal({ mode: "route", initialError: GENERIC_ERROR }).catch(() => {});
      });
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.protectedRoute && state.unlocked) {
      validateCurrentUnlock().catch(() => {});
    }
  });

  window.AMEmployeeAccess = Object.freeze({
    requireUnlock,
    requireRouteUnlock: function () {
      return requireUnlock({ mode: "route" });
    },
    beforeSignOut,
    lockModule,
    subscribe,
    hasLocalUnlock: function () {
      return Boolean(state.unlocked && state.entry && isEntryLocallyCurrent(state.entry));
    }
  });

  if (currentPageName() === EMPLOYEES_PAGE) {
    state.protectedRoute = true;
  }
})();

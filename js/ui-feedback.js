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
  const workflowActionLocks = new Set();
  let repairDialogState = null;
  let repairReturnDialogState = null;
  const repairReturnProgress = new Map();

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

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);

    if (className) {
      element.className = className;
    }

    if (text !== undefined) {
      element.textContent = text;
    }

    return element;
  }

  function renderWorkflowTicketSummary(container, ticket, resultLabel) {
    const source = ticket || {};
    const rows = [
      ["Mã phiếu", window.AMApi.formatTicketCode(source.ticket_code)],
      ["Khách hàng", source.customer_name || source.customer_master_name || "—"],
      ["Thiết bị", [source.brand, source.model].filter(Boolean).join(" ") || "—"],
      ["Kết quả", resultLabel]
    ];

    container.replaceChildren();
    rows.forEach(([label, value]) => {
      const row = createElement("div", "workflow-confirm-summary-item");
      row.append(
        createElement("span", "", label),
        createElement("strong", "", value || "—")
      );
      container.appendChild(row);
    });
  }

  function ensureRepairCompletionDialog() {
    if (repairDialogState) {
      return repairDialogState;
    }

    const backdrop = createElement("div", "workflow-confirm-backdrop no-print");
    const dialog = createElement("section", "workflow-confirm-dialog");
    const title = createElement("h2", "", "Hoàn thành sửa chữa?");
    const description = createElement(
      "p",
      "",
      "Tivi sẽ được chuyển sang khu Bàn giao tivi. Thao tác này chưa đánh dấu khách đã nhận máy và chưa hoàn tất phiếu."
    );
    const summary = createElement("div", "workflow-confirm-summary");
    const warrantyNote = createElement(
      "p",
      "workflow-confirm-note",
      "Thông tin giao/trả và bảo hành được nhập, lưu ở bước bàn giao cuối cùng."
    );
    const actions = createElement("div", "workflow-confirm-actions");
    const cancel = createElement("button", "btn secondary", "Huỷ");
    const confirm = createElement("button", "btn primary", "Chuyển sang bàn giao");

    backdrop.id = "sharedReadyHandoverModal";
    backdrop.hidden = true;
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "sharedReadyHandoverTitle");
    dialog.setAttribute("aria-describedby", "sharedReadyHandoverDescription");
    dialog.tabIndex = -1;
    title.id = "sharedReadyHandoverTitle";
    description.id = "sharedReadyHandoverDescription";
    cancel.type = "button";
    confirm.type = "button";
    actions.append(cancel, confirm);
    dialog.append(title, description, summary, warrantyNote, actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    repairDialogState = {
      backdrop,
      dialog,
      cancel,
      confirm,
      summary,
      returnFocus: null,
      resolve: null
    };

    function close(result) {
      const state = repairDialogState;

      if (!state || state.backdrop.hidden || !state.resolve) {
        return;
      }

      const resolve = state.resolve;
      const returnFocus = state.returnFocus;
      state.resolve = null;
      state.returnFocus = null;
      state.backdrop.hidden = true;
      document.body.classList.remove("workflow-modal-open");

      if (returnFocus && document.contains(returnFocus)) {
        returnFocus.focus({ preventScroll: true });
      }

      resolve(result);
    }

    cancel.addEventListener("click", () => close(false));
    confirm.addEventListener("click", () => close(true));
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        close(false);
      }
    });
    backdrop.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(false);
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusable = [cancel, confirm].filter((element) => !element.disabled);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (!first || !last) {
        event.preventDefault();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    });

    repairDialogState.close = close;
    return repairDialogState;
  }

  function confirmRepairCompletion(trigger, ticket) {
    const state = ensureRepairCompletionDialog();

    if (state.resolve) {
      return Promise.resolve(false);
    }

    state.returnFocus = trigger instanceof HTMLElement ? trigger : document.activeElement;
    renderWorkflowTicketSummary(state.summary, ticket, "Đã sửa hoàn tất");
    state.backdrop.hidden = false;
    document.body.classList.add("workflow-modal-open");
    state.dialog.focus({ preventScroll: true });

    return new Promise((resolve) => {
      state.resolve = resolve;
    });
  }

  function ensureRepairReturnDialog() {
    if (repairReturnDialogState) {
      return repairReturnDialogState;
    }

    const backdrop = createElement("div", "workflow-confirm-backdrop no-print");
    const dialog = createElement("form", "workflow-confirm-dialog workflow-return-dialog");
    const title = createElement("h2", "", "Giao trả sửa chữa");
    const description = createElement(
      "p",
      "",
      "Ghi nhận lý do không hoàn tất sửa chữa và chuyển tivi sang khu Bàn giao. Phiếu chưa được đánh dấu đã giao khách."
    );
    const summary = createElement("div", "workflow-confirm-summary");
    const reasonField = createElement("label", "workflow-return-field");
    const reasonLabel = createElement("span", "", "Lý do");
    const reason = document.createElement("select");
    const detailField = createElement("label", "workflow-return-field");
    const detailLabel = createElement("span", "", "Chi tiết bổ sung");
    const detail = document.createElement("textarea");
    const error = createElement("p", "workflow-return-error");
    const actions = createElement("div", "workflow-confirm-actions");
    const cancel = createElement("button", "btn secondary", "Huỷ");
    const confirm = createElement("button", "btn primary", "Chuyển sang bàn giao");
    const reasons = [
      "",
      "Không sửa được",
      "Không có linh kiện",
      "Khách không đồng ý chi phí",
      "Khách yêu cầu lấy lại máy",
      "Không phát hiện lỗi",
      "Lỗi không ổn định",
      "Khác"
    ];

    backdrop.id = "sharedRepairReturnModal";
    backdrop.hidden = true;
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "sharedRepairReturnTitle");
    dialog.setAttribute("aria-describedby", "sharedRepairReturnDescription");
    title.id = "sharedRepairReturnTitle";
    description.id = "sharedRepairReturnDescription";
    reason.id = "sharedRepairReturnReason";
    detail.id = "sharedRepairReturnDetail";
    detail.rows = 4;
    detail.maxLength = 1000;
    detail.placeholder = "Mô tả ngắn để nhân viên bàn giao nắm được tình hình...";
    error.setAttribute("role", "alert");
    error.hidden = true;
    cancel.type = "button";
    confirm.type = "submit";

    reasons.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value || "Chọn lý do";
      reason.appendChild(option);
    });

    reasonField.append(reasonLabel, reason);
    detailField.append(detailLabel, detail);
    actions.append(cancel, confirm);
    dialog.append(title, description, summary, reasonField, detailField, error, actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    repairReturnDialogState = {
      backdrop,
      dialog,
      summary,
      reason,
      detail,
      error,
      cancel,
      confirm,
      resolve: null,
      returnFocus: null
    };

    function close(result) {
      const state = repairReturnDialogState;

      if (!state || state.backdrop.hidden || !state.resolve) {
        return;
      }

      const resolve = state.resolve;
      const returnFocus = state.returnFocus;
      state.resolve = null;
      state.returnFocus = null;
      state.backdrop.hidden = true;
      document.body.classList.remove("workflow-modal-open");

      if (returnFocus && document.contains(returnFocus)) {
        returnFocus.focus({ preventScroll: true });
      }

      resolve(result);
    }

    cancel.addEventListener("click", () => close(null));
    dialog.addEventListener("submit", (event) => {
      event.preventDefault();
      const reasonValue = reason.value.trim();
      const detailValue = detail.value.trim();

      if (!reasonValue) {
        error.textContent = "Vui lòng chọn lý do giao trả.";
        error.hidden = false;
        reason.focus({ preventScroll: true });
        return;
      }

      if (reasonValue === "Khác" && !detailValue) {
        error.textContent = "Vui lòng nhập chi tiết cho lý do khác.";
        error.hidden = false;
        detail.focus({ preventScroll: true });
        return;
      }

      close({ reason: reasonValue, detail: detailValue });
    });
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        close(null);
      }
    });
    backdrop.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(null);
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusable = Array.from(dialog.querySelectorAll("select, textarea, button:not([disabled])"));
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

    return repairReturnDialogState;
  }

  function collectRepairReturnDetails(trigger, ticket, initialDetails) {
    const state = ensureRepairReturnDialog();
    const initial = initialDetails || {};

    if (state.resolve) {
      return Promise.resolve(null);
    }

    state.returnFocus = trigger instanceof HTMLElement ? trigger : document.activeElement;
    state.reason.value = initial.reason || "";
    state.detail.value = initial.detail || "";
    state.error.textContent = "";
    state.error.hidden = true;
    renderWorkflowTicketSummary(state.summary, ticket, "Giao trả sửa chữa");
    state.backdrop.hidden = false;
    document.body.classList.add("workflow-modal-open");
    state.reason.focus({ preventScroll: true });

    return new Promise((resolve) => {
      state.resolve = resolve;
    });
  }

  async function executeRepairReturn(options) {
    const config = options || {};
    const ticket = config.ticket || {};
    const ticketId = String(ticket.id || config.ticketId || "").trim();
    const details = {
      reason: String(config.reason || "").trim(),
      detail: String(config.detail || "").trim()
    };
    const action = "READY_FOR_HANDOVER";
    const repairOutcome = "returned_unrepaired";
    const progress = repairReturnProgress.get(ticketId);
    let updatedTicket = progress && progress.ticket ? progress.ticket : ticket;

    if (!ticketId) {
      throw new Error("Thiếu ID phiếu cho thao tác giao trả sửa chữa.");
    }

    try {
      if (!progress || progress.details.reason !== details.reason || progress.details.detail !== details.detail) {
        updatedTicket = await window.AMApi.saveRepairReturnReason(updatedTicket, details.reason, details.detail);
        repairReturnProgress.set(ticketId, { ticket: updatedTicket, details });
      }

      const requestId = window.AMApi.ensureWorkflowClientRequestId(ticketId, action, repairOutcome);
      const result = await window.AMApi.recordTicketWorkflowAction(ticketId, action, requestId, {
        repair_outcome: repairOutcome
      });
      window.AMApi.clearWorkflowClientRequestId(ticketId, action, repairOutcome);
      repairReturnProgress.delete(ticketId);

      return { ok: true, result, ticket: updatedTicket, details };
    } catch (error) {
      if (window.AMApi.shouldClearWorkflowClientRequestId(error)) {
        window.AMApi.clearWorkflowClientRequestId(ticketId, action, repairOutcome);
      }
      throw error;
    }
  }

  async function returnRepairInPlace(options) {
    const config = options || {};
    const ticket = config.ticket || {};
    const ticketId = String(ticket.id || config.ticketId || "").trim();
    const action = "READY_FOR_HANDOVER";
    const lockKey = `${ticketId}:${action}`;
    const button = config.button instanceof HTMLElement ? config.button : null;
    const progress = repairReturnProgress.get(ticketId);
    const workingTicket = progress && progress.ticket ? progress.ticket : ticket;
    const initialDetails = config.initialDetails || (progress && progress.details) || null;

    if (!ticketId || workflowActionLocks.has(lockKey)) {
      return { ok: false, ignored: true };
    }

    const details = await collectRepairReturnDetails(button, workingTicket, initialDetails);

    if (!details || workflowActionLocks.has(lockKey)) {
      return { ok: false, cancelled: !details };
    }

    workflowActionLocks.add(lockKey);
    setButtonBusy(button, true, {
      busyText: "Đang chuyển phiếu...",
      idleText: config.idleText || "Giao trả sửa chữa"
    });

    let updatedTicket = workingTicket;
    let retryDetails = null;
    let outcome = null;

    try {
      const response = await executeRepairReturn({
        ticket: workingTicket,
        reason: details.reason,
        detail: details.detail
      });
      const result = response.result;
      updatedTicket = response.ticket;

      let refreshError = null;

      if (typeof config.onSuccess === "function") {
        try {
          await config.onSuccess(result, { reason: details.reason, detail: details.detail, ticket: updatedTicket });
        } catch (error) {
          refreshError = error;
          toast("Phiếu đã chuyển sang Bàn giao tivi, nhưng vùng dữ liệu hiện tại chưa tải lại được.", {
            type: "warning",
            duration: 6000
          });
        }
      }

      if (result.assignment_warning) {
        toast(result.assignment_warning, {
          type: "warning",
          duration: 7000
        });
      }
      toast("Đã ghi nhận giao trả sửa chữa và chuyển phiếu sang Bàn giao tivi.", { type: "success" });
      outcome = { ok: true, result, refreshError };
    } catch (error) {
      toast(error.message || "Không thể chuyển phiếu sang Bàn giao tivi.", {
        type: "error",
        duration: 6500
      });
      retryDetails = details;
      outcome = { ok: false, error };
    } finally {
      workflowActionLocks.delete(lockKey);
      if (button && document.contains(button)) {
        setButtonBusy(button, false, { idleText: config.idleText || "Giao trả sửa chữa" });
      }
    }

    if (retryDetails && config.reopenOnError !== false) {
      return returnRepairInPlace(Object.assign({}, config, {
        ticket: updatedTicket,
        initialDetails: retryDetails
      }));
    }

    return outcome;
  }

  async function completeRepairInPlace(options) {
    const config = options || {};
    const ticketId = String(config.ticketId || "").trim();
    const action = "READY_FOR_HANDOVER";
    const repairOutcome = "repaired_successfully";
    const lockKey = `${ticketId}:${action}`;
    const button = config.button instanceof HTMLElement ? config.button : null;

    if (!ticketId || workflowActionLocks.has(lockKey)) {
      return { ok: false, ignored: true };
    }

    const confirmed = await confirmRepairCompletion(button, config.ticket);

    if (!confirmed || workflowActionLocks.has(lockKey)) {
      return { ok: false, cancelled: !confirmed };
    }

    workflowActionLocks.add(lockKey);
    setButtonBusy(button, true, {
      busyText: "Đang chuyển phiếu...",
      idleText: config.idleText || "Hoàn thành sửa chữa"
    });

    try {
      const requestId = window.AMApi.ensureWorkflowClientRequestId(ticketId, action, repairOutcome);
      const result = await window.AMApi.recordTicketWorkflowAction(ticketId, action, requestId, {
        repair_outcome: repairOutcome
      });
      window.AMApi.clearWorkflowClientRequestId(ticketId, action, repairOutcome);

      if (typeof config.onSuccess === "function") {
        try {
          await config.onSuccess(result);
        } catch (refreshError) {
          toast("Phiếu đã chuyển sang Bàn giao tivi, nhưng vùng dữ liệu hiện tại chưa tải lại được.", {
            type: "warning",
            duration: 6000
          });
          return { ok: true, result, refreshError };
        }
      }

      if (result.assignment_warning) {
        toast(result.assignment_warning, {
          type: "warning",
          duration: 7000
        });
      }
      toast(
        result.was_replayed
          ? "Phiếu đã ở khu Bàn giao tivi. Dữ liệu hiện tại đã được đồng bộ."
          : "Đã chuyển phiếu sang Bàn giao tivi.",
        { type: "success" }
      );
      return { ok: true, result };
    } catch (error) {
      if (window.AMApi.shouldClearWorkflowClientRequestId(error)) {
        window.AMApi.clearWorkflowClientRequestId(ticketId, action, repairOutcome);
      }

      toast(error.message || "Không thể chuyển phiếu sang Bàn giao tivi.", {
        type: "error",
        duration: 6000
      });
      return { ok: false, error };
    } finally {
      workflowActionLocks.delete(lockKey);
      if (button && document.contains(button)) {
        setButtonBusy(button, false, {
          idleText: config.idleText || "Hoàn thành sửa chữa"
        });
      }
    }
  }

  window.AMUI = Object.freeze({
    completeRepairInPlace,
    dismissToast,
    executeRepairReturn,
    prefersReducedMotion,
    setButtonBusy,
    setSectionState,
    returnRepairInPlace,
    toast
  });

  document.documentElement.classList.add("am-ui-ready");
})();

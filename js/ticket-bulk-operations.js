(function (root, factory) {
  "use strict";

  const api = factory(root && root.AMTicketBulkSelection);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.AMTicketBulkOperations = Object.freeze(api);
  }
})(typeof window !== "undefined" ? window : null, function (selectionApi) {
  "use strict";

  const STATES = Object.freeze({
    IDLE: "idle",
    SELECTING: "selecting",
    PREFLIGHTING: "preflighting",
    CONFIRMING: "confirming",
    EXECUTING: "executing",
    RESULT: "result"
  });
  const DISMISSAL_DECISIONS = Object.freeze({
    BLOCK: "block",
    CLOSE: "close",
    CONFIRM_DISCARD: "confirm-discard"
  });
  const REPAIR_RETURN_REASONS = Object.freeze([
    "Không sửa được",
    "Không có linh kiện",
    "Khách không đồng ý chi phí",
    "Khách yêu cầu lấy lại máy",
    "Không phát hiện lỗi",
    "Lỗi không ổn định",
    "Khác"
  ]);
  const REPAIR_RESULT_MAX_LENGTH = 500;
  const REPAIR_RESULT_PRESETS = Object.freeze([
    "Thay màn OK",
    "Sửa bo OK",
    "Thay LED nền OK",
    "Sửa nguồn OK",
    "Sửa main OK",
    "Khác"
  ]);

  const BULK_ACTIONS = Object.freeze({
    completeRepair: Object.freeze({
      key: "completeRepair",
      label: "Đã hoàn thành sửa chữa",
      status: "đang sửa",
      concurrency: 3,
      resultStatus: "chờ bàn giao"
    }),
    returnFromRepair: Object.freeze({
      key: "returnFromRepair",
      label: "Giao trả sửa chữa",
      status: "đang sửa",
      concurrency: 1,
      resultStatus: "chờ bàn giao",
      requiresReason: true
    })
  });

  function clean(value) {
    return String(value == null ? "" : value).trim();
  }

  function normalizeStatus(value) {
    if (selectionApi && typeof selectionApi.normalizeStatus === "function") {
      return selectionApi.normalizeStatus(value);
    }
    return clean(value).toLocaleLowerCase("vi-VN");
  }

  function value(ticket, camelName, snakeName) {
    return ticket && (ticket[camelName] || ticket[snakeName]) || "";
  }

  function ticketUuid(ticket) {
    return clean(ticket && (ticket.uuid || ticket.id));
  }

  function ticketCode(ticket) {
    return clean(ticket && (ticket.code || ticket.ticket_code)).toUpperCase();
  }

  function validateRepairResult(value) {
    const result = clean(value);
    if (!result) {
      return Object.freeze({ valid: false, value: "", message: "Vui lòng nhập kết quả sửa chữa." });
    }
    if (result.length > REPAIR_RESULT_MAX_LENGTH) {
      return Object.freeze({
        valid: false,
        value: result,
        message: `Kết quả sửa chữa không được vượt quá ${REPAIR_RESULT_MAX_LENGTH} ký tự.`
      });
    }
    return Object.freeze({ valid: true, value: result, message: "" });
  }

  function repairResultOverride(overrides, uuid) {
    if (overrides instanceof Map) {
      return { has: overrides.has(uuid), value: overrides.get(uuid) };
    }
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, uuid)) {
      return { has: true, value: overrides[uuid] };
    }
    return { has: false, value: "" };
  }

  function buildRepairResultExecutionPlan(plan, commonResult, overrides) {
    const source = Array.isArray(plan) ? plan : [];
    const issues = [];
    const seen = new Set();
    const items = source.map((item) => {
      const uuid = ticketUuid(item);
      const code = ticketCode(item);
      const override = repairResultOverride(overrides, uuid);
      const validation = validateRepairResult(override.has ? override.value : commonResult);

      if (!uuid) {
        issues.push(Object.freeze({ uuid: "", code, message: "Phiếu thiếu UUID hợp lệ." }));
      } else if (seen.has(uuid)) {
        issues.push(Object.freeze({ uuid, code, message: "Phiếu bị lặp UUID trong kế hoạch thực thi." }));
      } else {
        seen.add(uuid);
      }
      if (!validation.valid) {
        issues.push(Object.freeze({ uuid, code, message: validation.message }));
      }

      return Object.freeze(Object.assign({}, item, {
        uuid,
        code,
        repairResult: validation.value
      }));
    });

    return Object.freeze({
      valid: source.length > 0 && issues.length === 0,
      issues: Object.freeze(issues),
      plan: Object.freeze(items)
    });
  }

  function repairModalDismissalDecision(options) {
    const settings = options || {};
    if (settings.state === STATES.EXECUTING) {
      return DISMISSAL_DECISIONS.BLOCK;
    }
    if (!settings.protectedModal) {
      return DISMISSAL_DECISIONS.CLOSE;
    }
    if (settings.source === "backdrop") {
      return DISMISSAL_DECISIONS.BLOCK;
    }
    if (settings.dirty && (settings.source === "cancel" || settings.source === "escape")) {
      return DISMISSAL_DECISIONS.CONFIRM_DISCARD;
    }
    return DISMISSAL_DECISIONS.CLOSE;
  }

  function isActionEligible(ticket, actionKey) {
    const action = BULK_ACTIONS[actionKey];
    if (!action || !ticket || ticket.workflowAvailable === false || ticket.workflow_available === false) {
      return false;
    }

    const status = normalizeStatus(ticket.status);
    const completedAt = value(ticket, "completedAt", "completed_at");
    if (status !== action.status || completedAt) {
      return false;
    }

    if (actionKey === "completeRepair" || actionKey === "returnFromRepair") {
      return Boolean(value(ticket, "repairStartedAt", "repair_started_at"))
        && !value(ticket, "readyForHandoverAt", "ready_for_handover_at");
    }

    return false;
  }

  function enabledActionKeys(capabilities) {
    const source = capabilities || {};
    return Object.keys(BULK_ACTIONS).filter((key) => source[key] === true);
  }

  function buildSelectionTicket(ticket, options) {
    const source = ticket || {};
    const settings = options || {};
    const actionKeys = enabledActionKeys(settings.capabilities);
    const selectable = actionKeys.some((key) => isActionEligible(source, key));

    return Object.assign({}, source, {
      uuid: ticketUuid(source),
      code: ticketCode(source),
      groupId: clean(settings.groupId || source.groupId),
      groupSize: Number(settings.groupSize || source.groupSize) || 0,
      childIndex: Number(settings.childIndex || source.childIndex) || 0,
      sourcePage: clean(settings.sourcePage || source.sourcePage),
      selectable,
      disabledReason: selectable ? "" : "Phiếu này hiện không có thao tác hàng loạt khả dụng."
    });
  }

  function createControlledPool(items, concurrency, worker, onProgress) {
    const list = Array.isArray(items) ? items.slice() : [];
    const limit = Math.max(1, Math.min(Number(concurrency) || 1, list.length || 1));
    const results = new Array(list.length);
    let nextIndex = 0;
    let active = 0;
    let completed = 0;

    return new Promise((resolve) => {
      function schedule() {
        while (active < limit && nextIndex < list.length) {
          const index = nextIndex;
          const item = list[nextIndex];
          nextIndex += 1;
          active += 1;

          Promise.resolve()
            .then(() => worker(item, index))
            .then((result) => {
              results[index] = result;
            }, (error) => {
              results[index] = { ok: false, error };
            })
            .finally(() => {
              active -= 1;
              completed += 1;
              if (typeof onProgress === "function") {
                onProgress({ completed, total: list.length, item, result: results[index] });
              }
              if (completed === list.length) {
                resolve(results);
              } else {
                schedule();
              }
            });
        }

        if (!list.length) {
          resolve([]);
        }
      }

      schedule();
    });
  }

  async function preflightTickets(options) {
    const config = options || {};
    const action = BULK_ACTIONS[config.actionKey];
    const requested = Array.isArray(config.tickets) ? config.tickets.slice() : [];

    if (!action || typeof config.readFreshTicket !== "function") {
      throw new Error("Thiếu cấu hình preflight cho thao tác hàng loạt.");
    }

    const results = await createControlledPool(requested, config.concurrency || 4, async (snapshot) => {
      const uuid = ticketUuid(snapshot);
      try {
        const fresh = await config.readFreshTicket(uuid);
        if (!fresh) {
          return { ok: false, type: "missing", uuid, code: ticketCode(snapshot), message: "Phiếu không còn tồn tại." };
        }
        if (ticketUuid(fresh) !== uuid) {
          return { ok: false, type: "identity", uuid, code: ticketCode(snapshot), message: "Dữ liệu trả về không khớp UUID phiếu." };
        }
        if (!isActionEligible(fresh, config.actionKey)) {
          return {
            ok: false,
            type: "stale",
            uuid,
            code: ticketCode(fresh) || ticketCode(snapshot),
            fresh,
            message: `Trạng thái mới nhất không còn phù hợp với thao tác ${action.label}.`
          };
        }
        return { ok: true, uuid, code: ticketCode(fresh) || ticketCode(snapshot), fresh };
      } catch (error) {
        return {
          ok: false,
          type: "read-error",
          uuid,
          code: ticketCode(snapshot),
          error,
          message: error && error.message ? error.message : "Không thể tải trạng thái mới nhất."
        };
      }
    });

    const issues = results.filter((result) => !result.ok);
    const planItems = issues.length ? [] : results.map((result) => Object.freeze({
      uuid: result.uuid,
      code: result.code,
      status: normalizeStatus(result.fresh.status),
      ticket: Object.freeze(Object.assign({}, result.fresh))
    }));

    return Object.freeze({
      actionKey: config.actionKey,
      requestedCount: requested.length,
      issues: Object.freeze(issues.slice()),
      plan: Object.freeze(planItems.slice()),
      safeToExecute: issues.length === 0 && planItems.length === requested.length
    });
  }

  async function executePlan(options) {
    const config = options || {};
    const action = BULK_ACTIONS[config.actionKey];
    const plan = Array.isArray(config.plan) ? config.plan.slice() : [];
    if (!action || typeof config.executor !== "function") {
      throw new Error("Thiếu executor cho thao tác hàng loạt.");
    }

    const results = await createControlledPool(plan, config.concurrency || action.concurrency, async (item) => {
      try {
        const response = await config.executor(item);
        if (!response || response.ok === false) {
          throw response && response.error || new Error("Workflow không trả về kết quả thành công.");
        }
        return { ok: true, uuid: item.uuid, code: item.code, response: response.result || response };
      } catch (error) {
        return {
          ok: false,
          uuid: item.uuid,
          code: item.code,
          error,
          message: error && error.message ? error.message : "Không thể xử lý phiếu."
        };
      }
    }, config.onProgress);

    return Object.freeze({
      requestedCount: plan.length,
      success: Object.freeze(results.filter((result) => result.ok)),
      failed: Object.freeze(results.filter((result) => !result.ok)),
      results: Object.freeze(results.slice())
    });
  }

  function createExecutionGuard() {
    let active = false;
    return Object.freeze({
      isActive: () => active,
      run: async (operation) => {
        if (active) {
          return { ignored: true };
        }
        active = true;
        try {
          return await operation();
        } finally {
          active = false;
        }
      }
    });
  }

  function validateWorkflowResponse(item, result, expectedStatus) {
    const uuid = ticketUuid(item);
    if (!result || clean(result.ticket_id) !== uuid) {
      throw new Error("Workflow trả về sai UUID phiếu; kết quả đã bị chặn.");
    }
    if (expectedStatus && normalizeStatus(result.status) !== normalizeStatus(expectedStatus)) {
      throw new Error("Workflow chưa xác nhận đúng trạng thái đích.");
    }
    return result;
  }

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function formatStatusLabel(status) {
    if (typeof window !== "undefined" && window.AMApi && typeof window.AMApi.formatTicketStatusLabel === "function") {
      return window.AMApi.formatTicketStatusLabel(status, status);
    }
    return status;
  }

  function mountPageController(options) {
    if (!selectionApi || typeof document === "undefined") {
      throw new Error("Bulk selection module chưa sẵn sàng.");
    }

    const config = options || {};
    const section = config.section;
    const toolbar = config.toolbar;
    const capabilities = Object.assign({ completeRepair: false, returnFromRepair: false }, config.capabilities || {});
    const store = selectionApi.createSelectionStore();
    const guard = createExecutionGuard();
    const pageKey = clean(config.pageKey) || "tickets";
    const capturesRepairResult = pageKey === "search" && config.captureRepairResult === true;
    let operationState = STATES.IDLE;
    let preserveSelectionOnNextRegistry = false;
    let lastFailedIds = [];
    let lastFailedPlan = [];
    let pendingPlan = null;
    let pendingActionKey = "";
    let pendingActionDetails = null;
    let repairResultCommon = "";
    let editingRepairResultUuid = "";
    let editingRepairResultDraft = "";
    let repairDraftDirty = false;
    let discardReturnFocus = null;
    const repairResultOverrides = new Map();
    const repairResultDrafts = new Map();
    let returnFocus = null;
    let destroyed = false;

    if (!section || !toolbar) {
      throw new Error("Thiếu vùng gắn bulk operations.");
    }

    const tools = createElement("div", "ticket-bulk-selection-tools");
    const modeButton = createElement("button", "btn secondary compact ticket-bulk-mode-button", "Chọn phiếu");
    const selectAllLabel = createElement("label", "ticket-bulk-select-all");
    const selectAllInput = document.createElement("input");
    const selectAllText = createElement("span", "", "Chọn tất cả trên trang");
    modeButton.type = "button";
    modeButton.dataset.bulkModeToggle = "true";
    selectAllInput.type = "checkbox";
    selectAllInput.dataset.bulkSelectAll = "true";
    selectAllInput.setAttribute("aria-label", "Chọn tất cả phiếu khả dụng trên trang này");
    selectAllLabel.append(selectAllInput, selectAllText);
    tools.append(modeButton, selectAllLabel);
    toolbar.appendChild(tools);

    const commandBar = createElement("aside", "ticket-bulk-command-bar");
    commandBar.hidden = true;
    commandBar.setAttribute("aria-live", "polite");
    const commandSummary = createElement("div", "ticket-bulk-command-summary");
    const commandCount = createElement("strong");
    const commandStatuses = createElement("span");
    const commandCodes = createElement("span", "ticket-bulk-code-preview");
    const commandActions = createElement("div", "ticket-bulk-command-actions");
    commandSummary.append(commandCount, commandStatuses, commandCodes);
    commandBar.append(commandSummary, commandActions);
    section.appendChild(commandBar);

    const dialog = createElement("div", "ticket-bulk-dialog-backdrop");
    const dialogPanel = createElement("section", "ticket-bulk-dialog");
    const dialogTitle = createElement("h2", "ticket-bulk-dialog-title");
    const dialogMessage = createElement("p", "ticket-bulk-dialog-message");
    const repairFields = createElement("div", "ticket-bulk-repair-fields");
    const repairResultField = createElement("label", "ticket-bulk-repair-common");
    const repairResultLabel = createElement("span", "ticket-bulk-repair-label", "Kết quả áp dụng chung");
    const repairResultInput = document.createElement("input");
    const repairPresetList = createElement("div", "ticket-bulk-repair-presets");
    const repairValidation = createElement("p", "ticket-bulk-repair-validation");
    const dialogList = createElement("ul", "ticket-bulk-dialog-list");
    const returnFields = createElement("div", "ticket-bulk-return-fields");
    const returnReasonField = createElement("label", "workflow-return-field");
    const returnReasonLabel = createElement("span", "", "Lý do áp dụng cho tất cả phiếu đã chọn");
    const returnReason = document.createElement("select");
    const returnDetailField = createElement("label", "workflow-return-field");
    const returnDetailLabel = createElement("span", "", "Chi tiết bổ sung");
    const returnDetail = document.createElement("textarea");
    const returnError = createElement("p", "workflow-return-error");
    const progress = createElement("div", "ticket-bulk-progress");
    const progressText = createElement("span", "ticket-bulk-progress-text");
    const progressTrack = createElement("div", "ticket-bulk-progress-track");
    const progressBar = createElement("span", "ticket-bulk-progress-bar");
    const dialogActions = createElement("div", "ticket-bulk-dialog-actions");
    const cancelButton = createElement("button", "btn secondary", "Hủy");
    const confirmButton = createElement("button", "btn primary", "Xác nhận");
    const discardConfirmation = createElement("div", "ticket-bulk-discard-confirmation");
    const discardTitle = createElement("h3", "ticket-bulk-discard-title", "Bỏ nội dung đã nhập?");
    const discardMessage = createElement(
      "p",
      "ticket-bulk-discard-message",
      "Kết quả sửa chữa bạn vừa nhập sẽ không được lưu."
    );
    const discardActions = createElement("div", "ticket-bulk-discard-actions");
    const continueEditingButton = createElement("button", "btn secondary", "Tiếp tục nhập");
    const discardDraftButton = createElement("button", "btn danger", "Bỏ nội dung");
    const dialogTitleId = `ticketBulkDialogTitle-${pageKey}`;
    dialog.hidden = true;
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", dialogTitleId);
    dialogTitle.id = dialogTitleId;
    repairFields.hidden = true;
    repairResultInput.type = "text";
    repairResultInput.maxLength = REPAIR_RESULT_MAX_LENGTH;
    repairResultInput.autocomplete = "off";
    repairResultInput.placeholder = "Nhập kết quả sửa chữa...";
    repairValidation.hidden = true;
    REPAIR_RESULT_PRESETS.forEach((preset) => {
      const button = createElement("button", "ticket-bulk-repair-preset", preset);
      button.type = "button";
      button.dataset.repairResultPreset = preset;
      repairPresetList.appendChild(button);
    });
    repairResultField.append(repairResultLabel, repairResultInput);
    repairFields.append(repairResultField, repairPresetList, repairValidation);
    discardConfirmation.hidden = true;
    discardConfirmation.setAttribute("aria-live", "assertive");
    continueEditingButton.type = "button";
    discardDraftButton.type = "button";
    discardActions.append(continueEditingButton, discardDraftButton);
    discardConfirmation.append(discardTitle, discardMessage, discardActions);
    returnFields.hidden = true;
    returnDetail.rows = 3;
    returnDetail.maxLength = 1000;
    returnDetail.placeholder = "Mô tả ngắn để nhân viên bàn giao nắm được tình hình...";
    returnError.hidden = true;
    ["", ...REPAIR_RETURN_REASONS].forEach((reasonValue) => {
      const option = document.createElement("option");
      option.value = reasonValue;
      option.textContent = reasonValue || "Chọn lý do";
      returnReason.appendChild(option);
    });
    returnReasonField.append(returnReasonLabel, returnReason);
    returnDetailField.append(returnDetailLabel, returnDetail);
    returnFields.append(returnReasonField, returnDetailField, returnError);
    progress.hidden = true;
    progressTrack.appendChild(progressBar);
    progress.append(progressText, progressTrack);
    cancelButton.type = "button";
    confirmButton.type = "button";
    dialogActions.append(cancelButton, confirmButton);
    dialogPanel.append(
      dialogTitle,
      dialogMessage,
      repairFields,
      dialogList,
      returnFields,
      progress,
      dialogActions,
      discardConfirmation
    );
    dialog.appendChild(dialogPanel);
    document.body.appendChild(dialog);

    function setOperationState(nextState) {
      const allowed = {
        idle: [STATES.SELECTING],
        selecting: [STATES.IDLE, STATES.PREFLIGHTING],
        preflighting: [STATES.SELECTING, STATES.CONFIRMING, STATES.RESULT],
        confirming: [STATES.SELECTING, STATES.EXECUTING, STATES.RESULT],
        executing: [STATES.RESULT],
        result: [STATES.SELECTING, STATES.IDLE, STATES.PREFLIGHTING]
      };
      if (nextState !== operationState && !(allowed[operationState] || []).includes(nextState)) {
        return false;
      }
      operationState = nextState;
      section.dataset.bulkOperationState = nextState;
      return true;
    }

    function isProtectedRepairModal() {
      return capturesRepairResult && pendingActionKey === "completeRepair";
    }

    function hideDiscardConfirmation(optionsValue) {
      if (discardConfirmation.hidden) return;
      const settings = optionsValue || {};
      discardConfirmation.hidden = true;
      dialogPanel.classList.remove("is-discard-confirming");
      if (settings.restoreFocus !== false && discardReturnFocus && document.contains(discardReturnFocus)) {
        discardReturnFocus.focus({ preventScroll: true });
      }
      discardReturnFocus = null;
    }

    function showDiscardConfirmation() {
      if (!discardConfirmation.hidden || operationState === STATES.EXECUTING) return;
      discardReturnFocus = dialogPanel.contains(document.activeElement)
        ? document.activeElement
        : repairResultInput;
      discardConfirmation.hidden = false;
      dialogPanel.classList.add("is-discard-confirming");
      continueEditingButton.focus({ preventScroll: true });
    }

    function requestDialogClose(source) {
      if (!discardConfirmation.hidden) {
        if (source === "escape") hideDiscardConfirmation();
        return;
      }
      const decision = repairModalDismissalDecision({
        protectedModal: isProtectedRepairModal(),
        source,
        state: operationState,
        dirty: repairDraftDirty
      });
      if (decision === DISMISSAL_DECISIONS.CONFIRM_DISCARD) {
        showDiscardConfirmation();
        return;
      }
      if (decision === DISMISSAL_DECISIONS.CLOSE) {
        closeDialog();
      }
    }

    function closeDialog(optionsValue) {
      if (operationState === STATES.EXECUTING) return;
      const settings = optionsValue || {};
      hideDiscardConfirmation({ restoreFocus: false });
      dialog.hidden = true;
      document.body.classList.remove("ticket-bulk-modal-open");
      document.removeEventListener("keydown", handleDialogKeydown);
      if (operationState !== STATES.IDLE) setOperationState(STATES.SELECTING);
      if (settings.restoreFocus !== false && returnFocus && document.contains(returnFocus)) {
        returnFocus.focus({ preventScroll: true });
      }
      returnFocus = null;
    }

    function handleDialogKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (operationState === STATES.EXECUTING) return;
        requestDialogClose("escape");
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogPanel.querySelectorAll(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])"
      )).filter((element) => !element.hidden && element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    }

    function openDialog(title, message) {
      returnFocus = document.activeElement;
      delete confirmButton.dataset.bulkRetry;
      hideDiscardConfirmation({ restoreFocus: false });
      dialogTitle.textContent = title;
      dialogMessage.textContent = message;
      dialogList.replaceChildren();
      repairFields.hidden = true;
      repairValidation.hidden = true;
      repairValidation.textContent = "";
      returnFields.hidden = true;
      returnError.hidden = true;
      returnError.textContent = "";
      progress.hidden = true;
      confirmButton.hidden = false;
      confirmButton.disabled = false;
      cancelButton.disabled = false;
      cancelButton.textContent = "Hủy";
      dialog.hidden = false;
      document.body.classList.add("ticket-bulk-modal-open");
      document.addEventListener("keydown", handleDialogKeydown);
      cancelButton.focus({ preventScroll: true });
    }

    function showReturnFields(details) {
      const initial = details || {};
      returnReason.value = clean(initial.reason);
      returnDetail.value = clean(initial.detail);
      returnError.hidden = true;
      returnError.textContent = "";
      returnFields.hidden = false;
    }

    function collectReturnActionDetails() {
      const reason = clean(returnReason.value);
      const detail = clean(returnDetail.value);

      if (!REPAIR_RETURN_REASONS.includes(reason)) {
        returnError.textContent = "Vui lòng chọn lý do giao trả sửa chữa.";
        returnError.hidden = false;
        returnReason.focus({ preventScroll: true });
        return null;
      }
      if (reason === "Khác" && !detail) {
        returnError.textContent = "Vui lòng nhập nội dung cho lý do khác.";
        returnError.hidden = false;
        returnDetail.focus({ preventScroll: true });
        return null;
      }

      returnError.hidden = true;
      returnError.textContent = "";
      return { reason, detail };
    }

    function resetRepairResultState() {
      repairResultCommon = "";
      editingRepairResultUuid = "";
      editingRepairResultDraft = "";
      repairDraftDirty = false;
      repairResultOverrides.clear();
      repairResultDrafts.clear();
      repairResultInput.value = "";
      repairValidation.hidden = true;
      repairValidation.textContent = "";
      repairFields.hidden = true;
    }

    function effectiveRepairResult(uuid) {
      return clean(repairResultOverrides.has(uuid) ? repairResultOverrides.get(uuid) : repairResultCommon);
    }

    function renderRepairResultItems(plan) {
      dialogList.replaceChildren();
      const list = Array.isArray(plan) ? plan : [];
      const isSingle = list.length === 1;

      list.forEach((item) => {
        const uuid = ticketUuid(item);
        const row = createElement("li", "ticket-bulk-repair-row");
        const heading = createElement("div", "ticket-bulk-repair-row-heading");
        const code = createElement("strong", "", item.code || "Không rõ mã");
        const status = createElement("span", "ticket-bulk-repair-status", formatStatusLabel(item.status));
        heading.append(code, status);
        row.appendChild(heading);

        if (!isSingle) {
          if (editingRepairResultUuid === uuid) {
            const editor = createElement("div", "ticket-bulk-repair-editor");
            const input = document.createElement("input");
            const actions = createElement("div", "ticket-bulk-repair-row-actions");
            const applyButton = createElement("button", "btn primary compact", "Áp dụng");
            const cancelEditButton = createElement("button", "btn secondary compact", "Hủy");
            input.type = "text";
            input.maxLength = REPAIR_RESULT_MAX_LENGTH;
            input.value = editingRepairResultDraft;
            input.dataset.repairResultOverrideInput = uuid;
            input.setAttribute("aria-label", `Kết quả sửa chữa cho ${item.code || "phiếu"}`);
            applyButton.type = "button";
            applyButton.dataset.repairResultApply = uuid;
            applyButton.disabled = !validateRepairResult(editingRepairResultDraft).valid;
            cancelEditButton.type = "button";
            cancelEditButton.dataset.repairResultCancel = uuid;
            actions.append(applyButton, cancelEditButton);
            editor.append(input, actions);
            row.appendChild(editor);
          } else {
            const resultRow = createElement("div", "ticket-bulk-repair-result-row");
            const result = createElement(
              "span",
              `ticket-bulk-repair-result${effectiveRepairResult(uuid) ? "" : " is-empty"}`,
              effectiveRepairResult(uuid) || "Chưa có kết quả sửa chữa"
            );
            const actions = createElement("div", "ticket-bulk-repair-row-actions");
            const editButton = createElement("button", "btn secondary compact", "Chỉnh");
            editButton.type = "button";
            editButton.dataset.repairResultEdit = uuid;
            actions.appendChild(editButton);
            if (repairResultOverrides.has(uuid)) {
              const useCommonButton = createElement("button", "ticket-bulk-use-common", "Dùng kết quả chung");
              useCommonButton.type = "button";
              useCommonButton.dataset.repairResultUseCommon = uuid;
              actions.appendChild(useCommonButton);
            }
            resultRow.append(result, actions);
            row.appendChild(resultRow);
          }
        }

        dialogList.appendChild(row);
      });
    }

    function syncRepairResultValidation(showMessage) {
      if (pendingActionKey !== "completeRepair" || !pendingPlan) return null;
      const result = buildRepairResultExecutionPlan(pendingPlan, repairResultCommon, repairResultOverrides);
      const valid = result.valid && !editingRepairResultUuid;
      confirmButton.disabled = !valid;
      repairValidation.textContent = editingRepairResultUuid
        ? "Hãy áp dụng hoặc hủy phần kết quả đang chỉnh."
        : "Vui lòng nhập kết quả sửa chữa cho tất cả phiếu.";
      repairValidation.hidden = valid || showMessage === false;
      return result;
    }

    function showRepairResultFields(plan, draftValues) {
      const list = Array.isArray(plan) ? plan : [];
      const drafts = draftValues instanceof Map ? draftValues : new Map();
      const values = list.map((item) => clean(drafts.get(ticketUuid(item))));
      const nonEmptyValues = values.filter(Boolean);
      const sharedValue = nonEmptyValues.length === list.length
        && nonEmptyValues.every((value) => value === nonEmptyValues[0])
        ? nonEmptyValues[0]
        : "";

      repairResultCommon = sharedValue;
      repairDraftDirty = values.some(Boolean);
      repairResultOverrides.clear();
      if (!sharedValue) {
        list.forEach((item, index) => {
          if (values[index]) repairResultOverrides.set(ticketUuid(item), values[index]);
        });
      }
      editingRepairResultUuid = "";
      editingRepairResultDraft = "";
      repairResultLabel.textContent = list.length === 1 ? "Kết quả sửa chữa" : "Kết quả áp dụng chung";
      repairResultInput.value = repairResultCommon;
      repairFields.hidden = false;
      renderRepairResultItems(list);
      syncRepairResultValidation(true);
    }

    function renderDialogItems(items, className) {
      dialogList.replaceChildren();
      (items || []).forEach((item) => {
        const row = createElement("li", className || "");
        const code = createElement("strong", "", item.code || "Không rõ mã");
        const detail = createElement("span", "", item.message || formatStatusLabel(item.status));
        row.append(code, detail);
        dialogList.appendChild(row);
      });
    }

    function updateProgress(completed, total) {
      progress.hidden = false;
      progressText.textContent = `${completed} / ${total} phiếu`;
      progressBar.style.width = `${total ? Math.round((completed / total) * 100) : 0}%`;
    }

    function syncSelectionDom(snapshot) {
      section.classList.toggle("is-ticket-bulk-selecting", snapshot.mode === "selecting");
      modeButton.classList.toggle("is-active", snapshot.mode === "selecting");
      modeButton.textContent = snapshot.mode === "selecting" ? "Thoát chọn" : "Chọn phiếu";
      selectAllLabel.hidden = snapshot.mode !== "selecting";
      selectAllInput.checked = snapshot.globalState.checked;
      selectAllInput.indeterminate = snapshot.globalState.indeterminate;
      selectAllInput.disabled = snapshot.globalState.disabled;

      const selectedIds = new Set(snapshot.selected.map((ticket) => ticket.uuid));
      section.querySelectorAll("[data-bulk-ticket-select]").forEach((input) => {
        input.checked = selectedIds.has(input.dataset.bulkTicketSelect);
      });
      section.querySelectorAll("[data-bulk-ticket-id]").forEach((element) => {
        element.classList.toggle("is-ticket-bulk-selected", selectedIds.has(element.dataset.bulkTicketId));
      });
      section.querySelectorAll("[data-bulk-group-select]").forEach((input) => {
        const state = store.getGroupState(input.dataset.bulkGroupSelect);
        input.checked = state.checked;
        input.indeterminate = state.indeterminate;
        input.disabled = state.disabled;
        const owner = input.closest("[data-bulk-group-id]");
        if (owner) {
          owner.classList.toggle("is-ticket-bulk-partial", state.indeterminate);
          owner.dataset.bulkSelectedCount = String(state.selectedCount);
        }
      });
      renderCommandBar(snapshot);
    }

    function actionAvailableForSelection(selected, actionKey) {
      return selected.length > 0
        && capabilities[actionKey] === true
        && selected.every((ticket) => isActionEligible(ticket, actionKey));
    }

    function renderCommandBar(snapshot) {
      const selected = snapshot.selected;
      commandBar.hidden = snapshot.mode !== "selecting" || selected.length === 0;
      if (commandBar.hidden) return;

      commandCount.textContent = `${selected.length} phiếu đã chọn`;
      const statusParts = Object.entries(snapshot.statusCounts)
        .map(([status, count]) => `${count} ${formatStatusLabel(status)}`);
      commandStatuses.textContent = statusParts.join(" · ");
      const codes = selected.map((ticket) => ticket.code).filter(Boolean);
      commandCodes.textContent = codes.length > 6
        ? `${codes.slice(0, 6).join(" · ")} · +${codes.length - 6} phiếu`
        : codes.join(" · ");
      commandActions.replaceChildren();

      if (Object.keys(snapshot.statusCounts).length > 1) {
        Object.entries(snapshot.statusCounts).forEach(([status, count]) => {
          if (!enabledActionKeys(capabilities).some((key) => BULK_ACTIONS[key].status === status)) return;
          const button = createElement("button", "btn secondary compact", `Chỉ giữ ${formatStatusLabel(status)} (${count})`);
          button.type = "button";
          button.dataset.bulkRetainStatus = status;
          commandActions.appendChild(button);
        });
      }

      const clearButton = createElement("button", "btn secondary compact", "Bỏ chọn tất cả");
      clearButton.type = "button";
      clearButton.dataset.bulkClear = "true";
      commandActions.appendChild(clearButton);

      enabledActionKeys(capabilities).forEach((actionKey) => {
        const action = BULK_ACTIONS[actionKey];
        const button = createElement("button", `btn ${actionKey === "completeRepair" ? "primary" : "secondary"} compact`, action.label);
        const available = actionAvailableForSelection(selected, actionKey);
        button.type = "button";
        button.dataset.bulkAction = actionKey;
        button.disabled = !available;
        if (!available) {
          button.title = "Tất cả phiếu đã chọn phải cùng đủ điều kiện cho thao tác này.";
        }
        commandActions.appendChild(button);
      });
    }

    async function executeCompleteRepair(item) {
      const action = "READY_FOR_HANDOVER";
      const outcome = "repaired_successfully";
      if (capturesRepairResult && (!window.AMApi || typeof window.AMApi.saveRepairCompletionResult !== "function")) {
        throw new Error("Chức năng lưu kết quả sửa chữa chưa sẵn sàng.");
      }
      const requestId = window.AMApi.ensureWorkflowClientRequestId(item.uuid, action, outcome);
      try {
        let result = null;
        if (item.workflowCompleted === true) {
          result = {
            ticket_id: item.uuid,
            ticket_code: item.code,
            status: BULK_ACTIONS.completeRepair.resultStatus,
            was_replayed: true
          };
        } else {
          result = await window.AMApi.recordTicketWorkflowAction(item.uuid, action, requestId, {
            repair_outcome: outcome
          });
          validateWorkflowResponse(item, result, BULK_ACTIONS.completeRepair.resultStatus);
        }

        if (capturesRepairResult) {
          try {
            await window.AMApi.saveRepairCompletionResult(item.uuid, item.repairResult);
          } catch (storageError) {
            const error = storageError instanceof Error
              ? storageError
              : new Error("Không lưu được kết quả sửa chữa.");
            error.repairResultStoragePending = true;
            throw error;
          }
        }

        window.AMApi.clearWorkflowClientRequestId(item.uuid, action, outcome);
        return { ok: true, result };
      } catch (error) {
        if (!error.repairResultStoragePending && window.AMApi.shouldClearWorkflowClientRequestId(error)) {
          window.AMApi.clearWorkflowClientRequestId(item.uuid, action, outcome);
        }
        throw error;
      }
    }

    async function executeReturnFromRepair(item, details) {
      if (!window.AMUI || typeof window.AMUI.executeRepairReturn !== "function") {
        throw new Error("Workflow giao trả sửa chữa chưa sẵn sàng.");
      }

      const response = await window.AMUI.executeRepairReturn({
        ticket: item.ticket,
        reason: details && details.reason,
        detail: details && details.detail
      });
      validateWorkflowResponse(item, response && response.result, BULK_ACTIONS.returnFromRepair.resultStatus);
      return response;
    }

    async function refreshAfterOperation() {
      if (typeof config.refresh !== "function") return;
      preserveSelectionOnNextRegistry = true;
      try {
        await config.refresh({ source: "bulk-operation" });
      } catch (error) {
        preserveSelectionOnNextRegistry = false;
        if (window.AMUI && typeof window.AMUI.toast === "function") {
          window.AMUI.toast("Workflow đã xử lý nhưng danh sách chưa tải lại được.", { type: "warning" });
        }
      }
    }

    async function refreshAfterPreflightIssue() {
      if (typeof config.refresh !== "function") return;
      preserveSelectionOnNextRegistry = true;
      try {
        await config.refresh({ source: "bulk-preflight" });
      } catch (_error) {
        preserveSelectionOnNextRegistry = false;
      }
    }

    function showPreflightIssues(preflight) {
      setOperationState(STATES.RESULT);
      dialogTitle.textContent = "Chưa thể thực hiện hàng loạt";
      dialogMessage.textContent = preflight.issues.every((item) => item.type === "read-error")
        ? "Không thể xác minh trạng thái phiếu. Chưa có phiếu nào được thay đổi."
        : "Một hoặc nhiều phiếu đã thay đổi hoặc không còn đủ điều kiện. Chưa có phiếu nào được thay đổi.";
      renderDialogItems(preflight.issues, "is-error");
      confirmButton.hidden = true;
      cancelButton.textContent = "Đóng";
      cancelButton.disabled = false;
      cancelButton.focus({ preventScroll: true });
    }

    async function beginAction(actionKey, optionsValue) {
      const action = BULK_ACTIONS[actionKey];
      const snapshot = store.getSnapshot();
      const settings = optionsValue || {};
      if (!action || !actionAvailableForSelection(snapshot.selected, actionKey) || guard.isActive()) return;

      pendingActionKey = actionKey;
      pendingPlan = null;
      pendingActionDetails = settings.details || null;
      lastFailedIds = [];
      lastFailedPlan = [];
      if (actionKey === "completeRepair" && capturesRepairResult) resetRepairResultState();
      setOperationState(STATES.PREFLIGHTING);
      openDialog(`Kiểm tra ${action.label}`, "Đang tải trạng thái mới nhất của tất cả phiếu trước khi thực hiện...");
      confirmButton.hidden = true;
      cancelButton.disabled = true;
      updateProgress(0, snapshot.selected.length);

      const preflight = await preflightTickets({
        tickets: snapshot.selected,
        actionKey,
        readFreshTicket: config.readFreshTicket || ((uuid) => window.AMApi.getTicketById(uuid)),
        concurrency: 4
      });

      if (destroyed) return;
      progress.hidden = true;
      if (!preflight.safeToExecute) {
        showPreflightIssues(preflight);
        await refreshAfterPreflightIssue();
        return;
      }

      pendingPlan = preflight.plan;
      setOperationState(STATES.CONFIRMING);
      dialogTitle.textContent = actionKey === "returnFromRepair"
        ? "Xác nhận giao trả sửa chữa"
        : "Xác nhận đã hoàn thành sửa chữa";
      dialogMessage.textContent = actionKey === "returnFromRepair"
        ? `Bạn sắp kết thúc sửa chữa và chuyển ${pendingPlan.length} phiếu sang bước bàn giao/trả máy.`
        : `Bạn sắp xác nhận sửa chữa hoàn tất và chuyển ${pendingPlan.length} phiếu sang khu Bàn giao tivi.`;
      if (actionKey === "completeRepair" && capturesRepairResult) {
        showRepairResultFields(pendingPlan, repairResultDrafts);
      } else {
        renderDialogItems(pendingPlan);
      }
      if (action.requiresReason) {
        showReturnFields(pendingActionDetails);
      }

      confirmButton.hidden = false;
      confirmButton.disabled = actionKey === "completeRepair" && capturesRepairResult;
      confirmButton.textContent = pendingPlan.length === 1 && actionKey === "completeRepair" && capturesRepairResult
        ? "Xác nhận hoàn thành"
        : `Xác nhận ${pendingPlan.length} phiếu`;
      cancelButton.disabled = false;
      cancelButton.textContent = "Hủy";
      cancelButton.focus({ preventScroll: true });
    }

    async function confirmExecution() {
      if (operationState !== STATES.CONFIRMING || !pendingPlan || !pendingPlan.length || guard.isActive()) return;
      if (pendingActionKey === "returnFromRepair") {
        pendingActionDetails = collectReturnActionDetails();
        if (!pendingActionDetails) return;
      } else if (pendingActionKey === "completeRepair" && capturesRepairResult) {
        const repairPlan = syncRepairResultValidation(true);
        if (!repairPlan || !repairPlan.valid || editingRepairResultUuid) return;
        pendingPlan = repairPlan.plan;
        pendingPlan.forEach((item) => repairResultDrafts.set(item.uuid, item.repairResult));
      }
      await guard.run(async () => {
        setOperationState(STATES.EXECUTING);
        dialogTitle.textContent = `Đang ${BULK_ACTIONS[pendingActionKey].label.toLocaleLowerCase("vi-VN")}`;
        dialogMessage.textContent = "Không đóng trang cho đến khi hệ thống xử lý xong từng phiếu.";
        confirmButton.hidden = true;
        cancelButton.disabled = true;
        repairFields.hidden = true;
        returnFields.hidden = true;
        renderDialogItems(pendingPlan);
        updateProgress(0, pendingPlan.length);

        const result = await executePlan({
          actionKey: pendingActionKey,
          plan: pendingPlan,
          concurrency: BULK_ACTIONS[pendingActionKey].concurrency,
          executor: pendingActionKey === "completeRepair"
            ? executeCompleteRepair
            : (item) => executeReturnFromRepair(item, pendingActionDetails),
          onProgress: ({ completed, total }) => updateProgress(completed, total)
        });

        const successIds = result.success.map((item) => item.uuid);
        lastFailedIds = result.failed.map((item) => item.uuid);
        const planByUuid = new Map(pendingPlan.map((item) => [item.uuid, item]));
        lastFailedPlan = result.failed.map((failed) => {
          const source = planByUuid.get(failed.uuid) || failed;
          return Object.freeze(Object.assign({}, source, {
            workflowCompleted: source.workflowCompleted === true
              || Boolean(failed.error && failed.error.repairResultStoragePending)
          }));
        });
        successIds.forEach((uuid) => repairResultDrafts.delete(uuid));
        lastFailedPlan.forEach((item) => repairResultDrafts.set(item.uuid, item.repairResult));
        store.removeMany(successIds, "operation-success");
        await refreshAfterOperation();
        repairDraftDirty = false;
        setOperationState(STATES.RESULT);
        dialogTitle.textContent = result.failed.length ? "Đã xử lý một phần" : "Đã hoàn tất";
        dialogMessage.textContent = `Yêu cầu ${result.requestedCount} · Thành công ${result.success.length} · Lỗi ${result.failed.length}.`;
        renderDialogItems(result.results.map((item) => ({
          code: item.code,
          message: item.ok ? "Thành công" : item.message,
          ok: item.ok
        })), "");
        Array.from(dialogList.children).forEach((item, index) => {
          item.classList.toggle("is-error", !result.results[index].ok);
          item.classList.toggle("is-success", result.results[index].ok);
        });
        progress.hidden = true;
        cancelButton.disabled = false;
        cancelButton.textContent = "Đóng";
        confirmButton.hidden = result.failed.length === 0;
        if (result.failed.length) {
          confirmButton.hidden = false;
          confirmButton.disabled = false;
          confirmButton.textContent = `Thử lại ${result.failed.length} phiếu lỗi`;
          confirmButton.dataset.bulkRetry = "true";
        }
        cancelButton.focus({ preventScroll: true });
      });
    }

    async function prepareCompleteRepairRetry() {
      const retrySource = lastFailedPlan.slice();
      if (!retrySource.length || guard.isActive()) return;

      delete confirmButton.dataset.bulkRetry;
      setOperationState(STATES.PREFLIGHTING);
      dialogTitle.textContent = "Kiểm tra lại phiếu lỗi";
      dialogMessage.textContent = "Đang xác minh trạng thái mới nhất trước khi thử lại.";
      repairFields.hidden = true;
      confirmButton.hidden = true;
      cancelButton.disabled = true;
      updateProgress(0, retrySource.length);

      const workflowPending = retrySource.filter((item) => item.workflowCompleted !== true);
      let freshPlan = [];
      if (workflowPending.length) {
        const preflight = await preflightTickets({
          tickets: workflowPending,
          actionKey: "completeRepair",
          readFreshTicket: config.readFreshTicket || ((uuid) => window.AMApi.getTicketById(uuid)),
          concurrency: 4
        });
        if (destroyed) return;
        if (!preflight.safeToExecute) {
          progress.hidden = true;
          showPreflightIssues(preflight);
          await refreshAfterPreflightIssue();
          return;
        }
        freshPlan = preflight.plan;
      }

      const freshByUuid = new Map(freshPlan.map((item) => [item.uuid, item]));
      pendingPlan = Object.freeze(retrySource.map((item) => {
        if (item.workflowCompleted === true) return item;
        const fresh = freshByUuid.get(item.uuid);
        return Object.freeze(Object.assign({}, fresh, {
          repairResult: item.repairResult,
          workflowCompleted: false
        }));
      }));
      pendingActionKey = "completeRepair";
      setOperationState(STATES.CONFIRMING);
      progress.hidden = true;
      dialogTitle.textContent = "Xác nhận thử lại phiếu lỗi";
      dialogMessage.textContent = `Chỉ ${pendingPlan.length} phiếu chưa hoàn tất sẽ được xử lý lại.`;
      showRepairResultFields(pendingPlan, repairResultDrafts);
      confirmButton.hidden = false;
      confirmButton.textContent = pendingPlan.length === 1
        ? "Xác nhận hoàn thành"
        : `Xác nhận ${pendingPlan.length} phiếu`;
      cancelButton.disabled = false;
      cancelButton.textContent = "Hủy";
      cancelButton.focus({ preventScroll: true });
    }

    function syncRegistry(registry, optionsValue) {
      const source = registry || {};
      const settings = optionsValue || {};
      const groupLookup = new Map();
      (source.groups || []).forEach((group) => {
        (group.ticketIds || []).forEach((uuid, index) => {
          groupLookup.set(clean(uuid), { groupId: clean(group.id || group.groupId), groupSize: group.ticketIds.length, childIndex: index + 1 });
        });
      });
      const tickets = (source.tickets || []).map((ticket) => buildSelectionTicket(ticket, Object.assign({
        capabilities,
        sourcePage: pageKey
      }, groupLookup.get(ticketUuid(ticket)) || {})));
      const preserveSelection = settings.preserveSelection === true || preserveSelectionOnNextRegistry;
      preserveSelectionOnNextRegistry = false;
      store.setRegistry({ tickets, groups: source.groups || [] }, {
        preserveSelection,
        reason: settings.reason || "page-render"
      });
    }

    function clearForDataChange(showNotice) {
      const hadSelection = store.getSnapshot().selectedCount > 0;
      store.clear("data-change");
      if (hadSelection && showNotice !== false && window.AMUI && typeof window.AMUI.toast === "function") {
        window.AMUI.toast("Đã bỏ chọn các phiếu do danh sách thay đổi.", { type: "info" });
      }
    }

    function handleChange(event) {
      const ticketInput = event.target.closest("[data-bulk-ticket-select]");
      if (ticketInput && section.contains(ticketInput)) {
        event.stopPropagation();
        store.toggleTicket(ticketInput.dataset.bulkTicketSelect, ticketInput.checked);
        return;
      }
      const groupInput = event.target.closest("[data-bulk-group-select]");
      if (groupInput && section.contains(groupInput)) {
        event.stopPropagation();
        store.toggleGroup(groupInput.dataset.bulkGroupSelect, groupInput.checked);
        return;
      }
      if (event.target === selectAllInput) {
        store.toggleAll(selectAllInput.checked);
      }
    }

    function handleClick(event) {
      const modeToggle = event.target.closest("[data-bulk-mode-toggle]");
      if (modeToggle && tools.contains(modeToggle)) {
        if ([STATES.PREFLIGHTING, STATES.CONFIRMING, STATES.EXECUTING].includes(operationState)) return;
        const selecting = store.getSnapshot().mode === "selecting";
        if (selecting) {
          store.exit();
          setOperationState(STATES.IDLE);
        } else {
          store.enter();
          setOperationState(STATES.SELECTING);
        }
        return;
      }
      const clearButton = event.target.closest("[data-bulk-clear]");
      if (clearButton && commandBar.contains(clearButton)) {
        store.clear("command-clear");
        return;
      }
      const retainButton = event.target.closest("[data-bulk-retain-status]");
      if (retainButton && commandBar.contains(retainButton)) {
        store.retainStatus(retainButton.dataset.bulkRetainStatus);
        return;
      }
      const actionButton = event.target.closest("[data-bulk-action]");
      if (actionButton && commandBar.contains(actionButton) && !actionButton.disabled) {
        beginAction(actionButton.dataset.bulkAction);
      }
    }

    function guardTicketSurfaceActions(event) {
      if (store.getSnapshot().mode !== "selecting") return;
      const surface = event.target.closest("[data-bulk-ticket-id]");
      if (!surface || !section.contains(surface) || event.target.closest("[data-bulk-ticket-select]")) return;
      const interactive = event.target.closest("a, button, input, select, textarea, [role=\"button\"]");
      if (interactive && surface.contains(interactive)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    function handleDialogClick(event) {
      const presetButton = event.target.closest("[data-repair-result-preset]");
      if (presetButton && repairFields.contains(presetButton)) {
        const preset = clean(presetButton.dataset.repairResultPreset);
        repairDraftDirty = true;
        repairResultCommon = preset === "Khác" ? "" : preset;
        repairResultInput.value = repairResultCommon;
        renderRepairResultItems(pendingPlan);
        syncRepairResultValidation(true);
        repairResultInput.focus({ preventScroll: true });
        return;
      }

      const editButton = event.target.closest("[data-repair-result-edit]");
      if (editButton && dialogList.contains(editButton)) {
        const uuid = clean(editButton.dataset.repairResultEdit);
        if (!pendingPlan.some((item) => item.uuid === uuid)) return;
        editingRepairResultUuid = uuid;
        editingRepairResultDraft = effectiveRepairResult(uuid);
        renderRepairResultItems(pendingPlan);
        syncRepairResultValidation(true);
        const input = dialogList.querySelector("[data-repair-result-override-input]");
        if (input) input.focus({ preventScroll: true });
        return;
      }

      const applyButton = event.target.closest("[data-repair-result-apply]");
      if (applyButton && dialogList.contains(applyButton)) {
        const uuid = clean(applyButton.dataset.repairResultApply);
        const validation = validateRepairResult(editingRepairResultDraft);
        if (uuid !== editingRepairResultUuid || !validation.valid) {
          syncRepairResultValidation(true);
          return;
        }
        repairDraftDirty = true;
        repairResultOverrides.set(uuid, validation.value);
        editingRepairResultUuid = "";
        editingRepairResultDraft = "";
        renderRepairResultItems(pendingPlan);
        syncRepairResultValidation(true);
        return;
      }

      const cancelEditButton = event.target.closest("[data-repair-result-cancel]");
      if (cancelEditButton && dialogList.contains(cancelEditButton)) {
        editingRepairResultUuid = "";
        editingRepairResultDraft = "";
        renderRepairResultItems(pendingPlan);
        syncRepairResultValidation(true);
        return;
      }

      const useCommonButton = event.target.closest("[data-repair-result-use-common]");
      if (useCommonButton && dialogList.contains(useCommonButton)) {
        repairDraftDirty = true;
        repairResultOverrides.delete(clean(useCommonButton.dataset.repairResultUseCommon));
        renderRepairResultItems(pendingPlan);
        syncRepairResultValidation(true);
        return;
      }

      if (event.target === dialog) {
        event.preventDefault();
        requestDialogClose("backdrop");
      }
    }

    function handleDialogInput(event) {
      if (event.target === repairResultInput) {
        repairDraftDirty = true;
        repairResultCommon = event.target.value;
        renderRepairResultItems(pendingPlan);
        syncRepairResultValidation(true);
        return;
      }

      if (event.target.matches("[data-repair-result-override-input]")) {
        repairDraftDirty = true;
        editingRepairResultDraft = event.target.value;
        const row = event.target.closest(".ticket-bulk-repair-row");
        const applyButton = row && row.querySelector("[data-repair-result-apply]");
        if (applyButton) applyButton.disabled = !validateRepairResult(editingRepairResultDraft).valid;
        syncRepairResultValidation(true);
      }
    }

    async function handleConfirmClick() {
      if (confirmButton.dataset.bulkRetry === "true") {
        delete confirmButton.dataset.bulkRetry;
        if (pendingActionKey === "completeRepair" && capturesRepairResult) {
          await prepareCompleteRepairRetry();
          return;
        }
        const retryIds = lastFailedIds.slice();
        const retryDetails = pendingActionDetails;
        store.replaceSelection(retryIds, "retry-failed");
        closeDialog({ restoreFocus: false });
        await beginAction(pendingActionKey, { details: retryDetails });
        return;
      }
      await confirmExecution();
    }

    function handleCancelClick() {
      requestDialogClose("cancel");
    }

    function handleContinueEditingClick() {
      hideDiscardConfirmation();
    }

    function handleDiscardDraftClick() {
      resetRepairResultState();
      hideDiscardConfirmation({ restoreFocus: false });
      closeDialog();
    }

    const unsubscribe = store.subscribe(syncSelectionDom);
    section.addEventListener("click", guardTicketSurfaceActions, true);
    modeButton.addEventListener("click", handleClick);
    commandBar.addEventListener("click", handleClick);
    section.addEventListener("change", handleChange);
    cancelButton.addEventListener("click", handleCancelClick);
    confirmButton.addEventListener("click", handleConfirmClick);
    continueEditingButton.addEventListener("click", handleContinueEditingClick);
    discardDraftButton.addEventListener("click", handleDiscardDraftClick);
    dialog.addEventListener("click", handleDialogClick);
    dialog.addEventListener("input", handleDialogInput);
    window.addEventListener("pagehide", destroy, { once: true });
    syncSelectionDom(store.getSnapshot());

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      document.removeEventListener("keydown", handleDialogKeydown);
      section.removeEventListener("click", guardTicketSurfaceActions, true);
      modeButton.removeEventListener("click", handleClick);
      commandBar.removeEventListener("click", handleClick);
      section.removeEventListener("change", handleChange);
      cancelButton.removeEventListener("click", handleCancelClick);
      confirmButton.removeEventListener("click", handleConfirmClick);
      continueEditingButton.removeEventListener("click", handleContinueEditingClick);
      discardDraftButton.removeEventListener("click", handleDiscardDraftClick);
      dialog.removeEventListener("click", handleDialogClick);
      dialog.removeEventListener("input", handleDialogInput);
      window.removeEventListener("pagehide", destroy);
      unsubscribe();
      store.destroy();
      tools.remove();
      commandBar.remove();
      dialog.remove();
      document.body.classList.remove("ticket-bulk-modal-open");
    }

    return Object.freeze({
      clearForDataChange,
      destroy,
      getOperationState: () => operationState,
      getSelectionSnapshot: store.getSnapshot,
      syncRegistry
    });
  }

  return Object.freeze({
    BULK_ACTIONS,
    DISMISSAL_DECISIONS,
    REPAIR_RESULT_MAX_LENGTH,
    REPAIR_RESULT_PRESETS,
    REPAIR_RETURN_REASONS,
    STATES,
    buildRepairResultExecutionPlan,
    buildSelectionTicket,
    createControlledPool,
    createExecutionGuard,
    executePlan,
    isActionEligible,
    mountPageController,
    preflightTickets,
    repairModalDismissalDecision,
    validateRepairResult,
    validateWorkflowResponse
  });
});

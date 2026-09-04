(function () {
  "use strict";

  const notice = document.getElementById("ticketHistoryNotice");
  const ticketHistory = {
    section: document.getElementById("ticketHistorySection"),
    searchInput: document.getElementById("ticketHistorySearchInput"),
    searchClear: document.getElementById("ticketHistorySearchClear"),
    state: document.getElementById("ticketHistoryState"),
    content: document.getElementById("ticketHistoryContent"),
    summary: document.getElementById("ticketHistorySummary"),
    tableBody: document.getElementById("ticketHistoryTableBody"),
    pagination: document.getElementById("ticketHistoryPagination"),
    selectionHeading: document.getElementById("ticketHistorySelectionHeading"),
    selectMode: document.getElementById("ticketHistorySelectMode"),
    selectAllWrap: document.getElementById("ticketHistorySelectAllWrap"),
    selectAll: document.getElementById("ticketHistorySelectAll"),
    commandBar: document.getElementById("ticketHistoryCommandBar"),
    selectedCount: document.getElementById("ticketHistorySelectedCount"),
    selectedCodes: document.getElementById("ticketHistorySelectedCodes"),
    viewSelected: document.getElementById("ticketHistoryViewSelected"),
    deleteSelected: document.getElementById("ticketHistoryDeleteSelected"),
    exitSelection: document.getElementById("ticketHistoryExitSelection"),
    dialogBackdrop: document.getElementById("ticketHistoryDialogBackdrop"),
    dialog: document.getElementById("ticketHistoryDialog"),
    dialogTitle: document.getElementById("ticketHistoryDialogTitle"),
    dialogMessage: document.getElementById("ticketHistoryDialogMessage"),
    dialogContent: document.getElementById("ticketHistoryDialogContent"),
    dialogError: document.getElementById("ticketHistoryDialogError"),
    dialogActions: document.getElementById("ticketHistoryDialogActions")
  };

  const TICKET_HISTORY_PAGE_SIZE = 20;
  const TICKET_HISTORY_SEARCH_DELAY = 420;
  const HISTORY_SELECTED_VIEW_STORAGE_KEY = "anhminh.ticketHistorySelectedView.v1";
  const HISTORY_SELECTED_VIEW_VERSION = 1;
  const HISTORY_SELECTED_VIEW_MAX_TICKETS = 100;
  const SERVICE_TICKET_UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

  let ticketHistoryPage = 1;
  let ticketHistoryTotal = 0;
  let ticketHistoryTotalPages = 1;
  let ticketHistoryKeyword = "";
  let ticketHistorySearchTimer = null;
  let ticketHistoryRequestId = 0;
  const expandedBatchIds = new Set();
  const batchRowAnimationTimers = new WeakMap();
  const selectionStore = window.AMTicketBulkSelection.createSelectionStore();
  let currentPresentationRows = [];
  let canDeleteTickets = false;
  let dialogMode = "";
  let dialogReturnFocus = null;
  let pendingDeletePlan = null;
  const deleteExecutionLock = createTicketDeleteExecutionLock();

  function showNotice(type, message) {
    notice.className = `notice ${type} show`;
    notice.textContent = message;
  }

  function attachLogout() {
    document.querySelectorAll("[data-logout]").forEach((button) => {
      button.addEventListener("click", async function () {
        button.disabled = true;
        try {
          await window.AMApi.signOut();
        } catch (error) {
          showNotice("error", error.message);
          button.disabled = false;
        }
      });
    });
  }

  function textOrDash(value) {
    const text = String(value || "").trim();
    return text || "—";
  }

  function normalizeStatus(status) {
    return String(status || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function historyStatusToneClass(status) {
    const normalized = normalizeStatus(status);
    const tones = {
      "đang sửa": "ticket-history-status--in-progress",
      "đang sửa chữa": "ticket-history-status--in-progress",
      "chờ bàn giao": "ticket-history-status--handover",
      "bàn giao tivi": "ticket-history-status--handover",
      "bàn giao tv": "ticket-history-status--handover",
      "đang bàn giao": "ticket-history-status--handover",
      "giao trả": "ticket-history-status--handover",
      "giao trả sửa chữa": "ticket-history-status--handover",
      "đã trả": "ticket-history-status--completed",
      "đã bàn giao": "ticket-history-status--completed",
      "hoàn tất bàn giao": "ticket-history-status--completed"
    };

    return tones[normalized] || "";
  }

  function statusClass(status) {
    const normalized = normalizeStatus(status);
    const classes = {
      "mới nhận": "status-new",
      "đang kiểm tra": "status-checking",
      "báo giá": "status-quote",
      "đang sửa": "status-repairing",
      "chờ bàn giao": "status-handover",
      "bàn giao tivi": "status-handover",
      "giao trả sửa chữa": "status-handover",
      "đã xong": "status-done",
      "đã trả": "status-returned",
      "đã bàn giao": "status-returned",
      "huỷ": "status-cancelled"
    };

    return [classes[normalized], historyStatusToneClass(normalized)].filter(Boolean).join(" ");
  }

  function statusLabel(status) {
    return window.AMApi.formatTicketStatusLabel(status, "—");
  }

  function createCell(text, className) {
    const cell = document.createElement("td");
    cell.textContent = text;

    if (className) {
      cell.className = className;
    }

    return cell;
  }

  function createStatusBadge(status) {
    const badge = document.createElement("span");
    badge.className = `status-pill ${statusClass(status)}`.trim();
    badge.textContent = statusLabel(status);
    return badge;
  }

  function formatDateTimeVN(value) {
    if (!value) {
      return "Chưa có";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    })
      .format(date)
      .replace(",", "");
  }

  function cleanBatchMeta(value) {
    return String(value == null ? "" : value).trim().replace(/\s+/g, " ");
  }

  function getConsistentBatchAddress(tickets) {
    const addresses = (tickets || [])
      .map((ticket) => cleanBatchMeta(ticket.customer_address || ticket.customer_master_address))
      .filter(Boolean);

    if (!addresses.length) {
      return "";
    }

    const normalized = new Set(addresses.map((address) => address.toLocaleLowerCase("vi-VN")));
    return normalized.size === 1 ? addresses[0] : "";
  }

  function ticketModelSummary(ticket) {
    const values = [ticket && ticket.model, ticket && ticket.size]
      .map(cleanBatchMeta)
      .filter((value, index, source) => value && source.indexOf(value) === index);
    return values.join(" · ") || cleanBatchMeta(ticket && ticket.brand) || "—";
  }

  function historyBatchModelSummary(tickets) {
    const values = (tickets || []).map((ticket) => (
      cleanBatchMeta(ticket && ticket.size) || cleanBatchMeta(ticket && ticket.model)
    )).filter(Boolean);

    if (!values.length) {
      return "—";
    }

    if (values.length <= 3) {
      return values.join(" · ");
    }

    return `${values.slice(0, 2).join(" · ")} · +${values.length - 2}`;
  }

  function historyBatchCodeSummary(tickets) {
    const codes = (tickets || []).map((ticket) => window.AMApi.formatTicketCode(ticket.ticket_code));
    if (codes.length <= 3) {
      return codes.join(" · ");
    }
    return `${codes[0]} · ${codes[1]} · +${codes.length - 2} phiếu`;
  }

  function createPrimarySecondaryCell(primary, secondary, className) {
    const cell = document.createElement("td");
    const main = document.createElement("strong");
    main.textContent = textOrDash(primary);
    cell.className = className || "";
    cell.appendChild(main);

    if (secondary) {
      const detail = document.createElement("small");
      detail.textContent = secondary;
      detail.title = secondary;
      cell.appendChild(detail);
    }

    return cell;
  }

  function createTicketDeleteExecutionLock() {
    let active = false;
    return Object.freeze({
      acquire() {
        if (active) {
          return false;
        }
        active = true;
        return true;
      },
      isActive() {
        return active;
      },
      release() {
        active = false;
      }
    });
  }
  function ticketUuid(ticket) {
    return String(ticket && ticket.id || "").trim();
  }

  function ticketCode(ticket) {
    return String(ticket && ticket.ticket_code || "").trim().toUpperCase();
  }

  function buildSelectionRegistry(rows) {
    const tickets = [];
    const groups = [];

    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const sourceTickets = Array.isArray(row && row.tickets) ? row.tickets : [];
      const groupId = row && row.type === "batch" ? String(row.batchId || "").trim() : "";
      const childIds = [];

      sourceTickets.forEach((ticket, index) => {
        const uuid = ticketUuid(ticket);
        if (!uuid) {
          return;
        }
        childIds.push(uuid);
        tickets.push({
          uuid,
          code: ticketCode(ticket),
          status: ticket.status,
          customerCode: ticket.customer_code,
          customerName: ticket.customer_name || ticket.customer_master_name,
          model: ticket.model,
          groupId,
          groupSize: sourceTickets.length,
          childIndex: index + 1,
          sourcePage: "ticket-history",
          selectable: true
        });
      });

      if (groupId && childIds.length) {
        groups.push({ id: groupId, ticketIds: childIds });
      }
    });

    return Object.freeze({
      tickets: Object.freeze(tickets),
      groups: Object.freeze(groups)
    });
  }

  function normalizeDeletionPreflight(selectedTickets, rows) {
    const byId = new Map((Array.isArray(rows) ? rows : []).map((row) => [
      String(row && (row.ticket_id || row.id) || "").trim(),
      row || {}
    ]));
    const eligible = [];
    const blocked = [];

    (Array.isArray(selectedTickets) ? selectedTickets : []).forEach((snapshot) => {
      const uuid = String(snapshot && (snapshot.uuid || snapshot.id) || "").trim();
      const expectedCode = String(snapshot && (snapshot.code || snapshot.ticket_code) || "").trim().toUpperCase();
      const row = byId.get(uuid);
      const actualCode = String(row && row.ticket_code || expectedCode).trim().toUpperCase();
      const messages = Array.isArray(row && row.blocker_messages)
        ? row.blocker_messages.map((message) => String(message || "").trim()).filter(Boolean)
        : [];
      const item = Object.freeze({
        uuid,
        code: actualCode || expectedCode,
        status: String(row && row.current_status || snapshot && snapshot.status || "").trim(),
        customerCode: String(row && row.customer_code || snapshot && snapshot.customerCode || "").trim(),
        customerName: String(row && row.customer_name || snapshot && snapshot.customerName || "").trim(),
        model: String(row && row.model || snapshot && snapshot.model || "").trim(),
        blockers: Object.freeze(messages.length ? messages : ["Phiếu không còn đủ điều kiện xóa."])
      });

      if (!row) {
        blocked.push(Object.freeze(Object.assign({}, item, { blockers: Object.freeze(["Phiếu không còn tồn tại."]) })));
      } else if (actualCode !== expectedCode) {
        blocked.push(Object.freeze(Object.assign({}, item, { blockers: Object.freeze(["Mã phiếu không khớp dữ liệu đã chọn."]) })));
      } else if (row.eligible === true) {
        eligible.push(Object.freeze(Object.assign({}, item, { blockers: Object.freeze([]) })));
      } else {
        blocked.push(item);
      }
    });

    return Object.freeze({
      eligible: Object.freeze(eligible),
      blocked: Object.freeze(blocked)
    });
  }

  function createTicketSelectionCell(ticket, groupId, childIndex) {
    const cell = document.createElement("td");
    const code = window.AMApi.formatTicketCode(ticket.ticket_code);
    const childLabel = groupId ? `TV${String(childIndex + 1).padStart(2, "0")} ${code}` : `phiếu ${code}`;
    const control = window.AMTicketBulkSelection.createSelectionControl({
      kind: "ticket",
      id: ticketUuid(ticket),
      ariaLabel: `Chọn ${childLabel}`
    });
    cell.className = "ticket-history-selection-cell";
    cell.dataset.noRowToggle = "true";
    if (groupId) {
      cell.dataset.batchChildOf = groupId;
      cell.dataset.batchChildIndex = String(childIndex + 1);
    }
    cell.appendChild(control);
    return cell;
  }

  function createGroupSelectionCell(presentationRow) {
    const cell = document.createElement("td");
    const control = window.AMTicketBulkSelection.createSelectionControl({
      kind: "group",
      id: presentationRow.batchId,
      ariaLabel: `Chọn toàn bộ ${presentationRow.totalTicketCount} TV trong nhóm`
    });
    cell.className = "ticket-history-selection-cell ticket-history-group-selection-cell";
    cell.dataset.noRowToggle = "true";
    cell.appendChild(control);
    return cell;
  }

  function renderSelectionGeometry() {
    if (!currentPresentationRows.length || !ticketHistory.tableBody) {
      return;
    }
    const startIndex = (ticketHistoryPage - 1) * TICKET_HISTORY_PAGE_SIZE;
    renderTicketHistoryRows(currentPresentationRows, startIndex);
    syncSelectionUi(selectionStore.getSnapshot());
  }

  function selectionCodes(selected) {
    const codes = selected.map((ticket) => window.AMApi.formatTicketCode(ticket.code)).filter(Boolean);
    if (!codes.length) {
      return "Chọn phiếu trên trang để thao tác.";
    }
    return codes.length <= 4 ? codes.join(" · ") : `${codes.slice(0, 4).join(" · ")} · +${codes.length - 4}`;
  }

  function syncSelectionUi(snapshot) {
    const selecting = snapshot.mode === "selecting";
    ticketHistory.section.classList.toggle("is-ticket-bulk-selecting", selecting);
    ticketHistory.selectionHeading.hidden = !selecting;
    ticketHistory.selectAllWrap.hidden = !selecting;
    ticketHistory.selectMode.hidden = selecting;
    ticketHistory.commandBar.hidden = !selecting;
    ticketHistory.selectedCount.textContent = `Đã chọn ${snapshot.selectedCount} phiếu`;
    ticketHistory.selectedCodes.textContent = selectionCodes(snapshot.selected);
    ticketHistory.viewSelected.disabled = snapshot.selectedCount === 0;
    ticketHistory.viewSelected.textContent = snapshot.selectedCount > 1
      ? `Xem ${snapshot.selectedCount} phiếu`
      : "Xem phiếu";
    ticketHistory.deleteSelected.hidden = !canDeleteTickets;
    ticketHistory.deleteSelected.disabled = snapshot.selectedCount === 0 || !canDeleteTickets;
    ticketHistory.deleteSelected.textContent = snapshot.selectedCount > 1
      ? `Xóa ${snapshot.selectedCount} phiếu`
      : "Xóa phiếu";
    ticketHistory.selectAll.checked = snapshot.globalState.checked;
    ticketHistory.selectAll.indeterminate = snapshot.globalState.indeterminate;
    ticketHistory.selectAll.disabled = snapshot.globalState.disabled;

    ticketHistory.tableBody.querySelectorAll("[data-bulk-ticket-select]").forEach((input) => {
      input.checked = snapshot.selected.some((ticket) => ticket.uuid === input.dataset.bulkTicketSelect);
    });
    ticketHistory.tableBody.querySelectorAll("[data-bulk-group-select]").forEach((input) => {
      const state = selectionStore.getGroupState(input.dataset.bulkGroupSelect);
      input.checked = state.checked;
      input.indeterminate = state.indeterminate;
      input.disabled = state.disabled;
    });
    ticketHistory.tableBody.querySelectorAll("[data-ticket-history-uuid]").forEach((row) => {
      row.classList.toggle(
        "is-ticket-selected",
        snapshot.selected.some((ticket) => ticket.uuid === row.dataset.ticketHistoryUuid)
      );
    });
  }

  function clearSelectionForDataChange() {
    const snapshot = selectionStore.getSnapshot();
    if (snapshot.mode !== "selecting") {
      return;
    }
    const hadSelection = snapshot.selectedCount > 0;
    selectionStore.clear("history-data-change");
    if (hadSelection && window.AMUI && typeof window.AMUI.toast === "function") {
      window.AMUI.toast("Đã bỏ chọn các phiếu do danh sách thay đổi.", { type: "info" });
    }
  }

  function createDialogButton(label, className, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", handler, { once: true });
    return button;
  }

  function resetDialog() {
    ticketHistory.dialogContent.replaceChildren();
    ticketHistory.dialogActions.replaceChildren();
    ticketHistory.dialogError.hidden = true;
    ticketHistory.dialogError.textContent = "";
  }

  function openDialog(mode, title, message, trigger) {
    dialogMode = mode;
    dialogReturnFocus = trigger || document.activeElement;
    resetDialog();
    ticketHistory.dialogTitle.textContent = title;
    ticketHistory.dialogMessage.textContent = message || "";
    ticketHistory.dialogBackdrop.hidden = false;
    document.body.classList.add("ticket-bulk-modal-open");
    ticketHistory.dialog.focus({ preventScroll: true });
  }

  function closeDialog(options) {
    const settings = options || {};
    if (deleteExecutionLock.isActive() && settings.force !== true) {
      return;
    }
    ticketHistory.dialogBackdrop.hidden = true;
    document.body.classList.remove("ticket-bulk-modal-open");
    dialogMode = "";
    pendingDeletePlan = null;
    if (settings.restoreFocus !== false && dialogReturnFocus && document.contains(dialogReturnFocus)) {
      dialogReturnFocus.focus({ preventScroll: true });
    }
    dialogReturnFocus = null;
  }

  function createTicketReviewList(items) {
    const list = document.createElement("ul");
    list.className = "ticket-bulk-dialog-list ticket-history-review-list";
    items.forEach((ticket) => {
      const item = document.createElement("li");
      const content = document.createElement("span");
      const code = document.createElement("strong");
      const customer = document.createElement("span");
      const model = document.createElement("span");
      code.textContent = window.AMApi.formatTicketCode(ticket.code);
      customer.textContent = textOrDash(ticket.customerName);
      model.textContent = textOrDash(ticket.model);
      content.append(code, customer, model);
      item.appendChild(content);
      list.appendChild(item);
    });
    return list;
  }

  function createHistorySelectedTicketsHandoff(selected, nowValue) {
    const ticketIds = Array.from(new Set((Array.isArray(selected) ? selected : [])
      .map((ticket) => String(ticket && ticket.uuid || "").trim().toLowerCase())
      .filter((ticketId) => SERVICE_TICKET_UUID_PATTERN.test(ticketId))))
      .slice(0, HISTORY_SELECTED_VIEW_MAX_TICKETS);

    if (ticketIds.length === 0) {
      return null;
    }

    return Object.freeze({
      version: HISTORY_SELECTED_VIEW_VERSION,
      source: "ticket-history",
      createdAt: Number.isFinite(Number(nowValue)) ? Number(nowValue) : Date.now(),
      ticketIds: Object.freeze(ticketIds)
    });
  }

  function viewSelectedTickets() {
    const snapshot = selectionStore.getSnapshot();
    const payload = createHistorySelectedTicketsHandoff(snapshot.selected);

    if (!payload) {
      showNotice("error", "Không xác định được phiếu đã chọn. Vui lòng chọn lại.");
      return;
    }

    try {
      window.sessionStorage.setItem(HISTORY_SELECTED_VIEW_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      showNotice("error", "Không thể mở các phiếu đã chọn trong tab này. Vui lòng thử lại.");
      return;
    }

    window.location.assign("search.html?view=history-selection");
  }

  function createClassificationSection(title, items, blocked) {
    const section = document.createElement("section");
    const heading = document.createElement("h3");
    heading.className = "ticket-history-dialog-section-title";
    heading.textContent = `${title}: ${items.length} phiếu`;
    section.appendChild(heading);
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "ticket-history-dialog-empty";
      empty.textContent = "Không có.";
      section.appendChild(empty);
      return section;
    }
    const list = createTicketReviewList(items);
    if (blocked) {
      list.classList.add("is-blocked");
      Array.from(list.children).forEach((row, index) => {
        const reason = document.createElement("small");
        reason.textContent = items[index].blockers.join(" ");
        row.firstElementChild.appendChild(reason);
      });
    }
    section.appendChild(list);
    return section;
  }

  function showDeletionPreflightError(error) {
    const errorType = String(error && error.ticketDeletionErrorType || "unknown");
    const titles = {
      unavailable: "Chưa thể xóa phiếu",
      permission: "Không có quyền xóa phiếu",
      network: "Không thể kiểm tra điều kiện xóa",
      request: "Không thể kiểm tra điều kiện xóa",
      server: "Không thể kiểm tra điều kiện xóa"
    };
    ticketHistory.dialogTitle.textContent = titles[errorType] || "Không thể kiểm tra điều kiện xóa";
    ticketHistory.dialogMessage.textContent = error && error.message
      ? error.message
      : "Không thể kiểm tra điều kiện xóa. Vui lòng thử lại.";
    ticketHistory.dialogContent.replaceChildren();
    ticketHistory.dialogActions.replaceChildren();
    const close = createDialogButton("Đóng", "btn secondary", () => closeDialog());
    ticketHistory.dialogActions.appendChild(close);
    close.focus({ preventScroll: true });
  }

  async function beginDeleteReview() {
    const snapshot = selectionStore.getSnapshot();
    if (!canDeleteTickets || !snapshot.selectedCount || deleteExecutionLock.isActive()) {
      return;
    }

    openDialog(
      "delete-preflight",
      "Kiểm tra điều kiện xóa phiếu",
      "Đang tải trạng thái và quan hệ mới nhất từ hệ thống...",
      ticketHistory.deleteSelected
    );
    const cancel = createDialogButton("Hủy", "btn secondary", () => closeDialog());
    ticketHistory.dialogActions.appendChild(cancel);

    try {
      const rows = await window.AMApi.preflightTicketDeletion(snapshot.selected);
      if (dialogMode !== "delete-preflight") {
        return;
      }
      const classification = normalizeDeletionPreflight(snapshot.selected, rows);
      pendingDeletePlan = classification.eligible;
      ticketHistory.dialogTitle.textContent = `Xem lại ${snapshot.selectedCount} phiếu đã chọn`;
      ticketHistory.dialogMessage.textContent = "Chỉ những phiếu đủ điều kiện mới có thể được đưa vào bước xác nhận xóa vĩnh viễn.";
      ticketHistory.dialogContent.replaceChildren(
        createClassificationSection("Có thể xóa", classification.eligible, false),
        createClassificationSection("Không thể xóa", classification.blocked, true)
      );
      ticketHistory.dialogActions.replaceChildren();
      const close = createDialogButton("Hủy", "btn secondary", () => closeDialog());
      ticketHistory.dialogActions.appendChild(close);
      if (classification.eligible.length) {
        const continueButton = createDialogButton(
          `Tiếp tục xóa ${classification.eligible.length} phiếu đủ điều kiện`,
          "btn danger",
          () => showHardDeleteConfirmation(classification.eligible)
        );
        ticketHistory.dialogActions.appendChild(continueButton);
      }
      close.focus({ preventScroll: true });
    } catch (error) {
      showDeletionPreflightError(error);
    }
  }

  function showHardDeleteConfirmation(plan) {
    pendingDeletePlan = Object.freeze(plan.slice());
    dialogMode = "delete-confirm";
    resetDialog();
    ticketHistory.dialogTitle.textContent = `Xóa vĩnh viễn ${plan.length} phiếu?`;
    ticketHistory.dialogMessage.textContent = "Các phiếu này sẽ bị xóa khỏi Supabase. Khách hàng và các phiếu khác của khách vẫn được giữ nguyên.";
    ticketHistory.dialogContent.appendChild(createTicketReviewList(plan, false));

    let confirmationInput = null;
    if (plan.length >= 2) {
      const field = document.createElement("label");
      const label = document.createElement("span");
      confirmationInput = document.createElement("input");
      field.className = "ticket-history-delete-confirm-field";
      label.textContent = "Nhập XOA để xác nhận xóa nhiều phiếu";
      confirmationInput.type = "text";
      confirmationInput.autocomplete = "off";
      confirmationInput.spellcheck = false;
      field.append(label, confirmationInput);
      ticketHistory.dialogContent.appendChild(field);
    }

    const cancel = createDialogButton("Hủy", "btn secondary", () => closeDialog());
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "btn danger";
    confirm.textContent = `Xóa vĩnh viễn ${plan.length} phiếu`;
    confirm.disabled = Boolean(confirmationInput);
    confirm.addEventListener("click", executeHardDelete);
    if (confirmationInput) {
      confirmationInput.addEventListener("input", () => {
        confirm.disabled = confirmationInput.value.trim().toUpperCase() !== "XOA";
      });
    }
    ticketHistory.dialogActions.append(cancel, confirm);
    cancel.focus({ preventScroll: true });
  }

  function createDeleteRequestId() {
    if (!window.crypto || typeof window.crypto.randomUUID !== "function") {
      throw new Error("Trình duyệt chưa hỗ trợ mã yêu cầu an toàn. Chưa có phiếu nào bị xóa.");
    }
    return window.crypto.randomUUID();
  }

  async function executeHardDelete() {
    if (dialogMode !== "delete-confirm" || !pendingDeletePlan || !pendingDeletePlan.length || !deleteExecutionLock.acquire()) {
      return;
    }
    dialogMode = "delete-executing";
    ticketHistory.dialogTitle.textContent = `Đang xóa ${pendingDeletePlan.length} phiếu`;
    ticketHistory.dialogMessage.textContent = "Vui lòng giữ nguyên trang cho đến khi hệ thống xác nhận hoàn tất.";
    ticketHistory.dialogActions.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });

    const plan = pendingDeletePlan.slice();
    try {
      const result = await window.AMApi.deleteTicketsSafely(plan, createDeleteRequestId());
      const deleted = new Map((Array.isArray(result) ? result : []).map((row) => [
        String(row && row.deleted_ticket_id || "").trim(),
        String(row && row.deleted_ticket_code || "").trim().toUpperCase()
      ]));
      const confirmed = plan.every((item) => deleted.get(item.uuid) === item.code);
      if (!confirmed || deleted.size !== plan.length) {
        throw new Error("Hệ thống chưa xác nhận đầy đủ kết quả xóa. Danh sách sẽ được tải lại để đối chiếu.");
      }

      const deletedIds = plan.map((item) => item.uuid);
      window.AMMultiTicketPresentation.removeTicketsFromRegistry(deletedIds);
      selectionStore.removeMany(deletedIds, "delete-success");
      selectionStore.exit();
      closeDialog({ restoreFocus: false, force: true });
      if (window.AMUI && typeof window.AMUI.toast === "function") {
        window.AMUI.toast(`Đã xóa ${plan.length} phiếu.`, { type: "success" });
      }
      await loadTicketHistory(false);
    } catch (error) {
      if (error && error.ticketDeletionErrorType === "not-found") {
        await loadTicketHistory(false);
      }
      ticketHistory.dialogError.textContent = error && error.message
        ? error.message
        : "Không thể xóa phiếu. Vui lòng thử lại.";
      ticketHistory.dialogError.hidden = false;
      dialogMode = "delete-confirm";
      ticketHistory.dialogActions.querySelectorAll("button").forEach((button) => {
        button.disabled = false;
      });
    } finally {
      deleteExecutionLock.release();
    }
  }

  function handleDialogKeydown(event) {
    if (ticketHistory.dialogBackdrop.hidden) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (!deleteExecutionLock.isActive()) {
        closeDialog();
      }
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const focusable = Array.from(ticketHistory.dialog.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((element) => !element.hidden);
    if (!focusable.length) {
      event.preventDefault();
      ticketHistory.dialog.focus({ preventScroll: true });
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
  }

  function attachTicketHistorySelection() {
    selectionStore.subscribe(syncSelectionUi);
    ticketHistory.selectMode.addEventListener("click", () => {
      selectionStore.enter();
      renderSelectionGeometry();
    });
    ticketHistory.exitSelection.addEventListener("click", () => {
      selectionStore.exit();
      renderSelectionGeometry();
      ticketHistory.selectMode.focus({ preventScroll: true });
    });
    ticketHistory.selectAll.addEventListener("change", () => {
      selectionStore.toggleAll(ticketHistory.selectAll.checked);
    });
    ticketHistory.viewSelected.addEventListener("click", viewSelectedTickets);
    ticketHistory.deleteSelected.addEventListener("click", beginDeleteReview);
    ticketHistory.tableBody.addEventListener("change", (event) => {
      const ticketInput = event.target.closest("[data-bulk-ticket-select]");
      if (ticketInput) {
        selectionStore.toggleTicket(ticketInput.dataset.bulkTicketSelect, ticketInput.checked);
        return;
      }
      const groupInput = event.target.closest("[data-bulk-group-select]");
      if (groupInput) {
        selectionStore.toggleGroup(groupInput.dataset.bulkGroupSelect, groupInput.checked);
      }
    });
    ticketHistory.dialogBackdrop.addEventListener("click", (event) => {
      if (event.target !== ticketHistory.dialogBackdrop) {
        return;
      }
      event.preventDefault();
      if (dialogMode === "view") {
        closeDialog();
      }
    });
    document.addEventListener("keydown", handleDialogKeydown);
  }

  async function loadTicketDeletePermission() {
    try {
      const access = await window.AMApi.getEmployeeModuleAccess();
      canDeleteTickets = Boolean(access && access.can_manage === true);
    } catch (_error) {
      canDeleteTickets = false;
    }
    syncSelectionUi(selectionStore.getSnapshot());
  }

  window.AMTicketHistorySelectionDelete = Object.freeze({
    buildSelectionRegistry,
    buildTicketHistoryPresentationPage,

    createHistorySelectedTicketsHandoff,
    HISTORY_SELECTED_VIEW_STORAGE_KEY,
    createTicketDeleteExecutionLock,
    normalizeDeletionPreflight
  });
  function createTicketHistorySpacer(batchId, childIndex, hidden, isGroupEnd) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    row.className = isGroupEnd
      ? "ticket-history-batch-end-spacer"
      : "ticket-history-batch-child-spacer";
    row.setAttribute("aria-hidden", "true");
    row.setAttribute("role", "presentation");
    cell.colSpan = selectionStore.getSnapshot().mode === "selecting" ? 10 : 9;
    row.appendChild(cell);

    if (!isGroupEnd) {
      row.dataset.batchSpacerOf = batchId;
      row.dataset.batchSpacerIndex = String(childIndex + 1);
      row.hidden = hidden;
    }

    return row;
  }

  function setTicketHistoryState(type, message) {
    if (!ticketHistory.state || !ticketHistory.content) {
      return;
    }

    ticketHistory.state.textContent = type === "refreshing" ? "" : message;
    window.AMUI.setSectionState({
      section: ticketHistory.section,
      stateElement: ticketHistory.state,
      dataElement: ticketHistory.content
    }, type);
  }

  function createTicketHistoryLink(ticket) {
    const link = document.createElement("a");
    link.className = "btn secondary compact ticket-history-link";
    link.textContent = "Xem phiếu";
    link.href = ticket && ticket.ticket_code
      ? `search.html?code=${encodeURIComponent(ticket.ticket_code)}`
      : "search.html";
    return link;
  }

  function getVisiblePages(pageCount, currentPage) {
    if (pageCount <= 7) {
      return Array.from({ length: pageCount }, (_, index) => index + 1);
    }

    const pages = [1];
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(pageCount - 1, currentPage + 1);

    if (start > 2) {
      pages.push("start-ellipsis");
    }

    for (let page = start; page <= end; page += 1) {
      pages.push(page);
    }

    if (end < pageCount - 1) {
      pages.push("end-ellipsis");
    }

    pages.push(pageCount);
    return pages;
  }

  function createTicketHistoryRow(ticket, indexLabel, batchId, childIndex) {
      const row = document.createElement("tr");
      const statusCell = document.createElement("td");
      const actionCell = document.createElement("td");
      row.dataset.ticketHistoryUuid = ticketUuid(ticket);
      if (batchId) {
        row.className = "ticket-presentation-child-row";
        row.dataset.batchChildOf = batchId;
        row.dataset.batchChildIndex = String(childIndex + 1);
      }
      statusCell.appendChild(createStatusBadge(ticket.status));
      actionCell.appendChild(createTicketHistoryLink(ticket));

      if (selectionStore.getSnapshot().mode === "selecting") {
        row.appendChild(createTicketSelectionCell(ticket, batchId, childIndex));
      }

      row.append(
        createCell(indexLabel, "ticket-history-index"),
        createCell(formatDateTimeVN(ticket.created_at), "ticket-history-time"),
        createCell(window.AMApi.formatTicketCode(ticket.ticket_code), "ticket-history-code"),
        createCell(window.AMApi.formatCustomerCode(ticket.customer_code), "ticket-history-customer-code"),
        createCell(textOrDash(ticket.customer_name || ticket.customer_master_name), "ticket-history-customer-name"),
        createCell(textOrDash(ticket.customer_phone || ticket.customer_master_phone)),
        createCell(batchId ? ticketModelSummary(ticket) : textOrDash(ticket.model)),
        statusCell,
        actionCell
      );
      return row;
  }

  function historyBatchStatusSummary(tickets) {
    const counts = new Map();
    tickets.forEach((ticket) => {
      const label = statusLabel(ticket.status);
      counts.set(label, (counts.get(label) || 0) + 1);
    });
    return Array.from(counts, ([label, count]) => `${count} ${label}`).join(" · ");
  }

  function historyBatchStatusToneClass(tickets) {
    const tones = tickets.map((ticket) => historyStatusToneClass(ticket.status));
    if (!tones.length || tones.some((tone) => !tone)) {
      return "";
    }

    return new Set(tones).size === 1 ? tones[0] : "";
  }

  function renderTicketHistoryRows(rows, startIndex) {
    ticketHistory.tableBody.innerHTML = "";

    rows.forEach((presentationRow, index) => {
      if (presentationRow.type !== "batch") {
        ticketHistory.tableBody.appendChild(createTicketHistoryRow(
          presentationRow.tickets[0],
          String(startIndex + index + 1)
        ));
        return;
      }

      const firstTicket = presentationRow.tickets[0] || {};
      const expanded = Boolean(ticketHistoryKeyword) || expandedBatchIds.has(presentationRow.batchId);
      const parent = document.createElement("tr");
      const presentationIndex = String(startIndex + index + 1);
      const customerAddress = getConsistentBatchAddress(presentationRow.tickets);
      const codeCell = document.createElement("td");
      const customerCell = createPrimarySecondaryCell(
        firstTicket.customer_name || firstTicket.customer_master_name,
        customerAddress,
        "ticket-history-customer-name ticket-history-batch-customer"
      );
      const statusCell = document.createElement("td");
      const actionCell = document.createElement("td");
      const toggle = document.createElement("button");
      const badge = document.createElement("span");
      const codes = document.createElement("strong");
      const status = document.createElement("span");
      const chevron = document.createElement("span");

      parent.className = `ticket-history-batch-row${expanded ? " is-expanded" : ""}`;
      parent.dataset.ticketBatchRowToggle = presentationRow.batchId;
      parent.tabIndex = 0;
      parent.setAttribute("aria-expanded", String(expanded));
      parent.setAttribute("aria-label", `${expanded ? "Thu gọn" : "Mở"} nhóm ${presentationRow.totalTicketCount} tivi`);

      badge.className = "ticket-history-batch-badge";
      badge.textContent = `[${presentationRow.totalTicketCount} TV]`;
      codes.textContent = historyBatchCodeSummary(presentationRow.tickets);
      codeCell.className = "ticket-history-code ticket-history-batch-codes";
      codeCell.append(badge, codes);

      status.className = [
        "status-pill",
        "ticket-history-batch-status",
        historyBatchStatusToneClass(presentationRow.tickets)
      ].filter(Boolean).join(" ");
      status.textContent = historyBatchStatusSummary(presentationRow.tickets);
      status.title = status.textContent;
      statusCell.appendChild(status);

      toggle.type = "button";
      toggle.className = "ticket-history-batch-toggle";
      toggle.dataset.ticketBatchToggle = presentationRow.batchId;
      toggle.dataset.batchCount = String(presentationRow.totalTicketCount);
      toggle.setAttribute("aria-expanded", String(expanded));
      toggle.setAttribute("aria-label", `${expanded ? "Thu gọn" : "Mở"} nhóm ${presentationRow.totalTicketCount} tivi`);
      chevron.className = "ticket-history-batch-chevron";
      chevron.setAttribute("aria-hidden", "true");
      toggle.appendChild(chevron);
      actionCell.className = "ticket-history-batch-action";
      actionCell.appendChild(toggle);

      if (selectionStore.getSnapshot().mode === "selecting") {
        parent.appendChild(createGroupSelectionCell(presentationRow));
      }

      parent.append(
        createCell(presentationIndex, "ticket-history-index"),
        createCell(formatDateTimeVN(firstTicket.created_at), "ticket-history-time"),
        codeCell,
        createCell(window.AMApi.formatCustomerCode(firstTicket.customer_code), "ticket-history-customer-code"),
        customerCell,
        createCell(textOrDash(firstTicket.customer_phone || firstTicket.customer_master_phone)),
        createCell(historyBatchModelSummary(presentationRow.tickets), "ticket-history-batch-model"),
        statusCell,
        actionCell
      );
      ticketHistory.tableBody.appendChild(parent);

      presentationRow.tickets.forEach((ticket, childIndex) => {
        ticketHistory.tableBody.appendChild(createTicketHistorySpacer(
          presentationRow.batchId,
          childIndex,
          !expanded,
          false
        ));
        const child = createTicketHistoryRow(
          ticket,
          `TV${String(childIndex + 1).padStart(2, "0")}`,
          presentationRow.batchId,
          childIndex
        );
        child.hidden = !expanded;
        ticketHistory.tableBody.appendChild(child);
      });
      ticketHistory.tableBody.appendChild(createTicketHistorySpacer(
        presentationRow.batchId,
        presentationRow.tickets.length,
        false,
        true
      ));
    });
  }

  function renderTicketHistoryPagination(pageCount) {
    ticketHistory.pagination.innerHTML = "";

    if (pageCount <= 1) {
      ticketHistory.pagination.hidden = true;
      return;
    }

    ticketHistory.pagination.hidden = false;

    const previous = document.createElement("button");
    previous.type = "button";
    previous.textContent = "← Trang trước";
    previous.disabled = ticketHistoryPage === 1;
    previous.addEventListener("click", () => setTicketHistoryPage(ticketHistoryPage - 1));
    ticketHistory.pagination.appendChild(previous);

    getVisiblePages(pageCount, ticketHistoryPage).forEach((page) => {
      if (typeof page !== "number") {
        const ellipsis = document.createElement("span");
        ellipsis.className = "pagination-ellipsis";
        ellipsis.textContent = "...";
        ticketHistory.pagination.appendChild(ellipsis);
        return;
      }

      const pageButton = document.createElement("button");
      pageButton.type = "button";
      pageButton.textContent = String(page);
      pageButton.className = page === ticketHistoryPage ? "active" : "";
      pageButton.setAttribute("aria-label", `Trang ${page}`);

      if (page === ticketHistoryPage) {
        pageButton.setAttribute("aria-current", "page");
      }

      pageButton.addEventListener("click", () => setTicketHistoryPage(page));
      ticketHistory.pagination.appendChild(pageButton);
    });

    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "Trang sau →";
    next.disabled = ticketHistoryPage === pageCount;
    next.addEventListener("click", () => setTicketHistoryPage(ticketHistoryPage + 1));
    ticketHistory.pagination.appendChild(next);
  }

  function scrollToTicketHistory() {
    if (!ticketHistory.section) {
      return;
    }

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ticketHistory.section.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "start"
    });
  }

  function createSingleTicketPresentationRows(records) {
    return (Array.isArray(records) ? records : []).map((ticket, sourceIndex) => ({
      type: "ticket",
      key: `ticket:${ticketUuid(ticket) || sourceIndex}`,
      tickets: [ticket],
      sourceIndex
    }));
  }

  function paginateTicketHistoryRows(rows, page, pageSize) {
    const source = Array.isArray(rows) ? rows : [];
    const size = Math.max(Number(pageSize) || 1, 1);
    const totalPages = Math.max(1, Math.ceil(source.length / size));
    const safePage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
    const from = (safePage - 1) * size;
    return {
      rows: source.slice(from, from + size),
      page: safePage,
      pageSize: size,
      totalRows: source.length,
      totalPages
    };
  }

  function buildTicketHistoryPresentationPage(records, page, pageSize) {
    const source = Array.isArray(records) ? records : [];
    const presentation = window.AMMultiTicketPresentation;

    if (presentation
      && typeof presentation.buildTicketPresentationRows === "function"
      && typeof presentation.paginateRows === "function") {
      try {
        const rows = presentation.buildTicketPresentationRows(source);
        return presentation.paginateRows(rows, page, pageSize);
      } catch (error) {
        console.warn("[ticket-history] Multi presentation unavailable; using single-ticket rows.", error);
      }
    }

    return paginateTicketHistoryRows(createSingleTicketPresentationRows(source), page, pageSize);
  }

  function renderTicketHistory(rows) {
    const total = ticketHistoryTotal;

    currentPresentationRows = Array.isArray(rows) ? rows.slice() : [];
    selectionStore.setRegistry(buildSelectionRegistry(currentPresentationRows), {
      preserveSelection: false,
      reason: "history-render"
    });

    if (total === 0) {
      ticketHistory.tableBody.replaceChildren();
      setTicketHistoryState(
        "empty",
        ticketHistoryKeyword ? "Không tìm thấy phiếu phù hợp." : "Chưa có phiếu nào."
      );
      return;
    }

    const pageCount = ticketHistoryTotalPages;
    ticketHistoryPage = Math.min(ticketHistoryPage, pageCount);

    const startIndex = (ticketHistoryPage - 1) * TICKET_HISTORY_PAGE_SIZE;
    const visibleTicketCount = rows.reduce((count, row) => count + row.tickets.length, 0);

    renderTicketHistoryRows(rows, startIndex);
    syncSelectionUi(selectionStore.getSnapshot());
    renderTicketHistoryPagination(pageCount);
    ticketHistory.summary.textContent = `Đang hiển thị ${visibleTicketCount} phiếu trong ${rows.length} mục · Tổng số ${total} phiếu`;
    setTicketHistoryState("data", "");
  }

  async function loadTicketHistory(shouldScroll) {
    if (!ticketHistory.section) {
      return;
    }

    const requestId = ticketHistoryRequestId + 1;
    ticketHistoryRequestId = requestId;
    const hasRenderedData = !ticketHistory.content.hidden && ticketHistory.tableBody.childElementCount > 0;
    setTicketHistoryState(
      hasRenderedData ? "refreshing" : "loading",
      hasRenderedData ? "Đang cập nhật lịch sử..." : "Đang tải lịch sử..."
    );

    let result;
    try {
      result = await window.AMApi.getTicketsForGroupedPresentation({
        query: ticketHistoryKeyword,
        page: ticketHistoryPage,
        pageSize: TICKET_HISTORY_PAGE_SIZE,
        includeIntakeBatchMetadata: true
      });
    } catch (error) {
      if (requestId !== ticketHistoryRequestId) {
        return;
      }
      console.error("[ticket-history] Ticket API load failed.", error);
      setTicketHistoryState("error", "Không tải được lịch sử nhận phiếu. Vui lòng thử lại.");
      return;
    }

    if (requestId !== ticketHistoryRequestId) {
      return;
    }

    try {
      ticketHistoryTotal = result.totalCount || 0;
      const pageResult = buildTicketHistoryPresentationPage(
        result.records || [],
        ticketHistoryPage,
        TICKET_HISTORY_PAGE_SIZE
      );
      ticketHistoryPage = pageResult.page;
      ticketHistoryTotalPages = pageResult.totalPages;
      renderTicketHistory(pageResult.rows);

      if (shouldScroll) {
        scrollToTicketHistory();
      }
    } catch (error) {
      console.error("[ticket-history] Ticket rows could not be rendered.", error);
      setTicketHistoryState("error", "Không thể hiển thị lịch sử nhận phiếu. Vui lòng thử lại.");
    }
  }

  function setTicketHistoryPage(page) {
    clearSelectionForDataChange();
    ticketHistoryPage = Math.min(Math.max(page, 1), ticketHistoryTotalPages);
    loadTicketHistory(true);
  }

  function clearTicketHistorySearch() {
    clearSelectionForDataChange();
    if (ticketHistorySearchTimer) {
      window.clearTimeout(ticketHistorySearchTimer);
      ticketHistorySearchTimer = null;
    }

    ticketHistoryKeyword = "";
    ticketHistoryPage = 1;

    if (ticketHistory.searchInput) {
      ticketHistory.searchInput.value = "";
    }

    if (ticketHistory.searchClear) {
      ticketHistory.searchClear.hidden = true;
    }

    loadTicketHistory(false);
  }

  function scheduleTicketHistorySearch() {
    if (!ticketHistory.searchInput || !ticketHistory.searchClear) {
      return;
    }

    const keyword = ticketHistory.searchInput.value.trim();
    ticketHistory.searchClear.hidden = keyword.length === 0;

    if (ticketHistorySearchTimer) {
      window.clearTimeout(ticketHistorySearchTimer);
    }

    ticketHistorySearchTimer = window.setTimeout(() => {
      clearSelectionForDataChange();
      ticketHistoryKeyword = keyword;
      ticketHistoryPage = 1;
      loadTicketHistory(false);
    }, TICKET_HISTORY_SEARCH_DELAY);
  }

  function attachTicketHistorySearch() {
    if (!ticketHistory.searchInput || !ticketHistory.searchClear) {
      return;
    }

    ticketHistory.searchInput.addEventListener("input", scheduleTicketHistorySearch);
    ticketHistory.searchClear.addEventListener("click", clearTicketHistorySearch);
  }

  function setTicketHistoryBatchExpanded(toggle, shouldExpand) {
    const batchId = toggle.dataset.ticketBatchToggle;
    const batchCount = toggle.dataset.batchCount;
    const stateLabel = `${shouldExpand ? "Thu gọn" : "Mở"} nhóm${batchCount ? ` ${batchCount}` : ""} tivi`;
    const parent = toggle.closest(".ticket-history-batch-row");
    const childRows = Array.from(ticketHistory.tableBody.querySelectorAll("[data-batch-child-of]"))
      .filter((row) => row.dataset.batchChildOf === batchId);
    const spacerRows = Array.from(ticketHistory.tableBody.querySelectorAll("[data-batch-spacer-of]"))
      .filter((row) => row.dataset.batchSpacerOf === batchId);

    toggle.setAttribute("aria-expanded", String(shouldExpand));
    toggle.setAttribute("aria-label", stateLabel);
    if (parent) {
      parent.classList.toggle("is-expanded", shouldExpand);
      parent.setAttribute("aria-expanded", String(shouldExpand));
      parent.setAttribute("aria-label", stateLabel);
    }

    if (shouldExpand) {
      expandedBatchIds.add(batchId);
      spacerRows.forEach((row) => {
        row.hidden = false;
      });
    } else {
      expandedBatchIds.delete(batchId);
    }

    childRows.forEach((row) => {
      const pendingTimer = batchRowAnimationTimers.get(row);
      const matchingSpacer = spacerRows.find((spacer) => (
        spacer.dataset.batchSpacerIndex === row.dataset.batchChildIndex
      ));
      if (pendingTimer) {
        window.clearTimeout(pendingTimer);
      }
      row.classList.remove("is-revealing", "is-collapsing");

      if (shouldExpand) {
        row.hidden = false;
        row.classList.add("is-revealing");
        batchRowAnimationTimers.set(row, window.setTimeout(() => {
          row.classList.remove("is-revealing");
          batchRowAnimationTimers.delete(row);
        }, 180));
        return;
      }

      row.classList.add("is-collapsing");
      batchRowAnimationTimers.set(row, window.setTimeout(() => {
        if (toggle.getAttribute("aria-expanded") !== "true") {
          row.hidden = true;
          if (matchingSpacer) {
            matchingSpacer.hidden = true;
          }
        }
        row.classList.remove("is-collapsing");
        batchRowAnimationTimers.delete(row);
      }, 180));
    });
  }

  function toggleTicketHistoryBatch(toggle) {
    if (!toggle) {
      return;
    }
    setTicketHistoryBatchExpanded(toggle, toggle.getAttribute("aria-expanded") !== "true");
  }

  function attachTicketHistoryGrouping() {
    ticketHistory.tableBody.addEventListener("click", (event) => {
      const toggle = event.target.closest("[data-ticket-batch-toggle]");
      if (toggle) {
        event.preventDefault();
        event.stopPropagation();
        toggleTicketHistoryBatch(toggle);
        return;
      }

      const parent = event.target.closest("[data-ticket-batch-row-toggle]");
      if (!parent) {
        return;
      }

      const interactiveTarget = event.target.closest(
        "button, a, input, select, textarea, [role=\"button\"], [data-no-row-toggle]"
      );
      if (interactiveTarget && parent.contains(interactiveTarget)) {
        return;
      }

      toggleTicketHistoryBatch(parent.querySelector("[data-ticket-batch-toggle]"));
    });

    ticketHistory.tableBody.addEventListener("keydown", (event) => {
      const parent = event.target.closest("[data-ticket-batch-row-toggle]");
      if (!parent || event.target !== parent || (event.key !== "Enter" && event.key !== " ")) {
        return;
      }

      event.preventDefault();
      toggleTicketHistoryBatch(parent.querySelector("[data-ticket-batch-toggle]"));
    });
  }

  async function initTicketHistory() {
    attachLogout();
    attachTicketHistorySearch();
    attachTicketHistoryGrouping();
    attachTicketHistorySelection();

    try {
      const access = await window.AMApi.requireInternalAccess();
      if (!access) {
        return;
      }

      loadTicketDeletePermission();
      loadTicketHistory(false);
    } catch (error) {
      showNotice("error", error.message);
    }
  }

  document.addEventListener("DOMContentLoaded", initTicketHistory);
})();

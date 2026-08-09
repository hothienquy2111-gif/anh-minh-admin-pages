(function () {
  "use strict";

  const searchForm = document.getElementById("searchForm");
  const searchInput = document.getElementById("searchInput");
  const searchButton = document.getElementById("searchButton");
  const searchClear = document.getElementById("searchClear");
  const searchSuggestions = document.getElementById("searchSuggestions");
  const searchStatusSelect = document.getElementById("searchStatusSelect");
  const searchYearSelect = document.getElementById("searchYearSelect");
  const exportExcelButton = document.getElementById("exportExcelButton");
  const exportStatus = document.getElementById("exportStatus");
  const resultsState = document.getElementById("resultsState");
  const resultsSummary = document.getElementById("resultsSummary");
  const resultsPagination = document.getElementById("resultsPagination");
  const resultsList = document.getElementById("resultsList");
  const searchNotice = document.getElementById("searchNotice");
  const editModal = document.getElementById("editModal");
  const editForm = document.getElementById("editForm");
  const editNotice = document.getElementById("editNotice");
  const closeEditModal = document.getElementById("closeEditModal");
  const saveEditButton = document.getElementById("saveEditButton");
  const completeRepairFromEdit = document.getElementById("completeRepairFromEdit");
  const returnRepairFromEdit = document.getElementById("returnRepairFromEdit");
  const createReminderFromTicket = document.getElementById("createReminderFromTicket");
  const editStatusHint = document.getElementById("editStatusHint");
  const editBrandInput = document.getElementById("edit_brand");
  const editModelInput = document.getElementById("edit_model");
  const editSizeInput = document.getElementById("edit_size");
  const editBrandList = document.getElementById("edit-tv-brand-options");
  const editSizeAssistHint = document.getElementById("editSizeAssistHint");
  const editConditionTextInput = document.getElementById("edit_condition_text");
  const editExternalConditionInput = document.getElementById("edit_external_condition");
  const editMachineConditionPicker = document.getElementById("editMachineConditionPicker");
  const editAppearanceConditionPicker = document.getElementById("editAppearanceConditionPicker");

  let latestResults = [];
  let suggestionResults = [];
  let activeSuggestionIndex = -1;
  let suggestionTimer = null;
  let suggestionRequestId = 0;
  let listRequestId = 0;
  let currentPage = 1;
  let currentKeyword = "";
  let currentStatus = "";
  let currentYear = "";
  let totalCount = 0;
  let totalPages = 1;
  let presentationRowCount = 0;
  let latestPresentationRows = [];
  const expandedBatchIds = new Set();
  let isExporting = false;
  let editDeviceAssist = null;
  let editConditionAssists = [];
  let editModalOpener = null;
  let editModalCloseTimer = null;
  let bulkController = null;

  const PAGE_SIZE = 10;
  const EXPORT_BATCH_SIZE = 500;
  const SUGGESTION_DELAY = 280;
  const MAX_SUGGESTIONS = 5;
  const DIRECT_EDIT_STATUSES = ["mới nhận", "đang kiểm tra", "báo giá"];
  const DIRECT_CANCEL_STATUS = "huỷ";
  const BULK_CAPABILITIES = Object.freeze({ completeRepair: true, returnFromRepair: true });

  const EDIT_FIELDS = [
    "customer_name",
    "customer_phone",
    "customer_address",
    "device_type",
    "brand",
    "model",
    "size",
    "serial_number",
    "condition_text",
    "external_condition",
    "internal_note",
    "received_date",
    "status",
    "deposit_amount",
    "estimated_price",
    "final_price"
  ];

  function showNotice(target, type, message) {
    target.className = `notice ${type} show`;
    target.textContent = message;
  }

  function clearNotice(target) {
    target.className = "notice";
    target.textContent = "";
  }

  function attachLogout() {
    document.querySelectorAll("[data-logout]").forEach((button) => {
      button.addEventListener("click", async function () {
        button.disabled = true;
        try {
          await window.AMApi.signOut();
        } catch (error) {
          showNotice(searchNotice, "error", error.message);
          button.disabled = false;
        }
      });
    });
  }

  function fillStatusOptions(select, ticket) {
    select.innerHTML = "";
    select.disabled = true;

    if (editStatusHint) {
      editStatusHint.textContent = "Trạng thái chỉ được cập nhật bằng workflow, không sửa trong modal chi tiết.";
    }

    const currentStatus = ticket && ticket.status;
    const statuses = DIRECT_EDIT_STATUSES.includes(currentStatus)
      ? DIRECT_EDIT_STATUSES.concat(DIRECT_CANCEL_STATUS)
      : currentStatus === DIRECT_CANCEL_STATUS
      ? [DIRECT_CANCEL_STATUS]
      : [currentStatus || "mới nhận"];

    statuses.forEach((status) => {
      const option = document.createElement("option");
      option.value = status;
      option.textContent = status;
      select.appendChild(option);
    });

    if (!DIRECT_EDIT_STATUSES.includes(currentStatus)) {
      select.disabled = true;

      if (editStatusHint) {
        editStatusHint.textContent = currentStatus === DIRECT_CANCEL_STATUS
          ? "Phiếu đã huỷ, không thể đổi trạng thái trong modal."
          : "Trạng thái này chỉ được cập nhật bằng workflow, không sửa trực tiếp trong modal.";
      }
    } else if (editStatusHint) {
      editStatusHint.textContent = "Chỉ chỉnh trực tiếp các trạng thái trước sửa hoặc huỷ phiếu.";
    }
  }

  function formatDate(value) {
    if (!value) {
      return "—";
    }

    const date = new Date(`${value}T00:00:00`);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleDateString("vi-VN");
  }

  function valueOrBlank(value) {
    return value === null || value === undefined || value === "" ? "—" : String(value);
  }

  function compactValue(value) {
    return value === null || value === undefined || value === "" ? "—" : String(value);
  }

  function currentVietnamYear() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric"
    }).format(new Date());
  }

  function formatDateTime(value) {
    const date = new Date(String(value || ""));

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return new Intl.DateTimeFormat("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  }

  function formatElapsedFrom(value) {
    const startedAt = Date.parse(String(value || ""));

    if (!Number.isFinite(startedAt)) {
      return "";
    }

    const totalMinutes = Math.max(0, Math.floor((Date.now() - startedAt) / 60000));
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;

    if (days > 0) {
      return `${days} ngày ${hours} giờ`;
    }

    if (hours > 0) {
      return `${hours} giờ ${minutes} phút`;
    }

    return `${minutes} phút`;
  }

  function createTicketTimeline(ticket) {
    const milestones = [];

    if (ticket.repair_started_at) {
      milestones.push({
        label: "Bắt đầu sửa",
        detail: formatDateTime(ticket.repair_started_at)
      });
    }

    if (ticket.ready_for_handover_at) {
      milestones.push({
        label: "Hoàn thành sửa chữa",
        detail: formatDateTime(ticket.ready_for_handover_at)
      });
    }

    if (ticket.status === "chờ bàn giao" && ticket.ready_for_handover_at) {
      milestones.push({
        label: "Đang chờ bàn giao",
        detail: `Đã chờ ${formatElapsedFrom(ticket.ready_for_handover_at)}`
      });
    }

    if (ticket.status === "đã trả" && ticket.completed_at && ticket.ready_for_handover_at) {
      milestones.push({
        label: "Đã bàn giao cho khách",
        detail: formatDateTime(ticket.completed_at)
      });
    }

    if (milestones.length === 0) {
      return null;
    }

    const timeline = document.createElement("div");
    timeline.className = "search-ticket-timeline";
    timeline.setAttribute("aria-label", "Tiến trình phiếu");

    milestones.forEach((milestone) => {
      const item = document.createElement("div");
      const marker = document.createElement("span");
      const content = document.createElement("div");
      const label = document.createElement("strong");
      const detail = document.createElement("small");
      item.className = "search-ticket-timeline-item";
      marker.className = "search-ticket-timeline-marker";
      marker.setAttribute("aria-hidden", "true");
      label.textContent = milestone.label;
      detail.textContent = milestone.detail;
      content.append(label, detail);
      item.append(marker, content);
      timeline.appendChild(item);
    });

    return timeline;
  }

  function formatDateForExport(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
  }

  function maskPhone(value) {
    const phone = String(value || "").replace(/\s+/g, "");

    if (phone.length < 7) {
      return phone || "—";
    }

    return `${phone.slice(0, 4)}•••${phone.slice(-3)}`;
  }

  function updateSearchClearVisibility() {
    searchClear.hidden = !String(searchInput.value || "").trim();
  }

  function statusClass(status) {
    const normalized = String(status || "").toLowerCase();
    const classes = {
      "mới nhận": "status-new",
      "đang kiểm tra": "status-checking",
      "báo giá": "status-quote",
      "đang sửa": "status-repairing",
      "chờ bàn giao": "status-handover",
      "đã xong": "status-done",
      "đã trả": "status-returned",
      "huỷ": "status-cancelled"
    };

    return classes[normalized] || "";
  }

  function statusLabel(status) {
    return window.AMApi.formatTicketStatusLabel(status, "Chưa có trạng thái");
  }

  function setSuggestionsExpanded(isExpanded) {
    searchInput.setAttribute("aria-expanded", String(isExpanded));

    if (!isExpanded) {
      searchInput.removeAttribute("aria-activedescendant");
    }
  }

  function closeSuggestions() {
    suggestionRequestId += 1;

    if (suggestionTimer) {
      clearTimeout(suggestionTimer);
      suggestionTimer = null;
    }

    suggestionResults = [];
    activeSuggestionIndex = -1;
    searchSuggestions.innerHTML = "";
    searchSuggestions.classList.add("hidden");
    setSuggestionsExpanded(false);
  }

  function showSuggestions() {
    searchSuggestions.classList.remove("hidden");
    setSuggestionsExpanded(true);
  }

  function updateSuggestionActive(nextIndex) {
    activeSuggestionIndex = nextIndex;

    searchSuggestions.querySelectorAll(".suggestion-item").forEach((item, index) => {
      const isActive = index === activeSuggestionIndex;
      item.classList.toggle("active", isActive);
      item.setAttribute("aria-selected", String(isActive));

      if (isActive) {
        searchInput.setAttribute("aria-activedescendant", item.id);
        item.scrollIntoView({ block: "nearest" });
      }
    });

    if (activeSuggestionIndex < 0) {
      searchInput.removeAttribute("aria-activedescendant");
    }
  }

  function createSuggestionText(text) {
    const span = document.createElement("span");
    span.textContent = text;
    return span;
  }

  function selectSuggestion(ticket) {
    const query = ticket.ticket_code || "";

    if (!query) {
      return;
    }

    searchInput.value = query;
    updateSearchClearVisibility();
    closeSuggestions();
    performSearch(query);
  }

  function renderSuggestions(tickets) {
    searchSuggestions.innerHTML = "";
    activeSuggestionIndex = -1;

    if (!tickets.length) {
      const empty = document.createElement("div");
      empty.className = "suggestion-empty";
      empty.textContent = "Không có gợi ý phù hợp.";
      searchSuggestions.appendChild(empty);
      showSuggestions();
      return;
    }

    tickets.forEach((ticket, index) => {
      const item = document.createElement("button");
      item.id = `suggestion-${index}`;
      item.className = "suggestion-item";
      item.type = "button";
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", "false");

      const main = document.createElement("div");
      main.className = "suggestion-main";
      main.textContent = [
        window.AMApi.formatTicketCode(ticket.ticket_code),
        window.AMApi.formatCustomerCode(ticket.customer_code),
        compactValue(ticket.customer_name)
      ].join(" · ");

      const device = [ticket.brand, ticket.model].filter(Boolean).join(" ") || "Chưa có thông tin thiết bị";
      const sub = document.createElement("div");
      sub.className = "suggestion-sub";
      sub.append(createSuggestionText(`${device} · ${maskPhone(ticket.customer_phone)}`));

      item.append(main, sub);
      item.addEventListener("click", function () {
        selectSuggestion(ticket);
      });

      searchSuggestions.appendChild(item);
    });

    showSuggestions();
  }

  async function loadSuggestions(query, requestId) {
    const keyword = String(query || "").trim();

    if (keyword.length < 2) {
      closeSuggestions();
      return;
    }

    try {
      const tickets = await window.AMApi.getTicketSearchSuggestions({
        query: keyword,
        year: currentYear,
        limit: MAX_SUGGESTIONS
      });

      if (requestId !== suggestionRequestId) {
        return;
      }

      suggestionResults = tickets;
      renderSuggestions(suggestionResults);
    } catch (error) {
      if (requestId !== suggestionRequestId) {
        return;
      }

      suggestionResults = [];
      renderSuggestions([]);
    }
  }

  function scheduleSuggestions() {
    const keyword = String(searchInput.value || "").trim();
    const requestId = ++suggestionRequestId;

    updateSearchClearVisibility();

    if (suggestionTimer) {
      clearTimeout(suggestionTimer);
    }

    if (keyword.length < 2) {
      closeSuggestions();
      return;
    }

    suggestionTimer = setTimeout(function () {
      loadSuggestions(keyword, requestId);
    }, SUGGESTION_DELAY);
  }

  function handleSuggestionKeydown(event) {
    const isOpen = !searchSuggestions.classList.contains("hidden");

    if (event.key === "Escape") {
      closeSuggestions();
      return;
    }

    if (!isOpen || !suggestionResults.length) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      updateSuggestionActive(Math.min(activeSuggestionIndex + 1, suggestionResults.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      updateSuggestionActive(Math.max(activeSuggestionIndex - 1, 0));
      return;
    }

    if (event.key === "Enter" && activeSuggestionIndex >= 0) {
      event.preventDefault();
      selectSuggestion(suggestionResults[activeSuggestionIndex]);
    }
  }

  function canStartRepair(ticket) {
    return DIRECT_EDIT_STATUSES.includes(ticket.status)
      && !ticket.repair_started_at
      && !ticket.completed_at;
  }

  function canReadyForHandover(ticket) {
    return ticket.status === "đang sửa"
      && Boolean(ticket.repair_started_at)
      && !ticket.ready_for_handover_at
      && !ticket.completed_at;
  }

  function canCompleteHandover(ticket) {
    return ticket.status === "chờ bàn giao"
      && Boolean(ticket.ready_for_handover_at)
      && !ticket.completed_at;
  }

  function canReprintLabel(ticket) {
    return Boolean(ticket.repair_started_at) && ticket.status !== "huỷ";
  }

  function canReprintReceipt(ticket) {
    return ticket.status === "đã trả" && Boolean(ticket.completed_at);
  }

  function createActionLink(label, href, primary) {
    const link = document.createElement("a");
    link.className = `btn ${primary ? "primary" : "secondary"} workflow-action`;
    link.textContent = label;
    link.href = href;
    return link;
  }

  function applyReadyForHandoverResult(ticket, result) {
    Object.assign(ticket, {
      status: result.status || "chờ bàn giao",
      ready_for_handover_at: result.ready_for_handover_at || ticket.ready_for_handover_at,
      last_activity_at: result.last_activity_at || ticket.last_activity_at,
      completed_at: result.completed_at || null
    });

    const index = latestResults.findIndex((item) => item.id === ticket.id);

    if (index >= 0) {
      latestResults[index] = ticket;
      renderResults(latestPresentationRows);
    }

    if (editForm.elements.id.value === ticket.id) {
      editForm.dataset.currentStatus = ticket.status;
      if (completeRepairFromEdit) {
        completeRepairFromEdit.hidden = true;
      }
      if (returnRepairFromEdit) {
        returnRepairFromEdit.hidden = true;
      }
      if (editStatusHint) {
        editStatusHint.textContent = "Phiếu đã chuyển sang Bàn giao tivi.";
      }
    }
  }

  function createActionButton(label, ticket, primary) {
    const button = document.createElement("button");
    button.className = `btn ${primary ? "primary" : "secondary"} workflow-action`;
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.AMUI.completeRepairInPlace({
        ticketId: ticket.id,
        ticket,
        expectedStatus: ticket.status,
        button,
        source: "search-results",
        onSuccess: (result) => applyReadyForHandoverResult(ticket, result)
      });
    });
    return button;
  }

  function createReturnActionButton(ticket) {
    const button = document.createElement("button");
    button.className = "btn secondary workflow-action";
    button.type = "button";
    button.textContent = "Giao trả sửa chữa";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.AMUI.returnRepairInPlace({
        ticket,
        button,
        source: "search-results",
        onSuccess: (result) => applyReadyForHandoverResult(ticket, result)
      });
    });
    return button;
  }

  function appendWorkflowActions(actions, ticket) {
    const code = encodeURIComponent(ticket.ticket_code || "");
    const id = encodeURIComponent(ticket.id || "");
    const ticketQuery = ticket.ticket_code ? `code=${code}` : `id=${id}`;

    if (!ticket.workflow_available) {
      const note = document.createElement("span");
      note.className = "workflow-inline-note";
      note.textContent = ticket.workflow_inactive_message || "Workflow chưa được kích hoạt";
      actions.appendChild(note);
      return;
    }

    if (canStartRepair(ticket)) {
      actions.appendChild(createActionLink("In tem & bắt đầu sửa chữa", `print-label.html?${ticketQuery}`, true));
      return;
    }

    if (canReadyForHandover(ticket)) {
      actions.appendChild(createActionButton("Hoàn thành sửa chữa", ticket, true));
      actions.appendChild(createReturnActionButton(ticket));
      actions.appendChild(createActionLink("Chỉ in lại tem", `print-label.html?${ticketQuery}`, false));
      return;
    }

    if (canCompleteHandover(ticket)) {
      actions.appendChild(createActionLink("Mở Bàn giao tivi", `handover-tickets.html?${ticketQuery}`, true));
      actions.appendChild(createActionLink("Chỉ in lại tem", `print-label.html?${ticketQuery}`, false));
      return;
    }

    if (ticket.status === "đã xong") {
      const note = document.createElement("span");
      note.className = "workflow-inline-note";
      note.textContent = "Dữ liệu workflow cũ chưa đầy đủ. Vui lòng xử lý thủ công.";
      actions.appendChild(note);
      return;
    }

    if (canReprintReceipt(ticket)) {
      actions.appendChild(createActionLink("Chỉ in lại biên nhận", `print-delivery-receipt.html?${ticketQuery}`, false));
      return;
    }

    if (canReprintLabel(ticket)) {
      actions.appendChild(createActionLink("Chỉ in lại tem", `print-label.html?${ticketQuery}`, false));
    }
  }

  function cleanPresentationText(value) {
    return String(value == null ? "" : value).trim();
  }

  function createSearchTableCell(className, label) {
    const cell = document.createElement("div");
    cell.className = `search-ticket-cell ${className || ""}`.trim();
    cell.dataset.label = label;
    cell.setAttribute("role", "cell");
    return cell;
  }

  function appendPrimarySecondary(cell, primaryValue, secondaryValue) {
    const primary = document.createElement("strong");
    primary.textContent = valueOrBlank(primaryValue);
    cell.appendChild(primary);

    const secondaryText = cleanPresentationText(secondaryValue);
    if (secondaryText) {
      const secondary = document.createElement("small");
      secondary.textContent = secondaryText;
      cell.appendChild(secondary);
    }
  }

  function ticketAddress(ticket) {
    return cleanPresentationText(ticket && (ticket.customer_address || ticket.customer_master_address));
  }

  function ticketModelSummary(ticket) {
    const model = cleanPresentationText(ticket && ticket.model);
    const size = cleanPresentationText(ticket && ticket.size);
    const brand = cleanPresentationText(ticket && ticket.brand);
    const values = [];

    [model, size].forEach((value) => {
      if (value && !values.includes(value)) {
        values.push(value);
      }
    });

    return values.join(" · ") || brand || "—";
  }

  function batchModelSummary(tickets) {
    const values = (tickets || []).map((ticket) => (
      cleanPresentationText(ticket && ticket.size)
      || cleanPresentationText(ticket && ticket.model)
    )).filter(Boolean);

    if (!values.length) {
      return "—";
    }

    if (values.length <= 3) {
      return values.join(" · ");
    }

    return `${values.slice(0, 2).join(" · ")} · +${values.length - 2}`;
  }

  function createSearchTableHeader() {
    const header = document.createElement("div");
    const labels = [
      ["STT", "search-ticket-index"],
      ["Thời gian nhận", "search-ticket-time"],
      ["Mã phiếu", "search-ticket-code"],
      ["Mã khách", "search-ticket-customer-code"],
      ["Họ và tên", "search-ticket-name"],
      ["Số điện thoại", "search-ticket-phone"],
      ["Model", "search-ticket-model"],
      ["Trạng thái", "search-ticket-status"],
      ["Hành động", "search-ticket-actions"]
    ];

    header.className = "search-ticket-table-head";
    header.setAttribute("role", "row");
    labels.forEach(([label, className]) => {
      const cell = document.createElement("span");
      cell.className = `search-ticket-column-head ${className}`;
      cell.setAttribute("role", "columnheader");
      cell.textContent = label;
      header.appendChild(cell);
    });
    return header;
  }

  function setResultsState(type, message) {
    const hasData = type === "data" || type === "refreshing";
    const section = resultsState.closest("section");
    resultsState.textContent = hasData ? "" : message;
    window.AMUI.setSectionState({
      section,
      stateElement: resultsState,
      dataElement: resultsList
    }, type);

    if (!hasData) {
      resultsList.replaceChildren();
      resultsPagination.hidden = true;
    }
  }

  function buildTicketPresentationRows(tickets) {
    return window.AMMultiTicketPresentation.buildTicketPresentationRows(tickets);
  }

  function createBulkTicketControl(ticket) {
    const snapshot = window.AMTicketBulkOperations.buildSelectionTicket(ticket, {
      capabilities: BULK_CAPABILITIES,
      sourcePage: "search"
    });
    return window.AMTicketBulkSelection.createSelectionControl({
      id: ticket.id,
      ariaLabel: `Chọn phiếu ${window.AMApi.formatTicketCode(ticket.ticket_code)}`,
      disabled: !snapshot.selectable,
      disabledReason: snapshot.disabledReason
    });
  }

  function createBulkGroupControl(presentationRow) {
    return window.AMTicketBulkSelection.createSelectionControl({
      kind: "group",
      id: presentationRow.batchId,
      ariaLabel: `Chọn các phiếu khả dụng trong nhóm ${presentationRow.totalTicketCount} tivi`
    });
  }

  function syncBulkRegistry(rows) {
    if (!bulkController) return;
    const sourceRows = Array.isArray(rows) ? rows : [];
    bulkController.syncRegistry({
      tickets: sourceRows.flatMap((row) => row.tickets),
      groups: sourceRows
        .filter((row) => row.type === "batch")
        .map((row) => ({ id: row.batchId, ticketIds: row.tickets.map((ticket) => ticket.id) }))
    });
  }

  function clearBulkForDataChange(showNotice) {
    if (bulkController) bulkController.clearForDataChange(showNotice);
  }

  function createTicketRow(ticket, options) {
    const settings = options || {};
    const row = document.createElement("article");
    row.className = `search-ticket-row${settings.batchChild ? " is-batch-child" : ""}`;
    row.dataset.ticketId = ticket.id || "";
    row.dataset.bulkTicketId = ticket.id || "";
    row.setAttribute("role", "row");

    const indexCell = createSearchTableCell("search-ticket-index", "STT");
    const indexText = document.createElement("span");
    indexText.className = "ticket-bulk-index-text";
    indexText.textContent = settings.batchChild
      ? `TV${String(settings.childIndex || 1).padStart(2, "0")}`
      : String(settings.presentationIndex || "—");
    indexCell.append(createBulkTicketControl(ticket), indexText);

    const timeCell = createSearchTableCell("search-ticket-time", "Thời gian nhận");
    timeCell.textContent = formatDateTime(ticket.created_at || ticket.received_date);

    const codeCell = createSearchTableCell("search-ticket-code", "Mã phiếu");
    const code = document.createElement("strong");
    code.className = "ticket-code";
    code.textContent = window.AMApi.formatTicketCode(ticket.ticket_code);
    codeCell.appendChild(code);

    const customerCodeCell = createSearchTableCell("search-ticket-customer-code", "Mã khách");
    customerCodeCell.textContent = window.AMApi.formatCustomerCode(ticket.customer_code);

    const nameCell = createSearchTableCell("search-ticket-name", "Họ và tên");
    appendPrimarySecondary(nameCell, ticket.customer_name, ticketAddress(ticket));

    const phoneCell = createSearchTableCell("search-ticket-phone", "Số điện thoại");
    phoneCell.textContent = valueOrBlank(ticket.customer_phone);

    const modelCell = createSearchTableCell("search-ticket-model", "Model");
    modelCell.textContent = ticketModelSummary(ticket);
    modelCell.title = [ticket.brand, ticket.model, ticket.size].filter(Boolean).join(" · ");

    const statusCell = createSearchTableCell("search-ticket-status", "Trạng thái");
    const status = document.createElement("span");
    status.className = `status-pill ${statusClass(ticket.status)}`.trim();
    status.textContent = statusLabel(ticket.status);
    statusCell.appendChild(status);

    const actions = createSearchTableCell("search-ticket-actions", "Hành động");
    const editButton = document.createElement("button");
    editButton.className = "btn primary";
    editButton.type = "button";
    editButton.textContent = "Xem / sửa phiếu";
    editButton.dataset.editId = ticket.id;
    actions.append(editButton);
    appendWorkflowActions(actions, ticket);

    if (ticket.customer_id) {
      const historyButton = document.createElement("button");
      historyButton.className = "btn secondary";
      historyButton.type = "button";
      historyButton.textContent = "Lịch sử KH";
      historyButton.dataset.historyCustomerId = ticket.customer_id;
      actions.appendChild(historyButton);
    }

    row.append(
      indexCell,
      timeCell,
      codeCell,
      customerCodeCell,
      nameCell,
      phoneCell,
      modelCell,
      statusCell,
      actions
    );
    const timeline = createTicketTimeline(ticket);
    if (timeline) {
      timeline.setAttribute("role", "cell");
      row.appendChild(timeline);
    }
    return row;
  }

  function batchCodeSummary(tickets) {
    const codes = (tickets || []).map((ticket) => window.AMApi.formatTicketCode(ticket.ticket_code));
    if (codes.length <= 3) {
      return codes.join(" · ");
    }
    return `${codes[0]} · ${codes[1]} · +${codes.length - 2} phiếu`;
  }

  function batchStatusSummary(tickets) {
    const counts = new Map();
    (tickets || []).forEach((ticket) => {
      const label = statusLabel(ticket.status);
      counts.set(label, (counts.get(label) || 0) + 1);
    });
    return Array.from(counts, ([label, count]) => `${count} ${label}`).join(" · ");
  }

  function createBatchRow(presentationRow, presentationIndex) {
    const batchId = presentationRow.batchId;
    const childId = `intake-batch-${batchId.replace(/[^a-z0-9_-]/gi, "")}`;
    const firstTicket = presentationRow.tickets[0] || {};
    const autoExpanded = Boolean(currentKeyword);
    const isExpanded = autoExpanded || expandedBatchIds.has(batchId);
    const group = document.createElement("article");
    group.className = `search-ticket-batch${isExpanded ? " is-expanded" : ""}`;
    group.dataset.intakeBatchId = batchId;
    group.dataset.bulkGroupId = batchId;
    group.setAttribute("role", "rowgroup");

    const parentRow = document.createElement("div");
    parentRow.className = "search-ticket-batch__row";
    parentRow.dataset.batchRowToggle = batchId;
    parentRow.tabIndex = 0;
    parentRow.setAttribute("role", "row");
    parentRow.setAttribute("aria-expanded", String(isExpanded));
    parentRow.setAttribute("aria-controls", childId);
    parentRow.setAttribute("aria-label", `${isExpanded ? "Thu gọn" : "Mở"} nhóm ${presentationRow.totalTicketCount} tivi`);

    const indexCell = createSearchTableCell("search-ticket-index", "STT");
    const indexText = document.createElement("span");
    indexText.className = "ticket-bulk-index-text";
    indexText.textContent = String(presentationIndex || "—");
    indexCell.append(createBulkGroupControl(presentationRow), indexText);

    const timeCell = createSearchTableCell("search-ticket-time", "Thời gian nhận");
    timeCell.textContent = formatDateTime(firstTicket.created_at || firstTicket.received_date);

    const codeCell = createSearchTableCell("search-ticket-code search-ticket-batch__codes", "Mã phiếu");
    const badge = document.createElement("span");
    badge.className = "search-ticket-batch__badge";
    badge.textContent = `[${presentationRow.totalTicketCount} TV]`;
    const codeSummary = document.createElement("strong");
    codeSummary.textContent = batchCodeSummary(presentationRow.tickets);
    codeCell.append(badge, codeSummary);

    const customerCodeCell = createSearchTableCell("search-ticket-customer-code", "Mã khách");
    customerCodeCell.textContent = window.AMApi.formatCustomerCode(firstTicket.customer_code);

    const nameCell = createSearchTableCell("search-ticket-name", "Họ và tên");
    appendPrimarySecondary(nameCell, firstTicket.customer_name, ticketAddress(firstTicket));

    const phoneCell = createSearchTableCell("search-ticket-phone", "Số điện thoại");
    phoneCell.textContent = valueOrBlank(firstTicket.customer_phone);

    const modelCell = createSearchTableCell("search-ticket-model", "Model");
    modelCell.textContent = batchModelSummary(presentationRow.tickets);

    const statusCell = createSearchTableCell("search-ticket-status", "Trạng thái");
    const status = document.createElement("span");
    const normalizedStatuses = new Set(presentationRow.tickets.map((ticket) => (
      String(ticket.status || "").trim().toLowerCase()
    )));
    status.className = `status-pill${normalizedStatuses.size === 1 ? ` ${statusClass(firstTicket.status)}` : ""}`;
    status.textContent = batchStatusSummary(presentationRow.tickets);
    status.title = status.textContent;
    statusCell.appendChild(status);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "search-ticket-batch__toggle";
    toggle.dataset.batchToggle = batchId;
    toggle.dataset.batchCount = String(presentationRow.totalTicketCount);
    toggle.setAttribute("aria-expanded", String(isExpanded));
    toggle.setAttribute("aria-controls", childId);
    toggle.setAttribute("aria-label", `${isExpanded ? "Thu gọn" : "Mở"} nhóm ${presentationRow.totalTicketCount} tivi`);

    const chevron = document.createElement("span");
    chevron.className = "search-ticket-batch__chevron";
    chevron.setAttribute("aria-hidden", "true");
    toggle.appendChild(chevron);

    const actionCell = createSearchTableCell("search-ticket-actions search-ticket-batch__action", "Hành động");
    actionCell.appendChild(toggle);
    parentRow.append(
      indexCell,
      timeCell,
      codeCell,
      customerCodeCell,
      nameCell,
      phoneCell,
      modelCell,
      statusCell,
      actionCell
    );

    const children = document.createElement("div");
    children.id = childId;
    children.className = "search-ticket-batch__children";
    children.hidden = !isExpanded;
    children.setAttribute("aria-hidden", String(!isExpanded));
    children.setAttribute("role", "rowgroup");
    presentationRow.tickets.forEach((ticket, childIndex) => children.appendChild(createTicketRow(ticket, {
      batchChild: true,
      childIndex: childIndex + 1
    })));
    group.append(parentRow, children);
    return group;
  }

  function setBatchExpandedState(toggle, children, group, shouldExpand) {
    const batchCount = toggle.dataset.batchCount;
    const stateLabel = `${shouldExpand ? "Thu gọn" : "Mở"} nhóm${batchCount ? ` ${batchCount}` : ""} tivi`;
    toggle.setAttribute("aria-expanded", String(shouldExpand));
    toggle.setAttribute("aria-label", stateLabel);
    if (group) {
      group.classList.toggle("is-expanded", shouldExpand);
      const parentRow = group.querySelector("[data-batch-row-toggle]");
      if (parentRow) {
        parentRow.setAttribute("aria-expanded", String(shouldExpand));
        parentRow.setAttribute("aria-label", stateLabel);
      }
    }

    if (!children) {
      return;
    }

    children.classList.toggle("is-expanding", shouldExpand);
    children.setAttribute("aria-hidden", String(!shouldExpand));
    children.hidden = !shouldExpand;
  }

  function toggleMultiGroup(toggle) {
    if (!toggle) {
      return;
    }

    const batchId = toggle.dataset.batchToggle;
    const childId = toggle.getAttribute("aria-controls");
    const children = childId ? document.getElementById(childId) : null;
    const group = toggle.closest(".search-ticket-batch");
    const willExpand = toggle.getAttribute("aria-expanded") !== "true";
    setBatchExpandedState(toggle, children, group, willExpand);

    if (willExpand) {
      expandedBatchIds.add(batchId);
    } else {
      expandedBatchIds.delete(batchId);
    }
  }

  function renderResults(rows) {
    const fragment = document.createDocumentFragment();
    const presentationStart = (currentPage - 1) * PAGE_SIZE;
    fragment.appendChild(createSearchTableHeader());
    (rows || []).forEach((row, index) => {
      const presentationIndex = presentationStart + index + 1;
      fragment.appendChild(row.type === "batch"
        ? createBatchRow(row, presentationIndex)
        : createTicketRow(row.tickets[0], { presentationIndex }));
    });
    resultsList.replaceChildren(fragment);
    syncBulkRegistry(rows);
  }

  function setSearchLoading(isLoading) {
    searchForm.setAttribute("aria-busy", String(isLoading));
    if (window.AMUI && typeof window.AMUI.setButtonBusy === "function") {
      window.AMUI.setButtonBusy(searchButton, isLoading, {
        busyText: "Đang tải...",
        idleText: "Tìm"
      });
      return;
    }

    searchButton.disabled = isLoading;
    searchButton.textContent = isLoading ? "Đang tải..." : "Tìm";
  }

  function createPaginationButton(label, page, options) {
    const config = options || {};
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.page = String(page);
    button.disabled = config.disabled === true;
    button.classList.toggle("active", config.active === true);

    if (config.active) {
      button.setAttribute("aria-current", "page");
    }

    if (config.label) {
      button.setAttribute("aria-label", config.label);
    }

    return button;
  }

  function paginationItems(page, pageCount) {
    const pages = new Set([1, pageCount, page - 1, page, page + 1]);
    const visible = Array.from(pages)
      .filter((value) => value >= 1 && value <= pageCount)
      .sort((a, b) => a - b);
    const items = [];

    visible.forEach((value, index) => {
      if (index > 0 && value - visible[index - 1] > 1) {
        items.push("ellipsis");
      }
      items.push(value);
    });

    return items;
  }

  function renderPagination() {
    resultsPagination.replaceChildren();
    resultsPagination.hidden = totalPages <= 1 || totalCount === 0;

    if (resultsPagination.hidden) {
      return;
    }

    resultsPagination.appendChild(createPaginationButton("← Trước", currentPage - 1, {
      disabled: currentPage === 1,
      label: "Trang trước"
    }));

    paginationItems(currentPage, totalPages).forEach((item) => {
      if (item === "ellipsis") {
        const ellipsis = document.createElement("span");
        ellipsis.className = "pagination-ellipsis";
        ellipsis.textContent = "…";
        ellipsis.setAttribute("aria-hidden", "true");
        resultsPagination.appendChild(ellipsis);
        return;
      }

      resultsPagination.appendChild(createPaginationButton(String(item), item, {
        active: item === currentPage,
        label: `Trang ${item}`
      }));
    });

    resultsPagination.appendChild(createPaginationButton("Sau →", currentPage + 1, {
      disabled: currentPage === totalPages,
      label: "Trang sau"
    }));
  }

  function renderResultsSummary() {
    if (totalCount === 0) {
      resultsSummary.textContent = "Chưa có phiếu để hiển thị.";
      return;
    }

    if (presentationRowCount > 0) {
      const startRow = (currentPage - 1) * PAGE_SIZE + 1;
      const endRow = Math.min(startRow + latestPresentationRows.length - 1, presentationRowCount);
      resultsSummary.textContent = `Đang hiển thị ${startRow}–${endRow} trên ${presentationRowCount.toLocaleString("vi-VN")} mục; trang này có ${latestResults.length} phiếu, tổng cộng ${totalCount.toLocaleString("vi-VN")} phiếu.`;
      return;
    }

    const start = (currentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(start + latestResults.length - 1, totalCount);
    resultsSummary.textContent = `Đang hiển thị ${start}–${end} trên tổng số ${totalCount.toLocaleString("vi-VN")} phiếu.`;
  }

  function scrollToResults() {
    const target = document.getElementById("searchResultsTitle");

    if (target) {
      const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    }
  }

  async function loadTickets(options) {
    const config = options || {};
    const requestId = ++listRequestId;
    const hasRenderedData = !resultsList.hidden && resultsList.childElementCount > 0;
    setSearchLoading(true);
    clearNotice(searchNotice);
    setResultsState(hasRenderedData ? "refreshing" : "loading", "Đang tải danh sách phiếu…");
    resultsSummary.textContent = hasRenderedData ? "Đang cập nhật dữ liệu phù hợp." : "Đang tải dữ liệu phù hợp.";

    try {
      const result = await window.AMApi.getTicketsForGroupedPresentation({
        query: currentKeyword,
        year: currentYear,
        status: currentStatus,
        page: currentPage,
        pageSize: PAGE_SIZE
      });

      if (requestId !== listRequestId) {
        return;
      }

      totalCount = result.totalCount;
      let rows;
      if (result.presentationPagination) {
        const allRows = buildTicketPresentationRows(result.records, result.batchSizes);
        presentationRowCount = allRows.length;
        totalPages = Math.max(1, Math.ceil(presentationRowCount / PAGE_SIZE));
        const from = (currentPage - 1) * PAGE_SIZE;
        rows = allRows.slice(from, from + PAGE_SIZE);
      } else {
        presentationRowCount = 0;
        totalPages = result.totalPages;
        rows = buildTicketPresentationRows(result.records, result.batchSizes);
      }

      if (totalCount > 0 && currentPage > totalPages) {
        currentPage = totalPages;
        await loadTickets(config);
        return;
      }

      latestPresentationRows = rows;
      latestResults = rows.flatMap((row) => row.tickets);
      renderResultsSummary();

      if (latestResults.length === 0) {
        const message = currentKeyword
          ? "Không tìm thấy phiếu phù hợp."
          : "Không có phiếu tiếp nhận trong năm đã chọn.";
        setResultsState("empty", message);
        syncBulkRegistry([]);
      } else {
        renderResults(latestPresentationRows);
        renderPagination();
        setResultsState("data", "");
      }

      if (config.scroll === true) {
        scrollToResults();
      }
    } catch (error) {
      if (requestId !== listRequestId) {
        return;
      }

      latestResults = [];
      latestPresentationRows = [];
      totalCount = 0;
      totalPages = 1;
      presentationRowCount = 0;
      resultsSummary.textContent = "Danh sách phiếu chưa tải được.";
      setResultsState("error", "Không thể tải danh sách phiếu. Vui lòng thử lại.");
    } finally {
      if (requestId === listRequestId) {
        setSearchLoading(false);
      }
    }
  }

  function performSearch(query) {
    clearBulkForDataChange();
    currentKeyword = String(query || "").trim();
    currentPage = 1;
    closeSuggestions();
    return loadTickets({ scroll: true });
  }

  async function loadCustomerHistory(customerId) {
    const id = String(customerId || "").trim();

    if (!id) {
      return;
    }

    const requestId = ++listRequestId;
    closeSuggestions();
    setSearchLoading(true);

    try {
      const history = await window.AMApi.getTicketHistoryByCustomerId(id, 1);

      if (requestId !== listRequestId) {
        return;
      }

      const first = history[0];

      if (!first) {
        currentKeyword = "";
        currentPage = 1;
        setResultsState("empty", "Khách hàng này chưa có phiếu.");
        return;
      }

      currentYear = "all";
      searchYearSelect.value = "all";
      currentStatus = "";
      searchStatusSelect.value = "";
      searchInput.value = first.customer_code
        ? window.AMApi.formatCustomerCode(first.customer_code)
        : first.customer_phone || first.customer_name || "";
      updateSearchClearVisibility();
      await performSearch(searchInput.value);
    } catch (error) {
      if (requestId !== listRequestId) {
        return;
      }

      setResultsState("error", "Không thể tải lịch sử phiếu của khách hàng. Vui lòng thử lại.");
    } finally {
      if (requestId === listRequestId) {
        setSearchLoading(false);
      }
    }
  }

  function formatWarrantyMode(value) {
    const labels = {
      NONE: "Không bảo hành",
      MONTHS: "Theo số tháng",
      DATE_RANGE: "Theo khoảng ngày"
    };
    const normalized = String(value || "").trim().toUpperCase();
    return labels[normalized] || String(value || "");
  }

  function numericValue(value) {
    if (value === null || value === undefined || value === "") {
      return "";
    }

    const number = Number(value);
    return Number.isFinite(number) ? number : "";
  }

  function exportColumnDefinitions() {
    return [
      { header: "STT", width: 8, required: true, value: (_ticket, index) => index + 1 },
      { header: "Mã phiếu", field: "ticket_code", width: 14, type: "text" },
      { header: "Mã khách", field: "customer_code", width: 14, type: "text" },
      { header: "Họ tên khách hàng", field: "customer_name", width: 24 },
      { header: "Số điện thoại", field: "customer_phone", width: 16, type: "text" },
      { header: "Địa chỉ", field: "customer_address", width: 32 },
      { header: "Loại thiết bị", field: "device_type", width: 18 },
      { header: "Hãng", field: "brand", width: 16 },
      { header: "Model", field: "model", width: 20, type: "text" },
      { header: "Kích thước", field: "size", width: 13 },
      { header: "Serial", field: "serial_number", width: 20, type: "text" },
      { header: "Ngày nhận", field: "received_date", width: 14, value: (ticket) => formatDateForExport(ticket.received_date) },
      { header: "Tình trạng máy", field: "condition_text", width: 34 },
      { header: "Tình trạng ngoại quan", field: "external_condition", width: 30 },
      { header: "Trạng thái", field: "status", width: 18, value: (ticket) => statusLabel(ticket.status) },
      { header: "Thời điểm bắt đầu sửa", field: "repair_started_at", width: 22, value: (ticket) => formatDateTime(ticket.repair_started_at) },
      { header: "Hoàn thành sửa chữa", field: "ready_for_handover_at", width: 22, value: (ticket) => formatDateTime(ticket.ready_for_handover_at) },
      { header: "Ngày giao/trả", field: "delivery_date", width: 16, value: (ticket) => formatDateForExport(ticket.delivery_date) },
      { header: "Giá dự kiến", field: "estimated_price", width: 16, type: "money", value: (ticket) => numericValue(ticket.estimated_price) },
      { header: "Tiền cọc", field: "deposit_amount", width: 16, type: "money", value: (ticket) => numericValue(ticket.deposit_amount) },
      { header: "Giá cuối cùng", field: "final_price", width: 16, type: "money", value: (ticket) => numericValue(ticket.final_price) },
      { header: "Kiểu bảo hành", field: "warranty_mode", width: 20, value: (ticket) => formatWarrantyMode(ticket.warranty_mode) },
      { header: "Số tháng bảo hành", field: "warranty_months", width: 18, value: (ticket) => numericValue(ticket.warranty_months) },
      { header: "Bảo hành từ ngày", field: "warranty_start_date", width: 18, value: (ticket) => formatDateForExport(ticket.warranty_start_date) },
      { header: "Bảo hành đến ngày", field: "warranty_end_date", width: 18, value: (ticket) => formatDateForExport(ticket.warranty_end_date) },
      { header: "Nội dung bảo hành", field: "warranty_note", width: 36 },
      { header: "Ngày tạo phiếu", field: "created_at", width: 22, value: (ticket) => formatDateTime(ticket.created_at) }
    ];
  }

  function getExportColumns(records) {
    return exportColumnDefinitions().filter((column) => {
      return column.required === true || (column.field && records.some((record) => {
        return Object.prototype.hasOwnProperty.call(record, column.field);
      }));
    });
  }

  function exportCellValue(column, ticket, index) {
    const value = typeof column.value === "function" ? column.value(ticket, index) : ticket[column.field];
    return value === null || value === undefined || Number.isNaN(value) ? "" : value;
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function saveExcelFile(records, columns, yearLabel) {
    const workbook = new window.ExcelJS.Workbook();
    workbook.creator = "Anh Minh Admin";
    workbook.created = new Date();
    const sheetName = yearLabel === "all" ? "Phiếu sửa chữa Tất cả" : `Phiếu sửa chữa ${yearLabel}`;
    const worksheet = workbook.addWorksheet(sheetName.slice(0, 31), {
      views: [{ state: "frozen", ySplit: 1 }]
    });

    worksheet.addRow(columns.map((column) => column.header));
    worksheet.getRow(1).height = 28;
    worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    worksheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F2D52" } };
    worksheet.getRow(1).alignment = { vertical: "middle", horizontal: "center", wrapText: true };

    records.forEach((ticket, index) => {
      const row = worksheet.addRow(columns.map((column) => exportCellValue(column, ticket, index)));
      row.alignment = { vertical: "top", wrapText: true };

      columns.forEach((column, columnIndex) => {
        const cell = row.getCell(columnIndex + 1);

        if (column.type === "money" && typeof cell.value === "number") {
          cell.numFmt = '#,##0 "đ"';
        } else if (column.type === "text") {
          cell.numFmt = "@";
        }
      });
    });

    columns.forEach((column, index) => {
      worksheet.getColumn(index + 1).width = column.width;
    });
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columns.length }
    };

    const buffer = await workbook.xlsx.writeBuffer();
    const fileName = `Anh-Minh-Phieu-Sua-Chua-${yearLabel === "all" ? "Tat-Ca" : yearLabel}.xlsx`;
    downloadBlob(new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }), fileName);
  }

  function csvValue(value, column) {
    const normalized = column.type === "money" && typeof value === "number"
      ? value.toLocaleString("vi-VN")
      : String(value === null || value === undefined ? "" : value);
    return `"${normalized.replace(/"/g, '""')}"`;
  }

  function saveCsvFallback(records, columns, yearLabel) {
    const rows = [columns.map((column) => csvValue(column.header, column)).join(",")];

    records.forEach((ticket, index) => {
      rows.push(columns.map((column) => csvValue(exportCellValue(column, ticket, index), column)).join(","));
    });

    const fileName = `Anh-Minh-Phieu-Sua-Chua-${yearLabel === "all" ? "Tat-Ca" : yearLabel}.csv`;
    downloadBlob(new Blob(["\uFEFF", rows.join("\r\n")], { type: "text/csv;charset=utf-8" }), fileName);
  }

  async function handleExport() {
    if (isExporting) {
      return;
    }

    isExporting = true;
    if (window.AMUI && typeof window.AMUI.setButtonBusy === "function") {
      window.AMUI.setButtonBusy(exportExcelButton, true, {
        busyText: "Đang xuất...",
        idleText: "Xuất Excel"
      });
    } else {
      exportExcelButton.disabled = true;
    }
    exportStatus.className = "search-export-status active";
    exportStatus.textContent = "Đang chuẩn bị dữ liệu xuất…";

    try {
      const records = [];
      const ids = new Set();
      let offset = 0;
      let exportTotal = null;

      while (true) {
        const batch = await window.AMApi.getTicketsForExport({
          query: currentKeyword,
          year: currentYear,
          status: currentStatus,
          offset,
          limit: EXPORT_BATCH_SIZE,
          includeCount: offset === 0
        });

        if (exportTotal === null && typeof batch.totalCount === "number") {
          exportTotal = batch.totalCount;
        }

        batch.records.forEach((ticket) => {
          if (ticket.id && !ids.has(ticket.id)) {
            ids.add(ticket.id);
            records.push(ticket);
          }
        });

        const totalLabel = exportTotal === null ? "…" : exportTotal.toLocaleString("vi-VN");
        exportStatus.textContent = `Đang chuẩn bị Excel: ${records.length.toLocaleString("vi-VN")}/${totalLabel} phiếu…`;

        if (batch.records.length < EXPORT_BATCH_SIZE || (exportTotal !== null && offset + EXPORT_BATCH_SIZE >= exportTotal)) {
          break;
        }

        offset += EXPORT_BATCH_SIZE;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      if (records.length === 0) {
        exportStatus.textContent = "Không có phiếu để xuất trong năm đã chọn.";
        return;
      }

      const columns = getExportColumns(records);

      if (window.ExcelJS && typeof window.ExcelJS.Workbook === "function") {
        try {
          await saveExcelFile(records, columns, currentYear);
          exportStatus.textContent = `Đã xuất ${records.length.toLocaleString("vi-VN")} phiếu ra Excel.`;
          if (window.AMUI && typeof window.AMUI.toast === "function") {
            window.AMUI.toast(exportStatus.textContent, { type: "success" });
          }
        } catch (error) {
          saveCsvFallback(records, columns, currentYear);
          exportStatus.textContent = "Không tạo được XLSX; hệ thống đã xuất CSV UTF-8 thay thế.";
          if (window.AMUI && typeof window.AMUI.toast === "function") {
            window.AMUI.toast(exportStatus.textContent, { type: "warning" });
          }
        }
      } else {
        saveCsvFallback(records, columns, currentYear);
        exportStatus.textContent = "Thư viện Excel chưa tải được; hệ thống đã xuất CSV UTF-8 thay thế.";
        if (window.AMUI && typeof window.AMUI.toast === "function") {
          window.AMUI.toast(exportStatus.textContent, { type: "warning" });
        }
      }
    } catch (error) {
      exportStatus.className = "search-export-status error";
      exportStatus.textContent = "Không thể xuất dữ liệu. Vui lòng thử lại.";
    } finally {
      isExporting = false;
      if (window.AMUI && typeof window.AMUI.setButtonBusy === "function") {
        window.AMUI.setButtonBusy(exportExcelButton, false, { idleText: "Xuất Excel" });
      } else {
        exportExcelButton.disabled = false;
      }
    }
  }

  function openEditModal(ticket) {
    if (editModalCloseTimer) {
      window.clearTimeout(editModalCloseTimer);
      editModalCloseTimer = null;
    }

    editModalOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    clearNotice(editNotice);
    editForm.reset();
    editForm.elements.id.value = ticket.id;
    editForm.dataset.currentStatus = ticket.status || "";
    editForm.dataset.expectedUpdatedAt = ticket.updated_at || "";
    if (completeRepairFromEdit) {
      completeRepairFromEdit.hidden = !canReadyForHandover(ticket);
      completeRepairFromEdit.dataset.ticketId = ticket.id || "";
    }
    if (returnRepairFromEdit) {
      returnRepairFromEdit.hidden = !canReadyForHandover(ticket);
      returnRepairFromEdit.dataset.ticketId = ticket.id || "";
    }
    if (createReminderFromTicket) {
      createReminderFromTicket.href = `appointment-reminders.html?ticket_id=${encodeURIComponent(ticket.id || "")}`;
    }
    fillStatusOptions(document.getElementById("edit_status"), ticket);

    EDIT_FIELDS.forEach((field) => {
      const input = editForm.elements[field];

      if (input) {
        input.value = ticket[field] === null || ticket[field] === undefined ? "" : ticket[field];
      }
    });

    if (window.AMMoneyUtils && typeof window.AMMoneyUtils.formatInputs === "function") {
      window.AMMoneyUtils.formatInputs(editForm);
    }

    if (editDeviceAssist) {
      editDeviceAssist.reset({ keepValue: true });
      editDeviceAssist.refresh();
    }
    editConditionAssists.forEach((assist) => assist.reset());

    editModal.classList.remove("is-closing");
    editModal.classList.add("show");
    editModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    window.requestAnimationFrame(() => {
      const firstField = editForm.querySelector('input:not([type="hidden"]), select, textarea, button, a[href]');
      if (firstField) {
        firstField.focus({ preventScroll: true });
      }
    });
  }

  function closeModal() {
    if (!editModal.classList.contains("show") || editModal.classList.contains("is-closing")) {
      return;
    }

    if (editForm.getAttribute("aria-busy") === "true") {
      return;
    }

    const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    editModal.classList.add("is-closing");
    editModalCloseTimer = window.setTimeout(() => {
      editModal.classList.remove("show", "is-closing");
      editModal.setAttribute("aria-hidden", "true");
      document.body.classList.remove("modal-open");
      editModalCloseTimer = null;

      if (editModalOpener && document.contains(editModalOpener)) {
        editModalOpener.focus({ preventScroll: true });
      }
      editModalOpener = null;
    }, reduceMotion ? 0 : 140);
  }

  function handleEditModalKeydown(event) {
    if (!editModal.classList.contains("show")) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeModal();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const focusable = Array.from(editModal.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((element) => element.getClientRects().length > 0);

    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function collectEditData() {
    const data = Object.fromEntries(new FormData(editForm).entries());
    delete data.status;
    data._expected_updated_at = editForm.dataset.expectedUpdatedAt || "";

    return data;
  }

  function setEditLoading(isLoading) {
    editForm.setAttribute("aria-busy", String(isLoading));
    if (window.AMUI && typeof window.AMUI.setButtonBusy === "function") {
      window.AMUI.setButtonBusy(saveEditButton, isLoading, {
        busyText: "Đang lưu...",
        idleText: "Lưu sửa"
      });
      return;
    }

    saveEditButton.disabled = isLoading;
    saveEditButton.textContent = isLoading ? "Đang lưu..." : "Lưu sửa";
  }

  async function handleEditSubmit(event) {
    event.preventDefault();
    clearNotice(editNotice);
    setEditLoading(true);

    try {
      const data = collectEditData();
      const updated = await window.AMApi.updateTicket(data.id, data);
      latestResults = latestResults.map((ticket) => ticket.id === updated.id ? updated : ticket);
      latestPresentationRows = latestPresentationRows.map((row) => Object.assign({}, row, {
        tickets: row.tickets.map((ticket) => ticket.id === updated.id ? updated : ticket)
      }));
      renderResults(latestPresentationRows);
      showNotice(editNotice, "success", `Đã lưu sửa phiếu ${window.AMApi.formatTicketCode(updated.ticket_code)}.`);
      if (window.AMUI && typeof window.AMUI.toast === "function") {
        window.AMUI.toast(`Đã lưu sửa phiếu ${window.AMApi.formatTicketCode(updated.ticket_code)}.`, { type: "success" });
      }
      setTimeout(closeModal, 700);
    } catch (error) {
      showNotice(editNotice, "error", error.message);
    } finally {
      setEditLoading(false);
    }
  }

  function populateYearOptions(years) {
    const uniqueYears = Array.from(new Set([currentVietnamYear()].concat(years || [])))
      .filter((year) => /^\d{4}$/.test(String(year)))
      .sort((a, b) => String(b).localeCompare(String(a)));
    searchYearSelect.replaceChildren();

    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = "Tất cả các năm";
    searchYearSelect.appendChild(allOption);

    uniqueYears.forEach((year) => {
      const option = document.createElement("option");
      option.value = String(year);
      option.textContent = String(year);
      searchYearSelect.appendChild(option);
    });

    if (!currentYear || (currentYear !== "all" && !uniqueYears.includes(currentYear))) {
      currentYear = currentVietnamYear();
    }
    searchYearSelect.value = currentYear;
  }

  function populateStatusOptions() {
    const statuses = Array.isArray(window.AMApi.TICKET_STATUSES)
      ? window.AMApi.TICKET_STATUSES
      : [];
    const fragment = document.createDocumentFragment();
    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = "Tất cả trạng thái";
    fragment.appendChild(allOption);

    statuses.forEach((status) => {
      const option = document.createElement("option");
      option.value = status;
      option.textContent = statusLabel(status);
      fragment.appendChild(option);
    });

    searchStatusSelect.replaceChildren(fragment);
    searchStatusSelect.value = currentStatus;
  }

  function attachEvents() {
    searchForm.addEventListener("submit", function (event) {
      event.preventDefault();
      performSearch(searchInput.value);
    });

    searchInput.addEventListener("input", scheduleSuggestions);
    searchInput.addEventListener("keydown", handleSuggestionKeydown);

    searchClear.addEventListener("click", function () {
      clearBulkForDataChange();
      searchInput.value = "";
      currentKeyword = "";
      currentPage = 1;
      updateSearchClearVisibility();
      closeSuggestions();
      searchInput.focus();
      loadTickets({ scroll: true });
    });

    searchYearSelect.addEventListener("change", function () {
      clearBulkForDataChange();
      currentYear = searchYearSelect.value || currentVietnamYear();
      currentPage = 1;
      closeSuggestions();
      loadTickets({ scroll: true });
    });

    searchStatusSelect.addEventListener("change", function () {
      clearBulkForDataChange();
      currentStatus = searchStatusSelect.value || "";
      currentPage = 1;
      closeSuggestions();
      loadTickets({ scroll: true });
    });

    exportExcelButton.addEventListener("click", handleExport);

    resultsPagination.addEventListener("click", function (event) {
      const button = event.target.closest("button[data-page]");

      if (!button || button.disabled) {
        return;
      }

      const nextPage = Number.parseInt(button.dataset.page, 10);

      if (!Number.isFinite(nextPage) || nextPage < 1 || nextPage > totalPages || nextPage === currentPage) {
        return;
      }

      currentPage = nextPage;
      clearBulkForDataChange();
      loadTickets({ scroll: true });
    });

    document.addEventListener("click", function (event) {
      if (!searchForm.contains(event.target)) {
        closeSuggestions();
      }
    });

    resultsList.addEventListener("click", function (event) {
      const batchToggle = event.target.closest("[data-batch-toggle]");
      if (batchToggle) {
        event.preventDefault();
        event.stopPropagation();
        toggleMultiGroup(batchToggle);
        return;
      }

      const batchRow = event.target.closest("[data-batch-row-toggle]");
      if (batchRow) {
        const interactiveTarget = event.target.closest(
          "button, a, input, select, textarea, [role=\"button\"], [data-no-row-toggle]"
        );
        if (interactiveTarget && batchRow.contains(interactiveTarget)) {
          return;
        }

        toggleMultiGroup(batchRow.querySelector("[data-batch-toggle]"));
        return;
      }

      const historyButton = event.target.closest("[data-history-customer-id]");

      if (historyButton) {
        loadCustomerHistory(historyButton.dataset.historyCustomerId);
        return;
      }

      const button = event.target.closest("[data-edit-id]");

      if (!button) {
        return;
      }

      const ticket = latestResults.find((item) => item.id === button.dataset.editId);

      if (ticket) {
        openEditModal(ticket);
      }
    });

    resultsList.addEventListener("keydown", function (event) {
      const batchRow = event.target.closest("[data-batch-row-toggle]");
      if (!batchRow || event.target !== batchRow || (event.key !== "Enter" && event.key !== " ")) {
        return;
      }

      event.preventDefault();
      toggleMultiGroup(batchRow.querySelector("[data-batch-toggle]"));
    });

    closeEditModal.addEventListener("click", closeModal);

    document.querySelectorAll("[data-close-edit]").forEach((button) => {
      button.addEventListener("click", closeModal);
    });

    editModal.addEventListener("click", function (event) {
      if (event.target === editModal) {
        closeModal();
      }
    });
    editModal.addEventListener("keydown", handleEditModalKeydown);

    editForm.addEventListener("submit", handleEditSubmit);

    if (completeRepairFromEdit) {
      completeRepairFromEdit.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const ticket = latestResults.find((item) => item.id === completeRepairFromEdit.dataset.ticketId);

        if (!ticket || !canReadyForHandover(ticket)) {
          return;
        }

        window.AMUI.completeRepairInPlace({
          ticketId: ticket.id,
          ticket,
          expectedStatus: ticket.status,
          button: completeRepairFromEdit,
          source: "search-edit-modal",
          onSuccess: (result) => applyReadyForHandoverResult(ticket, result)
        });
      });
    }

    if (returnRepairFromEdit) {
      returnRepairFromEdit.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const ticket = latestResults.find((item) => item.id === returnRepairFromEdit.dataset.ticketId);

        if (!ticket || !canReadyForHandover(ticket)) {
          return;
        }

        window.AMUI.returnRepairInPlace({
          ticket,
          button: returnRepairFromEdit,
          source: "search-edit-modal",
          onSuccess: (result) => applyReadyForHandoverResult(ticket, result)
        });
      });
    }
  }

  async function initSearch() {
    attachLogout();
    if (window.AMMoneyUtils && typeof window.AMMoneyUtils.attachInputs === "function") {
      window.AMMoneyUtils.attachInputs(editForm);
    }
    if (window.AMTvUtils && typeof window.AMTvUtils.attachTvModelAssist === "function") {
      editDeviceAssist = window.AMTvUtils.attachTvModelAssist({
        brandInput: editBrandInput,
        modelInput: editModelInput,
        sizeInput: editSizeInput,
        brandListElement: editBrandList,
        hintElement: editSizeAssistHint
      });
    }
    if (window.AMTvConditionUtils && typeof window.AMTvConditionUtils.attachConditionPicker === "function") {
      editConditionAssists = [
        window.AMTvConditionUtils.attachConditionPicker({
          type: "machine",
          label: "Chọn nhanh tình trạng máy",
          textarea: editConditionTextInput,
          container: editMachineConditionPicker
        }),
        window.AMTvConditionUtils.attachConditionPicker({
          type: "appearance",
          label: "Chọn nhanh ngoại quan",
          textarea: editExternalConditionInput,
          container: editAppearanceConditionPicker
        })
      ].filter(Boolean);
    }

    try {
      const access = await window.AMApi.requireInternalAccess();
      if (!access) {
        return;
      }

      bulkController = window.AMTicketBulkOperations.mountPageController({
        pageKey: "search",
        section: resultsList.closest(".search-results"),
        toolbar: document.querySelector(".search-bulk-actions"),
        capabilities: BULK_CAPABILITIES,
        readFreshTicket: (uuid) => window.AMApi.getTicketById(uuid),
        refresh: () => loadTickets({ scroll: false })
      });

      attachEvents();

      currentYear = currentVietnamYear();
      populateYearOptions([]);
      populateStatusOptions();

      try {
        populateYearOptions(await window.AMApi.getTicketYears());
      } catch (error) {
        showNotice(searchNotice, "info", "Chưa tải được danh sách năm; đang dùng năm hiện tại.");
      }

      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const customerId = params.get("customer_id");
      const requestedStatus = params.get("status");

      if (window.AMApi.TICKET_STATUSES.includes(requestedStatus)) {
        currentStatus = requestedStatus;
        searchStatusSelect.value = currentStatus;
      }

      if (customerId) {
        currentStatus = "";
        searchStatusSelect.value = "";
        currentYear = "all";
        searchYearSelect.value = "all";
        await loadCustomerHistory(customerId);
      } else if (code) {
        currentStatus = "";
        searchStatusSelect.value = "";
        currentYear = "all";
        searchYearSelect.value = "all";
        searchInput.value = code;
        updateSearchClearVisibility();
        await performSearch(code);
      } else {
        await loadTickets({ scroll: false });
      }
    } catch (error) {
      showNotice(searchNotice, "error", error.message);
    }
  }

  document.addEventListener("DOMContentLoaded", initSearch);
})();

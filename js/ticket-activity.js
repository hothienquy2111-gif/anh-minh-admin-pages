(function () {
  "use strict";

  const notice = document.getElementById("ticketActivityNotice");
  const workflow = {
    section: document.getElementById("workflowSection"),
    form: document.getElementById("workflowSearchForm"),
    searchInput: document.getElementById("workflowSearchInput"),
    clearButton: document.getElementById("workflowSearchClear"),
    filters: document.getElementById("workflowStatusFilters"),
    refreshing: document.getElementById("workflowRefreshIndicator"),
    state: document.getElementById("workflowState"),
    content: document.getElementById("workflowContent"),
    listSummary: document.getElementById("workflowListSummary"),
    tableBody: document.getElementById("workflowTableBody"),
    cards: document.getElementById("workflowCards"),
    pagination: document.getElementById("workflowPagination")
  };

  const PAGE_SIZE = 8;
  const SEARCH_DELAY = 280;
  const PRE_REPAIR_STATUSES = Array.isArray(window.AMApi && window.AMApi.PRE_REPAIR_STATUSES)
    ? window.AMApi.PRE_REPAIR_STATUSES
    : ["mới nhận", "đang kiểm tra", "báo giá"];
  let workflowRequestId = 0;
  let totalCount = 0;
  let totalPages = 1;
  let searchTimer = null;
  let visibleTickets = [];
  const state = {
    page: 1,
    keyword: "",
    filter: "all"
  };

  function showNotice(type, message) {
    if (!notice) {
      return;
    }

    notice.className = `notice ${type} show`;
    notice.textContent = message;
  }

  function attachLogout() {
    document.querySelectorAll("[data-logout]").forEach((button) => {
      if (button.dataset.logoutReady === "true") {
        return;
      }

      button.dataset.logoutReady = "true";
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

  function parseTicketTime(value) {
    const time = Date.parse(String(value || ""));
    return Number.isFinite(time) ? time : 0;
  }

  function elapsedParts(milliseconds) {
    const totalMinutes = Math.max(0, Math.floor(milliseconds / 60000));
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

  function timeFrom(value) {
    const time = parseTicketTime(value);
    return time ? Math.max(0, Date.now() - time) : 0;
  }

  function statusClass(status) {
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

    return classes[String(status || "").toLowerCase()] || "";
  }

  function statusLabel(status) {
    return window.AMApi.formatTicketStatusLabel(status, "—");
  }

  function canStartRepair(ticket) {
    return PRE_REPAIR_STATUSES.includes(ticket.status)
      && !ticket.repair_started_at
      && !ticket.completed_at;
  }

  function canReadyForHandover(ticket) {
    return ticket.status === "đang sửa"
      && Boolean(ticket.repair_started_at)
      && !ticket.ready_for_handover_at
      && !ticket.completed_at;
  }

  function canReprintLabel(ticket) {
    return Boolean(ticket.repair_started_at) && ticket.status !== "huỷ";
  }

  function canReprintReceipt(ticket) {
    return ticket.status === "đã trả" && Boolean(ticket.completed_at);
  }

  function workflowPriority(ticket) {
    if (ticket.status === "đang sửa" && ticket.repair_started_at) {
      const waited = timeFrom(ticket.repair_started_at);

      if (waited >= 48 * 60 * 60 * 1000) {
        return { rank: 1, className: "priority-overdue", label: "Sửa chữa quá hạn", wait: waited };
      }

      return { rank: 2, className: "priority-repairing", label: "Đang sửa", wait: waited };
    }

    if (PRE_REPAIR_STATUSES.includes(ticket.status)) {
      return { rank: 3, className: "priority-neutral", label: "Đang xử lý", wait: timeFrom(ticket.created_at) };
    }

    if (ticket.status === "chờ bàn giao") {
      return { rank: 4, className: "priority-handover", label: "Chờ bàn giao", wait: timeFrom(ticket.ready_for_handover_at) };
    }

    return {
      rank: 5,
      className: "priority-neutral",
      label: ticket.status === "đã trả" ? "Đã bàn giao" : ticket.status === "huỷ" ? "Đã huỷ" : "Hoạt động khác",
      wait: timeFrom(ticket.last_activity_at || ticket.created_at)
    };
  }

  function workflowActivityText(ticket) {
    if (ticket.status === "đã trả") {
      return "Đã hoàn tất bàn giao";
    }

    if (ticket.status === "chờ bàn giao") {
      return "Đã kết thúc sửa chữa, đang chờ bàn giao";
    }

    if (ticket.status === "đang sửa") {
      return "Đang sửa chữa";
    }

    if (ticket.status === "đã xong") {
      return "Dữ liệu workflow cũ";
    }

    if (ticket.status === "huỷ") {
      return "Phiếu đã huỷ";
    }

    return "Đang tiếp nhận và kiểm tra";
  }

  function repairResultText(ticket) {
    const note = String(ticket.internal_note || "");
    const returnMarker = "[Kết quả sửa chữa: Giao trả]";
    const returnLine = note
      .split(/\r?\n/)
      .reverse()
      .find((line) => line.trim().startsWith(returnMarker));

    if (returnLine) {
      const recordedValue = returnLine.trim().slice(returnMarker.length).trim();
      const reason = recordedValue.split(/\s+—\s+/)[0].trim();
      return reason ? `Giao trả — ${reason}` : "Giao trả sửa chữa";
    }

    if (["chờ bàn giao", "đã trả"].includes(ticket.status) && ticket.ready_for_handover_at) {
      return "Đã sửa hoàn tất";
    }

    if (ticket.status === "đang sửa") {
      return "Đang xử lý";
    }

    return "Chưa có kết quả";
  }

  function workflowWaitText(ticket) {
    const priority = workflowPriority(ticket);

    if (priority.rank === 1) {
      return `Quá 48 giờ — ${elapsedParts(priority.wait)}`;
    }

    if (priority.rank === 2) {
      return `Đang sửa — ${elapsedParts(priority.wait)}`;
    }

    if (ticket.status === "chờ bàn giao" && ticket.ready_for_handover_at) {
      return `Chờ bàn giao — ${elapsedParts(timeFrom(ticket.ready_for_handover_at))}`;
    }

    return priority.label;
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

  function createCell(text, className) {
    return createElement("td", className, text);
  }

  function createStatusBadge(status) {
    return createElement("span", `status-pill ${statusClass(status)}`.trim(), statusLabel(status));
  }

  function createPriorityBadge(ticket) {
    const priority = workflowPriority(ticket);
    return createElement("span", `workflow-priority ${priority.className}`, priority.label);
  }

  function ticketQuery(ticket) {
    if (ticket.ticket_code) {
      return `code=${encodeURIComponent(ticket.ticket_code)}`;
    }

    return `id=${encodeURIComponent(ticket.id || "")}`;
  }

  function createWorkflowLink(label, href, primary) {
    const link = createElement("a", `btn ${primary ? "primary" : "secondary"} compact workflow-action`, label);
    link.href = href;
    return link;
  }

  async function refreshCurrentView() {
    await loadWorkflowTickets({ refresh: true, forceRefresh: true });
  }

  function createReadyButton(ticket) {
    const button = createElement("button", "btn primary compact workflow-action", "Hoàn thành sửa chữa");
    button.type = "button";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.AMUI.completeRepairInPlace({
        ticketId: ticket.id,
        ticket,
        expectedStatus: ticket.status,
        button,
        source: "ticket-activity",
        onSuccess: refreshCurrentView
      });
    });
    return button;
  }

  function createRepairReturnButton(ticket) {
    const button = createElement("button", "btn secondary compact workflow-action workflow-return-action", "Giao trả sửa chữa");
    button.type = "button";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.AMUI.returnRepairInPlace({
        ticket,
        button,
        source: "ticket-activity",
        onSuccess: refreshCurrentView
      });
    });
    return button;
  }

  function createActionMenu(items) {
    const details = createElement("details", "workflow-action-menu");
    const summary = createElement("summary", "btn secondary compact workflow-action-menu-trigger", "Thêm thao tác");
    const menu = createElement("div", "workflow-action-menu-list");

    items.forEach((item) => menu.appendChild(item));
    details.append(summary, menu);
    return details;
  }

  function createWorkflowActions(ticket) {
    const actions = createElement("div", "workflow-actions ticket-activity-actions");
    const query = ticketQuery(ticket);
    const secondary = [];

    if (canStartRepair(ticket)) {
      actions.appendChild(createWorkflowLink("In tem & bắt đầu sửa chữa", `print-label.html?${query}`, true));
    } else if (canReadyForHandover(ticket)) {
      actions.append(createReadyButton(ticket), createRepairReturnButton(ticket));
      secondary.push(createWorkflowLink("Chỉ in lại tem", `print-label.html?${query}`, false));
    } else if (ticket.status === "chờ bàn giao") {
      actions.appendChild(createWorkflowLink("Mở Bàn giao tivi", `handover-tickets.html?${query}`, true));
      if (canReprintLabel(ticket)) {
        secondary.push(createWorkflowLink("Chỉ in lại tem", `print-label.html?${query}`, false));
      }
    } else if (canReprintReceipt(ticket)) {
      actions.appendChild(createWorkflowLink("Chỉ in lại biên nhận", `print-delivery-receipt.html?${query}`, false));
    } else if (ticket.status === "đã xong") {
      actions.appendChild(createElement("span", "workflow-inline-note", "Dữ liệu workflow cũ"));
    } else if (canReprintLabel(ticket)) {
      secondary.push(createWorkflowLink("Chỉ in lại tem", `print-label.html?${query}`, false));
    }

    secondary.push(createWorkflowLink("Xem phiếu", `search.html?${query}`, false));

    if (ticket.customer_id) {
      secondary.push(createWorkflowLink(
        "Lịch sử khách hàng",
        `search.html?customer_id=${encodeURIComponent(ticket.customer_id)}`,
        false
      ));
    }

    if (secondary.length === 1 && actions.childElementCount === 0) {
      actions.appendChild(secondary[0]);
    } else if (secondary.length > 0) {
      actions.appendChild(createActionMenu(secondary));
    }

    return actions;
  }

  function createTicketCodeCell(ticket) {
    const cell = createElement("td", "workflow-ticket-code");
    const code = createElement("strong", "workflow-ticket-code-value", window.AMApi.formatTicketCode(ticket.ticket_code));
    code.dataset.ticketCode = ticket.ticket_code || "";
    cell.appendChild(code);

    if (ticket.search_match_label) {
      cell.appendChild(createElement("span", "workflow-search-match", ticket.search_match_label));
    }

    return cell;
  }

  function renderWorkflowRows(tickets) {
    const fragment = document.createDocumentFragment();

    tickets.forEach((ticket) => {
      const row = document.createElement("tr");
      const priorityCell = document.createElement("td");
      const statusCell = document.createElement("td");
      const actionCell = createElement("td", "ticket-activity-action-cell");

      row.dataset.ticketCode = ticket.ticket_code || "";
      priorityCell.appendChild(createPriorityBadge(ticket));
      statusCell.appendChild(createStatusBadge(ticket.status));
      actionCell.appendChild(createWorkflowActions(ticket));
      row.append(
        priorityCell,
        createTicketCodeCell(ticket),
        createCell(window.AMApi.formatCustomerCode(ticket.customer_code), "workflow-customer-code"),
        createCell(textOrDash(ticket.customer_name || ticket.customer_master_name), "workflow-customer-name"),
        createCell(textOrDash(ticket.model)),
        createCell(`${workflowActivityText(ticket)} · ${repairResultText(ticket)}`),
        createCell(workflowWaitText(ticket), "workflow-wait"),
        statusCell,
        actionCell
      );
      fragment.appendChild(row);
    });

    workflow.tableBody.replaceChildren(fragment);
  }

  function createWorkflowMeta(label, value) {
    const item = document.createElement("div");
    item.append(
      createElement("span", "", label),
      createElement("strong", "", textOrDash(value))
    );
    return item;
  }

  function renderWorkflowCards(tickets) {
    const fragment = document.createDocumentFragment();

    tickets.forEach((ticket) => {
      const card = createElement("article", "workflow-card ticket-activity-mobile-card");
      const top = createElement("div", "workflow-card-top");
      const title = createElement("div", "workflow-card-title");
      const code = createElement("strong", "", window.AMApi.formatTicketCode(ticket.ticket_code));
      const customer = createElement(
        "span",
        "",
        `${window.AMApi.formatCustomerCode(ticket.customer_code)} · ${textOrDash(ticket.customer_name || ticket.customer_master_name)}`
      );
      const badges = createElement("div", "workflow-card-badges");
      const meta = createElement("div", "workflow-card-meta");

      card.dataset.ticketCode = ticket.ticket_code || "";
      code.dataset.ticketCode = ticket.ticket_code || "";
      title.append(code, customer);
      badges.append(createPriorityBadge(ticket), createStatusBadge(ticket.status));
      top.append(title, badges);
      meta.append(
        createWorkflowMeta("Hãng / Model", [ticket.brand, ticket.model].filter(Boolean).join(" ")),
        createWorkflowMeta("Kết quả sửa chữa", repairResultText(ticket)),
        createWorkflowMeta("Hoạt động", workflowActivityText(ticket)),
        createWorkflowMeta("Thời gian", workflowWaitText(ticket))
      );

      if (ticket.search_match_label) {
        card.appendChild(createElement("span", "workflow-search-match", ticket.search_match_label));
      }

      card.append(top, meta, createWorkflowActions(ticket));
      fragment.appendChild(card);
    });

    workflow.cards.replaceChildren(fragment);
  }

  function createPaginationButton(label, page, options) {
    const config = options || {};
    const button = createElement("button", `pagination-button ${config.active ? "active" : ""}`.trim(), label);
    button.type = "button";
    button.dataset.page = String(page);
    button.disabled = Boolean(config.disabled);
    button.setAttribute("aria-label", config.ariaLabel || `Trang ${page}`);

    if (config.active) {
      button.setAttribute("aria-current", "page");
    }

    return button;
  }

  function paginationItems(pageCount, currentPage) {
    if (pageCount <= 7) {
      return Array.from({ length: pageCount }, (_, index) => index + 1);
    }

    const items = [1];
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(pageCount - 1, currentPage + 1);

    if (start > 2) {
      items.push("ellipsis");
    }

    for (let page = start; page <= end; page += 1) {
      items.push(page);
    }

    if (end < pageCount - 1) {
      items.push("ellipsis");
    }

    items.push(pageCount);
    return items;
  }

  function renderPagination() {
    workflow.pagination.replaceChildren();
    workflow.pagination.hidden = totalPages <= 1 || totalCount === 0;

    if (workflow.pagination.hidden) {
      return;
    }

    workflow.pagination.appendChild(createPaginationButton("← Trước", state.page - 1, {
      disabled: state.page === 1,
      ariaLabel: "Trang trước"
    }));

    paginationItems(totalPages, state.page).forEach((item) => {
      if (item === "ellipsis") {
        const ellipsis = createElement("span", "pagination-ellipsis", "…");
        ellipsis.setAttribute("aria-hidden", "true");
        workflow.pagination.appendChild(ellipsis);
        return;
      }

      workflow.pagination.appendChild(createPaginationButton(String(item), item, {
        active: item === state.page,
        ariaLabel: `Trang ${item}`
      }));
    });

    workflow.pagination.appendChild(createPaginationButton("Sau →", state.page + 1, {
      disabled: state.page === totalPages,
      ariaLabel: "Trang sau"
    }));
  }

  function emptyMessage() {
    if (state.keyword) {
      return "Không tìm thấy phiếu phù hợp.";
    }

    if (state.filter !== "all") {
      return "Không có phiếu trong nhóm trạng thái này.";
    }

    return "Chưa có phiếu nào.";
  }

  function renderSummary(tickets) {
    if (totalCount === 0) {
      workflow.listSummary.textContent = emptyMessage();
      return;
    }

    const start = (state.page - 1) * PAGE_SIZE + 1;
    const end = Math.min(start + tickets.length - 1, totalCount);
    workflow.listSummary.textContent = `Hiển thị ${start}–${end} trên tổng số ${totalCount} phiếu.`;
  }

  function renderFilterCounts(filterCounts) {
    const counts = filterCounts || {};

    workflow.filters.querySelectorAll("[data-filter-count]").forEach((element) => {
      element.textContent = String(Number(counts[element.dataset.filterCount] || 0));
    });
  }

  function syncFilterButtons() {
    workflow.filters.querySelectorAll("[data-activity-filter]").forEach((button) => {
      const active = button.dataset.activityFilter === state.filter;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function setWorkflowState(type, message) {
    workflow.state.replaceChildren(document.createTextNode(message));
    window.AMUI.setSectionState({
      section: workflow.section,
      stateElement: workflow.state,
      dataElement: workflow.content,
      refreshingElement: workflow.refreshing
    }, type);
  }

  function showWorkflowContent() {
    workflow.state.textContent = "";
    window.AMUI.setSectionState({
      section: workflow.section,
      stateElement: workflow.state,
      dataElement: workflow.content,
      refreshingElement: workflow.refreshing
    }, "data");
  }

  function highlightRequestedTicket() {
    const requestedCode = new URLSearchParams(window.location.search).get("code");

    if (!requestedCode) {
      return;
    }

    const canonical = window.AMApi.expandCompactBusinessCode(requestedCode, "AM");
    const match = Array.from(workflow.section.querySelectorAll("[data-ticket-code]"))
      .find((element) => element.dataset.ticketCode === canonical);

    if (match) {
      const target = match.closest("tr, article") || match;
      target.classList.add("workflow-focus-ticket");
    }
  }

  function renderWorkflow(tickets, filterCounts) {
    visibleTickets = tickets.slice();
    renderFilterCounts(filterCounts);
    renderSummary(tickets);

    if (totalCount === 0) {
      workflow.tableBody.replaceChildren();
      workflow.cards.replaceChildren();
      renderPagination();
      setWorkflowState("empty", emptyMessage());
      return;
    }

    renderWorkflowRows(tickets);
    renderWorkflowCards(tickets);
    renderPagination();
    showWorkflowContent();
    highlightRequestedTicket();
  }

  function readStateFromUrl() {
    const code = new URLSearchParams(window.location.search).get("code");

    if (code) {
      state.keyword = code;
      workflow.searchInput.value = code;
    }
  }

  function setPage(page) {
    const nextPage = Math.min(Math.max(Number(page) || 1, 1), totalPages);

    if (nextPage === state.page) {
      return;
    }

    state.page = nextPage;
    loadWorkflowTickets({ refresh: true });
  }

  async function loadWorkflowTickets(options) {
    const config = options || {};

    if (!workflow.section) {
      return;
    }

    const requestId = ++workflowRequestId;
    const hasVisibleData = !workflow.content.hidden && visibleTickets.length > 0;

    if (config.refresh || hasVisibleData) {
      window.AMUI.setSectionState({
        section: workflow.section,
        stateElement: workflow.state,
        dataElement: workflow.content,
        refreshingElement: workflow.refreshing
      }, "refreshing");
    } else {
      setWorkflowState("loading", "Đang tải hoạt động của phiếu...");
    }

    try {
      const result = await window.AMApi.getTicketActivityTickets({
        page: state.page,
        pageSize: PAGE_SIZE,
        keyword: state.keyword,
        filter: state.filter,
        forceRefresh: config.forceRefresh === true
      });

      if (requestId !== workflowRequestId) {
        return;
      }

      if (!result.available) {
        setWorkflowState("unavailable", result.message || "Workflow chưa được kích hoạt.");
        return;
      }

      totalCount = Number(result.totalCount || 0);
      totalPages = Math.max(1, Number(result.totalPages || 1));
      state.page = Math.min(Math.max(Number(result.page) || 1, 1), totalPages);
      renderWorkflow(result.tickets || [], result.filterCounts || {});
    } catch (error) {
      if (requestId !== workflowRequestId) {
        return;
      }

      setWorkflowState("error", "Không tải được hoạt động của phiếu. Vui lòng thử lại.");
      const retry = createElement("button", "btn secondary list-state-action", "Thử lại");
      retry.type = "button";
      retry.addEventListener("click", () => loadWorkflowTickets({ refresh: true, forceRefresh: true }));
      workflow.state.appendChild(retry);
    }
  }

  function runSearchNow() {
    if (searchTimer) {
      window.clearTimeout(searchTimer);
      searchTimer = null;
    }

    const keyword = workflow.searchInput.value.trim();

    if (keyword === state.keyword && state.page === 1) {
      return;
    }

    state.keyword = keyword;
    state.page = 1;
    loadWorkflowTickets({ refresh: true });
  }

  function scheduleSearch() {
    if (searchTimer) {
      window.clearTimeout(searchTimer);
    }

    searchTimer = window.setTimeout(runSearchNow, SEARCH_DELAY);
  }

  function clearSearch() {
    if (searchTimer) {
      window.clearTimeout(searchTimer);
      searchTimer = null;
    }

    if (!state.keyword && state.page === 1 && !workflow.searchInput.value) {
      return;
    }

    workflow.searchInput.value = "";
    state.keyword = "";
    state.page = 1;
    loadWorkflowTickets({ refresh: true });
  }

  function changeFilter(nextFilter) {
    if (!nextFilter || nextFilter === state.filter) {
      return;
    }

    state.filter = nextFilter;
    state.page = 1;
    syncFilterButtons();
    loadWorkflowTickets({ refresh: true });
  }

  async function initTicketActivity() {
    attachLogout();
    readStateFromUrl();
    syncFilterButtons();

    workflow.form.addEventListener("submit", (event) => {
      event.preventDefault();
      runSearchNow();
    });
    workflow.searchInput.addEventListener("input", scheduleSearch);
    workflow.clearButton.addEventListener("click", clearSearch);
    workflow.filters.addEventListener("click", (event) => {
      const button = event.target.closest("[data-activity-filter]");
      if (button) {
        changeFilter(button.dataset.activityFilter);
      }
    });
    workflow.pagination.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-page]");
      if (button && !button.disabled) {
        setPage(button.dataset.page);
      }
    });

    try {
      const access = await window.AMApi.requireInternalAccess();
      if (access) {
        await loadWorkflowTickets();
      }
    } catch (error) {
      showNotice("error", error.message);
    }
  }

  document.addEventListener("DOMContentLoaded", initTicketActivity);
})();

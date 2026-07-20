(function () {
  "use strict";

  const notice = document.getElementById("ticketActivityNotice");
  const workflow = {
    section: document.getElementById("workflowSection"),
    form: document.getElementById("workflowSearchForm"),
    searchInput: document.getElementById("workflowSearchInput"),
    searchButton: document.getElementById("workflowSearchButton"),
    clearButton: document.getElementById("workflowSearchClear"),
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
  const state = {
    page: 1,
    keyword: ""
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
    if (!value) {
      return 0;
    }

    const date = String(value).includes("T")
      ? new Date(value)
      : new Date(`${value}T00:00:00`);

    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
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
    return time ? Date.now() - time : 0;
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

      return {
        rank: 2,
        className: "priority-repairing",
        label: "Đang sửa",
        wait: waited
      };
    }

    if (PRE_REPAIR_STATUSES.includes(ticket.status)) {
      return {
        rank: 3,
        className: "priority-neutral",
        label: "Chưa bắt đầu sửa",
        wait: timeFrom(ticket.created_at)
      };
    }

    return {
      rank: 4,
      className: "priority-neutral",
      label: ticket.status === "đã xong" ? "Dữ liệu workflow cũ" : ticket.status === "huỷ" ? "Đã huỷ" : "Hoạt động gần đây",
      wait: timeFrom(ticket.last_activity_at || ticket.created_at)
    };
  }

  function workflowActivityText(ticket) {
    if (ticket.status === "đã trả") {
      return "Đã bàn giao";
    }

    if (ticket.status === "đã xong") {
      return "Dữ liệu workflow cũ chưa đầy đủ";
    }

    if (ticket.status === "đang sửa") {
      return "Đang sửa chữa";
    }

    if (ticket.status === "chờ bàn giao") {
      return "Hoàn thành sửa chữa — đang chờ bàn giao";
    }

    if (ticket.status === "huỷ") {
      return "Phiếu đã huỷ";
    }

    return "Chưa bắt đầu sửa";
  }

  function workflowWaitText(ticket) {
    const priority = workflowPriority(ticket);

    if (priority.rank === 1) {
      return `${priority.label} — ${elapsedParts(priority.wait)}`;
    }

    if (priority.rank === 2) {
      return `Đang sửa — ${elapsedParts(priority.wait)}`;
    }

    return priority.label;
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

  function createPriorityBadge(ticket) {
    const priority = workflowPriority(ticket);
    const badge = document.createElement("span");
    badge.className = `workflow-priority ${priority.className}`;
    badge.textContent = priority.rank === 1 || priority.rank === 2
      ? `! ${priority.label}`
      : priority.label;
    return badge;
  }

  function createWorkflowLink(label, href, primary) {
    const link = document.createElement("a");
    link.className = `btn ${primary ? "primary" : "secondary"} compact workflow-action`;
    link.textContent = label;
    link.href = href;
    return link;
  }

  function createWorkflowButton(label, primary, ticket, onSuccess) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `btn ${primary ? "primary" : "secondary"} compact workflow-action`;
    button.textContent = label;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.AMUI.completeRepairInPlace({
        ticketId: ticket.id,
        expectedStatus: ticket.status,
        button,
        source: "ticket-activity",
        onSuccess
      });
    });
    return button;
  }

  function createWorkflowActions(ticket) {
    const actions = document.createElement("div");
    const code = encodeURIComponent(ticket.ticket_code || "");
    const id = encodeURIComponent(ticket.id || "");
    const ticketQuery = ticket.ticket_code ? `code=${code}` : `id=${id}`;

    actions.className = "workflow-actions ticket-activity-actions";

    if (canStartRepair(ticket)) {
      actions.appendChild(createWorkflowLink("In tem & bắt đầu sửa chữa", `print-label.html?${ticketQuery}`, true));
    } else if (canReadyForHandover(ticket)) {
      const readyButton = createWorkflowButton(
        "Hoàn thành sửa chữa",
        true,
        ticket,
        () => loadWorkflowTickets({ refresh: true })
      );
      actions.appendChild(readyButton);
      actions.appendChild(createWorkflowLink("Chỉ in lại tem", `print-label.html?${ticketQuery}`, false));
    } else if (canReprintReceipt(ticket)) {
      actions.appendChild(createWorkflowLink("Chỉ in lại biên nhận", `print-delivery-receipt.html?${ticketQuery}`, false));
    } else if (ticket.status === "đã xong") {
      const note = document.createElement("span");
      note.className = "workflow-inline-note";
      note.textContent = "Dữ liệu workflow cũ cần xử lý thủ công";
      actions.appendChild(note);
    } else if (canReprintLabel(ticket)) {
      actions.appendChild(createWorkflowLink("Chỉ in lại tem", `print-label.html?${ticketQuery}`, false));
    }

    actions.appendChild(createWorkflowLink("Xem phiếu", `search.html?${ticketQuery}`, false));
    return actions;
  }

  function setWorkflowState(type, message) {
    if (!workflow.state || !workflow.content) {
      return;
    }

    workflow.state.textContent = message;
    window.AMUI.setSectionState({
      section: workflow.section,
      stateElement: workflow.state,
      dataElement: workflow.content,
      refreshingElement: workflow.refreshing
    }, type);
  }

  function setWorkflowLoading() {
    const hasVisibleData = !workflow.content.hidden && workflow.tableBody.childElementCount > 0;

    if (hasVisibleData) {
      workflow.state.textContent = "";
      window.AMUI.setSectionState({
        section: workflow.section,
        stateElement: workflow.state,
        dataElement: workflow.content
      }, "refreshing");
      return;
    }

    setWorkflowState("loading", "Đang tải hoạt động của phiếu...");
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

  function renderWorkflowRows(tickets) {
    workflow.tableBody.innerHTML = "";

    tickets.forEach((ticket) => {
      const row = document.createElement("tr");
      const priorityCell = document.createElement("td");
      const statusCell = document.createElement("td");
      const actionCell = document.createElement("td");
      row.dataset.ticketCode = ticket.ticket_code || "";
      actionCell.className = "ticket-activity-action-cell";

      priorityCell.appendChild(createPriorityBadge(ticket));
      statusCell.appendChild(createStatusBadge(ticket.status));
      actionCell.appendChild(createWorkflowActions(ticket));

      row.append(
        priorityCell,
        createCell(window.AMApi.formatTicketCode(ticket.ticket_code), "workflow-ticket-code"),
        createCell(window.AMApi.formatCustomerCode(ticket.customer_code), "workflow-customer-code"),
        createCell(textOrDash(ticket.customer_name || ticket.customer_master_name), "workflow-customer-name"),
        createCell(textOrDash(ticket.model)),
        createCell(workflowActivityText(ticket)),
        createCell(workflowWaitText(ticket), "workflow-wait"),
        statusCell,
        actionCell
      );

      workflow.tableBody.appendChild(row);
    });
  }

  function createWorkflowMeta(label, value) {
    const item = document.createElement("div");
    const key = document.createElement("span");
    const val = document.createElement("strong");

    key.textContent = label;
    val.textContent = textOrDash(value);
    item.append(key, val);
    return item;
  }

  function renderWorkflowCards(tickets) {
    workflow.cards.innerHTML = "";

    tickets.forEach((ticket) => {
      const card = document.createElement("article");
      const top = document.createElement("div");
      const title = document.createElement("div");
      const code = document.createElement("strong");
      const customer = document.createElement("span");
      const meta = document.createElement("div");

      card.className = "workflow-card";
      card.dataset.ticketCode = ticket.ticket_code || "";
      top.className = "workflow-card-top";
      title.className = "workflow-card-title";
      meta.className = "workflow-card-meta";

      code.textContent = window.AMApi.formatTicketCode(ticket.ticket_code);
      customer.textContent = `${window.AMApi.formatCustomerCode(ticket.customer_code)} · ${textOrDash(ticket.customer_name || ticket.customer_master_name)}`;
      title.append(code, customer);
      top.append(title, createPriorityBadge(ticket));

      meta.append(
        createWorkflowMeta("Model", ticket.model),
        createWorkflowMeta("Hoạt động", workflowActivityText(ticket)),
        createWorkflowMeta("Thời gian", workflowWaitText(ticket)),
        createWorkflowMeta("Trạng thái", ticket.status)
      );

      card.append(top, meta, createWorkflowActions(ticket));
      workflow.cards.appendChild(card);
    });
  }

  function createPaginationButton(label, page, options) {
    const config = options || {};
    const button = document.createElement("button");
    button.type = "button";
    button.className = `pagination-button ${config.active ? "active" : ""}`.trim();
    button.textContent = label;
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
        const ellipsis = document.createElement("span");
        ellipsis.className = "pagination-ellipsis";
        ellipsis.textContent = "…";
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

  function renderSummary(tickets) {
    if (totalCount === 0) {
      workflow.listSummary.textContent = state.keyword
        ? "Không tìm thấy phiếu phù hợp."
        : "Chưa có phiếu đang sửa cần theo dõi.";
      return;
    }

    const start = (state.page - 1) * PAGE_SIZE + 1;
    const end = Math.min(start + tickets.length - 1, totalCount);
    workflow.listSummary.textContent = `Hiển thị ${start}–${end} trên tổng số ${totalCount} phiếu.`;
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
      match.classList.add("workflow-focus-ticket");
    }
  }

  function renderWorkflow(tickets) {
    renderSummary(tickets);

    if (totalCount === 0) {
      workflow.tableBody.replaceChildren();
      workflow.cards.replaceChildren();
      renderPagination();
      setWorkflowState(
        "empty",
        state.keyword ? "Không tìm thấy phiếu phù hợp." : "Chưa có phiếu đang sửa cần theo dõi."
      );
      return;
    }

    renderWorkflowRows(tickets);
    renderWorkflowCards(tickets);
    renderPagination();
    showWorkflowContent();
    highlightRequestedTicket();
  }

  function readStateFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");

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
    if (!workflow.section) {
      return;
    }

    const requestId = ++workflowRequestId;
    const hasVisibleData = !workflow.content.hidden && workflow.tableBody.childElementCount > 0;
    const isRefresh = Boolean(options && options.refresh) || hasVisibleData;

    if (isRefresh) {
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
        keyword: state.keyword
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

      if (totalCount > 0 && state.page > totalPages) {
        state.page = totalPages;
        await loadWorkflowTickets({ refresh: true });
        return;
      }

      renderWorkflow(result.tickets || []);
    } catch (error) {
      if (requestId !== workflowRequestId) {
        return;
      }

      setWorkflowState("error", "Không tải được hoạt động của phiếu. Vui lòng thử lại.");
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "btn secondary list-state-action";
      retry.textContent = "Thử lại";
      retry.addEventListener("click", () => loadWorkflowTickets({ refresh: true }));
      workflow.state.appendChild(retry);
    } finally {
      if (requestId === workflowRequestId) {
        workflow.section.setAttribute("aria-busy", "false");
      }
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

  async function initTicketActivity() {
    attachLogout();
    readStateFromUrl();

    workflow.form.addEventListener("submit", (event) => {
      event.preventDefault();
      runSearchNow();
    });
    workflow.searchInput.addEventListener("input", scheduleSearch);
    workflow.clearButton.addEventListener("click", clearSearch);
    workflow.pagination.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-page]");

      if (!button || button.disabled) {
        return;
      }

      setPage(button.dataset.page);
    });

    try {
      const access = await window.AMApi.requireInternalAccess();
      if (!access) {
        return;
      }

      await loadWorkflowTickets();
    } catch (error) {
      showNotice("error", error.message);
    }
  }

  document.addEventListener("DOMContentLoaded", initTicketActivity);
})();

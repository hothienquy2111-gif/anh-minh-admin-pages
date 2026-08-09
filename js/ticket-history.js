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
    pagination: document.getElementById("ticketHistoryPagination")
  };

  const TICKET_HISTORY_PAGE_SIZE = 20;
  const TICKET_HISTORY_SEARCH_DELAY = 420;

  let ticketHistoryPage = 1;
  let ticketHistoryTotal = 0;
  let ticketHistoryTotalPages = 1;
  let ticketHistoryKeyword = "";
  let ticketHistorySearchTimer = null;
  let ticketHistoryRequestId = 0;
  const expandedBatchIds = new Set();
  const batchRowAnimationTimers = new WeakMap();

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

  function createTicketHistorySpacer(batchId, childIndex, hidden, isGroupEnd) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    row.className = isGroupEnd
      ? "ticket-history-batch-end-spacer"
      : "ticket-history-batch-child-spacer";
    row.setAttribute("aria-hidden", "true");
    row.setAttribute("role", "presentation");
    cell.colSpan = 9;
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

      if (batchId) {
        row.className = "ticket-presentation-child-row";
        row.dataset.batchChildOf = batchId;
        row.dataset.batchChildIndex = String(childIndex + 1);
      }
      statusCell.appendChild(createStatusBadge(ticket.status));
      actionCell.appendChild(createTicketHistoryLink(ticket));

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

      status.className = "status-pill ticket-history-batch-status";
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

  function renderTicketHistory(rows) {
    const total = ticketHistoryTotal;

    if (total === 0) {
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

    try {
      const result = await window.AMApi.getTicketsForGroupedPresentation({
        query: ticketHistoryKeyword,
        page: ticketHistoryPage,
        pageSize: TICKET_HISTORY_PAGE_SIZE
      });

      if (requestId !== ticketHistoryRequestId) {
        return;
      }

      ticketHistoryTotal = result.totalCount || 0;
      const rows = window.AMMultiTicketPresentation.buildTicketPresentationRows(result.records || []);
      const pageResult = window.AMMultiTicketPresentation.paginateRows(
        rows,
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
      if (requestId !== ticketHistoryRequestId) {
        return;
      }

      setTicketHistoryState("error", "Không tải được lịch sử nhận phiếu. Vui lòng thử lại.");
    }
  }

  function setTicketHistoryPage(page) {
    ticketHistoryPage = Math.min(Math.max(page, 1), ticketHistoryTotalPages);
    loadTicketHistory(true);
  }

  function clearTicketHistorySearch() {
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

    try {
      const access = await window.AMApi.requireInternalAccess();
      if (!access) {
        return;
      }

      loadTicketHistory(false);
    } catch (error) {
      showNotice("error", error.message);
    }
  }

  document.addEventListener("DOMContentLoaded", initTicketHistory);
})();

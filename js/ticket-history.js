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
  let ticketHistoryKeyword = "";
  let ticketHistorySearchTimer = null;
  let ticketHistoryRequestId = 0;

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
      "đã xong": "status-done",
      "đã trả": "status-returned",
      "huỷ": "status-cancelled"
    };

    return classes[normalized] || "";
  }

  function statusLabel(status) {
    if (status === "đã trả") {
      return "Đã hoàn thành";
    }

    if (status === "đã xong") {
      return "Legacy đã xong";
    }

    return textOrDash(status);
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

  function renderTicketHistoryRows(tickets, startIndex) {
    ticketHistory.tableBody.innerHTML = "";

    tickets.forEach((ticket, index) => {
      const row = document.createElement("tr");
      const statusCell = document.createElement("td");
      const actionCell = document.createElement("td");

      statusCell.appendChild(createStatusBadge(ticket.status));
      actionCell.appendChild(createTicketHistoryLink(ticket));

      row.append(
        createCell(String(startIndex + index + 1), "ticket-history-index"),
        createCell(formatDateTimeVN(ticket.created_at), "ticket-history-time"),
        createCell(textOrDash(ticket.ticket_code), "ticket-history-code"),
        createCell(textOrDash(ticket.customer_code), "ticket-history-customer-code"),
        createCell(textOrDash(ticket.customer_name || ticket.customer_master_name), "ticket-history-customer-name"),
        createCell(textOrDash(ticket.customer_phone || ticket.customer_master_phone)),
        createCell(textOrDash(ticket.model)),
        statusCell,
        actionCell
      );

      ticketHistory.tableBody.appendChild(row);
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

  function renderTicketHistory(tickets) {
    const total = ticketHistoryTotal;

    if (total === 0) {
      setTicketHistoryState(
        "empty",
        ticketHistoryKeyword ? "Không tìm thấy phiếu phù hợp." : "Chưa có phiếu nào."
      );
      return;
    }

    const pageCount = Math.max(1, Math.ceil(total / TICKET_HISTORY_PAGE_SIZE));
    ticketHistoryPage = Math.min(ticketHistoryPage, pageCount);

    const startIndex = (ticketHistoryPage - 1) * TICKET_HISTORY_PAGE_SIZE;
    const endIndex = Math.min(startIndex + tickets.length, total);

    renderTicketHistoryRows(tickets, startIndex);
    renderTicketHistoryPagination(pageCount);
    ticketHistory.summary.textContent = `Hiển thị ${startIndex + 1}–${endIndex} trên tổng số ${total} phiếu`;
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
      const result = await window.AMApi.getTicketReceiptHistory({
        page: ticketHistoryPage,
        pageSize: TICKET_HISTORY_PAGE_SIZE,
        keyword: ticketHistoryKeyword
      });

      if (requestId !== ticketHistoryRequestId) {
        return;
      }

      ticketHistoryTotal = result.total || 0;
      renderTicketHistory(result.tickets || []);

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
    const pageCount = Math.max(1, Math.ceil(ticketHistoryTotal / TICKET_HISTORY_PAGE_SIZE));
    ticketHistoryPage = Math.min(Math.max(page, 1), pageCount);
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

  async function initTicketHistory() {
    attachLogout();
    attachTicketHistorySearch();

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

(function () {
  "use strict";

  const PAGE_SIZE = 10;
  const SEARCH_DELAY_MS = 420;
  const TIMER_REFRESH_MS = 60000;
  const FILTERS = [
    { key: "all", label: "Tất cả" },
    { key: "under24", label: "Dưới 24 giờ" },
    { key: "warning", label: "24–48 giờ" },
    { key: "over48", label: "Quá 48 giờ" }
  ];
  const handover = {
    notice: document.getElementById("handoverNotice"),
    section: document.getElementById("handoverSection"),
    form: document.getElementById("handoverSearchForm"),
    searchInput: document.getElementById("handoverSearchInput"),
    clearButton: document.getElementById("handoverClearButton"),
    filterChips: document.getElementById("handoverFilterChips"),
    state: document.getElementById("handoverState"),
    content: document.getElementById("handoverContent"),
    listSummary: document.getElementById("handoverListSummary"),
    tableBody: document.getElementById("handoverTableBody"),
    cards: document.getElementById("handoverCards"),
    pagination: document.getElementById("handoverPagination"),
    countAll: document.getElementById("handoverCountAll"),
    countUnder24: document.getElementById("handoverCountUnder24"),
    countWarning: document.getElementById("handoverCountWarning"),
    countOver48: document.getElementById("handoverCountOver48")
  };

  let state = { page: 1, keyword: "", filter: "all" };
  let totalCount = 0;
  let filterCounts = {};
  let visibleTickets = [];
  let searchTimerId = null;
  let refreshTimerId = null;
  let loadRequestId = 0;

  function showNotice(type, message) {
    if (!handover.notice) {
      return;
    }

    handover.notice.className = `notice ${type} show`;
    handover.notice.textContent = message;
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

  function formatVietnamDateTime(value) {
    return window.AMApi.formatHandoverDateTime(value);
  }

  function handoverTiming(ticket) {
    return window.AMApi.classifyHandoverTiming(ticket);
  }

  function customerName(ticket) {
    return ticket.customer_master_name || ticket.customer_name || "";
  }

  function customerPhone(ticket) {
    return ticket.customer_master_phone || ticket.customer_phone || "";
  }

  function ticketQuery(ticket) {
    if (ticket.ticket_code) {
      return `code=${encodeURIComponent(ticket.ticket_code)}`;
    }

    return `id=${encodeURIComponent(ticket.id || "")}`;
  }

  function createLink(label, href, primary) {
    const link = document.createElement("a");
    link.className = `btn ${primary ? "primary" : "secondary"} compact handover-action`;
    link.href = href;
    link.textContent = label;
    return link;
  }

  function createActions(ticket) {
    const actions = document.createElement("div");
    const query = ticketQuery(ticket);

    actions.className = "handover-actions";
    actions.append(
      createLink("In biên nhận & hoàn tất bàn giao", `print-delivery-receipt.html?${query}`, true),
      createLink("Xem phiếu", `search.html?${query}`, false)
    );

    if (ticket.customer_id) {
      actions.appendChild(createLink(
        "Lịch sử KH",
        `search.html?customer_id=${encodeURIComponent(ticket.customer_id)}`,
        false
      ));
    }

    if (ticket.repair_started_at) {
      actions.appendChild(createLink("Chỉ in lại tem", `print-label.html?${query}`, false));
    }

    return actions;
  }

  function createBadge(ticket) {
    const info = handoverTiming(ticket);
    const badge = document.createElement("span");
    badge.className = `handover-alert handover-alert--${info.level}`;
    badge.textContent = info.badge;
    return badge;
  }

  function createCell(className, text) {
    const cell = document.createElement("td");
    if (className) {
      cell.className = className;
    }
    if (text !== undefined) {
      cell.textContent = text;
    }
    return cell;
  }

  function appendLine(parent, className, value) {
    const line = document.createElement("span");
    line.className = className;
    line.textContent = textOrDash(value);
    parent.appendChild(line);
  }

  function renderTable(tickets) {
    const fragment = document.createDocumentFragment();

    tickets.forEach((ticket) => {
      const row = document.createElement("tr");
      const alertCell = createCell();
      const codeCell = createCell("handover-code-cell");
      const customerCell = createCell("handover-customer-cell");
      const deviceCell = createCell("handover-device-cell");
      const waitCell = createCell("handover-wait-cell");
      const actionsCell = createCell("handover-action-cell");
      const timing = handoverTiming(ticket);

      row.dataset.ticketCode = ticket.ticket_code || "";
      row.className = `handover-row handover-row--${timing.level}`;
      alertCell.appendChild(createBadge(ticket));
      appendLine(codeCell, "handover-cell-strong", window.AMApi.formatTicketCode(ticket.ticket_code));
      appendLine(codeCell, "handover-cell-muted", "Bàn giao tivi");
      appendLine(customerCell, "handover-cell-strong", window.AMApi.formatCustomerCode(ticket.customer_code));
      appendLine(customerCell, "handover-cell-muted", customerName(ticket));
      appendLine(deviceCell, "handover-cell-strong", [ticket.brand, ticket.model].filter(Boolean).join(" "));
      appendLine(deviceCell, "handover-cell-muted", ticket.device_type || "Tivi");
      appendLine(waitCell, `handover-wait-text handover-wait-text--${timing.level}`, timing.text);
      actionsCell.appendChild(createActions(ticket));

      row.append(
        alertCell,
        codeCell,
        customerCell,
        createCell("handover-phone-cell", textOrDash(customerPhone(ticket))),
        deviceCell,
        createCell("handover-ready-cell", formatVietnamDateTime(ticket.ready_for_handover_at)),
        waitCell,
        createCell("handover-condition-cell", textOrDash(ticket.condition_text)),
        actionsCell
      );
      fragment.appendChild(row);
    });

    handover.tableBody.replaceChildren(fragment);
  }

  function createMeta(label, value) {
    const item = document.createElement("div");
    const key = document.createElement("span");
    const val = document.createElement("strong");
    key.textContent = label;
    val.textContent = textOrDash(value);
    item.append(key, val);
    return item;
  }

  function renderCards(tickets) {
    const fragment = document.createDocumentFragment();

    tickets.forEach((ticket) => {
      const card = document.createElement("article");
      const top = document.createElement("div");
      const title = document.createElement("div");
      const code = document.createElement("strong");
      const customer = document.createElement("span");
      const meta = document.createElement("div");
      const condition = document.createElement("p");
      const timing = handoverTiming(ticket);

      card.className = `handover-card handover-card--${timing.level}`;
      card.dataset.ticketCode = ticket.ticket_code || "";
      top.className = "handover-card-top";
      title.className = "handover-card-title";
      meta.className = "handover-card-meta";
      condition.className = "handover-card-condition";
      code.textContent = window.AMApi.formatTicketCode(ticket.ticket_code);
      customer.textContent = `${window.AMApi.formatCustomerCode(ticket.customer_code)} · ${textOrDash(customerName(ticket))}`;
      title.append(code, customer);
      top.append(title, createBadge(ticket));
      meta.append(
        createMeta("SĐT", customerPhone(ticket)),
        createMeta("Hãng / Model", [ticket.brand, ticket.model].filter(Boolean).join(" ")),
        createMeta("Sửa xong", formatVietnamDateTime(ticket.ready_for_handover_at)),
        createMeta("Thời gian chờ", timing.text)
      );
      condition.textContent = `Tình trạng: ${textOrDash(ticket.condition_text)}`;
      card.append(top, meta, condition, createActions(ticket));
      fragment.appendChild(card);
    });

    handover.cards.replaceChildren(fragment);
  }

  function setSectionState(type, message) {
    handover.state.textContent = type === "refreshing" ? "" : message;
    window.AMUI.setSectionState({
      section: handover.section,
      stateElement: handover.state,
      dataElement: handover.content
    }, type);
  }

  function updateSummaryCards(counts) {
    handover.countAll.textContent = String(counts.all || 0);
    handover.countUnder24.textContent = String(counts.under24 || 0);
    handover.countWarning.textContent = String(counts.warning || 0);
    handover.countOver48.textContent = String(counts.over48 || 0);
  }

  function renderFilterChips() {
    const fragment = document.createDocumentFragment();

    FILTERS.forEach((filter) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `handover-filter-chip ${state.filter === filter.key ? "active" : ""}`.trim();
      button.textContent = `${filter.label} (${Number(filterCounts[filter.key] || 0)})`;
      button.setAttribute("aria-pressed", String(state.filter === filter.key));
      button.addEventListener("click", () => {
        if (state.filter === filter.key) {
          return;
        }
        state.filter = filter.key;
        state.page = 1;
        updateUrl();
        loadTickets(false);
      });
      fragment.appendChild(button);
    });

    handover.filterChips.replaceChildren(fragment);
  }

  function visiblePages(totalPages) {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const pages = [1];
    const start = Math.max(2, state.page - 1);
    const end = Math.min(totalPages - 1, state.page + 1);
    if (start > 2) pages.push("start");
    for (let page = start; page <= end; page += 1) pages.push(page);
    if (end < totalPages - 1) pages.push("end");
    pages.push(totalPages);
    return pages;
  }

  function setPage(page) {
    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    state.page = Math.min(Math.max(page, 1), totalPages);
    updateUrl();
    loadTickets(true);
  }

  function renderPagination(totalPages) {
    const fragment = document.createDocumentFragment();
    handover.pagination.hidden = totalPages <= 1;
    handover.pagination.replaceChildren();

    if (totalPages <= 1) {
      return;
    }

    const previous = document.createElement("button");
    previous.type = "button";
    previous.textContent = "← Trang trước";
    previous.disabled = state.page === 1;
    previous.addEventListener("click", () => setPage(state.page - 1));
    fragment.appendChild(previous);

    visiblePages(totalPages).forEach((page) => {
      if (typeof page !== "number") {
        const ellipsis = document.createElement("span");
        ellipsis.className = "pagination-ellipsis";
        ellipsis.textContent = "...";
        fragment.appendChild(ellipsis);
        return;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.textContent = String(page);
      button.className = page === state.page ? "active" : "";
      button.setAttribute("aria-label", `Trang ${page}`);
      if (page === state.page) button.setAttribute("aria-current", "page");
      button.addEventListener("click", () => setPage(page));
      fragment.appendChild(button);
    });

    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "Trang sau →";
    next.disabled = state.page === totalPages;
    next.addEventListener("click", () => setPage(state.page + 1));
    fragment.appendChild(next);
    handover.pagination.appendChild(fragment);
  }

  function renderTickets(tickets) {
    const startIndex = (state.page - 1) * PAGE_SIZE;
    const endIndex = Math.min(startIndex + tickets.length, totalCount);
    visibleTickets = tickets.slice();

    if (totalCount === 0) {
      setSectionState("empty", state.keyword
        ? "Không tìm thấy tivi chờ bàn giao phù hợp."
        : "Hiện không có tivi chờ bàn giao.");
      renderFilterChips();
      stopTimer();
      return;
    }

    handover.listSummary.textContent = `Hiển thị ${startIndex + 1}–${endIndex} trên tổng số ${totalCount} phiếu chờ bàn giao`;
    renderTable(tickets);
    renderCards(tickets);
    renderPagination(Math.max(1, Math.ceil(totalCount / PAGE_SIZE)));
    renderFilterChips();
    setSectionState("data", "");
    startTimer();

    const requestedCode = new URLSearchParams(window.location.search).get("code");
    if (requestedCode) {
      const match = handover.section.querySelector(`[data-ticket-code="${CSS.escape(requestedCode)}"]`);
      if (match) {
        match.classList.add("handover-focus-ticket");
        match.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
          block: "center"
        });
      }
    }
  }

  function stopTimer() {
    if (refreshTimerId) {
      window.clearInterval(refreshTimerId);
      refreshTimerId = null;
    }
  }

  function startTimer() {
    stopTimer();
    if (visibleTickets.length === 0) {
      return;
    }
    refreshTimerId = window.setInterval(() => {
      renderTable(visibleTickets);
      renderCards(visibleTickets);
    }, TIMER_REFRESH_MS);
  }

  async function loadTickets(shouldScroll) {
    const requestId = ++loadRequestId;
    const hasData = !handover.content.hidden && visibleTickets.length > 0;
    setSectionState(hasData ? "refreshing" : "loading", "Đang tải danh sách bàn giao tivi...");

    try {
      const result = await window.AMApi.getHandoverTickets({
        page: state.page,
        pageSize: PAGE_SIZE,
        keyword: state.keyword,
        filter: state.filter
      });

      if (requestId !== loadRequestId) {
        return;
      }

      if (!result.available) {
        filterCounts = result.filterCounts || {};
        totalCount = 0;
        updateSummaryCards(filterCounts);
        renderFilterChips();
        setSectionState("info", result.message || "Khu Bàn giao tivi chưa được kích hoạt.");
        return;
      }

      totalCount = result.totalCount || 0;
      filterCounts = result.filterCounts || {};
      updateSummaryCards(filterCounts);

      if (totalCount > 0 && state.page > result.totalPages) {
        state.page = result.totalPages;
        updateUrl();
        loadTickets(shouldScroll);
        return;
      }

      renderTickets(result.tickets || []);
      if (shouldScroll) {
        handover.section.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
          block: "start"
        });
      }
    } catch (error) {
      if (requestId !== loadRequestId) {
        return;
      }
      setSectionState("error", "Không thể tải danh sách bàn giao tivi. Vui lòng thử lại.");
    }
  }

  function readUrl() {
    const params = new URLSearchParams(window.location.search);
    const page = Number.parseInt(params.get("page") || "1", 10);
    const code = String(params.get("code") || "").trim();
    const keyword = String(params.get("q") || code).trim();
    const filter = String(params.get("filter") || "all");
    state = {
      page: Number.isFinite(page) && page > 0 ? page : 1,
      keyword,
      filter: FILTERS.some((item) => item.key === filter) ? filter : "all"
    };
    handover.searchInput.value = keyword;
  }

  function updateUrl() {
    const params = new URLSearchParams();
    if (state.keyword) params.set("q", state.keyword);
    if (state.filter !== "all") params.set("filter", state.filter);
    if (state.page > 1) params.set("page", String(state.page));
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }

  function runSearch() {
    if (searchTimerId) {
      window.clearTimeout(searchTimerId);
      searchTimerId = null;
    }
    const keyword = handover.searchInput.value.trim();
    if (keyword === state.keyword && state.page === 1) {
      return;
    }
    state.keyword = keyword;
    state.page = 1;
    updateUrl();
    loadTickets(false);
  }

  function scheduleSearch() {
    if (searchTimerId) window.clearTimeout(searchTimerId);
    searchTimerId = window.setTimeout(runSearch, SEARCH_DELAY_MS);
  }

  function attachControls() {
    handover.form.addEventListener("submit", (event) => {
      event.preventDefault();
      runSearch();
    });
    handover.searchInput.addEventListener("input", scheduleSearch);
    handover.clearButton.addEventListener("click", () => {
      handover.searchInput.value = "";
      runSearch();
    });
    window.addEventListener("pagehide", stopTimer, { once: true });
  }

  async function init() {
    attachLogout();
    attachControls();
    readUrl();

    try {
      const access = await window.AMApi.requireInternalAccess();
      if (!access) {
        return;
      }
      await loadTickets(false);
    } catch (error) {
      showNotice("error", error.message);
      setSectionState("error", "Không thể mở trang Bàn giao tivi.");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();

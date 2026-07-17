(function () {
  "use strict";

  const notice = document.getElementById("repairingNotice");
  const repairing = {
    section: document.getElementById("repairingSection"),
    form: document.getElementById("repairingSearchForm"),
    searchInput: document.getElementById("repairingSearchInput"),
    searchButton: document.getElementById("repairingSearchButton"),
    clearButton: document.getElementById("repairingClearButton"),
    sortSelect: document.getElementById("repairingSortSelect"),
    filterChips: document.getElementById("repairingFilterChips"),
    summaryMain: document.getElementById("repairingSummaryMain"),
    summaryOverdue: document.getElementById("repairingSummaryOverdue"),
    state: document.getElementById("repairingState"),
    content: document.getElementById("repairingContent"),
    listSummary: document.getElementById("repairingListSummary"),
    tableBody: document.getElementById("repairingTableBody"),
    cards: document.getElementById("repairingCards"),
    pagination: document.getElementById("repairingPagination")
  };

  const PAGE_SIZE = 15;
  const SEARCH_DELAY = 420;
  const DEFAULT_STATE = {
    page: 1,
    keyword: "",
    filter: "all",
    sort: "priority"
  };
  const FILTERS = [
    { key: "all", label: "Tất cả" },
    { key: "under48", label: "Dưới 48 giờ" },
    { key: "over48", label: "Quá 48 giờ" },
    { key: "over72", label: "Quá 72 giờ" },
    { key: "missing-start", label: "Thiếu mốc bắt đầu" }
  ];
  const SORTS = new Set(["priority", "oldest-repair", "newest-repair", "newest-received"]);

  let state = Object.assign({}, DEFAULT_STATE);
  let totalCount = 0;
  let filterCounts = {};
  let searchTimer = null;
  let requestId = 0;

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

  function compactText(values) {
    return values
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" ");
  }

  function customerName(ticket) {
    return ticket.customer_master_name || ticket.customer_name || "";
  }

  function customerPhone(ticket) {
    return ticket.customer_master_phone || ticket.customer_phone || "";
  }

  function parseTime(value) {
    if (!value) {
      return 0;
    }

    const time = Date.parse(value);
    return Number.isFinite(time) ? time : 0;
  }

  function formatDateOnly(value) {
    const text = String(value || "").trim();

    if (!text) {
      return "Chưa có";
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const [year, month, day] = text.split("-");
      return `${day}/${month}/${year}`;
    }

    const date = new Date(text);

    if (Number.isNaN(date.getTime())) {
      return text;
    }

    return new Intl.DateTimeFormat("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(date);
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

  function repairDurationInfo(ticket) {
    const startedAt = parseTime(ticket.repair_started_at);

    if (!startedAt) {
      return {
        level: "unknown",
        rank: 4,
        label: "Chưa có thời điểm bắt đầu sửa",
        detail: "Cần kiểm tra dữ liệu workflow"
      };
    }

    const elapsed = Math.max(0, Date.now() - startedAt);
    const hours = elapsed / 3600000;

    if (hours >= 72) {
      return {
        level: "danger",
        rank: 1,
        label: "Ưu tiên cao — quá 72 giờ",
        detail: elapsedParts(elapsed)
      };
    }

    if (hours >= 48) {
      return {
        level: "warning",
        rank: 2,
        label: "Quá 48 giờ",
        detail: elapsedParts(elapsed)
      };
    }

    return {
      level: "normal",
      rank: 3,
      label: "Đang sửa",
      detail: elapsedParts(elapsed)
    };
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

  function createStatusBadge(status) {
    const badge = document.createElement("span");
    badge.className = `status-pill ${statusClass(status)}`.trim();
    badge.textContent = textOrDash(status);
    return badge;
  }

  function createDurationBadge(ticket) {
    const info = repairDurationInfo(ticket);
    const badge = document.createElement("span");
    badge.className = `repair-duration repair-duration--${info.level}`;
    badge.textContent = info.label;
    return badge;
  }

  function ticketQuery(ticket) {
    if (ticket.ticket_code) {
      return `code=${encodeURIComponent(ticket.ticket_code)}`;
    }

    if (ticket.id) {
      return `id=${encodeURIComponent(ticket.id)}`;
    }

    return "";
  }

  function createActionLink(label, href, primary) {
    const link = document.createElement("a");
    link.className = `btn ${primary ? "primary" : "secondary"} compact repairing-action`;
    link.href = href;
    link.textContent = label;
    return link;
  }

  function createActions(ticket) {
    const actions = document.createElement("div");
    const query = ticketQuery(ticket);
    const suffix = query ? `?${query}` : "";

    actions.className = "repairing-actions";
    actions.append(
      createActionLink("Xem phiếu", `search.html${suffix}`, false),
      createActionLink("Mở Hoạt động phiếu", `ticket-activity.html${suffix}`, false),
      createActionLink("Chỉ in lại tem", `print-label.html${suffix}`, false),
      createActionLink("In biên nhận & hoàn thành phiếu", `print-delivery-receipt.html${suffix}`, true)
    );
    return actions;
  }

  function createCell(className) {
    const cell = document.createElement("td");

    if (className) {
      cell.className = className;
    }

    return cell;
  }

  function appendTextLine(parent, className, text) {
    const line = document.createElement("span");
    line.className = className;
    line.textContent = text;
    parent.appendChild(line);
    return line;
  }

  function createTicketCell(ticket) {
    const cell = createCell("repairing-ticket-code");
    appendTextLine(cell, "repairing-cell-strong", textOrDash(ticket.ticket_code));
    cell.appendChild(createStatusBadge(ticket.status));
    return cell;
  }

  function createCustomerCell(ticket) {
    const cell = createCell("repairing-customer-cell");
    appendTextLine(cell, "repairing-cell-strong", textOrDash(ticket.customer_code));
    appendTextLine(cell, "repairing-cell-muted", textOrDash(customerName(ticket)));
    return cell;
  }

  function createDeviceCell(ticket) {
    const cell = createCell("repairing-device-cell");
    const device = textOrDash(ticket.device_type || "Tivi");
    const brandModel = compactText([ticket.brand, ticket.model]);
    const sizeSerial = [
      String(ticket.size || "").trim() ? `Size: ${ticket.size}` : "",
      String(ticket.serial_number || "").trim() ? `Serial: ${ticket.serial_number}` : ""
    ].filter(Boolean).join(" · ");

    appendTextLine(cell, "repairing-cell-strong", device);
    appendTextLine(cell, "repairing-cell-muted", brandModel || "Chưa có model");

    if (sizeSerial) {
      appendTextLine(cell, "repairing-cell-subtle", sizeSerial);
    }

    return cell;
  }

  function createElapsedCell(ticket) {
    const info = repairDurationInfo(ticket);
    const cell = createCell(`repairing-elapsed repair-duration--${info.level}`);
    appendTextLine(cell, "repairing-cell-strong", info.detail);
    appendTextLine(cell, "repairing-cell-muted", info.label);
    return cell;
  }

  function createConditionDetails(ticket) {
    const details = [
      ["Tình trạng khách báo", ticket.condition_text],
      ["Ngoại quan", ticket.external_condition],
      ["Ghi chú nội bộ", ticket.internal_note]
    ].filter(([, value]) => String(value || "").trim());
    const box = document.createElement("div");

    box.className = "repairing-condition-details";
    box.hidden = true;

    details.forEach(([label, value]) => {
      const item = document.createElement("p");
      const key = document.createElement("strong");
      const val = document.createElement("span");

      key.textContent = `${label}: `;
      val.textContent = value;
      item.append(key, val);
      box.appendChild(item);
    });

    return { box, hasDetails: details.length > 1 || String(ticket.condition_text || "").length > 90 };
  }

  function createConditionCell(ticket) {
    const cell = createCell("repairing-condition-cell");
    const preview = document.createElement("div");
    const toggle = document.createElement("button");
    const details = createConditionDetails(ticket);

    preview.className = "repairing-condition-preview";
    preview.textContent = textOrDash(ticket.condition_text);
    cell.appendChild(preview);

    if (details.hasDetails) {
      toggle.type = "button";
      toggle.className = "repairing-condition-toggle";
      toggle.textContent = "Xem thêm";
      toggle.addEventListener("click", () => {
        const expanded = !details.box.hidden;
        details.box.hidden = expanded;
        preview.classList.toggle("is-expanded", !expanded);
        toggle.textContent = expanded ? "Xem thêm" : "Thu gọn";
      });
      cell.append(toggle, details.box);
    }

    return cell;
  }

  function renderTableRows(tickets) {
    const fragment = document.createDocumentFragment();

    tickets.forEach((ticket) => {
      const row = document.createElement("tr");
      const priorityCell = createCell();
      const phoneCell = createCell("repairing-phone-cell");
      const dateCell = createCell();
      const actionsCell = createCell("repairing-action-cell");

      priorityCell.appendChild(createDurationBadge(ticket));
      phoneCell.textContent = textOrDash(customerPhone(ticket));
      dateCell.textContent = formatDateOnly(ticket.received_date);
      actionsCell.appendChild(createActions(ticket));

      row.append(
        priorityCell,
        createTicketCell(ticket),
        createCustomerCell(ticket),
        phoneCell,
        createDeviceCell(ticket),
        dateCell,
        createElapsedCell(ticket),
        createConditionCell(ticket),
        actionsCell
      );
      fragment.appendChild(row);
    });

    repairing.tableBody.replaceChildren(fragment);
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
      const info = repairDurationInfo(ticket);

      card.className = "repairing-ticket-card";
      top.className = "repairing-card-top";
      title.className = "repairing-card-title";
      meta.className = "repairing-card-meta";
      condition.className = "repairing-card-condition";

      code.textContent = textOrDash(ticket.ticket_code);
      customer.textContent = `${textOrDash(ticket.customer_code)} · ${textOrDash(customerName(ticket))}`;
      condition.textContent = textOrDash(ticket.condition_text);
      title.append(code, customer);
      top.append(title, createDurationBadge(ticket));
      meta.append(
        createMeta("SĐT", customerPhone(ticket)),
        createMeta("Thiết bị", compactText([ticket.device_type || "Tivi", ticket.brand, ticket.model])),
        createMeta("Ngày nhận", formatDateOnly(ticket.received_date)),
        createMeta("Thời gian sửa", `${info.detail} · ${info.label}`)
      );
      card.append(top, meta, condition, createActions(ticket));
      fragment.appendChild(card);
    });

    repairing.cards.replaceChildren(fragment);
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

  function setPage(page) {
    const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    state.page = Math.min(Math.max(page, 1), pageCount);
    updateUrl();
    loadRepairingTickets(true);
  }

  function renderPagination(pageCount) {
    const nav = repairing.pagination;

    nav.replaceChildren();

    if (pageCount <= 1) {
      nav.hidden = true;
      return;
    }

    nav.hidden = false;

    const previous = document.createElement("button");
    previous.type = "button";
    previous.textContent = "← Trang trước";
    previous.disabled = state.page === 1;
    previous.addEventListener("click", () => setPage(state.page - 1));
    nav.appendChild(previous);

    getVisiblePages(pageCount, state.page).forEach((page) => {
      if (typeof page !== "number") {
        const ellipsis = document.createElement("span");
        ellipsis.className = "pagination-ellipsis";
        ellipsis.textContent = "...";
        nav.appendChild(ellipsis);
        return;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.textContent = String(page);
      button.className = page === state.page ? "active" : "";
      button.setAttribute("aria-label", `Trang ${page}`);

      if (page === state.page) {
        button.setAttribute("aria-current", "page");
      }

      button.addEventListener("click", () => setPage(page));
      nav.appendChild(button);
    });

    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "Trang sau →";
    next.disabled = state.page === pageCount;
    next.addEventListener("click", () => setPage(state.page + 1));
    nav.appendChild(next);
  }

  function renderFilterChips() {
    const fragment = document.createDocumentFragment();

    FILTERS.forEach((filter) => {
      const button = document.createElement("button");
      const count = Number(filterCounts[filter.key] || 0);

      button.type = "button";
      button.className = `repairing-filter-chip ${state.filter === filter.key ? "active" : ""}`.trim();
      button.textContent = `${filter.label} (${count})`;
      button.setAttribute("aria-pressed", state.filter === filter.key ? "true" : "false");
      button.addEventListener("click", () => {
        if (state.filter === filter.key) {
          return;
        }

        state.filter = filter.key;
        state.page = 1;
        updateUrl();
        loadRepairingTickets(false);
      });
      fragment.appendChild(button);
    });

    repairing.filterChips.replaceChildren(fragment);
  }

  function setRepairingState(type, message) {
    repairing.state.textContent = type === "refreshing" ? "" : message;
    window.AMUI.setSectionState({
      section: repairing.section,
      stateElement: repairing.state,
      dataElement: repairing.content
    }, type);
  }

  function showRepairingContent() {
    setRepairingState("data", "");
  }

  function updateSummary(counts) {
    const allCount = Number(counts.all || totalCount || 0);
    const overdueCount = Number(counts.over48 || 0);

    repairing.summaryMain.textContent = `Hiện có ${allCount} phiếu đang sửa chữa.`;
    repairing.summaryOverdue.textContent = overdueCount > 0
      ? `Trong đó có ${overdueCount} phiếu đã sửa quá 48 giờ.`
      : "Chưa có phiếu sửa quá 48 giờ.";
  }

  function renderRepairingList(tickets) {
    const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    const startIndex = (state.page - 1) * PAGE_SIZE;
    const endIndex = Math.min(startIndex + tickets.length, totalCount);

    if (totalCount === 0) {
      setRepairingState(
        "empty",
        state.keyword ? "Không tìm thấy phiếu đang sửa chữa phù hợp." : "Chưa có phiếu đang sửa chữa."
      );
      renderFilterChips();
      return;
    }

    repairing.listSummary.textContent = `Hiển thị ${startIndex + 1}–${endIndex} trên tổng số ${totalCount} phiếu đang sửa`;
    renderTableRows(tickets);
    renderCards(tickets);
    renderPagination(pageCount);
    renderFilterChips();
    showRepairingContent();
  }

  function scrollToListTop() {
    if (!repairing.section) {
      return;
    }

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    repairing.section.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "start"
    });
  }

  async function loadRepairingTickets(shouldScroll) {
    const currentRequest = requestId + 1;
    requestId = currentRequest;
    const hasRenderedData = !repairing.content.hidden && repairing.tableBody.childElementCount > 0;
    setRepairingState(
      hasRenderedData ? "refreshing" : "loading",
      hasRenderedData ? "Đang cập nhật danh sách phiếu đang sửa chữa..." : "Đang tải danh sách phiếu đang sửa chữa..."
    );

    try {
      const result = await window.AMApi.getRepairingTickets({
        page: state.page,
        pageSize: PAGE_SIZE,
        keyword: state.keyword,
        filter: state.filter,
        sort: state.sort
      });

      if (currentRequest !== requestId) {
        return;
      }

      totalCount = result.totalCount || 0;
      filterCounts = result.filterCounts || {};
      updateSummary(filterCounts);

      if (totalCount > 0 && state.page > result.totalPages) {
        state.page = result.totalPages;
        updateUrl();
        loadRepairingTickets(shouldScroll);
        return;
      }

      renderRepairingList(result.tickets || []);

      if (shouldScroll) {
        scrollToListTop();
      }
    } catch (error) {
      if (currentRequest !== requestId) {
        return;
      }

      setRepairingState("error", "Không tải được danh sách phiếu đang sửa chữa. Vui lòng thử lại.");
    }
  }

  function normalizePage(value) {
    const page = Number.parseInt(value || "1", 10);
    return Number.isFinite(page) && page > 0 ? page : 1;
  }

  function normalizeFilter(value) {
    return FILTERS.some((filter) => filter.key === value) ? value : DEFAULT_STATE.filter;
  }

  function normalizeSort(value) {
    return SORTS.has(value) ? value : DEFAULT_STATE.sort;
  }

  function readStateFromUrl() {
    const params = new URLSearchParams(window.location.search);

    state = {
      page: normalizePage(params.get("page")),
      keyword: String(params.get("q") || "").trim(),
      filter: normalizeFilter(params.get("filter")),
      sort: normalizeSort(params.get("sort"))
    };

    repairing.searchInput.value = state.keyword;
    repairing.sortSelect.value = state.sort;
  }

  function updateUrl() {
    const params = new URLSearchParams();

    if (state.keyword) {
      params.set("q", state.keyword);
    }

    if (state.filter !== DEFAULT_STATE.filter) {
      params.set("filter", state.filter);
    }

    if (state.sort !== DEFAULT_STATE.sort) {
      params.set("sort", state.sort);
    }

    if (state.page > 1) {
      params.set("page", String(state.page));
    }

    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
    window.history.replaceState(null, "", nextUrl);
  }

  function runSearchNow() {
    if (searchTimer) {
      window.clearTimeout(searchTimer);
      searchTimer = null;
    }

    const keyword = repairing.searchInput.value.trim();

    if (keyword === state.keyword && state.page === 1) {
      return;
    }

    state.keyword = keyword;
    state.page = 1;
    updateUrl();
    loadRepairingTickets(false);
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

    repairing.searchInput.value = "";
    state.keyword = "";
    state.page = 1;
    updateUrl();
    loadRepairingTickets(false);
  }

  function attachControls() {
    repairing.form.addEventListener("submit", (event) => {
      event.preventDefault();
      runSearchNow();
    });
    repairing.searchInput.addEventListener("input", scheduleSearch);
    repairing.clearButton.addEventListener("click", clearSearch);
    repairing.sortSelect.addEventListener("change", () => {
      state.sort = normalizeSort(repairing.sortSelect.value);
      state.page = 1;
      updateUrl();
      loadRepairingTickets(false);
    });
  }

  async function initRepairingTickets() {
    attachLogout();
    attachControls();
    readStateFromUrl();

    try {
      const access = await window.AMApi.requireInternalAccess();

      if (!access) {
        return;
      }

      await loadRepairingTickets(false);
    } catch (error) {
      showNotice("error", error.message);
      setRepairingState("error", "Không tải được trang phiếu đang sửa chữa.");
    }
  }

  document.addEventListener("DOMContentLoaded", initRepairingTickets);
})();

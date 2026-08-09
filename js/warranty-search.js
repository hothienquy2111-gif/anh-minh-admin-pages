(function () {
  "use strict";

  const notice = document.getElementById("warrantyNotice");
  const form = document.getElementById("warrantySearchForm");
  const input = document.getElementById("warrantySearchInput");
  const searchButton = document.getElementById("warrantySearchButton");
  const clearButton = document.getElementById("warrantySearchClear");
  const resetButton = document.getElementById("warrantyResetButton");
  const toolbar = document.getElementById("warrantyToolbar");
  const filterChips = document.getElementById("warrantyFilterChips");
  const sortSelect = document.getElementById("warrantySortSelect");
  const state = document.getElementById("warrantyState");
  const resultsWrap = document.getElementById("warrantyResults");
  const summary = document.getElementById("warrantySummary");
  const cards = document.getElementById("warrantyCards");
  const pagination = document.getElementById("warrantyPagination");
  const suggestions = document.getElementById("warrantySearchSuggestions");

  const PAGE_SIZE = 10;
  const SUGGESTION_MIN_LENGTH = 2;
  const SUGGESTION_DEBOUNCE_MS = 280;
  const WARRANTY_EXPIRING_DAYS = 15;
  const FILTERS = [
    { key: "all", label: "Tất cả" },
    { key: "active", label: "Còn bảo hành" },
    { key: "expiring", label: "Sắp hết hạn" },
    { key: "expired", label: "Đã hết bảo hành" },
    { key: "none", label: "Không bảo hành" },
    { key: "no-info", label: "Chưa có thông tin" }
  ];
  const WARRANTY_MODE_LABELS = {
    MANUAL_DATE_RANGE: "Bảo hành theo ngày nhập tay",
    AUTO_MONTHS: "Bảo hành theo số tháng",
    NONE: "Không bảo hành"
  };

  let searchQuery = "";
  let currentPage = 1;
  let activeWarrantyFilter = "all";
  let sortMode = "newest";
  let activeRequestId = 0;
  let suggestionTimer = 0;
  let suggestionRequestId = 0;
  let suggestionItems = [];
  let activeSuggestionIndex = -1;
  let isLoading = false;
  let lastResult = null;
  const expandedWarrantyIds = new Set();
  let warrantyFallbackId = 0;

  function showNotice(type, message) {
    if (!notice) {
      return;
    }

    notice.className = `notice ${type} show`;
    notice.textContent = message;
  }

  function clearNotice() {
    if (!notice) {
      return;
    }

    notice.className = "notice";
    notice.textContent = "";
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

  function firstText() {
    return Array.from(arguments).find((value) => String(value || "").trim()) || "";
  }

  function createEl(tagName, className, text) {
    const element = document.createElement(tagName);

    if (className) {
      element.className = className;
    }

    if (text !== undefined) {
      element.textContent = text;
    }

    return element;
  }

  function formatDate(value) {
    const text = String(value || "").trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return text || "Chưa có";
    }

    const parts = text.split("-");
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  function todayVietnamYmd() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    const values = {};

    parts.forEach((part) => {
      if (part.type !== "literal") {
        values[part.type] = part.value;
      }
    });

    return `${values.year}-${values.month}-${values.day}`;
  }

  function dateOrdinal(ymd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ""))) {
      return null;
    }

    const parts = ymd.split("-").map((part) => Number.parseInt(part, 10));
    return Math.floor(Date.UTC(parts[0], parts[1] - 1, parts[2]) / 86400000);
  }

  function maskPhone(value) {
    const raw = String(value || "").trim();
    const digits = raw.replace(/\D/g, "");

    if (digits.length >= 7) {
      return `${digits.slice(0, 4)}•••${digits.slice(-3)}`;
    }

    return raw ? "•••" : "—";
  }

  function customerName(ticket) {
    return firstText(ticket.customer_master_name, ticket.customer_name);
  }

  function customerPhone(ticket) {
    return firstText(ticket.customer_master_phone, ticket.customer_phone);
  }

  function customerCode(ticket) {
    return window.AMApi.formatCustomerCode(ticket.customer_code);
  }

  function statusLabel(status) {
    return window.AMApi.formatTicketStatusLabel(status, "—");
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

  function warrantyModeLabel(mode) {
    return WARRANTY_MODE_LABELS[mode] || "Chưa có thông tin";
  }

  function warrantyStatus(ticket) {
    const mode = String(ticket.warranty_mode || "").toUpperCase();
    const endOrdinal = dateOrdinal(ticket.warranty_end_date);
    const todayOrdinal = dateOrdinal(todayVietnamYmd());

    if (!mode) {
      return {
        category: "no-info",
        label: "CHƯA CÓ THÔNG TIN",
        detail: "Phiếu chưa lưu dữ liệu bảo hành.",
        className: "warranty-status--neutral"
      };
    }

    if (mode === "NONE") {
      return {
        category: "none",
        label: "KHÔNG BẢO HÀNH",
        detail: "Phiếu được lưu với chế độ không bảo hành.",
        className: "warranty-status--neutral"
      };
    }

    if (endOrdinal === null || todayOrdinal === null) {
      return {
        category: "no-info",
        label: "CHƯA CÓ THÔNG TIN",
        detail: "Thiếu ngày hết hạn bảo hành.",
        className: "warranty-status--neutral"
      };
    }

    const remainingDays = endOrdinal - todayOrdinal;

    if (remainingDays < 0) {
      return {
        category: "expired",
        label: "ĐÃ HẾT BẢO HÀNH",
        detail: `Đã hết ${Math.abs(remainingDays)} ngày`,
        className: "warranty-status--expired"
      };
    }

    if (remainingDays === 0) {
      return {
        category: "expiring",
        label: "HẾT HẠN HÔM NAY",
        detail: "Hết hạn hôm nay",
        className: "warranty-status--expiring"
      };
    }

    if (remainingDays <= WARRANTY_EXPIRING_DAYS) {
      return {
        category: "expiring",
        label: "SẮP HẾT HẠN",
        detail: `Còn ${remainingDays} ngày`,
        className: "warranty-status--expiring"
      };
    }

    return {
      category: "active",
      label: "CÒN BẢO HÀNH",
      detail: `Còn ${remainingDays} ngày`,
      className: "warranty-status--active"
    };
  }

  function joinVisibleParts() {
    return Array.from(arguments)
      .map((value) => String(value || "").trim())
      .filter((value) => value && value !== "—")
      .join(" · ");
  }

  function clearSuggestionTimer() {
    if (suggestionTimer) {
      window.clearTimeout(suggestionTimer);
      suggestionTimer = 0;
    }
  }

  function setSuggestionExpanded(expanded) {
    if (input) {
      input.setAttribute("aria-expanded", expanded ? "true" : "false");
    }
  }

  function closeSuggestions() {
    clearSuggestionTimer();
    suggestionRequestId += 1;
    suggestionItems = [];
    activeSuggestionIndex = -1;

    if (input) {
      input.removeAttribute("aria-activedescendant");
      setSuggestionExpanded(false);
    }

    if (suggestions) {
      suggestions.hidden = true;
      suggestions.replaceChildren();
    }
  }

  function renderSuggestionMessage(message, stateClass) {
    if (!suggestions) {
      return;
    }

    const item = createEl("div", `warranty-suggestion-message ${stateClass || ""}`.trim(), message);
    suggestionItems = [];
    activeSuggestionIndex = -1;
    input.removeAttribute("aria-activedescendant");
    suggestions.replaceChildren(item);
    suggestions.hidden = false;
    setSuggestionExpanded(true);
  }

  function setActiveSuggestion(index) {
    if (!suggestions || suggestionItems.length === 0) {
      activeSuggestionIndex = -1;
      input.removeAttribute("aria-activedescendant");
      return;
    }

    const nextIndex = Math.max(0, Math.min(index, suggestionItems.length - 1));
    activeSuggestionIndex = nextIndex;

    suggestions.querySelectorAll("[role='option']").forEach((option, optionIndex) => {
      const active = optionIndex === activeSuggestionIndex;
      option.classList.toggle("active", active);
      option.setAttribute("aria-selected", active ? "true" : "false");

      if (active) {
        input.setAttribute("aria-activedescendant", option.id);
      }
    });
  }

  function createSuggestionOption(ticket, index) {
    const option = document.createElement("button");
    const main = createEl("span", "warranty-suggestion-main");
    const sub = createEl("span", "warranty-suggestion-sub");
    const ticketCode = window.AMApi.formatTicketCode(ticket.ticket_code);
    const name = customerName(ticket);
    const device = joinVisibleParts(ticket.brand, ticket.model);
    const phone = maskPhone(customerPhone(ticket));
    const status = warrantyStatus(ticket);

    option.type = "button";
    option.id = `warrantySuggestionOption${index}`;
    option.className = "warranty-suggestion-option";
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", "false");
    option.dataset.index = String(index);

    main.textContent = joinVisibleParts(ticketCode, name) || ticketCode;
    sub.textContent = joinVisibleParts(phone, device, status.label);
    option.append(main, sub);

    option.addEventListener("mousedown", function (event) {
      event.preventDefault();
    });

    option.addEventListener("click", function () {
      selectSuggestion(ticket);
    });

    return option;
  }

  function renderSuggestions(records) {
    if (!suggestions) {
      return;
    }

    suggestionItems = (records || []).slice(0, 2);
    activeSuggestionIndex = -1;
    input.removeAttribute("aria-activedescendant");

    if (suggestionItems.length === 0) {
      renderSuggestionMessage("Không có gợi ý phù hợp.", "empty");
      return;
    }

    const fragment = document.createDocumentFragment();
    suggestionItems.forEach((ticket, index) => {
      fragment.appendChild(createSuggestionOption(ticket, index));
    });

    suggestions.replaceChildren(fragment);
    suggestions.hidden = false;
    setSuggestionExpanded(true);
  }

  async function fetchSuggestions() {
    const query = input.value.trim();

    if (query.length < SUGGESTION_MIN_LENGTH) {
      closeSuggestions();
      return;
    }

    const requestId = suggestionRequestId + 1;
    suggestionRequestId = requestId;
    renderSuggestionMessage("Đang tìm gợi ý…", "loading");

    try {
      const records = await window.AMApi.getWarrantySearchSuggestions(query, 2);

      if (requestId !== suggestionRequestId || query !== input.value.trim()) {
        return;
      }

      renderSuggestions(records);
    } catch (error) {
      if (requestId !== suggestionRequestId) {
        return;
      }

      closeSuggestions();
    }
  }

  function scheduleSuggestions() {
    const query = input.value.trim();

    clearSuggestionTimer();

    if (query.length < SUGGESTION_MIN_LENGTH) {
      closeSuggestions();
      return;
    }

    suggestionTimer = window.setTimeout(fetchSuggestions, SUGGESTION_DEBOUNCE_MS);
  }

  function selectSuggestion(ticket) {
    const value = window.AMApi.formatTicketCode(ticket && ticket.ticket_code) !== "—"
      ? window.AMApi.formatTicketCode(ticket.ticket_code)
      : input.value.trim();

    if (!value) {
      return;
    }

    input.value = value;
    clearButton.hidden = false;
    closeSuggestions();
    searchQuery = value;
    currentPage = 1;
    activeWarrantyFilter = "all";
    loadWarrantyRecords({ scroll: false });
  }

  function filterLabel(key) {
    const found = FILTERS.find((filter) => filter.key === key);
    return found ? found.label : "Tất cả";
  }

  function visiblePageNumbers(pageCount, page) {
    if (pageCount <= 7) {
      return Array.from({ length: pageCount }, (_, index) => index + 1);
    }

    const pages = [1];
    const start = Math.max(2, page - 1);
    const end = Math.min(pageCount - 1, page + 1);

    if (start > 2) {
      pages.push("start-ellipsis");
    }

    for (let item = start; item <= end; item += 1) {
      pages.push(item);
    }

    if (end < pageCount - 1) {
      pages.push("end-ellipsis");
    }

    pages.push(pageCount);
    return pages;
  }

  function setControlsLoading(loading) {
    isLoading = loading;
    const resultsSection = resultsWrap ? resultsWrap.closest("section") : null;
    if (resultsSection) {
      resultsSection.setAttribute("aria-busy", String(loading));
    }

    if (searchButton) {
      searchButton.disabled = loading;
      searchButton.textContent = loading ? "Đang tải..." : "Tra cứu";
    }

    if (resetButton) {
      resetButton.disabled = loading;
    }

    if (clearButton) {
      clearButton.disabled = loading;
    }

    if (sortSelect) {
      sortSelect.disabled = loading;
    }

    if (filterChips) {
      filterChips.querySelectorAll("button").forEach((button) => {
        button.disabled = loading;
      });
    }

    if (pagination) {
      pagination.querySelectorAll("button").forEach((button) => {
        button.disabled = loading || button.dataset.disabled === "true";
      });
    }
  }

  function setState(type, message) {
    if (!state || !resultsWrap) {
      return;
    }

    const keepsDataVisible = type === "data" || type === "refreshing";
    state.textContent = keepsDataVisible ? "" : message;
    window.AMUI.setSectionState({
      section: resultsWrap.closest("section"),
      stateElement: state,
      dataElement: resultsWrap
    }, type);

    if (toolbar && !keepsDataVisible) {
      toolbar.hidden = true;
    }

    if (pagination && !keepsDataVisible) {
      pagination.hidden = true;
      pagination.replaceChildren();
    }

    if (cards && !keepsDataVisible) {
      cards.replaceChildren();
    }
  }

  function renderFilterChips(filterCounts) {
    if (!filterChips) {
      return;
    }

    const counts = filterCounts || {};
    const fragment = document.createDocumentFragment();

    FILTERS.forEach((filter) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = filter.key === activeWarrantyFilter ? "warranty-filter-chip active" : "warranty-filter-chip";
      button.textContent = `${filter.label} (${counts[filter.key] || 0})`;
      button.dataset.filter = filter.key;

      if (filter.key === activeWarrantyFilter) {
        button.setAttribute("aria-current", "true");
      }

      fragment.appendChild(button);
    });

    filterChips.replaceChildren(fragment);
  }

  function createMeta(label, value) {
    const item = createEl("div", "warranty-meta-item");
    const key = createEl("span", "", label);
    const val = createEl("strong", "", textOrDash(value));

    item.append(key, val);
    return item;
  }

  function createBadge(text, className) {
    return createEl("span", className, text);
  }

  function createActionLink(text, href, primary) {
    const link = document.createElement("a");
    link.className = `btn ${primary ? "primary" : "secondary"} compact`;
    link.textContent = text;
    link.href = href;
    return link;
  }

  function createChevronIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    svg.classList.add("warranty-summary-chevron");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    path.setAttribute("d", "m3.5 6 4.5 4 4.5-4");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.8");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
    return svg;
  }

  function warrantyIdentity(ticket) {
    const stableId = String(ticket.id || ticket.ticket_code || "").trim();
    if (stableId) {
      return stableId;
    }

    warrantyFallbackId += 1;
    return `warranty-card-${warrantyFallbackId}`;
  }

  function warrantyDetailsId(identity) {
    const safeIdentity = String(identity).replace(/[^A-Za-z0-9_-]/g, "-");
    return `warranty-details-${safeIdentity}`;
  }

  function warrantySummaryText(ticket, status) {
    const mode = String(ticket.warranty_mode || "").toUpperCase();
    if (mode === "NONE") {
      return "Không bảo hành · Phiếu không áp dụng bảo hành";
    }

    const period = ticket.warranty_months
      ? `${ticket.warranty_months} tháng`
      : warrantyModeLabel(ticket.warranty_mode);
    const dateRange = `${formatDate(ticket.warranty_start_date)} → ${formatDate(ticket.warranty_end_date)}`;
    return joinVisibleParts(period, dateRange, status.category === "no-info" ? status.detail : "");
  }

  function createWarrantyDisclosure(ticket, status) {
    const identity = warrantyIdentity(ticket);
    const detailsId = warrantyDetailsId(identity);
    const expanded = expandedWarrantyIds.has(identity);
    const section = createEl("section", expanded ? "warranty-disclosure is-expanded" : "warranty-disclosure");
    const toggle = createEl("button", "warranty-summary-toggle");
    const copy = createEl("span", "warranty-summary-copy");
    const eyebrow = createEl("span", "warranty-summary-label", "Bảo hành");
    const summaryText = createEl("span", "warranty-summary-text", warrantySummaryText(ticket, status));
    const controls = createEl("span", `warranty-summary-controls ${status.className}`);
    const badge = createEl("span", "warranty-summary-status", status.label);
    const chevron = createChevronIcon();
    const region = createEl("div", "warranty-detail-region");
    const regionInner = createEl("div", "warranty-detail-region__inner");
    const detailGrid = createEl("div", "warranty-detail-block");

    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-controls", detailsId);
    toggle.setAttribute("aria-label", `${expanded ? "Thu gọn" : "Mở chi tiết"} bảo hành ${window.AMApi.formatTicketCode(ticket.ticket_code)}`);
    region.id = detailsId;
    region.setAttribute("aria-hidden", String(!expanded));

    detailGrid.append(
      createMeta("Kiểu bảo hành", warrantyModeLabel(ticket.warranty_mode)),
      createMeta("Số tháng", ticket.warranty_months ? `${ticket.warranty_months} tháng` : ""),
      createMeta("Bắt đầu", formatDate(ticket.warranty_start_date)),
      createMeta("Kết thúc", formatDate(ticket.warranty_end_date)),
      createMeta("Trạng thái bảo hành", status.detail),
      createMeta("Nội dung", ticket.warranty_note)
    );

    copy.append(eyebrow, summaryText);
    controls.append(badge, chevron);
    toggle.append(copy, controls);
    regionInner.appendChild(detailGrid);
    region.appendChild(regionInner);
    section.append(toggle, region);

    toggle.addEventListener("click", () => {
      const nextExpanded = toggle.getAttribute("aria-expanded") !== "true";
      if (nextExpanded) {
        expandedWarrantyIds.add(identity);
      } else {
        expandedWarrantyIds.delete(identity);
      }
      section.classList.toggle("is-expanded", nextExpanded);
      toggle.setAttribute("aria-expanded", String(nextExpanded));
      toggle.setAttribute("aria-label", `${nextExpanded ? "Thu gọn" : "Mở chi tiết"} bảo hành ${window.AMApi.formatTicketCode(ticket.ticket_code)}`);
      region.setAttribute("aria-hidden", String(!nextExpanded));
    });

    return section;
  }

  function createWarrantyCard(ticket) {
    const card = createEl("article", "warranty-card");
    const top = createEl("div", "warranty-card-top");
    const title = createEl("div", "warranty-card-title");
    const code = createEl("strong", "", window.AMApi.formatTicketCode(ticket.ticket_code));
    const customer = createEl("span", "", `${customerCode(ticket)} · ${textOrDash(customerName(ticket))}`);
    const status = warrantyStatus(ticket);
    const ticketStatus = createBadge(statusLabel(ticket.status), `status-pill ${statusClass(ticket.status)}`.trim());
    const meta = createEl("div", "warranty-meta-grid");
    const warrantyDisclosure = createWarrantyDisclosure(ticket, status);
    const actions = createEl("div", "warranty-actions");
    const query = ticket.ticket_code
      ? `code=${encodeURIComponent(ticket.ticket_code)}`
      : `id=${encodeURIComponent(ticket.id || "")}`;

    title.append(code, customer);
    top.append(title);

    meta.append(
      createMeta("Số điện thoại", maskPhone(customerPhone(ticket))),
      createMeta("Hãng", ticket.brand),
      createMeta("Model", ticket.model),
      createMeta("Serial", ticket.serial_number),
      createMeta("Ngày nhận", formatDate(ticket.received_date)),
      createMeta("Ngày giao/trả", formatDate(ticket.delivery_date)),
      createMeta("Trạng thái phiếu", "")
    );

    const statusItem = meta.lastElementChild;
    if (statusItem) {
      statusItem.lastElementChild.replaceChildren(ticketStatus);
    }

    actions.appendChild(createActionLink("Xem phiếu", `search.html?${query}`, false));

    if (ticket.status === "đã trả" && ticket.completed_at) {
      actions.appendChild(createActionLink("In lại biên nhận", `print-delivery-receipt.html?${query}`, true));
    }

    card.append(top, meta, warrantyDisclosure, actions);
    return card;
  }

  function renderPagination(result) {
    if (!pagination) {
      return;
    }

    const pageCount = Math.max(Number(result.totalPages) || 1, 1);
    pagination.replaceChildren();

    if (pageCount <= 1) {
      pagination.hidden = true;
      return;
    }

    pagination.hidden = false;

    const previous = document.createElement("button");
    previous.type = "button";
    previous.textContent = "← Trước";
    previous.dataset.page = String(currentPage - 1);
    previous.dataset.disabled = currentPage === 1 ? "true" : "false";
    previous.disabled = currentPage === 1 || isLoading;
    pagination.appendChild(previous);

    visiblePageNumbers(pageCount, currentPage).forEach((page) => {
      if (typeof page !== "number") {
        const ellipsis = createEl("span", "pagination-ellipsis", "...");
        pagination.appendChild(ellipsis);
        return;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.textContent = String(page);
      button.dataset.page = String(page);
      button.className = page === currentPage ? "active" : "";

      if (page === currentPage) {
        button.setAttribute("aria-current", "page");
      }

      pagination.appendChild(button);
    });

    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "Sau →";
    next.dataset.page = String(currentPage + 1);
    next.dataset.disabled = currentPage === pageCount ? "true" : "false";
    next.disabled = currentPage === pageCount || isLoading;
    pagination.appendChild(next);
  }

  function summaryText(result) {
    const total = Number(result.totalCount) || 0;
    const start = total === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(currentPage * PAGE_SIZE, total);
    const rangeText = `Đang hiển thị ${start}–${end} trên tổng số ${total} phiếu.`;

    if (!searchQuery && activeWarrantyFilter === "all") {
      if (total <= PAGE_SIZE) {
        return `Đang hiển thị ${total} phiếu hoàn thành gần nhất.`;
      }

      return `10 phiếu hoàn thành gần nhất. ${rangeText}`;
    }

    const parts = [];

    if (searchQuery) {
      parts.push(`Tìm thấy ${total} phiếu cho “${searchQuery}”.`);
    } else {
      parts.push(`Tìm thấy ${total} phiếu.`);
    }

    if (activeWarrantyFilter !== "all") {
      parts.push(`Nhóm “${filterLabel(activeWarrantyFilter)}”.`);
    }

    parts.push(rangeText);
    return parts.join(" ");
  }

  function hasAnyFilterCount(filterCounts) {
    if (!filterCounts) {
      return false;
    }

    return Object.values(filterCounts).some((value) => Number(value) > 0);
  }

  function renderRecords(result) {
    const records = result.records || [];
    const total = Number(result.totalCount) || 0;
    const shouldKeepToolbar = hasAnyFilterCount(result.filterCounts) || Boolean(searchQuery) || activeWarrantyFilter !== "all";

    renderFilterChips(result.filterCounts);

    if (total === 0) {
      if (searchQuery) {
        setState("empty", "Không tìm thấy phiếu hoặc thông tin bảo hành phù hợp.");
        toolbar.hidden = !shouldKeepToolbar;
        return;
      }

      if (activeWarrantyFilter !== "all") {
        setState("empty", `Không có phiếu nào thuộc nhóm “${filterLabel(activeWarrantyFilter)}”.`);
        toolbar.hidden = !shouldKeepToolbar;
        return;
      }

      setState("empty", "Chưa có phiếu hoàn thành để hiển thị.");
      toolbar.hidden = !shouldKeepToolbar;
      return;
    }

    const fragment = document.createDocumentFragment();
    records.forEach((ticket) => fragment.appendChild(createWarrantyCard(ticket)));

    cards.replaceChildren(fragment);
    summary.textContent = summaryText(result);
    renderPagination(result);
    clearNotice();
    toolbar.hidden = false;
    setState("data", "");
  }

  function updateUrlState() {
    const params = new URLSearchParams();

    if (searchQuery) {
      params.set("q", searchQuery);
    }

    if (currentPage > 1) {
      params.set("page", String(currentPage));
    }

    if (activeWarrantyFilter !== "all") {
      params.set("filter", activeWarrantyFilter);
    }

    if (sortMode !== "newest") {
      params.set("sort", sortMode);
    }

    const queryString = params.toString();
    const nextUrl = queryString ? `warranty-search.html?${queryString}` : "warranty-search.html";
    window.history.replaceState(null, "", nextUrl);
  }

  function scrollToResults() {
    const section = document.querySelector(".warranty-search-section");

    if (!section) {
      return;
    }

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    section.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "start"
    });
  }

  async function loadWarrantyRecords(options) {
    const settings = options || {};
    const requestId = activeRequestId + 1;
    activeRequestId = requestId;
    clearNotice();
    setControlsLoading(true);
    const hasRenderedData = !resultsWrap.hidden && cards && cards.childElementCount > 0;
    setState(
      hasRenderedData ? "refreshing" : "loading",
      hasRenderedData ? "Đang cập nhật danh sách bảo hành..." : "Đang tải danh sách bảo hành..."
    );

    try {
      const result = await window.AMApi.getWarrantyRecords({
        query: searchQuery,
        page: currentPage,
        pageSize: PAGE_SIZE,
        filter: activeWarrantyFilter,
        sort: sortMode
      });

      if (requestId !== activeRequestId) {
        return;
      }

      lastResult = result;
      const totalPages = Math.max(Number(result.totalPages) || 1, 1);

      if (currentPage > totalPages) {
        currentPage = totalPages;
        setControlsLoading(false);
        await loadWarrantyRecords(settings);
        return;
      }

      renderRecords(result);
      updateUrlState();

      if (settings.scroll) {
        scrollToResults();
      }
    } catch (error) {
      if (requestId !== activeRequestId) {
        return;
      }

      lastResult = null;
      setState("error", "Không thể tải dữ liệu. Vui lòng thử lại.");
      showNotice("error", error.message);
    } finally {
      if (requestId === activeRequestId) {
        setControlsLoading(false);
      }
    }
  }

  function resetToDefault() {
    closeSuggestions();
    searchQuery = "";
    currentPage = 1;
    activeWarrantyFilter = "all";
    sortMode = "newest";
    input.value = "";
    clearButton.hidden = true;
    sortSelect.value = sortMode;
    input.focus({ preventScroll: true });
    loadWarrantyRecords({ scroll: false });
  }

  function applySearch() {
    closeSuggestions();
    searchQuery = input.value.trim();
    currentPage = 1;
    activeWarrantyFilter = "all";
    clearButton.hidden = searchQuery.length === 0;
    loadWarrantyRecords({ scroll: false });
  }

  function handleSuggestionKeydown(event) {
    if (!suggestions) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();

      if (suggestions.hidden) {
        fetchSuggestions();
        return;
      }

      setActiveSuggestion(activeSuggestionIndex + 1);
      return;
    }

    if (event.key === "ArrowUp") {
      if (suggestions.hidden) {
        return;
      }

      event.preventDefault();
      setActiveSuggestion(activeSuggestionIndex <= 0 ? suggestionItems.length - 1 : activeSuggestionIndex - 1);
      return;
    }

    if (event.key === "Enter" && !suggestions.hidden && activeSuggestionIndex >= 0) {
      event.preventDefault();
      selectSuggestion(suggestionItems[activeSuggestionIndex]);
      return;
    }

    if (event.key === "Escape") {
      if (!suggestions.hidden) {
        event.preventDefault();
      }

      closeSuggestions();
      return;
    }

    if (event.key === "Tab") {
      closeSuggestions();
    }
  }

  function attachEvents() {
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      applySearch();
    });

    input.addEventListener("input", function () {
      clearButton.hidden = input.value.trim().length === 0;
      scheduleSuggestions();
    });

    input.addEventListener("keydown", handleSuggestionKeydown);
    clearButton.addEventListener("click", resetToDefault);
    resetButton.addEventListener("click", resetToDefault);

    filterChips.addEventListener("click", function (event) {
      const button = event.target.closest("[data-filter]");

      if (!button || isLoading) {
        return;
      }

      closeSuggestions();
      activeWarrantyFilter = button.dataset.filter || "all";
      currentPage = 1;
      loadWarrantyRecords({ scroll: true });
    });

    sortSelect.addEventListener("change", function () {
      closeSuggestions();
      sortMode = sortSelect.value || "newest";
      currentPage = 1;
      loadWarrantyRecords({ scroll: true });
    });

    pagination.addEventListener("click", function (event) {
      const button = event.target.closest("[data-page]");

      if (!button || isLoading || button.dataset.disabled === "true") {
        return;
      }

      const nextPage = Number.parseInt(button.dataset.page, 10);

      if (!Number.isFinite(nextPage) || nextPage === currentPage) {
        return;
      }

      closeSuggestions();
      currentPage = Math.max(nextPage, 1);
      loadWarrantyRecords({ scroll: true });
    });

    document.addEventListener("click", function (event) {
      if (!form.contains(event.target)) {
        closeSuggestions();
      }
    });
  }

  function readUrlState() {
    const params = new URLSearchParams(window.location.search);
    const query = params.get("q") || params.get("query") || params.get("code") || "";
    const page = Number.parseInt(params.get("page") || "1", 10);
    const filter = params.get("filter") || "all";
    const sort = params.get("sort") || "newest";
    const validFilters = new Set(FILTERS.map((item) => item.key));
    const validSorts = new Set(["newest", "expiry", "expiry-nearest"]);

    searchQuery = query.trim();
    currentPage = Number.isFinite(page) && page > 0 ? page : 1;
    activeWarrantyFilter = validFilters.has(filter) ? filter : "all";
    sortMode = validSorts.has(sort) ? sort : "newest";

    input.value = searchQuery;
    clearButton.hidden = searchQuery.length === 0;
    sortSelect.value = sortMode;
  }

  async function initWarrantySearch() {
    attachLogout();
    attachEvents();

    try {
      const access = await window.AMApi.requireInternalAccess();

      if (!access) {
        return;
      }

      readUrlState();
      await loadWarrantyRecords({ scroll: false });
    } catch (error) {
      setState("error", "Không thể tải dữ liệu. Vui lòng thử lại.");
      showNotice("error", error.message);
    }
  }

  window.AMWarrantySearchTest = {
    PAGE_SIZE,
    WARRANTY_EXPIRING_DAYS,
    dateOrdinal,
    warrantyStatus,
    warrantySummaryText,
    createWarrantyCard,
    visiblePageNumbers
  };

  document.addEventListener("DOMContentLoaded", initWarrantySearch);
})();

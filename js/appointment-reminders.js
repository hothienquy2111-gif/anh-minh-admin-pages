(function () {
  "use strict";

  const PAGE_SIZE = 10;
  const SEARCH_DEBOUNCE_MS = 280;
  const TIME_REFRESH_MS = 60000;
  const FILTER_LABELS = {
    needs_action: "cần làm",
    overdue: "quá hạn",
    today: "hôm nay",
    upcoming: "sắp tới",
    completed: "đã hoàn thành",
    cancelled: "đã hủy"
  };

  const notice = document.getElementById("reminderNotice");
  const listSection = document.getElementById("appointmentListSection");
  const listSummary = document.getElementById("reminderListSummary");
  const listState = document.getElementById("reminderListState");
  const list = document.getElementById("reminderList");
  const pagination = document.getElementById("reminderPagination");
  const searchForm = document.getElementById("reminderSearchForm");
  const searchArea = document.querySelector(".appointment-search-area");
  const searchInput = document.getElementById("reminderSearchInput");
  const searchClearButton = document.getElementById("reminderSearchClear");
  const searchSuggestions = document.getElementById("reminderSearchSuggestions");
  const resetFiltersButton = document.getElementById("reminderResetFilters");
  const typeFilter = document.getElementById("reminderTypeFilter");
  const openModalButton = document.getElementById("openReminderModal");
  const modal = document.getElementById("reminderModal");
  const closeModalButton = document.getElementById("closeReminderModal");
  const form = document.getElementById("reminderForm");
  const formNotice = document.getElementById("reminderFormNotice");
  const modalTitle = document.getElementById("reminderModalTitle");
  const ticketSearchGroup = document.getElementById("reminderTicketSearchGroup");
  const ticketSearch = document.getElementById("reminderTicketSearch");
  const ticketSuggestions = document.getElementById("reminderTicketSuggestions");
  const selectedTicket = document.getElementById("selectedReminderTicket");
  const saveButton = document.getElementById("saveReminderButton");
  const summaryElements = {
    overdue: document.getElementById("reminderSummaryOverdue"),
    today: document.getElementById("reminderSummaryToday"),
    upcoming: document.getElementById("reminderSummaryUpcoming"),
    completed: document.getElementById("reminderSummaryCompleted")
  };
  const filterCountElements = {
    needsAction: document.getElementById("reminderFilterNeedsAction"),
    overdue: document.getElementById("reminderFilterOverdue"),
    today: document.getElementById("reminderFilterToday"),
    upcoming: document.getElementById("reminderFilterUpcoming"),
    completed: document.getElementById("reminderFilterCompleted"),
    cancelled: document.getElementById("reminderFilterCancelled")
  };

  let currentPage = 1;
  let currentFilter = "needs_action";
  let currentKeyword = "";
  let currentType = "all";
  let currentReminders = [];
  let selectedTicketData = null;
  let listRequestId = 0;
  let summaryRequestId = 0;
  let ticketRequestId = 0;
  let searchSuggestionRequestId = 0;
  let searchTimerId = null;
  let ticketSearchTimerId = null;
  let relativeTimeTimerId = null;
  let isSaving = false;
  let createRequestId = null;
  let modalOpener = null;
  let modalCloseTimer = null;

  function textOrDash(value) {
    const text = String(value || "").trim();
    return text || "—";
  }

  function createTextElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) {
      element.className = className;
    }
    element.textContent = text;
    return element;
  }

  function showNotice(element, type, message) {
    if (!element) {
      return;
    }
    element.className = `notice ${type} show`;
    element.textContent = message;
  }

  function clearNotice(element) {
    if (!element) {
      return;
    }
    element.className = "notice";
    element.textContent = "";
  }

  function showSuccess(message) {
    clearNotice(notice);
    if (window.AMUI && typeof window.AMUI.toast === "function") {
      window.AMUI.toast(message, { type: "success" });
      return;
    }
    showNotice(notice, "success", message);
  }

  function attachLogout() {
    document.querySelectorAll("[data-logout]").forEach((button) => {
      button.addEventListener("click", async function () {
        if (button.disabled) {
          return;
        }
        button.disabled = true;
        try {
          await window.AMApi.signOut();
        } catch (error) {
          showNotice(notice, "error", error.message);
          button.disabled = false;
        }
      });
    });
  }

  function setListState(type, message, action) {
    if (type === "data" || type === "refreshing") {
      window.AMUI.setSectionState({
        section: listSection,
        stateElement: listState,
        dataElement: list
      }, type);
      return;
    }

    listState.replaceChildren();
    pagination.hidden = true;
    window.AMUI.setSectionState({
      section: listSection,
      stateElement: listState,
      dataElement: list
    }, type);

    if (type === "loading") {
      const status = createTextElement("span", "sr-only", message);
      const skeleton = document.createElement("div");
      skeleton.className = "appointment-skeleton-list";
      skeleton.setAttribute("aria-hidden", "true");
      skeleton.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
      listState.append(status, skeleton);
      return;
    }

    listState.appendChild(createTextElement("p", "appointment-state-message", message));

    if (action && typeof action.handler === "function") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn secondary compact";
      button.textContent = action.label || "Thử lại";
      button.addEventListener("click", action.handler, { once: true });
      listState.appendChild(button);
    }
  }

  function formatDevice(reminder) {
    return [reminder && reminder.device_brand, reminder && reminder.device_model]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" ");
  }

  function createUuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }

    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
  }

  function ensureCreateRequestId() {
    if (!createRequestId) {
      createRequestId = createUuid();
    }
    return createRequestId;
  }

  function shouldRetainCreateRequestId(error) {
    return error && error.code === "REMINDER_OUTCOME_UNKNOWN";
  }

  function timingLabel(timing) {
    const labels = {
      overdue: "Quá hạn",
      today: "Hôm nay",
      upcoming: "Sắp tới",
      unknown: "Chưa rõ thời gian"
    };
    return labels[timing] || labels.unknown;
  }

  function statusLabel(status) {
    const labels = { pending: "Cần làm", completed: "Đã hoàn thành", cancelled: "Đã hủy" };
    return labels[status] || textOrDash(status);
  }

  function createTimingBadge(reminder) {
    const timing = window.AMReminderUtils.classifyReminderTiming(reminder);
    const badge = createTextElement("span", `reminder-timing-badge reminder-timing-badge--${timing}`, timingLabel(timing));
    return badge;
  }

  function createStatusBadge(reminder) {
    return createTextElement("span", `reminder-status-badge reminder-status-badge--${reminder.status}`, statusLabel(reminder.status));
  }

  function createMeta(label, value, className) {
    const item = document.createElement("span");
    item.className = `appointment-meta${className ? ` ${className}` : ""}`;
    item.append(
      createTextElement("small", "", label),
      createTextElement("strong", "", textOrDash(value))
    );
    return item;
  }

  function createMoreMenu(reminder) {
    const wrapper = document.createElement("div");
    const trigger = document.createElement("button");
    const menu = document.createElement("div");
    const reschedule = document.createElement("button");
    const edit = document.createElement("button");
    const activity = document.createElement("a");
    const cancel = document.createElement("button");

    wrapper.className = "appointment-item-more";
    trigger.type = "button";
    trigger.className = "appointment-more-trigger";
    trigger.textContent = "⋯";
    trigger.setAttribute("aria-label", `Mở thêm thao tác cho ${textOrDash(reminder.ticket_code)}`);
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.dataset.reminderMenuTrigger = reminder.id;

    menu.className = "appointment-item-menu";
    menu.setAttribute("role", "menu");
    menu.hidden = true;

    reschedule.type = "button";
    reschedule.textContent = "Dời lịch";
    reschedule.dataset.reminderReschedule = reminder.id;
    reschedule.setAttribute("role", "menuitem");

    edit.type = "button";
    edit.textContent = "Sửa nội dung";
    edit.dataset.reminderEdit = reminder.id;
    edit.setAttribute("role", "menuitem");

    activity.href = `ticket-activity.html?code=${encodeURIComponent(reminder.ticket_code || "")}`;
    activity.textContent = "Mở Hoạt động phiếu";
    activity.setAttribute("role", "menuitem");

    cancel.type = "button";
    cancel.className = "danger-text";
    cancel.textContent = "Hủy lịch";
    cancel.dataset.reminderCancel = reminder.id;
    cancel.setAttribute("role", "menuitem");

    menu.append(reschedule, edit, activity, cancel);
    wrapper.append(trigger, menu);
    return wrapper;
  }

  function renderReminder(reminder) {
    const item = document.createElement("article");
    const timing = window.AMReminderUtils.classifyReminderTiming(reminder);
    const header = document.createElement("div");
    const heading = document.createElement("div");
    const badges = document.createElement("div");
    const details = document.createElement("div");
    const note = createTextElement("p", "appointment-note", textOrDash(reminder.note));
    const actions = document.createElement("div");
    const view = document.createElement("a");
    const complete = document.createElement("button");

    item.className = `appointment-item appointment-item--${timing}`;
    item.dataset.reminderId = reminder.id;
    header.className = "appointment-item-header";
    heading.className = "appointment-item-heading";
    badges.className = "appointment-item-badges";
    details.className = "appointment-item-details";
    actions.className = "appointment-item-actions";

    heading.append(
      createTextElement("span", "appointment-type-label", window.AMReminderUtils.typeLabel(reminder.reminder_type)),
      createTextElement("h3", "appointment-item-title", textOrDash(reminder.title)),
      createTextElement("p", "appointment-time-label", window.AMReminderUtils.formatReminderRelativeTime(reminder))
    );
    badges.append(createTimingBadge(reminder), createStatusBadge(reminder));
    header.append(heading, badges);

    details.append(
      createMeta("Mã phiếu", reminder.ticket_code, "appointment-code"),
      createMeta("Mã khách", reminder.customer_code),
      createMeta("Khách hàng", reminder.customer_name),
      createMeta("Số điện thoại", reminder.customer_phone),
      createMeta("Hãng / Model", formatDevice(reminder)),
      createMeta("Thời gian hẹn", window.AMReminderUtils.formatReminderDateTime(reminder.scheduled_at))
    );

    view.className = "btn secondary compact";
    view.href = `search.html?code=${encodeURIComponent(reminder.ticket_code || "")}`;
    view.textContent = "Xem phiếu";
    actions.appendChild(view);

    if (reminder.status === "pending") {
      complete.type = "button";
      complete.className = "btn primary compact";
      complete.textContent = "Hoàn thành";
      complete.dataset.reminderComplete = reminder.id;
      actions.append(complete, createMoreMenu(reminder));
    }

    item.append(header, details, note, actions);
    return item;
  }

  function closeItemMenus(exceptTrigger) {
    document.querySelectorAll("[data-reminder-menu-trigger]").forEach((trigger) => {
      if (trigger === exceptTrigger) {
        return;
      }
      trigger.setAttribute("aria-expanded", "false");
      const menu = trigger.nextElementSibling;
      if (menu) {
        menu.hidden = true;
      }
    });
  }

  function renderPagination(payload) {
    pagination.replaceChildren();

    if (payload.totalPages <= 1) {
      pagination.hidden = true;
      return;
    }

    const previous = document.createElement("button");
    const pageStatus = createTextElement("span", "appointment-page-status", `Trang ${payload.page}/${payload.totalPages}`);
    const next = document.createElement("button");

    previous.type = "button";
    previous.textContent = "← Trước";
    previous.disabled = payload.page === 1;
    previous.dataset.page = String(payload.page - 1);

    next.type = "button";
    next.textContent = "Sau →";
    next.disabled = payload.page === payload.totalPages;
    next.dataset.page = String(payload.page + 1);

    pagination.appendChild(previous);
    for (let page = 1; page <= payload.totalPages; page += 1) {
      if (payload.totalPages > 7 && Math.abs(page - payload.page) > 2 && page !== 1 && page !== payload.totalPages) {
        if (page === 2 || page === payload.totalPages - 1) {
          pagination.appendChild(createTextElement("span", "pagination-ellipsis", "…"));
        }
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = String(page);
      button.dataset.page = String(page);
      button.className = page === payload.page ? "active" : "";
      if (page === payload.page) {
        button.setAttribute("aria-current", "page");
      }
      pagination.appendChild(button);
    }
    pagination.append(pageStatus, next);
    pagination.hidden = false;
  }

  function renderList(payload, shouldScroll) {
    currentReminders = payload.reminders || [];
    const pendingView = !["completed", "cancelled"].includes(currentFilter);
    const rows = pendingView
      ? window.AMReminderUtils.sortPendingReminders(currentReminders)
      : currentReminders;

    if (payload.total === 0) {
      listSummary.textContent = `Không có lịch hẹn ${FILTER_LABELS[currentFilter] || "phù hợp"}.`;
      const hasFilters = Boolean(currentKeyword) || currentType !== "all" || currentFilter !== "needs_action";
      setListState("empty", "Hiện không có lịch hẹn phù hợp.", {
        label: hasFilters ? "Xóa bộ lọc" : "Tạo lịch hẹn",
        handler: hasFilters ? resetFilters : () => openCreateModal()
      });
      return;
    }

    const start = (payload.page - 1) * payload.pageSize + 1;
    const end = start + rows.length - 1;
    const fragment = document.createDocumentFragment();
    rows.forEach((reminder) => fragment.appendChild(renderReminder(reminder)));
    list.replaceChildren(fragment);
    listSummary.textContent = `Đang hiển thị ${start}–${end} trên tổng số ${payload.total} lịch hẹn.`;
    renderPagination(payload);
    setListState("data", "");

    if (shouldScroll) {
      const reduceMotion = window.AMUI
        ? window.AMUI.prefersReducedMotion()
        : window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      listSection.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    }
  }

  function setActiveFilter(filter) {
    currentFilter = filter || "needs_action";
    document.querySelectorAll("[data-reminder-filter]").forEach((chip) => {
      const active = chip.dataset.reminderFilter === currentFilter;
      chip.classList.toggle("active", active);
      chip.setAttribute("aria-pressed", String(active));
    });
    document.querySelectorAll("[data-reminder-summary-filter]").forEach((card) => {
      card.classList.toggle("is-active", card.dataset.reminderSummaryFilter === currentFilter);
    });
  }

  function closeSearchSuggestions() {
    searchSuggestionRequestId += 1;
    searchSuggestions.hidden = true;
    searchSuggestions.replaceChildren();
    searchInput.setAttribute("aria-expanded", "false");
    searchArea.classList.remove("is-loading");
  }

  function setSearchLoading(isLoading) {
    searchArea.classList.toggle("is-loading", isLoading);
  }

  function renderSearchSuggestions(reminders) {
    searchSuggestions.replaceChildren();

    if (!reminders.length) {
      closeSearchSuggestions();
      return;
    }

    reminders.forEach((reminder) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "appointment-search-suggestion";
      button.setAttribute("role", "option");
      button.dataset.searchValue = reminder.ticket_code || reminder.title || "";
      button.append(
        createTextElement("strong", "", `${textOrDash(reminder.ticket_code)} · ${textOrDash(reminder.customer_code)} · ${textOrDash(reminder.customer_name)}`),
        createTextElement("span", "", `${textOrDash(formatDevice(reminder))} · ${textOrDash(reminder.title)}`)
      );
      searchSuggestions.appendChild(button);
    });

    searchSuggestions.hidden = false;
    searchInput.setAttribute("aria-expanded", "true");
  }

  async function loadSearchSuggestions() {
    const keyword = searchInput.value.trim();
    const requestId = searchSuggestionRequestId + 1;
    searchSuggestionRequestId = requestId;

    if (keyword.length < 2) {
      closeSearchSuggestions();
      return;
    }

    setSearchLoading(true);
    try {
      const reminders = await window.AMApi.searchReminderSuggestions(keyword, 5);
      if (requestId === searchSuggestionRequestId) {
        renderSearchSuggestions(reminders || []);
      }
    } catch (error) {
      if (requestId === searchSuggestionRequestId) {
        closeSearchSuggestions();
      }
    } finally {
      if (requestId === searchSuggestionRequestId) {
        setSearchLoading(false);
      }
    }
  }

  function commitSearch(value, shouldScroll) {
    window.clearTimeout(searchTimerId);
    currentKeyword = String(value || "").trim();
    searchInput.value = currentKeyword;
    searchClearButton.hidden = !currentKeyword;
    closeSearchSuggestions();
    currentPage = 1;
    loadReminders({ scroll: shouldScroll === true });
  }

  function resetFilters() {
    window.clearTimeout(searchTimerId);
    currentKeyword = "";
    currentType = "all";
    currentPage = 1;
    searchInput.value = "";
    searchClearButton.hidden = true;
    typeFilter.value = "all";
    closeSearchSuggestions();
    setActiveFilter("needs_action");
    loadReminders({ scroll: true });
  }

  async function loadSummary() {
    const requestId = summaryRequestId + 1;
    summaryRequestId = requestId;
    try {
      const summary = await window.AMApi.getReminderSummary();
      if (requestId !== summaryRequestId) {
        return;
      }
      Object.keys(summaryElements).forEach((key) => {
        summaryElements[key].textContent = String(summary[key] || 0);
      });
      Object.keys(filterCountElements).forEach((key) => {
        filterCountElements[key].textContent = String(summary[key] || 0);
      });
    } catch (error) {
      if (requestId !== summaryRequestId) {
        return;
      }
      Object.values(summaryElements).forEach((element) => {
        element.textContent = "—";
      });
      Object.values(filterCountElements).forEach((element) => {
        element.textContent = "—";
      });
    }
  }

  async function loadReminders(options) {
    const params = options || {};
    const requestId = listRequestId + 1;
    listRequestId = requestId;
    const hasRenderedData = !list.hidden && list.childElementCount > 0;
    if (hasRenderedData) {
      listSummary.textContent = "Đang cập nhật lịch hẹn…";
    }
    setListState(hasRenderedData ? "refreshing" : "loading", "Đang tải lịch hẹn…");

    try {
      const payload = await window.AMApi.getRemindersPage({
        page: currentPage,
        pageSize: PAGE_SIZE,
        filter: currentFilter,
        keyword: currentKeyword,
        reminderType: currentType
      });
      if (requestId !== listRequestId) {
        return;
      }
      if (payload.total > 0 && payload.page > payload.totalPages) {
        currentPage = payload.totalPages;
        await loadReminders(params);
        return;
      }
      currentPage = Math.min(payload.page, payload.totalPages);
      renderList(payload, params.scroll === true);
      clearNotice(notice);
    } catch (error) {
      if (requestId !== listRequestId) {
        return;
      }
      currentReminders = [];
      const unavailable = error.code === "REMINDERS_UNAVAILABLE";
      const message = unavailable
        ? "Module lịch hẹn chưa được kích hoạt trên dữ liệu hệ thống."
        : "Không thể tải lịch hẹn. Vui lòng thử lại.";
      setListState(
        unavailable ? "unavailable" : "error",
        message,
        unavailable ? null : { label: "Thử lại", handler: loadReminders }
      );
      showNotice(notice, unavailable ? "info" : "error", message);
    }
  }

  function renderSelectedTicket(ticket) {
    selectedTicket.replaceChildren();
    if (!ticket) {
      selectedTicket.hidden = true;
      return;
    }
    const title = createTextElement("strong", "", textOrDash(ticket.ticket_code));
    const details = createTextElement(
      "span",
      "",
      `${textOrDash(ticket.customer_code)} · ${textOrDash(ticket.customer_name)} · ${textOrDash(ticket.brand || ticket.model ? [ticket.brand, ticket.model].filter(Boolean).join(" ") : "")}`
    );
    selectedTicket.append(title, details);
    selectedTicket.hidden = false;
  }

  function selectTicket(ticket) {
    selectedTicketData = ticket;
    form.elements.ticket_id.value = ticket.id || "";
    ticketSearch.value = ticket.ticket_code || "";
    form.elements.customer_phone.value = ticket.customer_phone || (ticket.customer && ticket.customer.phone) || "";
    ticketSuggestions.hidden = true;
    ticketSuggestions.replaceChildren();
    renderSelectedTicket(ticket);
  }

  function renderTicketSuggestions(tickets) {
    ticketSuggestions.replaceChildren();
    if (!tickets.length) {
      ticketSuggestions.appendChild(createTextElement("p", "appointment-ticket-suggestion-empty", "Không tìm thấy phiếu phù hợp."));
      ticketSuggestions.hidden = false;
      return;
    }

    tickets.forEach((ticket) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "appointment-ticket-suggestion";
      button.setAttribute("role", "option");
      button.dataset.ticketId = ticket.id;
      button.append(
        createTextElement("strong", "", textOrDash(ticket.ticket_code)),
        createTextElement("span", "", `${textOrDash(ticket.customer_name)} · ${textOrDash(ticket.customer_phone)} · ${textOrDash(ticket.model)}`)
      );
      ticketSuggestions.appendChild(button);
    });
    ticketSuggestions.hidden = false;
  }

  async function loadTicketSuggestions() {
    const keyword = ticketSearch.value.trim();
    const requestId = ticketRequestId + 1;
    ticketRequestId = requestId;
    if (keyword.length < 2) {
      ticketSuggestions.hidden = true;
      ticketSuggestions.replaceChildren();
      return;
    }
    try {
      const tickets = await window.AMApi.getTicketSearchSuggestions({ query: keyword, year: "all", limit: 5 });
      if (requestId === ticketRequestId) {
        renderTicketSuggestions(tickets || []);
      }
    } catch (error) {
      if (requestId === ticketRequestId) {
        ticketSuggestions.hidden = true;
      }
    }
  }

  function vietnamDateTimeParts(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return { date: "", time: "" };
    }
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
  }

  function defaultScheduleParts() {
    const nextHour = new Date(Date.now() + 60 * 60 * 1000);
    nextHour.setMinutes(0, 0, 0);
    return vietnamDateTimeParts(nextHour);
  }

  function closeModal() {
    if (isSaving) {
      return;
    }
    if (modal.hidden || modal.classList.contains("is-closing")) {
      return;
    }
    if (!form.elements.reminder_id.value) {
      createRequestId = null;
    }
    const reduceMotion = window.AMUI
      ? window.AMUI.prefersReducedMotion()
      : window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    modal.classList.add("is-closing");
    modalCloseTimer = window.setTimeout(() => {
      modal.hidden = true;
      modal.classList.remove("show", "is-closing");
      modal.setAttribute("aria-hidden", "true");
      ticketSuggestions.hidden = true;
      document.body.classList.remove("modal-open");
      const target = modalOpener && document.contains(modalOpener) ? modalOpener : openModalButton;
      target.focus({ preventScroll: true });
      modalOpener = null;
      modalCloseTimer = null;
    }, reduceMotion ? 0 : 140);
  }

  function openCreateModal(ticket) {
    if (modalCloseTimer) {
      window.clearTimeout(modalCloseTimer);
      modalCloseTimer = null;
    }
    modalOpener = document.activeElement;
    createRequestId = null;
    form.reset();
    clearNotice(formNotice);
    selectedTicketData = null;
    form.elements.reminder_id.value = "";
    form.elements.expected_updated_at.value = "";
    form.elements.ticket_id.value = "";
    ticketSearch.disabled = false;
    ticketSearchGroup.hidden = false;
    modalTitle.textContent = "Tạo lịch hẹn";
    saveButton.textContent = "Lưu lịch hẹn";
    const schedule = defaultScheduleParts();
    form.elements.date.value = schedule.date;
    form.elements.time.value = schedule.time;
    renderSelectedTicket(null);
    if (ticket) {
      selectTicket(ticket);
    }
    modal.hidden = false;
    modal.classList.remove("is-closing");
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    window.setTimeout(() => (ticket ? form.elements.title : ticketSearch).focus(), 0);
  }

  function openEditModal(reminder, mode) {
    if (modalCloseTimer) {
      window.clearTimeout(modalCloseTimer);
      modalCloseTimer = null;
    }
    modalOpener = document.activeElement;
    form.reset();
    clearNotice(formNotice);
    selectedTicketData = { id: reminder.ticket_id, ticket_code: reminder.ticket_code, customer_code: reminder.customer_code, customer_name: reminder.customer_name, customer_phone: reminder.customer_phone, brand: reminder.device_brand, model: reminder.device_model };
    form.elements.reminder_id.value = reminder.id;
    form.elements.expected_updated_at.value = reminder.updated_at || "";
    form.elements.ticket_id.value = reminder.ticket_id || "";
    form.elements.reminder_type.value = reminder.reminder_type === "CALL_CUSTOMER" ? "CALLBACK" : reminder.reminder_type;
    form.elements.priority.value = reminder.priority || "normal";
    form.elements.title.value = reminder.title || "";
    form.elements.customer_phone.value = reminder.customer_phone || "";
    form.elements.note.value = reminder.note || "";
    const schedule = vietnamDateTimeParts(reminder.scheduled_at);
    form.elements.date.value = schedule.date;
    form.elements.time.value = schedule.time;
    ticketSearch.value = reminder.ticket_code || "";
    ticketSearch.disabled = true;
    ticketSearchGroup.hidden = true;
    renderSelectedTicket(selectedTicketData);
    modalTitle.textContent = mode === "reschedule" ? "Dời lịch hẹn" : "Sửa lịch hẹn";
    saveButton.textContent = mode === "reschedule" ? "Lưu thời gian mới" : "Lưu thay đổi";
    modal.hidden = false;
    modal.classList.remove("is-closing");
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    window.setTimeout(() => (mode === "reschedule" ? form.elements.date : form.elements.title).focus(), 0);
  }

  function collectFormData() {
    const data = Object.fromEntries(new FormData(form).entries());
    if (!data.ticket_id) {
      throw new Error("Vui lòng chọn đúng một phiếu trước khi lưu lịch hẹn.");
    }
    if (!data.date || !data.time) {
      throw new Error("Vui lòng nhập đầy đủ ngày và giờ hẹn.");
    }
    const scheduledAt = new Date(`${data.date}T${data.time}:00+07:00`);
    if (Number.isNaN(scheduledAt.getTime())) {
      throw new Error("Ngày hoặc giờ hẹn không hợp lệ.");
    }
    return {
      id: data.reminder_id || null,
      expectedUpdatedAt: data.expected_updated_at || null,
      ticketId: data.ticket_id,
      reminderType: data.reminder_type,
      title: String(data.title || "").trim(),
      note: String(data.note || "").trim() || null,
      scheduledAt: scheduledAt.toISOString(),
      customerPhone: String(data.customer_phone || "").trim() || null,
      priority: data.priority || "normal",
      clientRequestId: data.reminder_id ? null : ensureCreateRequestId()
    };
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (isSaving) {
      return;
    }
    clearNotice(formNotice);
    isSaving = true;
    form.setAttribute("aria-busy", "true");
    if (window.AMUI && typeof window.AMUI.setButtonBusy === "function") {
      window.AMUI.setButtonBusy(saveButton, true, { busyText: "Đang lưu…" });
    } else {
      saveButton.disabled = true;
      saveButton.textContent = "Đang lưu…";
    }
    let payload = null;
    try {
      payload = collectFormData();
      if (payload.id) {
        await window.AMApi.updateTicketReminder(payload);
      } else {
        await window.AMApi.createTicketReminder(payload);
      }
      createRequestId = null;
      isSaving = false;
      closeModal();
      showSuccess(payload.id ? "Đã cập nhật lịch hẹn." : "Đã tạo lịch hẹn mới.");
      currentPage = 1;
      await Promise.allSettled([loadSummary(), loadReminders()]);
    } catch (error) {
      if (!payload || (!payload.id && !shouldRetainCreateRequestId(error))) {
        createRequestId = null;
      }
      showNotice(formNotice, "error", error.message);
    } finally {
      isSaving = false;
      form.setAttribute("aria-busy", "false");
      const idleText = form.elements.reminder_id.value ? "Lưu thay đổi" : "Lưu lịch hẹn";
      if (window.AMUI && typeof window.AMUI.setButtonBusy === "function") {
        window.AMUI.setButtonBusy(saveButton, false, { idleText });
      } else {
        saveButton.disabled = false;
        saveButton.textContent = idleText;
      }
    }
  }

  function reminderById(id) {
    return currentReminders.find((item) => item.id === id) || null;
  }

  async function completeReminder(reminder, button) {
    if (window.AMUI && typeof window.AMUI.setButtonBusy === "function") {
      window.AMUI.setButtonBusy(button, true, { busyText: "Đang xử lý…" });
    } else {
      button.disabled = true;
      button.textContent = "Đang xử lý…";
    }
    try {
      await window.AMApi.completeTicketReminder(reminder);
      showSuccess(`Đã hoàn thành lịch hẹn của ${textOrDash(reminder.ticket_code)}.`);
      await Promise.allSettled([loadSummary(), loadReminders()]);
    } catch (error) {
      showNotice(notice, "error", error.message);
      if (window.AMUI && typeof window.AMUI.setButtonBusy === "function") {
        window.AMUI.setButtonBusy(button, false, { idleText: "Hoàn thành" });
      } else {
        button.disabled = false;
        button.textContent = "Hoàn thành";
      }
    }
  }

  async function cancelReminder(reminder, button) {
    if (!window.confirm(`Hủy lịch hẹn “${reminder.title}”? Lịch vẫn được lưu trong mục Đã hủy.`)) {
      return;
    }
    if (window.AMUI && typeof window.AMUI.setButtonBusy === "function") {
      window.AMUI.setButtonBusy(button, true, { busyText: "Đang hủy…" });
    } else {
      button.disabled = true;
    }
    try {
      await window.AMApi.cancelTicketReminder(reminder);
      showSuccess("Đã hủy lịch hẹn.");
      await Promise.allSettled([loadSummary(), loadReminders()]);
    } catch (error) {
      showNotice(notice, "error", error.message);
      if (window.AMUI && typeof window.AMUI.setButtonBusy === "function") {
        window.AMUI.setButtonBusy(button, false);
      } else {
        button.disabled = false;
      }
    }
  }

  function trapModalFocus(event) {
    if (event.key !== "Tab" || modal.hidden) {
      return;
    }

    const focusable = Array.from(modal.querySelectorAll(
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

  function attachEvents() {
    document.querySelectorAll("[data-reminder-filter]").forEach((button) => {
      button.addEventListener("click", function () {
        setActiveFilter(button.dataset.reminderFilter || "needs_action");
        currentPage = 1;
        loadReminders({ scroll: true });
      });
    });

    document.querySelectorAll("[data-reminder-summary-filter]").forEach((card) => {
      card.addEventListener("click", function () {
        setActiveFilter(card.dataset.reminderSummaryFilter || "needs_action");
        currentPage = 1;
        loadReminders({ scroll: true });
      });
    });

    searchInput.addEventListener("input", function () {
      searchClearButton.hidden = !searchInput.value;
      window.clearTimeout(searchTimerId);
      searchTimerId = window.setTimeout(loadSearchSuggestions, SEARCH_DEBOUNCE_MS);
    });

    searchForm.addEventListener("submit", function (event) {
      event.preventDefault();
      commitSearch(searchInput.value, true);
    });

    searchClearButton.addEventListener("click", function () {
      commitSearch("", false);
      searchInput.focus();
    });

    searchSuggestions.addEventListener("click", function (event) {
      const option = event.target.closest("[data-search-value]");
      if (option) {
        commitSearch(option.dataset.searchValue, true);
      }
    });

    resetFiltersButton.addEventListener("click", resetFilters);

    typeFilter.addEventListener("change", function () {
      currentType = typeFilter.value || "all";
      currentPage = 1;
      loadReminders({ scroll: true });
    });

    pagination.addEventListener("click", function (event) {
      const button = event.target.closest("button[data-page]");
      if (!button || button.disabled) {
        return;
      }
      currentPage = Number.parseInt(button.dataset.page, 10) || 1;
      loadReminders({ scroll: true });
    });

    list.addEventListener("click", function (event) {
      const menuTrigger = event.target.closest("[data-reminder-menu-trigger]");
      if (menuTrigger) {
        const nextOpen = menuTrigger.getAttribute("aria-expanded") !== "true";
        closeItemMenus(menuTrigger);
        menuTrigger.setAttribute("aria-expanded", String(nextOpen));
        menuTrigger.nextElementSibling.hidden = !nextOpen;
        return;
      }

      const completeButton = event.target.closest("[data-reminder-complete]");
      const editButton = event.target.closest("[data-reminder-edit]");
      const rescheduleButton = event.target.closest("[data-reminder-reschedule]");
      const cancelButton = event.target.closest("[data-reminder-cancel]");
      const actionButton = completeButton || editButton || rescheduleButton || cancelButton;
      if (!actionButton) {
        return;
      }
      const reminder = reminderById(actionButton.dataset.reminderComplete || actionButton.dataset.reminderEdit || actionButton.dataset.reminderReschedule || actionButton.dataset.reminderCancel);
      if (!reminder) {
        return;
      }
      closeItemMenus();
      if (completeButton) {
        completeReminder(reminder, completeButton);
      } else if (cancelButton) {
        cancelReminder(reminder, cancelButton);
      } else {
        openEditModal(reminder, rescheduleButton ? "reschedule" : "edit");
      }
    });

    document.addEventListener("click", function (event) {
      if (!event.target.closest(".appointment-item-more")) {
        closeItemMenus();
      }
      if (!event.target.closest(".appointment-ticket-search-field")) {
        ticketSuggestions.hidden = true;
      }
      if (!event.target.closest(".appointment-search-area")) {
        closeSearchSuggestions();
      }
    });

    openModalButton.addEventListener("click", () => openCreateModal());
    closeModalButton.addEventListener("click", closeModal);
    document.querySelectorAll("[data-close-reminder]").forEach((button) => button.addEventListener("click", closeModal));
    modal.addEventListener("click", function (event) {
      if (event.target === modal) {
        closeModal();
      }
    });
    document.addEventListener("keydown", function (event) {
      if (!modal.hidden && event.key === "Tab") {
        trapModalFocus(event);
        return;
      }
      if (event.key === "Escape" && !searchSuggestions.hidden) {
        closeSearchSuggestions();
        searchInput.focus();
        return;
      }
      if (event.key === "Escape" && !modal.hidden) {
        closeModal();
      }
    });

    ticketSearch.addEventListener("input", function () {
      selectedTicketData = null;
      form.elements.ticket_id.value = "";
      renderSelectedTicket(null);
      window.clearTimeout(ticketSearchTimerId);
      ticketSearchTimerId = window.setTimeout(loadTicketSuggestions, SEARCH_DEBOUNCE_MS);
    });
    ticketSuggestions.addEventListener("click", function (event) {
      const button = event.target.closest("[data-ticket-id]");
      if (!button) {
        return;
      }
      const ticket = Array.from(ticketSuggestions.querySelectorAll("[data-ticket-id]")).find((item) => item === button);
      const id = ticket && ticket.dataset.ticketId;
      window.AMApi.getTicketById(id).then((loaded) => {
        if (loaded) {
          selectTicket(loaded);
        }
      }).catch((error) => showNotice(formNotice, "error", error.message));
    });
    form.addEventListener("submit", handleSubmit);
  }

  function startRelativeTimeTimer() {
    if (relativeTimeTimerId) {
      window.clearInterval(relativeTimeTimerId);
    }
    relativeTimeTimerId = window.setInterval(() => {
      if (currentReminders.length && !list.hidden) {
        currentReminders.forEach((reminder) => {
          const item = list.querySelector(`[data-reminder-id="${reminder.id}"]`);
          const label = item && item.querySelector(".appointment-time-label");
          if (label) {
            label.textContent = window.AMReminderUtils.formatReminderRelativeTime(reminder);
          }
        });
      }
    }, TIME_REFRESH_MS);
  }

  async function preloadTicketFromUrl() {
    const ticketId = new URLSearchParams(window.location.search).get("ticket_id");
    if (!ticketId) {
      return;
    }
    const ticket = await window.AMApi.getTicketById(ticketId);
    if (ticket) {
      openCreateModal(ticket);
    }
  }

  async function init() {
    attachLogout();
    attachEvents();
    setActiveFilter(currentFilter);
    try {
      const access = await window.AMApi.requireInternalAccess();
      if (!access) {
        return;
      }
      await Promise.allSettled([loadSummary(), loadReminders()]);
      await preloadTicketFromUrl();
      startRelativeTimeTimer();
    } catch (error) {
      showNotice(notice, "error", error.message);
      setListState("error", "Không thể tải lịch hẹn. Vui lòng thử lại.", { label: "Thử lại", handler: loadReminders });
    }
  }

  document.addEventListener("DOMContentLoaded", init);
  window.addEventListener("beforeunload", function () {
    window.clearTimeout(searchTimerId);
    window.clearTimeout(ticketSearchTimerId);
    if (relativeTimeTimerId) {
      window.clearInterval(relativeTimeTimerId);
    }
  });
})();

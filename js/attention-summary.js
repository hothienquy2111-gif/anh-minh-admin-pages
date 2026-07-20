(function () {
  "use strict";

  const notice = document.getElementById("attentionNotice");
  const todayText = document.getElementById("attentionTodayText");
  const summaryTitle = document.getElementById("attentionSummaryTitle");
  const summaryText = document.getElementById("attentionSummaryText");
  const totalCount = document.getElementById("attentionTotalCount");
  const taskSummary = document.getElementById("attentionTaskSummary");
  const taskState = document.getElementById("attentionTaskState");
  const taskList = document.getElementById("attentionTaskList");
  const pagination = document.getElementById("attentionPagination");
  const activeProcessingState = document.getElementById("activeProcessingState");
  const activeProcessingContent = document.getElementById("activeProcessingContent");
  const activeProcessingChart = document.getElementById("activeProcessingChart");
  const activeProcessingSummary = document.getElementById("activeProcessingSummary");
  const weeklyIntakeState = document.getElementById("weeklyIntakeState");
  const weeklyIntakeContent = document.getElementById("weeklyIntakeContent");
  const weeklyIntakeChart = document.getElementById("weeklyIntakeChart");
  const weeklyIntakeStats = document.getElementById("weeklyIntakeStats");
  const weeklyIntakeSummary = document.getElementById("weeklyIntakeSummary");
  const weeklyIntakeRange = document.getElementById("weeklyIntakeRange");
  const weeklyPrevButton = document.getElementById("weeklyIntakePrevWeek");
  const weeklyCurrentButton = document.getElementById("weeklyIntakeCurrentWeek");
  const weeklyNextButton = document.getElementById("weeklyIntakeNextWeek");
  const reminderSection = document.getElementById("attentionReminderSection");
  const reminderSummary = document.getElementById("attentionReminderSummary");
  const reminderState = document.getElementById("attentionReminderState");
  const reminderList = document.getElementById("attentionReminderList");
  const reminderPagination = document.getElementById("attentionReminderPagination");
  const reminderCountMap = {
    all: document.getElementById("attentionReminderCountAll"),
    overdue: document.getElementById("attentionReminderCountOverdue"),
    today: document.getElementById("attentionReminderCountToday"),
    upcoming: document.getElementById("attentionReminderCountUpcoming")
  };
  const handoverSection = document.getElementById("attentionHandoverSection");
  const handoverSummary = document.getElementById("attentionHandoverSummary");
  const handoverState = document.getElementById("attentionHandoverState");
  const handoverList = document.getElementById("attentionHandoverList");
  const handoverCountMap = {
    all: document.getElementById("attentionHandoverCountAll"),
    under24: document.getElementById("attentionHandoverCountUnder24"),
    warning: document.getElementById("attentionHandoverCountWarning"),
    over48: document.getElementById("attentionHandoverCountOver48")
  };

  const countMap = {
    all: document.getElementById("attentionCountAll"),
    needsInspection: document.getElementById("attentionCountInspection"),
    repairing: document.getElementById("attentionCountRepairing"),
    repair48: document.getElementById("attentionCountRepair48"),
    repair72: document.getElementById("attentionCountRepair72"),
    deliveryToday: document.getElementById("attentionCountDelivery"),
    handoverOverdue: document.getElementById("attentionCountHandover")
  };

  const PAGE_SIZE = 8;
  const REMINDER_PAGE_SIZE = 6;
  const HANDOVER_PREVIEW_SIZE = 6;
  const FILTER_LABELS = {
    all: "Tất cả",
    NEEDS_INSPECTION: "Cần kiểm tra",
    REPAIRING: "Đang sửa",
    REPAIR_OVERDUE_48: "Quá 48 giờ",
    REPAIR_OVERDUE_72: "Quá 72 giờ",
    DELIVERY_TODAY: "Giao/trả hôm nay",
    HANDOVER_OVERDUE: "Bàn giao quá 48 giờ"
  };

  let allTasks = [];
  let activeFilter = "all";
  let currentPage = 1;
  let weeklyIntakeOffset = 0;
  let weeklyIntakeRequestId = 0;
  let activeProcessingRequestId = 0;
  let attentionTaskRequestId = 0;
  let refreshTimerId = null;
  let reminderFilter = "needs_action";
  let reminderPage = 1;
  let reminderRows = [];
  let reminderTotal = 0;
  let reminderImmediateCount = 0;
  let reminderRequestId = 0;
  let handoverFilter = "all";
  let handoverRows = [];
  let handoverRequestId = 0;

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

  function setTodayText() {
    if (!todayText) {
      return;
    }

    const formatted = new Intl.DateTimeFormat("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(new Date());

    todayText.textContent = formatted;
  }

  function formatYmdDate(ymd) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));

    if (!match) {
      return "—";
    }

    return `${match[3]}/${match[2]}/${match[1]}`;
  }

  function formatWeekRange(payload) {
    if (!payload || !payload.weekStart || !payload.weekEnd) {
      return "Chưa có khoảng tuần";
    }

    return `${formatYmdDate(payload.weekStart)} – ${formatYmdDate(payload.weekEnd)}`;
  }

  function formatAverage(value) {
    const number = Number(value) || 0;
    return number.toLocaleString("vi-VN", {
      minimumFractionDigits: number % 1 === 0 ? 0 : 1,
      maximumFractionDigits: 1
    });
  }

  function textOrDash(value) {
    const text = String(value || "").trim();
    return text || "—";
  }

  function parseTime(value) {
    const time = Date.parse(value || "");
    return Number.isFinite(time) ? time : 0;
  }

  function minutesSince(value) {
    const time = parseTime(value);
    return time ? Math.max(0, Math.floor((Date.now() - time) / 60000)) : 0;
  }

  function formatAgeMinutes(minutes) {
    const safeMinutes = Math.max(0, Number(minutes) || 0);
    const days = Math.floor(safeMinutes / 1440);
    const hours = Math.floor((safeMinutes % 1440) / 60);
    const mins = Math.floor(safeMinutes % 60);

    if (days > 0) {
      return `${days} ngày ${hours} giờ`;
    }

    if (hours > 0) {
      return `${hours} giờ ${mins} phút`;
    }

    return `${mins} phút`;
  }

  function priorityFromAge(ageMinutes) {
    if (ageMinutes >= 72 * 60) {
      return {
        priority: "urgent",
        priorityLabel: "Khẩn cấp",
        priorityRank: 1
      };
    }

    if (ageMinutes >= 48 * 60) {
      return {
        priority: "high",
        priorityLabel: "Ưu tiên cao",
        priorityRank: 2
      };
    }

    return {
      priority: "attention",
      priorityLabel: "Cần chú ý",
      priorityRank: 3
    };
  }

  function refreshRepairReason(task, reason) {
    if (!reason || reason.type !== "REPAIRING") {
      return reason;
    }

    if (!task.repairStartedAt) {
      return Object.assign({}, reason, {
        label: "Thiếu mốc sửa",
        description: "Thiếu thời điểm bắt đầu sửa"
      });
    }

    const ageMinutes = minutesSince(task.repairStartedAt);

    if (ageMinutes >= 72 * 60) {
      return Object.assign({}, reason, {
        label: "Quá 72 giờ",
        description: "Ưu tiên cao — đang sửa quá 72 giờ"
      });
    }

    if (ageMinutes >= 48 * 60) {
      return Object.assign({}, reason, {
        label: "Quá 48 giờ",
        description: "Đang sửa quá 48 giờ"
      });
    }

    return Object.assign({}, reason, {
      label: "Đang sửa",
      description: "Đang sửa chữa"
    });
  }

  function refreshHandoverReason(task, reason) {
    if (!reason || reason.type !== "HANDOVER_OVERDUE" || !task.readyForHandoverAt) {
      return reason;
    }

    const overdueMinutes = Math.max(0, minutesSince(task.readyForHandoverAt) - (48 * 60));
    return Object.assign({}, reason, {
      label: "Quá 48 giờ",
      description: `Chờ bàn giao quá ${formatAgeMinutes(overdueMinutes)}`
    });
  }

  function refreshTask(task) {
    const ageMinutes = minutesSince(task.attentionStartedAt);
    const priority = priorityFromAge(ageMinutes);
    const reasons = (task.reasons || []).map((reason) => refreshHandoverReason(task, refreshRepairReason(task, reason)));

    return Object.assign({}, task, priority, {
      ageMinutes,
      reasons,
      typeLabel: reasons.map((reason) => reason.label).filter(Boolean).join(" · "),
      reason: reasons.map((reason) => reason.description).filter(Boolean).join(" · ")
    });
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

  function createStatusBadge(status) {
    const badge = document.createElement("span");
    badge.className = `status-pill ${statusClass(status)}`.trim();
    badge.textContent = statusLabel(status);
    return badge;
  }

  function taskHasReason(task, type) {
    return Boolean(task && task.reasons && task.reasons.some((reason) => reason.type === type));
  }

  function isRepairOverdue(task, hours) {
    return taskHasReason(task, "REPAIRING")
      && Boolean(task.repairStartedAt)
      && minutesSince(task.repairStartedAt) >= hours * 60;
  }

  function taskMatchesFilter(task) {
    if (activeFilter === "all") {
      return true;
    }

    if (activeFilter === "REPAIR_OVERDUE_48") {
      return isRepairOverdue(task, 48);
    }

    if (activeFilter === "REPAIR_OVERDUE_72") {
      return isRepairOverdue(task, 72);
    }

    return taskHasReason(task, activeFilter);
  }

  function filteredTasks() {
    const filtered = allTasks.filter(taskMatchesFilter);
    return window.AMApi.sortAttentionTasks(filtered);
  }

  function countByFilter(filter) {
    const originalFilter = activeFilter;
    activeFilter = filter;
    const count = allTasks.filter(taskMatchesFilter).length;
    activeFilter = originalFilter;
    return count;
  }

  function renderCounts() {
    const counts = {
      all: allTasks.length,
      needsInspection: countByFilter("NEEDS_INSPECTION"),
      repairing: countByFilter("REPAIRING"),
      repair48: countByFilter("REPAIR_OVERDUE_48"),
      repair72: countByFilter("REPAIR_OVERDUE_72"),
      deliveryToday: countByFilter("DELIVERY_TODAY"),
      handoverOverdue: countByFilter("HANDOVER_OVERDUE")
    };

    Object.entries(countMap).forEach(([key, element]) => {
      if (element) {
        element.textContent = String(counts[key] || 0);
      }
    });

    const totalWork = counts.all + reminderImmediateCount;

    if (totalCount) {
      totalCount.textContent = String(totalWork);
    }

    if (summaryTitle) {
      summaryTitle.textContent = totalWork > 0
        ? `Hiện có ${totalWork} việc cần ưu tiên xử lý.`
        : "Hiện chưa có việc cần ưu tiên";
    }

    if (summaryText) {
      summaryText.textContent = totalWork > 0
        ? `${counts.all} phiếu cần chú ý và ${reminderImmediateCount} lịch hẹn quá hạn hoặc đến hạn hôm nay.`
        : "Hiện không có phiếu hoặc lịch hẹn nào cần ưu tiên xử lý.";
    }
  }

  function setState(type, message, retryHandler) {
    if (!taskState || !taskList) {
      return;
    }

    const section = taskState.closest("section");
    const hasVisibleData = !taskList.hidden && taskList.childElementCount > 0;
    if (type === "loading" && hasVisibleData) {
      taskState.textContent = "";
      window.AMUI.setSectionState({ section, stateElement: taskState, dataElement: taskList }, "refreshing");
      return;
    }

    taskState.replaceChildren(document.createTextNode(message));

    if (retryHandler) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn secondary compact";
      button.textContent = "Thử lại";
      button.addEventListener("click", retryHandler);
      taskState.appendChild(button);
    }

    taskList.replaceChildren();
    window.AMUI.setSectionState({ section, stateElement: taskState, dataElement: taskList }, type);

    if (pagination) {
      pagination.hidden = true;
      pagination.replaceChildren();
    }
  }

  function setChartState(stateEl, contentEl, type, message, retryHandler) {
    if (!stateEl || !contentEl) {
      return;
    }

    const container = contentEl.closest("article, section") || contentEl.parentElement;
    const hasVisibleData = !contentEl.hidden && contentEl.childElementCount > 0;
    if (type === "loading" && hasVisibleData) {
      stateEl.textContent = "";
      window.AMUI.setSectionState({ section: container, stateElement: stateEl, dataElement: contentEl }, "refreshing");
      return;
    }

    stateEl.replaceChildren(document.createTextNode(message));

    if (retryHandler) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn secondary compact";
      button.textContent = "Thử lại";
      button.addEventListener("click", retryHandler);
      stateEl.appendChild(button);
    }

    window.AMUI.setSectionState({ section: container, stateElement: stateEl, dataElement: contentEl }, type);
  }

  function showChartContent(stateEl, contentEl) {
    if (!stateEl || !contentEl) {
      return;
    }

    stateEl.textContent = "";
    const container = contentEl.closest("article, section") || contentEl.parentElement;
    window.AMUI.setSectionState({ section: container, stateElement: stateEl, dataElement: contentEl }, "data");
  }

  function showList() {
    taskState.textContent = "";
    window.AMUI.setSectionState({
      section: taskState.closest("section"),
      stateElement: taskState,
      dataElement: taskList
    }, "data");
  }

  function renderActiveProcessingChart(payload) {
    const total = payload.total || 0;

    if (!activeProcessingChart || !activeProcessingSummary) {
      return;
    }

    activeProcessingChart.replaceChildren();

    if (!total) {
      setChartState(activeProcessingState, activeProcessingContent, "empty", "Hiện không có phiếu đang trong quá trình xử lý.");
      return;
    }

    const fragment = document.createDocumentFragment();

    (payload.groups || []).forEach((group) => {
      const row = document.createElement("div");
      const header = document.createElement("div");
      const label = document.createElement("span");
      const value = document.createElement("strong");
      const track = document.createElement("span");
      const fill = document.createElement("span");
      const percentText = document.createElement("span");

      row.className = `attention-progress-row attention-progress-row--${group.tone || "neutral"}`;
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", `${group.label}: ${group.count} phiếu, ${group.percent}%`);

      header.className = "attention-progress-row-header";
      label.textContent = group.label;
      value.textContent = `${group.count} phiếu`;
      header.append(label, value);

      track.className = "attention-progress-track";
      fill.className = "attention-progress-fill";
      fill.style.width = `${Math.max(group.percent || 0, group.count > 0 ? 4 : 0)}%`;
      percentText.className = "attention-progress-percent";
      percentText.textContent = `${group.percent || 0}%`;
      track.append(fill, percentText);

      row.append(header, track);
      fragment.appendChild(row);
    });

    activeProcessingChart.replaceChildren(fragment);
    activeProcessingSummary.textContent = payload.summary || `Hiện có ${total} phiếu đang xử lý.`;
    showChartContent(activeProcessingState, activeProcessingContent);
  }

  function updateWeeklyControls(payload, loading) {
    const isCurrentWeek = !payload || Number(payload.weekOffset || 0) === 0;

    if (weeklyIntakeRange) {
      weeklyIntakeRange.textContent = payload ? formatWeekRange(payload) : "Đang tải khoảng tuần...";
    }

    if (weeklyPrevButton) {
      weeklyPrevButton.disabled = Boolean(loading);
    }

    if (weeklyCurrentButton) {
      weeklyCurrentButton.disabled = Boolean(loading) || isCurrentWeek;
    }

    if (weeklyNextButton) {
      weeklyNextButton.disabled = Boolean(loading) || isCurrentWeek || !(payload && payload.canGoNext);
    }
  }

  function renderWeeklyIntakeChart(payload) {
    const total = payload.total || 0;

    if (!weeklyIntakeChart || !weeklyIntakeSummary || !weeklyIntakeStats) {
      return;
    }

    weeklyIntakeChart.replaceChildren();
    weeklyIntakeStats.replaceChildren();
    updateWeeklyControls(payload, false);

    const fragment = document.createDocumentFragment();

    (payload.days || []).forEach((day) => {
      const item = document.createElement("div");
      const value = document.createElement("strong");
      const barWrap = document.createElement("span");
      const bar = document.createElement("span");
      const label = document.createElement("b");
      const dateText = formatYmdDate(day.date);

      item.className = [
        "attention-intake-bar",
        day.isPeak ? "is-peak" : "",
        day.isToday ? "is-today" : ""
      ].filter(Boolean).join(" ");
      item.setAttribute("role", "group");
      item.setAttribute("aria-label", `${day.label}, ${dateText}: ${day.count} phiếu`);
      item.title = `${day.label}, ${dateText}: ${day.count} phiếu`;

      value.textContent = String(day.count);
      barWrap.className = "attention-intake-bar-track";
      bar.className = "attention-intake-bar-fill";
      bar.style.height = `${Math.max(day.percent || 0, day.count > 0 ? 8 : 3)}%`;
      barWrap.appendChild(bar);
      label.textContent = day.shortLabel || day.label;

      item.append(value, barWrap, label);
      fragment.appendChild(item);
    });

    weeklyIntakeStats.append(
      createMeta("Tổng tuần", `${total} phiếu`),
      createMeta("Trung bình", `${formatAverage(payload.average)} phiếu/ngày`),
      createMeta("Cao nhất", payload.peak ? `${payload.peak.label} — ${payload.peak.count} phiếu` : "Chưa có dữ liệu")
    );

    weeklyIntakeChart.replaceChildren(fragment);
    weeklyIntakeSummary.textContent = total > 0 && payload.peak
      ? `Tuần này tiếp nhận ${total} phiếu; ${payload.peak.label} cao nhất với ${payload.peak.count} phiếu.`
      : "Tuần này chưa có phiếu tiếp nhận.";
    showChartContent(weeklyIntakeState, weeklyIntakeContent);
  }

  async function loadActiveProcessingChart() {
    const requestId = activeProcessingRequestId + 1;
    activeProcessingRequestId = requestId;
    setChartState(activeProcessingState, activeProcessingContent, "loading", "Đang tải dữ liệu biểu đồ…");

    try {
      const payload = await window.AMApi.getActiveProcessingSummary();
      if (requestId !== activeProcessingRequestId) {
        return;
      }
      renderActiveProcessingChart(payload);
    } catch (error) {
      if (requestId !== activeProcessingRequestId) {
        return;
      }
      setChartState(activeProcessingState, activeProcessingContent, "error", "Không thể tải dữ liệu biểu đồ.", loadActiveProcessingChart);
    }
  }

  async function loadWeeklyIntakeChart() {
    const requestId = weeklyIntakeRequestId + 1;
    weeklyIntakeRequestId = requestId;
    updateWeeklyControls(null, true);
    setChartState(weeklyIntakeState, weeklyIntakeContent, "loading", "Đang tải dữ liệu tiếp nhận trong tuần…");

    try {
      const payload = await window.AMApi.getWeeklyIntakeSummary({ weekOffset: weeklyIntakeOffset });

      if (requestId !== weeklyIntakeRequestId) {
        return;
      }

      renderWeeklyIntakeChart(payload);
    } catch (error) {
      if (requestId !== weeklyIntakeRequestId) {
        return;
      }

      updateWeeklyControls({ weekOffset: weeklyIntakeOffset, canGoNext: weeklyIntakeOffset < 0 }, false);
      setChartState(weeklyIntakeState, weeklyIntakeContent, "error", "Không thể tải dữ liệu tiếp nhận trong tuần.", loadWeeklyIntakeChart);
    }
  }

  function createReasonBadges(task) {
    const wrapper = document.createElement("div");
    const reasons = task.reasons && task.reasons.length
      ? task.reasons
      : [{ label: task.typeLabel, description: task.reason }];

    wrapper.className = "attention-reason-list";

    reasons.forEach((reason) => {
      const badge = document.createElement("span");
      badge.className = "ops-work-reason";
      badge.textContent = reason.description || reason.label || "Cần xử lý";
      wrapper.appendChild(badge);
    });

    return wrapper;
  }

  function createMeta(label, value) {
    const item = document.createElement("span");
    const key = document.createElement("b");
    const text = document.createElement("span");

    key.textContent = label;
    text.textContent = textOrDash(value);
    item.append(key, text);
    return item;
  }

  function createPriorityBadge(task) {
    const badge = document.createElement("span");
    badge.className = `attention-priority attention-priority-${task.priority || "attention"}`;
    badge.textContent = task.priorityLabel || "Cần chú ý";
    return badge;
  }

  function createActionLink(href, label, primary) {
    const link = document.createElement("a");
    link.className = primary ? "btn primary compact" : "btn secondary compact";
    link.href = href || "search.html";
    link.textContent = label;
    return link;
  }

  function renderTaskItem(task) {
    const item = document.createElement("article");
    const main = document.createElement("div");
    const title = document.createElement("strong");
    const customer = document.createElement("p");
    const meta = document.createElement("div");
    const side = document.createElement("div");
    const actions = document.createElement("div");
    const identity = [
      window.AMApi.formatTicketCode(task.ticketCode),
      window.AMApi.formatCustomerCode(task.customerCode)
    ]
      .filter((value) => value !== "—")
      .join(" · ");
    const modelText = task.brandModel || task.model || task.deviceType;
    const customerLine = [textOrDash(task.customerName), textOrDash(modelText)]
      .filter((value) => value !== "—")
      .join(" · ");

    item.className = `attention-task-item attention-task-${task.priority || "attention"}`;
    main.className = "attention-task-main";
    title.textContent = identity || "Phiếu cần chú ý";
    customer.textContent = customerLine || "Chưa có thông tin khách/model";

    meta.className = "attention-task-meta";
    meta.append(
      createMeta("Thời gian tồn đọng", formatAgeMinutes(task.ageMinutes)),
      createMeta("Trạng thái", statusLabel(task.status))
    );

    side.className = "attention-task-side";
    side.append(createPriorityBadge(task), createStatusBadge(task.status));

    actions.className = "attention-task-actions";
    actions.appendChild(createActionLink(task.viewHref, "Xem phiếu", true));

    if (task.actionHref && task.actionHref !== task.viewHref && task.actionLabel !== "Xem phiếu") {
      actions.appendChild(createActionLink(task.actionHref, task.actionLabel || "Mở Hoạt động phiếu", false));
    }

    main.append(title, customer, createReasonBadges(task), meta);
    item.append(main, side, actions);
    return item;
  }

  function visiblePages(pageCount, page) {
    if (pageCount <= 5) {
      return Array.from({ length: pageCount }, (_, index) => index + 1);
    }

    const pages = [1];
    const start = Math.max(2, page - 1);
    const end = Math.min(pageCount - 1, page + 1);

    if (start > 2) {
      pages.push("start-ellipsis");
    }

    for (let index = start; index <= end; index += 1) {
      pages.push(index);
    }

    if (end < pageCount - 1) {
      pages.push("end-ellipsis");
    }

    pages.push(pageCount);
    return pages;
  }

  function scrollToListStart() {
    const target = document.getElementById("attentionTaskTitle") || taskList;

    if (!target) {
      return;
    }

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "start"
    });
  }

  function setPage(page) {
    currentPage = page;
    renderTasks(true);
  }

  function renderPagination(payload) {
    if (!pagination) {
      return;
    }

    pagination.replaceChildren();

    if (payload.totalPages <= 1) {
      pagination.hidden = true;
      return;
    }

    const previous = document.createElement("button");
    const next = document.createElement("button");
    const status = document.createElement("span");

    pagination.hidden = false;
    previous.type = "button";
    previous.textContent = "← Trước";
    previous.disabled = payload.page === 1;
    previous.addEventListener("click", () => setPage(payload.page - 1));
    pagination.appendChild(previous);

    visiblePages(payload.totalPages, payload.page).forEach((page) => {
      if (typeof page !== "number") {
        const ellipsis = document.createElement("span");
        ellipsis.className = "pagination-ellipsis";
        ellipsis.textContent = "...";
        pagination.appendChild(ellipsis);
        return;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.textContent = String(page);
      button.className = page === payload.page ? "active" : "";
      button.setAttribute("aria-label", `Trang ${page}`);

      if (page === payload.page) {
        button.setAttribute("aria-current", "page");
      }

      button.addEventListener("click", () => setPage(page));
      pagination.appendChild(button);
    });

    status.className = "attention-pagination-status";
    status.textContent = `Trang ${payload.page}/${payload.totalPages}`;
    pagination.appendChild(status);

    next.type = "button";
    next.textContent = "Sau →";
    next.disabled = payload.page === payload.totalPages;
    next.addEventListener("click", () => setPage(payload.page + 1));
    pagination.appendChild(next);
  }

  function renderTaskSummary(payload) {
    if (!taskSummary) {
      return;
    }

    if (payload.total === 0) {
      taskSummary.textContent = activeFilter === "all"
        ? "Hiện không có phiếu nào cần ưu tiên xử lý."
        : `Không có phiếu thuộc nhóm ${FILTER_LABELS[activeFilter] || "đã chọn"}.`;
      return;
    }

    taskSummary.textContent = `Đang hiển thị ${payload.startIndex + 1}–${payload.endIndex} trên tổng số ${payload.total} phiếu.`;
  }

  function renderTasks(shouldScroll) {
    const tasks = filteredTasks();
    const pagePayload = window.AMApi.paginateAttentionTasks(tasks, currentPage, PAGE_SIZE);

    currentPage = pagePayload.page;

    document.querySelectorAll(".attention-chip").forEach((button) => {
      const isActive = button.dataset.filter === activeFilter;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });

    renderTaskSummary(pagePayload);

    if (pagePayload.total === 0) {
      setState("empty", activeFilter === "all"
        ? "Hiện không có phiếu nào cần ưu tiên xử lý."
        : "Nhóm này hiện chưa có phiếu cần ưu tiên xử lý.");
      return;
    }

    const fragment = document.createDocumentFragment();
    pagePayload.items.forEach((task) => {
      fragment.appendChild(renderTaskItem(task));
    });

    taskList.replaceChildren(fragment);
    showList();
    renderPagination(pagePayload);

    if (shouldScroll) {
      scrollToListStart();
    }
  }

  function refreshVisibleTasks() {
    allTasks = window.AMApi.sortAttentionTasks(allTasks.map(refreshTask));
    renderCounts();
    renderTasks(false);
    refreshVisibleReminders();
    refreshVisibleHandovers();
  }

  function startRefreshTimer() {
    stopRefreshTimer();

    if (!allTasks.length && !reminderRows.length && !handoverRows.length) {
      return;
    }

    refreshTimerId = window.setInterval(refreshVisibleTasks, 60000);
  }

  function stopRefreshTimer() {
    if (refreshTimerId) {
      window.clearInterval(refreshTimerId);
      refreshTimerId = null;
    }
  }

  async function loadAttentionTasks() {
    const requestId = attentionTaskRequestId + 1;
    attentionTaskRequestId = requestId;
    stopRefreshTimer();
    setState("loading", "Đang tải danh sách việc cần chú ý…");

    try {
      const payload = await window.AMApi.getAttentionTasks();
      if (requestId !== attentionTaskRequestId) {
        return;
      }
      allTasks = window.AMApi.sortAttentionTasks((payload.tasks || []).map(refreshTask));
      currentPage = 1;
      renderCounts();
      renderTasks(false);
      startRefreshTimer();

      if (payload.partialErrors && payload.partialErrors.length > 0) {
        showNotice("error", "Một số nhóm dữ liệu việc cần chú ý chưa tải được. Vui lòng thử lại.");
      } else {
        clearNotice();
      }
    } catch (error) {
      if (requestId !== attentionTaskRequestId) {
        return;
      }
      allTasks = [];
      renderCounts();
      showNotice("error", error.message || "Không thể tải danh sách việc cần chú ý.");
      setState("error", "Không thể tải danh sách việc cần chú ý.", loadAttentionTasks);
    }
  }

  function reminderText(value) {
    const text = String(value || "").trim();
    return text || "—";
  }

  function handoverCustomerName(ticket) {
    return ticket.customer_master_name || ticket.customer_name || "";
  }

  function handoverCustomerPhone(ticket) {
    return ticket.customer_master_phone || ticket.customer_phone || "";
  }

  function createHandoverDetail(label, value, className) {
    const detail = document.createElement("div");
    const key = document.createElement("span");
    const content = document.createElement("strong");

    detail.className = "attention-handover-detail";
    key.textContent = label;
    content.textContent = reminderText(value);
    if (className) {
      content.className = className;
    }
    detail.append(key, content);
    return detail;
  }

  function renderAttentionHandover(ticket) {
    const timing = window.AMApi.classifyHandoverTiming(ticket);
    const item = document.createElement("article");
    const main = document.createElement("div");
    const heading = document.createElement("div");
    const code = document.createElement("h3");
    const badge = document.createElement("span");
    const details = document.createElement("div");
    const actions = document.createElement("div");
    const view = document.createElement("a");
    const complete = document.createElement("a");
    const query = ticket.ticket_code
      ? `code=${encodeURIComponent(ticket.ticket_code)}`
      : `id=${encodeURIComponent(ticket.id || "")}`;

    item.className = `attention-handover-item attention-handover-item--${timing.level}`;
    item.dataset.attentionHandoverId = ticket.id || "";
    main.className = "attention-handover-main";
    heading.className = "attention-handover-heading";
    code.textContent = window.AMApi.formatTicketCode(ticket.ticket_code);
    badge.className = `handover-alert handover-alert--${timing.level}`;
    badge.dataset.attentionHandoverBadge = ticket.id || "";
    badge.textContent = timing.badge;
    heading.append(code, badge);

    details.className = "attention-handover-detail-grid";
    details.append(
      createHandoverDetail("Mã khách", window.AMApi.formatCustomerCode(ticket.customer_code), "attention-handover-code"),
      createHandoverDetail("Khách hàng", handoverCustomerName(ticket)),
      createHandoverDetail("Số điện thoại", handoverCustomerPhone(ticket)),
      createHandoverDetail("Hãng / Model", [ticket.brand, ticket.model].filter(Boolean).join(" ")),
      createHandoverDetail("Sửa xong lúc", window.AMApi.formatHandoverDateTime(ticket.ready_for_handover_at)),
      createHandoverDetail("Thời gian chờ", timing.text, `attention-handover-wait attention-handover-wait--${timing.level}`)
    );
    details.lastElementChild.querySelector("strong").dataset.attentionHandoverWait = ticket.id || "";
    main.append(heading, details);

    actions.className = "attention-handover-actions";
    view.className = "btn secondary compact";
    view.href = `search.html?${query}`;
    view.textContent = "Xem phiếu";
    complete.className = "btn primary compact";
    complete.href = `print-delivery-receipt.html?${query}`;
    complete.textContent = "Hoàn tất bàn giao";
    actions.append(view, complete);
    item.append(main, actions);
    return item;
  }

  function setHandoverState(type, message, retryHandler) {
    const hasVisibleData = !handoverList.hidden && handoverList.childElementCount > 0;
    if (type === "loading" && hasVisibleData) {
      handoverState.textContent = "";
      window.AMUI.setSectionState({
        section: handoverSection,
        stateElement: handoverState,
        dataElement: handoverList
      }, "refreshing");
      return;
    }

    handoverState.replaceChildren(document.createTextNode(message));
    window.AMUI.setSectionState({
      section: handoverSection,
      stateElement: handoverState,
      dataElement: handoverList
    }, type);

    if (retryHandler) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "btn secondary compact";
      retry.textContent = "Thử lại";
      retry.addEventListener("click", retryHandler, { once: true });
      handoverState.appendChild(retry);
    }
  }

  function renderHandoverCounts(counts) {
    Object.entries(handoverCountMap).forEach(([key, element]) => {
      element.textContent = String(Number(counts && counts[key]) || 0);
    });
  }

  function renderHandoverRows(payload) {
    handoverRows = (payload.tickets || []).slice(0, HANDOVER_PREVIEW_SIZE);
    renderHandoverCounts(payload.filterCounts || {});

    if (!handoverRows.length) {
      handoverSummary.textContent = "Hiện không có tivi chờ bàn giao.";
      setHandoverState("empty", "Hiện không có tivi chờ bàn giao.");
      return;
    }

    const fragment = document.createDocumentFragment();
    handoverRows.forEach((ticket) => fragment.appendChild(renderAttentionHandover(ticket)));
    handoverList.replaceChildren(fragment);
    handoverState.textContent = "";
    window.AMUI.setSectionState({
      section: handoverSection,
      stateElement: handoverState,
      dataElement: handoverList
    }, "data");
    handoverSummary.textContent = `Đang hiển thị ${handoverRows.length} trên tổng số ${payload.totalCount || 0} tivi chờ bàn giao.`;
  }

  function refreshVisibleHandovers() {
    handoverRows.forEach((ticket) => {
      const id = ticket.id || "";
      const timing = window.AMApi.classifyHandoverTiming(ticket);
      const item = handoverList.querySelector(`[data-attention-handover-id="${id}"]`);
      const badge = handoverList.querySelector(`[data-attention-handover-badge="${id}"]`);
      const wait = handoverList.querySelector(`[data-attention-handover-wait="${id}"]`);

      if (item) {
        item.className = `attention-handover-item attention-handover-item--${timing.level}`;
      }
      if (badge) {
        badge.className = `handover-alert handover-alert--${timing.level}`;
        badge.textContent = timing.badge;
      }
      if (wait) {
        wait.className = `attention-handover-wait attention-handover-wait--${timing.level}`;
        wait.textContent = timing.text;
      }
    });
  }

  async function loadAttentionHandovers(shouldScroll) {
    const requestId = handoverRequestId + 1;
    handoverRequestId = requestId;
    setHandoverState("loading", "Đang tải danh sách bàn giao…");

    try {
      const payload = await window.AMApi.getHandoverTickets({
        page: 1,
        pageSize: HANDOVER_PREVIEW_SIZE,
        filter: handoverFilter
      });

      if (requestId !== handoverRequestId) {
        return;
      }

      if (!payload.available) {
        handoverRows = [];
        renderHandoverCounts(payload.filterCounts || {});
        handoverSummary.textContent = "Chức năng bàn giao đang chờ kích hoạt.";
        setHandoverState("unavailable", payload.message || "Chức năng Bàn giao tivi chưa được kích hoạt trên Supabase.");
        return;
      }

      renderHandoverRows(payload);
      startRefreshTimer();

      if (shouldScroll === true) {
        const reduceMotion = window.AMUI
          ? window.AMUI.prefersReducedMotion()
          : window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        handoverSection.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      }
    } catch (error) {
      if (requestId !== handoverRequestId) {
        return;
      }
      handoverRows = [];
      renderHandoverCounts({});
      handoverSummary.textContent = "Không thể tải dữ liệu bàn giao.";
      setHandoverState("error", "Không thể tải danh sách bàn giao. Vui lòng thử lại.", () => loadAttentionHandovers(false));
    }
  }

  function createReminderBadge(reminder) {
    const timing = window.AMReminderUtils.classifyReminderTiming(reminder);
    const labels = { overdue: "Quá hạn", today: "Hôm nay", upcoming: "Sắp tới", unknown: "Chưa rõ" };
    const badge = document.createElement("span");
    badge.className = `reminder-timing-badge reminder-timing-badge--${timing}`;
    badge.textContent = labels[timing] || labels.unknown;
    return badge;
  }

  function createReminderDetail(label, value, className) {
    const detail = document.createElement("div");
    const key = document.createElement("span");
    const content = document.createElement("strong");

    detail.className = "attention-reminder-detail";
    key.textContent = label;
    content.textContent = reminderText(value);
    if (className) {
      content.className = className;
    }
    detail.append(key, content);
    return detail;
  }

  function renderAttentionReminder(reminder) {
    const item = document.createElement("article");
    const main = document.createElement("div");
    const heading = document.createElement("div");
    const type = document.createElement("span");
    const title = document.createElement("h3");
    const timing = document.createElement("p");
    const details = document.createElement("div");
    const note = document.createElement("p");
    const actions = document.createElement("div");
    const view = document.createElement("a");
    const complete = document.createElement("button");

    item.className = "attention-reminder-item";
    item.dataset.reminderId = reminder.id;
    main.className = "attention-reminder-main";
    heading.className = "attention-reminder-heading";
    type.className = "attention-reminder-type";
    type.textContent = window.AMReminderUtils.typeLabel(reminder.reminder_type);
    title.textContent = reminderText(reminder.title);
    timing.className = "attention-reminder-time";
    timing.dataset.reminderTime = reminder.id;
    timing.textContent = window.AMReminderUtils.formatReminderRelativeTime(reminder);
    details.className = "attention-reminder-detail-grid";
    details.append(
      createReminderDetail("Mã phiếu", window.AMApi.formatTicketCode(reminder.ticket_code), "attention-reminder-code"),
      createReminderDetail("Mã khách", window.AMApi.formatCustomerCode(reminder.customer_code), "attention-reminder-code"),
      createReminderDetail("Khách hàng", reminder.customer_name),
      createReminderDetail("Số điện thoại", reminder.customer_phone),
      createReminderDetail("Hãng / Model", [reminder.device_brand, reminder.device_model].filter(Boolean).join(" ")),
      createReminderDetail("Trạng thái", "Đang chờ xử lý", "attention-reminder-pending")
    );
    heading.append(createReminderBadge(reminder), type, title);
    main.append(heading, timing, details);

    if (String(reminder.note || "").trim()) {
      note.className = "attention-reminder-note";
      note.textContent = reminder.note.trim();
      main.appendChild(note);
    }

    actions.className = "attention-reminder-actions";
    view.className = "btn secondary compact";
    view.href = `search.html?code=${encodeURIComponent(reminder.ticket_code || "")}`;
    view.textContent = "Xem phiếu";
    complete.type = "button";
    complete.className = "btn primary compact";
    complete.textContent = "Hoàn thành";
    complete.dataset.attentionReminderComplete = reminder.id;
    actions.append(view, complete);
    item.append(main, actions);
    return item;
  }

  function setReminderState(type, message, retryHandler) {
    const hasVisibleData = !reminderList.hidden && reminderList.childElementCount > 0;
    if (type === "loading" && hasVisibleData) {
      reminderState.textContent = "";
      window.AMUI.setSectionState({
        section: reminderSection,
        stateElement: reminderState,
        dataElement: reminderList
      }, "refreshing");
      return;
    }

    reminderState.replaceChildren(document.createTextNode(message));
    reminderPagination.hidden = true;
    window.AMUI.setSectionState({
      section: reminderSection,
      stateElement: reminderState,
      dataElement: reminderList
    }, type);

    if (retryHandler) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "btn secondary compact";
      retry.textContent = "Thử lại";
      retry.addEventListener("click", retryHandler, { once: true });
      reminderState.appendChild(retry);
    }
  }

  function renderReminderPagination(payload) {
    reminderPagination.replaceChildren();

    if (payload.totalPages <= 1) {
      reminderPagination.hidden = true;
      return;
    }

    const previous = document.createElement("button");
    const status = document.createElement("span");
    const next = document.createElement("button");
    previous.type = "button";
    previous.textContent = "← Trước";
    previous.disabled = payload.page === 1;
    previous.dataset.reminderPage = String(payload.page - 1);
    status.className = "attention-pagination-status";
    status.textContent = `Trang ${payload.page}/${payload.totalPages}`;
    next.type = "button";
    next.textContent = "Sau →";
    next.disabled = payload.page === payload.totalPages;
    next.dataset.reminderPage = String(payload.page + 1);
    reminderPagination.append(previous, status, next);
    reminderPagination.hidden = false;
  }

  function renderReminderRows(payload, shouldScroll) {
    reminderRows = window.AMReminderUtils.sortPendingReminders(payload.reminders || []);
    reminderTotal = payload.total || 0;
    reminderPage = payload.page;

    if (!reminderRows.length) {
      reminderSummary.textContent = "Hiện không có lịch hẹn cần làm.";
      setReminderState("empty", "Hiện không có lịch hẹn cần làm.");
      return;
    }

    const start = (payload.page - 1) * payload.pageSize + 1;
    const end = start + reminderRows.length - 1;
    const fragment = document.createDocumentFragment();
    reminderRows.forEach((reminder) => fragment.appendChild(renderAttentionReminder(reminder)));
    reminderList.replaceChildren(fragment);
    reminderState.textContent = "";
    window.AMUI.setSectionState({
      section: reminderSection,
      stateElement: reminderState,
      dataElement: reminderList
    }, "data");
    reminderSummary.textContent = `Đang hiển thị ${start}–${end} trên tổng số ${payload.total} lịch hẹn.`;
    renderReminderPagination(payload);

    if (shouldScroll && reminderSection) {
      const reduceMotion = window.AMUI
        ? window.AMUI.prefersReducedMotion()
        : window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      reminderSection.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    }
  }

  function renderReminderCounts(summary) {
    const counts = {
      all: (summary.overdue || 0) + (summary.today || 0) + (summary.upcoming || 0),
      overdue: summary.overdue || 0,
      today: summary.today || 0,
      upcoming: summary.upcoming || 0
    };
    Object.entries(reminderCountMap).forEach(([key, element]) => {
      element.textContent = String(counts[key]);
    });
    reminderImmediateCount = counts.overdue + counts.today;
    renderCounts();
  }

  function refreshVisibleReminders() {
    reminderRows.forEach((reminder) => {
      const element = reminderList.querySelector(`[data-reminder-time="${reminder.id}"]`);
      if (element) {
        element.textContent = window.AMReminderUtils.formatReminderRelativeTime(reminder);
      }
    });
  }

  async function loadAttentionReminders(shouldScroll) {
    const requestId = reminderRequestId + 1;
    reminderRequestId = requestId;
    setReminderState("loading", "Đang tải lịch hẹn…");

    try {
      const [summary, payload] = await Promise.all([
        window.AMApi.getReminderSummary(),
        window.AMApi.getRemindersPage({
          page: reminderPage,
          pageSize: REMINDER_PAGE_SIZE,
          filter: reminderFilter
        })
      ]);

      if (requestId !== reminderRequestId) {
        return;
      }

      renderReminderCounts(summary);
      if (payload.total > 0 && payload.page > payload.totalPages) {
        reminderPage = payload.totalPages;
        await loadAttentionReminders(shouldScroll);
        return;
      }
      renderReminderRows(payload, shouldScroll === true);
      startRefreshTimer();
    } catch (error) {
      if (requestId !== reminderRequestId) {
        return;
      }
      reminderRows = [];
      reminderTotal = 0;
      reminderImmediateCount = 0;
      renderReminderCounts({});

      if (error && error.code === "REMINDERS_UNAVAILABLE") {
        reminderSummary.textContent = "Chức năng lịch hẹn đang chờ kích hoạt.";
        setReminderState(
          "unavailable",
          "Chức năng lịch hẹn chưa được kích hoạt trên Supabase. Dữ liệu phiếu cần chú ý vẫn hoạt động bình thường."
        );
        return;
      }

      reminderSummary.textContent = "Không thể tải dữ liệu lịch hẹn.";
      setReminderState("error", "Không thể tải lịch hẹn. Vui lòng thử lại.", loadAttentionReminders);
    }
  }

  async function completeAttentionReminder(reminder, button) {
    if (window.AMUI && typeof window.AMUI.setButtonBusy === "function") {
      window.AMUI.setButtonBusy(button, true, { busyText: "Đang xử lý…" });
    } else {
      button.disabled = true;
      button.textContent = "Đang xử lý…";
    }
    try {
      await window.AMApi.completeTicketReminder(reminder);
      const message = `Đã hoàn thành lịch hẹn của ${window.AMApi.formatTicketCode(reminder.ticket_code)}.`;
      if (window.AMUI && typeof window.AMUI.toast === "function") {
        clearNotice();
        window.AMUI.toast(message, { type: "success" });
      } else {
        showNotice("success", message);
      }
      await loadAttentionReminders(false);
    } catch (error) {
      showNotice("error", error.message);
      if (window.AMUI && typeof window.AMUI.setButtonBusy === "function") {
        window.AMUI.setButtonBusy(button, false, { idleText: "Hoàn thành" });
      } else {
        button.disabled = false;
        button.textContent = "Hoàn thành";
      }
    }
  }

  function attachEvents() {
    document.querySelectorAll(".attention-chip").forEach((button) => {
      if (button.hasAttribute("data-reminder-attention-filter") || button.hasAttribute("data-handover-attention-filter")) {
        return;
      }
      button.addEventListener("click", function () {
        activeFilter = button.dataset.filter || "all";
        currentPage = 1;
        renderTasks(true);
      });
    });

    document.querySelectorAll("[data-reminder-attention-filter]").forEach((button) => {
      button.addEventListener("click", function () {
        reminderFilter = button.dataset.reminderAttentionFilter || "needs_action";
        reminderPage = 1;
        document.querySelectorAll("[data-reminder-attention-filter]").forEach((chip) => {
          const active = chip === button;
          chip.classList.toggle("active", active);
          chip.setAttribute("aria-pressed", String(active));
        });
        loadAttentionReminders(true);
      });
    });

    document.querySelectorAll("[data-handover-attention-filter]").forEach((button) => {
      button.addEventListener("click", function () {
        const nextFilter = button.dataset.handoverAttentionFilter || "all";
        if (nextFilter === handoverFilter) {
          return;
        }
        handoverFilter = nextFilter;
        document.querySelectorAll("[data-handover-attention-filter]").forEach((chip) => {
          const active = chip === button;
          chip.classList.toggle("active", active);
          chip.setAttribute("aria-pressed", String(active));
        });
        loadAttentionHandovers(true);
      });
    });

    reminderPagination.addEventListener("click", function (event) {
      const button = event.target.closest("button[data-reminder-page]");
      if (!button || button.disabled) {
        return;
      }
      reminderPage = Number.parseInt(button.dataset.reminderPage, 10) || 1;
      loadAttentionReminders(true);
    });

    reminderList.addEventListener("click", function (event) {
      const button = event.target.closest("[data-attention-reminder-complete]");
      if (!button || button.disabled) {
        return;
      }
      const reminder = reminderRows.find((item) => item.id === button.dataset.attentionReminderComplete);
      if (reminder) {
        completeAttentionReminder(reminder, button);
      }
    });

    if (weeklyPrevButton) {
      weeklyPrevButton.addEventListener("click", function () {
        weeklyIntakeOffset -= 1;
        loadWeeklyIntakeChart();
      });
    }

    if (weeklyCurrentButton) {
      weeklyCurrentButton.addEventListener("click", function () {
        weeklyIntakeOffset = 0;
        loadWeeklyIntakeChart();
      });
    }

    if (weeklyNextButton) {
      weeklyNextButton.addEventListener("click", function () {
        if (weeklyIntakeOffset >= 0) {
          return;
        }

        weeklyIntakeOffset += 1;
        loadWeeklyIntakeChart();
      });
    }
  }

  async function initAttentionSummary() {
    attachLogout();
    attachEvents();
    setTodayText();

    try {
      const access = await window.AMApi.requireInternalAccess();

      if (!access) {
        return;
      }

      await Promise.allSettled([
        loadAttentionTasks(),
        loadActiveProcessingChart(),
        loadWeeklyIntakeChart(),
        loadAttentionReminders(false),
        loadAttentionHandovers(false)
      ]);
    } catch (error) {
      showNotice("error", error.message || "Không tải được trang việc cần chú ý.");
      setState("error", "Không thể tải danh sách việc cần chú ý.", loadAttentionTasks);
    }
  }

  document.addEventListener("DOMContentLoaded", initAttentionSummary);
  window.addEventListener("beforeunload", stopRefreshTimer);
})();

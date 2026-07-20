(function () {
  "use strict";

  const notice = document.getElementById("dashboardNotice");
  const welcomeText = document.getElementById("welcomeText");
  const todayText = document.getElementById("opsTodayText");
  const summaryCount = document.getElementById("opsSummaryCount");
  const summaryText = document.getElementById("opsSummaryText");
  const urgentState = document.getElementById("urgentWorkState");
  const urgentSummary = document.getElementById("urgentWorkSummary");
  const urgentList = document.getElementById("urgentWorkList");
  const activityState = document.getElementById("recentActivityState");
  const activityList = document.getElementById("recentActivityList");

  const priorityMap = {
    check: document.getElementById("priorityCheckCount"),
    overdueRepair: document.getElementById("priorityOverdueRepairCount"),
    deliveryToday: document.getElementById("priorityDeliveryTodayCount"),
    repairing: document.getElementById("priorityRepairingCount")
  };

  const ATTENTION_PREVIEW_SIZE = 8;
  const MAX_ACTIVITY_ITEMS = 5;
  let attentionTasks = [];
  let attentionTimerId = null;
  let dashboardRequestId = 0;

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

  function parseTime(value) {
    if (!value) {
      return 0;
    }

    const time = Date.parse(value);
    return Number.isFinite(time) ? time : 0;
  }

  function formatDate(value) {
    const text = String(value || "").trim();

    if (!text) {
      return "Chưa có";
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const parts = text.split("-");
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }

    const date = new Date(text);

    if (Number.isNaN(date.getTime())) {
      return text;
    }

    return date.toLocaleString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
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

  function minutesSince(value) {
    const time = parseTime(value);
    return time ? Math.max(0, Math.floor((Date.now() - time) / 60000)) : 0;
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

  function refreshAttentionTask(task) {
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

  function refreshAttentionTasks(tasks) {
    return (tasks || [])
      .map(refreshAttentionTask)
      .sort((a, b) => {
        if (a.ageMinutes !== b.ageMinutes) {
          return b.ageMinutes - a.ageMinutes;
        }

        const startedA = parseTime(a.attentionStartedAt);
        const startedB = parseTime(b.attentionStartedAt);

        if (startedA !== startedB) {
          return startedA - startedB;
        }

        return String(a.ticketCode || "").localeCompare(String(b.ticketCode || ""), "vi", { numeric: true });
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

  function ticketTime(ticket) {
    return Math.max(
      parseTime(ticket.last_activity_at),
      parseTime(ticket.completed_at),
      parseTime(ticket.ready_for_handover_at),
      parseTime(ticket.repair_started_at),
      parseTime(ticket.created_at),
      parseTime(ticket.received_date)
    );
  }

  function ticketTitle(ticket) {
    return [
      window.AMApi.formatTicketCode(ticket.ticket_code || ticket.ticketCode),
      textOrDash(ticket.customer_name || ticket.customer_master_name || ticket.customerName),
      textOrDash(ticket.brandModel || ticket.model)
    ].filter((item) => item !== "—").join(" · ");
  }

  function createBadge(status) {
    const badge = document.createElement("span");
    badge.className = `status-pill ${statusClass(status)}`.trim();
    badge.textContent = statusLabel(status);
    return badge;
  }

  function createActionLink(ticket, fallbackHref) {
    const link = document.createElement("a");
    const code = String(ticket.ticket_code || ticket.ticketCode || "").trim();

    link.className = "btn secondary compact";
    link.textContent = "Xem phiếu";
    link.href = fallbackHref || (code ? `search.html?code=${encodeURIComponent(code)}` : "search.html");
    return link;
  }

  function setBlockState(stateEl, contentEl, type, message) {
    if (!stateEl || !contentEl) {
      return;
    }

    stateEl.classList.remove("attention-error-state");
    stateEl.textContent = message;
    contentEl.replaceChildren();
    window.AMUI.setSectionState({
      section: stateEl.closest("section"),
      stateElement: stateEl,
      dataElement: contentEl
    }, type);
  }

  function setBlockLoading(stateEl, contentEl, message) {
    if (!stateEl || !contentEl) {
      return;
    }

    const section = stateEl.closest("section");
    const hasVisibleData = !contentEl.hidden && contentEl.childElementCount > 0;
    stateEl.classList.remove("attention-error-state");

    if (hasVisibleData) {
      stateEl.textContent = "";
      window.AMUI.setSectionState({
        section,
        stateElement: stateEl,
        dataElement: contentEl
      }, "refreshing");
      return;
    }

    setBlockState(stateEl, contentEl, "loading", message);
  }

  function setUrgentLoadingState() {
    const hasVisibleData = urgentList && !urgentList.hidden && urgentList.childElementCount > 0;
    if (!hasVisibleData) {
      clearUrgentSummary();
    }
    setBlockLoading(urgentState, urgentList, "Đang tải các việc cần xử lý…");
  }

  function setUrgentErrorState(message) {
    if (!urgentState || !urgentList) {
      return;
    }

    const text = document.createElement("span");
    const retryButton = document.createElement("button");

    clearUrgentSummary();
    urgentList.hidden = true;
    urgentList.replaceChildren();

    text.textContent = message || "Không thể tải danh sách việc cần xử lý.";
    retryButton.type = "button";
    retryButton.className = "btn secondary compact";
    retryButton.textContent = "Thử lại";
    retryButton.addEventListener("click", loadDashboard);

    urgentState.className = "list-state attention-error-state";
    urgentState.replaceChildren(text, retryButton);
    window.AMUI.setSectionState({
      section: urgentState.closest("section"),
      stateElement: urgentState,
      dataElement: urgentList
    }, "error");
  }

  function showBlockContent(stateEl, contentEl) {
    if (!stateEl || !contentEl) {
      return;
    }

    stateEl.classList.remove("attention-error-state");
    stateEl.textContent = "";
    window.AMUI.setSectionState({
      section: stateEl.closest("section"),
      stateElement: stateEl,
      dataElement: contentEl
    }, "data");
  }

  function renderPriorityCounts(counts) {
    Object.entries(priorityMap).forEach(([key, element]) => {
      if (element) {
        element.textContent = String(counts[key] || 0);
      }
    });

    document.querySelectorAll(".ops-priority-card").forEach((card) => {
      const value = Number(card.querySelector("strong") && card.querySelector("strong").textContent) || 0;
      card.classList.toggle("has-work", value > 0);
    });
  }

  function clearUrgentSummary() {
    if (urgentSummary) {
      urgentSummary.hidden = true;
      urgentSummary.textContent = "";
    }
  }

  function priorityClass(priority) {
    if (priority === "urgent") {
      return "danger";
    }

    if (priority === "high") {
      return "warning";
    }

    return "info";
  }

  function createReasonList(item) {
    const wrapper = document.createElement("div");
    const reasons = item.reasons && item.reasons.length
      ? item.reasons
      : [{ label: item.typeLabel, description: item.reason }];

    wrapper.className = "ops-work-reasons";

    reasons.forEach((reason) => {
      const badge = document.createElement("span");
      badge.className = "ops-work-reason";
      badge.textContent = reason.description || reason.label || "Cần xử lý";
      wrapper.appendChild(badge);
    });

    return wrapper;
  }

  function createPriorityBadge(item) {
    const badge = document.createElement("span");
    badge.className = `ops-work-priority ${priorityClass(item.priority)}`;
    badge.textContent = item.priorityLabel || "Cần chú ý";
    return badge;
  }

  function renderUrgentItems(items) {
    if (!items.length) {
      clearUrgentSummary();
      setBlockState(urgentState, urgentList, "empty", "Hiện không có phiếu cần ưu tiên.");
      return;
    }

    const fragment = document.createDocumentFragment();

    items.forEach((item) => {
      const row = document.createElement("article");
      const body = document.createElement("div");
      const title = document.createElement("strong");
      const meta = document.createElement("span");
      const side = document.createElement("div");
      const viewLink = createActionLink(item, item.viewHref);

      row.className = `ops-work-item ${priorityClass(item.priority)}`;
      body.className = "ops-work-body";
      title.textContent = ticketTitle(item);
      meta.textContent = [
        `Chờ xử lý ${formatAgeMinutes(item.ageMinutes)}`,
        item.brandModel || item.model || item.status
      ].filter(Boolean).join(" · ");
      side.className = "ops-work-side";
      side.append(createPriorityBadge(item), createBadge(item.status), viewLink);

      if (item.actionHref) {
        const actionLink = document.createElement("a");
        actionLink.className = "btn secondary compact";
        actionLink.href = item.actionHref;
        actionLink.textContent = item.actionLabel || "Mở trang xử lý";
        side.appendChild(actionLink);
      }

      body.append(title, meta, createReasonList(item));
      row.append(body, side);
      fragment.appendChild(row);
    });

    urgentList.replaceChildren(fragment);
    showBlockContent(urgentState, urgentList);
  }

  function renderUrgentSummary(total, startIndex, endIndex) {
    if (!urgentSummary) {
      return;
    }

    urgentSummary.hidden = total === 0;
    urgentSummary.textContent = total > 0
      ? `Đang hiển thị ${startIndex + 1}–${endIndex} trên tổng số ${total} phiếu.`
      : "";
  }

  function renderUrgentPreview() {
    const total = attentionTasks.length;

    if (total === 0) {
      renderUrgentItems([]);
      return;
    }

    const startIndex = 0;
    const pageItems = attentionTasks.slice(startIndex, ATTENTION_PREVIEW_SIZE);
    const endIndex = Math.min(startIndex + pageItems.length, total);

    renderUrgentSummary(total, startIndex, endIndex);
    renderUrgentItems(pageItems);
  }

  function stopAttentionTimer() {
    if (attentionTimerId) {
      window.clearInterval(attentionTimerId);
      attentionTimerId = null;
    }
  }

  function startAttentionTimer() {
    stopAttentionTimer();

    if (!attentionTasks.length) {
      return;
    }

    attentionTimerId = window.setInterval(() => {
      attentionTasks = refreshAttentionTasks(attentionTasks);
      renderUrgentPreview();
    }, 60000);
  }

  function buildRecentActivity(tickets) {
    return (tickets || [])
      .slice()
      .sort((a, b) => ticketTime(b) - ticketTime(a))
      .slice(0, MAX_ACTIVITY_ITEMS);
  }

  function activityReason(ticket) {
    if (ticket.completed_at) {
      return "Đã bàn giao phiếu";
    }

    if (ticket.ready_for_handover_at) {
      return "Hoàn thành sửa chữa — đang chờ bàn giao";
    }

    if (ticket.repair_started_at) {
      return "Đang trong luồng sửa chữa";
    }

    return "Phiếu mới được cập nhật";
  }

  function renderRecentActivity(tickets) {
    if (!tickets.length) {
      setBlockState(activityState, activityList, "empty", "Chưa có hoạt động gần đây.");
      return;
    }

    const fragment = document.createDocumentFragment();

    tickets.forEach((ticket) => {
      const item = document.createElement("article");
      const body = document.createElement("div");
      const title = document.createElement("strong");
      const meta = document.createElement("span");

      item.className = "ops-activity-item";
      body.className = "ops-activity-body";
      title.textContent = ticketTitle(ticket);
      meta.textContent = `${activityReason(ticket)} · ${formatDate(ticket.last_activity_at || ticket.completed_at || ticket.repair_started_at || ticket.created_at)}`;
      body.append(title, meta);
      item.append(body, createBadge(ticket.status), createActionLink(ticket));
      fragment.appendChild(item);
    });

    activityList.replaceChildren(fragment);
    showBlockContent(activityState, activityList);
  }

  function setTodayText() {
    const formatted = new Intl.DateTimeFormat("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(new Date());

    todayText.textContent = formatted;
  }

  function renderSummary(counts) {
    const total = counts.total || 0;

    summaryCount.textContent = String(total);
    summaryText.textContent = total > 0
      ? `Hiện có ${total} việc cần xử lý ngay.`
      : "Ca làm việc đang ổn, chưa có việc ưu tiên cao.";
  }

  async function loadDashboard() {
    const requestId = dashboardRequestId + 1;
    dashboardRequestId = requestId;
    stopAttentionTimer();
    setUrgentLoadingState();
    setBlockLoading(activityState, activityList, "Đang tải hoạt động gần đây...");

    const [attentionResult, workflowResult, reminderResult] = await Promise.allSettled([
      window.AMApi.getAttentionTasks(),
      window.AMApi.getDashboardWorkflowTickets(160),
      window.AMApi.getAttentionReminderCounts()
    ]);

    if (requestId !== dashboardRequestId) {
      return;
    }

    const attentionPayload = attentionResult.status === "fulfilled" ? attentionResult.value : null;
    const workflowPayload = workflowResult.status === "fulfilled" ? workflowResult.value : null;
    const workflowTickets = workflowPayload && workflowPayload.available ? workflowPayload.tickets : [];
    const counts = attentionPayload && attentionPayload.counts ? attentionPayload.counts : {
      total: 0,
      repairOverdue48: 0,
      repairOverdue72: 0,
      needsInspection: 0,
      deliveryToday: 0,
      handoverOverdue48: 0,
      repairing: 0
    };

    renderPriorityCounts({
      check: counts.needsInspection,
      overdueRepair: counts.repairOverdue48 || counts.repairOverdue || 0,
      deliveryToday: counts.deliveryToday,
      repairing: counts.repairing
    });
    const reminderImmediateCount = reminderResult.status === "fulfilled"
      ? Number(reminderResult.value.total) || 0
      : 0;
    renderSummary(Object.assign({}, counts, {
      total: (Number(counts.total) || 0) + reminderImmediateCount
    }));

    if (attentionResult.status === "rejected") {
      attentionTasks = [];
      setUrgentErrorState("Không thể tải danh sách việc cần xử lý.");
    } else {
      attentionTasks = refreshAttentionTasks(attentionPayload.tasks || []);
      renderUrgentPreview();
      startAttentionTimer();

      if (attentionPayload.partialErrors && attentionPayload.partialErrors.length > 0) {
        showNotice("error", "Một số nhóm việc cần chú ý chưa tải được. Hãy mở chi tiết để kiểm tra lại.");
      }
    }

    if (workflowResult.status === "rejected") {
      setBlockState(activityState, activityList, "error", workflowResult.reason.message || "Không tải được hoạt động gần đây.");
    } else if (workflowPayload && !workflowPayload.available) {
      setBlockState(activityState, activityList, "empty", workflowPayload.message || "Workflow chưa được kích hoạt.");
    } else {
      renderRecentActivity(buildRecentActivity(workflowTickets));
    }
  }

  async function initDashboard() {
    attachLogout();
    setTodayText();

    try {
      const access = await window.AMApi.requireInternalAccess();

      if (!access) {
        return;
      }

      welcomeText.textContent = access.profile && access.profile.name
        ? `Xin chào ${access.profile.name}.`
        : "Bạn đang dùng tài khoản admin nội bộ.";

      await loadDashboard();
    } catch (error) {
      stopAttentionTimer();
      showNotice("error", error.message);
      setBlockState(urgentState, urgentList, "error", "Không tải được dashboard.");
      setBlockState(activityState, activityList, "error", "Không tải được hoạt động gần đây.");
    }
  }

  document.addEventListener("DOMContentLoaded", initDashboard);
  window.addEventListener("beforeunload", stopAttentionTimer);
})();

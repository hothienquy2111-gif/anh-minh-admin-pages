(function () {
  "use strict";

  const PAGE_SIZE = 10;
  const DIRECTORY_PAGE_SIZE = 100;
  const RANKING_PAGE_SIZE = 100;
  const SEARCH_DELAY_MS = 300;
  const VALID_VIEWS = new Set(["profile", "team", "awards"]);
  const VALID_PROFILE_VIEWS = new Set(["performance", "work", "history"]);
  const COMPLEXITY_OPTIONS = Object.freeze([
    { value: "basic", label: "Cơ bản" },
    { value: "standard", label: "Tiêu chuẩn" },
    { value: "hard", label: "Khó" },
    { value: "very_hard", label: "Rất khó" }
  ]);

  const state = {
    access: null,
    view: "profile",
    profileView: "performance",
    period: null,
    directory: [],
    directoryCount: 0,
    selectedEmployee: null,
    profileDetail: null,
    profileKpiAbortController: null,
    profileTargetAbortController: null,
    profileAssignments: { active: [], completed: [] },
    profileAssignmentMeta: {
      active: { page: 1, count: 0, loading: false, error: "" },
      completed: { page: 1, count: 0, loading: false, error: "" }
    },
    completedWorkPeriod: null,
    managementNotes: [],
    profileLoadVersion: 0,
    directoryLoadVersion: 0,
    directoryController: null,
    directoryAbortController: null,
    profileAbortController: null,
    assignmentAbortControllers: { active: null, completed: null },
    teamAbortController: null,
    awardAbortController: null,
    rankingAbortControllers: { team: null, awards: null },
    rankingRows: { team: [], awards: [] },
    recognition: null,
    teamLoaded: false,
    awardsLoaded: false,
    searchTimer: null,
    dialogs: new Set()
  };

  const refs = {};
  let employeeModuleStartPromise = null;
  let employeeAccessUnsubscribe = null;

  function query(id) {
    return document.getElementById(id);
  }

  function element(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) {
      node.className = className;
    }
    if (text !== undefined && text !== null) {
      node.textContent = String(text);
    }
    return node;
  }

  function employeeAccessElements() {
    return {
      gate: document.getElementById("employeeAccessGate"),
      message: document.getElementById("employeeAccessGateMessage"),
      main: document.getElementById("employeeMainContent")
    };
  }

  function abortEmployeeModuleRequests() {
    [
      state.directoryAbortController,
      state.profileAbortController,
      state.profileKpiAbortController,
      state.profileTargetAbortController,
      state.teamAbortController,
      state.awardAbortController,
      ...Object.values(state.assignmentAbortControllers || {}),
      ...Object.values(state.rankingAbortControllers || {})
    ].filter(Boolean).forEach((controller) => {
      if (typeof controller.abort === "function") {
        controller.abort();
      }
    });
  }

  function closeEmployeeDialogsForLock() {
    state.dialogs.forEach((backdrop) => {
      if (backdrop && typeof backdrop.remove === "function") {
        backdrop.remove();
      }
    });
    state.dialogs.clear();
    document.body.classList.remove("employee-form-modal-open");
    const pageShell = document.querySelector(".page-shell");
    if (pageShell && !document.querySelector(".employee-access-backdrop")) {
      pageShell.inert = false;
    }
  }

  function concealEmployeeModule(message) {
    const access = employeeAccessElements();
    abortEmployeeModuleRequests();
    closeEmployeeDialogsForLock();
    if (access.main) {
      access.main.hidden = true;
      access.main.inert = true;
      access.main.setAttribute("aria-hidden", "true");
    }
    if (access.gate) {
      access.gate.hidden = false;
    }
    if (access.message) {
      access.message.textContent = message || "Nhập mã PIN để tiếp tục sử dụng module Nhân viên.";
    }
  }

  function revealEmployeeModule() {
    const access = employeeAccessElements();
    if (access.gate) {
      access.gate.hidden = true;
    }
    if (access.main) {
      access.main.hidden = false;
      access.main.inert = false;
      access.main.setAttribute("aria-hidden", "false");
    }
  }

  function cacheElements() {
    [
      "employeeRefreshButton",
      "employeeLastUpdated",
      "employeeModuleNotice",
      "employeeDirectory",
      "employeeDirectoryToggle",
      "employeeDirectoryClose",
      "employeeDirectoryBackdrop",
      "employeeMobileSummary",
      "employeeDirectoryCount",
      "employeeDirectorySearch",
      "employeeDirectoryStatus",
      "employeeDirectoryList",
      "employeeCreateButton",
      "employeeProfileView",
      "employeeTeamView",
      "employeeAwardsView",
      "employeeProfileContent",
      "employeeCustomPeriod",
      "employeePeriodStart",
      "employeePeriodEnd",
      "employeeApplyPeriod",
      "employeePeriodLabel",
      "employeeOverviewState",
      "employeeOverviewContent",
      "employeeKpiActiveEmployees",
      "employeeTrendActiveEmployees",
      "employeeKpiActiveAssignments",
      "employeeTrendActiveAssignments",
      "employeeKpiCompletedToday",
      "employeeTrendCompleted",
      "employeeKpiCompletedMonth",
      "employeeKpiCompletionRate",
      "employeeTrendCompletionRate",
      "employeeKpiAverageHours",
      "employeeTrendAverageHours",
      "employeeWeeklyChart",
      "employeeWeeklyChartFallback",
      "employeeDistributionChart",
      "employeeDistributionFallback",
      "employeeTopList",
      "employeeTopPeriod",
      "employeeUnassignedState",
      "employeeUnassignedList",
      "employeeAwardCreateButton",
      "employeeScoringRulesButton",
      "employeeRecognitionRoot",
      "employeeAwardHero",
      "employeeAwardWeeklyName",
      "employeeAwardWeeklyMeta",
      "employeeAwardMonthlyName",
      "employeeAwardMonthlyMeta",
      "employeeAwardCustomName",
      "employeeAwardCustomMeta",
      "employeeAwardTopList",
      "employeeAwardRankingPeriod",
      "employeeAwardsState",
      "employeeAwardsContent",
      "employeeAwardList",
      "employeeAwardsPagination"
    ].forEach((id) => {
      refs[id] = query(id);
    });
  }

  function kpi() {
    return window.AMEmployeeKpi;
  }

  function canManage() {
    return Boolean(state.access && state.access.can_manage);
  }

  function canFinalizeAward() {
    return Boolean(state.access && state.access.can_finalize_award);
  }

  function isAbortError(error) {
    return Boolean(
      error
      && (
        error.name === "AbortError"
        || error.employeeRequestAborted
        || (error.originalError && error.originalError.name === "AbortError")
      )
    );
  }

  function setNotice(type, message) {
    if (!message) {
      refs.employeeModuleNotice.hidden = true;
      refs.employeeModuleNotice.textContent = "";
      refs.employeeModuleNotice.className = "employee-module-notice";
      return;
    }
    refs.employeeModuleNotice.hidden = false;
    refs.employeeModuleNotice.className = `employee-module-notice employee-module-notice--${type || "info"}`;
    refs.employeeModuleNotice.textContent = message;
  }

  function sectionState(stateElement, contentElement, nextState, message) {
    if (!stateElement || !contentElement) {
      return;
    }
    if (window.AMUI && typeof window.AMUI.setSectionState === "function") {
      if (message !== undefined) {
        stateElement.textContent = message || "";
      }
      window.AMUI.setSectionState({
        stateElement,
        dataElement: contentElement
      }, nextState);
      return;
    }
    stateElement.hidden = nextState === "data";
    contentElement.hidden = nextState !== "data";
    stateElement.className = `list-state ${nextState}`;
    stateElement.textContent = message || "";
  }

  function updateLastUpdated(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) {
      refs.employeeLastUpdated.textContent = "Chưa cập nhật";
      return;
    }
    refs.employeeLastUpdated.textContent = `Cập nhật ${new Intl.DateTimeFormat("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "Asia/Ho_Chi_Minh"
    }).format(date)}`;
  }

  function employeeId(employee) {
    return String((employee && (employee.employee_id || employee.id)) || "");
  }

  function selectedEmployeeId() {
    return employeeId(state.selectedEmployee);
  }

  function formatTicketCode(value) {
    return window.AMApi.formatTicketCode(value);
  }

  function statusBadge(label, tone) {
    return element("span", `employee-status-badge employee-status-badge--${tone || "gray"}`, label);
  }

  function currentUrlState() {
    const params = new URLSearchParams(window.location.search);
    const requestedView = params.get("view");
    const requestedProfileView = params.get("section");
    return {
      employee: params.get("employee") || "",
      view: VALID_VIEWS.has(requestedView) ? requestedView : "profile",
      profileView: VALID_PROFILE_VIEWS.has(requestedProfileView)
        ? requestedProfileView
        : "performance"
    };
  }

  function writeUrl(options) {
    const settings = options || {};
    const url = new URL(window.location.href);
    if (state.view === "profile" && selectedEmployeeId()) {
      url.searchParams.set("employee", selectedEmployeeId());
    } else if (!selectedEmployeeId()) {
      url.searchParams.delete("employee");
    }
    if (state.view === "profile") {
      url.searchParams.delete("view");
    } else {
      url.searchParams.set("view", state.view);
    }
    if (state.view === "profile" && state.profileView !== "performance") {
      url.searchParams.set("section", state.profileView);
    } else {
      url.searchParams.delete("section");
    }
    const method = settings.replace ? "replaceState" : "pushState";
    window.history[method](null, "", url);
  }

  function updateViewButtons() {
    document.querySelectorAll("[data-employee-view]").forEach((button) => {
      const active = button.dataset.employeeView === state.view;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    document.querySelectorAll("[data-employee-workspace-view]").forEach((view) => {
      view.hidden = view.dataset.employeeWorkspaceView !== state.view;
    });
  }

  async function setWorkspaceView(view, options) {
    const settings = options || {};
    state.view = VALID_VIEWS.has(view) ? view : "profile";
    updateViewButtons();
    if (!settings.fromPopState) {
      writeUrl({ replace: Boolean(settings.replace) });
    }
    if (state.view === "team" && (!state.teamLoaded || settings.force)) {
      await loadTeamOverview();
    }
    if (state.view === "awards" && (!state.awardsLoaded || settings.force)) {
      await loadAwards();
    }
  }

  function updatePermissionUi() {
    refs.employeeCreateButton.hidden = !canManage();
    refs.employeeAwardCreateButton.hidden = !canFinalizeAward();
    refs.employeeScoringRulesButton.hidden = !canManage();
    if (!canManage()) {
      refs.employeeCreateButton.title = "Chỉ Owner/Admin được thêm nhân viên.";
    }
  }

  function activeDirectoryCount(rows) {
    return (Array.isArray(rows) ? rows : []).filter((row) => row.employment_status === "active").length;
  }

  function currentPeriod() {
    return state.period || kpi().periodRange("this-month");
  }

  function formatRankingPeriod(period) {
    const range = period || currentPeriod();
    if (!range.start || !range.end) {
      return range.label || "Kỳ đang chọn";
    }
    return `${kpi().formatDate(range.start)} – ${kpi().formatDate(range.end)}`;
  }

  function previousPeriod(period) {
    const range = period || currentPeriod();
    const start = kpi().dateOnly(range.start);
    const end = kpi().dateOnly(range.end);
    if (!start || !end) {
      return null;
    }
    const dayCount = Math.max(Math.round((end.getTime() - start.getTime()) / 86400000) + 1, 1);
    return {
      start: kpi().addDays(range.start, -dayCount),
      end: kpi().addDays(range.start, -1)
    };
  }

  function updateRankingPeriodLabels() {
    const label = formatRankingPeriod(currentPeriod());
    [refs.employeeTopPeriod, refs.employeeAwardRankingPeriod].forEach((node) => {
      if (node) {
        node.textContent = label;
      }
    });
  }

  function defaultAssignmentMeta() {
    return {
      active: { page: 1, count: 0, loading: false, error: "" },
      completed: { page: 1, count: 0, loading: false, error: "" }
    };
  }

  function resetProfileAssignments() {
    Object.values(state.assignmentAbortControllers).forEach((controller) => {
      if (controller) {
        controller.abort();
      }
    });
    state.assignmentAbortControllers = { active: null, completed: null };
    state.profileAssignments = { active: [], completed: [] };
    state.profileAssignmentMeta = defaultAssignmentMeta();
    state.completedWorkPeriod = kpi().periodRange("this-month");
  }

  function completedWorkRange() {
    return state.completedWorkPeriod || kpi().periodRange("this-month");
  }

  function setCompletedWorkPeriod(key, customStart, customEnd) {
    const normalized = String(key || "this-month");
    if (normalized === "all") {
      state.completedWorkPeriod = {
        key: "all",
        start: null,
        end: null,
        label: "Tất cả"
      };
      return;
    }
    if (normalized === "this-week") {
      const today = kpi().todayIso();
      state.completedWorkPeriod = {
        key: "this-week",
        start: kpi().startOfWeek(today),
        end: today,
        label: "Tuần này"
      };
      return;
    }
    state.completedWorkPeriod = kpi().periodRange(
      normalized,
      customStart,
      customEnd
    );
  }

  function selectPeriod(key, customStart, customEnd) {
    state.period = kpi().periodRange(key, customStart, customEnd);
    document.querySelectorAll("[data-period-key]").forEach((button) => {
      const active = button.dataset.periodKey === state.period.key;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    refs.employeeCustomPeriod.hidden = state.period.key !== "custom";
    refs.employeePeriodStart.value = state.period.start || "";
    refs.employeePeriodEnd.value = state.period.end || "";
    refs.employeePeriodLabel.textContent = state.period.label || "";
    updateRankingPeriodLabels();
  }

  function setTrend(node, comparison) {
    if (!node) {
      return;
    }
    const result = comparison || { direction: "neutral", text: "Chưa đủ dữ liệu" };
    node.className = `employee-kpi-trend is-${result.direction || "neutral"}`;
    node.textContent = result.text || "Chưa đủ dữ liệu";
  }

  function rankingInfoButton(label, tooltip) {
    const button = element("button", "employee-info-button", "i");
    button.type = "button";
    button.dataset.tooltip = tooltip;
    button.setAttribute("aria-label", `Giải thích ${label}`);
    return button;
  }

  function rankingStatus(status) {
    const value = String(status || "").toLowerCase();
    const labels = {
      active: "Đang hoạt động",
      inactive: "Ngừng hoạt động",
      suspended: "Tạm khóa"
    };
    const tones = {
      active: "green",
      inactive: "gray",
      suspended: "amber"
    };
    return statusBadge(labels[value] || "Chưa xác định", tones[value] || "gray");
  }

  function rankingMetric(label, value, tooltip) {
    const metric = element("div", "employee-ranking-metric");
    const heading = element("div", "employee-ranking-metric__heading");
    heading.appendChild(element("span", "", label));
    if (tooltip) {
      heading.appendChild(rankingInfoButton(label, tooltip));
    }
    metric.append(heading, element("strong", "", value));
    return metric;
  }

  function rankingTarget(employee) {
    const target = Number(employee.target_completed_tickets);
    const completed = Number(employee.completed_count) || 0;
    const wrapper = element("div", "employee-ranking-target");
    if (!Number.isFinite(target) || target <= 0) {
      wrapper.classList.add("is-empty");
      wrapper.appendChild(element("span", "", "Chưa thiết lập mục tiêu"));
      return wrapper;
    }

    const percent = Math.max(completed / target * 100, 0);
    const heading = element("div", "employee-ranking-target__heading");
    heading.append(
      element("strong", "", `${kpi().formatNumber(completed)} / ${kpi().formatNumber(target)} tivi`),
      element("span", "", `Đạt ${percent.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}% mục tiêu`)
    );
    const track = element("div", "employee-ranking-target__track");
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-label", `Mức đạt mục tiêu của ${employee.full_name || "nhân viên"}`);
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    track.setAttribute("aria-valuenow", String(Math.min(Math.round(percent), 100)));
    track.setAttribute("aria-valuetext", `${completed} trên ${target} tivi, đạt ${percent.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`);
    const fill = element("span", "employee-ranking-target__fill");
    fill.style.width = `${Math.min(percent, 100)}%`;
    track.appendChild(fill);
    wrapper.append(heading, track);
    return wrapper;
  }

  function rankingTrend(employee) {
    const previous = employee.previous_completed_count;
    if (previous === null || previous === undefined || !Number.isFinite(Number(previous))) {
      return { tone: "neutral", label: "Chưa đủ dữ liệu" };
    }
    const current = Number(employee.completed_count) || 0;
    const prior = Number(previous) || 0;
    if (current > prior) {
      return { tone: "up", label: `Tăng ${kpi().formatNumber(current - prior)} tivi` };
    }
    if (current < prior) {
      return { tone: "down", label: `Giảm ${kpi().formatNumber(prior - current)} tivi` };
    }
    return { tone: "neutral", label: "Không đổi" };
  }

  function rankingIdentity(employee, compact) {
    const identity = element("div", `employee-ranking-identity${compact ? " is-compact" : ""}`);
    const avatar = element("span", "employee-ranking-avatar", kpi().getInitials(employee.full_name));
    avatar.setAttribute("aria-hidden", "true");
    const copy = element("div", "employee-ranking-identity__copy");
    const name = element("strong", "", employee.full_name || "Nhân viên");
    if (String(employee.full_name || "").length > 28) {
      name.classList.add("is-long-name");
    }
    copy.append(
      name,
      element("span", "employee-ranking-identity__meta", [
        employee.employee_code && window.AMApi.formatCompactBusinessCode(employee.employee_code, "NV"),
        employee.job_title || "Chưa cập nhật chức danh"
      ].filter(Boolean).join(" · "))
    );
    identity.append(avatar, copy);
    return identity;
  }

  function rankingProfileButton(employee) {
    const button = element("button", "employee-ranking-profile-link", "Xem hồ sơ");
    button.type = "button";
    button.dataset.employeeRankingId = employee.employee_id;
    button.setAttribute("aria-label", `Xem hồ sơ ${employee.full_name || "nhân viên"}`);
    return button;
  }

  function renderRankingCard(employee, rank, rows) {
    const card = element("article", `employee-ranking-card employee-ranking-card--rank-${rank}`);
    const top = element("div", "employee-ranking-card__top");
    top.append(
      element("span", "employee-ranking-rank", `Hạng ${rank}`),
      rankingStatus(employee.employment_status)
    );
    const main = element("div", "employee-ranking-card__main");
    const completed = element("div", "employee-ranking-card__completed");
    const reading = element("strong", "", kpi().formatNumber(employee.completed_count));
    reading.appendChild(element("small", "", " tivi"));
    completed.append(reading, element("span", "", "Hoàn thành trong kỳ"));

    const metrics = element("div", "employee-ranking-card__metrics");
    metrics.append(
      rankingMetric(
        "Tỷ lệ hoàn thành",
        kpi().formatPercent(employee.completion_rate),
        "Số tivi hoàn thành chia cho tổng số tivi được giao trong kỳ."
      ),
      rankingMetric(
        "Thời gian sửa TB",
        kpi().formatPerformanceDuration(employee.average_repair_minutes),
        "Thời gian trung bình từ lúc giao tivi cho nhân viên đến khi kỹ thuật xác nhận sửa xong."
      ),
      rankingMetric("Đang thực hiện", `${kpi().formatNumber(employee.active_assignments)} tivi`),
      rankingMetric(
        "Mức đạt mục tiêu",
        employee.target_completed_tickets
          ? `${Math.max(employee.completed_count / employee.target_completed_tickets * 100, 0).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`
          : "Chưa thiết lập",
        "Tỷ lệ giữa số tivi đã hoàn thành và mục tiêu được giao trong kỳ."
      )
    );
    main.append(completed, metrics);
    card.append(top, rankingIdentity(employee), main, rankingTarget(employee));

    if (rank === 1 && employee.completed_count > 0) {
      const tied = rows.length > 1 && rows[1].completed_count === employee.completed_count;
      card.appendChild(element(
        "p",
        "employee-ranking-card__insight",
        tied
          ? "Đồng dẫn đầu về số tivi hoàn thành trong kỳ."
          : "Dẫn đầu về số tivi hoàn thành trong kỳ."
      ));
    }
    card.appendChild(rankingProfileButton(employee));
    return card;
  }

  function rankingTableCell(text, className) {
    return element("td", className || "", text);
  }

  function renderRankingTeam(rows) {
    const section = element("section", "employee-ranking-team");
    const heading = element("header", "employee-ranking-team__header");
    heading.append(
      element("div", "", "Xếp hạng toàn đội"),
      element("p", "", `${kpi().formatNumber(rows.length)} nhân viên có dữ liệu trong kỳ`)
    );

    const tableWrap = element("div", "employee-ranking-table-wrap");
    const table = element("table", "employee-ranking-table");
    const caption = element("caption", "sr-only", "Xếp hạng hiệu suất toàn đội");
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    [
      "Hạng",
      "Nhân viên",
      "Tivi hoàn thành",
      "Tỷ lệ hoàn thành",
      "Thời gian sửa TB",
      "Đang thực hiện",
      "Đạt mục tiêu",
      "Xu hướng"
    ].forEach((label) => headRow.appendChild(element("th", "", label)));
    head.appendChild(headRow);
    const body = document.createElement("tbody");

    rows.forEach((employee, index) => {
      const row = document.createElement("tr");
      row.dataset.employeeRankingId = employee.employee_id;
      row.tabIndex = 0;
      row.setAttribute("aria-label", `Hạng ${index + 1}, ${employee.full_name || "nhân viên"}. Nhấn Enter để xem hồ sơ.`);
      row.appendChild(rankingTableCell(`Hạng ${index + 1}`, "employee-ranking-table__rank"));
      const identityCell = document.createElement("td");
      identityCell.appendChild(rankingIdentity(employee, true));
      row.appendChild(identityCell);
      row.append(
        rankingTableCell(kpi().formatNumber(employee.completed_count)),
        rankingTableCell(kpi().formatPercent(employee.completion_rate)),
        rankingTableCell(kpi().formatPerformanceDuration(employee.average_repair_minutes)),
        rankingTableCell(kpi().formatNumber(employee.active_assignments)),
        rankingTableCell(
          employee.target_completed_tickets
            ? `${Math.max(employee.completed_count / employee.target_completed_tickets * 100, 0).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`
            : "Chưa thiết lập"
        )
      );
      const trend = rankingTrend(employee);
      const trendCell = document.createElement("td");
      trendCell.appendChild(element("span", `employee-ranking-trend is-${trend.tone}`, trend.label));
      row.appendChild(trendCell);
      body.appendChild(row);
    });
    table.append(caption, head, body);
    tableWrap.appendChild(table);

    const mobile = element("div", "employee-ranking-mobile-list");
    rows.slice(3).forEach((employee, index) => {
      const card = element("article", "employee-ranking-mobile-card");
      const top = element("div", "employee-ranking-mobile-card__top");
      top.append(element("span", "employee-ranking-rank", `Hạng ${index + 4}`), rankingTrendBadge(employee));
      const metrics = element("dl", "employee-ranking-mobile-card__metrics");
      [
        ["Tivi hoàn thành", kpi().formatNumber(employee.completed_count)],
        ["Tỷ lệ hoàn thành", kpi().formatPercent(employee.completion_rate)],
        ["Thời gian sửa TB", kpi().formatPerformanceDuration(employee.average_repair_minutes)],
        ["Đang thực hiện", kpi().formatNumber(employee.active_assignments)],
        ["Đạt mục tiêu", employee.target_completed_tickets
          ? `${Math.max(employee.completed_count / employee.target_completed_tickets * 100, 0).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`
          : "Chưa thiết lập"]
      ].forEach(([label, value]) => {
        const item = document.createElement("div");
        item.append(element("dt", "", label), element("dd", "", value));
        metrics.appendChild(item);
      });
      card.append(top, rankingIdentity(employee, true), metrics, rankingProfileButton(employee));
      mobile.appendChild(card);
    });
    section.append(heading, tableWrap, mobile);
    return section;
  }

  function rankingTrendBadge(employee) {
    const trend = rankingTrend(employee);
    return element("span", `employee-ranking-trend is-${trend.tone}`, trend.label);
  }

  function renderLeaderboardLoading(container) {
    container.replaceChildren();
    container.setAttribute("aria-busy", "true");
    const wrapper = element("div", "employee-ranking-skeleton");
    wrapper.setAttribute("role", "status");
    wrapper.setAttribute("aria-label", "Đang tải bảng xếp hạng hiệu suất");
    for (let index = 0; index < 3; index += 1) {
      const card = element("div", "employee-ranking-skeleton__card");
      card.append(
        element("span", "employee-ranking-skeleton__avatar"),
        element("span", "employee-ranking-skeleton__line is-wide"),
        element("span", "employee-ranking-skeleton__line"),
        element("span", "employee-ranking-skeleton__block")
      );
      wrapper.appendChild(card);
    }
    container.appendChild(wrapper);
  }

  function renderLeaderboardState(container, type, message) {
    container.replaceChildren();
    container.setAttribute("aria-busy", "false");
    const stateNode = element("div", `employee-ranking-state employee-ranking-state--${type}`);
    stateNode.setAttribute("role", type === "error" ? "alert" : "status");
    stateNode.append(
      element("strong", "", type === "error"
        ? "Không thể tải bảng xếp hạng hiệu suất."
        : "Chưa đủ dữ liệu để xếp hạng"),
      element("p", "", message)
    );
    if (type === "error") {
      const retry = element("button", "btn secondary compact", "Thử lại");
      retry.type = "button";
      retry.dataset.employeeRankingRetry = container.id === "employeeAwardTopList" ? "awards" : "team";
      stateNode.appendChild(retry);
    }
    container.appendChild(stateNode);
  }

  function renderLeaderboard(container, rows) {
    const data = kpi().rankEmployeePerformance(rows);
    container.replaceChildren();
    container.setAttribute("aria-busy", "false");
    if (data.length === 0) {
      renderLeaderboardState(
        container,
        "empty",
        "Bảng xếp hạng sẽ xuất hiện khi nhân viên bắt đầu được phân công và hoàn thành tivi."
      );
      return data;
    }

    const top = element("div", "employee-ranking-top");
    data.slice(0, 3).forEach((employee, index) => {
      top.appendChild(renderRankingCard(employee, index + 1, data));
    });
    container.appendChild(top);
    if (data.length > 3) {
      container.appendChild(renderRankingTeam(data));
    }
    return data;
  }

  async function fetchAllRankingRows(period, signal) {
    const rows = [];
    let page = 1;
    let total = Number.POSITIVE_INFINITY;
    while (rows.length < total) {
      const result = await window.AMApi.getEmployeeKpiSummary({
        periodStart: period.start,
        periodEnd: period.end,
        kpiEligible: true,
        page,
        pageSize: RANKING_PAGE_SIZE,
        signal
      });
      const batch = Array.isArray(result.rows) ? result.rows : [];
      total = Number(result.count) || batch.length;
      rows.push(...batch);
      if (batch.length === 0 || batch.length < RANKING_PAGE_SIZE) {
        break;
      }
      page += 1;
    }
    return rows;
  }

  async function getRankingRows(period, signal) {
    const prior = previousPeriod(period);
    const [currentResult, previousResult] = await Promise.allSettled([
      fetchAllRankingRows(period, signal),
      prior ? fetchAllRankingRows(prior, signal) : Promise.resolve([])
    ]);
    if (currentResult.status === "rejected") {
      throw currentResult.reason;
    }
    const previousRows = previousResult.status === "fulfilled" ? previousResult.value : [];
    const previousByEmployee = new Map(previousRows.map((row) => [employeeId(row), row]));
    return currentResult.value.map((row) => {
      const previous = previousByEmployee.get(employeeId(row));
      return Object.assign({}, row, {
        previous_completed_count: previous ? previous.completed_in_period : null
      });
    });
  }

  function rankingContainer(key) {
    return key === "awards" ? refs.employeeAwardTopList : refs.employeeTopList;
  }

  async function loadRanking(key) {
    const container = rankingContainer(key);
    if (!container) {
      return;
    }
    if (state.rankingAbortControllers[key]) {
      state.rankingAbortControllers[key].abort();
    }
    const controller = new AbortController();
    state.rankingAbortControllers[key] = controller;
    renderLeaderboardLoading(container);
    try {
      const rows = await getRankingRows(currentPeriod(), controller.signal);
      if (controller.signal.aborted || state.rankingAbortControllers[key] !== controller) {
        return;
      }
      state.rankingRows[key] = renderLeaderboard(container, rows);
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        return;
      }
      state.rankingRows[key] = [];
      renderLeaderboardState(
        container,
        "error",
        "Dữ liệu khác trong module vẫn có thể tiếp tục sử dụng."
      );
    }
  }

  function renderTeamOverview(payload) {
    const data = payload || {};
    refs.employeeKpiActiveEmployees.textContent = kpi().formatNumber(data.active_employees);
    refs.employeeKpiActiveAssignments.textContent = kpi().formatNumber(data.active_assignments);
    refs.employeeKpiCompletedToday.textContent = kpi().formatNumber(data.completed_today);
    refs.employeeKpiCompletedMonth.textContent = kpi().formatNumber(data.completed_this_month);
    refs.employeeKpiCompletionRate.textContent = kpi().formatPercent(data.completion_rate);
    refs.employeeKpiAverageHours.textContent = kpi().formatHours(data.average_repair_hours);
    setTrend(
      refs.employeeTrendCompleted,
      kpi().compareMetric(data.completed_in_period, data.previous_completed)
    );
    setTrend(
      refs.employeeTrendCompletionRate,
      kpi().compareMetric(data.completion_rate, data.previous_completion_rate, {
        suffix: " điểm %"
      })
    );
    setTrend(
      refs.employeeTrendAverageHours,
      kpi().compareMetric(data.average_repair_hours, data.previous_average_hours, {
        inverse: true,
        suffix: " giờ"
      })
    );
    refs.employeeTrendActiveEmployees.textContent = "Hồ sơ active trong phạm vi quyền";
    refs.employeeTrendActiveAssignments.textContent = "Assignment đang thực hiện";

    const series = kpi().splitDailySeries(data.daily_series || []);
    const weeklyRendered = window.AMEmployeeCharts.renderWeeklyComparison(
      refs.employeeWeeklyChart,
      series
    );
    refs.employeeWeeklyChartFallback.hidden = weeklyRendered;
    refs.employeeWeeklyChart.hidden = !weeklyRendered;
    const distributionRendered = window.AMEmployeeCharts.renderWorkDistribution(
      refs.employeeDistributionChart,
      data.work_distribution || []
    );
    refs.employeeDistributionFallback.hidden = distributionRendered;
    refs.employeeDistributionChart.hidden = !distributionRendered;
  }

  function renderUnassigned(rows) {
    refs.employeeUnassignedList.replaceChildren();
    const data = Array.isArray(rows) ? rows : [];
    refs.employeeUnassignedState.hidden = data.length > 0;
    refs.employeeUnassignedState.textContent = data.length > 0
      ? ""
      : "Hiện không có tivi đang sửa chưa giao nhân viên.";

    data.forEach((ticket) => {
      const item = element("article", "employee-unassigned-item");
      const copy = element("div");
      copy.append(
        element("strong", "", formatTicketCode(ticket.ticket_code)),
        element("span", "", [ticket.device_brand, ticket.device_model].filter(Boolean).join(" · ") || "Chưa có model"),
        element("p", "", ticket.condition_text || "Chưa cập nhật tình trạng")
      );
      const action = element("button", "btn secondary compact", "Giao nhân viên");
      action.type = "button";
      action.dataset.employeeAction = "assign-unassigned";
      action.dataset.ticketId = ticket.ticket_id;
      item.dataset.ticketId = ticket.ticket_id;
      item.append(copy, action);
      refs.employeeUnassignedList.appendChild(item);
    });
  }

  async function loadTeamOverview() {
    if (state.teamAbortController) {
      state.teamAbortController.abort();
    }
    state.teamAbortController = new AbortController();
    updateRankingPeriodLabels();
    void loadRanking("team");
    sectionState(refs.employeeOverviewState, refs.employeeOverviewContent, "loading", "Đang tải tổng quan hiệu suất...");
    const period = currentPeriod();
    try {
      const [overviewResult, queueResult] = await Promise.allSettled([
        window.AMApi.getEmployeeTeamOverview({
          periodStart: period.start,
          periodEnd: period.end,
          signal: state.teamAbortController.signal
        }),
        canManage()
          ? window.AMApi.getEmployeeAssignments({
            status: "unassigned",
            page: 1,
            pageSize: 10,
            signal: state.teamAbortController.signal
          })
          : Promise.resolve({ rows: [], count: 0 })
      ]);
      if (overviewResult.status === "rejected") {
        throw overviewResult.reason;
      }
      renderTeamOverview(overviewResult.value || {});
      if (queueResult.status === "fulfilled") {
        renderUnassigned(queueResult.value.rows || []);
      } else {
        refs.employeeUnassignedState.hidden = false;
        refs.employeeUnassignedState.textContent = "Không thể tải hàng chờ phân công. Tổng quan vẫn hoạt động.";
      }
      sectionState(refs.employeeOverviewState, refs.employeeOverviewContent, "data", "");
      state.teamLoaded = true;
      updateLastUpdated(overviewResult.value && overviewResult.value.generated_at);
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      sectionState(
        refs.employeeOverviewState,
        refs.employeeOverviewContent,
        "error",
        error.message || "Không thể tải tổng quan hiệu suất."
      );
    }
  }

  async function loadDirectory(options) {
    const settings = options || {};
    const version = ++state.directoryLoadVersion;
    if (state.directoryAbortController) {
      state.directoryAbortController.abort();
    }
    state.directoryAbortController = new AbortController();
    state.directoryController.setLoading("Đang tải nhân viên...");
    const period = currentPeriod();
    const search = refs.employeeDirectorySearch.value.trim();
    const status = refs.employeeDirectoryStatus.value;

    try {
      const result = await window.AMApi.getEmployeeKpiSummary({
        periodStart: period.start,
        periodEnd: period.end,
        search,
        status,
        page: 1,
        pageSize: DIRECTORY_PAGE_SIZE,
        signal: state.directoryAbortController.signal
      });
      if (version !== state.directoryLoadVersion) {
        return;
      }
      state.directory = result.rows || [];
      state.directoryCount = result.count || 0;

      const requested = settings.requestedEmployeeId || "";
      if (!state.selectedEmployee) {
        state.selectedEmployee = state.directory.find((row) => employeeId(row) === requested)
          || state.directory[0]
          || null;
      } else {
        const freshSelected = state.directory.find((row) => employeeId(row) === selectedEmployeeId());
        if (freshSelected) {
          state.selectedEmployee = freshSelected;
        }
      }

      state.directoryController.render(state.directory, selectedEmployeeId(), {
        activeCount: activeDirectoryCount(state.directory),
        isFiltered: Boolean(search || status)
      });

      if (!state.selectedEmployee) {
        window.AMEmployeeProfile.renderEmpty(
          refs.employeeProfileContent,
          canManage(),
          Boolean(search || status)
        );
        writeUrl({ replace: true });
        return;
      }

      if (settings.loadProfile !== false) {
        await selectEmployee(state.selectedEmployee, {
          replace: settings.replace !== false,
          skipDirectoryUpdate: true
        });
      }
    } catch (error) {
      if (isAbortError(error) || version !== state.directoryLoadVersion) {
        return;
      }
      state.directoryController.setError(
        error.message || "Không thể tải danh sách nhân viên.",
        () => loadDirectory({ loadProfile: !state.profileDetail })
      );
      if (error.employeeModuleUnavailable) {
        setNotice("info", "Module Nhân viên chưa được kích hoạt trên backend.");
      }
    }
  }

  function profileWeeklySeries(rows) {
    const data = Array.isArray(rows) ? rows.slice(-14) : [];
    return {
      previous: data.slice(0, Math.max(data.length - 7, 0)),
      current: data.slice(-7)
    };
  }

  function weekLabel(item) {
    return item && item.week_start
      ? new Intl.DateTimeFormat("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        timeZone: "Asia/Ho_Chi_Minh"
      }).format(new Date(`${item.week_start}T00:00:00+07:00`))
      : "";
  }

  function toggleChart(id, rendered) {
    const chart = query(id);
    const fallback = query(`${id}Fallback`);
    if (chart) {
      chart.hidden = !rendered;
    }
    if (fallback) {
      fallback.hidden = rendered;
    }
  }

  function renderProfileCharts() {
    if (!state.profileDetail || state.profileView !== "performance") {
      return;
    }
    const analysis = refs.employeeProfileContent.querySelector(".employee-performance-analysis");
    if (analysis && !analysis.open) {
      return;
    }
    const detail = state.profileDetail;
    const weekly = window.AMEmployeeCharts.renderWeeklyComparison(
      query("employeePersonalWeeklyChart"),
      profileWeeklySeries(detail.daily_series)
    );
    toggleChart("employeePersonalWeeklyChart", weekly);

    const eightWeek = window.AMEmployeeCharts.renderDualMetricBars(
      query("employeePersonalEightWeekChart"),
      detail.weekly_series || [],
      {
        firstKey: "assigned",
        secondKey: "completed",
        firstLabel: "Được giao",
        secondLabel: "Hoàn thành",
        title: "Khối lượng 8 tuần",
        description: "So sánh số tivi được giao và hoàn thành.",
        labelFormatter: weekLabel
      }
    );
    toggleChart("employeePersonalEightWeekChart", eightWeek);

    const hours = window.AMEmployeeCharts.renderTrend(
      query("employeePersonalHoursChart"),
      detail.weekly_series || [],
      {
        valueKey: "average_hours",
        title: "Thời gian sửa trung bình",
        description: "Số giờ xử lý trung bình của assignment hoàn thành.",
        labelFormatter: weekLabel
      }
    );
    toggleChart("employeePersonalHoursChart", hours);

    const distribution = window.AMEmployeeCharts.renderWorkDistribution(
      query("employeePersonalDistributionChart"),
      detail.work_distribution || []
    );
    toggleChart("employeePersonalDistributionChart", distribution);
  }

  function renderSelectedProfile() {
    if (!state.profileDetail) {
      return;
    }
    window.AMEmployeeProfile.render(refs.employeeProfileContent, state.profileDetail, {
      employee: state.selectedEmployee,
      canManage: canManage(),
      activeView: state.profileView,
      assignments: state.profileAssignments,
      assignmentMeta: state.profileAssignmentMeta,
      completedWorkPeriod: completedWorkRange(),
      notes: state.managementNotes
    });
    renderProfileCharts();
  }

  async function loadProfileAssignmentPage(type, requestedPage) {
    if (!state.selectedEmployee || !["active", "completed"].includes(type)) {
      return;
    }
    const id = employeeId(state.selectedEmployee);
    const meta = state.profileAssignmentMeta[type];
    const page = Math.max(Number(requestedPage) || 1, 1);
    const range = type === "completed" ? completedWorkRange() : {
      start: null,
      end: null
    };

    if (state.assignmentAbortControllers[type]) {
      state.assignmentAbortControllers[type].abort();
    }
    const controller = new AbortController();
    state.assignmentAbortControllers[type] = controller;
    meta.loading = true;
    meta.error = "";
    renderSelectedProfile();

    try {
      const result = await window.AMApi.getEmployeeAssignments({
        employeeId: id,
        status: type,
        periodStart: range.start,
        periodEnd: range.end,
        page,
        pageSize: PAGE_SIZE,
        signal: controller.signal
      });
      if (controller.signal.aborted || employeeId(state.selectedEmployee) !== id) {
        return;
      }

      const count = Number(result.count) || 0;
      const totalPages = Math.max(Math.ceil(count / PAGE_SIZE), 1);
      if (page > totalPages) {
        meta.loading = false;
        await loadProfileAssignmentPage(type, totalPages);
        return;
      }

      state.profileAssignments[type] = result.rows || [];
      state.profileAssignmentMeta[type] = {
        page,
        count,
        loading: false,
        error: ""
      };
      renderSelectedProfile();
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        return;
      }
      state.profileAssignmentMeta[type] = Object.assign({}, meta, {
        loading: false,
        error: error.message || "Không thể tải danh sách phân công."
      });
      renderSelectedProfile();
    }
  }

  async function selectEmployee(employee, options) {
    const settings = options || {};
    if (!employee) {
      return;
    }
    const id = employeeId(employee);
    if (!id) {
      return;
    }
    state.selectedEmployee = employee;
    state.view = "profile";
    state.directoryController.setSelected(id);
    updateViewButtons();
    if (!settings.fromPopState) {
      writeUrl({ replace: Boolean(settings.replace) });
    }

    if (state.profileAbortController) {
      state.profileAbortController.abort();
    }
    if (state.profileKpiAbortController) {
      state.profileKpiAbortController.abort();
      state.profileKpiAbortController = null;
    }
    if (state.profileTargetAbortController) {
      state.profileTargetAbortController.abort();
      state.profileTargetAbortController = null;
    }
    state.profileAbortController = new AbortController();
    const version = ++state.profileLoadVersion;
    resetProfileAssignments();
    state.managementNotes = [];
    state.profileDetail = Object.assign({}, employee, {
      is_kpi_eligible: employee.is_kpi_eligible,
      performance_state: "loading",
      performance_error: "",
      target: null,
      target_state: "loading",
      target_error: ""
    });
    renderSelectedProfile();
    const period = currentPeriod();
    const completedRange = completedWorkRange();

    const performanceTask = window.AMApi.getEmployeeKpiDetail(id, {
      periodStart: period.start,
      periodEnd: period.end,
      signal: state.profileAbortController.signal
    }).then((data) => {
      if (version !== state.profileLoadVersion) {
        return data;
      }
      const current = state.profileDetail || {};
      const canUseEmbeddedTarget = current.target_state === "error" && data && data.target;
      state.profileDetail = Object.assign({}, current, data || {}, {
        is_kpi_eligible: employee.is_kpi_eligible,
        performance_state: "ready",
        performance_error: "",
        target: canUseEmbeddedTarget ? data.target : current.target,
        target_state: canUseEmbeddedTarget ? "ready" : current.target_state,
        target_error: canUseEmbeddedTarget ? "" : current.target_error
      });
      renderSelectedProfile();
      return data;
    }).catch((error) => {
      if (!isAbortError(error) && version === state.profileLoadVersion) {
        state.profileDetail = Object.assign({}, state.profileDetail, {
          performance_state: "error",
          performance_error: "Không thể tải số liệu hiệu suất."
        });
        renderSelectedProfile();
      }
      throw error;
    });

    const targetTask = window.AMApi.getEmployeeKpiTargets({
      employeeId: id,
      periodStart: period.start,
      periodEnd: period.end,
      page: 1,
      pageSize: 1,
      signal: state.profileAbortController.signal
    }).then((result) => {
      if (version !== state.profileLoadVersion) {
        return result;
      }
      state.profileDetail = Object.assign({}, state.profileDetail, {
        target: result && Array.isArray(result.rows) ? (result.rows[0] || null) : null,
        target_state: "ready",
        target_error: ""
      });
      renderSelectedProfile();
      return result;
    }).catch((error) => {
      if (!isAbortError(error) && version === state.profileLoadVersion) {
        const embeddedTarget = state.profileDetail && state.profileDetail.target;
        state.profileDetail = Object.assign({}, state.profileDetail, {
          target_state: embeddedTarget ? "ready" : "error",
          target_error: embeddedTarget ? "" : "Không thể tải mục tiêu tháng."
        });
        renderSelectedProfile();
      }
      throw error;
    });

    const tasks = [
      performanceTask,
      targetTask,
      window.AMApi.getEmployeeAssignments({
        employeeId: id,
        status: "active",
        page: 1,
        pageSize: PAGE_SIZE,
        signal: state.profileAbortController.signal
      }),
      window.AMApi.getEmployeeAssignments({
        employeeId: id,
        status: "completed",
        periodStart: completedRange.start,
        periodEnd: completedRange.end,
        page: 1,
        pageSize: PAGE_SIZE,
        signal: state.profileAbortController.signal
      }),
      canManage()
        ? window.AMApi.getEmployeeManagementNotes(id, {
          limit: 20,
          signal: state.profileAbortController.signal
        })
        : Promise.resolve([])
    ];

    try {
      const results = await Promise.allSettled(tasks);
      if (version !== state.profileLoadVersion) {
        return;
      }
      state.profileAssignments = {
        active: results[2].status === "fulfilled" ? (results[2].value.rows || []) : [],
        completed: results[3].status === "fulfilled" ? (results[3].value.rows || []) : []
      };
      state.profileAssignmentMeta = {
        active: {
          page: 1,
          count: results[2].status === "fulfilled" ? results[2].value.count : 0,
          loading: false,
          error: results[2].status === "rejected"
            ? "Không thể tải tivi đang thực hiện."
            : ""
        },
        completed: {
          page: 1,
          count: results[3].status === "fulfilled" ? results[3].value.count : 0,
          loading: false,
          error: results[3].status === "rejected"
            ? "Không thể tải danh sách đã sửa."
            : ""
        }
      };
      state.managementNotes = results[4].status === "fulfilled" ? results[4].value : null;
      renderSelectedProfile();

      const partialFailures = results.filter((result) => result.status === "rejected");
      if (partialFailures.length > 0) {
        setNotice("info", "Một phần dữ liệu hồ sơ chưa tải được; các phần còn lại vẫn hoạt động.");
      } else {
        setNotice("", "");
      }
      updateLastUpdated();
    } catch (error) {
      if (isAbortError(error) || version !== state.profileLoadVersion) {
        return;
      }
      window.AMEmployeeProfile.renderError(
        refs.employeeProfileContent,
        "Không thể tải hồ sơ nhân viên."
      );
    }
  }

  async function loadProfileKpi() {
    if (!state.selectedEmployee || !state.profileDetail) {
      return;
    }
    if (state.profileKpiAbortController) {
      state.profileKpiAbortController.abort();
    }
    const controller = new AbortController();
    const version = state.profileLoadVersion;
    const id = employeeId(state.selectedEmployee);
    state.profileKpiAbortController = controller;
    state.profileDetail = Object.assign({}, state.profileDetail, {
      performance_state: "loading",
      performance_error: ""
    });
    renderSelectedProfile();

    try {
      const period = currentPeriod();
      const data = await window.AMApi.getEmployeeKpiDetail(id, {
        periodStart: period.start,
        periodEnd: period.end,
        signal: controller.signal
      });
      if (controller.signal.aborted || version !== state.profileLoadVersion) {
        return;
      }
      const current = state.profileDetail || {};
      state.profileDetail = Object.assign({}, current, data || {}, {
        target: current.target,
        target_state: current.target_state,
        target_error: current.target_error,
        performance_state: "ready",
        performance_error: ""
      });
      renderSelectedProfile();
      updateLastUpdated();
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted || version !== state.profileLoadVersion) {
        return;
      }
      state.profileDetail = Object.assign({}, state.profileDetail, {
        performance_state: "error",
        performance_error: "Không thể tải số liệu hiệu suất."
      });
      renderSelectedProfile();
    }
  }

  async function loadProfileTarget() {
    if (!state.selectedEmployee || !state.profileDetail) {
      return;
    }
    if (state.profileTargetAbortController) {
      state.profileTargetAbortController.abort();
    }
    const controller = new AbortController();
    const version = state.profileLoadVersion;
    const id = employeeId(state.selectedEmployee);
    state.profileTargetAbortController = controller;
    state.profileDetail = Object.assign({}, state.profileDetail, {
      target_state: "loading",
      target_error: ""
    });
    renderSelectedProfile();

    try {
      const period = currentPeriod();
      const result = await window.AMApi.getEmployeeKpiTargets({
        employeeId: id,
        periodStart: period.start,
        periodEnd: period.end,
        page: 1,
        pageSize: 1,
        signal: controller.signal
      });
      if (controller.signal.aborted || version !== state.profileLoadVersion) {
        return;
      }
      state.profileDetail = Object.assign({}, state.profileDetail, {
        target: result && Array.isArray(result.rows) ? (result.rows[0] || null) : null,
        target_state: "ready",
        target_error: ""
      });
      renderSelectedProfile();
      updateLastUpdated();
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted || version !== state.profileLoadVersion) {
        return;
      }
      state.profileDetail = Object.assign({}, state.profileDetail, {
        target_state: "error",
        target_error: "Không thể tải mục tiêu tháng."
      });
      renderSelectedProfile();
    }
  }

  function awardSnapshot(type, rows, nameNode, metaNode, emptyMeta) {
    const row = rows.find((award) => award.award_type === type);
    if (!row) {
      nameNode.textContent = "Chưa chốt";
      metaNode.textContent = emptyMeta;
      return;
    }
    nameNode.textContent = row.full_name_snapshot || "Nhân viên";
    metaNode.textContent = `${kpi().formatNumber(row.completed_tickets)} tivi · ${kpi().formatPercent(row.kpi_score)} điểm`;
  }

  function renderAwards(rows) {
    const data = Array.isArray(rows) ? rows : [];
    awardSnapshot("weekly", data, refs.employeeAwardWeeklyName, refs.employeeAwardWeeklyMeta, "Chưa có snapshot tuần.");
    awardSnapshot("monthly", data, refs.employeeAwardMonthlyName, refs.employeeAwardMonthlyMeta, "Chưa có snapshot tháng.");
    awardSnapshot("custom", data, refs.employeeAwardCustomName, refs.employeeAwardCustomMeta, "Chưa có snapshot khác.");
    refs.employeeAwardList.replaceChildren();
    if (data.length === 0) {
      refs.employeeAwardList.appendChild(element("p", "employee-empty-copy", "Chưa có vinh danh nào được chốt."));
      return;
    }
    data.forEach((award) => {
      const item = element("article", "employee-award-item");
      const heading = element("div");
      heading.append(
        element("strong", "", award.title || "Vinh danh"),
        element("span", "", award.full_name_snapshot || "Nhân viên")
      );
      const meta = element("div", "employee-award-item__meta");
      meta.append(
        element("span", "", `${kpi().formatDate(award.period_start)} – ${kpi().formatDate(award.period_end)}`),
        element("span", "", `${kpi().formatNumber(award.completed_tickets)} hoàn thành`),
        element("span", "", `Điểm ${kpi().formatPercent(award.kpi_score)}`)
      );
      item.append(heading, meta);
      refs.employeeAwardList.appendChild(item);
    });
  }

  async function loadAwards() {
    if (!state.recognition) {
      if (!window.AMEmployeeRecognition || !refs.employeeRecognitionRoot) {
        throw new Error("Không tải được giao diện Vinh danh mới.");
      }
      state.recognition = window.AMEmployeeRecognition.create({
        root: refs.employeeRecognitionRoot,
        onOpenProfile: openRankingEmployee,
        canManage,
        onAdjustPoints: openCompletedWorkPointAdjustment
      });
    }
    await state.recognition.load();
    state.awardsLoaded = true;
  }

  function field(labelText, name, value, options) {
    const settings = options || {};
    const label = element("label", settings.className || "employee-form-field");
    label.appendChild(element("span", "", labelText));
    let control;
    if (settings.type === "textarea") {
      control = document.createElement("textarea");
      control.rows = settings.rows || 4;
    } else if (settings.type === "select") {
      control = document.createElement("select");
      (settings.options || []).forEach((option) => {
        const node = element("option", "", option.label);
        node.value = option.value;
        control.appendChild(node);
      });
    } else {
      control = document.createElement("input");
      control.type = settings.type || "text";
    }
    control.name = name;
    control.value = value === null || value === undefined ? "" : String(value);
    if (settings.placeholder) {
      control.placeholder = settings.placeholder;
    }
    if (settings.required) {
      control.required = true;
    }
    if (settings.inputMode) {
      control.inputMode = settings.inputMode;
    }
    if (settings.maxLength) {
      control.maxLength = settings.maxLength;
    }
    if (settings.minLength) {
      control.minLength = settings.minLength;
    }
    if (settings.min !== undefined) {
      control.min = String(settings.min);
    }
    if (settings.max !== undefined) {
      control.max = String(settings.max);
    }
    if (settings.step !== undefined) {
      control.step = String(settings.step);
    }
    if (settings.disabled) {
      control.disabled = true;
    }
    label.appendChild(control);
    return label;
  }

  function checkboxField(labelText, name, checked) {
    const label = element("label", "employee-checkbox employee-form-checkbox");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = name;
    input.checked = Boolean(checked);
    label.append(input, element("span", "", labelText));
    return label;
  }

  function openDialog(options) {
    const settings = options || {};
    const returnFocus = document.activeElement;
    const pageShell = document.querySelector(".page-shell");
    const dialogId = String(settings.id || "employee-form-dialog");
    const existingBackdrop = Array.from(state.dialogs).find(
      (node) => node.dataset.employeeDialogId === dialogId && document.contains(node)
    );
    if (existingBackdrop) {
      const existingDialog = existingBackdrop.querySelector("[role='dialog']");
      const existingControl = existingDialog && (
        existingDialog.querySelector("[name='full_name']:not([disabled])")
        || existingDialog.querySelector(
          "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])"
        )
      );
      (existingControl || existingDialog || existingBackdrop).focus({ preventScroll: true });
      return {
        backdrop: existingBackdrop,
        dialog: existingDialog,
        close: () => {},
        reused: true
      };
    }

    if (!(settings.content instanceof Node) || typeof settings.onSubmit !== "function") {
      throw new Error("Cấu hình biểu mẫu nhân viên không hợp lệ.");
    }

    const backdrop = element(
      "div",
      "employee-form-backdrop employee-form-modal-backdrop"
    );
    backdrop.dataset.employeeDialogId = dialogId;
    const dialog = element("form", "employee-form-dialog employee-form-modal");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", `${dialogId}-title`);
    dialog.tabIndex = -1;
    const header = element(
      "header",
      "employee-form-dialog__header employee-form-modal__header"
    );
    const copy = element("div");
    const title = element("h2", "", settings.title);
    title.id = `${dialogId}-title`;
    copy.appendChild(title);
    if (settings.description) {
      copy.appendChild(element("p", "", settings.description));
    }
    const close = element(
      "button",
      "employee-form-dialog__close employee-form-modal__close",
      "×"
    );
    close.type = "button";
    close.setAttribute("aria-label", "Đóng");
    header.append(copy, close);
    const body = element(
      "div",
      "employee-form-dialog__body employee-form-modal__body"
    );
    body.appendChild(settings.content);
    const status = element("p", "employee-form-modal__status");
    status.setAttribute("aria-live", "polite");
    status.hidden = true;
    const footer = element(
      "footer",
      "employee-form-dialog__footer employee-form-modal__footer"
    );
    const cancel = element("button", "btn secondary", "Hủy");
    cancel.type = "button";
    const submit = element("button", "btn primary", settings.submitLabel || "Lưu");
    submit.type = "submit";
    footer.append(cancel, submit);
    dialog.append(header, body, status, footer);
    backdrop.appendChild(dialog);
    let busy = false;
    let closed = false;
    const restorePageState = () => {
      const hasOpenDialogs = state.dialogs.size > 0;
      if (pageShell) {
        pageShell.inert = hasOpenDialogs;
      }
      document.body.classList.toggle("employee-form-modal-open", hasOpenDialogs);
    };
    const closeDialog = (options) => {
      const closeOptions = options || {};
      if (closed || (busy && !closeOptions.force)) {
        return;
      }
      closed = true;
      backdrop.remove();
      state.dialogs.delete(backdrop);
      restorePageState();
      if (closeOptions.restoreFocus !== false && returnFocus && document.contains(returnFocus)) {
        returnFocus.focus({ preventScroll: true });
      }
    };
    close.addEventListener("click", closeDialog);
    cancel.addEventListener("click", closeDialog);
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        closeDialog();
      }
    });
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key === "Tab") {
        const focusable = Array.from(
          dialog.querySelectorAll(
            "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"
          )
        ).filter((node) => node.offsetParent !== null);
        if (!focusable.length) {
          event.preventDefault();
          dialog.focus({ preventScroll: true });
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus({ preventScroll: true });
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus({ preventScroll: true });
        }
      }
    });
    dialog.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy || !dialog.reportValidity()) {
        return;
      }
      busy = true;
      submit.disabled = true;
      cancel.disabled = true;
      close.disabled = true;
      submit.textContent = settings.pendingLabel || "Đang lưu...";
      status.textContent = "";
      status.hidden = true;
      try {
        await settings.onSubmit(new FormData(dialog), dialog);
        busy = false;
        closeDialog();
      } catch (error) {
        busy = false;
        submit.disabled = false;
        cancel.disabled = false;
        close.disabled = false;
        submit.textContent = settings.submitLabel || "Lưu";
        status.textContent = error.message || "Không thể hoàn thành thao tác.";
        status.className = "employee-form-modal__status employee-form-error is-error";
        status.hidden = false;
      }
    });

    try {
      document.body.appendChild(backdrop);
      state.dialogs.add(backdrop);
      document.body.classList.add("employee-form-modal-open");
      if (pageShell) {
        pageShell.inert = true;
      }
      const initialControl = dialog.querySelector("[name='full_name']:not([disabled])")
        || dialog.querySelector(
          "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])"
        );
      (initialControl || dialog).focus({ preventScroll: true });
      window.requestAnimationFrame(() => {
        if (closed || !document.contains(dialog)) {
          return;
        }
        if (!dialog.contains(document.activeElement)) {
          (initialControl || dialog).focus({ preventScroll: true });
        }
      });
    } catch (error) {
      closeDialog({ force: true, restoreFocus: false });
      restorePageState();
      throw error;
    }
    return { backdrop, dialog, close: closeDialog, reused: false };
  }

  function replaceSelectOptions(select, options, selectedValue) {
    select.replaceChildren();
    (options || []).forEach((option) => {
      const node = element("option", "", option.label);
      node.value = option.value;
      select.appendChild(node);
    });
    select.value = selectedValue === null || selectedValue === undefined ? "" : String(selectedValue);
  }

  function openEmployeeForm(employee) {
    if (!canManage()) {
      window.AMUI.toast("Chỉ Owner/Admin được quản lý hồ sơ nhân viên.", { type: "error" });
      return;
    }
    const current = employee || {};
    const content = element("div", "employee-form-grid");
    content.append(
      field("Họ và tên *", "full_name", current.full_name, { required: true, maxLength: 120 }),
      field("Mã nhân viên", "employee_code", current.employee_code || "Tự sinh khi lưu", {
        disabled: true
      }),
      field("Số điện thoại", "phone", current.phone, { inputMode: "tel", maxLength: 20 }),
      field("Email", "email", current.email, { type: "email", maxLength: 160 }),
      field("Chức danh", "job_title", current.job_title, { maxLength: 100 }),
      field("Phòng ban", "department", current.department, { maxLength: 100 }),
      field("Ngày vào làm", "joined_date", current.joined_date, { type: "date" }),
      field("Trạng thái", "employment_status", current.employment_status || "active", {
        type: "select",
        options: [
          { value: "active", label: "Đang hoạt động" },
          { value: "inactive", label: "Ngừng hoạt động" },
          { value: "suspended", label: "Tạm khóa" }
        ]
      }),
      field("Liên kết tài khoản nội bộ", "internal_user_id", current.internal_user_id || "", {
        type: "select",
        options: [
          current.internal_user_id
            ? { value: current.internal_user_id, label: "Tài khoản đang liên kết" }
            : { value: "", label: "Đang tải tài khoản nội bộ..." }
        ],
        disabled: true
      }),
      checkboxField("Nhân viên được tính KPI", "is_kpi_eligible", current.is_kpi_eligible !== false),
      field("Ghi chú hồ sơ", "notes", current.notes, {
        type: "textarea",
        rows: 4,
        maxLength: 1000,
        className: "employee-form-field employee-form-field--wide"
      })
    );
    const dialogHandle = openDialog({
      id: "employee-profile-form",
      title: current.employee_id ? "Chỉnh sửa hồ sơ" : "Thêm nhân viên",
      description: "Hồ sơ nhân viên có thể tồn tại mà chưa cần tài khoản đăng nhập.",
      content,
      submitLabel: current.employee_id ? "Lưu thay đổi" : "Lưu nhân viên",
      pendingLabel: "Đang lưu...",
      onSubmit: async (formData) => {
        const result = await window.AMApi.saveEmployeeProfile({
          id: current.employee_id || null,
          internal_user_id: formData.get("internal_user_id"),
          full_name: formData.get("full_name"),
          phone: formData.get("phone"),
          email: formData.get("email"),
          job_title: formData.get("job_title"),
          department: formData.get("department"),
          employment_status: formData.get("employment_status"),
          joined_date: formData.get("joined_date"),
          notes: formData.get("notes"),
          is_kpi_eligible: formData.get("is_kpi_eligible") === "on",
          updated_at: current.updated_at || null
        });
        window.AMUI.toast("Đã lưu hồ sơ nhân viên.", { type: "success" });
        await loadDirectory({
          requestedEmployeeId: result && result.employee_id,
          replace: true
        });
      }
    });

    if (!dialogHandle || dialogHandle.reused) {
      return dialogHandle;
    }

    const internalUserSelect = dialogHandle.dialog.querySelector("[name='internal_user_id']");
    Promise.resolve()
      .then(() => window.AMApi.listLinkableInternalUsers())
      .then((internalUsers) => {
        if (!internalUserSelect || !document.contains(internalUserSelect)) {
          return;
        }
        replaceSelectOptions(
          internalUserSelect,
          [
            { value: "", label: "Chưa liên kết tài khoản" },
            ...(internalUsers || [])
              .filter((user) => !user.employee_id || user.employee_id === current.employee_id)
              .map((user) => ({
                value: user.internal_user_id,
                label: `${user.internal_user_name || "Tài khoản nội bộ"}${user.internal_user_active ? "" : " · ngừng hoạt động"}`
              }))
          ],
          current.internal_user_id || ""
        );
        internalUserSelect.disabled = false;
      })
      .catch((error) => {
        if (!internalUserSelect || !document.contains(internalUserSelect)) {
          return;
        }
        replaceSelectOptions(
          internalUserSelect,
          current.internal_user_id
            ? [{ value: current.internal_user_id, label: "Giữ tài khoản đang liên kết" }]
            : [{ value: "", label: "Chưa liên kết tài khoản" }],
          current.internal_user_id || ""
        );
        internalUserSelect.disabled = false;
        window.AMUI.toast(error.message || "Không tải được tài khoản nội bộ. Biểu mẫu vẫn có thể sử dụng.", {
          type: "error"
        });
      });

    return dialogHandle;
  }

  function openCompletedWorkPointAdjustment(row, _trigger, onSuccess) {
    if (!canManage() || !row || !row.snapshot_id) {
      return;
    }
    const content = element("div", "employee-form-grid");
    const explanation = element(
      "p",
      "employee-form-explanation employee-form-field--wide",
      `Điều chỉnh ${formatTicketCode(row.ticket_code)} sẽ tạo bản ghi audit; snapshot cũ không bị sửa âm thầm.`
    );
    content.append(
      explanation,
      field("Kích thước xác nhận (inch)", "manual_size_inches", "", {
        type: "number",
        inputMode: "numeric",
        min: 20,
        max: 120,
        step: 1,
        placeholder: row.tv_size_inches ? `Giữ ${row.tv_size_inches} inch nếu để trống` : "Ví dụ: 65"
      }),
      field("Độ khó *", "complexity_level", row.complexity_level || "standard", {
        type: "select",
        required: true,
        options: COMPLEXITY_OPTIONS
      }),
      field("Lý do điều chỉnh *", "reason", "", {
        type: "textarea",
        required: true,
        minLength: 5,
        maxLength: 1000,
        rows: 4,
        className: "employee-form-field employee-form-field--wide",
        placeholder: "Nêu rõ căn cứ xác nhận lại kích thước hoặc độ khó."
      })
    );
    openDialog({
      id: `employee-work-point-adjust-${row.snapshot_id}`,
      title: "Điều chỉnh điểm công việc",
      description: "Chỉ Owner/Admin được thực hiện; lý do và giá trị trước/sau được lưu đầy đủ.",
      content,
      submitLabel: "Lưu điều chỉnh",
      pendingLabel: "Đang lưu điều chỉnh...",
      onSubmit: async (formData) => {
        await window.AMApi.adjustEmployeeCompletedWorkPoints({
          snapshotId: row.snapshot_id,
          manualSize: formData.get("manual_size_inches"),
          complexityLevel: formData.get("complexity_level"),
          reason: formData.get("reason"),
          expectedCalculatedAt: row.calculated_at
        });
        window.AMUI.toast("Đã điều chỉnh điểm và lưu lịch sử audit.", { type: "success" });
        if (typeof onSuccess === "function") {
          await onSuccess();
        }
      }
    });
  }

  async function openScoringRulesForm() {
    if (!canManage()) {
      return;
    }
    const config = await window.AMApi.getEmployeeScoringRuleConfig();
    if (!config || !config.rule) {
      window.AMUI.toast("Chưa có rule tính điểm đang hoạt động để tạo phiên bản kế tiếp.", { type: "warning" });
      return;
    }
    const rule = config.rule;
    const sizeRules = Array.isArray(config.sizeRules) ? config.sizeRules : [];
    const complexityRules = Array.isArray(config.complexityRules) ? config.complexityRules : [];
    const effectiveDate = kpi().todayIso();
    const content = element("div", "employee-scoring-rule-form");
    content.appendChild(element(
      "p",
      "employee-form-explanation",
      `Rule đang dùng: ${rule.version_code}. Lưu sẽ tạo một phiên bản mới; snapshot các tháng trước giữ nguyên.`
    ));
    const core = element("div", "employee-form-grid");
    core.append(
      field("Mã phiên bản mới *", "version_code", "", {
        required: true,
        maxLength: 40,
        placeholder: "Ví dụ: 2026.08-v1"
      }),
      field("Hiệu lực từ *", "effective_from", effectiveDate, {
        type: "date",
        required: true,
        min: effectiveDate,
        max: effectiveDate
      }),
      field("Tỷ trọng sản lượng (%) *", "productivity_weight", rule.productivity_weight, {
        type: "number", required: true, min: 0, max: 100, step: 0.01, inputMode: "decimal"
      }),
      field("Tỷ trọng chất lượng (%) *", "quality_weight", rule.quality_weight, {
        type: "number", required: true, min: 0, max: 100, step: 0.01, inputMode: "decimal"
      }),
      field("Tỷ trọng tiến độ (%) *", "progress_weight", rule.progress_weight, {
        type: "number", required: true, min: 0, max: 100, step: 0.01, inputMode: "decimal"
      }),
      field("Giới hạn điểm KPI *", "score_cap", rule.score_cap, {
        type: "number", required: true, min: 100, max: 200, step: 0.01, inputMode: "decimal"
      })
    );
    content.appendChild(core);

    const sizeSection = element("section", "employee-scoring-rule-section");
    sizeSection.appendChild(element("h3", "", "Hệ số kích thước"));
    const sizeGrid = element("div", "employee-scoring-rule-grid");
    sizeRules.forEach((sizeRule, index) => {
      sizeGrid.appendChild(field(sizeRule.label || sizeRule.band_key, `size_weight_${index}`, sizeRule.weight, {
        type: "number", required: true, min: 0.01, max: 10, step: 0.01, inputMode: "decimal"
      }));
    });
    sizeSection.appendChild(sizeGrid);
    content.appendChild(sizeSection);

    const complexitySection = element("section", "employee-scoring-rule-section");
    complexitySection.appendChild(element("h3", "", "Hệ số độ khó"));
    const complexityGrid = element("div", "employee-scoring-rule-grid");
    complexityRules.forEach((complexityRule, index) => {
      complexityGrid.appendChild(field(
        complexityRule.label || complexityRule.complexity_level,
        `complexity_weight_${index}`,
        complexityRule.weight,
        { type: "number", required: true, min: 0.01, max: 10, step: 0.01, inputMode: "decimal" }
      ));
    });
    complexitySection.appendChild(complexityGrid);
    content.appendChild(complexitySection);
    content.appendChild(field("Ghi chú phiên bản", "note", rule.note || "", {
      type: "textarea",
      rows: 3,
      maxLength: 1000
    }));

    openDialog({
      id: "employee-scoring-rules-form",
      title: "Cấu hình cách tính điểm",
      description: "Tổng ba tỷ trọng phải bằng 100%; lịch sử đã chụp điểm không bị tính lại.",
      content,
      submitLabel: "Tạo phiên bản rule",
      pendingLabel: "Đang lưu rule...",
      onSubmit: async (formData) => {
        const productivityWeight = Number(formData.get("productivity_weight"));
        const qualityWeight = Number(formData.get("quality_weight"));
        const progressWeight = Number(formData.get("progress_weight"));
        if (Math.abs(productivityWeight + qualityWeight + progressWeight - 100) > 0.001) {
          throw new Error("Tổng tỷ trọng sản lượng, chất lượng và tiến độ phải bằng 100%.");
        }
        await window.AMApi.saveEmployeeScoringRules({
          versionCode: formData.get("version_code"),
          effectiveFrom: formData.get("effective_from"),
          productivityWeight,
          qualityWeight,
          progressWeight,
          scoreCap: formData.get("score_cap"),
          note: formData.get("note"),
          sizeRules: sizeRules.map((sizeRule, index) => ({
            band_key: sizeRule.band_key,
            label: sizeRule.label,
            min_inches: sizeRule.min_inches,
            max_inches: sizeRule.max_inches,
            weight: Number(formData.get(`size_weight_${index}`)),
            expected_hours: sizeRule.expected_hours,
            is_unknown_fallback: Boolean(sizeRule.is_unknown_fallback),
            is_active: sizeRule.is_active !== false
          })),
          complexityRules: complexityRules.map((complexityRule, index) => ({
            complexity_level: complexityRule.complexity_level,
            label: complexityRule.label,
            weight: Number(formData.get(`complexity_weight_${index}`)),
            expected_hours_multiplier: complexityRule.expected_hours_multiplier,
            is_active: complexityRule.is_active !== false
          }))
        });
        window.AMUI.toast("Đã tạo phiên bản cách tính mới.", { type: "success" });
        if (state.recognition) {
          await state.recognition.refresh();
        }
      }
    });
  }

  async function openTargetForm(employee) {
    if (!canManage() || !employee) {
      return;
    }
    const period = currentPeriod();
    let target = state.profileDetail && state.profileDetail.target;
    if (!target) {
      try {
        const result = await window.AMApi.getEmployeeKpiTargets({
          employeeId: employeeId(employee),
          page: 1,
          pageSize: 1
        });
        target = result.rows[0] || null;
      } catch (error) {
        target = null;
      }
    }
    const current = target || {};
    const content = element("div", "employee-form-grid");
    content.append(
      field("Từ ngày *", "period_start", current.period_start || period.start, { type: "date", required: true }),
      field("Đến ngày *", "period_end", current.period_end || period.end, { type: "date", required: true }),
      field("Mục tiêu hoàn thành *", "target_completed_tickets", current.target_completed_tickets || 1, {
        type: "number",
        required: true,
        inputMode: "numeric",
        min: 1,
        step: 1
      }),
      field("Mục tiêu điểm quy đổi *", "target_weighted_work_points", current.target_weighted_work_points, {
        type: "number",
        required: true,
        inputMode: "decimal",
        min: 0.01,
        step: 0.01,
        placeholder: "Ví dụ: 25"
      }),
      field("Mục tiêu tỷ lệ (%) *", "target_completion_rate", current.target_completion_rate || 100, {
        type: "number",
        required: true,
        inputMode: "decimal"
      }),
      field("Mục tiêu thời gian (giờ)", "target_average_hours", current.target_average_hours, {
        type: "number",
        inputMode: "decimal"
      }),
      field("Thưởng cơ bản", "bonus_base", current.bonus_base, { inputMode: "numeric" }),
      field("Thưởng mỗi tivi vượt mục tiêu", "bonus_per_ticket", current.bonus_per_ticket, { inputMode: "numeric" }),
      field("Thưởng tối đa", "maximum_bonus", current.maximum_bonus, { inputMode: "numeric" }),
      field("Ghi chú chính sách", "policy_note", current.policy_note, {
        type: "textarea",
        rows: 4,
        maxLength: 1000,
        className: "employee-form-field employee-form-field--wide"
      })
    );
    openDialog({
      id: "employee-target-form",
      title: `Mục tiêu của ${employee.full_name}`,
      description: "Thưởng hiển thị chỉ là dự kiến cho đến khi có quyết định riêng.",
      content,
      submitLabel: "Lưu mục tiêu",
      onSubmit: async (formData) => {
        const savedTarget = await window.AMApi.saveEmployeeKpiTarget({
          id: current.id || null,
          employee_id: employeeId(employee),
          period_type: "monthly",
          period_start: formData.get("period_start"),
          period_end: formData.get("period_end"),
          target_completed_tickets: formData.get("target_completed_tickets"),
          target_completion_rate: formData.get("target_completion_rate"),
          target_average_hours: formData.get("target_average_hours"),
          bonus_base: formData.get("bonus_base"),
          bonus_per_ticket: formData.get("bonus_per_ticket"),
          maximum_bonus: formData.get("maximum_bonus"),
          weight_completed: 60,
          weight_completion_rate: 40,
          weight_average_hours: 0,
          policy_note: formData.get("policy_note"),
          updated_at: current.updated_at || null
        });
        await window.AMApi.setEmployeeWeightedKpiTarget({
          targetId: savedTarget.target_id || current.id,
          weightedTarget: formData.get("target_weighted_work_points"),
          expectedUpdatedAt: savedTarget.updated_at
        });
        window.AMUI.toast("Đã lưu mục tiêu KPI.", { type: "success" });
        await selectEmployee(employee, { replace: true });
      }
    });
  }

  function openManagementNoteForm(employee) {
    if (!canManage() || !employee) {
      return;
    }
    const content = field("Nội dung ghi chú *", "note", "", {
      type: "textarea",
      rows: 6,
      required: true,
      maxLength: 1000
    });
    openDialog({
      id: "employee-note-form",
      title: `Ghi chú về ${employee.full_name}`,
      description: "Ghi chú được lưu thành lịch sử nội bộ và không ghi vào localStorage.",
      content,
      submitLabel: "Lưu ghi chú",
      onSubmit: async (formData) => {
        await window.AMApi.saveEmployeeManagementNote(
          employeeId(employee),
          formData.get("note")
        );
        window.AMUI.toast("Đã lưu ghi chú quản lý.", { type: "success" });
        await selectEmployee(employee, { replace: true });
      }
    });
  }

  async function openAssignTicketPicker(employee) {
    if (!canManage() || !employee) {
      return;
    }
    const result = await window.AMApi.getEmployeeAssignments({
      status: "unassigned",
      page: 1,
      pageSize: 100
    });
    const tickets = result.rows || [];
    if (tickets.length === 0) {
      window.AMUI.toast("Hiện không có tivi đang sửa chưa giao nhân viên.", { type: "info" });
      return;
    }
    const content = element("div", "employee-form-grid");
    content.append(
      field("Chọn phiếu *", "ticket_id", "", {
        type: "select",
        required: true,
        className: "employee-form-field employee-form-field--wide",
        options: [
          { value: "", label: "Chọn một phiếu đang sửa" },
          ...tickets.map((ticket) => ({
            value: ticket.ticket_id,
            label: `${formatTicketCode(ticket.ticket_code)} · ${[ticket.device_brand, ticket.device_model].filter(Boolean).join(" ") || "Chưa có model"}`
          }))
        ]
      }),
      field("Độ khó *", "complexity_level", "standard", {
        type: "select",
        required: true,
        options: COMPLEXITY_OPTIONS
      }),
      field("Kích thước xác nhận (inch)", "manual_size_inches", "", {
        type: "number",
        inputMode: "numeric",
        min: 20,
        max: 120,
        step: 1,
        placeholder: "Chỉ nhập khi cần xác nhận thủ công"
      }),
      field("Ghi chú phân công", "assignment_note", "", {
        type: "textarea",
        rows: 4,
        maxLength: 1000,
        className: "employee-form-field employee-form-field--wide"
      })
    );
    openDialog({
      id: "employee-assign-ticket",
      title: `Giao tivi cho ${employee.full_name}`,
      description: "Thời gian xử lý bắt đầu từ lúc RPC phân công thành công.",
      content,
      submitLabel: "Xác nhận giao việc",
      pendingLabel: "Đang giao việc...",
      onSubmit: async (formData) => {
        const complexityLevel = String(formData.get("complexity_level") || "standard");
        const manualSize = formData.get("manual_size_inches");
        if (complexityLevel !== "standard" || manualSize) {
          await window.AMApi.assignTicketToEmployeeClassified(
            formData.get("ticket_id"),
            employeeId(employee),
            formData.get("assignment_note"),
            {
              complexityLevel,
              manualSize,
              classificationNote: formData.get("assignment_note")
            }
          );
        } else {
          await window.AMApi.assignTicketToEmployee(
            formData.get("ticket_id"),
            employeeId(employee),
            formData.get("assignment_note")
          );
        }
        window.AMUI.toast("Đã giao tivi cho nhân viên.", { type: "success" });
        await selectEmployee(employee, { replace: true });
        state.teamLoaded = false;
      }
    });
  }

  async function openAwardForm() {
    if (!canFinalizeAward()) {
      return;
    }
    if (state.directory.length === 0) {
      window.AMUI.toast("Chưa có nhân viên để chốt vinh danh.", { type: "info" });
      return;
    }
    const period = currentPeriod();
    const content = element("div", "employee-form-grid");
    content.append(
      field("Nhân viên *", "employee_id", selectedEmployeeId(), {
        type: "select",
        required: true,
        options: state.directory.map((employee) => ({
          value: employeeId(employee),
          label: `${employee.full_name} · ${window.AMApi.formatCompactBusinessCode(employee.employee_code, "NV")}`
        }))
      }),
      field("Loại vinh danh *", "award_type", "monthly", {
        type: "select",
        options: [
          { value: "weekly", label: "Theo tuần" },
          { value: "monthly", label: "Theo tháng" },
          { value: "custom", label: "Thành tích khác" }
        ]
      }),
      field("Từ ngày *", "period_start", period.start, { type: "date", required: true }),
      field("Đến ngày *", "period_end", period.end, { type: "date", required: true }),
      field("Tiêu đề *", "title", "", { required: true, maxLength: 160 }),
      field("Mức thưởng", "award_amount", "", { inputMode: "numeric" }),
      field("Ghi chú", "note", "", {
        type: "textarea",
        rows: 4,
        maxLength: 1000,
        className: "employee-form-field employee-form-field--wide"
      })
    );
    openDialog({
      id: "employee-award-form",
      title: "Chốt vinh danh",
      description: "Hệ thống lưu snapshot số liệu tại thời điểm chốt.",
      content,
      submitLabel: "Chốt vinh danh",
      onSubmit: async (formData) => {
        await window.AMApi.finalizeEmployeeAward({
          employee_id: formData.get("employee_id"),
          award_type: formData.get("award_type"),
          period_start: formData.get("period_start"),
          period_end: formData.get("period_end"),
          title: formData.get("title"),
          award_amount: formData.get("award_amount"),
          note: formData.get("note")
        });
        window.AMUI.toast("Đã chốt vinh danh và lưu snapshot.", { type: "success" });
        state.awardsLoaded = false;
        await loadAwards();
      }
    });
  }

  async function assignUnassignedTicket(ticketId, trigger) {
    const result = await window.AMApi.getEmployeeAssignments({
      status: "unassigned",
      page: 1,
      pageSize: 100
    });
    const ticket = (result.rows || []).find((row) => row.ticket_id === ticketId);
    if (!ticket) {
      window.AMUI.toast("Phiếu không còn trong hàng chờ phân công.", { type: "info" });
      await loadTeamOverview();
      return;
    }
    await window.AMEmployeeAssignment.open({
      ticket: {
        id: ticket.ticket_id,
        ticket_code: ticket.ticket_code,
        brand: ticket.device_brand,
        model: ticket.device_model,
        condition_text: ticket.condition_text
      },
      trigger,
      onSuccess: async () => {
        state.teamLoaded = false;
        await Promise.all([
          loadTeamOverview(),
          loadDirectory({ loadProfile: false })
        ]);
      }
    });
  }

  async function reassignCurrentAssignment(assignmentId, trigger) {
    const assignment = [
      ...state.profileAssignments.active,
      ...state.profileAssignments.completed
    ].find((row) => row.assignment_id === assignmentId);
    if (!assignment || assignment.assignment_status !== "active") {
      window.AMUI.toast("Phân công này không còn hoạt động.", { type: "info" });
      return;
    }
    await window.AMEmployeeAssignment.open({
      ticket: {
        id: assignment.ticket_id,
        ticket_code: assignment.ticket_code,
        brand: assignment.device_brand,
        model: assignment.device_model,
        condition_text: assignment.condition_text
      },
      currentAssignment: assignment,
      trigger,
      onSuccess: async () => {
        await selectEmployee(state.selectedEmployee, { replace: true });
        await loadDirectory({ loadProfile: false });
      }
    });
  }

  function handleProfileAction(event) {
    const pageButton = event.target.closest("[data-employee-assignment-page]");
    if (pageButton && !pageButton.disabled) {
      loadProfileAssignmentPage(
        pageButton.dataset.employeeAssignmentType,
        pageButton.dataset.employeeAssignmentPage
      );
      return;
    }

    const periodButton = event.target.closest("[data-employee-work-period]");
    if (periodButton) {
      const key = periodButton.dataset.employeeWorkPeriod;
      if (key === "custom") {
        state.completedWorkPeriod = Object.assign(
          {},
          completedWorkRange(),
          { key: "custom", label: "Tùy chỉnh" }
        );
        renderSelectedProfile();
        return;
      }
      try {
        setCompletedWorkPeriod(key);
        state.profileAssignmentMeta.completed.page = 1;
        loadProfileAssignmentPage("completed", 1);
      } catch (error) {
        window.AMUI.toast(error.message || "Khoảng thời gian không hợp lệ.", { type: "error" });
      }
      return;
    }

    const applyPeriodButton = event.target.closest("[data-employee-work-period-apply]");
    if (applyPeriodButton) {
      const startInput = refs.employeeProfileContent.querySelector("[data-employee-work-start]");
      const endInput = refs.employeeProfileContent.querySelector("[data-employee-work-end]");
      try {
        setCompletedWorkPeriod(
          "custom",
          startInput ? startInput.value : "",
          endInput ? endInput.value : ""
        );
        state.profileAssignmentMeta.completed.page = 1;
        loadProfileAssignmentPage("completed", 1);
      } catch (error) {
        window.AMUI.toast(error.message || "Khoảng thời gian không hợp lệ.", { type: "error" });
      }
      return;
    }

    const profileViewButton = event.target.closest("[data-employee-profile-view]");
    if (profileViewButton) {
      state.profileView = VALID_PROFILE_VIEWS.has(profileViewButton.dataset.employeeProfileView)
        ? profileViewButton.dataset.employeeProfileView
        : "performance";
      writeUrl({ replace: false });
      renderSelectedProfile();
      return;
    }
    const action = event.target.closest("[data-employee-action]");
    if (!action) {
      return;
    }
    const employee = state.selectedEmployee;
    switch (action.dataset.employeeAction) {
      case "create-employee":
        openEmployeeForm(null);
        break;
      case "edit-employee":
        openEmployeeForm(employee);
        break;
      case "assign-ticket":
        openAssignTicketPicker(employee).catch((error) => {
          window.AMUI.toast(error.message || "Không mở được giao diện phân công.", { type: "error" });
        });
        break;
      case "edit-target":
        openTargetForm(employee);
        break;
      case "add-management-note":
        openManagementNoteForm(employee);
        break;
      case "retry-profile":
        selectEmployee(employee, { replace: true });
        break;
      case "retry-performance":
        loadProfileKpi();
        break;
      case "retry-target":
        loadProfileTarget();
        break;
      case "retry-assignment":
        loadProfileAssignmentPage(
          action.dataset.employeeAssignmentType,
          state.profileAssignmentMeta[action.dataset.employeeAssignmentType].page
        );
        break;
      case "reassign":
        reassignCurrentAssignment(action.dataset.assignmentId, action).catch((error) => {
          window.AMUI.toast(error.message || "Không đổi được nhân viên.", { type: "error" });
        });
        break;
      default:
        break;
    }
  }

  function rankingEmployeeById(id) {
    const targetId = String(id || "");
    return [
      ...state.rankingRows.team,
      ...state.rankingRows.awards,
      ...state.directory
    ].find((employee) => employeeId(employee) === targetId) || null;
  }

  function openRankingEmployee(id) {
    const employee = rankingEmployeeById(id);
    if (!employee) {
      window.AMUI.toast("Không tìm thấy hồ sơ nhân viên này.", { type: "error" });
      return;
    }
    selectEmployee(employee).catch((error) => {
      window.AMUI.toast(error.message || "Không mở được hồ sơ nhân viên.", { type: "error" });
    });
  }

  function handleRankingClick(event) {
    const retry = event.target.closest("[data-employee-ranking-retry]");
    if (retry) {
      loadRanking(retry.dataset.employeeRankingRetry).catch(() => {});
      return;
    }
    const target = event.target.closest("[data-employee-ranking-id]");
    if (target) {
      openRankingEmployee(target.dataset.employeeRankingId);
    }
  }

  function handleRankingKeydown(event) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    const row = event.target.closest("tr[data-employee-ranking-id]");
    if (!row || event.target !== row) {
      return;
    }
    event.preventDefault();
    openRankingEmployee(row.dataset.employeeRankingId);
  }

  function attachLogout() {
    document.querySelectorAll("[data-logout]").forEach((button) => {
      if (button.dataset.employeeLogoutBound === "true") {
        return;
      }
      button.dataset.employeeLogoutBound = "true";
      button.addEventListener("click", async () => {
        if (button.disabled) {
          return;
        }
        button.disabled = true;
        button.textContent = "Đang đăng xuất...";
        try {
          await window.AMApi.signOut();
          window.location.replace("login.html");
        } catch (error) {
          button.disabled = false;
          button.textContent = "Đăng xuất";
          window.AMUI.toast(error.message || "Không thể đăng xuất.", { type: "error" });
        }
      });
    });
  }

  function attachEvents() {
    state.directoryController = window.AMEmployeeSidebar.create({
      root: refs.employeeDirectory,
      list: refs.employeeDirectoryList,
      count: refs.employeeDirectoryCount,
      toggle: refs.employeeDirectoryToggle,
      closeButton: refs.employeeDirectoryClose,
      backdrop: refs.employeeDirectoryBackdrop,
      mobileSummary: refs.employeeMobileSummary,
      onSelect: (employee) => selectEmployee(employee)
    });

    document.querySelectorAll("[data-employee-view]").forEach((button) => {
      button.addEventListener("click", () => setWorkspaceView(button.dataset.employeeView));
    });
    document.querySelectorAll("[data-period-key]").forEach((button) => {
      button.addEventListener("click", async () => {
        const key = button.dataset.periodKey;
        selectPeriod(key, refs.employeePeriodStart.value, refs.employeePeriodEnd.value);
        if (key !== "custom") {
          state.teamLoaded = false;
          state.awardsLoaded = false;
          await loadTeamOverview();
          await loadDirectory({ loadProfile: state.view === "profile", replace: true });
        }
      });
    });
    refs.employeeApplyPeriod.addEventListener("click", async () => {
      try {
        selectPeriod("custom", refs.employeePeriodStart.value, refs.employeePeriodEnd.value);
        state.teamLoaded = false;
        state.awardsLoaded = false;
        await loadTeamOverview();
        await loadDirectory({ loadProfile: state.view === "profile", replace: true });
      } catch (error) {
        window.AMUI.toast(error.message || "Khoảng ngày không hợp lệ.", { type: "error" });
      }
    });

    refs.employeeDirectorySearch.addEventListener("input", () => {
      window.clearTimeout(state.searchTimer);
      state.searchTimer = window.setTimeout(() => {
        loadDirectory({ loadProfile: false });
      }, SEARCH_DELAY_MS);
    });
    refs.employeeDirectoryStatus.addEventListener("change", () => {
      loadDirectory({ loadProfile: false });
    });
    refs.employeeCreateButton.addEventListener("click", () => openEmployeeForm(null));
    refs.employeeAwardCreateButton.addEventListener("click", openAwardForm);
    refs.employeeScoringRulesButton.addEventListener("click", () => {
      openScoringRulesForm().catch((error) => {
        window.AMUI.toast(error.message || "Không mở được cấu hình tính điểm.", { type: "error" });
      });
    });
    refs.employeeRefreshButton.addEventListener("click", async () => {
      refs.employeeRefreshButton.disabled = true;
      try {
        state.teamLoaded = false;
        state.awardsLoaded = false;
        await loadDirectory({ loadProfile: state.view === "profile", replace: true });
        if (state.view === "team") {
          await loadTeamOverview();
        } else if (state.view === "awards") {
          await loadAwards();
        }
      } finally {
        refs.employeeRefreshButton.disabled = false;
      }
    });
    refs.employeeProfileContent.addEventListener("click", handleProfileAction);
    refs.employeeProfileContent.addEventListener("toggle", (event) => {
      const analysis = event.target.closest(".employee-performance-analysis");
      if (!analysis || !analysis.open) {
        return;
      }
      window.requestAnimationFrame(renderProfileCharts);
    }, true);
    [refs.employeeTopList, refs.employeeAwardTopList].filter(Boolean).forEach((container) => {
      container.addEventListener("click", handleRankingClick);
      container.addEventListener("keydown", handleRankingKeydown);
    });
    refs.employeeUnassignedList.addEventListener("click", (event) => {
      const action = event.target.closest("[data-employee-action='assign-unassigned']");
      if (!action) {
        return;
      }
      assignUnassignedTicket(action.dataset.ticketId, action).catch((error) => {
        window.AMUI.toast(error.message || "Không mở được giao diện phân công.", { type: "error" });
      });
    });
    window.addEventListener("popstate", async () => {
      const requested = currentUrlState();
      state.profileView = requested.profileView;
      if (requested.employee) {
        const employee = state.directory.find((row) => employeeId(row) === requested.employee);
        if (employee) {
          await selectEmployee(employee, { fromPopState: true });
          return;
        }
      }
      await setWorkspaceView(requested.view, { fromPopState: true });
    });
  }

  async function init() {
    cacheElements();
    selectPeriod("this-month");
    attachEvents();
    attachLogout();
    window.AMEmployeeProfile.renderLoading(refs.employeeProfileContent);

    try {
      state.access = await window.AMApi.getEmployeeModuleAccess();
      updatePermissionUi();

      if (state.access && state.access.role_bootstrap_required) {
        setNotice("warning", "Quyền Owner/Admin chưa được cấu hình; module đang ở chế độ chỉ đọc.");
      }

      const requested = currentUrlState();
      state.profileView = requested.profileView;
      await loadDirectory({
        requestedEmployeeId: requested.employee,
        replace: true,
        loadProfile: requested.view === "profile"
      });
      await setWorkspaceView(requested.view, {
        fromPopState: true,
        replace: true
      });
      if (requested.view === "profile" && state.selectedEmployee && !state.profileDetail) {
        await selectEmployee(state.selectedEmployee, { replace: true });
      }
    } catch (error) {
      if (error.employeeModuleUnavailable) {
        state.access = {
          can_manage: false,
          can_finalize_award: false,
          role_bootstrap_required: false
        };
        updatePermissionUi();
        setNotice("info", "Module Nhân viên chưa được kích hoạt trên backend.");
        state.directoryController.render([], "", { activeCount: 0 });
        window.AMEmployeeProfile.renderEmpty(refs.employeeProfileContent, false, false);
        return;
      }
      setNotice("error", "Không thể tải dữ liệu Nhân viên. Vui lòng thử lại.");
      state.directoryController.render([], "", { activeCount: 0 });
      window.AMEmployeeProfile.renderError(
        refs.employeeProfileContent,
        "Không thể tải hồ sơ Nhân viên."
      );
    }
  }

  function startEmployeeModule() {
    if (!employeeModuleStartPromise) {
      employeeModuleStartPromise = init();
    }
    return employeeModuleStartPromise;
  }

  async function handleEmployeeAccessChange(detail) {
    if (!detail || detail.unlocked !== true) {
      concealEmployeeModule();
      return;
    }

    revealEmployeeModule();
    await startEmployeeModule();
  }

  async function bootstrapEmployeeModule() {
    concealEmployeeModule("Đang kiểm tra phiên đăng nhập...");

    try {
      const access = await window.AMApi.requireInternalAccess();
      if (!access) {
        return;
      }
      if (
        !window.AMEmployeeAccess
        || typeof window.AMEmployeeAccess.requireRouteUnlock !== "function"
      ) {
        throw new Error("Employee access guard is unavailable.");
      }

      employeeAccessUnsubscribe = window.AMEmployeeAccess.subscribe((detail) => {
        handleEmployeeAccessChange(detail).catch(() => {
          concealEmployeeModule("Không thể mở module Nhân viên lúc này.");
        });
      });

      const unlocked = await window.AMEmployeeAccess.requireRouteUnlock();
      if (unlocked) {
        await handleEmployeeAccessChange({ unlocked: true, reason: "route" });
      }
    } catch (error) {
      concealEmployeeModule("Không thể xác thực quyền truy cập lúc này.");
    }
  }

  document.addEventListener("DOMContentLoaded", bootstrapEmployeeModule);
})();

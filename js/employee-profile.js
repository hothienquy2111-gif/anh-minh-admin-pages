(function () {
  "use strict";

  const PROFILE_PAGE_SIZE = 10;

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

  function kpi() {
    return window.AMEmployeeKpi;
  }

  function formatCode(value) {
    if (window.AMApi && typeof window.AMApi.formatCompactBusinessCode === "function") {
      return window.AMApi.formatCompactBusinessCode(value, "NV");
    }
    return String(value || "—");
  }

  function ticketCode(value) {
    if (window.AMApi && typeof window.AMApi.formatTicketCode === "function") {
      return window.AMApi.formatTicketCode(value);
    }
    return String(value || "—");
  }

  function statusLabel(value) {
    const key = String(value || "").toLowerCase();
    const labels = {
      active: "Đang thực hiện",
      completed: "Đã hoàn thành",
      reassigned: "Đã chuyển người",
      cancelled: "Đã hủy",
      "đang sửa": "Đang sửa",
      "chờ bàn giao": "Bàn giao tivi",
      "đã trả": "Đã bàn giao"
    };
    return labels[key] || value || "Chưa xác định";
  }

  function statusTone(value) {
    const key = String(value || "").toLowerCase();
    if (key === "active" || key === "đang sửa") {
      return "blue";
    }
    if (key === "completed" || key === "chờ bàn giao" || key === "đã trả") {
      return "green";
    }
    if (key === "reassigned") {
      return "amber";
    }
    if (key === "cancelled") {
      return "gray";
    }
    return "gray";
  }

  function badge(value) {
    return element(
      "span",
      `employee-status-badge employee-status-badge--${statusTone(value)}`,
      statusLabel(value)
    );
  }

  function avatar(employee, className) {
    const node = element(
      "span",
      className || "employee-profile-avatar",
      kpi().getInitials(employee.full_name)
    );
    node.setAttribute("aria-hidden", "true");
    return node;
  }

  function actionButton(label, action, options) {
    const settings = options || {};
    const button = element("button", settings.className || "btn secondary compact", label);
    button.type = "button";
    button.dataset.employeeAction = action;
    if (settings.assignmentId) {
      button.dataset.assignmentId = settings.assignmentId;
    }
    if (settings.employeeId) {
      button.dataset.employeeId = settings.employeeId;
    }
    if (settings.assignmentType) {
      button.dataset.employeeAssignmentType = settings.assignmentType;
    }
    return button;
  }

  function detailItem(label, value) {
    const item = element("div", "employee-profile-detail");
    item.append(
      element("span", "", label),
      element("strong", "", value || "—")
    );
    return item;
  }

  function profileStatus(status) {
    const value = String(status || "").toLowerCase();
    const labels = {
      active: "Đang hoạt động",
      inactive: "Ngừng hoạt động",
      suspended: "Tạm khóa"
    };
    return element(
      "span",
      `employee-profile-status employee-profile-status--${value || "unknown"}`,
      labels[value] || "Chưa xác định"
    );
  }

  function numeric(value, fallback) {
    if (value === null || value === undefined || value === "") {
      return fallback === undefined ? null : fallback;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : (fallback === undefined ? null : fallback);
  }

  function infoButton(label, description) {
    const info = element("button", "employee-info-button employee-performance-info", "i");
    info.type = "button";
    info.dataset.tooltip = description;
    info.setAttribute("aria-label", `Giải thích ${label}`);
    return info;
  }

  function performanceState(title, description, action) {
    const state = element("div", "employee-performance-state");
    state.setAttribute("role", action ? "alert" : "status");
    state.append(
      element("strong", "", title),
      element("p", "", description)
    );
    if (action) {
      state.appendChild(actionButton("Thử lại", action, {
        className: "btn secondary compact"
      }));
    }
    return state;
  }

  function performanceHasData(detail) {
    return [
      detail.assigned_in_period,
      detail.completed_in_period,
      detail.active_assignments,
      detail.completed_today,
      detail.completed_this_week,
      detail.completed_this_month
    ].some((value) => numeric(value, 0) > 0);
  }

  function metricCard(label, value, unit) {
    const card = element("article", "employee-performance-kpi");
    const reading = element("div", "employee-performance-kpi__reading");
    reading.append(
      element("strong", "", value),
      element("span", "", unit)
    );
    card.append(
      element("h3", "", label),
      reading
    );
    return card;
  }

  function metricGrid(detail) {
    const region = element("section", "employee-performance-primary");
    region.setAttribute("aria-label", "Kết quả hiệu suất chính");

    if (detail.performance_state === "loading") {
      region.classList.add("is-loading");
      for (let index = 0; index < 4; index += 1) {
        region.appendChild(element("div", "employee-performance-kpi employee-performance-skeleton"));
      }
      return region;
    }

    if (detail.performance_state === "error") {
      region.classList.add("is-state");
      region.appendChild(performanceState(
        "Không thể tải số liệu hiệu suất.",
        "Vui lòng thử lại để cập nhật các chỉ số chính.",
        "retry-performance"
      ));
      return region;
    }

    if (!performanceHasData(detail)) {
      region.classList.add("is-state");
      region.appendChild(performanceState(
        "Chưa có dữ liệu hiệu suất",
        "Dữ liệu sẽ xuất hiện khi nhân viên bắt đầu được phân công."
      ));
      return region;
    }

    region.append(
      metricCard("Hoàn thành hôm nay", kpi().formatNumber(detail.completed_today), "tivi"),
      metricCard("Hoàn thành tuần này", kpi().formatNumber(detail.completed_this_week), "tivi"),
      metricCard("Hoàn thành tháng này", kpi().formatNumber(detail.completed_this_month), "tivi"),
      metricCard("Tivi đang sửa", kpi().formatNumber(detail.active_assignments), "tivi")
    );
    return region;
  }

  function efficiencyMetric(label, value, description) {
    const item = element("div", "employee-efficiency-metric");
    const heading = element("div", "employee-efficiency-metric__heading");
    heading.append(
      element("span", "", label),
      infoButton(label, description)
    );
    item.append(
      element("strong", value === "Chưa có dữ liệu" ? "is-empty" : "", value),
      heading
    );
    return item;
  }

  function efficiencyCard(detail) {
    const card = element("section", "employee-efficiency-card");
    card.appendChild(element("h3", "", "Hiệu quả xử lý"));

    if (detail.performance_state === "loading") {
      card.classList.add("is-loading");
      card.append(
        element("div", "employee-efficiency-metric employee-performance-skeleton"),
        element("div", "employee-efficiency-metric employee-performance-skeleton")
      );
      return card;
    }

    if (detail.performance_state === "error") {
      card.classList.add("is-state");
      card.appendChild(performanceState(
        "Không thể tải số liệu hiệu suất.",
        "Tỷ lệ hoàn thành và thời gian sửa chưa thể cập nhật.",
        "retry-performance"
      ));
      return card;
    }

    const assigned = numeric(detail.assigned_in_period, 0);
    const completed = numeric(detail.completed_in_period, 0);
    const averageHours = numeric(detail.average_repair_hours);
    const metrics = element("div", "employee-efficiency-card__metrics");
    metrics.append(
      efficiencyMetric(
        "Tỷ lệ hoàn thành",
        assigned > 0 ? kpi().formatPercent(detail.completion_rate) : "Chưa có dữ liệu",
        "Số tivi hoàn thành chia cho tổng số tivi được giao trong kỳ."
      ),
      efficiencyMetric(
        "Thời gian sửa trung bình",
        completed > 0 && averageHours !== null ? kpi().formatHours(averageHours) : "Chưa có dữ liệu",
        "Thời gian trung bình từ lúc nhận phân công đến khi xác nhận sửa xong."
      )
    );
    card.appendChild(metrics);
    if (completed === 1) {
      card.appendChild(element("p", "employee-efficiency-card__sample", "Dựa trên 1 tivi hoàn thành."));
    }
    return card;
  }

  function monthElapsedRatio() {
    const today = kpi().dateOnly(kpi().todayIso());
    if (!today) {
      return 0;
    }
    const daysInMonth = new Date(Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth() + 1,
      0
    )).getUTCDate();
    return Math.min(today.getUTCDate() / daysInMonth, 1);
  }

  function targetMeasure(detail, target) {
    const weightedCurrent = numeric(detail.weighted_work_points);
    const weightedTarget = numeric(target && target.target_weighted_work_points);
    if (weightedCurrent !== null && weightedTarget !== null && weightedTarget > 0) {
      return {
        current: weightedCurrent,
        target: weightedTarget,
        unit: "điểm quy đổi",
        format: kpi().formatWorkPoints
      };
    }
    return {
      current: numeric(detail.completed_this_month, 0),
      target: numeric(target && target.target_completed_tickets, 0),
      unit: "tivi",
      format: kpi().formatNumber
    };
  }

  function performanceAlerts(detail, target, measure) {
    const alerts = [];
    const progressRatio = measure.target > 0 ? measure.current / measure.target : 0;
    if (monthElapsedRatio() - progressRatio >= 0.15) {
      alerts.push({
        title: "Tiến độ đang thấp hơn nhịp mục tiêu",
        text: "Kết quả hiện tại thấp hơn tỷ lệ thời gian đã trôi qua trong tháng."
      });
    }
    const targetHours = numeric(target.target_average_hours);
    const averageHours = numeric(detail.average_repair_hours);
    if (targetHours !== null && targetHours > 0 && averageHours !== null && averageHours > targetHours) {
      alerts.push({
        title: "Thời gian sửa trung bình vượt mục tiêu",
        text: `Hiện tại ${kpi().formatHours(averageHours)}, mục tiêu ${kpi().formatHours(targetHours)}.`
      });
    }

    const daily = Array.isArray(detail.daily_series) ? detail.daily_series : [];
    let daysWithoutCompletion = 0;
    for (let index = daily.length - 1; index >= 0; index -= 1) {
      if (Number(daily[index].completed) > 0) {
        break;
      }
      daysWithoutCompletion += 1;
    }
    if (daysWithoutCompletion >= 3 && numeric(detail.active_assignments, 0) > 0) {
      alerts.push({
        title: `${daysWithoutCompletion} ngày chưa ghi nhận tivi hoàn thành`,
        text: "Nên kiểm tra tiến độ các việc đang thực hiện."
      });
    }
    return alerts;
  }

  function targetProgress(detail) {
    const section = element("section", "employee-target-panel");
    const header = element("div", "employee-target-panel__header");
    header.appendChild(element("h3", "", "Mục tiêu tháng"));
    section.appendChild(header);

    if (detail.target_state === "loading") {
      section.classList.add("is-loading");
      section.append(
        element("div", "employee-target-panel__skeleton employee-performance-skeleton"),
        element("div", "employee-target-panel__skeleton employee-performance-skeleton")
      );
      return section;
    }

    if (detail.target_state === "error") {
      section.classList.add("is-state");
      section.appendChild(performanceState(
        "Không thể tải mục tiêu tháng.",
        "Các chỉ số hiệu suất khác vẫn được giữ nguyên.",
        "retry-target"
      ));
      return section;
    }

    const target = detail.target || null;
    const measure = targetMeasure(detail, target);
    if (!target || measure.target <= 0) {
      section.classList.add("is-empty");
      section.append(
        element("strong", "employee-target-panel__empty-title", "Chưa thiết lập mục tiêu tháng"),
        element("p", "", "Thiết lập mục tiêu để theo dõi tiến độ và thưởng dự kiến.")
      );
      if (detail.can_manage) {
        section.appendChild(actionButton("Thiết lập mục tiêu", "edit-target", {
          className: "btn secondary compact",
          employeeId: detail.employee_id
        }));
      }
      return section;
    }

    const percent = Math.max(measure.current / measure.target * 100, 0);
    const fillPercent = Math.min(percent, 100);
    const remaining = Math.max(measure.target - measure.current, 0);
    const alerts = performanceAlerts(detail, target, measure);
    let status = "Đang tiến triển";
    let statusTone = "progress";
    if (percent >= 100) {
      status = "Đã đạt";
      statusTone = "complete";
    } else if (alerts.length > 0) {
      status = "Có nguy cơ không đạt";
      statusTone = "warning";
    }
    header.appendChild(element(
      "span",
      `employee-target-status employee-target-status--${statusTone}`,
      status
    ));

    const summary = element("div", "employee-target-panel__summary");
    const reading = element("div", "employee-target-panel__reading");
    reading.append(
      element("strong", "", `${measure.format(measure.current)} / ${measure.format(measure.target)}`),
      element("span", "", measure.unit)
    );
    summary.append(
      reading,
      element("strong", "employee-target-panel__percent", `Đạt ${kpi().formatPercent(percent)}`)
    );

    const track = element("div", "employee-goal-progress");
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    track.setAttribute("aria-valuenow", String(Math.round(fillPercent)));
    track.setAttribute(
      "aria-valuetext",
      `${measure.format(measure.current)} trên ${measure.format(measure.target)} ${measure.unit}, đạt ${kpi().formatPercent(percent)}`
    );
    const bar = element("span", "employee-goal-progress__value");
    bar.style.width = `${fillPercent}%`;
    track.appendChild(bar);

    const remainingText = remaining > 0
      ? `Còn ${measure.format(remaining)} ${measure.unit} để hoàn thành mục tiêu.`
      : (measure.current > measure.target
        ? `Đã vượt mục tiêu ${measure.format(measure.current - measure.target)} ${measure.unit}.`
        : "Đã hoàn thành mục tiêu tháng.");
    const footer = element("div", "employee-target-panel__footer");
    footer.appendChild(element("p", "employee-target-panel__remaining", remainingText));

    const bonusConfigured = [target.bonus_base, target.bonus_per_ticket, target.maximum_bonus]
      .some((value) => numeric(value) !== null);
    const bonus = element("div", "employee-target-panel__bonus");
    const bonusHeading = element("div", "employee-target-panel__bonus-heading");
    bonusHeading.append(
      element("span", "", "Thưởng dự kiến"),
      infoButton(
        "Thưởng dự kiến",
        "Giá trị xem trước theo chính sách đã cấu hình, chưa phải khoản thưởng đã chốt."
      )
    );
    bonus.appendChild(bonusHeading);
    bonus.appendChild(element(
      "strong",
      bonusConfigured ? "" : "is-empty",
      bonusConfigured
        ? kpi().formatMoney(numeric(detail.bonus_preview, 0))
        : "Chưa cấu hình chính sách thưởng"
    ));
    footer.appendChild(bonus);

    section.append(summary, track, footer);
    if (alerts.length === 0) {
      section.appendChild(element("p", "employee-target-panel__no-alert", "Không có tín hiệu cần chú ý."));
    } else {
      const alertSection = element("div", "employee-target-alerts");
      alertSection.appendChild(element("h4", "", "Cần chú ý"));
      const list = element("div", "employee-target-alerts__list");
      alerts.forEach((alert) => {
        const item = element("div", "employee-target-alert");
        item.append(
          element("strong", "", alert.title),
          element("p", "", alert.text)
        );
        list.appendChild(item);
      });
      alertSection.appendChild(list);
      section.appendChild(alertSection);
    }

    if (detail.can_manage) {
      section.appendChild(actionButton("Điều chỉnh mục tiêu", "edit-target", {
        className: "btn ghost compact",
        employeeId: detail.employee_id
      }));
    }
    return section;
  }

  function chartCard(id, title, description, className) {
    const card = element("article", `employee-profile-chart-card${className ? ` ${className}` : ""}`);
    const header = element("header", "employee-profile-chart-card__header");
    const copy = element("div");
    copy.append(element("h3", "", title), element("p", "", description));
    header.appendChild(copy);
    const chart = element("div", "employee-chart-surface");
    chart.id = id;
    chart.setAttribute("role", "img");
    chart.setAttribute("aria-label", title);
    const fallback = element("p", "employee-chart-fallback", "Chưa có dữ liệu phù hợp.");
    fallback.id = `${id}Fallback`;
    fallback.hidden = true;
    card.append(header, chart, fallback);
    return card;
  }

  function hasChartData(detail) {
    const rows = []
      .concat(Array.isArray(detail.daily_series) ? detail.daily_series : [])
      .concat(Array.isArray(detail.weekly_series) ? detail.weekly_series : [])
      .concat(Array.isArray(detail.work_distribution) ? detail.work_distribution : []);
    return rows.some((row) => [
      row && row.completed,
      row && row.assigned,
      row && row.average_hours,
      row && row.value
    ].some((value) => numeric(value, 0) > 0));
  }

  function performanceAnalysis(detail) {
    if (detail.performance_state !== "ready" || !hasChartData(detail)) {
      return null;
    }
    const disclosure = element("details", "employee-performance-analysis");
    const summary = document.createElement("summary");
    const copy = element("span", "employee-performance-analysis__copy");
    copy.append(
      element("strong", "", "Phân tích chi tiết"),
      element("small", "", "Mở 4 biểu đồ xu hướng và phân bổ công việc")
    );
    summary.appendChild(copy);
    const charts = element("section", "employee-profile-chart-grid");
    charts.append(
      chartCard("employeePersonalWeeklyChart", "Hiệu suất trong tuần", "So sánh số tivi hoàn thành tuần này và tuần trước."),
      chartCard("employeePersonalEightWeekChart", "Xu hướng 8 tuần", "Khối lượng được giao và hoàn thành theo từng tuần."),
      chartCard("employeePersonalHoursChart", "Thời gian sửa trung bình", "Số giờ xử lý trung bình theo tuần; chỉ tính phiếu đã hoàn thành."),
      chartCard("employeePersonalDistributionChart", "Phân bổ công việc", "Trạng thái các assignment của nhân viên ở thời điểm hiện tại.")
    );
    disclosure.append(summary, charts);
    return disclosure;
  }

  function profileHeader(detail) {
    const header = element("section", "employee-profile-header");
    const identity = element("div", "employee-profile-identity");
    identity.appendChild(avatar(detail));
    const copy = element("div");
    const top = element("div", "employee-profile-identity__top");
    top.append(element("h2", "", detail.full_name || "Nhân viên"), profileStatus(detail.employment_status));
    copy.append(
      top,
      element(
        "p",
        "",
        `${formatCode(detail.employee_code)} · ${detail.job_title || "Chưa có chức danh"}${detail.department ? ` · ${detail.department}` : ""}`
      )
    );
    identity.appendChild(copy);

    const actions = element("div", "employee-profile-actions");
    if (detail.can_manage) {
      actions.append(
        actionButton("Giao tivi", "assign-ticket", { className: "btn primary" }),
        actionButton("Chỉnh sửa hồ sơ", "edit-employee", { className: "btn secondary" })
      );
      const more = element("details", "employee-profile-more");
      const summary = element("summary", "btn ghost", "Tùy chọn");
      summary.setAttribute("aria-label", "Mở hành động khác của nhân viên");
      const menu = element("div", "employee-profile-more__menu");
      menu.setAttribute("role", "menu");
      menu.append(
        actionButton("Cập nhật mục tiêu KPI", "edit-target", {
          className: "employee-profile-more__item"
        }),
        actionButton("Thêm ghi chú quản lý", "add-management-note", {
          className: "employee-profile-more__item"
        })
      );
      more.append(summary, menu);
      actions.appendChild(more);
    }

    const details = element("div", "employee-profile-details");
    details.append(
      detailItem("Điện thoại", detail.phone || "Chưa cập nhật"),
      detailItem("Email", detail.email || "Chưa cập nhật"),
      detailItem("Ngày vào làm", kpi().formatDate(detail.joined_date)),
      detailItem("Quyền KPI", detail.is_kpi_eligible === false ? "Không tính KPI" : "Có tính KPI")
    );
    header.append(identity, actions, details);
    return header;
  }

  function profileNavigation(activeView) {
    const nav = element("nav", "employee-profile-nav");
    nav.setAttribute("aria-label", "Nội dung hồ sơ nhân viên");
    [
      ["performance", "Hiệu suất"],
      ["work", "Công việc"],
      ["history", "Lịch sử & ghi chú"]
    ].forEach(([key, label]) => {
      const button = element("button", "employee-profile-nav__button", label);
      button.type = "button";
      button.dataset.employeeProfileView = key;
      const active = key === activeView;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
      nav.appendChild(button);
    });
    return nav;
  }

  function renderPerformance(detail) {
    const panel = element("div", "employee-profile-panel employee-performance-workspace");
    panel.dataset.employeeProfilePanel = "performance";
    panel.appendChild(metricGrid(detail));
    const secondary = element("div", "employee-performance-secondary");
    if (detail.performance_state === "error") {
      secondary.classList.add("is-target-only");
      secondary.appendChild(targetProgress(detail));
    } else {
      secondary.append(efficiencyCard(detail), targetProgress(detail));
    }
    panel.appendChild(secondary);
    const analysis = performanceAnalysis(detail);
    if (analysis) {
      panel.appendChild(analysis);
    }
    return panel;
  }

  function tableState(message, state) {
    const node = element("div", `employee-inline-state employee-inline-state--${state || "empty"}`, message);
    node.setAttribute("role", state === "error" ? "alert" : "status");
    return node;
  }

  function assignmentTable(rows, type) {
    const data = Array.isArray(rows) ? rows : [];
    if (data.length === 0) {
      return tableState(
        type === "active"
          ? "Hiện không có tivi đang thực hiện."
          : "Chưa có tivi hoàn thành trong phạm vi đang xem.",
        "empty"
      );
    }

    const wrap = element("div", "employee-profile-table-wrap");
    const table = element("table", "employee-profile-table");
    const head = document.createElement("thead");
    const headerRow = document.createElement("tr");
    [
      "Mã phiếu",
      "Thiết bị",
      "Tình trạng",
      type === "active" ? "Thời điểm giao" : "Hoàn thành",
      "Thời gian xử lý",
      "Trạng thái",
      "Hành động"
    ].forEach((label) => headerRow.appendChild(element("th", "", label)));
    head.appendChild(headerRow);
    const body = document.createElement("tbody");
    const mobileList = element("div", "employee-profile-card-list");

    data.forEach((row) => {
      const tr = document.createElement("tr");
      tr.dataset.assignmentId = row.assignment_id || "";
      const codeCell = document.createElement("td");
      codeCell.appendChild(element("strong", "employee-ticket-code", ticketCode(row.ticket_code)));
      const deviceCell = document.createElement("td");
      deviceCell.append(
        element(
          "strong",
          "",
          [row.device_brand || row.brand, row.device_model || row.model]
            .filter(Boolean)
            .join(" · ") || "Chưa có model"
        ),
        element("span", "employee-table-subtext", row.device_type || "Tivi")
      );
      const conditionCell = element("td", "employee-profile-table__condition", row.condition_text || "Chưa cập nhật");
      const dateValue = type === "active" ? row.assigned_at : row.completed_at;
      const dateCell = element("td", "", kpi().formatDateTime(dateValue));
      const hours = row.processing_hours !== undefined && row.processing_hours !== null
        ? row.processing_hours
        : ((new Date(row.completed_at || Date.now()) - new Date(row.assigned_at)) / 3600000);
      const durationCell = element("td", "", kpi().formatHours(hours));
      const statusCell = document.createElement("td");
      statusCell.appendChild(badge(row.assignment_status || row.ticket_status));
      const actionCell = element("td", "employee-profile-table__actions");
      const view = element("a", "btn ghost compact", "Xem phiếu");
      view.href = `search.html?code=${encodeURIComponent(row.ticket_code || "")}`;
      actionCell.appendChild(view);
      if (type === "active" && row.assignment_id) {
        actionCell.appendChild(actionButton("Đổi người", "reassign", {
          className: "btn secondary compact",
          assignmentId: row.assignment_id
        }));
      }
      tr.append(codeCell, deviceCell, conditionCell, dateCell, durationCell, statusCell, actionCell);
      body.appendChild(tr);

      const card = element("article", "employee-profile-work-card");
      const cardHeader = element("header", "employee-profile-work-card__header");
      cardHeader.append(
        element("strong", "employee-ticket-code", ticketCode(row.ticket_code)),
        badge(row.assignment_status || row.ticket_status)
      );
      const cardDevice = element(
        "p",
        "employee-profile-work-card__device",
        [row.device_brand || row.brand, row.device_model || row.model]
          .filter(Boolean)
          .join(" · ") || "Chưa có model"
      );
      const cardCondition = element(
        "p",
        "employee-profile-work-card__condition",
        row.condition_text || "Chưa cập nhật tình trạng"
      );
      const cardMeta = element("dl", "employee-profile-work-card__meta");
      [
        [type === "active" ? "Được giao" : "Hoàn thành", kpi().formatDateTime(dateValue)],
        ["Thời gian xử lý", kpi().formatHours(hours)]
      ].forEach(([label, value]) => {
        const item = element("div");
        item.append(element("dt", "", label), element("dd", "", value));
        cardMeta.appendChild(item);
      });
      const cardActions = element("footer", "employee-profile-work-card__actions");
      const cardView = element("a", "btn ghost compact", "Xem phiếu");
      cardView.href = `search.html?code=${encodeURIComponent(row.ticket_code || "")}`;
      cardActions.appendChild(cardView);
      if (type === "active" && row.assignment_id) {
        cardActions.appendChild(actionButton("Đổi người", "reassign", {
          className: "btn secondary compact",
          assignmentId: row.assignment_id
        }));
      }
      card.append(cardHeader, cardDevice, cardCondition, cardMeta, cardActions);
      mobileList.appendChild(card);
    });

    table.append(head, body);
    wrap.append(table, mobileList);
    return wrap;
  }

  function assignmentPagination(type, meta) {
    const settings = meta || {};
    const count = Math.max(Number(settings.count) || 0, 0);
    const page = Math.max(Number(settings.page) || 1, 1);
    const totalPages = Math.max(Math.ceil(count / PROFILE_PAGE_SIZE), 1);
    const from = count > 0 ? (page - 1) * PROFILE_PAGE_SIZE + 1 : 0;
    const to = Math.min(page * PROFILE_PAGE_SIZE, count);
    const nav = element("nav", "employee-profile-pagination");
    nav.setAttribute("aria-label", type === "active"
      ? "Phân trang tivi đang thực hiện"
      : "Phân trang tivi đã sửa");

    const summary = element(
      "span",
      "employee-profile-pagination__summary",
      count > 0
        ? `Hiển thị ${from}–${to} trên ${count} phiếu`
        : "Chưa có phiếu"
    );
    const controls = element("div", "employee-profile-pagination__controls");
    const previous = element("button", "btn ghost compact", "Trước");
    previous.type = "button";
    previous.dataset.employeeAssignmentType = type;
    previous.dataset.employeeAssignmentPage = String(Math.max(page - 1, 1));
    previous.disabled = page <= 1 || Boolean(settings.loading);
    previous.setAttribute("aria-label", "Trang trước");

    const indicator = element(
      "span",
      "employee-profile-pagination__page",
      `Trang ${Math.min(page, totalPages)}/${totalPages}`
    );
    indicator.setAttribute("aria-live", "polite");

    const next = element("button", "btn ghost compact", "Sau");
    next.type = "button";
    next.dataset.employeeAssignmentType = type;
    next.dataset.employeeAssignmentPage = String(Math.min(page + 1, totalPages));
    next.disabled = page >= totalPages || Boolean(settings.loading);
    next.setAttribute("aria-label", "Trang sau");
    controls.append(previous, indicator, next);
    nav.append(summary, controls);
    return nav;
  }

  function assignmentContent(rows, type, meta) {
    const settings = meta || {};
    const shell = element("div", "employee-profile-assignment-content");

    if (settings.error) {
      const error = tableState(settings.error, "error");
      const retry = actionButton("Thử lại", "retry-assignment", {
        className: "btn secondary compact",
        assignmentType: type
      });
      error.appendChild(retry);
      shell.appendChild(error);
    }

    if (settings.loading) {
      const loading = element(
        "p",
        "employee-profile-refreshing",
        "Đang cập nhật danh sách..."
      );
      loading.setAttribute("role", "status");
      shell.appendChild(loading);
    }

    if (!settings.error || (Array.isArray(rows) && rows.length > 0)) {
      shell.appendChild(assignmentTable(rows, type));
    }
    shell.appendChild(assignmentPagination(type, settings));
    return shell;
  }

  function completedPeriodToolbar(period) {
    const selected = period || { key: "this-month", start: "", end: "" };
    const toolbar = element("div", "employee-work-filter");
    const group = element("div", "employee-work-filter__presets");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Lọc tivi đã sửa theo thời gian");
    [
      ["today", "Hôm nay"],
      ["this-week", "Tuần này"],
      ["this-month", "Tháng này"],
      ["all", "Tất cả"],
      ["custom", "Khoảng ngày"]
    ].forEach(([key, label]) => {
      const button = element("button", "", label);
      const active = selected.key === key;
      button.type = "button";
      button.dataset.employeeWorkPeriod = key;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
      group.appendChild(button);
    });
    toolbar.appendChild(group);

    if (selected.key === "custom") {
      const custom = element("div", "employee-work-filter__custom");
      const startLabel = element("label");
      startLabel.append(element("span", "", "Từ ngày"));
      const start = document.createElement("input");
      start.type = "date";
      start.value = selected.start || "";
      start.dataset.employeeWorkStart = "";
      startLabel.appendChild(start);

      const endLabel = element("label");
      endLabel.append(element("span", "", "Đến ngày"));
      const end = document.createElement("input");
      end.type = "date";
      end.value = selected.end || "";
      end.dataset.employeeWorkEnd = "";
      endLabel.appendChild(end);

      const apply = element("button", "btn secondary compact", "Áp dụng");
      apply.type = "button";
      apply.dataset.employeeWorkPeriodApply = "";
      custom.append(startLabel, endLabel, apply);
      toolbar.appendChild(custom);
    }
    return toolbar;
  }

  function renderWork(detail, assignments, meta, completedPeriod) {
    const panel = element("div", "employee-profile-panel");
    panel.dataset.employeeProfilePanel = "work";
    const active = assignments && Array.isArray(assignments.active) ? assignments.active : [];
    const completed = assignments && Array.isArray(assignments.completed) ? assignments.completed : [];
    const assignmentMeta = meta || {};

    const activeSection = element("section", "employee-profile-data-section");
    const activeHeader = element("header", "employee-section-header");
    const activeCopy = element("div");
    activeCopy.append(element("h3", "", "Tivi đang thực hiện"), element("p", "", "Thời gian xử lý tính từ lúc giao việc."));
    activeHeader.appendChild(activeCopy);
    if (detail.can_manage) {
      activeHeader.appendChild(actionButton("Giao tivi", "assign-ticket", { className: "btn primary compact" }));
    }
    activeSection.append(
      activeHeader,
      assignmentContent(active, "active", assignmentMeta.active)
    );

    const completedSection = element("section", "employee-profile-data-section");
    const completedHeader = element("header", "employee-section-header");
    const completedCopy = element("div");
    completedCopy.append(element("h3", "", "Đã sửa gần đây"), element("p", "", "KPI chỉ ghi nhận assignment hoàn thành hợp lệ."));
    completedHeader.appendChild(completedCopy);
    completedSection.append(
      completedHeader,
      completedPeriodToolbar(completedPeriod),
      assignmentContent(completed, "completed", assignmentMeta.completed)
    );

    panel.append(activeSection, completedSection);
    return panel;
  }

  function assignmentHistoryList(rows) {
    const history = Array.isArray(rows) ? rows : [];
    if (history.length === 0) {
      return tableState("Chưa có lịch sử phân công.", "empty");
    }

    const list = element("div", "employee-assignment-history");
    const labels = {
      assigned: "Đã giao việc",
      reassigned: "Đã chuyển người",
      cancelled: "Đã hủy phân công",
      completed: "Đã hoàn thành sửa chữa",
      completed_without_assignment: "Hoàn thành khi chưa phân công"
    };
    history.forEach((row) => {
      const item = element("article", "employee-assignment-history__item");
      const marker = element(
        "span",
        `employee-assignment-history__marker is-${row.event_type || "unknown"}`,
        labels[row.event_type] || "Cập nhật phân công"
      );
      const content = element("div", "employee-assignment-history__content");
      const heading = element("div", "employee-assignment-history__heading");
      const ticket = element("a", "employee-ticket-code", ticketCode(row.ticket_code));
      ticket.href = `search.html?code=${encodeURIComponent(row.ticket_code || "")}`;
      heading.append(ticket, marker);

      let detail = "";
      if (row.event_type === "reassigned") {
        detail = `Chuyển từ ${row.previous_employee_name || "nhân viên trước"} sang ${row.employee_name || "nhân viên mới"}.`;
      } else if (row.event_type === "assigned") {
        detail = `Giao cho ${row.employee_name || "nhân viên"}.`;
      } else if (row.event_type === "cancelled") {
        detail = `Hủy phân công của ${row.employee_name || "nhân viên"}.`;
      } else if (row.event_type === "completed") {
        detail = `${row.employee_name || "Nhân viên"} được ghi nhận hoàn thành hợp lệ.`;
      } else {
        detail = "Phiếu hoàn thành nhưng không có assignment hợp lệ để tính KPI.";
      }

      content.append(
        heading,
        element("p", "", detail),
        element(
          "small",
          "",
          `${row.actor_name || "Người thao tác"} · ${kpi().formatDateTime(row.created_at)}`
        )
      );
      if (row.note) {
        content.appendChild(element("blockquote", "", row.note));
      }
      const dot = element("span", "employee-assignment-history__dot");
      dot.setAttribute("aria-hidden", "true");
      item.append(dot, content);
      list.appendChild(item);
    });
    return list;
  }

  function renderHistory(detail, notes) {
    const panel = element("div", "employee-profile-panel");
    panel.dataset.employeeProfilePanel = "history";

    const history = element("section", "employee-profile-data-section");
    const historyHeader = element("header", "employee-section-header");
    const historyCopy = element("div");
    historyCopy.append(
      element("h3", "", "Lịch sử phân công gần đây"),
      element("p", "", "Giữ đầy đủ giao việc, chuyển người, hủy và hoàn thành.")
    );
    historyHeader.appendChild(historyCopy);
    history.appendChild(historyHeader);
    history.appendChild(assignmentHistoryList(detail.assignment_history));

    const notesSection = element("section", "employee-management-notes");
    const notesHeader = element("header", "employee-section-header");
    const notesCopy = element("div");
    notesCopy.append(
      element("h3", "", "Ghi chú quản lý"),
      element("p", "", "Ghi chú nội bộ dạng lịch sử, không lưu trên trình duyệt.")
    );
    notesHeader.appendChild(notesCopy);
    if (detail.can_manage) {
      notesHeader.appendChild(actionButton("Thêm ghi chú", "add-management-note", {
        className: "btn secondary compact"
      }));
    }
    notesSection.appendChild(notesHeader);

    const noteList = element("div", "employee-management-note-list");
    if (!detail.can_manage) {
      noteList.appendChild(tableState("Ghi chú quản lý chỉ dành cho Owner/Admin.", "empty"));
    } else if (!Array.isArray(notes)) {
      noteList.appendChild(tableState("Không thể tải ghi chú quản lý. Các phần hồ sơ khác vẫn hoạt động.", "error"));
    } else if (notes.length === 0) {
      noteList.appendChild(tableState("Chưa có ghi chú quản lý.", "empty"));
    } else {
      notes.forEach((note) => {
        const article = element("article", "employee-management-note");
        article.append(
          element("p", "", note.note),
          element(
            "footer",
            "",
            `${note.created_by_name || "Người quản lý"} · ${kpi().formatDateTime(note.created_at)}`
          )
        );
        noteList.appendChild(article);
      });
    }
    notesSection.appendChild(noteList);
    panel.append(history, notesSection);
    return panel;
  }

  function render(container, data, options) {
    const settings = options || {};
    const detail = Object.assign({}, data || {}, {
      can_manage: Boolean(settings.canManage),
      is_kpi_eligible: settings.employee
        ? settings.employee.is_kpi_eligible
        : data && data.is_kpi_eligible,
      completed_today: data && data.completed_today !== undefined
        ? data.completed_today
        : settings.employee && settings.employee.completed_today,
      completed_this_month: data && data.completed_this_month !== undefined
        ? data.completed_this_month
        : settings.employee && settings.employee.completed_this_month
    });
    const activeView = settings.activeView || "performance";
    container.replaceChildren();
    container.append(
      profileHeader(detail),
      profileNavigation(activeView)
    );

    if (activeView === "work") {
      container.appendChild(renderWork(
        detail,
        settings.assignments,
        settings.assignmentMeta,
        settings.completedWorkPeriod
      ));
    } else if (activeView === "history") {
      container.appendChild(renderHistory(detail, settings.notes));
    } else {
      container.appendChild(renderPerformance(detail));
    }
  }

  function renderLoading(container, employee) {
    container.replaceChildren();
    const shell = element("div", "employee-profile-loading");
    shell.setAttribute("role", "status");
    shell.setAttribute("aria-live", "polite");
    shell.append(
      element("div", "employee-profile-loading__avatar"),
      element("div", "employee-profile-loading__lines"),
      element("p", "", `Đang tải hồ sơ ${employee && employee.full_name ? employee.full_name : "nhân viên"}...`)
    );
    container.appendChild(shell);
  }

  function renderError(container, message) {
    container.replaceChildren();
    const state = element("div", "employee-profile-empty employee-profile-empty--error");
    state.append(
      element("strong", "", "Không thể tải hồ sơ nhân viên"),
      element("p", "", message || "Vui lòng thử lại.")
    );
    const retry = actionButton("Thử lại", "retry-profile", { className: "btn secondary" });
    state.appendChild(retry);
    container.appendChild(state);
  }

  function renderEmpty(container, canManage, filtered) {
    container.replaceChildren();
    const state = element("div", "employee-profile-empty");
    state.append(
      element("span", "employee-profile-empty__icon", "NV"),
      element("h2", "", filtered ? "Không tìm thấy hồ sơ phù hợp" : "Chưa có hồ sơ nhân viên"),
      element(
        "p",
        "",
        filtered
          ? "Thử đổi từ khóa hoặc bộ lọc ở danh sách nhân viên."
          : "Thêm nhân viên đầu tiên để bắt đầu phân công tivi và theo dõi hiệu suất."
      )
    );
    if (canManage && !filtered) {
      state.appendChild(actionButton("Thêm nhân viên đầu tiên", "create-employee", {
        className: "btn primary"
      }));
    }
    container.appendChild(state);
  }

  window.AMEmployeeProfile = Object.freeze({
    render,
    renderLoading,
    renderError,
    renderEmpty
  });
})();

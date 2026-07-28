(function () {
  "use strict";

  const SCORED_PAGE_SIZE = 10;
  const FULL_RANKING_PAGE_SIZE = 10;
  const HISTORY_PAGE_SIZE = 30;

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

  function byId(id) {
    return document.getElementById(id);
  }

  function numberOrNull(value) {
    if (value === null || value === undefined || String(value).trim() === "") {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function safeArray(value) {
    if (Array.isArray(value)) {
      return value;
    }
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch (_error) {
        return [];
      }
    }
    return [];
  }

  function safeObject(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value;
    }
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? parsed
          : {};
      } catch (_error) {
        return {};
      }
    }
    return {};
  }

  function create(options) {
    const settings = options || {};
    const root = settings.root;
    if (!(root instanceof Element)) {
      throw new Error("Không tìm thấy vùng Vinh danh nhân viên.");
    }

    const api = window.AMApi;
    const kpi = window.AMEmployeeKpi;
    const refs = {
      month: byId("employeeRecognitionMonth"),
      refresh: byId("employeeRecognitionRefresh"),
      periodLabel: byId("employeeRecognitionPeriodLabel"),
      scoringStatus: byId("employeeRecognitionScoringStatus"),
      stageDescription: byId("employeeRecognitionStageDescription"),
      podiumState: byId("employeeRecognitionPodiumState"),
      podium: byId("employeeRecognitionPodium"),
      detailTitle: byId("employeeRecognitionDetailTitle"),
      detailDescription: byId("employeeRecognitionDetailDescription"),
      detailState: byId("employeeRecognitionDetailState"),
      detailContent: byId("employeeRecognitionDetailContent"),
      detailSummary: byId("employeeRecognitionSummary"),
      explain: byId("employeeRecognitionExplainButton"),
      scoredCount: byId("employeeScoredWorkCount"),
      scoredState: byId("employeeScoredWorkState"),
      scoredContent: byId("employeeScoredWorkContent"),
      scoredList: byId("employeeScoredWorkList"),
      scoredPagination: byId("employeeScoredWorkPagination"),
      reportState: byId("employeeMonthlyReportState"),
      reportContent: byId("employeeMonthlyReportContent"),
      reportKpis: byId("employeeMonthlyKpis"),
      pointsChart: byId("employeeWeightedPointsChart"),
      countPointsChart: byId("employeeCountPointsChart"),
      sizeChart: byId("employeeSizeDistributionChart"),
      complexityChart: byId("employeeComplexityChart"),
      weeklyChart: byId("employeeWeeklyPointsChart"),
      fullRankingCount: byId("employeeFullRankingCount"),
      fullRankingTable: byId("employeeFullRankingTable"),
      fullRankingPagination: byId("employeeFullRankingPagination"),
      secondaryAwards: byId("employeeSecondaryAwards"),
      workloadBalance: byId("employeeWorkloadBalance"),
      bonusPreview: byId("employeeBonusPreview"),
      historyState: byId("employeeAwardHistoryState"),
      historyContent: byId("employeeAwardHistoryContent"),
      historyList: byId("employeeAwardHistoryList"),
      drawerBackdrop: byId("employeeCalculationBackdrop"),
      drawer: byId("employeeCalculationDrawer"),
      drawerClose: byId("employeeCalculationClose"),
      drawerContent: byId("employeeCalculationContent")
    };
    const state = {
      month: "",
      podium: [],
      ranking: [],
      report: null,
      selectedEmployeeId: "",
      detail: null,
      scoredRows: [],
      scoredRowsById: new Map(),
      scoredPage: 1,
      scoredCount: 0,
      rankingPage: 1,
      controllers: {},
      loadVersion: 0,
      returnFocus: null,
      bound: false
    };

    function abort(key) {
      if (state.controllers[key]) {
        state.controllers[key].abort();
      }
      const controller = new AbortController();
      state.controllers[key] = controller;
      return controller;
    }

    function isAbort(error) {
      return Boolean(error && (
        error.name === "AbortError"
        || error.employeeRequestAborted
        || (error.originalError && error.originalError.name === "AbortError")
      ));
    }

    function currentMonth() {
      return kpi.todayIso().slice(0, 7);
    }

    function previousMonth(value) {
      const start = `${value || currentMonth()}-01`;
      return kpi.addDays(start, -1).slice(0, 7);
    }

    function monthRange(value) {
      const month = /^\d{4}-\d{2}$/.test(String(value || ""))
        ? String(value)
        : currentMonth();
      const start = `${month}-01`;
      return { month, start, end: kpi.endOfMonth(start) };
    }

    function monthLabel(value) {
      const range = monthRange(value);
      const [year, month] = range.month.split("-").map(Number);
      return new Intl.DateTimeFormat("vi-VN", {
        month: "long",
        year: "numeric",
        timeZone: "Asia/Ho_Chi_Minh"
      }).format(new Date(Date.UTC(year, month - 1, 1)));
    }

    function compactCode(value) {
      return api.formatCompactBusinessCode(value, "NV");
    }

    function formatPoints(value, suffix) {
      const parsed = numberOrNull(value);
      return parsed === null
        ? "Chưa đủ dữ liệu"
        : `${kpi.formatWorkPoints(parsed)}${suffix === false ? "" : " điểm"}`;
    }

    function formatPercent(value) {
      const parsed = numberOrNull(value);
      return parsed === null ? "Chưa đủ dữ liệu" : kpi.formatPercent(parsed);
    }

    function formatNumber(value, suffix) {
      const parsed = numberOrNull(value);
      return parsed === null
        ? "Chưa đủ dữ liệu"
        : `${kpi.formatNumber(parsed)}${suffix || ""}`;
    }

    function setSectionState(stateNode, contentNode, type, message, retryKey) {
      if (!stateNode || !contentNode) {
        return;
      }
      stateNode.replaceChildren();
      stateNode.className = `employee-recognition-state is-${type}`;
      stateNode.setAttribute("role", type === "error" ? "alert" : "status");
      stateNode.appendChild(element("span", "", message));
      if (type === "error" && retryKey) {
        const retry = element("button", "btn secondary compact", "Thử lại");
        retry.type = "button";
        retry.dataset.recognitionRetry = retryKey;
        stateNode.appendChild(retry);
      }
      stateNode.hidden = type === "data";
      contentNode.hidden = type !== "data";
      contentNode.setAttribute("aria-busy", type === "loading" ? "true" : "false");
    }

    function statusBadge(row) {
      const status = String(row.scoring_status || "provisional");
      const map = {
        official: ["KPI chính thức", "official"],
        provisional: ["KPI tạm tính", "provisional"],
        provisional_no_target: ["Tạm tính · chưa có mục tiêu", "provisional"],
        insufficient_data: ["Chưa đủ dữ liệu", "neutral"]
      };
      const config = map[status] || map.provisional;
      return element("span", `employee-recognition-badge is-${config[1]}`, config[0]);
    }

    function employmentBadge(status) {
      const active = status === "active";
      return element(
        "span",
        `employee-recognition-badge ${active ? "is-active" : "is-neutral"}`,
        active ? "Đang hoạt động" : "Không hoạt động"
      );
    }

    function podiumPlaceholder(rank) {
      const node = element("div", `employee-podium-card employee-podium-card--rank-${rank} is-placeholder`);
      node.setAttribute("role", "option");
      node.setAttribute("aria-disabled", "true");
      node.append(
        element("span", "employee-podium-rank", `Hạng ${rank}`),
        element("span", "employee-podium-placeholder-mark", String(rank)),
        element("strong", "", `Chưa có dữ liệu Hạng ${rank}`),
        element("p", "", "Vị trí sẽ xuất hiện khi có thêm nhân viên hoàn thành công việc trong kỳ.")
      );
      return node;
    }

    function podiumCard(row, rank) {
      const button = element(
        "button",
        `employee-podium-card employee-podium-card--rank-${rank}`
      );
      button.type = "button";
      button.dataset.recognitionEmployee = row.employee_id;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", row.employee_id === state.selectedEmployeeId ? "true" : "false");
      button.setAttribute(
        "aria-label",
        `Hạng ${rank}, ${row.full_name || "nhân viên"}, ${formatPoints(row.weighted_work_points)}. Nhấn để xem chi tiết.`
      );
      const top = element("div", "employee-podium-card__top");
      top.append(element("span", "employee-podium-rank", `Hạng ${rank}`), employmentBadge(row.employment_status));
      const avatar = element("span", "employee-podium-avatar", kpi.getInitials(row.full_name));
      avatar.setAttribute("aria-hidden", "true");
      const identity = element("div", "employee-podium-identity");
      identity.append(
        element("strong", "", row.full_name || "Nhân viên"),
        element("span", "", [compactCode(row.employee_code), row.job_title || "Chưa cập nhật chức danh"].join(" · "))
      );
      const metrics = element("dl", "employee-podium-metrics");
      [
        ["Tivi hoàn thành", formatNumber(row.completed_count, " tivi")],
        ["Điểm quy đổi", formatPoints(row.weighted_work_points)],
        ["Tivi từ 65 inch", formatNumber(row.large_tv_count, " tivi")],
        ["Mức đạt mục tiêu", numberOrNull(row.target_achievement) === null
          ? "Chưa thiết lập mục tiêu"
          : formatPercent(row.target_achievement)]
      ].forEach(([label, value]) => {
        const item = element("div");
        item.append(element("dt", "", label), element("dd", "", value));
        metrics.appendChild(item);
      });
      button.append(top, avatar, identity, statusBadge(row), metrics);
      if (rank === 1) {
        button.appendChild(element(
          "p",
          "employee-podium-insight",
          `Dẫn đầu với ${formatPoints(row.weighted_work_points)} từ ${formatNumber(row.completed_count, " tivi hoàn thành")}.`
        ));
      }
      return button;
    }

    function renderPodium(rows) {
      const byRank = new Map(rows.map((row) => [Number(row.rank_position), row]));
      refs.podium.replaceChildren();
      [1, 2, 3].forEach((rank) => {
        const row = byRank.get(rank);
        refs.podium.appendChild(row ? podiumCard(row, rank) : podiumPlaceholder(rank));
      });
      setSectionState(
        refs.podiumState,
        refs.podium,
        rows.length > 0 ? "data" : "empty",
        rows.length > 0
          ? ""
          : "Chưa đủ dữ liệu để vinh danh. Kết quả sẽ xuất hiện khi nhân viên hoàn thành công việc trong kỳ."
      );
    }

    function updatePodiumSelection() {
      refs.podium.querySelectorAll("[data-recognition-employee]").forEach((node) => {
        const selected = node.dataset.recognitionEmployee === state.selectedEmployeeId;
        node.classList.toggle("is-selected", selected);
        node.setAttribute("aria-selected", selected ? "true" : "false");
      });
    }

    function writeSelectedEmployee(replace) {
      const url = new URL(window.location.href);
      if (state.selectedEmployeeId) {
        url.searchParams.set("awardEmployee", state.selectedEmployeeId);
      } else {
        url.searchParams.delete("awardEmployee");
      }
      window.history[replace ? "replaceState" : "pushState"](null, "", url);
    }

    function selectedRow() {
      return state.ranking.find((row) => row.employee_id === state.selectedEmployeeId)
        || state.podium.find((row) => row.employee_id === state.selectedEmployeeId)
        || null;
    }

    function metricCard(label, value, note, tone) {
      const card = element("article", `employee-recognition-metric${tone ? ` is-${tone}` : ""}`);
      card.append(element("span", "", label), element("strong", "", value));
      if (note) {
        card.appendChild(element("small", "", note));
      }
      return card;
    }

    function renderDetail(detail) {
      const summary = safeObject(detail.employee_summary);
      const dataStatus = safeObject(detail.data_status);
      const bonus = safeObject(detail.bonus_breakdown);
      const row = Object.assign({}, selectedRow() || {}, summary);
      state.detail = { summary: row, dataStatus, bonus };
      refs.detailTitle.textContent = `Chi tiết thành tích của ${row.full_name || "nhân viên"}`;
      refs.detailDescription.textContent = row.scoring_status === "official"
        ? "KPI đã đủ các thành phần theo rule version của kỳ."
        : "Điểm đang tạm tính; tiêu chí thiếu dữ liệu không bị quy thành 0.";
      refs.detailSummary.replaceChildren();
      [
        ["Tivi hoàn thành", formatNumber(row.completed_count, " tivi"), "Số lượng thực tế", "primary"],
        ["Điểm quy đổi", formatPoints(row.weighted_work_points), "Kích thước × độ khó", "accent"],
        ["Tivi từ 65 inch", formatNumber(row.large_tv_count, " tivi"), "Khối lượng cỡ lớn"],
        ["Độ khó trung bình", numberOrNull(row.average_complexity_weight) === null
          ? "Chưa đủ dữ liệu"
          : `${kpi.formatWorkPoints(row.average_complexity_weight)}×`, "Theo snapshot hoàn thành"],
        ["Tỷ lệ hoàn thành", formatPercent(row.completion_rate), "Số hoàn thành / số được giao"],
        ["Thời gian sửa TB", numberOrNull(row.average_repair_hours) === null
          ? "Chưa đủ dữ liệu"
          : kpi.formatHours(row.average_repair_hours), "assigned_at → ready_for_handover_at"],
        ["Điểm chất lượng", numberOrNull(row.quality_score) === null
          ? "Chưa đủ dữ liệu"
          : `${kpi.formatWorkPoints(row.quality_score)}/100`, dataStatus.quality_available ? "Đã có xác nhận" : "Không tự phạt"],
        ["Điểm tiến độ", numberOrNull(row.on_time_score) === null
          ? "Chưa đủ dữ liệu"
          : `${kpi.formatWorkPoints(row.on_time_score)}/100`, dataStatus.progress_available ? "Đã có dữ liệu" : "Không tự phạt"],
        ["KPI tổng", numberOrNull(row.overall_kpi_score) === null
          ? "Chưa đủ dữ liệu"
          : `${kpi.formatWorkPoints(row.overall_kpi_score)}/100`, row.scoring_status === "official" ? "Chính thức" : "Tạm tính"],
        ["Mức đạt mục tiêu", numberOrNull(row.target_achievement) === null
          ? "Chưa thiết lập mục tiêu"
          : formatPercent(row.target_achievement), "Mục tiêu điểm quy đổi"],
        ["Thưởng dự kiến", bonus.configured ? kpi.formatMoney(bonus.total_preview) : "Chưa cấu hình thưởng", "Chưa phải khoản đã chốt"]
      ].forEach((item) => refs.detailSummary.appendChild(metricCard(...item)));
      refs.explain.disabled = false;
      setSectionState(refs.detailState, refs.detailContent, "data", "");
    }

    function sourceLabel(value) {
      return ({
        structured_field: "Trường kích thước phiếu",
        model_parser: "Parser model có kiểm soát",
        manual: "Quản lý xác nhận thủ công",
        unknown: "Chưa xác định"
      })[value] || "Chưa xác định";
    }

    function scoreBadge(text, tone) {
      return element("span", `employee-recognition-badge is-${tone || "neutral"}`, text);
    }

    function renderScoredRows(rows) {
      refs.scoredList.replaceChildren();
      state.scoredRowsById = new Map();
      rows.forEach((row) => {
        state.scoredRowsById.set(String(row.snapshot_id || ""), row);
        const card = element("article", "employee-scored-work-item");
        const header = element("header");
        const identity = element("div");
        identity.append(
          element("strong", "", api.formatTicketCode(row.ticket_code)),
          element("span", "", [row.device_brand, row.device_model].filter(Boolean).join(" · ") || "Chưa có thông tin thiết bị")
        );
        const badges = element("div", "employee-scored-work-item__badges");
        if (row.needs_size_review) {
          badges.appendChild(scoreBadge("Cần rà soát kích thước", "warning"));
        }
        if (row.used_default_complexity) {
          badges.appendChild(scoreBadge("Độ khó mặc định", "neutral"));
        }
        if (row.scoring_status !== "official") {
          badges.appendChild(scoreBadge("Điểm tạm tính", "provisional"));
        }
        if (Number(row.adjustment_count) > 0) {
          badges.appendChild(scoreBadge("Đã điều chỉnh", "adjusted"));
        }
        header.append(identity, badges);
        const facts = element("dl", "employee-scored-work-item__facts");
        [
          ["Kích thước", row.tv_size_inches ? `${row.tv_size_inches} inch` : "Chưa xác định"],
          ["Nguồn kích thước", sourceLabel(row.size_source)],
          ["Độ khó", row.complexity_label || "Tiêu chuẩn"],
          ["Ngày giao", kpi.formatDateTime(row.assigned_at)],
          ["Ngày hoàn thành", kpi.formatDateTime(row.completed_at)],
          ["Thời gian xử lý", numberOrNull(row.repair_hours) === null ? "Chưa đủ dữ liệu" : kpi.formatHours(row.repair_hours)],
          ["Chất lượng", row.quality_status === "insufficient_data" ? "Chưa đủ dữ liệu" : row.quality_status],
          ["Tiến độ", row.progress_status === "insufficient_data" ? "Chưa đủ dữ liệu" : row.progress_status],
          ["Rule version", row.rule_version || "—"]
        ].forEach(([label, value]) => {
          const item = element("div");
          item.append(element("dt", "", label), element("dd", "", value));
          facts.appendChild(item);
        });
        const formula = element("p", "employee-scored-work-formula");
        formula.append(
          element("span", "", "Điểm công việc"),
          element(
            "strong",
            "",
            `${kpi.formatWorkPoints(row.size_weight)} × ${kpi.formatWorkPoints(row.complexity_weight)} = ${formatPoints(row.final_work_points)}`
          )
        );
        card.append(header, facts, formula);
        const actions = element("div", "employee-scored-work-item__actions");
        if (typeof settings.canManage === "function" && settings.canManage()) {
          const adjust = element("button", "employee-text-button", "Điều chỉnh điểm");
          adjust.type = "button";
          adjust.dataset.recognitionAdjust = row.snapshot_id;
          actions.appendChild(adjust);
        }
        if (Number(row.adjustment_count) > 0) {
          const adjustments = element("button", "employee-text-button", "Xem lịch sử điều chỉnh");
          adjustments.type = "button";
          adjustments.dataset.recognitionAdjustments = row.snapshot_id;
          actions.appendChild(adjustments);
        }
        if (actions.childElementCount > 0) {
          card.appendChild(actions);
        }
        refs.scoredList.appendChild(card);
      });
    }

    function renderPagination() {
      const totalPages = Math.max(Math.ceil(state.scoredCount / SCORED_PAGE_SIZE), 1);
      refs.scoredPagination.replaceChildren();
      if (state.scoredCount <= SCORED_PAGE_SIZE) {
        return;
      }
      const previous = element("button", "btn secondary compact", "Trước");
      previous.type = "button";
      previous.disabled = state.scoredPage <= 1;
      previous.dataset.scoredPage = String(state.scoredPage - 1);
      const label = element("span", "employee-pagination__summary", `Trang ${state.scoredPage}/${totalPages}`);
      const next = element("button", "btn secondary compact", "Sau");
      next.type = "button";
      next.disabled = state.scoredPage >= totalPages;
      next.dataset.scoredPage = String(state.scoredPage + 1);
      refs.scoredPagination.append(previous, label, next);
    }

    function renderScored(result) {
      state.scoredRows = Array.isArray(result.rows) ? result.rows : [];
      state.scoredCount = Number(result.count) || 0;
      const from = state.scoredCount === 0 ? 0 : (state.scoredPage - 1) * SCORED_PAGE_SIZE + 1;
      const to = Math.min(state.scoredPage * SCORED_PAGE_SIZE, state.scoredCount);
      refs.scoredCount.textContent = state.scoredCount === 0
        ? "Chưa có tivi được ghi nhận trong tháng."
        : `Hiển thị ${from}–${to} trên tổng số ${state.scoredCount} tivi.`;
      renderScoredRows(state.scoredRows);
      renderPagination();
      setSectionState(
        refs.scoredState,
        refs.scoredContent,
        state.scoredRows.length > 0 ? "data" : "empty",
        state.scoredRows.length > 0 ? "" : "Chưa có tivi được ghi nhận trong tháng."
      );
    }

    function renderBars(container, rows, options) {
      const config = options || {};
      const data = (Array.isArray(rows) ? rows : []).filter((row) => numberOrNull(config.value(row)) !== null);
      container.replaceChildren();
      if (data.length === 0 || data.every((row) => Number(config.value(row)) === 0)) {
        container.appendChild(element("p", "employee-recognition-chart-empty", "Chưa đủ dữ liệu để vẽ biểu đồ."));
        return;
      }
      const max = Math.max(...data.map((row) => Number(config.value(row)) || 0), 1);
      const list = element("div", "employee-recognition-bars");
      data.forEach((row) => {
        const value = Number(config.value(row)) || 0;
        const item = element("div", "employee-recognition-bar");
        const heading = element("div", "employee-recognition-bar__heading");
        heading.append(
          element("span", "", config.label(row)),
          element("strong", "", config.format ? config.format(value, row) : kpi.formatNumber(value))
        );
        const track = element("div", "employee-recognition-bar__track");
        track.setAttribute("role", "img");
        track.setAttribute("aria-label", `${config.label(row)}: ${config.format ? config.format(value, row) : value}`);
        const fill = element("span", `employee-recognition-bar__fill ${config.tone || ""}`);
        fill.style.width = `${Math.max(value / max * 100, value > 0 ? 2 : 0)}%`;
        track.appendChild(fill);
        item.append(heading, track);
        if (config.meta) {
          item.appendChild(element("small", "", config.meta(row)));
        }
        list.appendChild(item);
      });
      container.appendChild(list);
    }

    function renderCountPointsChart(rows) {
      refs.countPointsChart.replaceChildren();
      const data = rows.slice(0, 8);
      if (data.length === 0) {
        refs.countPointsChart.appendChild(element("p", "employee-recognition-chart-empty", "Chưa đủ dữ liệu để so sánh."));
        return;
      }
      const maxCount = Math.max(...data.map((row) => Number(row.completed_count) || 0), 1);
      const maxPoints = Math.max(...data.map((row) => Number(row.weighted_work_points) || 0), 1);
      const legend = element("div", "employee-recognition-chart-legend");
      legend.append(element("span", "is-count", "Số tivi"), element("span", "is-points", "Điểm quy đổi"));
      const list = element("div", "employee-recognition-dual-bars");
      data.forEach((row) => {
        const item = element("div", "employee-recognition-dual-bar");
        item.appendChild(element("strong", "", row.full_name || compactCode(row.employee_code)));
        [["is-count", Number(row.completed_count) || 0, maxCount, `${kpi.formatNumber(row.completed_count)} tivi`],
          ["is-points", Number(row.weighted_work_points) || 0, maxPoints, formatPoints(row.weighted_work_points)]
        ].forEach(([tone, value, max, label]) => {
          const line = element("div", "employee-recognition-dual-bar__line");
          const track = element("span", "employee-recognition-dual-bar__track");
          const fill = element("span", `employee-recognition-dual-bar__fill ${tone}`);
          fill.style.width = `${value / max * 100}%`;
          track.appendChild(fill);
          line.append(track, element("span", "", label));
          item.appendChild(line);
        });
        list.appendChild(item);
      });
      refs.countPointsChart.append(legend, list);
    }

    function renderMonthlyKpis(summary) {
      refs.reportKpis.replaceChildren();
      [
        ["Tổng tivi hoàn thành", formatNumber(summary.completed_count, " tivi"), "Số lượng thật"],
        ["Tổng điểm quy đổi", formatPoints(summary.weighted_work_points), "Khối lượng đã quy đổi"],
        ["Tivi từ 65 inch", formatNumber(summary.large_tv_count, " tivi"), "Thiết bị cỡ lớn"],
        ["Nhân viên đạt mục tiêu", formatNumber(summary.employees_reaching_target, " người"), "Theo mục tiêu điểm"],
        ["Thời gian sửa TB đội", numberOrNull(summary.average_repair_hours) === null
          ? "Chưa đủ dữ liệu"
          : kpi.formatHours(summary.average_repair_hours), "Không dùng để phán xét tuyệt đối"],
        ["Thưởng dự kiến toàn đội", summary.bonus_policy_configured
          ? kpi.formatMoney(summary.bonus_preview_total)
          : "Chưa cấu hình thưởng", "Chưa phải khoản đã chốt"]
      ].forEach(([label, value, note], index) => {
        refs.reportKpis.appendChild(metricCard(label, value, note, index < 2 ? "primary" : ""));
      });
    }

    function renderFullRankingPagination(totalPages) {
      refs.fullRankingPagination.replaceChildren();
      if (totalPages <= 1) {
        return;
      }
      const previous = element("button", "btn secondary compact", "Trước");
      previous.type = "button";
      previous.disabled = state.rankingPage <= 1;
      previous.dataset.rankingPage = String(state.rankingPage - 1);
      const status = element(
        "span",
        "employee-pagination__summary",
        `Trang ${state.rankingPage}/${totalPages}`
      );
      const next = element("button", "btn secondary compact", "Sau");
      next.type = "button";
      next.disabled = state.rankingPage >= totalPages;
      next.dataset.rankingPage = String(state.rankingPage + 1);
      refs.fullRankingPagination.append(previous, status, next);
    }

    function appendRankingCell(row, value, label, className) {
      const cell = element("td", className || "", value);
      cell.dataset.label = label;
      row.appendChild(cell);
      return cell;
    }

    function renderFullRanking(rows) {
      refs.fullRankingTable.replaceChildren();
      refs.fullRankingPagination.replaceChildren();
      if (rows.length === 0) {
        refs.fullRankingCount.textContent = "Chưa có nhân viên đủ dữ liệu trong kỳ.";
        refs.fullRankingTable.appendChild(element("p", "employee-recognition-chart-empty", "Chưa đủ dữ liệu để xếp hạng."));
        return;
      }
      const totalPages = Math.max(Math.ceil(rows.length / FULL_RANKING_PAGE_SIZE), 1);
      state.rankingPage = Math.min(Math.max(state.rankingPage, 1), totalPages);
      const fromIndex = (state.rankingPage - 1) * FULL_RANKING_PAGE_SIZE;
      const pageRows = rows.slice(fromIndex, fromIndex + FULL_RANKING_PAGE_SIZE);
      const from = fromIndex + 1;
      const to = fromIndex + pageRows.length;
      refs.fullRankingCount.textContent = `Hiển thị ${from}–${to} trên tổng số ${kpi.formatNumber(rows.length)} nhân viên.`;
      const wrap = element("div", "employee-recognition-table-wrap");
      const table = element("table", "employee-recognition-table");
      const caption = element("caption", "sr-only", "Xếp hạng đầy đủ theo điểm công việc quy đổi");
      const head = document.createElement("thead");
      const headRow = document.createElement("tr");
      ["Hạng", "Nhân viên", "Tivi", "Điểm quy đổi", "Tivi ≥65\"", "Độ khó TB", "Chất lượng", "Tiến độ", "KPI", "Đạt mục tiêu", "Thưởng dự kiến", "Hành động"]
        .forEach((label) => headRow.appendChild(element("th", "", label)));
      head.appendChild(headRow);
      const body = document.createElement("tbody");
      pageRows.forEach((row) => {
        const tr = document.createElement("tr");
        tr.tabIndex = 0;
        tr.dataset.recognitionRow = row.employee_id;
        tr.setAttribute("aria-label", `Xem thành tích của ${row.full_name || "nhân viên"}`);
        const identity = document.createElement("td");
        identity.dataset.label = "Nhân viên";
        identity.append(element("strong", "", row.full_name || "Nhân viên"), element("span", "", compactCode(row.employee_code)));
        appendRankingCell(tr, `Hạng ${row.rank_position}`, "Hạng", "employee-recognition-rank-cell");
        tr.appendChild(identity);
        appendRankingCell(tr, formatNumber(row.completed_count), "Tivi hoàn thành");
        appendRankingCell(tr, formatPoints(row.weighted_work_points, false), "Điểm quy đổi", "employee-recognition-points-cell");
        appendRankingCell(tr, formatNumber(row.large_tv_count), "Tivi từ 65 inch");
        appendRankingCell(tr, numberOrNull(row.average_complexity_weight) === null ? "—" : `${kpi.formatWorkPoints(row.average_complexity_weight)}×`, "Độ khó trung bình");
        appendRankingCell(tr, numberOrNull(row.quality_score) === null ? "Chưa đủ" : `${kpi.formatWorkPoints(row.quality_score)}/100`, "Chất lượng");
        appendRankingCell(tr, numberOrNull(row.on_time_score) === null ? "Chưa đủ" : `${kpi.formatWorkPoints(row.on_time_score)}/100`, "Đúng tiến độ");
        appendRankingCell(tr, numberOrNull(row.overall_kpi_score) === null ? "Tạm tính" : `${kpi.formatWorkPoints(row.overall_kpi_score)}/100`, "KPI");
        appendRankingCell(tr, numberOrNull(row.target_achievement) === null ? "Chưa đặt" : formatPercent(row.target_achievement), "Mức đạt mục tiêu");
        appendRankingCell(tr, numberOrNull(row.bonus_preview) === null ? "Chưa cấu hình" : kpi.formatMoney(row.bonus_preview), "Thưởng dự kiến");
        const actionCell = document.createElement("td");
        actionCell.dataset.label = "Hành động";
        const actions = element("div", "employee-recognition-table-actions");
        const achievement = element("button", "employee-text-button", "Xem thành tích");
        achievement.type = "button";
        achievement.dataset.recognitionSelect = row.employee_id;
        const tickets = element("button", "employee-text-button", "Xem tivi");
        tickets.type = "button";
        tickets.dataset.recognitionTickets = row.employee_id;
        const profile = element("button", "employee-text-button", "Xem hồ sơ");
        profile.type = "button";
        profile.dataset.recognitionProfile = row.employee_id;
        actions.append(achievement, tickets, profile);
        actionCell.appendChild(actions);
        tr.appendChild(actionCell);
        body.appendChild(tr);
      });
      table.append(caption, head, body);
      wrap.appendChild(table);
      refs.fullRankingTable.appendChild(wrap);
      renderFullRankingPagination(totalPages);
    }

    function renderSecondaryAwards(rows) {
      refs.secondaryAwards.replaceChildren();
      if (rows.length === 0) {
        refs.secondaryAwards.appendChild(element("p", "employee-recognition-empty-copy", "Chưa đủ dữ liệu cho danh hiệu phụ."));
        return;
      }
      const list = element("div", "employee-secondary-award-list");
      rows.forEach((row) => {
        const item = element("article");
        item.append(
          element("span", "", row.label || "Danh hiệu"),
          element("strong", "", row.employee_name || "Nhân viên"),
          element("small", "", row.value_label || "Đã có dữ liệu xác nhận")
        );
        list.appendChild(item);
      });
      refs.secondaryAwards.appendChild(list);
    }

    function renderWorkloadBalance(rows) {
      refs.workloadBalance.replaceChildren();
      if (rows.length === 0) {
        refs.workloadBalance.appendChild(element("p", "employee-recognition-empty-copy", "Chưa đủ dữ liệu phân công."));
        return;
      }
      const values = rows.map((row) => Number(row.weighted_work_points) || 0).filter((value) => value > 0);
      const unbalanced = values.length > 1 && Math.max(...values) / Math.max(Math.min(...values), 0.01) >= 1.75;
      refs.workloadBalance.appendChild(element(
        "p",
        `employee-workload-signal ${unbalanced ? "is-warning" : "is-balanced"}`,
        unbalanced
          ? "Phân bổ khối lượng công việc giữa các nhân viên đang chênh lệch."
          : "Khối lượng hoàn thành đang ở mức tương đối cân bằng."
      ));
      const list = element("dl", "employee-workload-list");
      rows.slice(0, 6).forEach((row) => {
        const item = element("div");
        item.append(
          element("dt", "", row.full_name || compactCode(row.employee_code)),
          element("dd", "", `${formatNumber(row.assigned_count, " giao")} · ${formatPoints(row.weighted_work_points)}`)
        );
        list.appendChild(item);
      });
      refs.workloadBalance.appendChild(list);
    }

    function renderBonus(summary) {
      refs.bonusPreview.replaceChildren();
      if (!summary.bonus_policy_configured) {
        refs.bonusPreview.append(
          element("strong", "", "Chưa cấu hình thưởng"),
          element("p", "", "Điểm quy đổi và thứ hạng vẫn hoạt động; hệ thống không tự đặt chính sách tiền thưởng.")
        );
        return;
      }
      refs.bonusPreview.append(
        element("span", "employee-recognition-badge is-provisional", "Dự kiến"),
        element("strong", "employee-bonus-total", kpi.formatMoney(summary.bonus_preview_total)),
        element("p", "", "Tổng preview toàn đội, chỉ được cố định khi Owner chốt vinh danh.")
      );
    }

    function renderReport(payload) {
      const report = payload || {};
      const summary = safeObject(report.team_summary);
      const ranking = safeArray(report.ranking);
      const sizeRows = safeArray(report.size_distribution);
      const complexityRows = safeArray(report.complexity_distribution);
      const weeklyRows = safeArray(report.weekly_trend);
      const secondaryAwards = safeArray(report.secondary_awards).filter(Boolean);
      const workload = safeArray(report.workload_balance);
      state.report = report;
      state.ranking = ranking;
      state.rankingPage = 1;
      renderMonthlyKpis(summary);
      renderBars(refs.pointsChart, ranking.slice(0, 10), {
        label: (row) => row.full_name || compactCode(row.employee_code),
        value: (row) => row.weighted_work_points,
        format: (value, row) => `${kpi.formatWorkPoints(value)} điểm · ${kpi.formatNumber(row.completed_count)} tivi`,
        meta: (row) => `${kpi.formatNumber(row.large_tv_count)} tivi từ 65 inch`,
        tone: "is-points"
      });
      renderCountPointsChart(ranking);
      renderBars(refs.sizeChart, sizeRows, {
        label: (row) => row.label || row.key,
        value: (row) => row.value,
        format: (value) => `${kpi.formatNumber(value)} tivi`,
        meta: (row) => `${formatPoints(row.weighted_work_points)} quy đổi`,
        tone: "is-size"
      });
      renderBars(refs.complexityChart, complexityRows, {
        label: (row) => row.label || row.key,
        value: (row) => row.value,
        format: (value) => `${kpi.formatNumber(value)} tivi`,
        meta: (row) => `${formatPoints(row.weighted_work_points)} quy đổi`,
        tone: "is-complexity"
      });
      renderBars(refs.weeklyChart, weeklyRows, {
        label: (row) => `Tuần ${kpi.formatDate(row.week_start)}`,
        value: (row) => row.weighted_work_points,
        format: (value, row) => `${kpi.formatWorkPoints(value)} điểm · ${kpi.formatNumber(row.completed_count)} tivi`,
        tone: "is-week"
      });
      renderFullRanking(ranking);
      renderSecondaryAwards(secondaryAwards);
      renderWorkloadBalance(workload);
      renderBonus(summary);
      refs.scoringStatus.textContent = summary.scoring_status === "official"
        ? "KPI chính thức"
        : "Xếp hạng tạm tính theo sản lượng quy đổi";
      refs.stageDescription.textContent = summary.scoring_status === "official"
        ? "Xếp hạng đã đủ dữ liệu sản lượng, chất lượng và tiến độ theo rule của kỳ."
        : "Chất lượng hoặc tiến độ chưa đủ dữ liệu; điểm quy đổi là tiêu chí chính và phần thiếu không bị quy thành 0.";
      setSectionState(
        refs.reportState,
        refs.reportContent,
        ranking.length > 0 ? "data" : "empty",
        ranking.length > 0 ? "" : "Chưa có dữ liệu hoàn thành để lập báo cáo tháng."
      );
    }

    function renderHistory(rows) {
      refs.historyList.replaceChildren();
      if (rows.length === 0) {
        setSectionState(refs.historyState, refs.historyContent, "empty", "Chưa có vinh danh nào được chốt.");
        return;
      }
      rows.forEach((award) => {
        const item = element("article", "employee-award-item");
        const heading = element("div");
        heading.append(element("strong", "", award.title || "Vinh danh"), element("span", "", award.full_name_snapshot || "Nhân viên"));
        const meta = element("div", "employee-award-item__meta");
        meta.append(
          element("span", "", `${kpi.formatDate(award.period_start)} – ${kpi.formatDate(award.period_end)}`),
          element("span", "", `${formatNumber(award.completed_tickets, " tivi hoàn thành")}`),
          element("span", "", numberOrNull(award.kpi_score) === null ? "KPI chưa đủ dữ liệu" : `KPI ${kpi.formatWorkPoints(award.kpi_score)}/100`)
        );
        item.append(heading, meta);
        refs.historyList.appendChild(item);
      });
      setSectionState(refs.historyState, refs.historyContent, "data", "");
    }

    async function loadScored(page) {
      if (!state.selectedEmployeeId) {
        return;
      }
      const controller = abort("scored");
      state.scoredPage = Math.max(Number(page) || 1, 1);
      setSectionState(refs.scoredState, refs.scoredContent, "loading", "Đang tải danh sách tivi tính điểm...");
      try {
        const range = monthRange(state.month);
        const result = await api.getEmployeeScoredTickets(state.selectedEmployeeId, {
          periodStart: range.start,
          periodEnd: range.end,
          page: state.scoredPage,
          pageSize: SCORED_PAGE_SIZE,
          signal: controller.signal
        });
        if (controller.signal.aborted) {
          return;
        }
        renderScored(result);
      } catch (error) {
        if (isAbort(error)) {
          return;
        }
        setSectionState(refs.scoredState, refs.scoredContent, "error", "Không tải được danh sách tivi tính điểm.", "scored");
      }
    }

    async function loadDetail() {
      if (!state.selectedEmployeeId) {
        return;
      }
      const controller = abort("detail");
      const row = selectedRow();
      refs.detailTitle.textContent = `Chi tiết thành tích của ${row ? row.full_name : "nhân viên"}`;
      refs.explain.disabled = true;
      setSectionState(refs.detailState, refs.detailContent, "loading", "Đang tải chi tiết thành tích...");
      try {
        const range = monthRange(state.month);
        const detail = await api.getEmployeeAwardDetail(state.selectedEmployeeId, {
          periodStart: range.start,
          periodEnd: range.end,
          signal: controller.signal
        });
        if (controller.signal.aborted) {
          return;
        }
        renderDetail(detail || {});
      } catch (error) {
        if (isAbort(error)) {
          return;
        }
        setSectionState(refs.detailState, refs.detailContent, "error", "Không tải được chi tiết thành tích nhân viên.", "detail");
      }
    }

    async function selectEmployee(employeeId, options) {
      const selectionOptions = options || {};
      const id = String(employeeId || "");
      if (!id) {
        return;
      }
      state.selectedEmployeeId = id;
      state.scoredPage = 1;
      updatePodiumSelection();
      if (!selectionOptions.fromHistory) {
        writeSelectedEmployee(Boolean(selectionOptions.replace));
      }
      await Promise.allSettled([loadDetail(), loadScored(1)]);
      if (selectionOptions.scroll) {
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const target = selectionOptions.scroll === "tickets"
          ? byId("employeeScoredWorkTitle")
          : byId("employeeRecognitionDetailTitle");
        target.scrollIntoView({
          behavior: reduceMotion ? "auto" : "smooth",
          block: "start"
        });
      }
    }

    function renderDrawer() {
      refs.drawerContent.replaceChildren();
      if (!state.detail) {
        refs.drawerContent.appendChild(element("p", "employee-recognition-empty-copy", "Chưa có dữ liệu để giải thích."));
        return;
      }
      const row = state.detail.summary;
      const intro = element("section", "employee-calculation-summary");
      intro.append(
        element("h4", "", row.full_name || "Nhân viên"),
        element("p", "", `${formatNumber(row.completed_count, " tivi")} tạo ra ${formatPoints(row.weighted_work_points)} trong kỳ.`),
        statusBadge(row)
      );
      const formula = element("section", "employee-calculation-formula");
      formula.append(
        element("h4", "", "Công thức đang áp dụng"),
        element("p", "", "Điểm từng tivi = hệ số kích thước × hệ số độ khó."),
        element("p", "", "KPI đầy đủ = sản lượng quy đổi × tỷ trọng sản lượng + chất lượng × tỷ trọng chất lượng + tiến độ × tỷ trọng tiến độ."),
        element("small", "", "Khi chất lượng hoặc tiến độ chưa đủ dữ liệu, hệ thống không tự coi là 0 và hiển thị KPI tạm tính.")
      );
      const tieBreak = element("section", "employee-calculation-tiebreak");
      tieBreak.append(
        element("h4", "", "Thứ tự xếp hạng"),
        element("p", "", "KPI tổng → điểm quy đổi → chất lượng → tiến độ → số tivi → mã nhân viên. Ở kỳ tạm tính, điểm quy đổi là tiêu chí chính và mã nhân viên giữ thứ tự ổn định khi hòa điểm.")
      );
      const tickets = element("section", "employee-calculation-ticket-list");
      tickets.appendChild(element("h4", "", "Công việc trên trang đang xem"));
      state.scoredRows.forEach((ticket) => {
        tickets.appendChild(element(
          "p",
          "",
          `${api.formatTicketCode(ticket.ticket_code)}: ${kpi.formatWorkPoints(ticket.size_weight)} × ${kpi.formatWorkPoints(ticket.complexity_weight)} = ${formatPoints(ticket.final_work_points)}`
        ));
      });
      const rule = element("p", "employee-calculation-rule", `Rule version: ${row.rule_version || "Chưa xác định"}`);
      refs.drawerContent.append(intro, formula, tieBreak, tickets, rule);
    }

    function openDrawer(trigger) {
      state.returnFocus = trigger instanceof HTMLElement ? trigger : document.activeElement;
      renderDrawer();
      refs.drawerBackdrop.hidden = false;
      refs.drawer.hidden = false;
      document.body.classList.add("employee-calculation-open");
      refs.drawerClose.focus({ preventScroll: true });
    }

    function closeDrawer() {
      refs.drawer.hidden = true;
      refs.drawerBackdrop.hidden = true;
      document.body.classList.remove("employee-calculation-open");
      if (state.returnFocus && document.contains(state.returnFocus)) {
        state.returnFocus.focus({ preventScroll: true });
      }
      state.returnFocus = null;
    }

    async function showAdjustments(snapshotId, trigger) {
      openDrawer(trigger);
      const section = element("section", "employee-calculation-adjustments");
      section.appendChild(element("h4", "", "Lịch sử điều chỉnh"));
      const status = element("p", "", "Đang tải lịch sử điều chỉnh...");
      section.appendChild(status);
      refs.drawerContent.appendChild(section);
      const controller = abort("adjustments");
      try {
        const rows = await api.getWorkPointAdjustments(snapshotId, { signal: controller.signal });
        if (controller.signal.aborted) {
          return;
        }
        status.remove();
        if (rows.length === 0) {
          section.appendChild(element("p", "employee-recognition-empty-copy", "Không có bản ghi điều chỉnh."));
          return;
        }
        rows.forEach((row) => {
          const item = element("article");
          item.append(
            element("strong", "", row.reason || "Điều chỉnh điểm"),
            element("span", "", `${row.adjusted_by_name || "Người quản lý"} · ${kpi.formatDateTime(row.adjusted_at)}`),
            element("code", "", `${formatPoints(safeObject(row.previous_values).final_work_points)} → ${formatPoints(safeObject(row.new_values).final_work_points)}`)
          );
          section.appendChild(item);
        });
      } catch (error) {
        if (!isAbort(error)) {
          status.textContent = "Không tải được lịch sử điều chỉnh.";
        }
      }
    }

    async function load(options) {
      const loadOptions = options || {};
      const version = ++state.loadVersion;
      const requestedMonth = loadOptions.month || refs.month.value || state.month || currentMonth();
      state.month = monthRange(requestedMonth).month;
      refs.month.value = state.month;
      refs.periodLabel.textContent = monthLabel(state.month);
      document.querySelectorAll("[data-recognition-month]").forEach((button) => {
        const target = button.dataset.recognitionMonth === "previous"
          ? previousMonth(currentMonth())
          : currentMonth();
        button.classList.toggle("is-active", target === state.month);
        button.setAttribute("aria-pressed", target === state.month ? "true" : "false");
      });
      const range = monthRange(state.month);
      const podiumController = abort("podium");
      const reportController = abort("report");
      const historyController = abort("history");
      setSectionState(refs.podiumState, refs.podium, "loading", "Đang tải sân khấu vinh danh...");
      setSectionState(refs.reportState, refs.reportContent, "loading", "Đang tải báo cáo hiệu suất tháng...");
      setSectionState(refs.historyState, refs.historyContent, "loading", "Đang tải lịch sử vinh danh...");

      const [podiumResult, reportResult, historyResult] = await Promise.allSettled([
        api.getEmployeeAwardPodium({
          periodStart: range.start,
          periodEnd: range.end,
          signal: podiumController.signal
        }),
        api.getMonthlyTeamPerformance({
          periodStart: range.start,
          periodEnd: range.end,
          signal: reportController.signal
        }),
        api.getEmployeeAwards({
          page: 1,
          pageSize: HISTORY_PAGE_SIZE,
          signal: historyController.signal
        })
      ]);
      if (version !== state.loadVersion) {
        return;
      }

      if (podiumResult.status === "fulfilled") {
        state.podium = Array.isArray(podiumResult.value) ? podiumResult.value : [];
        renderPodium(state.podium);
      } else if (!isAbort(podiumResult.reason)) {
        state.podium = [];
        setSectionState(refs.podiumState, refs.podium, "error", "Không tải được sân khấu vinh danh.", "all");
      }

      if (reportResult.status === "fulfilled") {
        renderReport(reportResult.value || {});
      } else if (!isAbort(reportResult.reason)) {
        state.report = null;
        state.ranking = [];
        setSectionState(refs.reportState, refs.reportContent, "error", "Không tải được báo cáo hiệu suất tháng.", "report");
      }

      if (historyResult.status === "fulfilled") {
        renderHistory(historyResult.value.rows || []);
      } else if (!isAbort(historyResult.reason)) {
        setSectionState(refs.historyState, refs.historyContent, "error", "Không tải được lịch sử vinh danh.", "history");
      }

      const requestedEmployee = new URL(window.location.href).searchParams.get("awardEmployee");
      const candidates = state.ranking.length > 0 ? state.ranking : state.podium;
      const selected = candidates.find((row) => row.employee_id === requestedEmployee)
        || candidates[0]
        || null;
      if (selected) {
        await selectEmployee(selected.employee_id, { replace: !requestedEmployee });
      } else {
        state.selectedEmployeeId = "";
        refs.explain.disabled = true;
        setSectionState(refs.detailState, refs.detailContent, "empty", "Chưa có nhân viên đủ dữ liệu để xem thành tích.");
      }
    }

    function handleClick(event) {
      const podium = event.target.closest("[data-recognition-employee]");
      if (podium) {
        selectEmployee(podium.dataset.recognitionEmployee).catch(() => {});
        return;
      }
      const select = event.target.closest("[data-recognition-select]");
      if (select) {
        selectEmployee(select.dataset.recognitionSelect, { scroll: true }).catch(() => {});
        return;
      }
      const tickets = event.target.closest("[data-recognition-tickets]");
      if (tickets) {
        selectEmployee(tickets.dataset.recognitionTickets, { scroll: "tickets" }).catch(() => {});
        return;
      }
      const profile = event.target.closest("[data-recognition-profile]");
      if (profile && typeof settings.onOpenProfile === "function") {
        settings.onOpenProfile(profile.dataset.recognitionProfile);
        return;
      }
      const page = event.target.closest("[data-scored-page]");
      if (page && !page.disabled) {
        loadScored(Number(page.dataset.scoredPage)).catch(() => {});
        return;
      }
      const rankingPage = event.target.closest("[data-ranking-page]");
      if (rankingPage && !rankingPage.disabled) {
        state.rankingPage = Number(rankingPage.dataset.rankingPage) || 1;
        renderFullRanking(state.ranking);
        return;
      }
      const retry = event.target.closest("[data-recognition-retry]");
      if (retry) {
        const key = retry.dataset.recognitionRetry;
        if (key === "detail") {
          loadDetail().catch(() => {});
        } else if (key === "scored") {
          loadScored(state.scoredPage).catch(() => {});
        } else {
          load().catch(() => {});
        }
        return;
      }
      const adjustment = event.target.closest("[data-recognition-adjustments]");
      if (adjustment) {
        showAdjustments(adjustment.dataset.recognitionAdjustments, adjustment).catch(() => {});
        return;
      }
      const adjust = event.target.closest("[data-recognition-adjust]");
      if (adjust && typeof settings.onAdjustPoints === "function") {
        const row = state.scoredRowsById.get(String(adjust.dataset.recognitionAdjust || ""));
        if (row) {
          settings.onAdjustPoints(row, adjust, async () => {
            await Promise.allSettled([loadDetail(), loadScored(state.scoredPage), load({ month: state.month })]);
          });
        }
        return;
      }
      const rankingRow = event.target.closest("[data-recognition-row]");
      if (rankingRow) {
        selectEmployee(rankingRow.dataset.recognitionRow, { scroll: true }).catch(() => {});
      }
    }

    function handleKeydown(event) {
      const row = event.target.closest("[data-recognition-row]");
      if (!row || (event.key !== "Enter" && event.key !== " ")) {
        return;
      }
      event.preventDefault();
      selectEmployee(row.dataset.recognitionRow, { scroll: true }).catch(() => {});
    }

    function trapDrawerFocus(event) {
      if (refs.drawer.hidden || event.key !== "Tab") {
        return;
      }
      const focusable = Array.from(refs.drawer.querySelectorAll(
        "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
      ));
      if (focusable.length === 0) {
        event.preventDefault();
        refs.drawer.focus({ preventScroll: true });
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

    function bind() {
      if (state.bound) {
        return;
      }
      state.bound = true;
      root.addEventListener("click", handleClick);
      root.addEventListener("keydown", handleKeydown);
      refs.month.addEventListener("change", () => load({ month: refs.month.value }).catch(() => {}));
      refs.refresh.addEventListener("click", () => load().catch(() => {}));
      document.querySelectorAll("[data-recognition-month]").forEach((button) => {
        button.addEventListener("click", () => {
          const month = button.dataset.recognitionMonth === "previous"
            ? previousMonth(currentMonth())
            : currentMonth();
          load({ month }).catch(() => {});
        });
      });
      refs.explain.addEventListener("click", (event) => openDrawer(event.currentTarget));
      refs.drawerClose.addEventListener("click", closeDrawer);
      refs.drawerBackdrop.addEventListener("click", closeDrawer);
      document.addEventListener("keydown", (event) => {
        if (refs.drawer.hidden) {
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          closeDrawer();
        } else {
          trapDrawerFocus(event);
        }
      });
      window.addEventListener("popstate", () => {
        const selected = new URL(window.location.href).searchParams.get("awardEmployee");
        if (selected && selected !== state.selectedEmployeeId) {
          selectEmployee(selected, { fromHistory: true }).catch(() => {});
        }
      });
    }

    bind();
    return Object.freeze({
      load,
      refresh: load,
      getSelectedEmployeeId: () => state.selectedEmployeeId
    });
  }

  window.AMEmployeeRecognition = Object.freeze({ create });
})();

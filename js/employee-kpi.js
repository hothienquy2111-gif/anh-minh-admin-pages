(function () {
  "use strict";

  const TIME_ZONE = "Asia/Ho_Chi_Minh";
  const VIETNAM_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const DISPLAY_DATE_FORMATTER = new Intl.DateTimeFormat("vi-VN", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
  const DISPLAY_DATETIME_FORMATTER = new Intl.DateTimeFormat("vi-VN", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
  const NUMBER_FORMATTER = new Intl.NumberFormat("vi-VN");
  const MONEY_FORMATTER = new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  });

  function dateOnly(value) {
    const text = String(value || "").trim();
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!match) {
      return null;
    }

    return new Date(Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3])
    ));
  }

  function toIsoDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return "";
    }

    return date.toISOString().slice(0, 10);
  }

  function todayIso() {
    const parts = VIETNAM_DATE_FORMATTER.formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function addDays(isoDate, amount) {
    const date = dateOnly(isoDate);

    if (!date) {
      return "";
    }

    date.setUTCDate(date.getUTCDate() + Number(amount || 0));
    return toIsoDate(date);
  }

  function startOfMonth(isoDate) {
    const date = dateOnly(isoDate);

    if (!date) {
      return "";
    }

    date.setUTCDate(1);
    return toIsoDate(date);
  }

  function endOfMonth(isoDate) {
    const date = dateOnly(isoDate);

    if (!date) {
      return "";
    }

    date.setUTCMonth(date.getUTCMonth() + 1, 0);
    return toIsoDate(date);
  }

  function startOfWeek(isoDate) {
    const date = dateOnly(isoDate);

    if (!date) {
      return "";
    }

    const day = date.getUTCDay();
    const offset = day === 0 ? -6 : 1 - day;
    date.setUTCDate(date.getUTCDate() + offset);
    return toIsoDate(date);
  }

  function periodRange(key, customStart, customEnd) {
    const today = todayIso();
    const normalized = String(key || "this-month").trim().toLowerCase();

    if (normalized === "today") {
      return { key: normalized, start: today, end: today, label: "Hôm nay" };
    }

    if (normalized === "7-days") {
      return { key: normalized, start: addDays(today, -6), end: today, label: "7 ngày" };
    }

    if (normalized === "30-days") {
      return { key: normalized, start: addDays(today, -29), end: today, label: "30 ngày" };
    }

    if (normalized === "previous-month") {
      const previous = addDays(startOfMonth(today), -1);
      return {
        key: normalized,
        start: startOfMonth(previous),
        end: endOfMonth(previous),
        label: "Tháng trước"
      };
    }

    if (normalized === "custom") {
      const start = String(customStart || "").trim();
      const end = String(customEnd || "").trim();

      if (!dateOnly(start) || !dateOnly(end) || start > end) {
        throw new Error("Khoảng thời gian tùy chỉnh không hợp lệ.");
      }

      return { key: normalized, start, end, label: "Tùy chỉnh" };
    }

    return {
      key: "this-month",
      start: startOfMonth(today),
      end: today,
      label: "Tháng này"
    };
  }

  function number(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : (fallback === undefined ? 0 : fallback);
  }

  function formatNumber(value) {
    return NUMBER_FORMATTER.format(number(value));
  }

  function formatWorkPoints(value) {
    const parsed = fieldNumber({ value }, ["value"], null);
    return parsed === null
      ? "Chưa có dữ liệu"
      : parsed.toLocaleString("vi-VN", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      });
  }

  function calculateWorkPoints(sizeWeight, complexityWeight) {
    const size = Number(sizeWeight);
    const complexity = Number(complexityWeight);

    if (!Number.isFinite(size) || size <= 0
      || !Number.isFinite(complexity) || complexity <= 0) {
      return null;
    }

    return Number((size * complexity).toFixed(6));
  }

  function calculateExplainableOverallKpi(record, weights) {
    const row = record || {};
    const configured = weights || {};
    const productivity = fieldNumber(row, ["productivity_score"], null);
    const quality = fieldNumber(row, ["quality_score"], null);
    const progress = fieldNumber(row, ["on_time_score", "progress_score"], null);
    const missing = [];

    if (quality === null) {
      missing.push("quality");
    }
    if (progress === null) {
      missing.push("progress");
    }

    if (productivity === null) {
      return { score: null, status: "insufficient_data", missing };
    }

    if (missing.length > 0) {
      return { score: productivity, status: "provisional", missing };
    }

    const productivityWeight = fieldNumber(
      configured,
      ["productivity_weight"],
      null
    );
    const qualityWeight = fieldNumber(configured, ["quality_weight"], null);
    const progressWeight = fieldNumber(configured, ["progress_weight"], null);
    if (productivityWeight === null || qualityWeight === null || progressWeight === null
      || productivityWeight + qualityWeight + progressWeight !== 100) {
      return { score: null, status: "invalid_rule", missing: [] };
    }

    return {
      score: Math.round((
        productivity * productivityWeight / 100
        + quality * qualityWeight / 100
        + progress * progressWeight / 100
      ) * 100) / 100,
      status: "official",
      missing: []
    };
  }

  function formatPercent(value) {
    const parsed = number(value, null);
    return parsed === null ? "—" : `${parsed.toLocaleString("vi-VN", {
      maximumFractionDigits: 1
    })}%`;
  }

  function formatHours(value) {
    const hours = number(value, null);

    if (hours === null) {
      return "—";
    }

    if (hours < 1) {
      return `${Math.max(Math.round(hours * 60), 0)} phút`;
    }

    if (hours < 24) {
      return `${hours.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} giờ`;
    }

    const days = Math.floor(hours / 24);
    const remainingHours = Math.round(hours % 24);
    return remainingHours > 0 ? `${days} ngày ${remainingHours} giờ` : `${days} ngày`;
  }

  function formatPerformanceDuration(value) {
    const parsed = number(value, null);

    if (parsed === null || parsed <= 0) {
      return "Chưa có dữ liệu";
    }

    const totalMinutes = Math.max(Math.round(parsed), 1);
    if (totalMinutes < 60) {
      return `${totalMinutes} phút`;
    }

    if (totalMinutes < 1440) {
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      return minutes > 0 ? `${hours} giờ ${minutes} phút` : `${hours} giờ`;
    }

    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    return hours > 0 ? `${days} ngày ${hours} giờ` : `${days} ngày`;
  }

  function formatMoney(value) {
    const parsed = number(value, null);
    return parsed === null ? "Chưa cấu hình" : MONEY_FORMATTER.format(parsed);
  }

  function formatDate(value) {
    const text = String(value || "").trim();

    if (!text) {
      return "—";
    }

    const date = dateOnly(text.slice(0, 10));
    return date ? DISPLAY_DATE_FORMATTER.format(date) : text;
  }

  function formatDateTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : DISPLAY_DATETIME_FORMATTER.format(date);
  }

  function getInitials(value) {
    const words = String(value || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (words.length === 0) {
      return "NV";
    }

    return `${words[0][0] || ""}${words.length > 1 ? words[words.length - 1][0] || "" : ""}`
      .toLocaleUpperCase("vi-VN");
  }

  function calculateKpiScore(record) {
    const row = record || {};
    const targetCompleted = number(row.target_completed_tickets, null);
    const targetRate = number(row.target_completion_rate, null);

    if (!targetCompleted || !targetRate) {
      return null;
    }

    const completedWeight = number(row.weight_completed, 60);
    const rateWeight = number(row.weight_completion_rate, 40);
    const hoursWeight = number(row.weight_average_hours, 0);
    const completedComponent = Math.min(number(row.completed_in_period) / targetCompleted, 1.2)
      * completedWeight;
    const rateComponent = Math.min(number(row.completion_rate) / targetRate, 1.2)
      * rateWeight;
    const targetHours = number(row.target_average_hours, null);
    const averageHours = number(row.average_repair_hours, null);
    const hoursComponent = hoursWeight === 0
      ? 0
      : targetHours && averageHours
        ? Math.min(targetHours / averageHours, 1.2) * hoursWeight
        : 0;

    return Math.round((completedComponent + rateComponent + hoursComponent) * 100) / 100;
  }

  function calculateBonusPreview(record) {
    const row = record || {};
    const target = number(row.target_completed_tickets, null);

    if (!target) {
      return null;
    }

    const base = number(row.bonus_base);
    const perTicket = number(row.bonus_per_ticket);
    const maximum = number(row.maximum_bonus, Number.POSITIVE_INFINITY);
    const extra = Math.max(number(row.completed_in_period) - target, 0);
    return Math.min(base + extra * perTicket, maximum);
  }

  function compareMetric(current, previous, options) {
    const settings = options || {};
    const currentValue = number(current, null);
    const previousValue = number(previous, null);

    if (currentValue === null || previousValue === null) {
      return { direction: "neutral", text: "Chưa đủ dữ liệu kỳ trước" };
    }

    if (previousValue === 0) {
      return currentValue === 0
        ? { direction: "neutral", text: "Không đổi so với kỳ trước" }
        : { direction: settings.inverse ? "down" : "up", text: `Tăng ${formatNumber(currentValue)}` };
    }

    const percent = Math.abs((currentValue - previousValue) / previousValue * 100);
    const increased = currentValue > previousValue;
    const direction = currentValue === previousValue
      ? "neutral"
      : (increased !== Boolean(settings.inverse) ? "up" : "down");
    const verb = currentValue === previousValue ? "Không đổi" : increased ? "Tăng" : "Giảm";
    return {
      direction,
      text: currentValue === previousValue
        ? "Không đổi so với kỳ trước"
        : `${verb} ${percent.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`
    };
  }

  function fieldNumber(record, names, fallback) {
    const row = record || {};

    for (const name of names) {
      const value = row[name];
      if (value === null || value === undefined || String(value).trim() === "") {
        continue;
      }
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return fallback;
  }

  function normalizeLeaderboardRow(record) {
    const row = record || {};
    const averageMinutes = fieldNumber(row, ["average_repair_minutes"], null);
    const averageHours = fieldNumber(row, ["average_repair_hours", "average_hours"], null);
    const normalizedAverageMinutes = averageMinutes && averageMinutes > 0
      ? averageMinutes
      : averageHours && averageHours > 0
        ? averageHours * 60
        : null;
    const target = fieldNumber(row, ["target_completed_tickets"], null);

    return Object.assign({}, row, {
      employee_id: String(row.employee_id || row.id || ""),
      assigned_count: Math.max(fieldNumber(row, ["assigned_count", "assigned_in_period", "assigned"], 0), 0),
      completed_count: Math.max(fieldNumber(row, ["completed_count", "completed_in_period", "completed"], 0), 0),
      completion_rate: Math.max(fieldNumber(row, ["completion_rate"], 0), 0),
      average_repair_minutes: normalizedAverageMinutes,
      active_assignments: Math.max(fieldNumber(row, ["active_assignments", "active_assignment_count", "in_progress_count"], 0), 0),
      target_completed_tickets: target && target > 0 ? target : null,
      previous_completed_count: fieldNumber(row, ["previous_completed_count", "previous_completed_in_period", "previous_completed"], null)
    });
  }

  function hasLeaderboardData(record) {
    const row = normalizeLeaderboardRow(record);
    return row.assigned_count > 0
      || row.completed_count > 0
      || row.completion_rate > 0
      || (row.average_repair_minutes !== null && row.average_repair_minutes > 0);
  }

  function normalizeWeightedRankingRow(record) {
    const row = record || {};
    return Object.assign({}, row, {
      employee_id: String(row.employee_id || row.id || ""),
      employee_code: String(row.employee_code || ""),
      completed_count: Math.max(fieldNumber(
        row,
        ["completed_count", "completed_in_period", "completed"],
        0
      ), 0),
      weighted_work_points: Math.max(fieldNumber(
        row,
        ["weighted_work_points", "work_points"],
        0
      ), 0),
      quality_score: fieldNumber(row, ["quality_score"], null),
      on_time_score: fieldNumber(row, ["on_time_score", "progress_score"], null),
      overall_kpi_score: fieldNumber(row, ["overall_kpi_score", "kpi_score"], null),
      scoring_status: String(row.scoring_status || "provisional")
    });
  }

  function hasWeightedRankingData(record) {
    const row = normalizeWeightedRankingRow(record);
    return row.completed_count > 0 || row.weighted_work_points > 0;
  }

  function rankWeightedPerformance(rows) {
    const prepared = (Array.isArray(rows) ? rows : [])
      .map(normalizeWeightedRankingRow)
      .filter(hasWeightedRankingData);
    const provisionalSort = prepared.some((row) => (
      row.scoring_status !== "official"
      || row.quality_score === null
      || row.on_time_score === null
    ));
    const compareNullableDescending = (leftValue, rightValue) => {
      if (leftValue === null && rightValue === null) {
        return 0;
      }
      if (leftValue === null) {
        return 1;
      }
      if (rightValue === null) {
        return -1;
      }
      return rightValue - leftValue;
    };

    return prepared.sort((left, right) => {
      const primaryDifference = provisionalSort
        ? right.weighted_work_points - left.weighted_work_points
        : compareNullableDescending(left.overall_kpi_score, right.overall_kpi_score);
      if (primaryDifference !== 0) {
        return primaryDifference;
      }

      const pointsDifference = right.weighted_work_points - left.weighted_work_points;
      if (pointsDifference !== 0) {
        return pointsDifference;
      }

      const qualityDifference = compareNullableDescending(left.quality_score, right.quality_score);
      if (qualityDifference !== 0) {
        return qualityDifference;
      }

      const progressDifference = compareNullableDescending(left.on_time_score, right.on_time_score);
      if (progressDifference !== 0) {
        return progressDifference;
      }

      if (!provisionalSort) {
        const completedDifference = right.completed_count - left.completed_count;
        if (completedDifference !== 0) {
          return completedDifference;
        }
      }

      const codeDifference = left.employee_code.localeCompare(
        right.employee_code,
        "vi",
        { numeric: true }
      );
      return codeDifference !== 0
        ? codeDifference
        : left.employee_id.localeCompare(right.employee_id, "vi", { numeric: true });
    });
  }

  function rankEmployeePerformance(rows) {
    return (Array.isArray(rows) ? rows : [])
      .map(normalizeLeaderboardRow)
      .filter(hasLeaderboardData)
      .sort((left, right) => {
        const completedDifference = right.completed_count - left.completed_count;
        if (completedDifference !== 0) {
          return completedDifference;
        }

        const rateDifference = right.completion_rate - left.completion_rate;
        if (rateDifference !== 0) {
          return rateDifference;
        }

        const leftMinutes = left.average_repair_minutes && left.average_repair_minutes > 0
          ? left.average_repair_minutes
          : Number.POSITIVE_INFINITY;
        const rightMinutes = right.average_repair_minutes && right.average_repair_minutes > 0
          ? right.average_repair_minutes
          : Number.POSITIVE_INFINITY;
        if (leftMinutes !== rightMinutes) {
          return leftMinutes - rightMinutes;
        }

        const assignedDifference = right.assigned_count - left.assigned_count;
        if (assignedDifference !== 0) {
          return assignedDifference;
        }

        const codeDifference = String(left.employee_code || "")
          .localeCompare(String(right.employee_code || ""), "vi", { numeric: true });
        if (codeDifference !== 0) {
          return codeDifference;
        }

        return String(left.employee_id || "")
          .localeCompare(String(right.employee_id || ""), "vi", { numeric: true });
      });
  }

  function stableLeaderboard(rows) {
    return (rows || []).slice().sort((left, right) => {
      const scoreDifference = number(right.kpi_score, -1) - number(left.kpi_score, -1);
      const completedDifference = number(right.completed_in_period || right.completed)
        - number(left.completed_in_period || left.completed);
      const hoursLeft = number(left.average_repair_hours || left.average_hours, Number.POSITIVE_INFINITY);
      const hoursRight = number(right.average_repair_hours || right.average_hours, Number.POSITIVE_INFINITY);

      if (scoreDifference !== 0) {
        return scoreDifference;
      }

      if (completedDifference !== 0) {
        return completedDifference;
      }

      if (hoursLeft !== hoursRight) {
        return hoursLeft - hoursRight;
      }

      return String(left.employee_code || left.full_name || left.employee_id || "")
        .localeCompare(
          String(right.employee_code || right.full_name || right.employee_id || ""),
          "vi"
        );
    });
  }

  function splitDailySeries(rows) {
    const series = Array.isArray(rows) ? rows : [];
    return {
      current: series.filter((item) => item && item.period === "current"),
      previous: series.filter((item) => item && item.period === "previous")
    };
  }

  window.AMEmployeeKpi = Object.freeze({
    TIME_ZONE,
    addDays,
    calculateBonusPreview,
    calculateExplainableOverallKpi,
    calculateKpiScore,
    calculateWorkPoints,
    compareMetric,
    dateOnly,
    endOfMonth,
    formatDate,
    formatDateTime,
    formatHours,
    formatPerformanceDuration,
    formatMoney,
    formatNumber,
    formatPercent,
    formatWorkPoints,
    getInitials,
    periodRange,
    rankWeightedPerformance,
    rankEmployeePerformance,
    normalizeLeaderboardRow,
    hasLeaderboardData,
    hasWeightedRankingData,
    normalizeWeightedRankingRow,
    splitDailySeries,
    stableLeaderboard,
    startOfMonth,
    startOfWeek,
    todayIso
  });
})();

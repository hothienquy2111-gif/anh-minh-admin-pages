(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const COLORS = Object.freeze({
    current: "#0f2d52",
    previous: "#9fb5cf",
    assigned: "#2f6feb",
    completed: "#16855b",
    active: "#2f6feb",
    handover: "#d98b16",
    unassigned: "#b4232c",
    neutral: "#8091a7"
  });

  function svgElement(name, attributes) {
    const element = document.createElementNS(SVG_NS, name);
    Object.entries(attributes || {}).forEach(([key, value]) => {
      element.setAttribute(key, String(value));
    });
    return element;
  }

  function clear(container) {
    if (!container) {
      return;
    }

    container.replaceChildren();
    container.removeAttribute("data-chart-rendered");
  }

  function createSvg(container, title, description, viewBox) {
    clear(container);
    const svg = svgElement("svg", {
      viewBox,
      role: "img",
      "aria-labelledby": `${container.id}Title ${container.id}Description`,
      preserveAspectRatio: "xMidYMid meet"
    });
    const titleElement = svgElement("title", { id: `${container.id}Title` });
    const descriptionElement = svgElement("desc", { id: `${container.id}Description` });
    titleElement.textContent = title;
    descriptionElement.textContent = description;
    svg.append(titleElement, descriptionElement);
    container.appendChild(svg);
    container.dataset.chartRendered = "true";
    return svg;
  }

  function appendText(svg, text, x, y, className, anchor) {
    const element = svgElement("text", {
      x,
      y,
      class: className || "",
      "text-anchor": anchor || "start"
    });
    element.textContent = text;
    svg.appendChild(element);
    return element;
  }

  function appendTooltip(element, text) {
    const title = svgElement("title");
    title.textContent = text;
    element.appendChild(title);
  }

  function weekdayLabel(value) {
    const date = new Date(`${String(value || "").slice(0, 10)}T00:00:00+07:00`);
    return Number.isNaN(date.getTime())
      ? "—"
      : new Intl.DateTimeFormat("vi-VN", {
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        timeZone: "Asia/Ho_Chi_Minh"
      }).format(date);
  }

  function compactDateLabel(value) {
    const date = new Date(`${String(value || "").slice(0, 10)}T00:00:00+07:00`);
    return Number.isNaN(date.getTime())
      ? "—"
      : new Intl.DateTimeFormat("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        timeZone: "Asia/Ho_Chi_Minh"
      }).format(date);
  }

  function axisLabelStride(length, maximumLabels) {
    return Math.max(Math.ceil(Math.max(Number(length) || 0, 1) / (maximumLabels || 8)), 1);
  }

  function alignDailySeries(series) {
    const current = Array.isArray(series && series.current) ? series.current : [];
    const previous = Array.isArray(series && series.previous) ? series.previous : [];
    const length = Math.max(current.length, previous.length);

    return Array.from({ length }, (_, index) => ({
      current: current[index] || null,
      previous: previous[index] || null
    }));
  }

  function renderWeeklyComparison(container, series) {
    if (!container) {
      return false;
    }

    const rows = alignDailySeries(series);

    if (rows.length === 0) {
      clear(container);
      return false;
    }

    const width = 760;
    const height = 300;
    const left = 48;
    const right = 18;
    const top = 24;
    const bottom = 52;
    const innerWidth = width - left - right;
    const innerHeight = height - top - bottom;
    const maxValue = Math.max(
      1,
      ...rows.flatMap((row) => [
        Number(row.current && row.current.completed) || 0,
        Number(row.previous && row.previous.completed) || 0
      ])
    );
    const tickCount = Math.min(Math.max(maxValue, 2), 5);
    const groupWidth = innerWidth / Math.max(rows.length, 1);
    const barWidth = Math.min(groupWidth * 0.28, 24);
    const labelStride = axisLabelStride(rows.length, 8);
    const svg = createSvg(
      container,
      "Hiệu suất hoàn thành theo ngày",
      "So sánh số tivi hoàn thành trong kỳ hiện tại và kỳ liền trước.",
      `0 0 ${width} ${height}`
    );

    for (let tick = 0; tick <= tickCount; tick += 1) {
      const value = Math.round(maxValue * tick / tickCount);
      const y = top + innerHeight - (value / maxValue) * innerHeight;
      const line = svgElement("line", {
        x1: left,
        x2: width - right,
        y1: y,
        y2: y,
        class: "employee-chart-grid-line"
      });
      svg.appendChild(line);
      appendText(svg, String(value), left - 10, y + 4, "employee-chart-axis", "end");
    }

    rows.forEach((row, index) => {
      const center = left + groupWidth * index + groupWidth / 2;
      const previousValue = Number(row.previous && row.previous.completed) || 0;
      const currentValue = Number(row.current && row.current.completed) || 0;
      const previousHeight = previousValue / maxValue * innerHeight;
      const currentHeight = currentValue / maxValue * innerHeight;
      const previousBar = svgElement("rect", {
        x: center - barWidth - 2,
        y: top + innerHeight - previousHeight,
        width: barWidth,
        height: Math.max(previousHeight, previousValue > 0 ? 2 : 0),
        rx: 3,
        fill: COLORS.previous,
        class: "employee-chart-bar"
      });
      const currentBar = svgElement("rect", {
        x: center + 2,
        y: top + innerHeight - currentHeight,
        width: barWidth,
        height: Math.max(currentHeight, currentValue > 0 ? 2 : 0),
        rx: 3,
        fill: COLORS.current,
        class: "employee-chart-bar"
      });
      const dateLabel = weekdayLabel((row.current || row.previous || {}).date);

      appendTooltip(previousBar, `${dateLabel} · Kỳ trước: ${previousValue} tivi`);
      appendTooltip(currentBar, `${dateLabel} · Kỳ hiện tại: ${currentValue} tivi`);
      svg.append(previousBar, currentBar);
      if (index % labelStride === 0) {
        appendText(
          svg,
          compactDateLabel((row.current || row.previous || {}).date),
          center,
          height - 22,
          "employee-chart-axis employee-chart-axis--x",
          "middle"
        );
      }
    });

    return true;
  }

  function renderWorkDistribution(container, items) {
    if (!container) {
      return false;
    }

    const rows = (Array.isArray(items) ? items : [])
      .map((item) => Object.assign({}, item, { value: Math.max(Number(item && item.value) || 0, 0) }))
      .filter((item) => item.key && item.label);
    const total = rows.reduce((sum, item) => sum + item.value, 0);

    if (rows.length === 0) {
      clear(container);
      return false;
    }

    const width = 520;
    const height = 220;
    const svg = createSvg(
      container,
      "Phân bổ công việc",
      `Tổng số nhóm công việc đang theo dõi: ${total}.`,
      `0 0 ${width} ${height}`
    );
    const barX = 24;
    const barY = 38;
    const barWidth = width - 48;
    const barHeight = 34;
    let cursor = barX;

    rows.forEach((item) => {
      const segmentWidth = total > 0 ? item.value / total * barWidth : barWidth / rows.length;
      const rect = svgElement("rect", {
        x: cursor,
        y: barY,
        width: Math.max(segmentWidth, 0),
        height: barHeight,
        fill: COLORS[item.key] || COLORS.neutral,
        class: "employee-chart-segment"
      });
      appendTooltip(rect, `${item.label}: ${item.value}`);
      svg.appendChild(rect);
      cursor += segmentWidth;
    });

    rows.forEach((item, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = 28 + column * 246;
      const y = 112 + row * 38;
      const swatch = svgElement("rect", {
        x,
        y: y - 12,
        width: 12,
        height: 12,
        rx: 3,
        fill: COLORS[item.key] || COLORS.neutral
      });
      svg.appendChild(swatch);
      appendText(svg, item.label, x + 22, y - 2, "employee-chart-legend");
      appendText(svg, String(item.value), x + 220, y - 2, "employee-chart-legend-value", "end");
    });

    return true;
  }

  function renderTrend(container, rows, options) {
    if (!container) {
      return false;
    }

    const settings = options || {};
    const data = Array.isArray(rows) ? rows : [];

    if (data.length === 0) {
      clear(container);
      return false;
    }

    const width = 760;
    const height = 280;
    const left = 50;
    const right = 20;
    const top = 24;
    const bottom = 48;
    const innerWidth = width - left - right;
    const innerHeight = height - top - bottom;
    const valueKey = settings.valueKey || "completed";
    const values = data.map((item) => Math.max(Number(item && item[valueKey]) || 0, 0));
    const maxValue = Math.max(1, ...values);
    const labelStride = axisLabelStride(data.length, 8);
    const svg = createSvg(
      container,
      settings.title || "Xu hướng hiệu suất",
      settings.description || "Biểu đồ xu hướng theo thời gian.",
      `0 0 ${width} ${height}`
    );
    const points = values.map((value, index) => {
      const x = left + (data.length === 1 ? innerWidth / 2 : innerWidth * index / (data.length - 1));
      const y = top + innerHeight - value / maxValue * innerHeight;
      return { x, y, value, item: data[index] };
    });
    const polyline = svgElement("polyline", {
      points: points.map((point) => `${point.x},${point.y}`).join(" "),
      fill: "none",
      stroke: COLORS.current,
      "stroke-width": 3,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      class: "employee-chart-line"
    });

    svg.appendChild(polyline);
    points.forEach((point, index) => {
      const dot = svgElement("circle", {
        cx: point.x,
        cy: point.y,
        r: 5,
        fill: "#ffffff",
        stroke: COLORS.current,
        "stroke-width": 3,
        class: "employee-chart-dot"
      });
      const label = settings.labelFormatter
        ? settings.labelFormatter(point.item, index)
        : String(point.item && (point.item.label || point.item.week_start || point.item.date) || "");
      appendTooltip(dot, `${label}: ${point.value}`);
      svg.appendChild(dot);
      if (index % labelStride === 0) {
        appendText(
          svg,
          label,
          point.x,
          height - 20,
          "employee-chart-axis employee-chart-axis--x",
          "middle"
        );
      }
    });

    return true;
  }

  function renderDualMetricBars(container, rows, options) {
    if (!container) {
      return false;
    }

    const settings = options || {};
    const data = Array.isArray(rows) ? rows : [];

    if (data.length === 0) {
      clear(container);
      return false;
    }

    const firstKey = settings.firstKey || "assigned";
    const secondKey = settings.secondKey || "completed";
    const firstLabel = settings.firstLabel || "Được giao";
    const secondLabel = settings.secondLabel || "Hoàn thành";
    const width = 760;
    const height = 280;
    const left = 48;
    const right = 18;
    const top = 28;
    const bottom = 50;
    const innerWidth = width - left - right;
    const innerHeight = height - top - bottom;
    const maxValue = Math.max(
      1,
      ...data.flatMap((item) => [
        Number(item && item[firstKey]) || 0,
        Number(item && item[secondKey]) || 0
      ])
    );
    const groupWidth = innerWidth / data.length;
    const barWidth = Math.min(groupWidth * 0.3, 24);
    const labelStride = axisLabelStride(data.length, 8);
    const svg = createSvg(
      container,
      settings.title || "Số lượng được giao và hoàn thành",
      settings.description || "So sánh số công việc được giao và hoàn thành theo thời gian.",
      `0 0 ${width} ${height}`
    );

    for (let tick = 0; tick <= 4; tick += 1) {
      const value = Math.round(maxValue * tick / 4);
      const y = top + innerHeight - value / maxValue * innerHeight;
      svg.appendChild(svgElement("line", {
        x1: left,
        x2: width - right,
        y1: y,
        y2: y,
        class: "employee-chart-grid-line"
      }));
      appendText(svg, String(value), left - 9, y + 4, "employee-chart-axis", "end");
    }

    data.forEach((item, index) => {
      const center = left + groupWidth * index + groupWidth / 2;
      const firstValue = Number(item && item[firstKey]) || 0;
      const secondValue = Number(item && item[secondKey]) || 0;
      const firstHeight = firstValue / maxValue * innerHeight;
      const secondHeight = secondValue / maxValue * innerHeight;
      const firstBar = svgElement("rect", {
        x: center - barWidth - 2,
        y: top + innerHeight - firstHeight,
        width: barWidth,
        height: Math.max(firstHeight, firstValue > 0 ? 2 : 0),
        rx: 3,
        fill: COLORS.assigned,
        class: "employee-chart-bar"
      });
      const secondBar = svgElement("rect", {
        x: center + 2,
        y: top + innerHeight - secondHeight,
        width: barWidth,
        height: Math.max(secondHeight, secondValue > 0 ? 2 : 0),
        rx: 3,
        fill: COLORS.completed,
        class: "employee-chart-bar"
      });

      appendTooltip(firstBar, `${firstLabel}: ${firstValue}`);
      appendTooltip(secondBar, `${secondLabel}: ${secondValue}`);
      svg.append(firstBar, secondBar);
      if (index % labelStride === 0) {
        appendText(
          svg,
          settings.labelFormatter
            ? settings.labelFormatter(item, index)
            : String(item && (item.label || item.week_start || item.date) || ""),
          center,
          height - 20,
          "employee-chart-axis employee-chart-axis--x",
          "middle"
        );
      }
    });

    return true;
  }

  function renderMetricComparison(container, items, options) {
    if (!container) {
      return false;
    }

    const settings = options || {};
    const rows = (Array.isArray(items) ? items : [])
      .map((item) => ({
        label: String(item && item.label || ""),
        value: Math.max(Number(item && item.value) || 0, 0),
        color: item && item.color
      }))
      .filter((item) => item.label);

    if (rows.length === 0) {
      clear(container);
      return false;
    }

    const width = 760;
    const height = 220;
    const left = 138;
    const right = 64;
    const top = 34;
    const barHeight = 28;
    const gap = 30;
    const maxValue = Math.max(1, ...rows.map((item) => item.value));
    const innerWidth = width - left - right;
    const svg = createSvg(
      container,
      settings.title || "So sánh chỉ số",
      settings.description || "So sánh chỉ số cá nhân với mốc tham chiếu.",
      `0 0 ${width} ${height}`
    );

    rows.forEach((item, index) => {
      const y = top + index * (barHeight + gap);
      const widthValue = item.value / maxValue * innerWidth;
      appendText(svg, item.label, left - 12, y + 19, "employee-chart-legend", "end");
      svg.appendChild(svgElement("rect", {
        x: left,
        y,
        width: innerWidth,
        height: barHeight,
        rx: 4,
        fill: "#edf2f7"
      }));
      const bar = svgElement("rect", {
        x: left,
        y,
        width: Math.max(widthValue, item.value > 0 ? 3 : 0),
        height: barHeight,
        rx: 4,
        fill: item.color || (index === 0 ? COLORS.current : COLORS.previous),
        class: "employee-chart-bar"
      });
      appendTooltip(bar, `${item.label}: ${item.value}`);
      svg.appendChild(bar);
      appendText(
        svg,
        settings.valueFormatter ? settings.valueFormatter(item.value) : String(item.value),
        width - right + 10,
        y + 19,
        "employee-chart-legend-value"
      );
    });

    return true;
  }

  window.AMEmployeeCharts = Object.freeze({
    clear,
    renderDualMetricBars,
    renderMetricComparison,
    renderTrend,
    renderWeeklyComparison,
    renderWorkDistribution
  });
})();

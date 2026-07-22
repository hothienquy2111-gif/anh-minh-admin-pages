(function () {
  "use strict";

  const notice = document.getElementById("labelNotice");
  const labelCustomerName = document.getElementById("labelCustomerName");
  const labelCode = document.getElementById("labelCode");
  const labelBrand = document.getElementById("labelBrand");
  const labelModel = document.getElementById("labelModel");
  const labelCondition = document.getElementById("labelCondition");
  const labelDate = document.getElementById("labelDate");
  const printButton = document.getElementById("printButton");
  const labelSizeSelect = document.getElementById("labelSizeSelect");
  const thermalLabel = document.getElementById("thermalLabel");
  const workflowHint = document.getElementById("labelWorkflowHint");
  const PREFERRED_LABEL_SIZE_KEY = "anhMinhPreferredLabelSize";
  const LEGACY_FIT_CLASSES = [
    "ticket-code--normal",
    "ticket-code--medium",
    "ticket-code--long",
    "label-brand--normal",
    "label-brand--long",
    "label-condition--normal",
    "label-condition--long",
    "label-condition--very-long",
    "label-model--normal",
    "label-model--long",
    "label-primary--normal",
    "label-primary--long",
    "label-primary--very-long"
  ];
  const MAX_FIT_ATTEMPTS = 80;
  const FIT_STEP = 0.25;
  const FIT_TOLERANCE = 0.75;
  let currentTicket = null;
  let currentWorkflowAction = null;
  let pendingFitFrame = null;
  let pendingFitTimer = null;
  let fitInProgress = false;
  let labelMeasureCanvas = null;

  const LABEL_SIZES = {
    "50x30": {
      className: "label-50x30",
      width: "50mm",
      height: "30mm",
      nameLines: 2,
      modelLines: 1,
      conditionLines: 2
    },
    "58x40": {
      className: "label-58x40",
      width: "58mm",
      height: "40mm",
      nameLines: 2,
      modelLines: 2,
      conditionLines: 3
    },
    "60x40": {
      className: "label-60x40",
      width: "60mm",
      height: "40mm",
      nameLines: 2,
      modelLines: 2,
      conditionLines: 3
    },
    "58x30": {
      className: "label-58x30",
      width: "58mm",
      height: "30mm",
      nameLines: 2,
      modelLines: 1,
      conditionLines: 2
    },
    "80x50": {
      className: "label-80x50",
      width: "80mm",
      height: "50mm",
      nameLines: 2,
      modelLines: 2,
      conditionLines: 4
    }
  };

  function showNotice(type, message) {
    notice.className = `notice ${type} show`;
    notice.textContent = message;
  }

  function clearNotice() {
    notice.className = "notice";
    notice.textContent = "";
  }

  function setWorkflowHint(message) {
    if (workflowHint) {
      workflowHint.textContent = message;
    }
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

  function formatDate(value) {
    if (!value) {
      return "Chưa có";
    }

    const date = new Date(`${value}T00:00:00`);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleDateString("vi-VN");
  }

  function textOrBlank(value) {
    const text = value === null || value === undefined ? "" : String(value).trim();
    return !text || /^(null|undefined)$/i.test(text) ? "Chưa có" : text;
  }

  function normalizeLabelCustomerName(ticket) {
    const candidates = [
      ticket && ticket.customer_master_name,
      ticket && ticket.customer_name
    ];

    for (const value of candidates) {
      const text = value === null || value === undefined ? "" : String(value).trim();

      if (text && !/^(null|undefined)$/i.test(text)) {
        return text;
      }
    }

    return "—";
  }

  function normalizeLabelBrand(value) {
    const text = value === null || value === undefined ? "" : String(value).trim();

    if (!text || /^(null|undefined)$/i.test(text)) {
      return "Chưa xác định";
    }

    const normalized = window.AMTvUtils && typeof window.AMTvUtils.normalizeBrand === "function"
      ? String(window.AMTvUtils.normalizeBrand(text) || "").trim()
      : text;

    return normalized || "Chưa xác định";
  }

  function readLabelMetric(name, fallback) {
    const value = Number.parseFloat(window.getComputedStyle(thermalLabel).getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  }

  function getFitProfile(selected) {
    return {
      name: {
        max: readLabelMetric("--label-name-max-size", 10.8),
        singleLineMin: readLabelMetric("--label-name-single-line-min-size", 8.5),
        min: readLabelMetric("--label-name-min-size", 7.5),
        lines: selected.nameLines
      },
      code: {
        max: readLabelMetric("--label-code-max-size", 10.2),
        min: readLabelMetric("--label-code-min-size", 7.4),
        lines: 1
      },
      type: {
        max: readLabelMetric("--label-type-max-size", 9),
        min: readLabelMetric("--label-type-min-size", 6.6),
        lines: 1
      },
      model: {
        max: readLabelMetric("--label-model-max-size", 9.8),
        min: readLabelMetric("--label-model-min-size", 6.8),
        lines: selected.modelLines
      },
      condition: {
        max: readLabelMetric("--label-condition-max-size", 8.8),
        min: readLabelMetric("--label-condition-min-size", 6.6),
        lines: selected.conditionLines
      },
      date: {
        max: readLabelMetric("--label-date-max-size", 7.4),
        min: readLabelMetric("--label-date-min-size", 6.1),
        lines: 1
      },
      headerTitleMin: readLabelMetric("--label-title-min-size", 6.8),
      headerPhoneMin: readLabelMetric("--label-phone-min-size", 5.8),
      headerAddressMin: readLabelMetric("--label-address-min-size", 5.7)
    };
  }

  function getLineHeight(element) {
    const computed = window.getComputedStyle(element);
    const fontSize = Number.parseFloat(computed.fontSize) || 8;
    return Number.parseFloat(computed.lineHeight) || fontSize;
  }

  function getRenderedLineCount(element) {
    const renderedHeight = element.getBoundingClientRect().height;
    return Math.max(1, Math.ceil((renderedHeight - FIT_TOLERANCE) / getLineHeight(element)));
  }

  function labelTextFits(element, options) {
    if (!element || element.clientWidth <= 0) {
      return false;
    }

    const maxLines = Number.isFinite(options.maxLines) ? options.maxLines : 1;
    const maxHeight = Number.isFinite(options.availableHeight) ? options.availableHeight : Number.POSITIVE_INFINITY;
    const renderedHeight = element.getBoundingClientRect().height;
    return element.scrollWidth <= element.clientWidth + FIT_TOLERANCE
      && getRenderedLineCount(element) <= maxLines
      && renderedHeight <= maxHeight + FIT_TOLERANCE;
  }

  function fitLabelText(element, options) {
    if (!element) {
      return { fits: true, fontSize: 0, lines: 0 };
    }

    const maxFontSize = Number.isFinite(options.maxFontSize) ? options.maxFontSize : 10;
    const minFontSize = Number.isFinite(options.minFontSize) ? options.minFontSize : 6;
    const step = Number.isFinite(options.step) && options.step > 0 ? options.step : FIT_STEP;
    let fontSize = Math.max(minFontSize, maxFontSize);
    let attempts = 0;

    while (attempts < MAX_FIT_ATTEMPTS) {
      element.style.fontSize = `${Math.round(fontSize * 100) / 100}px`;

      if (typeof options.renderLayout === "function") {
        options.renderLayout(fontSize);
      }

      if (labelTextFits(element, options)) {
        return { fits: true, fontSize, lines: getRenderedLineCount(element) };
      }

      if (fontSize <= minFontSize + 0.01) {
        break;
      }

      fontSize = Math.max(minFontSize, fontSize - step);
      attempts += 1;
    }

    return {
      fits: labelTextFits(element, options),
      fontSize,
      lines: getRenderedLineCount(element)
    };
  }

  function getLabelMeasureContext() {
    if (!labelMeasureCanvas) {
      labelMeasureCanvas = document.createElement("canvas");
    }

    return labelMeasureCanvas.getContext("2d");
  }

  function measureLabelText(text, element, fontSize, fontWeight) {
    const context = getLabelMeasureContext();

    if (!context) {
      return String(text || "").length * fontSize * 0.55;
    }

    const computed = window.getComputedStyle(element);
    context.font = `${fontWeight || computed.fontWeight || 800} ${fontSize}px ${computed.fontFamily}`;
    return context.measureText(String(text || "")).width;
  }

  function chooseBalancedNameLines(fullName, row, fontSize) {
    const words = String(fullName || "").trim().split(/\s+/).filter(Boolean);

    if (words.length < 2) {
      return [words.join(" ")];
    }

    const key = row.querySelector(".label-key");
    const keyText = key ? `${key.textContent.trim()} ` : "";
    const availableWidth = Math.max(1, row.clientWidth - 1);
    const prefixWidth = measureLabelText(keyText, row, fontSize, 900);
    let best = null;

    for (let index = 1; index < words.length; index += 1) {
      const first = words.slice(0, index).join(" ");
      const second = words.slice(index).join(" ");
      const firstWidth = prefixWidth + measureLabelText(first, row, fontSize, 900);
      const secondWidth = measureLabelText(second, row, fontSize, 900);
      const overflow = Math.max(0, firstWidth - availableWidth) + Math.max(0, secondWidth - availableWidth);
      const orphanPenalty = words.length > 3 && (index === 1 || index === words.length - 1)
        ? availableWidth * 0.18
        : 0;
      const score = overflow * 1000 + Math.abs(firstWidth - secondWidth) + orphanPenalty;

      if (!best || score < best.score) {
        best = { lines: [first, second], score };
      }
    }

    return best ? best.lines : [fullName];
  }

  function renderCustomerNameLines(lines) {
    const safeLines = Array.isArray(lines) && lines.length ? lines : [""];
    const nodes = [];

    safeLines.forEach((line, index) => {
      if (index > 0) {
        nodes.push(document.createElement("br"));
      }
      nodes.push(document.createTextNode(line));
    });

    labelCustomerName.replaceChildren(...nodes);
  }

  function fitCustomerName(row, fullName, profile) {
    row.classList.remove("label-name--two-lines", "label-name--break-anywhere");
    row.dataset.labelLines = "1";
    renderCustomerNameLines([fullName]);

    const singleLine = fitLabelText(row, {
      maxFontSize: profile.max,
      minFontSize: profile.singleLineMin,
      maxLines: 1
    });

    if (singleLine.fits) {
      return singleLine;
    }

    row.classList.add("label-name--two-lines");
    row.dataset.labelLines = "2";
    const twoLines = fitLabelText(row, {
      maxFontSize: profile.max,
      minFontSize: profile.min,
      maxLines: profile.lines,
      renderLayout: function (fontSize) {
        renderCustomerNameLines(chooseBalancedNameLines(fullName, row, fontSize));
      }
    });

    if (!twoLines.fits) {
      row.classList.add("label-name--break-anywhere");
    }

    return twoLines;
  }

  function fitModel(row, profile) {
    row.classList.remove("label-model--wrapped");
    row.dataset.labelLines = "1";
    const singleLine = fitLabelText(row, {
      maxFontSize: profile.max,
      minFontSize: profile.min,
      maxLines: 1
    });

    if (singleLine.fits || profile.lines < 2) {
      return singleLine;
    }

    row.classList.add("label-model--wrapped");
    row.dataset.labelLines = "2";
    return fitLabelText(row, {
      maxFontSize: profile.max,
      minFontSize: profile.min,
      maxLines: profile.lines
    });
  }

  function getOuterHeight(element, ignoreMarginTop) {
    if (!element) {
      return 0;
    }

    const computed = window.getComputedStyle(element);
    const marginTop = ignoreMarginTop ? 0 : Number.parseFloat(computed.marginTop) || 0;
    const marginBottom = Number.parseFloat(computed.marginBottom) || 0;
    return element.getBoundingClientRect().height + marginTop + marginBottom;
  }

  function getConditionAvailableHeight(content, conditionRow, fixedRows) {
    const computed = window.getComputedStyle(conditionRow);
    const conditionMargins = (Number.parseFloat(computed.marginTop) || 0)
      + (Number.parseFloat(computed.marginBottom) || 0);
    const fixedHeight = fixedRows.reduce((total, entry) => {
      const element = entry && entry.element ? entry.element : entry;
      return total + getOuterHeight(element, Boolean(entry && entry.ignoreMarginTop));
    }, 0);
    return Math.max(0, content.clientHeight - fixedHeight - conditionMargins - 1);
  }

  function getConditionLineLimit(conditionRow, availableHeight, profile) {
    const computed = window.getComputedStyle(conditionRow);
    const currentFontSize = Number.parseFloat(computed.fontSize) || profile.max;
    const lineHeightRatio = getLineHeight(conditionRow) / currentFontSize;
    const minimumLineHeight = Math.max(1, profile.min * lineHeightRatio);
    const availableLines = Math.max(
      1,
      Math.floor((availableHeight + FIT_TOLERANCE) / minimumLineHeight)
    );
    return Math.max(profile.lines, availableLines);
  }

  function resetFitState(rows, fullName) {
    thermalLabel.classList.remove(...LEGACY_FIT_CLASSES);
    rows.customer.classList.remove("label-name--two-lines", "label-name--break-anywhere");
    rows.model.classList.remove("label-model--wrapped");
    rows.customer.dataset.labelLines = "1";
    rows.model.dataset.labelLines = "1";
    renderCustomerNameLines([fullName]);

    Object.values(rows).forEach((element) => {
      if (element) {
        element.style.removeProperty("font-size");
      }
    });
  }

  function fitHeader(rows, profile) {
    return [
      fitLabelText(rows.title, {
        maxFontSize: Number.parseFloat(window.getComputedStyle(rows.title).fontSize),
        minFontSize: profile.headerTitleMin,
        maxLines: 1
      }),
      fitLabelText(rows.phone, {
        maxFontSize: Number.parseFloat(window.getComputedStyle(rows.phone).fontSize),
        minFontSize: profile.headerPhoneMin,
        maxLines: 1
      }),
      fitLabelText(rows.address, {
        maxFontSize: Number.parseFloat(window.getComputedStyle(rows.address).fontSize),
        minFontSize: profile.headerAddressMin,
        maxLines: 1
      })
    ];
  }

  function fitLabelPass(selected, mode, rows, fullName) {
    thermalLabel.classList.toggle("label-content--compact", mode !== "normal");
    thermalLabel.classList.toggle("label-content--tight", mode === "tight");
    resetFitState(rows, fullName);
    const profile = getFitProfile(selected);
    const headerResults = fitHeader(rows, profile);
    const nameResult = fitCustomerName(rows.customer, fullName, profile.name);
    const codeResult = fitLabelText(rows.code, {
      maxFontSize: profile.code.max,
      minFontSize: profile.code.min,
      maxLines: 1
    });
    const modelResult = fitModel(rows.model, profile.model);
    const modelFontSize = Number.parseFloat(window.getComputedStyle(rows.model).fontSize) || profile.model.max;
    const typeResult = fitLabelText(rows.type, {
      maxFontSize: Math.min(profile.type.max, Math.max(profile.type.min, modelFontSize - 0.6)),
      minFontSize: profile.type.min,
      maxLines: 1
    });
    const dateResult = fitLabelText(rows.date, {
      maxFontSize: profile.date.max,
      minFontSize: profile.date.min,
      maxLines: 1
    });
    const conditionHeight = getConditionAvailableHeight(
      rows.content,
      rows.condition,
      [
        rows.customer,
        rows.code,
        rows.type,
        rows.model,
        { element: rows.date, ignoreMarginTop: true }
      ]
    );
    const conditionLineLimit = getConditionLineLimit(
      rows.condition,
      conditionHeight,
      profile.condition
    );
    const conditionResult = fitLabelText(rows.condition, {
      maxFontSize: profile.condition.max,
      minFontSize: profile.condition.min,
      maxLines: conditionLineLimit,
      availableHeight: conditionHeight
    });
    const results = [nameResult, codeResult, typeResult, modelResult, conditionResult, dateResult, ...headerResults];
    const fits = results.every((result) => result.fits)
      && thermalLabel.scrollHeight <= thermalLabel.clientHeight + 1;

    return { fits, profile, results, conditionLineLimit };
  }

  function shrinkLayoutHeight(selected, rows, fullName, profile, conditionLineLimit) {
    const entries = [
      { element: rows.condition, min: profile.condition.min },
      { element: rows.type, min: profile.type.min },
      { element: rows.model, min: profile.model.min },
      { element: rows.customer, min: profile.name.min },
      { element: rows.date, min: profile.date.min },
      { element: rows.code, min: profile.code.min }
    ];
    let attempts = 0;

    while (thermalLabel.scrollHeight > thermalLabel.clientHeight + 1 && attempts < MAX_FIT_ATTEMPTS) {
      let changed = false;

      for (const entry of entries) {
        const current = Number.parseFloat(window.getComputedStyle(entry.element).fontSize);

        if (!Number.isFinite(current) || current <= entry.min + 0.01) {
          continue;
        }

        const next = Math.max(entry.min, current - FIT_STEP);
        entry.element.style.fontSize = `${Math.round(next * 100) / 100}px`;

        if (entry.element === rows.customer && rows.customer.classList.contains("label-name--two-lines")) {
          renderCustomerNameLines(chooseBalancedNameLines(fullName, rows.customer, next));
        }

        changed = true;
        break;
      }

      if (!changed) {
        break;
      }

      attempts += 1;
    }

    const modelLines = rows.model.classList.contains("label-model--wrapped") ? selected.modelLines : 1;
    return labelTextFits(rows.customer, { maxLines: selected.nameLines })
      && labelTextFits(rows.code, { maxLines: 1 })
      && labelTextFits(rows.type, { maxLines: 1 })
      && labelTextFits(rows.model, { maxLines: modelLines })
      && labelTextFits(rows.condition, { maxLines: conditionLineLimit })
      && labelTextFits(rows.date, { maxLines: 1 })
      && thermalLabel.scrollHeight <= thermalLabel.clientHeight + 1;
  }

  function fitLabelContent() {
    if (fitInProgress || !thermalLabel || thermalLabel.clientWidth <= 0) {
      return false;
    }

    fitInProgress = true;

    try {
      const selectedKey = labelSizeSelect && LABEL_SIZES[labelSizeSelect.value]
        ? labelSizeSelect.value
        : "50x30";
      const selected = LABEL_SIZES[selectedKey];
      const rows = {
        content: thermalLabel.querySelector(".label-device-content"),
        customer: labelCustomerName.closest(".label-customer"),
        code: labelCode.closest(".label-code"),
        type: labelBrand.closest(".label-type"),
        model: labelModel.closest(".label-model"),
        condition: labelCondition.closest(".label-condition"),
        date: labelDate.closest(".label-date"),
        title: thermalLabel.querySelector(".label-brand-text"),
        phone: thermalLabel.querySelector(".label-phone"),
        address: thermalLabel.querySelector(".label-address")
      };
      const fullName = labelCustomerName.dataset.fullText || labelCustomerName.textContent.trim();
      let result = fitLabelPass(selected, "normal", rows, fullName);

      if (!result.fits) {
        result = fitLabelPass(selected, "compact", rows, fullName);
      }

      if (!result.fits) {
        result = fitLabelPass(selected, "tight", rows, fullName);
      }

      if (!result.fits) {
        result.fits = shrinkLayoutHeight(
          selected,
          rows,
          fullName,
          result.profile,
          result.conditionLineLimit
        );
      }

      thermalLabel.dataset.fitStatus = result.fits ? "fit" : "overflow";
      return result.fits;
    } finally {
      fitInProgress = false;
    }
  }

  function scheduleLabelFit() {
    if (pendingFitFrame !== null) {
      window.cancelAnimationFrame(pendingFitFrame);
    }

    if (pendingFitTimer !== null) {
      window.clearTimeout(pendingFitTimer);
    }

    pendingFitFrame = window.requestAnimationFrame(function () {
      pendingFitFrame = null;
      fitLabelContent();
    });

    pendingFitTimer = window.setTimeout(function () {
      pendingFitTimer = null;
      fitLabelContent();
    }, 120);
  }

  function waitForNextFrame() {
    return new Promise((resolve) => window.requestAnimationFrame(resolve));
  }

  async function prepareLabelForPrint() {
    if (document.fonts && document.fonts.ready) {
      await Promise.race([
        document.fonts.ready.catch(function () {
          return undefined;
        }),
        new Promise((resolve) => window.setTimeout(resolve, 180))
      ]);
    }

    await waitForNextFrame();
    fitLabelContent();
    await waitForNextFrame();
    fitLabelContent();
  }

  function renderLabel(ticket) {
    const displayBrand = normalizeLabelBrand(ticket.brand);
    const displayCustomerName = normalizeLabelCustomerName(ticket);

    labelCustomerName.dataset.fullText = displayCustomerName;
    labelCustomerName.textContent = displayCustomerName;
    labelCode.textContent = window.AMApi.formatTicketCode(ticket.ticket_code);
    labelBrand.textContent = displayBrand;
    labelModel.textContent = textOrBlank(ticket.model);
    labelCondition.textContent = textOrBlank(ticket.condition_text);
    labelDate.textContent = formatDate(ticket.received_date);
    scheduleLabelFit();
  }

  function canStartRepair(ticket) {
    return ["mới nhận", "đang kiểm tra", "báo giá"].includes(ticket.status)
      && !ticket.repair_started_at
      && !ticket.completed_at;
  }

  function canReprintLabel(ticket) {
    return Boolean(ticket.repair_started_at) && ticket.status !== "huỷ";
  }

  function renderWorkflowControls(ticket) {
    currentWorkflowAction = null;
    printButton.disabled = false;

    if (!ticket.workflow_available) {
      printButton.disabled = true;
      printButton.textContent = "Workflow chưa kích hoạt";
      setWorkflowHint(ticket.workflow_inactive_message || "Workflow chưa được kích hoạt. Cần triển khai backend workflow trước khi in theo quy trình mới.");
      return;
    }

    if (ticket.status === "huỷ") {
      printButton.disabled = true;
      printButton.textContent = "Phiếu đã huỷ";
      setWorkflowHint("Phiếu đã huỷ, không thể in hoặc in lại tem.");
      return;
    }

    if (canStartRepair(ticket)) {
      currentWorkflowAction = "START_REPAIR";
      printButton.textContent = "In tem & bắt đầu sửa chữa";
      setWorkflowHint("Nút này sẽ chuyển phiếu sang trạng thái đang sửa trước khi mở in tem.");
      return;
    }

    if (canReprintLabel(ticket)) {
      currentWorkflowAction = "REPRINT_LABEL";
      printButton.textContent = "Chỉ in lại tem";
      setWorkflowHint("In lại tem không đổi trạng thái và không reset thời gian sửa chữa.");
      return;
    }

    printButton.disabled = true;
    printButton.textContent = "Chưa đủ điều kiện in tem";
    setWorkflowHint("Phiếu chưa ở trạng thái phù hợp để in tem theo workflow.");
  }

  async function runWorkflowAndPrint() {
    if (!currentTicket || !currentWorkflowAction) {
      return;
    }

    const action = currentWorkflowAction;

    if (
      action === "START_REPAIR"
      && !window.confirm(`In tem và bắt đầu sửa chữa phiếu ${window.AMApi.formatTicketCode(currentTicket.ticket_code)}?`)
    ) {
      return;
    }

    printButton.disabled = true;
    printButton.textContent = "Đang xử lý...";
    clearNotice();

    let requestId = null;

    try {
      requestId = window.AMApi.ensureWorkflowClientRequestId(currentTicket.id, action);
      const result = await window.AMApi.recordTicketWorkflowAction(currentTicket.id, action, requestId);
      window.AMApi.clearWorkflowClientRequestId(currentTicket.id, action);

      currentTicket = Object.assign({}, currentTicket, {
        status: result.status,
        repair_started_at: result.repair_started_at,
        ready_for_handover_at: result.ready_for_handover_at,
        completed_at: result.completed_at,
        last_activity_at: result.activity_created_at,
        workflow_available: true
      });

      renderWorkflowControls(currentTicket);
      if (action === "START_REPAIR") {
        showNotice("success", "Phiếu đã chuyển trạng thái. Trường hợp chưa in được, hãy dùng chức năng Chỉ in lại.");
      }
      await prepareLabelForPrint();
      window.print();
    } catch (error) {
      if (requestId && window.AMApi.shouldClearWorkflowClientRequestId(error)) {
        window.AMApi.clearWorkflowClientRequestId(currentTicket.id, action);
      }

      showNotice("error", error.message);
      renderWorkflowControls(currentTicket);
    }
  }

  function syncPageSize(size) {
    let style = document.getElementById("dynamicLabelPageSize");

    if (!style) {
      style = document.createElement("style");
      style.id = "dynamicLabelPageSize";
      document.head.appendChild(style);
    }

    style.textContent = `@page { size: ${size.width} ${size.height}; margin: 0; }`;
    document.documentElement.style.setProperty("--print-label-width", size.width);
    document.documentElement.style.setProperty("--print-label-height", size.height);
  }

  function applyLabelSize(value) {
    const selectedKey = LABEL_SIZES[value] ? value : "50x30";
    const selected = LABEL_SIZES[selectedKey];
    const classNames = Object.values(LABEL_SIZES).map((size) => size.className);

    document.body.classList.remove(...classNames);
    thermalLabel.classList.remove(...classNames);
    document.body.classList.add(selected.className);
    thermalLabel.classList.add(selected.className);
    thermalLabel.dataset.labelSize = selectedKey;
    syncPageSize(selected);
    scheduleLabelFit();
  }

  function getPreferredLabelSize() {
    try {
      const value = window.localStorage.getItem(PREFERRED_LABEL_SIZE_KEY);
      return value && LABEL_SIZES[value] ? value : null;
    } catch (_error) {
      return null;
    }
  }

  function savePreferredLabelSize(value) {
    try {
      window.localStorage.setItem(PREFERRED_LABEL_SIZE_KEY, value);
    } catch (_error) {
      // Printing still works when storage is unavailable.
    }
  }

  function attachPaperControls() {
    const defaultValue = labelSizeSelect && LABEL_SIZES[labelSizeSelect.value]
      ? labelSizeSelect.value
      : "50x30";
    const initialValue = getPreferredLabelSize() || defaultValue;

    if (labelSizeSelect) {
      labelSizeSelect.value = initialValue;
    }
    applyLabelSize(initialValue);

    if (!labelSizeSelect) {
      return;
    }

    labelSizeSelect.addEventListener("change", function () {
      const value = LABEL_SIZES[labelSizeSelect.value] ? labelSizeSelect.value : defaultValue;
      savePreferredLabelSize(value);
      applyLabelSize(value);
    });

    window.addEventListener("beforeprint", fitLabelContent);
    window.addEventListener("resize", scheduleLabelFit);
    window.addEventListener("load", scheduleLabelFit, { once: true });

    const labelLogo = thermalLabel.querySelector(".label-logo");

    if (labelLogo && !labelLogo.complete) {
      labelLogo.addEventListener("load", scheduleLabelFit, { once: true });
    }

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(scheduleLabelFit).catch(function () {
        // The timeout pass still protects layout when font readiness is unavailable.
      });
    }
  }

  async function initPrintLabel() {
    attachLogout();
    attachPaperControls();
    printButton.addEventListener("click", runWorkflowAndPrint);

    try {
      const access = await window.AMApi.requireInternalAccess();
      if (!access) {
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const ticket = await window.AMApi.getTicketForLabel({
        code: params.get("code"),
        id: params.get("id")
      });

      if (!ticket) {
        showNotice("error", "Không tìm thấy phiếu để in tem.");
        printButton.disabled = true;
        return;
      }

      currentTicket = ticket;
      renderLabel(ticket);
      renderWorkflowControls(ticket);
      clearNotice();
    } catch (error) {
      showNotice("error", error.message);
      printButton.disabled = true;
    }
  }

  document.addEventListener("DOMContentLoaded", initPrintLabel);
})();

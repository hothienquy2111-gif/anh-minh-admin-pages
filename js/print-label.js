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
  const CODE_LENGTH_CLASSES = ["ticket-code--normal", "ticket-code--medium", "ticket-code--long"];
  const BRAND_LENGTH_CLASSES = ["label-brand--normal", "label-brand--long"];
  const CONDITION_LENGTH_CLASSES = ["label-condition--normal", "label-condition--long", "label-condition--very-long"];
  const MODEL_LENGTH_CLASSES = ["label-model--normal", "label-model--long"];
  const PRIMARY_LENGTH_CLASSES = ["label-primary--normal", "label-primary--long", "label-primary--very-long"];
  let currentTicket = null;
  let currentWorkflowAction = null;
  let pendingFitFrame = null;
  let pendingFitTimer = null;

  const LABEL_SIZES = {
    "50x30": {
      className: "label-50x30",
      width: "50mm",
      height: "30mm",
      minNameFont: 7.6,
      minCodeFont: 7.2,
      minTypeFont: 6.2,
      minModelFont: 7.2,
      minConditionFont: 6.8,
      minDateFont: 6.1,
      nameLines: 2,
      conditionLines: 2
    },
    "58x40": {
      className: "label-58x40",
      width: "58mm",
      height: "40mm",
      minNameFont: 10.5,
      minCodeFont: 9.9,
      minTypeFont: 8.6,
      minModelFont: 10,
      minConditionFont: 9.2,
      minDateFont: 7.5,
      nameLines: 2,
      conditionLines: 3
    },
    "60x40": {
      className: "label-60x40",
      width: "60mm",
      height: "40mm",
      minNameFont: 10.8,
      minCodeFont: 10.2,
      minTypeFont: 9.1,
      minModelFont: 10.3,
      minConditionFont: 9.5,
      minDateFont: 7.75,
      nameLines: 2,
      conditionLines: 3
    },
    "58x30": {
      className: "label-58x30",
      width: "58mm",
      height: "30mm",
      minNameFont: 8.1,
      minCodeFont: 7.6,
      minTypeFont: 6.7,
      minModelFont: 7.7,
      minConditionFont: 7.2,
      minDateFont: 6.5,
      nameLines: 2,
      conditionLines: 2
    },
    "80x50": {
      className: "label-80x50",
      width: "80mm",
      height: "50mm",
      minNameFont: 13.4,
      minCodeFont: 12.7,
      minTypeFont: 11.2,
      minModelFont: 12.8,
      minConditionFont: 11.8,
      minDateFont: 10,
      nameLines: 2,
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

  function setLengthClass(classNames, selectedClass) {
    thermalLabel.classList.remove(...classNames);
    thermalLabel.classList.add(selectedClass);
  }

  function classifyLabelContent(ticket, displayBrand, displayCustomerName) {
    const codeLength = window.AMApi.formatTicketCode(ticket.ticket_code).length;
    const customerNameLength = String(displayCustomerName || "").trim().length;
    const brandLength = String(displayBrand || "").trim().length;
    const modelLength = String(ticket.model || "").trim().length;
    const conditionLength = String(ticket.condition_text || "").trim().length;

    setLengthClass(
      CODE_LENGTH_CLASSES,
      codeLength <= 8 ? "ticket-code--normal" : codeLength <= 12 ? "ticket-code--medium" : "ticket-code--long"
    );
    setLengthClass(
      BRAND_LENGTH_CLASSES,
      brandLength <= 16 ? "label-brand--normal" : "label-brand--long"
    );
    setLengthClass(
      MODEL_LENGTH_CLASSES,
      modelLength <= 24 ? "label-model--normal" : "label-model--long"
    );
    setLengthClass(
      CONDITION_LENGTH_CLASSES,
      conditionLength <= 40
        ? "label-condition--normal"
        : conditionLength <= 64
          ? "label-condition--long"
          : "label-condition--very-long"
    );
    setLengthClass(
      PRIMARY_LENGTH_CLASSES,
      conditionLength > 64 || customerNameLength > 30 || modelLength > 32 || codeLength > 16
        ? "label-primary--very-long"
        : conditionLength > 40 || customerNameLength > 22 || modelLength > 24 || codeLength > 12
          ? "label-primary--long"
          : "label-primary--normal"
    );
  }

  function shrinkSingleLine(element, minimumFontSize) {
    if (!element) {
      return;
    }

    let fontSize = Number.parseFloat(window.getComputedStyle(element).fontSize);
    while (element.scrollWidth > element.clientWidth + 0.5 && fontSize > minimumFontSize) {
      fontSize = Math.max(minimumFontSize, fontSize - 0.5);
      element.style.fontSize = `${fontSize}px`;
    }
  }

  function primaryInfoRowFits(entry) {
    const element = entry && entry.element;

    if (!element) {
      return true;
    }

    const computed = window.getComputedStyle(element);
    const fontSize = Number.parseFloat(computed.fontSize) || 8;
    const lineHeight = Number.parseFloat(computed.lineHeight) || fontSize * 1.04;
    const maxLines = Number.isFinite(entry.lines) ? entry.lines : 1;
    const exceedsWidth = element.scrollWidth > element.clientWidth + 0.75;
    const exceedsLineLimit = element.scrollHeight > lineHeight * maxLines + 2;
    const exceedsVisibleBox = element.clientHeight > 0
      && element.scrollHeight > element.clientHeight + 2;

    return !exceedsWidth && !exceedsLineLimit && !exceedsVisibleBox;
  }

  function fitInfoRow(entry) {
    const element = entry && entry.element;

    if (!element) {
      return true;
    }

    const minimumFontSize = Number.isFinite(entry.minimumFontSize)
      ? entry.minimumFontSize
      : 6;
    let fontSize = Number.parseFloat(window.getComputedStyle(element).fontSize);
    let attempts = 0;

    while (!primaryInfoRowFits(entry) && attempts < 40 && fontSize > minimumFontSize + 0.01) {
      fontSize = Math.max(minimumFontSize, fontSize - 0.25);
      element.style.fontSize = `${fontSize}px`;
      attempts += 1;
    }

    return primaryInfoRowFits(entry);
  }

  function fitInfoRows(entries) {
    const rows = (entries || []).filter((entry) => entry && entry.element);

    if (!rows.length) {
      return true;
    }

    rows.forEach(fitInfoRow);
    let attempts = 0;

    while (thermalLabel.scrollHeight > thermalLabel.clientHeight + 1 && attempts < 120) {
      let changed = false;

      for (const entry of rows) {
        const minimumFontSize = Number.isFinite(entry.minimumFontSize)
          ? entry.minimumFontSize
          : 6;
        const fontSize = Number.parseFloat(window.getComputedStyle(entry.element).fontSize);

        if (fontSize <= minimumFontSize + 0.01) {
          continue;
        }

        entry.element.style.fontSize = `${Math.max(minimumFontSize, fontSize - 0.25)}px`;
        changed = true;

        if (thermalLabel.scrollHeight <= thermalLabel.clientHeight + 1) {
          break;
        }
      }

      if (!changed) {
        break;
      }

      attempts += 1;
    }

    return rows.every(primaryInfoRowFits)
      && thermalLabel.scrollHeight <= thermalLabel.clientHeight + 1;
  }

  function keepTypeBelowModel(typeRow, modelRow, minimumFontSize) {
    if (!typeRow || !modelRow) {
      return;
    }

    const typeFontSize = Number.parseFloat(window.getComputedStyle(typeRow).fontSize);
    const modelFontSize = Number.parseFloat(window.getComputedStyle(modelRow).fontSize);
    const targetTypeFontSize = Math.max(minimumFontSize, modelFontSize - 0.7);

    if (Math.abs(typeFontSize - targetTypeFontSize) > 0.01) {
      typeRow.style.fontSize = `${targetTypeFontSize}px`;
    }
  }

  function fitLabelContent() {
    const selectedKey = labelSizeSelect && LABEL_SIZES[labelSizeSelect.value]
      ? labelSizeSelect.value
      : "50x30";
    const selected = LABEL_SIZES[selectedKey];
    const customerRow = labelCustomerName.closest(".label-customer");
    const codeRow = labelCode.closest(".label-code");
    const brandRow = labelBrand.closest(".label-type");
    const modelRow = labelModel.closest(".label-model");
    const conditionRow = labelCondition.closest(".label-condition");
    const dateRow = labelDate.closest(".label-date");
    const brandTitle = thermalLabel.querySelector(".label-brand-text");
    const brandPhone = thermalLabel.querySelector(".label-phone");
    const brandAddress = thermalLabel.querySelector(".label-address");
    const infoRows = [
      { element: conditionRow, lines: selected.conditionLines, minimumFontSize: selected.minConditionFont },
      { element: brandRow, lines: 1, minimumFontSize: selected.minTypeFont },
      { element: dateRow, lines: 1, minimumFontSize: selected.minDateFont },
      { element: modelRow, lines: 1, minimumFontSize: selected.minModelFont },
      { element: customerRow, lines: selected.nameLines, minimumFontSize: selected.minNameFont },
      { element: codeRow, lines: 1, minimumFontSize: selected.minCodeFont }
    ];

    thermalLabel.classList.remove("label-content--compact");
    [customerRow, codeRow, brandRow, modelRow, conditionRow, dateRow, brandTitle, brandPhone, brandAddress].forEach((element) => {
      if (element) {
        element.style.removeProperty("font-size");
      }
    });

    shrinkSingleLine(brandTitle, 6.5);
    shrinkSingleLine(brandPhone, 5.5);
    shrinkSingleLine(brandAddress, 5.5);
    const infoRowsFit = fitInfoRows(infoRows);
    keepTypeBelowModel(brandRow, modelRow, selected.minTypeFont);

    if (
      !infoRowsFit
      || thermalLabel.scrollHeight > thermalLabel.clientHeight + 1
    ) {
      thermalLabel.classList.add("label-content--compact");
      infoRows.forEach((entry) => entry.element.style.removeProperty("font-size"));
      fitInfoRows(infoRows);
      keepTypeBelowModel(brandRow, modelRow, selected.minTypeFont);
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

  function renderLabel(ticket) {
    const displayBrand = normalizeLabelBrand(ticket.brand);
    const displayCustomerName = normalizeLabelCustomerName(ticket);

    labelCustomerName.textContent = displayCustomerName;
    labelCode.textContent = window.AMApi.formatTicketCode(ticket.ticket_code);
    labelBrand.textContent = displayBrand;
    labelModel.textContent = textOrBlank(ticket.model);
    labelCondition.textContent = textOrBlank(ticket.condition_text);
    labelDate.textContent = formatDate(ticket.received_date);
    classifyLabelContent(ticket, displayBrand, displayCustomerName);
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
      fitLabelContent();
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

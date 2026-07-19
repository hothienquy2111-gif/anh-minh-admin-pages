(function () {
  "use strict";

  const notice = document.getElementById("labelNotice");
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
  let currentTicket = null;
  let currentWorkflowAction = null;
  let pendingFitFrame = null;

  const LABEL_SIZES = {
    "50x30": { className: "label-50x30", width: "50mm", height: "30mm", minCodeFont: 11, minBrandFont: 6.5, minModelFont: 7, minConditionFont: 6.25, conditionLines: 2 },
    "58x40": { className: "label-58x40", width: "58mm", height: "40mm", minCodeFont: 13, minBrandFont: 7.5, minModelFont: 8, minConditionFont: 7.5, conditionLines: 3 },
    "60x40": { className: "label-60x40", width: "60mm", height: "40mm", minCodeFont: 13, minBrandFont: 7.5, minModelFont: 8, minConditionFont: 7.5, conditionLines: 3 },
    "58x30": { className: "label-58x30", width: "58mm", height: "30mm", minCodeFont: 12, minBrandFont: 7, minModelFont: 7, minConditionFont: 6.5, conditionLines: 2 },
    "80x50": { className: "label-80x50", width: "80mm", height: "50mm", minCodeFont: 16, minBrandFont: 10, minModelFont: 10, minConditionFont: 9, conditionLines: 4 }
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
    return value ? String(value) : "Chưa có";
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

  function classifyLabelContent(ticket, displayBrand) {
    const codeLength = String(ticket.ticket_code || "").trim().length;
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

  function shrinkConditionToFit(element, minimumFontSize, lineLimit) {
    if (!element) {
      return;
    }

    let fontSize = Number.parseFloat(window.getComputedStyle(element).fontSize);
    const maxLines = Number.isFinite(lineLimit) ? lineLimit : 2;
    let attempts = 0;

    while (fontSize > minimumFontSize && attempts < 30) {
      const computed = window.getComputedStyle(element);
      const lineHeight = Number.parseFloat(computed.lineHeight) || fontSize * 1.06;
      const exceedsLineLimit = element.scrollHeight > lineHeight * maxLines + 1.5;
      const exceedsVisibleBox = element.scrollHeight > element.clientHeight + 1;
      const exceedsLabel = thermalLabel.scrollHeight > thermalLabel.clientHeight + 1;

      if (!exceedsLineLimit && !exceedsVisibleBox && !exceedsLabel) {
        break;
      }

      fontSize = Math.max(minimumFontSize, fontSize - 0.35);
      element.style.fontSize = `${fontSize}px`;
      attempts += 1;
    }
  }

  function fitLabelContent() {
    const selectedKey = labelSizeSelect && LABEL_SIZES[labelSizeSelect.value]
      ? labelSizeSelect.value
      : "50x30";
    const selected = LABEL_SIZES[selectedKey];
    const codeRow = labelCode.closest(".label-code");
    const brandRow = labelBrand.closest(".label-type");
    const modelRow = labelModel.closest(".label-model");
    const conditionRow = labelCondition.closest(".label-condition");
    const brandTitle = thermalLabel.querySelector(".label-brand-text");
    const brandPhone = thermalLabel.querySelector(".label-phone");
    const brandAddress = thermalLabel.querySelector(".label-address");

    thermalLabel.classList.remove("label-content--compact");
    [codeRow, brandRow, modelRow, conditionRow, brandTitle, brandPhone, brandAddress].forEach((element) => {
      if (element) {
        element.style.removeProperty("font-size");
      }
    });

    shrinkSingleLine(brandTitle, 6.5);
    shrinkSingleLine(brandPhone, 5.5);
    shrinkSingleLine(brandAddress, 5.5);
    shrinkSingleLine(codeRow, selected.minCodeFont);
    shrinkSingleLine(brandRow, selected.minBrandFont);
    shrinkSingleLine(modelRow, selected.minModelFont);
    shrinkConditionToFit(conditionRow, selected.minConditionFont, selected.conditionLines);

    if (
      conditionRow.scrollHeight > conditionRow.clientHeight + 1
      || thermalLabel.scrollHeight > thermalLabel.clientHeight + 1
    ) {
      thermalLabel.classList.add("label-content--compact");
      shrinkConditionToFit(conditionRow, selected.minConditionFont, selected.conditionLines);
    }
  }

  function scheduleLabelFit() {
    if (pendingFitFrame !== null) {
      window.cancelAnimationFrame(pendingFitFrame);
    }

    pendingFitFrame = window.requestAnimationFrame(function () {
      pendingFitFrame = null;
      fitLabelContent();
    });
  }

  function renderLabel(ticket) {
    const displayBrand = normalizeLabelBrand(ticket.brand);

    labelCode.textContent = textOrBlank(ticket.ticket_code);
    labelBrand.textContent = displayBrand;
    labelModel.textContent = textOrBlank(ticket.model);
    labelCondition.textContent = textOrBlank(ticket.condition_text);
    labelDate.textContent = formatDate(ticket.received_date);
    classifyLabelContent(ticket, displayBrand);
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
      && !window.confirm(`In tem và bắt đầu sửa chữa phiếu ${currentTicket.ticket_code || ""}?`)
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

(function () {
  "use strict";

  const BLANK_LINE = "—";
  const LONG_BLANK_LINE = "—";
  const BLANK_DATE = "...... / ...... / ........";
  const STORE_ADDRESS = "";
  const RECEIPT_FORMATS = {
    a5: {
      label: "A5",
      bodyClass: "print-format-a5",
      receiptClass: "receipt-format-a5"
    },
    a4: {
      label: "A4",
      bodyClass: "print-format-a4",
      receiptClass: "receipt-format-a4"
    }
  };
  const WARRANTY_MODES = {
    MANUAL_DATE_RANGE: "Bảo hành theo ngày",
    AUTO_MONTHS: "Bảo hành theo tháng",
    NONE: "KHÔNG BẢO HÀNH"
  };
  const PRINT_NOTICE = "Phiếu đã chuyển trạng thái. Trường hợp chưa in được, hãy dùng chức năng Chỉ in lại.";

  const notice = document.getElementById("receiptNotice");
  const printButton = document.getElementById("printReceiptButton");
  const receiptPreviewViewport = document.getElementById("receiptPreviewViewport");
  const receiptPreviewSizer = document.getElementById("receiptPreviewSizer");
  const deliveryReceipt = document.getElementById("deliveryReceipt");
  const receiptTitle = document.getElementById("receiptTitle");
  const selectedFormatStatus = document.getElementById("receiptSelectedFormat");
  const formatInputs = Array.from(document.querySelectorAll('input[name="receiptFormat"]'));
  const workflowHint = document.getElementById("receiptWorkflowHint");
  const deliveryDateInput = document.getElementById("deliveryDateInput");
  const warrantyStartInput = document.getElementById("warrantyStartInput");
  const warrantyEndInput = document.getElementById("warrantyEndInput");
  const warrantyAutoStartInput = document.getElementById("warrantyAutoStartInput");
  const warrantyAutoEndInput = document.getElementById("warrantyAutoEndInput");
  const warrantyMonthsSelect = document.getElementById("warrantyMonthsSelect");
  const warrantyCustomMonthsInput = document.getElementById("warrantyCustomMonthsInput");
  const warrantyCustomMonthsField = document.getElementById("warrantyCustomMonthsField");
  const warrantyContentInput = document.getElementById("warrantyContentInput");

  let currentTicket = null;
  let currentWorkflowAction = null;
  let currentReceiptFormat = "a5";
  let deliveryDateTouched = false;
  let previewScaleFrame = 0;
  let previewResizeObserver = null;

  const textFields = {
    receiptCodeTop: BLANK_LINE,
    receiptCodeInfo: BLANK_LINE,
    receiptDeliveryDateTop: BLANK_DATE,
    receiptStoreAddress: BLANK_LINE,
    receiptCustomerName: BLANK_LINE,
    receiptCustomerPhone: BLANK_LINE,
    receiptCustomerAddress: BLANK_LINE,
    receiptCustomerCode: BLANK_LINE,
    receiptDeviceType: BLANK_LINE,
    receiptBrand: BLANK_LINE,
    receiptModel: BLANK_LINE,
    receiptSize: BLANK_LINE,
    receiptSerial: BLANK_LINE,
    receiptInitialCondition: LONG_BLANK_LINE,
    receiptA4Condition: LONG_BLANK_LINE,
    receiptA4Appearance: LONG_BLANK_LINE,
    receiptA4Accessories: LONG_BLANK_LINE,
    receiptRepairContent: LONG_BLANK_LINE,
    receiptRepairItems: LONG_BLANK_LINE,
    receiptRepairParts: LONG_BLANK_LINE,
    receiptTechnicalNote: LONG_BLANK_LINE,
    receiptAccessories: LONG_BLANK_LINE,
    receiptDepositAmount: BLANK_LINE,
    receiptEstimatedPrice: BLANK_LINE,
    receiptFinalPrice: BLANK_LINE,
    receiptRemainingAmount: BLANK_LINE,
    receiptReceivedDate: BLANK_DATE,
    receiptDeliveryDate: BLANK_DATE,
    receiptWarrantyMode: BLANK_LINE,
    receiptWarrantyStart: BLANK_DATE,
    receiptWarrantyEnd: BLANK_DATE,
    receiptWarrantyContent: LONG_BLANK_LINE
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

  function getCurrentFormatLabel() {
    return RECEIPT_FORMATS[currentReceiptFormat].label;
  }

  function updateFormatStatus() {
    if (selectedFormatStatus) {
      selectedFormatStatus.textContent = `Khổ đang chọn: ${getCurrentFormatLabel()}`;
    }
  }

  function updatePrintButtonText() {
    if (!printButton || !currentWorkflowAction) {
      return;
    }

    const formatLabel = getCurrentFormatLabel();

    if (currentWorkflowAction === "PRINT_AND_COMPLETE") {
      printButton.textContent = `In biên nhận ${formatLabel} & hoàn thành phiếu`;
      return;
    }

    if (currentWorkflowAction === "REPRINT_RECEIPT") {
      printButton.textContent = `Chỉ in lại biên nhận ${formatLabel}`;
    }
  }

  function getNumberStyle(element, property) {
    const value = Number.parseFloat(window.getComputedStyle(element).getPropertyValue(property));
    return Number.isFinite(value) ? value : 0;
  }

  function updateReceiptPreviewScale() {
    if (!receiptPreviewViewport || !receiptPreviewSizer || !deliveryReceipt) {
      return;
    }

    const viewportStyle = window.getComputedStyle(receiptPreviewViewport);
    const safePadding = getNumberStyle(receiptPreviewViewport, "padding-left")
      + getNumberStyle(receiptPreviewViewport, "padding-right");
    const availableWidth = Math.max(1, receiptPreviewViewport.clientWidth - safePadding);
    const paperWidth = Math.max(deliveryReceipt.offsetWidth, deliveryReceipt.scrollWidth, 1);
    const paperHeight = Math.max(deliveryReceipt.offsetHeight, deliveryReceipt.scrollHeight, 1);
    const rawScale = availableWidth / paperWidth;
    const scale = Math.min(1, Math.max(0.35, Number.isFinite(rawScale) ? rawScale : 1));

    receiptPreviewSizer.style.setProperty("--receipt-paper-width", `${paperWidth}px`);
    receiptPreviewSizer.style.setProperty("--receipt-paper-height", `${paperHeight}px`);
    receiptPreviewSizer.style.setProperty("--receipt-preview-width", `${Math.ceil(paperWidth * scale)}px`);
    receiptPreviewSizer.style.setProperty("--receipt-preview-height", `${Math.ceil(paperHeight * scale)}px`);
    receiptPreviewSizer.style.setProperty("--receipt-preview-scale", String(scale));
    receiptPreviewSizer.dataset.previewScale = scale.toFixed(3);
    receiptPreviewSizer.dataset.availableWidth = String(Math.round(availableWidth));
    receiptPreviewSizer.dataset.paperWidth = String(Math.round(paperWidth));

    if (viewportStyle.overflowX === "hidden") {
      receiptPreviewViewport.style.overflowX = "auto";
    }
  }

  function scheduleReceiptPreviewScale() {
    if (previewScaleFrame) {
      window.cancelAnimationFrame(previewScaleFrame);
    }

    previewScaleFrame = window.requestAnimationFrame(function () {
      previewScaleFrame = 0;
      updateReceiptPreviewScale();
    });
  }

  function setReceiptFormat(format) {
    const normalized = RECEIPT_FORMATS[format] ? format : "a5";
    const active = RECEIPT_FORMATS[normalized];

    currentReceiptFormat = normalized;

    Object.values(RECEIPT_FORMATS).forEach((item) => {
      document.body.classList.remove(item.bodyClass);
      if (deliveryReceipt) {
        deliveryReceipt.classList.remove(item.receiptClass);
      }
    });

    document.body.classList.add(active.bodyClass);
    if (deliveryReceipt) {
      deliveryReceipt.classList.add(active.receiptClass);
    }

    if (receiptTitle) {
      receiptTitle.textContent = normalized === "a4"
        ? "BIÊN NHẬN GIAO/TRẢ THIẾT BỊ SAU SỬA CHỮA"
        : "BIÊN NHẬN GIAO HÀNG / TRẢ MÁY SAU SỬA CHỮA";
    }

    formatInputs.forEach((input) => {
      input.checked = input.value === normalized;
    });

    updateFormatStatus();
    updatePrintButtonText();
    scheduleReceiptPreviewScale();
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

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function todayInVietnam() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());

    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
  }

  function parseDateParts(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());

    if (!match) {
      return null;
    }

    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3])
    };
  }

  function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  function addMonthsClamped(dateValue, months) {
    const parts = parseDateParts(dateValue);
    const monthCount = Number(months);

    if (!parts || !Number.isInteger(monthCount)) {
      return "";
    }

    const zeroMonth = parts.month - 1 + monthCount;
    const targetYear = parts.year + Math.floor(zeroMonth / 12);
    const targetMonthIndex = ((zeroMonth % 12) + 12) % 12;
    const targetMonth = targetMonthIndex + 1;
    const targetDay = Math.min(parts.day, daysInMonth(targetYear, targetMonth));

    return `${targetYear}-${pad2(targetMonth)}-${pad2(targetDay)}`;
  }

  function formatDate(value) {
    const parts = parseDateParts(value);

    if (!parts) {
      return value ? String(value) : BLANK_DATE;
    }

    return `${pad2(parts.day)}/${pad2(parts.month)}/${parts.year}`;
  }

  function toNumberOrNull(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }

    const text = String(value).trim();
    if (!text) {
      return null;
    }

    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  function formatMoney(value) {
    const number = toNumberOrNull(value);

    if (number === null) {
      return BLANK_LINE;
    }

    return `${new Intl.NumberFormat("vi-VN").format(number)} ₫`;
  }

  function formatSize(value) {
    const text = String(value || "").trim();

    if (!text) {
      return BLANK_LINE;
    }

    if (/inch|in|["”]/i.test(text)) {
      return text;
    }

    return `${text} inch`;
  }

  function valueOrBlank(value, fallback) {
    const text = String(value || "").trim();
    return text || fallback;
  }

  function setText(id, value, fallback) {
    const element = document.getElementById(id);

    if (!element) {
      return;
    }

    element.textContent = valueOrBlank(value, fallback || textFields[id] || BLANK_LINE);
  }

  function setDate(id, value) {
    const element = document.getElementById(id);

    if (!element) {
      return;
    }

    element.textContent = formatDate(value);
  }

  function getSelectedWarrantyMode() {
    const checked = document.querySelector('input[name="warrantyMode"]:checked');
    return checked ? checked.value : "MANUAL_DATE_RANGE";
  }

  function setSelectedWarrantyMode(mode) {
    const normalized = WARRANTY_MODES[mode] ? mode : "MANUAL_DATE_RANGE";
    const input = document.querySelector(`input[name="warrantyMode"][value="${normalized}"]`);

    if (input) {
      input.checked = true;
    }

    syncWarrantyPanels();
  }

  function setPanelDisabled(panel, disabled) {
    panel.querySelectorAll("input, select, textarea").forEach((input) => {
      input.disabled = disabled;
    });
  }

  function syncWarrantyPanels() {
    const mode = getSelectedWarrantyMode();

    document.querySelectorAll("[data-warranty-panel]").forEach((panel) => {
      const active = panel.dataset.warrantyPanel === mode;
      panel.classList.toggle("hidden", !active);
      setPanelDisabled(panel, !active);
    });

    if (warrantyCustomMonthsField && warrantyMonthsSelect) {
      const custom = warrantyMonthsSelect.value === "custom";
      warrantyCustomMonthsField.classList.toggle("hidden", !custom || mode !== "AUTO_MONTHS");
      if (warrantyCustomMonthsInput) {
        warrantyCustomMonthsInput.disabled = mode !== "AUTO_MONTHS" || !custom;
      }
    }

    refreshWarrantyPreview();
  }

  function getWarrantyMonths(validate) {
    if (!warrantyMonthsSelect) {
      return null;
    }

    const raw = warrantyMonthsSelect.value === "custom"
      ? warrantyCustomMonthsInput && warrantyCustomMonthsInput.value
      : warrantyMonthsSelect.value;
    const months = Number(raw);

    if (!Number.isInteger(months) || months < 1 || months > 60) {
      if (validate) {
        throw new Error("Vui lòng nhập số tháng bảo hành từ 1 đến 60.");
      }

      return null;
    }

    return months;
  }

  function buildWarrantyPayload(options) {
    const shouldValidate = options && options.validate;
    const deliveryDate = deliveryDateInput && deliveryDateInput.value ? deliveryDateInput.value : "";
    const mode = getSelectedWarrantyMode();
    const note = warrantyContentInput ? warrantyContentInput.value.trim() : "";

    if (shouldValidate && !deliveryDate) {
      throw new Error("Vui lòng nhập ngày giao/trả máy.");
    }

    if (note.length > 500) {
      throw new Error("Nội dung bảo hành tối đa 500 ký tự.");
    }

    if (mode === "NONE") {
      return {
        delivery_date: deliveryDate || null,
        warranty_mode: "NONE",
        warranty_start_date: null,
        warranty_end_date: null,
        warranty_months: null,
        warranty_note: note || null
      };
    }

    if (mode === "AUTO_MONTHS") {
      const startDate = todayInVietnam();
      const months = getWarrantyMonths(shouldValidate);
      const endDate = months ? addMonthsClamped(startDate, months) : "";

      if (warrantyAutoStartInput) {
        warrantyAutoStartInput.value = startDate;
      }

      if (warrantyAutoEndInput) {
        warrantyAutoEndInput.value = endDate;
      }

      return {
        delivery_date: deliveryDate || null,
        warranty_mode: "AUTO_MONTHS",
        warranty_start_date: startDate,
        warranty_end_date: endDate || null,
        warranty_months: months,
        warranty_note: note || null
      };
    }

    const startDate = warrantyStartInput && warrantyStartInput.value ? warrantyStartInput.value : "";
    const endDate = warrantyEndInput && warrantyEndInput.value ? warrantyEndInput.value : "";

    if (shouldValidate && (!startDate || !endDate)) {
      throw new Error("Vui lòng nhập đầy đủ ngày bắt đầu và ngày hết hạn bảo hành.");
    }

    if (shouldValidate && startDate && endDate && endDate < startDate) {
      throw new Error("Ngày hết hạn bảo hành phải sau hoặc bằng ngày bắt đầu bảo hành.");
    }

    return {
      delivery_date: deliveryDate || null,
      warranty_mode: "MANUAL_DATE_RANGE",
      warranty_start_date: startDate || null,
      warranty_end_date: endDate || null,
      warranty_months: null,
      warranty_note: note || null
    };
  }

  function renderWarrantyPreview(payload) {
    const data = payload || {};
    const mode = data.warranty_mode || "MANUAL_DATE_RANGE";

    setDate("receiptDeliveryDateTop", data.delivery_date);
    setDate("receiptDeliveryDate", data.delivery_date);
    setText("receiptWarrantyMode", WARRANTY_MODES[mode] || WARRANTY_MODES.MANUAL_DATE_RANGE);

    if (mode === "NONE") {
      setDate("receiptWarrantyStart", null);
      setDate("receiptWarrantyEnd", null);
      setText("receiptWarrantyContent", data.warranty_note || WARRANTY_MODES.NONE, LONG_BLANK_LINE);
      return;
    }

    setDate("receiptWarrantyStart", data.warranty_start_date);
    setDate("receiptWarrantyEnd", data.warranty_end_date);

    if (mode === "AUTO_MONTHS" && data.warranty_months) {
      setText(
        "receiptWarrantyContent",
        data.warranty_note || `Bảo hành ${data.warranty_months} tháng theo hạng mục đã sửa chữa/thay thế.`,
        LONG_BLANK_LINE
      );
      return;
    }

    setText("receiptWarrantyContent", data.warranty_note, LONG_BLANK_LINE);
    scheduleReceiptPreviewScale();
  }

  function buildReceiptViewModel(ticket) {
    const deposit = toNumberOrNull(ticket.deposit_amount);
    const finalPrice = toNumberOrNull(ticket.final_price);
    const remaining = finalPrice === null ? null : finalPrice - (deposit || 0);
    const customerName = ticket.customer_master_name || ticket.customer_name;
    const customerPhone = ticket.customer_master_phone || ticket.customer_phone;
    const customerAddress = ticket.customer_master_address || ticket.customer_address;
    const appearance = ticket.external_condition;
    const condition = ticket.condition_text;

    return {
      ticketCode: ticket.ticket_code || "",
      customerCode: ticket.customer_code,
      customerName,
      customerPhone,
      customerAddress,
      deviceType: ticket.device_type || "Tivi",
      brand: ticket.brand,
      model: ticket.model,
      size: formatSize(ticket.size),
      serial: ticket.serial_number,
      receivedDate: ticket.received_date,
      deliveryDate: ticket.delivery_date,
      condition,
      appearance,
      accessories: appearance,
      repairContent: null,
      repairItems: null,
      repairParts: null,
      technicalNote: ticket.internal_note,
      depositAmount: formatMoney(deposit),
      estimatedPrice: formatMoney(ticket.estimated_price),
      finalPrice: formatMoney(finalPrice),
      remainingAmount: formatMoney(remaining),
      storeAddress: STORE_ADDRESS
    };
  }

  function renderReceiptFields(viewModel) {
    const storeAddressLine = document.querySelector(".receipt-brand-address");

    setText("receiptCodeTop", viewModel.ticketCode);
    setText("receiptCodeInfo", viewModel.ticketCode);
    setText("receiptCustomerCode", viewModel.customerCode);
    setText("receiptCustomerName", viewModel.customerName);
    setText("receiptCustomerPhone", viewModel.customerPhone);
    setText("receiptCustomerAddress", viewModel.customerAddress);
    setText("receiptDeviceType", viewModel.deviceType);
    setText("receiptBrand", viewModel.brand);
    setText("receiptModel", viewModel.model);
    setText("receiptSize", viewModel.size);
    setText("receiptSerial", viewModel.serial);
    setText("receiptInitialCondition", viewModel.condition, LONG_BLANK_LINE);
    setText("receiptAccessories", viewModel.accessories, LONG_BLANK_LINE);
    setText("receiptA4Condition", viewModel.condition, LONG_BLANK_LINE);
    setText("receiptA4Appearance", viewModel.appearance, LONG_BLANK_LINE);
    setText("receiptA4Accessories", viewModel.accessories, LONG_BLANK_LINE);
    setText("receiptRepairContent", viewModel.repairContent, LONG_BLANK_LINE);
    setText("receiptRepairItems", viewModel.repairItems, LONG_BLANK_LINE);
    setText("receiptRepairParts", viewModel.repairParts, LONG_BLANK_LINE);
    setText("receiptTechnicalNote", viewModel.technicalNote, LONG_BLANK_LINE);
    setText("receiptDepositAmount", viewModel.depositAmount);
    setText("receiptEstimatedPrice", viewModel.estimatedPrice);
    setText("receiptFinalPrice", viewModel.finalPrice);
    setText("receiptRemainingAmount", viewModel.remainingAmount);
    setText("receiptStoreAddress", viewModel.storeAddress);
    setDate("receiptReceivedDate", viewModel.receivedDate);
    setDate("receiptDeliveryDateTop", viewModel.deliveryDate);

    if (storeAddressLine) {
      storeAddressLine.classList.toggle("hidden", !String(viewModel.storeAddress || "").trim());
    }

    scheduleReceiptPreviewScale();
  }

  function renderA5Receipt(viewModel) {
    renderReceiptFields(viewModel);
  }

  function renderA4Receipt(viewModel) {
    renderReceiptFields(viewModel);
  }

  function refreshWarrantyPreview() {
    try {
      renderWarrantyPreview(buildWarrantyPayload({ validate: false }));
    } catch (error) {
      // Live preview should stay forgiving while the user is typing.
    }
  }

  function applyTicketWarrantyToControls(ticket) {
    const savedMode = ticket.warranty_mode && WARRANTY_MODES[ticket.warranty_mode]
      ? ticket.warranty_mode
      : "MANUAL_DATE_RANGE";
    const today = todayInVietnam();

    if (deliveryDateInput && (!deliveryDateTouched || ticket.delivery_date)) {
      deliveryDateInput.value = ticket.delivery_date || deliveryDateInput.value || today;
    }

    setSelectedWarrantyMode(savedMode);

    if (warrantyStartInput) {
      warrantyStartInput.value = ticket.warranty_start_date || "";
    }

    if (warrantyEndInput) {
      warrantyEndInput.value = ticket.warranty_end_date || "";
    }

    if (warrantyAutoStartInput) {
      warrantyAutoStartInput.value = ticket.warranty_start_date || today;
    }

    if (warrantyMonthsSelect) {
      const months = Number(ticket.warranty_months || 6);
      if ([3, 6, 9, 12].includes(months)) {
        warrantyMonthsSelect.value = String(months);
      } else {
        warrantyMonthsSelect.value = "custom";
        if (warrantyCustomMonthsInput) {
          warrantyCustomMonthsInput.value = Number.isInteger(months) ? String(months) : "";
        }
      }
    }

    if (warrantyContentInput) {
      warrantyContentInput.value = ticket.warranty_note || "";
    }

    syncWarrantyPanels();
    renderWarrantyPreview({
      delivery_date: deliveryDateInput && deliveryDateInput.value,
      warranty_mode: savedMode,
      warranty_start_date: ticket.warranty_start_date || (savedMode === "AUTO_MONTHS" ? today : null),
      warranty_end_date: ticket.warranty_end_date || (savedMode === "AUTO_MONTHS" ? addMonthsClamped(today, Number(ticket.warranty_months || 6)) : null),
      warranty_months: ticket.warranty_months || (savedMode === "AUTO_MONTHS" ? Number(warrantyMonthsSelect && warrantyMonthsSelect.value) || 6 : null),
      warranty_note: ticket.warranty_note || null
    });
  }

  function setReceiptControlsReadonly(readonly) {
    document.querySelectorAll(".receipt-temp-grid input, .receipt-temp-grid select, .receipt-temp-grid textarea").forEach((input) => {
      input.disabled = readonly;
    });
  }

  function attachTempInputs() {
    if (deliveryDateInput) {
      deliveryDateInput.addEventListener("input", function () {
        deliveryDateTouched = true;
        refreshWarrantyPreview();
      });
    }

    document.querySelectorAll('input[name="warrantyMode"]').forEach((input) => {
      input.addEventListener("change", syncWarrantyPanels);
    });

    [
      warrantyStartInput,
      warrantyEndInput,
      warrantyMonthsSelect,
      warrantyCustomMonthsInput,
      warrantyContentInput
    ].forEach((input) => {
      if (input) {
        input.addEventListener("input", refreshWarrantyPreview);
        input.addEventListener("change", refreshWarrantyPreview);
      }
    });
  }

  function attachFormatControls() {
    formatInputs.forEach((input) => {
      input.addEventListener("change", function () {
        if (input.checked) {
          setReceiptFormat(input.value);
        }
      });
    });

    setReceiptFormat(currentReceiptFormat);
  }

  function attachPreviewScaleObservers() {
    window.addEventListener("resize", scheduleReceiptPreviewScale);

    if (window.ResizeObserver && receiptPreviewViewport && deliveryReceipt) {
      previewResizeObserver = new ResizeObserver(scheduleReceiptPreviewScale);
      previewResizeObserver.observe(receiptPreviewViewport);
      previewResizeObserver.observe(deliveryReceipt);
    }

    document.querySelectorAll(".receipt-logo").forEach((image) => {
      if (!image.complete) {
        image.addEventListener("load", scheduleReceiptPreviewScale, { once: true });
        image.addEventListener("error", scheduleReceiptPreviewScale, { once: true });
      }
    });
  }

  function renderTicket(ticket) {
    const viewModel = buildReceiptViewModel(ticket);

    if (currentReceiptFormat === "a4") {
      renderA4Receipt(viewModel);
    } else {
      renderA5Receipt(viewModel);
    }

    applyTicketWarrantyToControls(ticket);
  }

  function canPrintAndComplete(ticket) {
    return ticket.status === "đang sửa"
      && Boolean(ticket.repair_started_at)
      && !ticket.completed_at;
  }

  function canReprintReceipt(ticket) {
    return ticket.status === "đã trả" && Boolean(ticket.completed_at);
  }

  function renderWorkflowControls(ticket) {
    currentWorkflowAction = null;
    printButton.disabled = false;
    setReceiptControlsReadonly(false);

    if (!ticket.workflow_available) {
      printButton.disabled = true;
      printButton.textContent = "Workflow chưa kích hoạt";
      setWorkflowHint(ticket.workflow_inactive_message || "Workflow chưa được kích hoạt. Cần triển khai backend workflow trước khi in biên nhận theo quy trình mới.");
      return;
    }

    if (canPrintAndComplete(ticket)) {
      currentWorkflowAction = "PRINT_AND_COMPLETE";
      updatePrintButtonText();
      setWorkflowHint("Chỉ bấm khi thiết bị đang được giao/trả cho khách. RPC thành công mới mở Print Preview và lưu thông tin bảo hành.");
      return;
    }

    if (canReprintReceipt(ticket)) {
      currentWorkflowAction = "REPRINT_RECEIPT";
      setReceiptControlsReadonly(true);
      updatePrintButtonText();
      setWorkflowHint("In lại biên nhận chỉ đọc dữ liệu giao/trả và bảo hành đã lưu, không tạo hoặc ghi đè dữ liệu bảo hành.");
      return;
    }

    printButton.disabled = true;
    printButton.textContent = "Chưa đủ điều kiện in";
    setWorkflowHint("Phiếu chưa bắt đầu sửa hoặc dữ liệu workflow cũ chưa đầy đủ. Vui lòng kiểm tra lại trước khi in biên nhận.");
  }

  async function runWorkflowAndPrint() {
    if (!currentTicket || !currentWorkflowAction) {
      return;
    }

    const action = currentWorkflowAction;
    let workflowPayload = null;

    try {
      if (action === "PRINT_AND_COMPLETE") {
        workflowPayload = buildWarrantyPayload({ validate: true });
        renderWarrantyPreview(workflowPayload);
      }
    } catch (error) {
      showNotice("error", error.message);
      return;
    }

    if (
      action === "PRINT_AND_COMPLETE"
      && !window.confirm("Chỉ tiếp tục khi đang giao/trả thiết bị cho khách.\nThao tác này sẽ lưu thông tin bảo hành và hoàn thành phiếu.")
    ) {
      return;
    }

    printButton.disabled = true;
    printButton.textContent = "Đang xử lý...";
    clearNotice();

    let requestId = null;

    try {
      requestId = window.AMApi.ensureWorkflowClientRequestId(currentTicket.id, action);
      const result = await window.AMApi.recordTicketWorkflowAction(currentTicket.id, action, requestId, workflowPayload);
      window.AMApi.clearWorkflowClientRequestId(currentTicket.id, action);

      currentTicket = Object.assign({}, currentTicket, {
        status: result.status,
        repair_started_at: result.repair_started_at,
        completed_at: result.completed_at,
        last_activity_at: result.last_activity_at || result.activity_created_at,
        delivery_date: result.delivery_date,
        warranty_mode: result.warranty_mode,
        warranty_start_date: result.warranty_start_date,
        warranty_end_date: result.warranty_end_date,
        warranty_months: result.warranty_months,
        warranty_note: result.warranty_note,
        workflow_available: true
      });

      renderTicket(currentTicket);
      renderWorkflowControls(currentTicket);

      if (action === "PRINT_AND_COMPLETE") {
        showNotice("success", PRINT_NOTICE);
      }

      window.print();
    } catch (error) {
      if (requestId && window.AMApi.shouldClearWorkflowClientRequestId(error)) {
        window.AMApi.clearWorkflowClientRequestId(currentTicket.id, action);
      }

      showNotice("error", error.message);
      renderWorkflowControls(currentTicket);
    }
  }

  async function loadTicketFromParams() {
    const params = new URLSearchParams(window.location.search);
    const code = String(params.get("code") || "").trim();
    const id = String(params.get("id") || "").trim();

    return window.AMApi.getTicketForDeliveryReceipt({ code, id });
  }

  async function initReceipt() {
    attachLogout();
    attachFormatControls();
    attachTempInputs();
    attachPreviewScaleObservers();
    printButton.addEventListener("click", runWorkflowAndPrint);

    try {
      const access = await window.AMApi.requireInternalAccess();
      if (!access) {
        return;
      }

      const ticket = await loadTicketFromParams();

      if (!ticket) {
        showNotice("error", "Không tìm thấy phiếu để in biên nhận.");
        printButton.disabled = true;
        return;
      }

      currentTicket = ticket;
      renderTicket(ticket);
      renderWorkflowControls(ticket);
      clearNotice();
    } catch (error) {
      showNotice("error", error.message);
      printButton.disabled = true;
    }
  }

  document.addEventListener("DOMContentLoaded", initReceipt);
})();

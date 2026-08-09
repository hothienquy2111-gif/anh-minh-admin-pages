(function () {
  "use strict";

  const UNSAVED_MESSAGE = "Dữ liệu chứng từ chưa được lưu. Rời trang sẽ làm mất nội dung đã nhập.";
  const MAX_SAFE_AMOUNT = Number.MAX_SAFE_INTEGER;
  const DEFAULT_DOCUMENT_TITLE = "BÁO GIÁ";
  const DEFAULT_DEBT_TITLE = "XÁC NHẬN CÔNG NỢ";
  const DOCX_PRIMARY_FONT = "Be Vietnam Pro";
  const DOCX_FALLBACK_FONT = "Arial";
  const QUOTE_ROWS_PER_PAGE = 8;
  const DEBT_ROWS_PER_PAGE = 7;
  const DATE_FIELDS = new Set([
    "documentDate",
    "dueDate",
    "validUntil",
    "debtDate",
    "debtPeriodStart",
    "debtPeriodEnd",
    "debtPaymentDueDate"
  ]);
  const MONEY_FIELDS = new Set([
    "invoiceDiscountAmount",
    "invoiceShipping",
    "invoiceSurcharge",
    "invoicePaid",
    "debtOpeningBalance",
    "debtPaidAmount"
  ]);

  const refs = {};
  const state = {
    mode: "invoice",
    zoom: "100",
    dirty: false,
    renderTimer: null,
    resizeFrame: null,
    exportBusy: false,
    lastPrintWasPdf: false,
    form: {},
    invoiceItems: [],
    debtItems: []
  };

  function qs(selector, root) {
    return (root || document).querySelector(selector);
  }

  function qsa(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  function createInvoiceItem() {
    return {
      model: "",
      description: "",
      unit: "cái",
      quantity: "1",
      unitPrice: "",
      discount: ""
    };
  }

  function createDebtItem() {
    return {
      date: "",
      description: "",
      reference: "",
      dueDate: "",
      amount: "",
      paid: "",
      note: ""
    };
  }

  function localDateValue(date) {
    const source = date || new Date();
    const year = source.getFullYear();
    const month = String(source.getMonth() + 1).padStart(2, "0");
    const day = String(source.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function clampSafeAmount(value) {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.max(-MAX_SAFE_AMOUNT, Math.min(MAX_SAFE_AMOUNT, Math.trunc(value)));
  }

  function parseMoney(value) {
    const raw = String(value == null ? "" : value).trim();
    if (!raw) {
      return 0;
    }

    const negative = raw.startsWith("-");
    const digits = raw.replace(/[^0-9]/g, "");
    if (!digits) {
      return 0;
    }

    const parsed = Number(digits);
    if (!Number.isFinite(parsed)) {
      return negative ? -MAX_SAFE_AMOUNT : MAX_SAFE_AMOUNT;
    }
    return negative ? -clampSafeAmount(parsed) : clampSafeAmount(parsed);
  }

  function parseRate(value) {
    const raw = String(value == null ? "" : value).trim().replace(/\s/g, "");
    if (!raw) {
      return 0;
    }
    const normalized = raw.replace(",", ".");
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) {
      return 0;
    }
    return Math.max(0, Math.min(100, parsed));
  }

  function parseQuantity(value) {
    const raw = String(value == null ? "" : value).trim().replace(/\s/g, "");
    if (!raw) {
      return 0;
    }
    const parsed = Number(raw.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 0;
    }
    return Math.min(1000000000, Math.round(parsed * 1000));
  }

  function multiplyQuantityByMoney(quantityScaled, money) {
    return clampSafeAmount(Math.round((quantityScaled * money) / 1000));
  }

  function formatInteger(value) {
    return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(clampSafeAmount(value));
  }

  function formatVnd(value) {
    return `${formatInteger(value)} ₫`;
  }

  function formatInputMoney(value) {
    return formatInteger(parseMoney(value));
  }

  function formatDate(value) {
    const raw = String(value || "").trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : raw || "—";
  }

  function displayValue(value) {
    const text = String(value == null ? "" : value).trim();
    return text || "—";
  }

  function capitalize(value) {
    const text = String(value || "").trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  }

  function readThreeDigits(value, full) {
    const digits = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];
    const hundreds = Math.floor(value / 100);
    const remainder = value % 100;
    const tens = Math.floor(remainder / 10);
    const ones = remainder % 10;
    const words = [];

    if (hundreds > 0 || full) {
      words.push(`${digits[hundreds]} trăm`);
    }

    if (tens > 1) {
      words.push(`${digits[tens]} mươi`);
      if (ones === 1) {
        words.push("mốt");
      } else if (ones === 4) {
        words.push("tư");
      } else if (ones === 5) {
        words.push("lăm");
      } else if (ones > 0) {
        words.push(digits[ones]);
      }
    } else if (tens === 1) {
      words.push("mười");
      if (ones === 5) {
        words.push("lăm");
      } else if (ones > 0) {
        words.push(digits[ones]);
      }
    } else if (ones > 0) {
      if (hundreds > 0 || full) {
        words.push("lẻ");
      }
      words.push(digits[ones]);
    }

    return words.join(" ");
  }

  function numberToVietnamese(value) {
    const amount = clampSafeAmount(Math.round(Number(value) || 0));
    if (amount === 0) {
      return "Không đồng";
    }

    const negative = amount < 0;
    let remaining = Math.abs(amount);
    const groups = [];
    while (remaining > 0) {
      groups.push(remaining % 1000);
      remaining = Math.floor(remaining / 1000);
    }

    const units = ["", "nghìn", "triệu", "tỷ", "nghìn tỷ", "triệu tỷ"];
    const words = [];
    for (let index = groups.length - 1; index >= 0; index -= 1) {
      const group = groups[index];
      if (group === 0) {
        continue;
      }
      const needsFull = index < groups.length - 1 && group < 100;
      const groupWords = readThreeDigits(group, needsFull);
      if (groupWords) {
        words.push(groupWords);
        if (units[index]) {
          words.push(units[index]);
        }
      }
    }

    return `${negative ? "Âm " : ""}${capitalize(words.join(" "))} đồng`;
  }

  function setText(element, value) {
    if (element) {
      element.textContent = String(value == null ? "" : value);
    }
  }

  function makeElement(tagName, className, textValue) {
    const element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    if (textValue !== undefined) {
      element.textContent = String(textValue);
    }
    return element;
  }

  function formValue(field) {
    const input = qs(`[data-field="${field}"]`);
    return input ? input.value : "";
  }

  function setFormValue(field, value) {
    const input = qs(`[data-field="${field}"]`);
    if (input) {
      input.value = value == null ? "" : String(value);
    }
  }

  function defaultForm() {
    return {
      unitName: "ĐIỆN TỬ ANH MINH",
      unitAddress: "100 Tiểu La, Đà Nẵng",
      unitPhone: "0905111223 - 0774111223",
      unitEmail: "",
      unitTaxCode: "",
      unitContact: "",
      unitBankAccount: "",
      unitBankBranch: "",
      unitWebsite: "",
      unitNote: "",
      customerName: "",
      customerPhone: "",
      customerAddress: "",
      customerEmail: "",
      customerTaxCode: "",
      customerCode: "",
      customerRepresentative: "",
      customerPosition: "",
      customerReference: "",
      customerNote: "",
      documentTitle: DEFAULT_DOCUMENT_TITLE,
      documentNumber: "",
      documentDate: localDateValue(),
      dueDate: "",
      validUntil: "",
      documentPlace: "",
      documentPreparer: "",
      paymentMethod: "Tiền mặt",
      documentSubtitle: "",
      quotationIntroduction: "Công ty Điện Tử Anh Minh trân trọng gửi đến Quý khách bảng báo giá hàng hóa/dịch vụ với nội dung như sau:",
      paymentTerms: "",
      deliveryTime: "",
      warrantyPeriod: "",
      invoiceDiscountMode: "percent",
      invoiceDiscountRate: "0",
      invoiceDiscountAmount: "0",
      invoiceShipping: "0",
      invoiceSurcharge: "0",
      invoiceTaxRate: "0",
      invoicePaid: "0",
      invoicePaymentNote: "",
      invoiceNote: "",
      debtOpeningBalance: "0",
      debtPaidAmount: "0",
      debtPeriod: "",
      debtPeriodStart: "",
      debtPeriodEnd: "",
      debtPaymentDueDate: "",
      debtPaymentTerms: "",
      debtIntroduction: "Hai bên cùng đối chiếu và xác nhận các khoản công nợ phát sinh trong kỳ như sau:",
      debtTitle: DEFAULT_DEBT_TITLE,
      debtNumber: "",
      debtDate: localDateValue(),
      debtNote: ""
    };
  }

  function syncStateFromForm() {
    const nextForm = defaultForm();
    Object.keys(nextForm).forEach((field) => {
      nextForm[field] = formValue(field);
    });
    state.form = nextForm;

    state.invoiceItems = qsa("#invoiceItemsBody tr[data-row-index]").map((row) => ({
      model: qs('[data-row-field="model"]', row)?.value || "",
      description: qs('[data-row-field="description"]', row)?.value || "",
      unit: qs('[data-row-field="unit"]', row)?.value || "",
      quantity: qs('[data-row-field="quantity"]', row)?.value || "",
      unitPrice: qs('[data-row-field="unitPrice"]', row)?.value || "",
      discount: qs('[data-row-field="discount"]', row)?.value || ""
    }));

    state.debtItems = qsa("#debtItemsBody tr[data-row-index]").map((row) => ({
      date: qs('[data-row-field="date"]', row)?.value || "",
      description: qs('[data-row-field="description"]', row)?.value || "",
      reference: qs('[data-row-field="reference"]', row)?.value || "",
      dueDate: qs('[data-row-field="dueDate"]', row)?.value || "",
      amount: qs('[data-row-field="amount"]', row)?.value || "",
      paid: qs('[data-row-field="paid"]', row)?.value || "",
      note: qs('[data-row-field="note"]', row)?.value || ""
    }));
  }

  function markDirty() {
    state.dirty = true;
    setText(refs.draftState, "Đang soạn trong bộ nhớ");
  }

  function fieldInput(field, value, options) {
    const config = options || {};
    const input = makeElement(config.multiline ? "textarea" : "input");
    input.dataset.rowField = field;
    input.value = value == null ? "" : String(value);
    input.placeholder = config.placeholder || "";
    input.setAttribute("aria-label", config.label || field);
    if (!config.multiline) {
      input.type = config.type || "text";
      if (config.inputMode) {
        input.inputMode = config.inputMode;
      }
    }
    if (config.multiline) {
      input.rows = config.rows || 2;
    }
    return input;
  }

  function rowAction(action, label, textValue, remove) {
    const button = makeElement("button", `invoice-row-action${remove ? " invoice-row-action--remove" : ""}`, textValue);
    button.type = "button";
    button.dataset.rowAction = action;
    button.title = label;
    button.setAttribute("aria-label", label);
    return button;
  }

  function appendCell(row, child, className) {
    const cell = makeElement("td", className);
    if (child instanceof Node) {
      cell.appendChild(child);
    } else {
      cell.textContent = String(child == null ? "" : child);
    }
    row.appendChild(cell);
    return cell;
  }

  function renderInvoiceRows(items) {
    const body = refs.invoiceItemsBody;
    if (!body) {
      return;
    }
    const rows = Array.isArray(items) ? items : state.invoiceItems;
    body.replaceChildren();
    rows.forEach((item, index) => {
      const row = makeElement("tr");
      row.dataset.rowIndex = String(index);
      row.dataset.rowKind = "invoice";
      appendCell(row, String(index + 1));
      appendCell(row, fieldInput("model", item.model, {
        label: `Model / mã dòng ${index + 1}`,
        placeholder: "Model / mã hàng"
      }));
      appendCell(row, fieldInput("description", item.description, {
        label: `Nội dung dòng ${index + 1}`,
        placeholder: "Tên hàng hóa / dịch vụ",
        multiline: true,
        rows: 2
      }));
      appendCell(row, fieldInput("unit", item.unit, {
        label: `Đơn vị tính dòng ${index + 1}`,
        placeholder: "cái"
      }));
      appendCell(row, fieldInput("quantity", item.quantity, {
        label: `Số lượng dòng ${index + 1}`,
        inputMode: "decimal"
      }));
      appendCell(row, fieldInput("unitPrice", item.unitPrice, {
        label: `Đơn giá dòng ${index + 1}`,
        inputMode: "numeric"
      }));
      appendCell(row, fieldInput("discount", item.discount, {
        label: `Giảm trừ dòng ${index + 1}`,
        inputMode: "numeric"
      }));
      const total = makeElement("span", "invoice-row-total", formatVnd(calculateInvoiceLineTotal(item)));
      appendCell(row, total);
      const actions = makeElement("div", "invoice-row-actions");
      actions.append(
        rowAction("duplicate", "Nhân bản dòng", "＋"),
        rowAction("remove", "Xóa dòng", "×", rows.length === 1)
      );
      appendCell(row, actions);
      body.appendChild(row);
    });
  }

  function renderDebtRows(items) {
    const body = refs.debtItemsBody;
    if (!body) {
      return;
    }
    const rows = Array.isArray(items) ? items : state.debtItems;
    body.replaceChildren();
    rows.forEach((item, index) => {
      const row = makeElement("tr");
      row.dataset.rowIndex = String(index);
      row.dataset.rowKind = "debt";
      appendCell(row, String(index + 1));
      appendCell(row, fieldInput("date", item.date, {
        label: `Ngày phát sinh khoản ${index + 1}`,
        type: "date"
      }));
      appendCell(row, fieldInput("description", item.description, {
        label: `Diễn giải khoản ${index + 1}`,
        placeholder: "Khoản phải thu / phải trả",
        multiline: true,
        rows: 2
      }));
      appendCell(row, fieldInput("reference", item.reference, {
        label: `Tham chiếu khoản ${index + 1}`,
        placeholder: "Số phiếu / ghi chú"
      }));
      appendCell(row, fieldInput("dueDate", item.dueDate, {
        label: `Hạn khoản ${index + 1}`,
        type: "date"
      }));
      appendCell(row, fieldInput("amount", item.amount, {
        label: `Phát sinh khoản ${index + 1}`,
        inputMode: "numeric"
      }));
      appendCell(row, fieldInput("paid", item.paid, {
        label: `Đã trả khoản ${index + 1}`,
        inputMode: "numeric"
      }));
      const balance = makeElement("span", "invoice-debt-row-balance", formatVnd(parseMoney(item.amount) - parseMoney(item.paid)));
      appendCell(row, balance);
      appendCell(row, fieldInput("note", item.note, {
        label: `Ghi chú khoản ${index + 1}`,
        placeholder: "Ghi chú",
        multiline: true,
        rows: 2
      }));
      const actions = makeElement("div", "invoice-row-actions");
      actions.append(
        rowAction("duplicate", "Nhân bản khoản", "＋"),
        rowAction("remove", "Xóa khoản", "×", rows.length === 1)
      );
      appendCell(row, actions);
      body.appendChild(row);
    });
  }

  function calculateInvoiceLineTotal(item) {
    const gross = multiplyQuantityByMoney(parseQuantity(item.quantity), parseMoney(item.unitPrice));
    return Math.max(0, clampSafeAmount(gross - Math.max(0, parseMoney(item.discount))));
  }

  function calculateInvoiceTotals() {
    let subtotal = 0;
    let lineDiscount = 0;
    state.invoiceItems.forEach((item) => {
      subtotal += multiplyQuantityByMoney(parseQuantity(item.quantity), parseMoney(item.unitPrice));
      lineDiscount += Math.max(0, parseMoney(item.discount));
    });
    subtotal = clampSafeAmount(subtotal);
    lineDiscount = Math.min(subtotal, clampSafeAmount(lineDiscount));
    const beforeGeneralDiscount = Math.max(0, subtotal - lineDiscount);
    const discountMode = state.form.invoiceDiscountMode === "fixed" ? "fixed" : "percent";
    const rateDiscount = discountMode === "percent"
      ? Math.round(beforeGeneralDiscount * (parseRate(state.form.invoiceDiscountRate) / 100))
      : 0;
    const fixedDiscount = discountMode === "fixed"
      ? Math.min(beforeGeneralDiscount, Math.max(0, parseMoney(state.form.invoiceDiscountAmount)))
      : 0;
    const discount = clampSafeAmount(Math.min(subtotal, lineDiscount + rateDiscount + fixedDiscount));
    const shipping = Math.max(0, parseMoney(state.form.invoiceShipping));
    const surcharge = Math.max(0, parseMoney(state.form.invoiceSurcharge));
    const taxable = Math.max(0, subtotal - discount);
    const charges = clampSafeAmount(shipping + surcharge);
    const tax = Math.round((taxable + charges) * (parseRate(state.form.invoiceTaxRate) / 100));
    const total = clampSafeAmount(taxable + charges + tax);
    const paid = Math.max(0, parseMoney(state.form.invoicePaid));
    return {
      subtotal,
      lineDiscount,
      discount,
      shipping,
      surcharge,
      tax,
      total,
      paid,
      balance: clampSafeAmount(total - paid)
    };
  }

  function calculateDebtTotals() {
    const opening = parseMoney(state.form.debtOpeningBalance);
    const added = state.debtItems.reduce((sum, item) => sum + Math.max(0, parseMoney(item.amount)), 0);
    const paidRows = state.debtItems.reduce((sum, item) => sum + Math.max(0, parseMoney(item.paid)), 0);
    const paid = paidRows + Math.max(0, parseMoney(state.form.debtPaidAmount));
    return {
      opening: clampSafeAmount(opening),
      added: clampSafeAmount(added),
      total: clampSafeAmount(opening + added),
      paid: clampSafeAmount(paid),
      balance: clampSafeAmount(opening + added - paid)
    };
  }

  function totalCell(label, value, emphasis) {
    const cell = makeElement("div", `invoice-total-cell${emphasis ? " invoice-total-cell--emphasis" : ""}`);
    cell.append(makeElement("span", "", label), makeElement("strong", "", value));
    return cell;
  }

  function renderEditorTotals() {
    if (state.mode === "invoice") {
      const totals = calculateInvoiceTotals();
      refs.invoiceTotalsSummary.replaceChildren(
        totalCell("Tạm tính", formatVnd(totals.subtotal)),
        totalCell("Giảm trừ", formatVnd(totals.discount)),
        totalCell("Thuế", formatVnd(totals.tax)),
        totalCell("Phụ phí", formatVnd(totals.surcharge)),
        totalCell("Tổng cộng", formatVnd(totals.total), true),
        totalCell("Đã thanh toán", formatVnd(totals.paid)),
        totalCell(totals.balance >= 0 ? "Còn phải thu" : "Đã thanh toán dư", formatVnd(Math.abs(totals.balance)), true)
      );
      refs.debtTotalsSummary.replaceChildren();
      return totals;
    }

    const totals = calculateDebtTotals();
    refs.debtTotalsSummary.replaceChildren(
      totalCell("Đầu kỳ", formatVnd(totals.opening)),
      totalCell("Phát sinh", formatVnd(totals.added)),
      totalCell("Tổng nghĩa vụ", formatVnd(totals.total), true),
      totalCell("Đã thanh toán", formatVnd(totals.paid)),
      totalCell(totals.balance >= 0 ? "Còn phải thu" : "Đã trả dư", formatVnd(Math.abs(totals.balance)), true)
    );
    refs.invoiceTotalsSummary.replaceChildren();
    return totals;
  }

  function setMode(mode) {
    state.mode = mode === "debt" ? "debt" : "invoice";
    qsa("[data-document-mode]").forEach((button) => {
      const active = button.dataset.documentMode === state.mode;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    qsa("[data-invoice-mode-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.invoiceModePanel !== state.mode;
    });

    [
      "documentTitle",
      "documentNumber",
      "documentDate",
      "dueDate",
      "validUntil",
      "documentPlace",
      "documentPreparer",
      "paymentMethod",
      "documentSubtitle",
      "quotationIntroduction",
      "paymentTerms",
      "deliveryTime",
      "warrantyPeriod"
    ].forEach((field) => {
      const input = qs(`[data-field="${field}"]`);
      if (input) {
        const shouldShow = state.mode === "invoice";
        input.closest("label").hidden = !shouldShow;
        input.disabled = !shouldShow;
      }
    });
    [
      "debtTitle",
      "debtNumber",
      "debtDate",
      "debtPeriod",
      "debtPeriodStart",
      "debtPeriodEnd",
      "debtPaymentDueDate",
      "debtPaymentTerms",
      "debtIntroduction"
    ].forEach((field) => {
      const input = qs(`[data-field="${field}"]`);
      if (input) {
        input.closest("label").hidden = state.mode === "invoice";
        input.disabled = state.mode !== "debt";
      }
    });
    renderEditorTotals();
    scheduleRender();
  }

  function scheduleRender() {
    if (state.renderTimer) {
      window.clearTimeout(state.renderTimer);
    }
    state.renderTimer = window.setTimeout(() => {
      state.renderTimer = null;
      syncStateFromForm();
      renderEditorTotals();
      renderPreview();
    }, 70);
  }

  function chunkRows(rows, size) {
    const chunks = [];
    for (let index = 0; index < rows.length; index += size) {
      chunks.push(rows.slice(index, index + size));
    }
    return chunks.length ? chunks : [[]];
  }

  function optionalText(value) {
    return String(value == null ? "" : value).trim();
  }

  function optionalDate(value) {
    return optionalText(value) ? formatDate(value) : "";
  }

  function appendLabeledLine(parent, className, label, value) {
    const text = optionalText(value);
    if (!text) {
      return false;
    }
    const line = makeElement("div", className);
    line.append(makeElement("strong", "", label), makeElement("span", "", text));
    parent.appendChild(line);
    return true;
  }

  function previewLine(parent, label, value) {
    return appendLabeledLine(parent, "invoice-preview-meta-line", label, value);
  }

  function partyLine(parent, label, value) {
    return appendLabeledLine(parent, "invoice-preview-party-line", label, value);
  }

  function createPreviewBrand() {
    const brand = makeElement("div", "invoice-preview-brand");
    const logo = makeElement("img");
    logo.src = "assets/logo-am.jpeg";
    logo.alt = "Logo Anh Minh Store";
    const copy = makeElement("div", "invoice-preview-brand-copy");
    copy.appendChild(makeElement("strong", "", displayValue(state.form.unitName)));
    [
      state.form.unitAddress,
      state.form.unitPhone,
      state.form.unitEmail ? `Email: ${state.form.unitEmail}` : "",
      state.form.unitWebsite ? `Website: ${state.form.unitWebsite}` : "",
      state.form.unitTaxCode ? `Mã số thuế: ${state.form.unitTaxCode}` : ""
    ].forEach((value) => {
      if (optionalText(value)) {
        copy.appendChild(makeElement("span", "", value));
      }
    });
    brand.append(logo, copy);
    return brand;
  }

  function createPreviewHeader(kind) {
    const fragment = document.createDocumentFragment();
    const letterhead = makeElement("header", "invoice-document-letterhead");
    letterhead.appendChild(createPreviewBrand());

    const heading = makeElement("div", "invoice-preview-heading");
    const title = kind === "invoice" ? state.form.documentTitle : state.form.debtTitle;
    const subtitle = state.form.documentSubtitle || (kind === "invoice" ? "" : "Bảng đối chiếu các khoản phát sinh và thanh toán");
    heading.appendChild(makeElement("h2", "invoice-preview-title", displayValue(title)));
    if (optionalText(subtitle)) {
      heading.appendChild(makeElement("p", "invoice-preview-subtitle", subtitle));
    }

    const meta = makeElement("div", "invoice-preview-meta");
    previewLine(meta, kind === "invoice" ? "Số báo giá" : "Số chứng từ", kind === "invoice" ? state.form.documentNumber : state.form.debtNumber);
    previewLine(meta, "Ngày lập", optionalDate(kind === "invoice" ? state.form.documentDate : state.form.debtDate));
    if (kind === "invoice") {
      previewLine(meta, "Hiệu lực đến", optionalDate(state.form.validUntil));
      previewLine(meta, "Người lập", state.form.documentPreparer);
    } else {
      previewLine(meta, "Kỳ đối chiếu", state.form.debtPeriod);
      previewLine(meta, "Từ ngày", optionalDate(state.form.debtPeriodStart));
      previewLine(meta, "Đến ngày", optionalDate(state.form.debtPeriodEnd));
    }
    heading.appendChild(meta);
    letterhead.appendChild(heading);
    fragment.appendChild(letterhead);

    const customer = makeElement("section", "invoice-preview-customer");
    customer.appendChild(makeElement("h3", "invoice-preview-block-title", kind === "invoice" ? "KÍNH GỬI" : "THÔNG TIN BÊN ĐỐI CHIẾU"));
    const customerGrid = makeElement("div", "invoice-preview-party-grid");
    partyLine(customerGrid, "Tên", state.form.customerName);
    partyLine(customerGrid, "Người đại diện", state.form.customerRepresentative);
    partyLine(customerGrid, "Chức vụ", state.form.customerPosition);
    partyLine(customerGrid, "Địa chỉ", state.form.customerAddress);
    partyLine(customerGrid, "Mã số thuế", state.form.customerTaxCode);
    partyLine(customerGrid, "Điện thoại", state.form.customerPhone);
    partyLine(customerGrid, "Email", state.form.customerEmail);
    partyLine(customerGrid, "Mã khách hàng", state.form.customerCode);
    partyLine(customerGrid, "Số hợp đồng / tham chiếu", state.form.customerReference);
    customer.appendChild(customerGrid);
    fragment.appendChild(customer);

    const introduction = kind === "invoice" ? state.form.quotationIntroduction : state.form.debtIntroduction;
    if (optionalText(introduction)) {
      fragment.appendChild(makeElement("p", "invoice-preview-introduction", introduction));
    }
    return fragment;
  }

  function previewTable(headers, rows, debt) {
    const table = makeElement("table", `invoice-preview-table${debt ? " invoice-preview-table--debt" : ""}`);
    const thead = makeElement("thead");
    const headerRow = makeElement("tr");
    headers.forEach((header) => headerRow.appendChild(makeElement("th", "", header)));
    thead.appendChild(headerRow);
    const tbody = makeElement("tbody");
    rows.forEach((rowValues) => {
      const row = makeElement("tr");
      rowValues.forEach((value) => row.appendChild(makeElement("td", "", displayValue(value))));
      tbody.appendChild(row);
    });
    table.append(thead, tbody);
    return table;
  }

  function previewTotalLine(parent, label, value, grand) {
    const line = makeElement("div", `invoice-preview-total-line${grand ? " invoice-preview-total-line--grand" : ""}`);
    line.append(makeElement("strong", "", label), makeElement("strong", "", value));
    parent.appendChild(line);
  }

  function appendInvoiceSummary(page) {
    const totals = calculateInvoiceTotals();
    const totalsBlock = makeElement("div", "invoice-preview-totals");
    previewTotalLine(totalsBlock, "Tạm tính", formatVnd(totals.subtotal));
    previewTotalLine(totalsBlock, "Giảm trừ", formatVnd(totals.discount));
    previewTotalLine(totalsBlock, "Phí giao hàng", formatVnd(totals.shipping));
    previewTotalLine(totalsBlock, "Phụ phí", formatVnd(totals.surcharge));
    previewTotalLine(totalsBlock, "Thuế VAT", formatVnd(totals.tax));
    previewTotalLine(totalsBlock, "TỔNG CỘNG", formatVnd(totals.total), true);
    previewTotalLine(totalsBlock, "Đã thanh toán", formatVnd(totals.paid));
    previewTotalLine(totalsBlock, totals.balance >= 0 ? "Còn phải thu" : "Đã thanh toán dư", formatVnd(Math.abs(totals.balance)), true);
    page.appendChild(totalsBlock);

    page.appendChild(makeElement("p", "invoice-preview-amount-words", `Bằng chữ: ${numberToVietnamese(totals.total)}`));
  }

  function appendDebtSummary(page) {
    const totals = calculateDebtTotals();
    const totalsBlock = makeElement("div", "invoice-preview-totals");
    previewTotalLine(totalsBlock, "Số dư đầu kỳ", formatVnd(totals.opening));
    previewTotalLine(totalsBlock, "Phát sinh", formatVnd(totals.added));
    previewTotalLine(totalsBlock, "Tổng nghĩa vụ", formatVnd(totals.total), true);
    previewTotalLine(totalsBlock, "Đã thanh toán", formatVnd(totals.paid));
    previewTotalLine(totalsBlock, totals.balance >= 0 ? "Còn phải thu" : "Đã trả dư", formatVnd(Math.abs(totals.balance)), true);
    page.appendChild(totalsBlock);
    page.appendChild(makeElement("p", "invoice-preview-amount-words", `Số dư bằng chữ: ${numberToVietnamese(totals.balance)}`));
  }

  function appendTerms(page, kind) {
    const entries = kind === "invoice"
      ? [
          ["Hiệu lực báo giá", optionalDate(state.form.validUntil)],
          ["Thời gian giao hàng", state.form.deliveryTime],
          ["Phương thức thanh toán", state.form.paymentMethod],
          ["Hạn thanh toán", optionalDate(state.form.dueDate)],
          ["Điều khoản thanh toán", state.form.paymentTerms],
          ["Bảo hành", state.form.warrantyPeriod],
          ["Tài khoản ngân hàng", state.form.unitBankAccount],
          ["Ngân hàng / chi nhánh", state.form.unitBankBranch],
          ["Ghi chú thanh toán", state.form.invoicePaymentNote],
          ["Ghi chú", state.form.invoiceNote || state.form.unitNote || state.form.customerNote]
        ]
      : [
          ["Hạn thanh toán", optionalDate(state.form.debtPaymentDueDate)],
          ["Phương án thanh toán", state.form.debtPaymentTerms],
          ["Tài khoản ngân hàng", state.form.unitBankAccount],
          ["Ngân hàng / chi nhánh", state.form.unitBankBranch],
          ["Ghi chú đối chiếu", state.form.debtNote]
        ];
    const populated = entries.filter((entry) => optionalText(entry[1]));
    if (!populated.length) {
      return;
    }
    const section = makeElement("section", "invoice-preview-terms");
    section.appendChild(makeElement("h3", "invoice-preview-section-title", kind === "invoice" ? "ĐIỀU KHOẢN & GHI CHÚ" : "THANH TOÁN & GHI CHÚ"));
    const grid = makeElement("div", "invoice-preview-terms-grid");
    populated.forEach(([label, value]) => partyLine(grid, label, value));
    section.appendChild(grid);
    page.appendChild(section);
  }

  function appendSignatures(page, kind) {
    const signatures = makeElement("div", "invoice-preview-signatures");
    const labels = kind === "invoice"
      ? ["NGƯỜI LẬP BÁO GIÁ", "ĐẠI DIỆN ĐƠN VỊ", "XÁC NHẬN CỦA KHÁCH HÀNG"]
      : ["ĐẠI DIỆN ĐƠN VỊ", "KHÁCH HÀNG / BÊN ĐỐI CHIẾU"];
    signatures.classList.toggle("invoice-preview-signatures--three", labels.length === 3);
    labels.forEach((label, index) => {
      const signature = makeElement("div", "invoice-preview-signature");
      signature.appendChild(makeElement("strong", "", label));
      if (kind === "invoice" && index === 0 && optionalText(state.form.documentPreparer)) {
        signature.appendChild(makeElement("span", "", state.form.documentPreparer));
      }
      signatures.appendChild(signature);
    });
    page.appendChild(signatures);
  }

  function appendDocumentFooter(page, pageIndex, pageCount) {
    const footer = makeElement("footer", "invoice-preview-footer");
    const identity = [state.form.unitName, state.form.unitPhone, state.form.unitWebsite || state.form.unitEmail]
      .map(optionalText)
      .filter(Boolean)
      .join(" · ");
    footer.append(
      makeElement("span", "", identity),
      makeElement("span", "", `Trang ${pageIndex + 1}/${pageCount}`)
    );
    page.appendChild(footer);
  }

  function createPreviewPage(kind, rows, pageIndex, pageCount) {
    const page = makeElement("article", "invoice-preview-page");
    page.appendChild(createPreviewHeader(kind));
    const isLast = pageIndex === pageCount - 1;

    if (kind === "invoice") {
      const values = rows.map((item, index) => [
        String(pageIndex * QUOTE_ROWS_PER_PAGE + index + 1),
        item.model,
        item.description,
        item.unit,
        item.quantity,
        formatVnd(parseMoney(item.unitPrice)),
        formatVnd(parseMoney(item.discount)),
        formatVnd(calculateInvoiceLineTotal(item))
      ]);
      page.appendChild(previewTable(["STT", "Model / mã", "Nội dung", "ĐVT", "SL", "Đơn giá", "Giảm trừ", "Thành tiền"], values, false));
      if (isLast) {
        appendInvoiceSummary(page);
        appendTerms(page, kind);
        appendSignatures(page, kind);
      } else {
        page.appendChild(makeElement("p", "invoice-preview-continuation", "Bảng báo giá tiếp tục ở trang sau."));
      }
    } else {
      const values = rows.map((item, index) => [
        String(pageIndex * DEBT_ROWS_PER_PAGE + index + 1),
        [optionalDate(item.date), optionalText(item.dueDate) ? `Hạn: ${formatDate(item.dueDate)}` : ""].filter(Boolean).join("\n"),
        item.description,
        item.reference,
        formatVnd(parseMoney(item.amount)),
        formatVnd(parseMoney(item.paid)),
        formatVnd(parseMoney(item.amount) - parseMoney(item.paid)),
        item.note
      ]);
      page.appendChild(previewTable(["STT", "Ngày / hạn", "Diễn giải", "Số chứng từ / tham chiếu", "Phát sinh", "Đã trả", "Còn lại", "Ghi chú"], values, true));
      if (isLast) {
        appendDebtSummary(page);
        appendTerms(page, kind);
        appendSignatures(page, kind);
      } else {
        page.appendChild(makeElement("p", "invoice-preview-continuation", "Bảng công nợ tiếp tục ở trang sau."));
      }
    }

    appendDocumentFooter(page, pageIndex, pageCount);
    return page;
  }

  function renderPreview() {
    if (!refs.previewStage) {
      return;
    }
    const kind = state.mode;
    const sourceRows = kind === "invoice" ? state.invoiceItems : state.debtItems;
    const chunks = chunkRows(sourceRows, kind === "invoice" ? QUOTE_ROWS_PER_PAGE : DEBT_ROWS_PER_PAGE);
    refs.previewStage.replaceChildren();
    chunks.forEach((rows, index) => {
      const wrapper = makeElement("div", "invoice-preview-page-wrap");
      wrapper.appendChild(createPreviewPage(kind, rows, index, chunks.length));
      refs.previewStage.appendChild(wrapper);
    });
    setText(refs.previewStatus, `${chunks.length} trang A4 · Dữ liệu chỉ nằm trong bộ nhớ trình duyệt`);
    applyZoom();
  }

  function applyZoom() {
    if (!refs.previewStage || !refs.previewScroll) {
      return;
    }
    let scale = Number(state.zoom) / 100;
    if (state.zoom === "fit") {
      const pageWidthPx = 210 / 25.4 * 96;
      const availableWidth = Math.max(260, refs.previewScroll.clientWidth - 36);
      scale = Math.min(1, availableWidth / pageWidthPx);
    }
    scale = Math.max(0.35, Math.min(1.25, scale));
    refs.previewStage.style.setProperty("--invoice-preview-scale", String(scale));
    qsa("[data-preview-zoom]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.previewZoom === state.zoom);
    });
  }

  function scheduleFitZoom() {
    if (state.zoom !== "fit" || state.resizeFrame) {
      return;
    }
    state.resizeFrame = window.requestAnimationFrame(() => {
      state.resizeFrame = null;
      applyZoom();
    });
  }

  function addRow(kind, sourceIndex, duplicate) {
    syncStateFromForm();
    const list = kind === "invoice" ? state.invoiceItems : state.debtItems;
    const factory = kind === "invoice" ? createInvoiceItem : createDebtItem;
    const index = Number.isInteger(sourceIndex) ? sourceIndex : list.length - 1;
    const source = list[index];
    const next = duplicate && source ? { ...source } : factory();
    list.splice(index + 1, 0, next);
    if (kind === "invoice") {
      state.invoiceItems = list;
      renderInvoiceRows(list);
    } else {
      state.debtItems = list;
      renderDebtRows(list);
    }
    markDirty();
    scheduleRender();
    window.requestAnimationFrame(() => {
      const body = kind === "invoice" ? refs.invoiceItemsBody : refs.debtItemsBody;
      const row = body.querySelector(`tr[data-row-index="${index + 1}"]`);
      const input = row && row.querySelector('[data-row-field="description"]');
      if (input) {
        input.focus({ preventScroll: true });
      }
    });
  }

  function removeRow(kind, index) {
    syncStateFromForm();
    const list = kind === "invoice" ? state.invoiceItems : state.debtItems;
    if (list.length <= 1) {
      list[0] = kind === "invoice" ? createInvoiceItem() : createDebtItem();
    } else {
      list.splice(index, 1);
    }
    if (kind === "invoice") {
      state.invoiceItems = list;
      renderInvoiceRows(list);
    } else {
      state.debtItems = list;
      renderDebtRows(list);
    }
    markDirty();
    scheduleRender();
  }

  function formatMoneyOnBlur(target) {
    const field = target.dataset.field;
    const rowField = target.dataset.rowField;
    if (field && MONEY_FIELDS.has(field)) {
      target.value = formatInputMoney(target.value);
    }
    if (rowField && ["unitPrice", "discount", "amount", "paid"].includes(rowField)) {
      target.value = formatInputMoney(target.value);
    }
  }

  function resetForm() {
    if (state.dirty && !window.confirm("Xóa nội dung chứng từ đang nhập?")) {
      return;
    }
    const defaults = defaultForm();
    Object.keys(defaults).forEach((field) => setFormValue(field, defaults[field]));
    state.mode = "invoice";
    state.invoiceItems = [createInvoiceItem()];
    state.debtItems = [createDebtItem()];
    state.dirty = false;
    setText(refs.draftState, "Chưa có thay đổi");
    setMode("invoice");
    renderInvoiceRows();
    renderDebtRows();
    syncStateFromForm();
    renderEditorTotals();
    renderPreview();
  }

  function setActionBusy(button, busy, label) {
    if (!button) {
      return;
    }
    button.disabled = busy;
    if (busy) {
      button.dataset.originalLabel = button.textContent;
      button.textContent = label;
    } else if (button.dataset.originalLabel) {
      button.textContent = button.dataset.originalLabel;
      delete button.dataset.originalLabel;
    }
  }

  function preparePrint(pdfMode) {
    syncStateFromForm();
    renderEditorTotals();
    renderPreview();
    state.lastPrintWasPdf = Boolean(pdfMode);
    const status = pdfMode
      ? "Hộp thoại in đã mở; chọn Lưu dưới dạng PDF để tạo tệp PDF."
      : "Đang mở hộp thoại in chứng từ...";
    setText(refs.previewStatus, status);
    window.setTimeout(() => {
      setText(refs.previewStatus, status);
      window.print();
    }, 80);
  }

  function safeFilename(value) {
    const normalized = String(value || "chung-tu")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase();
    return normalized || "chung-tu";
  }

  function docxParagraph(docx, value, options) {
    const config = options || {};
    return new docx.Paragraph({
      alignment: config.alignment,
      spacing: {
        before: config.before || 0,
        after: config.after === undefined ? 80 : config.after,
        line: config.line || 276
      },
      border: config.bottomBorder ? {
        bottom: { style: docx.BorderStyle.SINGLE, size: 8, color: "174A73", space: 4 }
      } : undefined,
      children: [new docx.TextRun({
        text: String(value || ""),
        bold: Boolean(config.bold),
        italics: Boolean(config.italics),
        size: config.size || 20,
        color: config.color || "17324D",
        font: config.font || DOCX_PRIMARY_FONT
      })]
    });
  }

  function docxCell(docx, value, options) {
    const config = typeof options === "boolean" ? { bold: options } : (options || {});
    return new docx.TableCell({
      shading: config.fill ? { fill: config.fill } : undefined,
      verticalAlign: docx.VerticalAlign?.CENTER,
      children: [docxParagraph(docx, displayValue(value), {
        bold: config.bold,
        size: config.size || 18,
        color: config.color || "17324D",
        alignment: config.alignment,
        after: 0,
        line: 240
      })]
    });
  }

  function docxTable(docx, headers, rows) {
    const tableRows = [
      new docx.TableRow({
        tableHeader: true,
        cantSplit: true,
        children: headers.map((header) => docxCell(docx, header, { bold: true, fill: "174A73", color: "FFFFFF" }))
      })
    ];
    rows.forEach((row) => {
      tableRows.push(new docx.TableRow({
        cantSplit: true,
        children: row.map((value) => docxCell(docx, value, false))
      }));
    });
    return new docx.Table({
      width: { size: 100, type: docx.WidthType.PERCENTAGE },
      rows: tableRows
    });
  }

  function pushDocxDetail(children, docx, label, value) {
    const text = optionalText(value);
    if (text) {
      children.push(docxParagraph(docx, `${label}: ${text}`, { size: 19, after: 45 }));
    }
  }

  function pushDocxSectionTitle(children, docx, title) {
    children.push(docxParagraph(docx, title, {
      bold: true,
      size: 21,
      color: "174A73",
      before: 150,
      after: 90,
      bottomBorder: true
    }));
  }

  async function readLogoBytes() {
    const response = await window.fetch("assets/logo-am.jpeg", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Không tải được logo nội bộ.");
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  async function exportWord() {
    if (state.exportBusy) {
      return;
    }
    if (!window.docx || !window.docx.Document || !window.docx.Packer) {
      setText(refs.previewStatus, "Không thể tải bộ xuất Word cục bộ.");
      return;
    }

    state.exportBusy = true;
    setActionBusy(refs.wordButton, true, "Đang tạo Word...");
    setText(refs.previewStatus, "Đang tạo tệp DOCX trong trình duyệt...");
    try {
      syncStateFromForm();
      const docx = window.docx;
      const children = [];
      const title = state.mode === "invoice" ? state.form.documentTitle : state.form.debtTitle;
      let logoParagraph = null;
      try {
        const logoBytes = await readLogoBytes();
        if (docx.ImageRun) {
          logoParagraph = new docx.Paragraph({
            alignment: docx.AlignmentType ? docx.AlignmentType.LEFT : undefined,
            spacing: { after: 70 },
            children: [new docx.ImageRun({
              type: "jpg",
              data: logoBytes,
              transformation: { width: 58, height: 58 }
            })]
          });
        }
      } catch (_error) {
        // The document remains usable without the optional local logo.
      }

      const noBorder = { style: docx.BorderStyle.NONE, size: 0, color: "FFFFFF" };
      const borderless = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder };
      const brandChildren = [];
      if (logoParagraph) {
        brandChildren.push(logoParagraph);
      }
      brandChildren.push(docxParagraph(docx, state.form.unitName, { bold: true, size: 32, color: "173F63", after: 45 }));
      [state.form.unitAddress, state.form.unitPhone, state.form.unitEmail, state.form.unitWebsite, state.form.unitTaxCode ? `Mã số thuế: ${state.form.unitTaxCode}` : ""]
        .filter((value) => optionalText(value))
        .forEach((value) => brandChildren.push(docxParagraph(docx, value, { size: 18, after: 30 })));

      const headingChildren = [
        docxParagraph(docx, title, { bold: true, size: 48, color: "173F63", alignment: docx.AlignmentType?.RIGHT, after: 100 })
      ];
      pushDocxDetail(headingChildren, docx, state.mode === "invoice" ? "Số báo giá" : "Số chứng từ", state.mode === "invoice" ? state.form.documentNumber : state.form.debtNumber);
      pushDocxDetail(headingChildren, docx, "Ngày lập", optionalDate(state.mode === "invoice" ? state.form.documentDate : state.form.debtDate));
      if (state.mode === "invoice") {
        pushDocxDetail(headingChildren, docx, "Hiệu lực đến", optionalDate(state.form.validUntil));
        pushDocxDetail(headingChildren, docx, "Người phụ trách", state.form.documentPreparer);
      } else {
        pushDocxDetail(headingChildren, docx, "Kỳ đối chiếu", state.form.debtPeriod);
      }
      children.push(new docx.Table({
        width: { size: 100, type: docx.WidthType.PERCENTAGE },
        borders: borderless,
        rows: [new docx.TableRow({
          children: [
            new docx.TableCell({ width: { size: 58, type: docx.WidthType.PERCENTAGE }, borders: borderless, children: brandChildren }),
            new docx.TableCell({ width: { size: 42, type: docx.WidthType.PERCENTAGE }, borders: borderless, children: headingChildren })
          ]
        })]
      }));
      children.push(docxParagraph(docx, "", { bottomBorder: true, after: 120 }));

      pushDocxSectionTitle(children, docx, state.mode === "invoice" ? "KÍNH GỬI" : "THÔNG TIN BÊN ĐỐI CHIẾU");
      pushDocxDetail(children, docx, "Tên", state.form.customerName);
      pushDocxDetail(children, docx, "Người đại diện", state.form.customerRepresentative);
      pushDocxDetail(children, docx, "Chức vụ", state.form.customerPosition);
      pushDocxDetail(children, docx, "Địa chỉ", state.form.customerAddress);
      pushDocxDetail(children, docx, "Mã số thuế", state.form.customerTaxCode);
      pushDocxDetail(children, docx, "Điện thoại", state.form.customerPhone);
      pushDocxDetail(children, docx, "Email", state.form.customerEmail);
      pushDocxDetail(children, docx, "Số hợp đồng / tham chiếu", state.form.customerReference);
      const introduction = state.mode === "invoice" ? state.form.quotationIntroduction : state.form.debtIntroduction;
      if (optionalText(introduction)) {
        children.push(docxParagraph(docx, introduction, { size: 20, before: 90, after: 130 }));
      }

      if (state.mode === "invoice") {
        const totals = calculateInvoiceTotals();
        const rows = state.invoiceItems.map((item, index) => [
          String(index + 1), item.model, item.description, item.unit, item.quantity,
          formatVnd(parseMoney(item.unitPrice)),
          formatVnd(parseMoney(item.discount)),
          formatVnd(calculateInvoiceLineTotal(item))
        ]);
        children.push(docxTable(docx, ["STT", "Model / mã", "Nội dung", "ĐVT", "SL", "Đơn giá", "Chiết khấu", "Thành tiền"], rows));
        children.push(docxParagraph(docx, `Tạm tính: ${formatVnd(totals.subtotal)}`));
        children.push(docxParagraph(docx, `Giảm trừ: ${formatVnd(totals.discount)}`));
        children.push(docxParagraph(docx, `Phí vận chuyển: ${formatVnd(totals.shipping)}`));
        children.push(docxParagraph(docx, `Phụ phí: ${formatVnd(totals.surcharge)}`));
        children.push(docxParagraph(docx, `Thuế VAT: ${formatVnd(totals.tax)}`));
        children.push(docxParagraph(docx, `TỔNG CỘNG: ${formatVnd(totals.total)}`, { bold: true, size: 24 }));
        children.push(docxParagraph(docx, `Đã thanh toán: ${formatVnd(totals.paid)}`));
        children.push(docxParagraph(docx, `${totals.balance >= 0 ? "Còn phải thanh toán" : "Đã thanh toán dư"}: ${formatVnd(Math.abs(totals.balance))}`, { bold: true }));
        children.push(docxParagraph(docx, `Bằng chữ: ${numberToVietnamese(totals.total)}`));
      } else {
        const totals = calculateDebtTotals();
        const rows = state.debtItems.map((item, index) => [
          String(index + 1), [optionalDate(item.date), optionalText(item.dueDate) ? `Hạn: ${formatDate(item.dueDate)}` : ""].filter(Boolean).join("\n"), item.description, item.reference,
          formatVnd(parseMoney(item.amount)), formatVnd(parseMoney(item.paid)),
          formatVnd(parseMoney(item.amount) - parseMoney(item.paid)), item.note
        ]);
        children.push(docxTable(docx, ["STT", "Ngày / hạn", "Diễn giải", "Số chứng từ / tham chiếu", "Phát sinh", "Đã trả", "Còn lại", "Ghi chú"], rows));
        children.push(docxParagraph(docx, `Tổng nghĩa vụ: ${formatVnd(totals.total)}`));
        children.push(docxParagraph(docx, `Đã thanh toán: ${formatVnd(totals.paid)}`));
        children.push(docxParagraph(docx, `Còn lại: ${formatVnd(Math.abs(totals.balance))}`, { bold: true, size: 24 }));
        children.push(docxParagraph(docx, `Số dư bằng chữ: ${numberToVietnamese(totals.balance)}`));
      }

      pushDocxSectionTitle(children, docx, state.mode === "invoice" ? "ĐIỀU KHOẢN & GHI CHÚ" : "THANH TOÁN & GHI CHÚ");
      if (state.mode === "invoice") {
        pushDocxDetail(children, docx, "Hiệu lực báo giá", optionalDate(state.form.validUntil));
        pushDocxDetail(children, docx, "Thời gian giao hàng", state.form.deliveryTime);
        pushDocxDetail(children, docx, "Phương thức thanh toán", state.form.paymentMethod);
        pushDocxDetail(children, docx, "Điều khoản thanh toán", state.form.paymentTerms);
        pushDocxDetail(children, docx, "Bảo hành", state.form.warrantyPeriod);
        pushDocxDetail(children, docx, "Ghi chú", state.form.invoiceNote || state.form.unitNote || state.form.customerNote);
      } else {
        pushDocxDetail(children, docx, "Hạn thanh toán", optionalDate(state.form.debtPaymentDueDate));
        pushDocxDetail(children, docx, "Phương án thanh toán", state.form.debtPaymentTerms);
        pushDocxDetail(children, docx, "Ghi chú đối chiếu", state.form.debtNote);
      }
      pushDocxDetail(children, docx, "Tài khoản ngân hàng", state.form.unitBankAccount);
      pushDocxDetail(children, docx, "Ngân hàng / chi nhánh", state.form.unitBankBranch);

      const signatureLabels = state.mode === "invoice"
        ? ["NGƯỜI LẬP BÁO GIÁ", "ĐẠI DIỆN ĐƠN VỊ", "XÁC NHẬN CỦA KHÁCH HÀNG"]
        : ["ĐẠI DIỆN ĐƠN VỊ", "KHÁCH HÀNG / BÊN ĐỐI CHIẾU"];
      children.push(new docx.Table({
        width: { size: 100, type: docx.WidthType.PERCENTAGE },
        borders: borderless,
        rows: [new docx.TableRow({
          cantSplit: true,
          children: signatureLabels.map((label) => new docx.TableCell({
            borders: borderless,
            children: [
              docxParagraph(docx, label, { bold: true, size: 18, alignment: docx.AlignmentType?.CENTER, before: 260, after: 900 }),
              docxParagraph(docx, "", { after: 0 })
            ]
          }))
        })]
      }));
      children.push(docxParagraph(docx, [state.form.unitName, state.form.unitPhone, state.form.unitWebsite || state.form.unitEmail].filter((value) => optionalText(value)).join(" · "), {
        size: 16,
        color: "586E80",
        alignment: docx.AlignmentType?.CENTER,
        before: 160,
        bottomBorder: true
      }));

      const document = new docx.Document({
        styles: {
          default: {
            document: {
              run: { font: DOCX_FALLBACK_FONT, size: 20 },
              paragraph: { spacing: { line: 276 } }
            }
          }
        },
        sections: [{
          properties: {
            page: {
              size: { width: 11906, height: 16838 },
              margin: { top: 720, right: 720, bottom: 720, left: 720 }
            }
          },
          children
        }]
      });
      const blob = await docx.Packer.toBlob(document);
      const number = state.mode === "invoice" ? state.form.documentNumber : state.form.debtNumber;
      downloadBlob(blob, `${safeFilename(title)}-${safeFilename(number || "draft")}.docx`);
      setText(refs.previewStatus, "Đã tạo tệp DOCX cục bộ; dữ liệu chứng từ không được gửi lên máy chủ.");
    } catch (_error) {
      setText(refs.previewStatus, "Không thể tạo tệp Word. Bạn vẫn có thể dùng In chứng từ hoặc Xuất PDF.");
    } finally {
      state.exportBusy = false;
      setActionBusy(refs.wordButton, false);
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = makeElement("a");
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function handleRowAction(button) {
    const row = button.closest("tr[data-row-index]");
    if (!row) {
      return;
    }
    const kind = row.dataset.rowKind === "debt" ? "debt" : "invoice";
    const index = Number(row.dataset.rowIndex);
    if (button.dataset.rowAction === "duplicate") {
      addRow(kind, index, true);
    } else if (button.dataset.rowAction === "remove") {
      removeRow(kind, index);
    }
  }

  function installEventHandlers() {
    refs.form.addEventListener("submit", (event) => event.preventDefault());
    refs.form.addEventListener("input", () => {
      markDirty();
      syncStateFromForm();
      scheduleRender();
    });
    refs.form.addEventListener("change", () => {
      markDirty();
      syncStateFromForm();
      scheduleRender();
    });
    refs.form.addEventListener("blur", (event) => {
      formatMoneyOnBlur(event.target);
      if (event.target.matches("input, textarea, select")) {
        syncStateFromForm();
        scheduleRender();
      }
    }, true);
    refs.form.addEventListener("click", (event) => {
      const actionButton = event.target.closest("[data-row-action]");
      if (actionButton) {
        handleRowAction(actionButton);
      }
    });
    refs.form.addEventListener("keydown", (event) => {
      if ((!event.ctrlKey && !event.metaKey) || event.key !== "Enter") {
        return;
      }
      const row = event.target.closest("tr[data-row-index]");
      if (!row) {
        return;
      }
      event.preventDefault();
      const kind = row.dataset.rowKind === "debt" ? "debt" : "invoice";
      const index = Number(row.dataset.rowIndex);
      const duplicate = event.shiftKey;
      window.setTimeout(() => {
        if (!duplicate) {
          (kind === "debt" ? refs.addDebtButton : refs.addInvoiceButton).click();
          return;
        }
        const body = kind === "debt" ? refs.debtItemsBody : refs.invoiceItemsBody;
        const currentRow = body.querySelector(`tr[data-row-index="${index}"]`);
        currentRow?.querySelector('[data-row-action="duplicate"]')?.click();
      }, 0);
    }, true);

    qsa("[data-document-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        if (state.mode !== button.dataset.documentMode) {
          markDirty();
        }
        setMode(button.dataset.documentMode);
      });
      button.addEventListener("keydown", (event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault();
          const next = button.dataset.documentMode === "invoice" ? "debt" : "invoice";
          const target = qs(`[data-document-mode="${next}"]`);
          setMode(next);
          target?.focus();
        }
      });
    });

    refs.addInvoiceButton.addEventListener("click", () => addRow("invoice"));
    refs.addDebtButton.addEventListener("click", () => addRow("debt"));
    refs.resetButton.addEventListener("click", resetForm);
    refs.printButton.addEventListener("click", () => preparePrint(false));
    refs.pdfButton.addEventListener("click", () => preparePrint(true));
    refs.wordButton.addEventListener("click", exportWord);
    qsa("[data-preview-zoom]").forEach((button) => {
      button.addEventListener("click", () => {
        state.zoom = button.dataset.previewZoom;
        applyZoom();
      });
    });
    window.addEventListener("resize", scheduleFitZoom, { passive: true });
    window.addEventListener("beforeprint", () => {
      syncStateFromForm();
      renderPreview();
    });
    window.addEventListener("afterprint", () => {
      setText(
        refs.previewStatus,
        state.lastPrintWasPdf
          ? "Chọn Lưu dưới dạng PDF trong hộp thoại in để hoàn tất."
          : "Bản xem trước đã sẵn sàng."
      );
    });
    window.addEventListener("beforeunload", (event) => {
      if (!state.dirty) {
        return;
      }
      event.preventDefault();
      event.returnValue = UNSAVED_MESSAGE;
    });
  }

  function initialize() {
    document.documentElement.classList.add("invoice-document");
    refs.form = qs("#invoiceForm");
    refs.draftState = qs("#invoiceDraftState");
    refs.invoiceItemsBody = qs("#invoiceItemsBody");
    refs.debtItemsBody = qs("#debtItemsBody");
    refs.invoiceTotalsSummary = qs("#invoiceTotalsSummary");
    refs.debtTotalsSummary = qs("#debtTotalsSummary");
    refs.previewStage = qs("#invoicePreviewStage");
    refs.previewScroll = qs("#invoicePreviewScroll");
    refs.previewStatus = qs("#invoicePreviewStatus");
    refs.addInvoiceButton = qs("#addInvoiceItemButton");
    refs.addDebtButton = qs("#addDebtItemButton");
    refs.resetButton = qs("#invoiceResetButton");
    refs.printButton = qs("#invoicePrintButton");
    refs.pdfButton = qs("#invoicePdfButton");
    refs.wordButton = qs("#invoiceWordButton");
    if (!refs.form || !refs.previewStage) {
      return;
    }

    state.form = defaultForm();
    state.invoiceItems = [createInvoiceItem()];
    state.debtItems = [createDebtItem()];
    Object.keys(state.form).forEach((field) => setFormValue(field, state.form[field]));
    renderInvoiceRows();
    renderDebtRows();
    syncStateFromForm();
    setMode("invoice");
    installEventHandlers();
    renderEditorTotals();
    renderPreview();
    if (window.matchMedia && window.matchMedia("(max-width: 900px)").matches) {
      state.zoom = "fit";
      applyZoom();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();

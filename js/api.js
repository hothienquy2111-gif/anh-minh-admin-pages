(function () {
  "use strict";

  const PLACEHOLDER_URL = "PASTE_SUPABASE_PROJECT_URL_HERE";
  const PLACEHOLDER_KEY = "PASTE_SUPABASE_ANON_OR_PUBLISHABLE_KEY_HERE";

  const TICKET_STATUSES = [
    "mới nhận",
    "đang kiểm tra",
    "báo giá",
    "đang sửa",
    "chờ bàn giao",
    "đã xong",
    "đã trả",
    "huỷ"
  ];
  const CREATABLE_TICKET_STATUSES = TICKET_STATUSES.filter((status) => status !== "chờ bàn giao");
  const PRE_REPAIR_STATUSES = ["mới nhận", "đang kiểm tra", "báo giá"];
  const WORKFLOW_ACTIONS = [
    "START_REPAIR",
    "READY_FOR_HANDOVER",
    "PRINT_AND_COMPLETE",
    "REPRINT_LABEL",
    "REPRINT_RECEIPT"
  ];
  const WORKFLOW_STORAGE_PREFIX = "am-workflow:";
  const WORKFLOW_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;
  const TV_BRANDS = [
    "Samsung",
    "LG",
    "Sony",
    "TCL",
    "Sharp",
    "Panasonic",
    "Xiaomi",
    "Toshiba",
    "Skyworth",
    "Coocaa",
    "Casper",
    "Asanzo",
    "Philips",
    "Hitachi"
  ];
  const TV_SIZE_VALUES = [
    24,
    28,
    32,
    39,
    40,
    42,
    43,
    48,
    49,
    50,
    55,
    58,
    60,
    65,
    70,
    75,
    77,
    80,
    82,
    83,
    85,
    86,
    98,
    100
  ];
  const TV_SIZE_SET = new Set(TV_SIZE_VALUES);
  const MODEL_SIZE_SCAN_LIMIT = 8;

  const TICKET_FIELDS = [
    "customer_name",
    "customer_phone",
    "customer_address",
    "device_type",
    "brand",
    "model",
    "size",
    "serial_number",
    "condition_text",
    "external_condition",
    "internal_note",
    "received_date",
    "status",
    "deposit_amount",
    "estimated_price",
    "final_price"
  ];

  const MONEY_FIELDS = ["deposit_amount", "estimated_price", "final_price"];
  const WARRANTY_EXPIRING_DAYS = 15;
  const REMINDER_FIELDS = [
    "id",
    "ticket_id",
    "ticket_code",
    "customer_id",
    "customer_code",
    "customer_name",
    "customer_phone",
    "device_brand",
    "device_model",
    "reminder_type",
    "title",
    "note",
    "scheduled_at",
    "status",
    "priority",
    "priority_rank",
    "created_by",
    "client_request_id",
    "created_at",
    "updated_at",
    "completed_at",
    "cancelled_at"
  ].join(",");
  const CUSTOMER_FIELDS = "id,customer_code,name,phone,phone_normalized,address,created_at,updated_at";
  const TICKET_SELECT_FIELDS = [
    "id",
    "ticket_code",
    "customer_id",
    "customer_name",
    "customer_phone",
    "customer_address",
    "device_type",
    "brand",
    "model",
    "size",
    "serial_number",
    "condition_text",
    "external_condition",
    "internal_note",
    "received_date",
    "status",
    "deposit_amount",
    "estimated_price",
    "final_price",
    "created_at",
    "updated_at",
    "client_request_id",
    "customer:customers!service_tickets_customer_id_fkey(id,customer_code,name,phone,phone_normalized,address)"
  ].join(",");
  const RECEIPT_TICKET_SELECT_FIELDS = [
    "id",
    "ticket_code",
    "customer_id",
    "customer_name",
    "customer_phone",
    "customer_address",
    "device_type",
    "brand",
    "model",
    "size",
    "serial_number",
    "condition_text",
    "external_condition",
    "internal_note",
    "received_date",
    "delivery_date",
    "warranty_mode",
    "warranty_start_date",
    "warranty_end_date",
    "warranty_months",
    "warranty_note",
    "status",
    "deposit_amount",
    "estimated_price",
    "final_price",
    "created_at",
    "updated_at",
    "client_request_id",
    "customer:customers!service_tickets_customer_id_fkey(id,customer_code,name,phone,phone_normalized,address)"
  ].join(",");
  const SEARCH_TICKET_SELECT_FIELDS = [
    RECEIPT_TICKET_SELECT_FIELDS,
    "repair_started_at",
    "ready_for_handover_at",
    "completed_at",
    "last_activity_at"
  ].join(",");
  const WARRANTY_TICKET_SELECT_FIELDS = [
    "id",
    "ticket_code",
    "customer_id",
    "customer_name",
    "customer_phone",
    "customer_address",
    "device_type",
    "brand",
    "model",
    "size",
    "serial_number",
    "condition_text",
    "external_condition",
    "received_date",
    "delivery_date",
    "warranty_mode",
    "warranty_start_date",
    "warranty_end_date",
    "warranty_months",
    "warranty_note",
    "status",
    "completed_at",
    "created_at",
    "updated_at",
    "customer:customers!service_tickets_customer_id_fkey(id,customer_code,name,phone,phone_normalized,address)"
  ].join(",");
  const TICKET_HISTORY_SELECT_FIELDS = [
    "id",
    "ticket_code",
    "customer_id",
    "customer_name",
    "customer_phone",
    "device_type",
    "model",
    "status",
    "created_at",
    "customer:customers!service_tickets_customer_id_fkey(id,customer_code,name,phone)"
  ].join(",");
  let activeWorkflowUserId = null;
  let workflowAuthSyncInitialized = false;
  const WORKFLOW_TICKET_FIELDS = [
    "id",
    "repair_started_at",
    "ready_for_handover_at",
    "completed_at",
    "last_activity_at"
  ].join(",");
  const WORKFLOW_OVERVIEW_SELECT_FIELDS = [
    "id",
    "ticket_code",
    "customer_id",
    "customer_name",
    "customer_phone",
    "device_type",
    "brand",
    "model",
    "status",
    "created_at",
    "received_date",
    "delivery_date",
    "warranty_mode",
    "warranty_end_date",
    "repair_started_at",
    "ready_for_handover_at",
    "completed_at",
    "last_activity_at",
    "customer:customers!service_tickets_customer_id_fkey(id,customer_code,name,phone)"
  ].join(",");
  const REPAIRING_TICKET_SELECT_FIELDS = [
    "id",
    "ticket_code",
    "customer_id",
    "customer_name",
    "customer_phone",
    "customer_address",
    "device_type",
    "brand",
    "model",
    "size",
    "serial_number",
    "condition_text",
    "external_condition",
    "internal_note",
    "received_date",
    "status",
    "created_at",
    "updated_at",
    "repair_started_at",
    "completed_at",
    "last_activity_at",
    "customer:customers!service_tickets_customer_id_fkey(id,customer_code,name,phone,phone_normalized,address)"
  ].join(",");
  const HANDOVER_TICKET_SELECT_FIELDS = [
    REPAIRING_TICKET_SELECT_FIELDS,
    "ready_for_handover_at"
  ].join(",");
  const ATTENTION_SELECT_FIELDS = [
    "id",
    "ticket_code",
    "customer_id",
    "customer_name",
    "customer_phone",
    "device_type",
    "brand",
    "model",
    "status",
    "created_at",
    "received_date",
    "delivery_date",
    "warranty_mode",
    "warranty_end_date",
    "repair_started_at",
    "last_activity_at",
    "customer:customers!service_tickets_customer_id_fkey(id,customer_code,name,phone)"
  ].join(",");
  const HANDOVER_ATTENTION_SELECT_FIELDS = [
    ATTENTION_SELECT_FIELDS,
    "ready_for_handover_at"
  ].join(",");
  const ATTENTION_TYPES = {
    REPAIR_OVERDUE: "REPAIR_OVERDUE",
    REPAIRING: "REPAIRING",
    NEEDS_INSPECTION: "NEEDS_INSPECTION",
    DELIVERY_TODAY: "DELIVERY_TODAY",
    HANDOVER_OVERDUE: "HANDOVER_OVERDUE"
  };
  const ACTIVE_PROCESSING_GROUPS = [
    { key: "new", label: "Mới nhận", tone: "blue" },
    { key: "checking", label: "Đang kiểm tra", tone: "purple" },
    { key: "repair_under_48", label: "Đang sửa dưới 48 giờ", tone: "green" },
    { key: "repair_over_48", label: "Đang sửa quá 48 giờ", tone: "amber" },
    { key: "repair_over_72", label: "Đang sửa quá 72 giờ", tone: "red" },
    { key: "handover_waiting", label: "Bàn giao tivi", tone: "blue" },
    { key: "repair_missing_start", label: "Thiếu thời điểm bắt đầu sửa", tone: "neutral" }
  ];
  const ACTIVE_PROGRESS_STATUSES = [
    { status: "mới nhận", label: "Mới nhận", href: "search.html" },
    { status: "đang kiểm tra", label: "Đang kiểm tra", href: "search.html" },
    { status: "báo giá", label: "Chờ báo giá", href: "search.html" },
    { status: "đang sửa", label: "Đang sửa", href: "ticket-activity.html" },
    { status: "chờ bàn giao", label: "Bàn giao tivi", href: "handover-tickets.html" }
  ];

  function getConfig() {
    const config = window.AM_SUPABASE_CONFIG || {};
    const url = String(config.url || "").trim();
    const anonKey = String(config.anonKey || "").trim();

    if (!url || !anonKey || url === PLACEHOLDER_URL || anonKey === PLACEHOLDER_KEY) {
      throw new Error("Chưa cấu hình Supabase URL và anon/publishable key trong js/supabase-config.js.");
    }

    return { url, anonKey };
  }

  function getClient() {
    window.AM = window.AM || {};

    if (window.AM.supabaseClient) {
      setupWorkflowAuthSync(window.AM.supabaseClient);
      return window.AM.supabaseClient;
    }

    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error("Không tải được thư viện Supabase JS. Hãy kiểm tra kết nối mạng hoặc CDN.");
    }

    const config = getConfig();
    window.AM.supabaseClient = window.supabase.createClient(config.url, config.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });

    setupWorkflowAuthSync(window.AM.supabaseClient);

    return window.AM.supabaseClient;
  }

  function normalizeTextValue(value) {
    return String(value || "").trim();
  }

  function normalizeBrand(value) {
    const text = normalizeTextValue(value);

    if (!text) {
      return "";
    }

    const lowered = text.toLocaleLowerCase("vi-VN");
    const matched = TV_BRANDS.find((brand) => brand.toLocaleLowerCase("vi-VN") === lowered);
    return matched || text;
  }

  function formatTvSize(size) {
    const number = Number.parseInt(size, 10);
    return TV_SIZE_SET.has(number) ? `${number} inch` : "";
  }

  function isValidModelSizeContext(model, index, length) {
    const before = model.slice(0, index);
    const previous = index > 0 ? model[index - 1] : "";
    const next = model[index + length] || "";

    if (index > MODEL_SIZE_SCAN_LIMIT) {
      return false;
    }

    if (/\d/.test(previous) || /\d/.test(next)) {
      return false;
    }

    if (index === 1 && /^[A-Z]$/.test(before)) {
      return false;
    }

    return true;
  }

  function inferTvSizeFromModel(model) {
    const normalized = normalizeTextValue(model).toUpperCase();

    if (!normalized) {
      return null;
    }

    const candidates = normalized.matchAll(/\d{2,3}/g);

    for (const match of candidates) {
      const raw = match[0];
      const size = Number.parseInt(raw, 10);
      const index = match.index || 0;

      if (!TV_SIZE_SET.has(size)) {
        continue;
      }

      if (!isValidModelSizeContext(normalized, index, raw.length)) {
        continue;
      }

      return size;
    }

    return null;
  }

  function setAssistHint(element, message) {
    if (!element) {
      return;
    }

    element.textContent = message || "";
    element.hidden = !message;
  }

  function populateBrandDatalist(datalist) {
    if (!datalist) {
      return;
    }

    datalist.innerHTML = "";
    TV_BRANDS.forEach((brand) => {
      const option = document.createElement("option");
      option.value = brand;
      datalist.appendChild(option);
    });
  }

  function attachTvModelAssist(options) {
    const config = options || {};
    const brandInput = config.brandInput || null;
    const modelInput = config.modelInput || null;
    const sizeInput = config.sizeInput || null;
    const hintElement = config.hintElement || null;

    populateBrandDatalist(config.brandListElement);

    if (brandInput) {
      brandInput.autocomplete = "off";
      brandInput.addEventListener("blur", () => {
        brandInput.value = normalizeBrand(brandInput.value);
      });
    }

    if (modelInput) {
      modelInput.autocomplete = "off";
    }

    if (sizeInput) {
      sizeInput.autocomplete = "off";
    }

    function reset(state) {
      const options = state || {};
      const sizeValue = normalizeTextValue(sizeInput && sizeInput.value);

      if (sizeInput) {
        sizeInput.dataset.source = options.keepValue && sizeValue ? "manual" : "";
        sizeInput.dataset.autoValue = "";
      }

      setAssistHint(hintElement, "");
    }

    function applySuggestion() {
      if (!modelInput || !sizeInput) {
        return;
      }

      const modelValue = normalizeTextValue(modelInput.value);
      const inferredSize = inferTvSizeFromModel(modelValue);
      const currentSize = normalizeTextValue(sizeInput.value);
      const currentSource = sizeInput.dataset.source || "";
      const currentAutoValue = sizeInput.dataset.autoValue || "";

      if (!modelValue) {
        if (currentSource === "model") {
          sizeInput.value = "";
          sizeInput.dataset.source = "";
          sizeInput.dataset.autoValue = "";
        }

        setAssistHint(hintElement, "");
        return;
      }

      if (!inferredSize) {
        setAssistHint(hintElement, "");
        return;
      }

      const formatted = formatTvSize(inferredSize);

      if (!currentSize || currentSource === "model" || currentSize === currentAutoValue) {
        sizeInput.value = formatted;
        sizeInput.dataset.source = "model";
        sizeInput.dataset.autoValue = formatted;
        setAssistHint(hintElement, `Đã nhận diện từ model: ${formatted}`);
        return;
      }

      if (currentSize.toLocaleLowerCase("vi-VN") !== formatted.toLocaleLowerCase("vi-VN")) {
        setAssistHint(hintElement, `Model có vẻ là ${formatted}. Vui lòng kiểm tra lại.`);
        return;
      }

      setAssistHint(hintElement, "");
    }

    if (modelInput && sizeInput) {
      modelInput.addEventListener("input", applySuggestion);
      modelInput.addEventListener("blur", () => {
        modelInput.value = normalizeTextValue(modelInput.value);
        applySuggestion();
      });

      sizeInput.addEventListener("input", () => {
        const sizeValue = normalizeTextValue(sizeInput.value);

        if (!sizeValue) {
          sizeInput.dataset.source = "";
          sizeInput.dataset.autoValue = "";
        } else if (sizeValue !== (sizeInput.dataset.autoValue || "")) {
          sizeInput.dataset.source = "manual";
        }

        applySuggestion();
      });
    }

    reset({ keepValue: Boolean(sizeInput && normalizeTextValue(sizeInput.value)) });

    return {
      refresh: applySuggestion,
      reset
    };
  }

  function friendlyError(error, fallbackMessage) {
    if (!error) {
      return new Error(fallbackMessage || "Đã có lỗi xảy ra.");
    }

    if (error instanceof Error) {
      return error;
    }

    const message = error.message || error.details || error.hint || fallbackMessage || "Đã có lỗi xảy ra.";
    return new Error(message);
  }

  function isWorkflowSchemaError(error) {
    const code = String((error && error.code) || "").toLowerCase();
    const message = String((error && (error.message || error.details || error.hint)) || "").toLowerCase();
    return message.includes("repair_started_at")
      || message.includes("ready_for_handover_at")
      || message.includes("completed_at")
      || message.includes("last_activity_at")
      || message.includes("delivery_date")
      || message.includes("warranty_mode")
      || message.includes("warranty_start_date")
      || message.includes("warranty_end_date")
      || message.includes("warranty_months")
      || message.includes("warranty_note")
      || message.includes("ticket_activities")
      || message.includes("record_ticket_workflow_action")
      || message.includes("could not find the function")
      || code === "pgrst202"
      || code === "pgrst204"
      || code === "42703"
      || code === "42883"
      || code === "42p01";
  }

  function createWorkflowError(message, options) {
    const error = new Error(message);
    const details = options || {};
    error.workflowErrorType = details.type || "unknown";
    error.workflowClearRequestId = details.clearRequestId === true;

    if (details.originalError) {
      error.originalError = details.originalError;
    }

    return error;
  }

  function isWorkflowNetworkError(error) {
    const message = String((error && (error.message || error.details || error.hint || error.name)) || "").toLowerCase();
    const status = Number(error && (error.status || error.statusCode));

    return message.includes("failed to fetch")
      || message.includes("networkerror")
      || message.includes("network error")
      || message.includes("timeout")
      || message.includes("timed out")
      || message.includes("abort")
      || message.includes("err_network")
      || status === 0
      || status === 408
      || status === 504;
  }

  function isWorkflowPermissionError(error) {
    const code = String((error && error.code) || "").toLowerCase();
    const message = String((error && (error.message || error.details || error.hint)) || "").toLowerCase();
    const status = Number(error && (error.status || error.statusCode));

    return status === 401
      || status === 403
      || code === "42501"
      || code === "pgrst301"
      || message.includes("jwt")
      || message.includes("permission denied")
      || message.includes("not authorized")
      || message.includes("unauthorized")
      || message.includes("row-level security")
      || message.includes("rls")
      || message.includes("không có quyền");
  }

  function shouldClearWorkflowClientRequestId(error) {
    return Boolean(error && error.workflowClearRequestId === true);
  }

  function friendlyWorkflowError(error) {
    const message = String((error && (error.message || error.details || error.hint)) || "");
    const normalized = message.toLowerCase();

    if (isWorkflowSchemaError(error)) {
      return createWorkflowError("Workflow chưa được kích hoạt.", {
        type: "inactive",
        clearRequestId: true,
        originalError: error
      });
    }

    if (isWorkflowNetworkError(error)) {
      return createWorkflowError("Không thể kết nối. Hãy kiểm tra mạng và thử lại.", {
        type: "network",
        clearRequestId: false,
        originalError: error
      });
    }

    if (isWorkflowPermissionError(error)) {
      return createWorkflowError("Phiên đăng nhập hoặc quyền truy cập không hợp lệ.", {
        type: "permission",
        clearRequestId: true,
        originalError: error
      });
    }

    if (normalized.includes("repair has already started")) {
      return createWorkflowError("Phiếu đã bắt đầu sửa. Hãy dùng chức năng Chỉ in lại tem.", {
        type: "business",
        clearRequestId: true,
        originalError: error
      });
    }

    if (normalized.includes("ticket is already completed")) {
      return createWorkflowError("Phiếu đã bàn giao. Hãy dùng chức năng Chỉ in lại biên nhận.", {
        type: "business",
        clearRequestId: true,
        originalError: error
      });
    }

    if (normalized.includes("repair is already ready for handover")) {
      return createWorkflowError("Phiếu đã được chuyển sang Bàn giao tivi.", {
        type: "business",
        clearRequestId: true,
        originalError: error
      });
    }

    if (normalized.includes("repair has not been started correctly")) {
      return createWorkflowError("Phiếu chưa có mốc bắt đầu sửa hợp lệ.", {
        type: "business",
        clearRequestId: true,
        originalError: error
      });
    }

    if (normalized.includes("ticket has not been completed correctly")) {
      return createWorkflowError("Phiếu chưa đủ điều kiện in lại biên nhận.", {
        type: "business",
        clearRequestId: true,
        originalError: error
      });
    }

    if (normalized.includes("action not allowed for current ticket status")) {
      return createWorkflowError("Trạng thái phiếu vừa thay đổi hoặc chưa đủ điều kiện cho thao tác này. Vui lòng tải lại.", {
        type: "business",
        clearRequestId: true,
        originalError: error
      });
    }

    if (normalized.includes("not allowed")) {
      return createWorkflowError("Tài khoản không có quyền thực hiện thao tác này.", {
        type: "permission",
        clearRequestId: true,
        originalError: error
      });
    }

    if (
      normalized.includes("thiếu id phiếu")
      || normalized.includes("thiếu clientrequestid")
      || normalized.includes("thao tác workflow không hợp lệ")
      || normalized.includes("missing warranty")
      || normalized.includes("invalid warranty")
      || normalized.includes("warranty note is too long")
      || normalized.includes("warranty months must be between")
      || normalized.includes("warranty end date must be after")
    ) {
      return createWorkflowError(message || "Thao tác workflow không hợp lệ.", {
        type: "validation",
        clearRequestId: true,
        originalError: error
      });
    }

    console.error("Workflow RPC error", error);
    return createWorkflowError("Có lỗi khi xử lý phiếu. Vui lòng thử lại.", {
      type: "unknown",
      clearRequestId: false,
      originalError: error
    });
  }

  function normalizeText(value) {
    const text = String(value || "").trim();
    return text || null;
  }

  function normalizeNumber(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function moneyDigits(value) {
    if (value === null || value === undefined || value === "") {
      return "";
    }

    if (typeof value === "number") {
      return Number.isFinite(value) ? String(Math.trunc(value)) : "";
    }

    const text = String(value).trim();
    const databaseDecimal = text.match(/^(\d+)[.,]00$/);
    const digits = (databaseDecimal ? databaseDecimal[1] : text).replace(/\D/g, "");
    return digits.replace(/^0+(?=\d)/, "");
  }

  function formatMoneyValue(value) {
    const digits = moneyDigits(value);
    return digits ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".") : "";
  }

  function normalizeMoneyValue(value) {
    const digits = moneyDigits(value);

    if (!digits) {
      return null;
    }

    const parsed = Number(digits);

    if (!Number.isSafeInteger(parsed)) {
      throw new Error("Số tiền quá lớn để lưu chính xác. Vui lòng kiểm tra lại giá trị.");
    }

    return parsed;
  }

  function sanitizeMoneyTyping(value) {
    return String(value || "").replace(/[^0-9.,]/g, "");
  }

  function formatMoneyInput(input) {
    if (input) {
      input.value = formatMoneyValue(input.value);
    }
  }

  function attachMoneyInput(input) {
    if (!input || input.dataset.moneyInputAttached === "true") {
      return;
    }

    input.dataset.moneyInputAttached = "true";
    input.inputMode = "numeric";

    input.addEventListener("input", () => {
      const original = input.value;
      const caret = input.selectionStart;
      const sanitized = sanitizeMoneyTyping(original);

      if (sanitized === original) {
        return;
      }

      input.value = sanitized;

      if (Number.isInteger(caret) && typeof input.setSelectionRange === "function") {
        const nextCaret = sanitizeMoneyTyping(original.slice(0, caret)).length;
        input.setSelectionRange(nextCaret, nextCaret);
      }
    });

    input.addEventListener("paste", () => {
      window.setTimeout(() => formatMoneyInput(input), 0);
    });
    input.addEventListener("blur", () => formatMoneyInput(input));
    formatMoneyInput(input);
  }

  function attachMoneyInputs(root) {
    if (!root) {
      return;
    }

    root.querySelectorAll("[data-money-input]").forEach(attachMoneyInput);
  }

  function formatMoneyInputs(root) {
    if (!root) {
      return;
    }

    root.querySelectorAll("[data-money-input]").forEach(formatMoneyInput);
  }

  function normalizeVNPhone(value) {
    const digits = String(value || "").replace(/[^0-9]/g, "");
    let phone = null;

    if (/^84[2-9][0-9]{8,9}$/.test(digits)) {
      phone = `0${digits.slice(2)}`;
    } else if (/^0[2-9][0-9]{8,9}$/.test(digits)) {
      phone = digits;
    }

    if (!phone) {
      return null;
    }

    if (/^0(3|5|7|8|9)[0-9]{8}$/.test(phone)) {
      return phone;
    }

    if (/^02[0-9]{9}$/.test(phone)) {
      return phone;
    }

    return null;
  }

  function mapTicket(ticket) {
    if (!ticket) {
      return ticket;
    }

    const customer = ticket.customer || ticket.customers || null;
    const mapped = Object.assign({}, ticket, {
      customer_code: customer && customer.customer_code ? customer.customer_code : ticket.customer_code || null,
      customer_master_name: customer && customer.name ? customer.name : null,
      customer_master_phone: customer && customer.phone ? customer.phone : null,
      customer_master_address: customer && customer.address ? customer.address : null,
      workflow_available: ticket.workflow_available === true,
      workflow_inactive_message: ticket.workflow_inactive_message || null
    });

    delete mapped.customer;
    delete mapped.customers;
    return mapped;
  }

  function mapTickets(tickets) {
    return (tickets || []).map(mapTicket);
  }

  function mergeById(items) {
    const merged = new Map();

    items.flat().forEach((item) => {
      if (item && item.id && !merged.has(item.id)) {
        merged.set(item.id, item);
      }
    });

    return Array.from(merged.values());
  }

  function cleanPostgrestSearchValue(value) {
    return String(value || "")
      .trim()
      .replace(/[%_,()]/g, " ")
      .replace(/\s+/g, " ");
  }

  function validateWorkflowAction(action) {
    const normalized = String(action || "").trim().toUpperCase();

    if (!WORKFLOW_ACTIONS.includes(normalized)) {
      throw new Error("Thao tác workflow không hợp lệ.");
    }

    return normalized;
  }

  function normalizeId(value) {
    return String(value || "").trim();
  }

  function parseWorkflowRequestEntry(value) {
    try {
      const parsed = JSON.parse(String(value || ""));

      if (!parsed || typeof parsed !== "object") {
        return null;
      }

      return {
        userId: normalizeId(parsed.userId),
        ticketId: normalizeId(parsed.ticketId),
        action: String(parsed.action || "").trim().toUpperCase(),
        createdAt: normalizeId(parsed.createdAt),
        requestId: normalizeId(parsed.requestId)
      };
    } catch (error) {
      return null;
    }
  }

  function isWorkflowRequestExpired(entry, now) {
    const created = Date.parse(entry && entry.createdAt);

    if (!Number.isFinite(created)) {
      return true;
    }

    return (now || Date.now()) - created > WORKFLOW_REQUEST_TTL_MS;
  }

  function cleanupWorkflowRequestIds(currentUserId) {
    const userId = normalizeId(currentUserId);
    const now = Date.now();

    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);

      if (!key || !key.startsWith(WORKFLOW_STORAGE_PREFIX)) {
        continue;
      }

      const entry = parseWorkflowRequestEntry(sessionStorage.getItem(key));
      const shouldRemove = !entry
        || !entry.userId
        || !entry.ticketId
        || !entry.requestId
        || !WORKFLOW_ACTIONS.includes(entry.action)
        || isWorkflowRequestExpired(entry, now)
        || !userId
        || entry.userId !== userId;

      if (shouldRemove) {
        sessionStorage.removeItem(key);
      }
    }
  }

  function setWorkflowAuthUser(userId) {
    activeWorkflowUserId = normalizeId(userId) || null;
    cleanupWorkflowRequestIds(activeWorkflowUserId);
  }

  function setupWorkflowAuthSync(client) {
    if (workflowAuthSyncInitialized || !client || !client.auth) {
      return;
    }

    workflowAuthSyncInitialized = true;

    if (typeof client.auth.getSession === "function") {
      client.auth.getSession()
        .then(({ data }) => {
          setWorkflowAuthUser(data && data.session && data.session.user && data.session.user.id);
        })
        .catch(() => {
          cleanupWorkflowRequestIds(activeWorkflowUserId);
        });
    }

    if (typeof client.auth.onAuthStateChange === "function") {
      client.auth.onAuthStateChange((_event, session) => {
        setWorkflowAuthUser(session && session.user && session.user.id);
      });
    }
  }

  function getWorkflowStorageKey(userId, ticketId, action) {
    return `${WORKFLOW_STORAGE_PREFIX}${normalizeId(userId)}:${normalizeId(ticketId)}:${validateWorkflowAction(action)}`;
  }

  function ensureWorkflowClientRequestId(ticketId, action) {
    const id = normalizeId(ticketId);
    const userId = normalizeId(activeWorkflowUserId);
    const normalizedAction = validateWorkflowAction(action);

    if (!id) {
      throw new Error("Thiếu ID phiếu cho thao tác workflow.");
    }

    if (!userId) {
      throw new Error("Thiếu thông tin tài khoản cho thao tác workflow. Vui lòng tải lại trang.");
    }

    cleanupWorkflowRequestIds(userId);

    const key = getWorkflowStorageKey(userId, id, normalizedAction);
    const existing = parseWorkflowRequestEntry(sessionStorage.getItem(key));

    if (
      existing
      && existing.userId === userId
      && existing.ticketId === id
      && existing.action === normalizedAction
      && existing.requestId
      && !isWorkflowRequestExpired(existing)
    ) {
      return existing.requestId;
    }

    if (!window.crypto || typeof window.crypto.randomUUID !== "function") {
      throw new Error("Trình duyệt không hỗ trợ crypto.randomUUID().");
    }

    const entry = {
      userId,
      ticketId: id,
      action: normalizedAction,
      createdAt: new Date().toISOString(),
      requestId: window.crypto.randomUUID()
    };

    try {
      sessionStorage.setItem(key, JSON.stringify(entry));
    } catch (error) {
      throw new Error("Không lưu được mã chống gửi trùng. Vui lòng thử lại.");
    }

    return entry.requestId;
  }

  function clearWorkflowClientRequestId(ticketId, action) {
    const id = normalizeId(ticketId);
    const userId = normalizeId(activeWorkflowUserId);
    const normalizedAction = validateWorkflowAction(action);

    if (!id) {
      return;
    }

    if (userId) {
      sessionStorage.removeItem(getWorkflowStorageKey(userId, id, normalizedAction));
    }

    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);

      if (!key || !key.startsWith(WORKFLOW_STORAGE_PREFIX)) {
        continue;
      }

      const entry = parseWorkflowRequestEntry(sessionStorage.getItem(key));

      if (entry && entry.ticketId === id && entry.action === normalizedAction && (!userId || entry.userId === userId)) {
        sessionStorage.removeItem(key);
      }
    }
  }

  async function hydrateWorkflowTicketData(tickets) {
    const list = tickets || [];
    const ids = uniqueIds(list);

    if (ids.length === 0) {
      return list;
    }

    try {
      const client = getClient();
      const { data, error } = await client
        .from("service_tickets")
        .select(WORKFLOW_TICKET_FIELDS)
        .in("id", ids);

      if (error) {
        throw error;
      }

      const workflowById = new Map((data || []).map((row) => [row.id, row]));

      return list.map((ticket) => Object.assign({}, ticket, workflowById.get(ticket.id) || {}, {
        workflow_available: true,
        workflow_inactive_message: null
      }));
    } catch (error) {
      if (!isWorkflowSchemaError(error)) {
        throw error;
      }

      return list.map((ticket) => Object.assign({}, ticket, {
        workflow_available: false,
        workflow_inactive_message: "Workflow chưa được kích hoạt."
      }));
    }
  }

  async function recordTicketWorkflowAction(ticketId, action, clientRequestId, workflowDetails) {
    try {
      const client = getClient();
      const id = String(ticketId || "").trim();
      const normalizedAction = validateWorkflowAction(action);
      const requestId = String(clientRequestId || "").trim();
      const details = workflowDetails || {};

      if (!id) {
        throw new Error("Thiếu ID phiếu cho thao tác workflow.");
      }

      if (!requestId) {
        throw new Error("Thiếu clientRequestId cho thao tác workflow.");
      }

      const { data, error } = await client.rpc("record_ticket_workflow_action", {
        p_ticket_id: id,
        p_action: normalizedAction,
        p_client_request_id: requestId,
        p_delivery_date: normalizeText(details.delivery_date),
        p_warranty_mode: normalizeText(details.warranty_mode),
        p_warranty_start_date: normalizeText(details.warranty_start_date),
        p_warranty_end_date: normalizeText(details.warranty_end_date),
        p_warranty_months: normalizeNumber(details.warranty_months),
        p_warranty_note: normalizeText(details.warranty_note)
      });

      if (error) {
        throw error;
      }

      const result = Array.isArray(data) ? data[0] : data;

      if (!result) {
        throw new Error("RPC workflow không trả về dữ liệu.");
      }

      return {
        ticket_id: result.ticket_id,
        ticket_code: result.ticket_code,
        status: result.status,
        workflow_action: result.workflow_action,
        activity_type: result.activity_type,
        activity_id: result.activity_id,
        activity_created_at: result.activity_created_at,
        repair_started_at: result.repair_started_at,
        ready_for_handover_at: result.ready_for_handover_at,
        completed_at: result.completed_at,
        last_activity_at: result.last_activity_at,
        delivery_date: result.delivery_date,
        warranty_mode: result.warranty_mode,
        warranty_start_date: result.warranty_start_date,
        warranty_end_date: result.warranty_end_date,
        warranty_months: result.warranty_months,
        warranty_note: result.warranty_note,
        was_replayed: result.was_replayed === true
      };
    } catch (error) {
      throw friendlyWorkflowError(error);
    }
  }

  function uniqueIds(rows) {
    return Array.from(new Set((rows || []).map((row) => row && row.id).filter(Boolean)));
  }

  async function findTicketHistoryCustomerIds(keyword, resultLimit) {
    const client = getClient();
    const rawKeyword = String(keyword || "").trim();
    const safeKeyword = cleanPostgrestSearchValue(rawKeyword);
    const normalizedCode = safeKeyword.toUpperCase();
    const normalizedPhone = normalizeVNPhone(rawKeyword);
    const limit = Math.min(Math.max(Number(resultLimit) || 200, 1), 1000);
    const searches = [];

    if (!safeKeyword) {
      return [];
    }

    searches.push(
      client
        .from("customers")
        .select("id")
        .ilike("customer_code", `%${normalizedCode}%`)
        .limit(limit),
      client
        .from("customers")
        .select("id")
        .ilike("name", `%${safeKeyword}%`)
        .limit(limit),
      client
        .from("customers")
        .select("id")
        .ilike("phone", `%${safeKeyword}%`)
        .limit(limit)
    );

    if (normalizedPhone) {
      searches.push(
        client
          .from("customers")
          .select("id")
          .eq("phone_normalized", normalizedPhone)
          .limit(limit)
      );
    }

    const results = await Promise.all(searches);

    results.forEach((result) => {
      if (result.error) {
        throw result.error;
      }
    });

    return uniqueIds(results.flatMap((result) => result.data || []));
  }

  function buildTicketHistoryFilter(keyword, customerIds) {
    const safeKeyword = cleanPostgrestSearchValue(keyword);
    const normalizedCode = safeKeyword.toUpperCase();
    const phoneDigits = String(keyword || "").replace(/\D/g, "");
    const filters = [];

    if (safeKeyword) {
      filters.push(
        `ticket_code.ilike.%${normalizedCode}%`,
        `customer_name.ilike.%${safeKeyword}%`,
        `customer_phone.ilike.%${safeKeyword}%`
      );
    }

    if (phoneDigits && phoneDigits !== safeKeyword) {
      filters.push(`customer_phone.ilike.%${phoneDigits}%`);
    }

    if (customerIds && customerIds.length > 0) {
      filters.push(`customer_id.in.(${customerIds.join(",")})`);
    }

    return filters.join(",");
  }

  function buildTicketSearchFilters(keyword, customerIds) {
    const rawKeyword = String(keyword || "").trim();
    const safeKeyword = cleanPostgrestSearchValue(rawKeyword);
    const normalizedCode = safeKeyword.toUpperCase();
    const normalizedPhone = normalizeVNPhone(rawKeyword);
    const phoneDigits = rawKeyword.replace(/\D/g, "");
    const filters = [];

    if (safeKeyword) {
      filters.push(
        `ticket_code.ilike.%${normalizedCode}%`,
        `customer_name.ilike.%${safeKeyword}%`,
        `customer_phone.ilike.%${safeKeyword}%`,
        `brand.ilike.%${safeKeyword}%`,
        `model.ilike.%${safeKeyword}%`,
        `serial_number.ilike.%${safeKeyword}%`,
        `condition_text.ilike.%${safeKeyword}%`,
        `external_condition.ilike.%${safeKeyword}%`
      );
    }

    if (normalizedPhone) {
      filters.push(`customer_phone.ilike.%${normalizedPhone}%`);
    }

    if (phoneDigits && phoneDigits !== safeKeyword && phoneDigits !== normalizedPhone) {
      filters.push(`customer_phone.ilike.%${phoneDigits}%`);
    }

    if (customerIds && customerIds.length > 0) {
      filters.push(`customer_id.in.(${customerIds.join(",")})`);
    }

    return filters;
  }

  function buildTicketIntakeYearFilters(year) {
    const normalizedYear = String(year || "").trim();

    if (!/^\d{4}$/.test(normalizedYear)) {
      return [];
    }

    const nextYear = String(Number.parseInt(normalizedYear, 10) + 1);
    const yearStart = `${normalizedYear}-01-01`;
    const yearEnd = `${normalizedYear}-12-31`;
    const createdStart = vietnamYmdToUtcIso(yearStart);
    const createdEnd = vietnamYmdToUtcIso(`${nextYear}-01-01`);

    return [
      `and(received_date.gte.${yearStart},received_date.lte.${yearEnd})`,
      `and(received_date.is.null,created_at.gte.${createdStart},created_at.lt.${createdEnd})`
    ];
  }

  function buildTicketSearchExpression(keyword, customerIds, year) {
    const searchFilters = buildTicketSearchFilters(keyword, customerIds);
    const yearFilters = buildTicketIntakeYearFilters(year);

    if (searchFilters.length > 0 && yearFilters.length > 0) {
      return `and(or(${searchFilters.join(",")}),or(${yearFilters.join(",")}))`;
    }

    return (searchFilters.length > 0 ? searchFilters : yearFilters).join(",");
  }

  function buildTicketSearchRequest(client, options, selectFields, countExact) {
    const params = options || {};
    const selection = selectFields || SEARCH_TICKET_SELECT_FIELDS;
    let request = countExact
      ? client.from("service_tickets").select(selection, { count: "exact" })
      : client.from("service_tickets").select(selection);
    const filterExpression = buildTicketSearchExpression(params.keyword, params.customerIds, params.year);

    if (filterExpression) {
      request = request.or(filterExpression);
    }

    if (TICKET_STATUSES.includes(params.status)) {
      request = request.eq("status", params.status);
    }

    return request
      .order("received_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .order("ticket_code", { ascending: false });
  }

  async function runTicketSearchRequest(options) {
    const params = options || {};
    const client = getClient();
    const keyword = String(params.keyword || "").trim();
    const customerIds = keyword
      ? await findTicketHistoryCustomerIds(keyword, params.customerLimit || 1000)
      : [];
    const context = {
      keyword,
      customerIds,
      year: params.year,
      status: params.status
    };

    async function execute(selectFields) {
      let request = buildTicketSearchRequest(client, context, selectFields, params.countExact === true);

      if (Number.isFinite(params.from) && Number.isFinite(params.to)) {
        request = request.range(params.from, params.to);
      }

      return request;
    }

    let result = await execute(params.selectFields || SEARCH_TICKET_SELECT_FIELDS);
    let usedFallback = false;

    if (result.error && params.allowSchemaFallback !== false && isWorkflowSchemaError(result.error)) {
      result = await execute(TICKET_SELECT_FIELDS);
      usedFallback = true;
    }

    return Object.assign({}, result, { usedFallback });
  }

  function buildRepairingTicketFilter(keyword, customerIds) {
    const rawKeyword = String(keyword || "").trim();
    const safeKeyword = cleanPostgrestSearchValue(rawKeyword);
    const normalizedCode = safeKeyword.toUpperCase();
    const normalizedPhone = normalizeVNPhone(rawKeyword);
    const phoneDigits = rawKeyword.replace(/\D/g, "");
    const filters = [];

    if (safeKeyword) {
      filters.push(
        `ticket_code.ilike.%${normalizedCode}%`,
        `customer_name.ilike.%${safeKeyword}%`,
        `customer_phone.ilike.%${safeKeyword}%`,
        `brand.ilike.%${safeKeyword}%`,
        `model.ilike.%${safeKeyword}%`,
        `serial_number.ilike.%${safeKeyword}%`
      );
    }

    if (normalizedPhone) {
      filters.push(`customer_phone.ilike.%${normalizedPhone}%`);
    }

    if (phoneDigits && phoneDigits !== safeKeyword && phoneDigits !== normalizedPhone) {
      filters.push(`customer_phone.ilike.%${phoneDigits}%`);
    }

    if (customerIds && customerIds.length > 0) {
      filters.push(`customer_id.in.(${customerIds.join(",")})`);
    }

    return filters.join(",");
  }

  function repairThresholdIso(hours) {
    return new Date(Date.now() - (hours * 60 * 60 * 1000)).toISOString();
  }

  function applyRepairingFilter(query, filter) {
    const key = String(filter || "all");

    if (key === "under48") {
      return query
        .not("repair_started_at", "is", null)
        .gt("repair_started_at", repairThresholdIso(48));
    }

    if (key === "over48") {
      return query
        .not("repair_started_at", "is", null)
        .lte("repair_started_at", repairThresholdIso(48));
    }

    if (key === "over72") {
      return query
        .not("repair_started_at", "is", null)
        .lte("repair_started_at", repairThresholdIso(72));
    }

    if (key === "missing-start") {
      return query.is("repair_started_at", null);
    }

    return query;
  }

  function applyRepairingSearch(query, keyword, customerIds) {
    const searchFilter = buildRepairingTicketFilter(keyword, customerIds);
    return searchFilter ? query.or(searchFilter) : query;
  }

  function applyRepairingSort(query, sort) {
    if (sort === "newest-repair") {
      return query
        .order("repair_started_at", { ascending: false, nullsFirst: false })
        .order("ticket_code", { ascending: false });
    }

    if (sort === "newest-received") {
      return query
        .order("received_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .order("ticket_code", { ascending: false });
    }

    return query
      .order("repair_started_at", { ascending: true, nullsFirst: false })
      .order("ticket_code", { ascending: true });
  }

  function buildRepairingTicketsQuery(client, options, selectFields, selectOptions) {
    const params = options || {};
    let query = client
      .from("service_tickets")
      .select(selectFields, selectOptions || {})
      .eq("status", "đang sửa");

    query = applyRepairingFilter(query, params.filter || "all");
    query = applyRepairingSearch(query, params.keyword, params.customerIds || []);
    return query;
  }

  function handoverThresholdIso(hours) {
    return new Date(Date.now() - (hours * 60 * 60 * 1000)).toISOString();
  }

  function formatTicketStatusLabel(status, fallback) {
    const normalized = String(status || "").trim();
    const labels = {
      "mới nhận": "Mới nhận",
      "đang kiểm tra": "Đang kiểm tra",
      "báo giá": "Báo giá",
      "đang sửa": "Đang sửa",
      "chờ bàn giao": "Bàn giao tivi",
      "đã trả": "Đã bàn giao",
      "đã xong": "Legacy đã xong",
      "huỷ": "Huỷ"
    };

    return labels[normalized] || normalized || fallback || "—";
  }

  function parseHandoverTime(value) {
    const time = Date.parse(String(value || ""));
    return Number.isFinite(time) ? time : 0;
  }

  function formatHandoverElapsed(milliseconds) {
    const totalMinutes = Math.max(0, Math.floor(milliseconds / 60000));
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;

    if (days > 0) {
      return `${days} ngày ${hours} giờ`;
    }

    if (hours > 0) {
      return `${hours} giờ ${minutes} phút`;
    }

    return `${minutes} phút`;
  }

  function classifyHandoverTiming(ticket, nowValue) {
    const readyTime = parseHandoverTime(ticket && ticket.ready_for_handover_at);

    if (!readyTime) {
      return {
        level: "neutral",
        badge: "THIẾU MỐC THỜI GIAN",
        text: "Chưa có thời điểm sửa xong"
      };
    }

    const now = Number.isFinite(Number(nowValue)) ? Number(nowValue) : Date.now();
    const elapsed = Math.max(0, now - readyTime);
    const hours = elapsed / 3600000;

    if (hours >= 48) {
      return {
        level: "danger",
        badge: "QUÁ 48 GIỜ",
        text: `Quá hạn bàn giao ${formatHandoverElapsed(elapsed)}`
      };
    }

    if (hours >= 24) {
      return {
        level: "warning",
        badge: "CẦN THEO DÕI",
        text: `Chờ bàn giao ${formatHandoverElapsed(elapsed)}`
      };
    }

    return {
      level: "normal",
      badge: "BÌNH THƯỜNG",
      text: `Chờ bàn giao ${formatHandoverElapsed(elapsed)}`
    };
  }

  function formatHandoverDateTime(value) {
    const time = parseHandoverTime(value);

    if (!time) {
      return "Chưa có";
    }

    return new Intl.DateTimeFormat("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).format(new Date(time));
  }

  function applyHandoverFilter(query, filter) {
    const key = String(filter || "all");

    if (key === "under24") {
      return query.gt("ready_for_handover_at", handoverThresholdIso(24));
    }

    if (key === "warning") {
      return query
        .lte("ready_for_handover_at", handoverThresholdIso(24))
        .gt("ready_for_handover_at", handoverThresholdIso(48));
    }

    if (key === "over48") {
      return query.lte("ready_for_handover_at", handoverThresholdIso(48));
    }

    return query;
  }

  function buildHandoverTicketsQuery(client, options, selectFields, selectOptions) {
    const params = options || {};
    let query = client
      .from("service_tickets")
      .select(selectFields, selectOptions || {})
      .eq("status", "chờ bàn giao")
      .not("ready_for_handover_at", "is", null);

    query = applyHandoverFilter(query, params.filter || "all");
    query = applyRepairingSearch(query, params.keyword, params.customerIds || []);
    return query;
  }

  async function countHandoverTickets(options, customerIds, filter) {
    const { count, error } = await buildHandoverTicketsQuery(getClient(), {
      keyword: options.keyword,
      customerIds,
      filter
    }, "id", { count: "exact", head: true });

    if (error) {
      throw error;
    }

    return count || 0;
  }

  async function countRepairingTickets(options, customerIds, filter) {
    const client = getClient();
    const { count, error } = await buildRepairingTicketsQuery(client, {
      keyword: options.keyword,
      customerIds,
      filter
    }, "id", { count: "exact", head: true });

    if (error) {
      throw error;
    }

    return count || 0;
  }

  function sanitizeTicketPayload(data) {
    const payload = {};

    TICKET_FIELDS.forEach((field) => {
      if (!Object.prototype.hasOwnProperty.call(data, field)) {
        return;
      }

      if (MONEY_FIELDS.includes(field)) {
        payload[field] = normalizeMoneyValue(data[field]);
        return;
      }

      if (field === "brand") {
        payload[field] = normalizeBrand(data[field]) || null;
        return;
      }

      if (field === "status") {
        payload[field] = TICKET_STATUSES.includes(data[field]) ? data[field] : "mới nhận";
        return;
      }

      payload[field] = normalizeText(data[field]);
    });

    if (!payload.device_type) {
      payload.device_type = "Tivi";
    }

    if (!payload.received_date) {
      payload.received_date = new Date().toISOString().slice(0, 10);
    }

    return payload;
  }

  async function getCurrentUser() {
    try {
      const client = getClient();
      const { data: sessionData, error: sessionError } = await client.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      if (!sessionData || !sessionData.session) {
        setWorkflowAuthUser(null);
        return null;
      }

      const { data, error } = await client.auth.getUser();

      if (error) {
        throw error;
      }

      setWorkflowAuthUser(data.user && data.user.id);
      return data.user || null;
    } catch (error) {
      throw friendlyError(error, "Không kiểm tra được phiên đăng nhập.");
    }
  }

  async function checkInternalAccess() {
    try {
      const client = getClient();
      const user = await getCurrentUser();

      if (!user) {
        return {
          allowed: false,
          reason: "no_session",
          message: "Bạn cần đăng nhập để sử dụng trang admin."
        };
      }

      const { data, error } = await client
        .from("internal_users")
        .select("user_id,name,active,note")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!data) {
        return {
          allowed: false,
          reason: "missing",
          user,
          message: "Tài khoản này chưa được cấp quyền admin."
        };
      }

      if (data.active !== true) {
        return {
          allowed: false,
          reason: "inactive",
          user,
          profile: data,
          message: "Tài khoản này đã bị khoá."
        };
      }

      return {
        allowed: true,
        reason: "allowed",
        user,
        profile: data,
        message: "Đã xác thực quyền admin."
      };
    } catch (error) {
      throw friendlyError(error, "Không kiểm tra được quyền admin.");
    }
  }

  async function requireInternalAccess() {
    const access = await checkInternalAccess();

    if (!access.allowed) {
      if (access.reason !== "no_session") {
        await signOut(false);
        sessionStorage.setItem("am_admin_login_message", access.message);
      }

      window.location.replace("login.html");
      return null;
    }

    return access;
  }

  async function signOut(redirectToLogin) {
    try {
      const client = getClient();
      const { error } = await client.auth.signOut();

      if (error) {
        throw error;
      }

      setWorkflowAuthUser(null);

      if (redirectToLogin !== false) {
        window.location.replace("login.html");
      }
    } catch (error) {
      throw friendlyError(error, "Không đăng xuất được.");
    }
  }

  const AUTH_REVALIDATION_EXEMPT_PAGES = new Set(["", "index.html", "login.html", "404.html"]);
  let restoredPageAuthCheck = null;

  function currentPageName() {
    const parts = window.location.pathname.split("/");
    return String(parts[parts.length - 1] || "").toLowerCase();
  }

  function revalidateRestoredAdminPage(event) {
    if (!event.persisted || AUTH_REVALIDATION_EXEMPT_PAGES.has(currentPageName()) || restoredPageAuthCheck) {
      return;
    }

    document.documentElement.classList.add("auth-revalidating");
    restoredPageAuthCheck = requireInternalAccess()
      .then((access) => {
        if (access) {
          document.documentElement.classList.remove("auth-revalidating");
        }
      })
      .catch(() => {
        window.location.replace("login.html");
      })
      .finally(() => {
        restoredPageAuthCheck = null;
      });
  }

  window.addEventListener("pageshow", revalidateRestoredAdminPage);

  async function getTicketHistoryByCustomerId(customerId, limit) {
    try {
      const client = getClient();
      const id = String(customerId || "").trim();

      if (!id) {
        return [];
      }

      let query = client
        .from("service_tickets")
        .select(TICKET_SELECT_FIELDS)
        .eq("customer_id", id)
        .order("updated_at", { ascending: false });

      if (limit) {
        query = query.limit(limit);
      }

      const { data, error } = await query;

      if (error) {
        throw error;
      }

      return hydrateWorkflowTicketData(mapTickets(data || []));
    } catch (error) {
      throw friendlyError(error, "Không tải được lịch sử phiếu của khách hàng.");
    }
  }

  async function hydrateCustomers(customers) {
    const list = customers || [];
    const [histories, counts] = await Promise.all([
      Promise.all(list.map((customer) => getTicketHistoryByCustomerId(customer.id, 1))),
      Promise.all(list.map(async (customer) => {
        const client = getClient();
        const { count, error } = await client
          .from("service_tickets")
          .select("id", { count: "exact", head: true })
          .eq("customer_id", customer.id);

        if (error) {
          throw error;
        }

        return count || 0;
      }))
    ]
    );

    return list.map((customer, index) => {
      const latestTicket = histories[index][0] || null;
      return Object.assign({}, customer, {
        ticket_count: counts[index] || 0,
        latest_ticket: latestTicket
      });
    });
  }

  async function findCustomersByPhone(phone) {
    try {
      const client = getClient();
      const normalizedPhone = normalizeVNPhone(phone);

      if (!normalizedPhone) {
        return [];
      }

      const { data, error } = await client
        .from("customers")
        .select(CUSTOMER_FIELDS)
        .eq("phone_normalized", normalizedPhone)
        .order("created_at", { ascending: false });

      if (error) {
        throw error;
      }

      return hydrateCustomers(data || []);
    } catch (error) {
      throw friendlyError(error, "Không tìm được khách hàng theo số điện thoại.");
    }
  }

  async function searchCustomers(keyword) {
    try {
      const client = getClient();
      const rawKeyword = String(keyword || "").trim();
      const normalizedPhone = normalizeVNPhone(rawKeyword);
      const normalizedCode = rawKeyword.toUpperCase();
      const searches = [];

      if (!rawKeyword) {
        return [];
      }

      searches.push(
        client
          .from("customers")
          .select(CUSTOMER_FIELDS)
          .ilike("customer_code", `%${normalizedCode}%`)
          .limit(25),
        client
          .from("customers")
          .select(CUSTOMER_FIELDS)
          .ilike("name", `%${rawKeyword}%`)
          .limit(25)
      );

      if (normalizedPhone) {
        searches.push(
          client
            .from("customers")
            .select(CUSTOMER_FIELDS)
            .eq("phone_normalized", normalizedPhone)
            .limit(25)
        );
      } else {
        searches.push(
          client
            .from("customers")
            .select(CUSTOMER_FIELDS)
            .ilike("phone", `%${rawKeyword}%`)
            .limit(25)
        );
      }

      const results = await Promise.all(searches);

      results.forEach((result) => {
        if (result.error) {
          throw result.error;
        }
      });

      return mergeById(results.map((result) => result.data || []));
    } catch (error) {
      throw friendlyError(error, "Không tìm được khách hàng.");
    }
  }

  async function createTicket(data, options) {
    try {
      const client = getClient();
      const payload = sanitizeTicketPayload(data);
      const requestOptions = options || {};
      const clientRequestId = requestOptions.clientRequestId;

      if (!clientRequestId) {
        throw new Error("Thiếu client_request_id cho lần tạo phiếu.");
      }

      const { data: result, error } = await client.rpc("create_service_ticket_with_customer", {
        p_client_request_id: clientRequestId,
        p_customer_mode: requestOptions.customerMode || "new",
        p_existing_customer_id: requestOptions.existingCustomerId || null,
        p_customer_name: payload.customer_name,
        p_customer_phone: payload.customer_phone,
        p_customer_address: payload.customer_address,
        p_device_type: payload.device_type,
        p_brand: payload.brand,
        p_model: payload.model,
        p_size: payload.size,
        p_serial_number: payload.serial_number,
        p_condition_text: payload.condition_text,
        p_external_condition: payload.external_condition,
        p_internal_note: payload.internal_note,
        p_received_date: payload.received_date,
        p_status: payload.status,
        p_deposit_amount: payload.deposit_amount,
        p_estimated_price: payload.estimated_price,
        p_final_price: payload.final_price
      });

      if (error) {
        throw error;
      }

      const created = Array.isArray(result) ? result[0] : result;

      if (!created) {
        throw new Error("RPC không trả về phiếu đã tạo.");
      }

      return {
        id: created.ticket_id,
        ticket_code: created.ticket_code,
        customer_id: created.customer_id,
        customer_code: created.customer_code,
        customer_name: created.customer_name,
        customer_phone: created.customer_phone,
        created_at: created.created_at,
        was_replayed: created.was_replayed === true
      };
    } catch (error) {
      throw friendlyError(error, "Không tạo được phiếu mới.");
    }
  }

  async function countTicketsByStatus(status) {
    const client = getClient();
    const { count, error } = await client
      .from("service_tickets")
      .select("id", { count: "exact", head: true })
      .eq("status", status);

    if (error) {
      throw error;
    }

    return count || 0;
  }

  async function getDashboardStats() {
    try {
      const client = getClient();
      const { count: total, error: totalError } = await client
        .from("service_tickets")
        .select("id", { count: "exact", head: true });

      if (totalError) {
        throw totalError;
      }

      const statusCounts = {};
      const counts = await Promise.all(TICKET_STATUSES.map((status) => countTicketsByStatus(status)));

      TICKET_STATUSES.forEach((status, index) => {
        statusCounts[status] = counts[index];
      });

      return {
        total: total || 0,
        statuses: statusCounts
      };
    } catch (error) {
      throw friendlyError(error, "Không tải được thống kê dashboard.");
    }
  }

  function mergeTickets(resultSets) {
    const merged = new Map();

    resultSets.flat().forEach((ticket) => {
      if (ticket && ticket.id && !merged.has(ticket.id)) {
        merged.set(ticket.id, ticket);
      }
    });

    return Array.from(merged.values()).sort((a, b) => {
      return String(b.created_at || "").localeCompare(String(a.created_at || ""));
    });
  }

  async function searchTickets(query) {
    try {
      const client = getClient();
      const rawQuery = String(query || "").trim();

      if (!rawQuery) {
        return [];
      }

      const normalizedCode = rawQuery.toUpperCase();

      if (/^AM\d{6,}$/i.test(rawQuery)) {
        const { data, error } = await client
          .from("service_tickets")
          .select(TICKET_SELECT_FIELDS)
          .eq("ticket_code", normalizedCode)
          .limit(20);

        if (error) {
          throw error;
        }

        if (data && data.length > 0) {
          return hydrateWorkflowTicketData(mapTickets(data));
        }
      }

      const likeQuery = `%${rawQuery}%`;
      const customerMatches = await searchCustomers(rawQuery);
      const customerHistories = await Promise.all(
        customerMatches.map((customer) => getTicketHistoryByCustomerId(customer.id, 50))
      );
      const searches = await Promise.all([
        client.from("service_tickets").select(TICKET_SELECT_FIELDS).ilike("ticket_code", `%${normalizedCode}%`).limit(25),
        client.from("service_tickets").select(TICKET_SELECT_FIELDS).ilike("customer_phone", likeQuery).limit(25),
        client.from("service_tickets").select(TICKET_SELECT_FIELDS).ilike("customer_name", likeQuery).limit(25),
        client.from("service_tickets").select(TICKET_SELECT_FIELDS).ilike("model", likeQuery).limit(25)
      ]);

      searches.forEach((result) => {
        if (result.error) {
          throw result.error;
        }
      });

      return hydrateWorkflowTicketData(mergeTickets([
        mapTickets(searches.flatMap((result) => result.data || [])),
        customerHistories.flat()
      ]));
    } catch (error) {
      throw friendlyError(error, "Không tìm kiếm được phiếu.");
    }
  }

  async function getTicketsPage(options) {
    try {
      const params = options || {};
      const pageSize = Math.min(Math.max(Number(params.pageSize) || 10, 1), 100);
      const page = Math.max(Number(params.page) || 1, 1);
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      const result = await runTicketSearchRequest({
        keyword: params.query,
        year: params.year,
        status: params.status,
        from,
        to,
        countExact: true,
        customerLimit: 1000
      });

      if (result.error) {
        throw result.error;
      }

      const mapped = mapTickets(result.data || []);
      const records = result.usedFallback
        ? await hydrateWorkflowTicketData(mapped)
        : mapped.map((ticket) => Object.assign({}, ticket, {
          workflow_available: true,
          workflow_inactive_message: null
        }));
      const totalCount = result.count || 0;

      return {
        records,
        totalCount,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(totalCount / pageSize))
      };
    } catch (error) {
      throw friendlyError(error, "Không thể tải danh sách phiếu. Vui lòng thử lại.");
    }
  }

  async function getTicketSearchSuggestions(options) {
    try {
      const params = typeof options === "string" ? { query: options } : (options || {});
      const keyword = String(params.query || "").trim();
      const limit = Math.min(Math.max(Number(params.limit) || 5, 1), 5);

      if (keyword.length < 2) {
        return [];
      }

      const result = await runTicketSearchRequest({
        keyword,
        year: params.year,
        from: 0,
        to: limit - 1,
        countExact: false,
        customerLimit: 50,
        selectFields: TICKET_SELECT_FIELDS,
        allowSchemaFallback: false
      });

      if (result.error) {
        throw result.error;
      }

      return mapTickets(result.data || []);
    } catch (error) {
      throw friendlyError(error, "Không tải được gợi ý tìm kiếm.");
    }
  }

  async function getTicketYears() {
    try {
      const rows = await runPagedRows("ticketYears", (from, to) => getClient()
        .from("service_tickets")
        .select("received_date,created_at")
        .order("received_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .range(from, to));
      const currentYear = todayVietnamYmd().slice(0, 4);
      const years = new Set([currentYear]);

      rows.forEach((row) => {
        const intakeDate = row.received_date || timestampToVietnamYmd(row.created_at);

        if (/^\d{4}-\d{2}-\d{2}$/.test(String(intakeDate || ""))) {
          years.add(String(intakeDate).slice(0, 4));
        }
      });

      return Array.from(years).sort((a, b) => b.localeCompare(a));
    } catch (error) {
      throw friendlyError(error, "Không tải được danh sách năm tiếp nhận.");
    }
  }

  async function getTicketsForExport(options) {
    try {
      const params = options || {};
      const offset = Math.max(Number(params.offset) || 0, 0);
      const limit = Math.min(Math.max(Number(params.limit) || 500, 1), 1000);
      const result = await runTicketSearchRequest({
        keyword: params.query,
        year: params.year,
        status: params.status,
        from: offset,
        to: offset + limit - 1,
        countExact: params.includeCount === true,
        customerLimit: 1000
      });

      if (result.error) {
        throw result.error;
      }

      return {
        records: mapTickets(result.data || []),
        totalCount: typeof result.count === "number" ? result.count : null,
        fieldsLimited: result.usedFallback === true
      };
    } catch (error) {
      throw friendlyError(error, "Không tải được dữ liệu để xuất Excel.");
    }
  }

  async function getTicketByCode(code) {
    try {
      const client = getClient();
      const normalizedCode = String(code || "").trim().toUpperCase();

      if (!normalizedCode) {
        return null;
      }

      const { data, error } = await client
        .from("service_tickets")
        .select(TICKET_SELECT_FIELDS)
        .eq("ticket_code", normalizedCode)
        .maybeSingle();

      if (error) {
        throw error;
      }

      const hydrated = await hydrateWorkflowTicketData(mapTicket(data) ? [mapTicket(data)] : []);
      return hydrated[0] || null;
    } catch (error) {
      throw friendlyError(error, "Không tải được phiếu theo mã AM.");
    }
  }

  async function getTicketById(id) {
    try {
      const client = getClient();
      const ticketId = String(id || "").trim();

      if (!ticketId) {
        return null;
      }

      const { data, error } = await client
        .from("service_tickets")
        .select(TICKET_SELECT_FIELDS)
        .eq("id", ticketId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      const hydrated = await hydrateWorkflowTicketData(mapTicket(data) ? [mapTicket(data)] : []);
      return hydrated[0] || null;
    } catch (error) {
      throw friendlyError(error, "Không tải được phiếu theo ID.");
    }
  }

  function addDaysYmd(ymd, days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ""))) {
      return null;
    }

    const parts = ymd.split("-").map((part) => Number.parseInt(part, 10));
    const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function ymdToOrdinal(ymd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ""))) {
      return null;
    }

    const parts = ymd.split("-").map((part) => Number.parseInt(part, 10));
    return Math.floor(Date.UTC(parts[0], parts[1] - 1, parts[2]) / 86400000);
  }

  function ymdWeekdayIndex(ymd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ""))) {
      return 0;
    }

    const parts = ymd.split("-").map((part) => Number.parseInt(part, 10));
    const jsDay = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay();
    return (jsDay + 6) % 7;
  }

  function todayVietnamYmd() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    const values = {};

    parts.forEach((part) => {
      if (part.type !== "literal") {
        values[part.type] = part.value;
      }
    });

    return `${values.year}-${values.month}-${values.day}`;
  }

  function timestampToVietnamYmd(value) {
    const text = String(value || "").trim();

    if (!text) {
      return null;
    }

    const date = new Date(text);

    if (Number.isNaN(date.getTime())) {
      return null;
    }

    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const values = {};

    parts.forEach((part) => {
      if (part.type !== "literal") {
        values[part.type] = part.value;
      }
    });

    return `${values.year}-${values.month}-${values.day}`;
  }

  function vietnamYmdToUtcIso(ymd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ""))) {
      return null;
    }

    const parts = ymd.split("-").map((part) => Number.parseInt(part, 10));
    return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], -7, 0, 0, 0)).toISOString();
  }

  async function findWarrantyCustomerIds(keyword, resultLimit) {
    const client = getClient();
    const rawKeyword = String(keyword || "").trim();
    const safeKeyword = cleanPostgrestSearchValue(rawKeyword);
    const normalizedCode = safeKeyword.toUpperCase();
    const normalizedPhone = normalizeVNPhone(rawKeyword);
    const limit = Math.min(Math.max(Number(resultLimit) || 1000, 1), 1000);
    const searches = [];

    if (!safeKeyword) {
      return [];
    }

    searches.push(
      client
        .from("customers")
        .select("id")
        .ilike("customer_code", `%${normalizedCode}%`)
        .limit(limit)
    );

    if (normalizedPhone) {
      searches.push(
        client
          .from("customers")
          .select("id")
          .eq("phone_normalized", normalizedPhone)
          .limit(limit)
      );
    } else {
      searches.push(
        client
          .from("customers")
          .select("id")
          .ilike("phone", `%${safeKeyword}%`)
          .limit(limit)
      );
    }

    const results = await Promise.all(searches);

    results.forEach((result) => {
      if (result.error) {
        throw result.error;
      }
    });

    return uniqueIds(results.flatMap((result) => result.data || []));
  }

  function applyWarrantyCompletionFilter(query) {
    return query.or("status.eq.đã trả,completed_at.not.is.null");
  }

  function buildWarrantySearchFilter(keyword, customerIds) {
    const rawKeyword = String(keyword || "").trim();
    const safeKeyword = cleanPostgrestSearchValue(rawKeyword);
    const normalizedCode = safeKeyword.toUpperCase();
    const normalizedPhone = normalizeVNPhone(rawKeyword);
    const phoneDigits = rawKeyword.replace(/\D/g, "");
    const filters = [];

    if (!safeKeyword) {
      return "";
    }

    filters.push(
      `ticket_code.ilike.%${normalizedCode}%`,
      `model.ilike.%${safeKeyword}%`,
      `brand.ilike.%${safeKeyword}%`,
      `serial_number.ilike.%${safeKeyword}%`,
      `customer_phone.ilike.%${safeKeyword}%`
    );

    if (normalizedPhone) {
      filters.push(`customer_phone.ilike.%${normalizedPhone}%`);
    }

    if (phoneDigits && phoneDigits !== safeKeyword && phoneDigits !== normalizedPhone) {
      filters.push(`customer_phone.ilike.%${phoneDigits}%`);
    }

    safeKeyword
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && token !== safeKeyword)
      .slice(0, 4)
      .forEach((token) => {
        filters.push(
          `model.ilike.%${token}%`,
          `brand.ilike.%${token}%`
        );
      });

    if (customerIds && customerIds.length > 0) {
      filters.push(`customer_id.in.(${customerIds.join(",")})`);
    }

    return filters.join(",");
  }

  function applyWarrantySearchFilter(query, keyword, customerIds) {
    const filter = buildWarrantySearchFilter(keyword, customerIds);
    return filter ? query.or(filter) : query;
  }

  function applyWarrantyStatusFilter(query, filter) {
    const today = todayVietnamYmd();
    const soon = addDaysYmd(today, WARRANTY_EXPIRING_DAYS);

    if (filter === "active") {
      return query
        .not("warranty_mode", "is", null)
        .neq("warranty_mode", "NONE")
        .gt("warranty_end_date", soon);
    }

    if (filter === "expiring") {
      return query
        .not("warranty_mode", "is", null)
        .neq("warranty_mode", "NONE")
        .gte("warranty_end_date", today)
        .lte("warranty_end_date", soon);
    }

    if (filter === "expired") {
      return query
        .not("warranty_mode", "is", null)
        .neq("warranty_mode", "NONE")
        .lt("warranty_end_date", today);
    }

    if (filter === "none") {
      return query.eq("warranty_mode", "NONE");
    }

    if (filter === "no-info") {
      return query.or("warranty_mode.is.null,and(warranty_mode.neq.NONE,warranty_end_date.is.null)");
    }

    return query;
  }

  function applyWarrantySort(query, sort) {
    if (sort === "expiry") {
      return query
        .order("warranty_end_date", { ascending: true, nullsFirst: false })
        .order("completed_at", { ascending: false, nullsFirst: false })
        .order("delivery_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .order("ticket_code", { ascending: false });
    }

    if (sort === "expiry-nearest") {
      return query
        .order("warranty_end_date", { ascending: false, nullsFirst: false })
        .order("completed_at", { ascending: false, nullsFirst: false })
        .order("delivery_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .order("ticket_code", { ascending: false });
    }

    return query
      .order("completed_at", { ascending: false, nullsFirst: false })
      .order("delivery_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .order("ticket_code", { ascending: false });
  }

  function buildWarrantyRecordsQuery(client, options, selectFields, selectOptions) {
    const params = options || {};
    let query = client
      .from("service_tickets")
      .select(selectFields, selectOptions || {});

    query = applyWarrantyCompletionFilter(query);
    query = applyWarrantySearchFilter(query, params.query, params.customerIds || []);
    query = applyWarrantyStatusFilter(query, params.filter || "all");

    return query;
  }

  async function countWarrantyRecords(options, customerIds, filter) {
    const client = getClient();
    const { count, error } = await buildWarrantyRecordsQuery(client, {
      query: options.query,
      customerIds,
      filter
    }, "id", { count: "exact", head: true });

    if (error) {
      throw error;
    }

    return count || 0;
  }

  async function getWarrantyRecords(options) {
    try {
      const client = getClient();
      const params = options || {};
      const pageSize = Math.min(Math.max(Number(params.pageSize) || 10, 1), 50);
      const page = Math.max(Number(params.page) || 1, 1);
      const queryText = String(params.query || "").trim();
      const filter = params.filter || "all";
      const sort = params.sort || "newest";
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      const customerIds = queryText ? await findWarrantyCustomerIds(queryText) : [];
      let query = buildWarrantyRecordsQuery(client, {
        query: queryText,
        customerIds,
        filter
      }, WARRANTY_TICKET_SELECT_FIELDS, { count: "exact" });

      query = applyWarrantySort(query, sort).range(from, to);

      const countFilters = ["all", "active", "expiring", "expired", "none", "no-info"];
      const [{ data, error, count }, countValues] = await Promise.all([
        query,
        Promise.all(countFilters.map((key) => countWarrantyRecords({ query: queryText }, customerIds, key)))
      ]);

      if (error) {
        throw error;
      }

      const filterCounts = {};
      countFilters.forEach((key, index) => {
        filterCounts[key] = countValues[index] || 0;
      });

      const totalCount = count || 0;
      const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

      return {
        records: mapTickets(data || []),
        totalCount,
        page,
        pageSize,
        totalPages,
        filterCounts
      };
    } catch (error) {
      throw friendlyError(error, "Không tra cứu được thông tin bảo hành.");
    }
  }

  async function getWarrantySearchSuggestions(query, limit) {
    try {
      const client = getClient();
      const queryText = String(query || "").trim();
      const pageSize = Math.min(Math.max(Number(limit) || 2, 1), 2);

      if (queryText.length < 2) {
        return [];
      }

      const customerIds = await findWarrantyCustomerIds(queryText, 20);
      let request = buildWarrantyRecordsQuery(client, {
        query: queryText,
        customerIds,
        filter: "all"
      }, WARRANTY_TICKET_SELECT_FIELDS);

      request = applyWarrantySort(request, "newest").range(0, pageSize - 1);

      const { data, error } = await request;

      if (error) {
        throw error;
      }

      return mapTickets(data || []);
    } catch (error) {
      throw friendlyError(error, "Không tải được gợi ý bảo hành.");
    }
  }

  async function searchWarrantyRecords(query) {
    const result = await getWarrantyRecords({
      query,
      page: 1,
      pageSize: 50,
      filter: "all",
      sort: "newest"
    });

    return result.records;
  }

  async function getTicketForDeliveryReceipt(params) {
    const client = getClient();
    const code = String((params && params.code) || "").trim().toUpperCase();
    const id = String((params && params.id) || "").trim();

    async function queryTicket(selectFields) {
      let query = client
        .from("service_tickets")
        .select(selectFields);

      if (code) {
        query = query.eq("ticket_code", code);
      } else if (id) {
        query = query.eq("id", id);
      } else {
        return null;
      }

      const { data, error } = await query.maybeSingle();

      if (error) {
        throw error;
      }

      const hydrated = await hydrateWorkflowTicketData(mapTicket(data) ? [mapTicket(data)] : []);
      return hydrated[0] || null;
    }

    try {
      return await queryTicket(RECEIPT_TICKET_SELECT_FIELDS);
    } catch (error) {
      if (!isWorkflowSchemaError(error)) {
        throw friendlyError(error, "Không tải được dữ liệu biên nhận.");
      }

      const fallback = await queryTicket(TICKET_SELECT_FIELDS);

      return fallback ? Object.assign({}, fallback, {
        workflow_available: false,
        workflow_inactive_message: "Workflow cần được cập nhật để lưu thông tin giao/trả và bảo hành."
      }) : null;
    }
  }

  async function getTicketForLabel(params) {
    try {
      const client = getClient();
      const code = String((params && params.code) || "").trim().toUpperCase();
      const id = String((params && params.id) || "").trim();
      let query = client
        .from("service_tickets")
        .select("id,ticket_code,brand,model,condition_text,received_date,status");

      if (code) {
        query = query.eq("ticket_code", code);
      } else if (id) {
        query = query.eq("id", id);
      } else {
        return null;
      }

      const { data, error } = await query.maybeSingle();

      if (error) {
        throw error;
      }

      const hydrated = await hydrateWorkflowTicketData(data ? [data] : []);
      return hydrated[0] || null;
    } catch (error) {
      throw friendlyError(error, "Không tải được dữ liệu in tem.");
    }
  }

  async function updateTicket(id, data) {
    try {
      const client = getClient();
      const ticketId = String(id || "").trim();
      const expectedUpdatedAt = normalizeText(data && data._expected_updated_at);

      if (!ticketId) {
        throw new Error("Thiếu ID phiếu cần sửa.");
      }

      if (!expectedUpdatedAt) {
        throw new Error("Thiếu mốc cập nhật của phiếu. Vui lòng tải lại trước khi sửa.");
      }

      const payload = sanitizeTicketPayload(data);
      delete payload.status;

      const { error } = await client.rpc("update_service_ticket_details", {
        p_ticket_id: ticketId,
        p_expected_updated_at: expectedUpdatedAt,
        p_customer_name: payload.customer_name,
        p_customer_phone: payload.customer_phone,
        p_customer_address: payload.customer_address,
        p_device_type: payload.device_type,
        p_brand: payload.brand,
        p_model: payload.model,
        p_size: payload.size,
        p_serial_number: payload.serial_number,
        p_condition_text: payload.condition_text,
        p_external_condition: payload.external_condition,
        p_internal_note: payload.internal_note,
        p_received_date: payload.received_date,
        p_deposit_amount: payload.deposit_amount,
        p_estimated_price: payload.estimated_price,
        p_final_price: payload.final_price
      });

      if (error) {
        throw error;
      }

      return await getTicketById(ticketId);
    } catch (error) {
      if (String(error && error.message || "").toLowerCase().includes("ticket was updated by another session")) {
        throw new Error("Phiếu vừa được cập nhật ở nơi khác. Vui lòng tải lại trước khi tiếp tục.");
      }

      throw friendlyError(error, "Không lưu được thay đổi phiếu.");
    }
  }

  async function getDashboardCustomers() {
    try {
      const client = getClient();
      const pageSize = 1000;
      const customers = [];
      const tickets = [];
      let from = 0;

      while (true) {
        const { data, error } = await client
          .from("customers")
          .select(CUSTOMER_FIELDS)
          .order("created_at", { ascending: false })
          .range(from, from + pageSize - 1);

        if (error) {
          throw error;
        }

        if (!data || data.length === 0) {
          break;
        }

        customers.push(...data);

        if (data.length < pageSize) {
          break;
        }

        from += pageSize;
      }

      from = 0;

      while (true) {
        const { data, error } = await client
          .from("service_tickets")
          .select(TICKET_SELECT_FIELDS)
          .order("updated_at", { ascending: false })
          .range(from, from + pageSize - 1);

        if (error) {
          throw error;
        }

        if (!data || data.length === 0) {
          break;
        }

        tickets.push(...mapTickets(data));

        if (data.length < pageSize) {
          break;
        }

        from += pageSize;
      }

      return { customers, tickets };
    } catch (error) {
      throw friendlyError(error, "Không tải được danh sách khách hàng.");
    }
  }

  async function getDashboardWorkflowTickets(limit) {
    try {
      const client = getClient();
      const pageSize = Math.min(Math.max(Number(limit) || 120, 20), 300);
      const { data, error } = await client
        .from("service_tickets")
        .select(WORKFLOW_OVERVIEW_SELECT_FIELDS)
        .order("created_at", { ascending: false })
        .limit(pageSize);

      if (error) {
        throw error;
      }

      return {
        available: true,
        tickets: mapTickets((data || []).map((ticket) => Object.assign({}, ticket, { workflow_available: true }))),
        message: ""
      };
    } catch (error) {
      if (!isWorkflowSchemaError(error)) {
        throw friendlyError(error, "Không tải được hoạt động của phiếu.");
      }

      return {
        available: false,
        tickets: [],
        message: "Workflow chưa được kích hoạt."
      };
    }
  }

  function parseTicketTimestamp(value) {
    if (!value) {
      return 0;
    }

    const time = Date.parse(value);
    return Number.isFinite(time) ? time : 0;
  }

  function hoursSinceTimestamp(value) {
    const time = parseTicketTimestamp(value);
    return time ? Math.max(0, (Date.now() - time) / 3600000) : 0;
  }

  function ymdStartTimestamp(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))
      ? `${value}T00:00:00+07:00`
      : null;
  }

  function firstValidAttentionTimestamp(values) {
    for (const value of values) {
      const text = String(value || "").trim();

      if (!text) {
        continue;
      }

      if (parseTicketTimestamp(text)) {
        return text;
      }
    }

    return new Date().toISOString();
  }

  function attentionAgeMinutes(startedAt) {
    const time = parseTicketTimestamp(startedAt);
    return time ? Math.max(0, Math.floor((Date.now() - time) / 60000)) : 0;
  }

  function attentionPriorityFromAge(ageMinutes) {
    if (ageMinutes >= 72 * 60) {
      return {
        priority: "urgent",
        priorityLabel: "Khẩn cấp",
        priorityRank: 1
      };
    }

    if (ageMinutes >= 48 * 60) {
      return {
        priority: "high",
        priorityLabel: "Ưu tiên cao",
        priorityRank: 2
      };
    }

    return {
      priority: "attention",
      priorityLabel: "Cần chú ý",
      priorityRank: 3
    };
  }

  function ticketAttentionKey(ticket) {
    return String(ticket && (ticket.id || ticket.ticket_code) || "").trim();
  }

  function ticketBrandModel(ticket) {
    return [ticket && ticket.brand, ticket && ticket.model]
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .join(" ");
  }

  function createAttentionBase(ticket) {
    const ticketCode = String(ticket && ticket.ticket_code || "");

    return {
      key: ticketAttentionKey(ticket),
      ticketId: ticket && ticket.id ? ticket.id : null,
      ticketCode,
      customerId: ticket && ticket.customer_id ? ticket.customer_id : null,
      customerCode: ticket && ticket.customer_code ? ticket.customer_code : null,
      customerName: ticket && (ticket.customer_master_name || ticket.customer_name)
        ? (ticket.customer_master_name || ticket.customer_name)
        : null,
      customerPhone: ticket && (ticket.customer_master_phone || ticket.customer_phone)
        ? (ticket.customer_master_phone || ticket.customer_phone)
        : null,
      deviceType: ticket && ticket.device_type ? ticket.device_type : null,
      brand: ticket && ticket.brand ? ticket.brand : null,
      model: ticket && ticket.model ? ticket.model : null,
      brandModel: ticketBrandModel(ticket),
      status: ticket && ticket.status ? ticket.status : null,
      createdAt: ticket && ticket.created_at ? ticket.created_at : null,
      receivedAt: ticket && ticket.received_at ? ticket.received_at : null,
      receivedDate: ticket && ticket.received_date ? ticket.received_date : null,
      repairStartedAt: ticket && ticket.repair_started_at ? ticket.repair_started_at : null,
      readyForHandoverAt: ticket && ticket.ready_for_handover_at ? ticket.ready_for_handover_at : null,
      deliveryDate: ticket && ticket.delivery_date ? ticket.delivery_date : null,
      attentionStartedAt: null,
      ageMinutes: 0,
      priority: "attention",
      priorityLabel: "Cần chú ý",
      priorityRank: 3,
      type: null,
      typeLabel: "",
      reason: "",
      reasons: [],
      relevantDate: null,
      relevantValue: null,
      viewHref: ticketCode ? `search.html?code=${encodeURIComponent(ticketCode)}` : "search.html",
      actionHref: ticketCode ? `search.html?code=${encodeURIComponent(ticketCode)}` : "search.html",
      actionLabel: "Xem phiếu"
    };
  }

  function addAttentionReason(taskMap, ticket, reason) {
    const key = ticketAttentionKey(ticket);

    if (!key || !reason || !reason.type) {
      return;
    }

    const task = taskMap.get(key) || createAttentionBase(ticket);
    const duplicateReason = task.reasons.some((item) => item.type === reason.type && item.label === reason.label);

    if (!duplicateReason) {
      task.reasons.push(reason);
    }

    const currentTime = parseTicketTimestamp(task.attentionStartedAt);
    const nextTime = parseTicketTimestamp(reason.startedAt);

    if (!currentTime || (nextTime && nextTime < currentTime)) {
      task.attentionStartedAt = reason.startedAt;
      task.relevantDate = reason.startedAt;
      task.actionHref = reason.actionHref || task.actionHref;
      task.actionLabel = reason.actionLabel || task.actionLabel;
    }

    if (reason.forceAction === true) {
      task.actionHref = reason.actionHref || task.actionHref;
      task.actionLabel = reason.actionLabel || task.actionLabel;
    }

    taskMap.set(key, task);
  }

  function finalizeAttentionTask(task) {
    const startedAt = firstValidAttentionTimestamp([
      task.attentionStartedAt,
      task.repairStartedAt,
      task.createdAt,
      ymdStartTimestamp(task.receivedDate)
    ]);
    const ageMinutes = attentionAgeMinutes(startedAt);
    const priority = attentionPriorityFromAge(ageMinutes);
    const firstReason = task.reasons[0] || {};

    return Object.assign({}, task, priority, {
      attentionStartedAt: startedAt,
      ageMinutes,
      type: firstReason.type || null,
      typeLabel: task.reasons.map((reason) => reason.label).filter(Boolean).join(" · "),
      reason: task.reasons.map((reason) => reason.description).filter(Boolean).join(" · "),
      relevantDate: task.relevantDate || startedAt,
      relevantValue: null
    });
  }

  function sortAttentionTasks(tasks) {
    return tasks.slice().sort((a, b) => {
      if (a.ageMinutes !== b.ageMinutes) {
        return b.ageMinutes - a.ageMinutes;
      }

      const startedA = parseTicketTimestamp(a.attentionStartedAt);
      const startedB = parseTicketTimestamp(b.attentionStartedAt);

      if (startedA !== startedB) {
        return startedA - startedB;
      }

      return String(a.ticketCode || "").localeCompare(String(b.ticketCode || ""), "vi", { numeric: true });
    });
  }

  function inspectionStartedAt(ticket) {
    return firstValidAttentionTimestamp([
      ticket && ticket.received_at,
      ymdStartTimestamp(ticket && ticket.received_date),
      ticket && ticket.created_at
    ]);
  }

  function repairAttentionStartedAt(ticket) {
    return firstValidAttentionTimestamp([
      ticket && ticket.repair_started_at,
      ticket && ticket.created_at,
      ymdStartTimestamp(ticket && ticket.received_date)
    ]);
  }

  function handoverOverdueDescription(readyAt) {
    const overdueMinutes = Math.max(0, Math.floor((hoursSinceTimestamp(readyAt) - 48) * 60));
    const days = Math.floor(overdueMinutes / 1440);
    const hours = Math.floor((overdueMinutes % 1440) / 60);
    const minutes = overdueMinutes % 60;

    if (days > 0) {
      return `Chờ bàn giao quá ${days} ngày ${hours} giờ`;
    }

    if (hours > 0) {
      return `Chờ bàn giao quá ${hours} giờ ${minutes} phút`;
    }

    return `Chờ bàn giao quá ${minutes} phút`;
  }

  function buildAttentionTasks(groups) {
    const today = todayVietnamYmd();
    const taskMap = new Map();

    (groups.needsInspection || []).forEach((ticket) => {
      const status = ticket && ticket.status;

      if (status !== "mới nhận" && status !== "đang kiểm tra") {
        return;
      }

      addAttentionReason(taskMap, ticket, {
        type: ATTENTION_TYPES.NEEDS_INSPECTION,
        label: "Cần kiểm tra",
        description: status === "mới nhận"
          ? "Phiếu mới nhận — cần kiểm tra ban đầu"
          : "Đang kiểm tra — chưa hoàn tất kiểm tra",
        startedAt: inspectionStartedAt(ticket),
        actionHref: ticket.ticket_code ? `search.html?code=${encodeURIComponent(ticket.ticket_code)}` : "search.html",
        actionLabel: "Xem phiếu"
      });
    });

    (groups.repairing || []).forEach((ticket) => {
      if (ticket.status !== "đang sửa") {
        return;
      }

      const startedAt = repairAttentionStartedAt(ticket);
      const missingStart = !ticket.repair_started_at;
      const hours = hoursSinceTimestamp(ticket.repair_started_at || startedAt);
      let label = "Đang sửa";
      let description = "Đang sửa chữa";

      if (missingStart) {
        label = "Thiếu mốc sửa";
        description = "Thiếu thời điểm bắt đầu sửa";
      } else if (hours >= 72) {
        label = "Quá 72 giờ";
        description = "Ưu tiên cao — đang sửa quá 72 giờ";
      } else if (hours >= 48) {
        label = "Quá 48 giờ";
        description = "Đang sửa quá 48 giờ";
      }

      addAttentionReason(taskMap, ticket, {
        type: ATTENTION_TYPES.REPAIRING,
        label,
        description,
        startedAt,
        actionHref: "ticket-activity.html",
        actionLabel: "Mở Hoạt động phiếu"
      });
    });

    (groups.deliveryToday || []).forEach((ticket) => {
      if (
        ticket.delivery_date !== today
        || ticket.status === "đã trả"
        || ticket.status === "huỷ"
      ) {
        return;
      }

      addAttentionReason(taskMap, ticket, {
        type: ATTENTION_TYPES.DELIVERY_TODAY,
        label: "Giao hôm nay",
        description: "Thiết bị giao/trả hôm nay",
        startedAt: firstValidAttentionTimestamp([
          ticket.repair_started_at,
          ticket.created_at,
          ymdStartTimestamp(ticket.received_date)
        ]),
        actionHref: ticket.ticket_code ? `print-delivery-receipt.html?code=${encodeURIComponent(ticket.ticket_code)}` : "print-delivery-receipt.html",
        actionLabel: "Mở biên nhận"
      });
    });

    (groups.handoverOverdue || []).forEach((ticket) => {
      if (ticket.status !== "chờ bàn giao" || !ticket.ready_for_handover_at) {
        return;
      }

      addAttentionReason(taskMap, ticket, {
        type: ATTENTION_TYPES.HANDOVER_OVERDUE,
        label: "Quá 48 giờ",
        description: handoverOverdueDescription(ticket.ready_for_handover_at),
        startedAt: ticket.ready_for_handover_at,
        actionHref: ticket.ticket_code
          ? `handover-tickets.html?code=${encodeURIComponent(ticket.ticket_code)}`
          : "handover-tickets.html",
        actionLabel: "Mở Bàn giao tivi",
        forceAction: true
      });
    });

    return sortAttentionTasks(Array.from(taskMap.values()).map(finalizeAttentionTask));
  }

  function taskHasReason(task, type) {
    return Boolean(task && task.reasons && task.reasons.some((reason) => reason.type === type));
  }

  function taskHasRepairOverdue(task, hours) {
    return taskHasReason(task, ATTENTION_TYPES.REPAIRING)
      && Boolean(task.repairStartedAt)
      && hoursSinceTimestamp(task.repairStartedAt) >= hours;
  }

  function summarizeAttentionTasks(tasks, partialErrors) {
    const uniqueTasks = sortAttentionTasks(tasks || []);
    const counts = {
      total: uniqueTasks.length,
      needsInspection: uniqueTasks.filter((task) => taskHasReason(task, ATTENTION_TYPES.NEEDS_INSPECTION)).length,
      repairing: uniqueTasks.filter((task) => taskHasReason(task, ATTENTION_TYPES.REPAIRING)).length,
      repairOverdue48: uniqueTasks.filter((task) => taskHasRepairOverdue(task, 48)).length,
      repairOverdue72: uniqueTasks.filter((task) => taskHasRepairOverdue(task, 72)).length,
      deliveryToday: uniqueTasks.filter((task) => taskHasReason(task, ATTENTION_TYPES.DELIVERY_TODAY)).length,
      handoverOverdue48: uniqueTasks.filter((task) => taskHasReason(task, ATTENTION_TYPES.HANDOVER_OVERDUE)).length
    };

    counts.repairOverdue = counts.repairOverdue48;

    return {
      tasks: uniqueTasks,
      counts,
      partialErrors: partialErrors || [],
      generatedAt: new Date().toISOString()
    };
  }

  async function runAttentionQuery(label, buildRequest) {
    const pageSize = 200;
    const tickets = [];
    let from = 0;

    while (true) {
      const { data, error } = await buildRequest(from, from + pageSize - 1);

      if (error) {
        throw new Error(`${label}: ${error.message || "Không tải được dữ liệu."}`);
      }

      if (!data || data.length === 0) {
        break;
      }

      tickets.push(...data);

      if (data.length < pageSize) {
        break;
      }

      from += pageSize;
    }

    return mapTickets(tickets.map((ticket) => Object.assign({}, ticket, { workflow_available: true })));
  }

  async function getAttentionSummary() {
    const today = todayVietnamYmd();
    const client = getClient();
    const requests = {
      repairing: runAttentionQuery("repairing", (from, to) => client
        .from("service_tickets")
        .select(ATTENTION_SELECT_FIELDS)
        .eq("status", "đang sửa")
        .order("repair_started_at", { ascending: true })
        .order("created_at", { ascending: true })
        .range(from, to)),
      needsInspection: runAttentionQuery("needsInspection", (from, to) => client
        .from("service_tickets")
        .select(ATTENTION_SELECT_FIELDS)
        .in("status", ["mới nhận", "đang kiểm tra"])
        .order("created_at", { ascending: true })
        .range(from, to)),
      deliveryToday: runAttentionQuery("deliveryToday", (from, to) => client
        .from("service_tickets")
        .select(ATTENTION_SELECT_FIELDS)
        .eq("delivery_date", today)
        .order("created_at", { ascending: true })
        .range(from, to)),
      handoverOverdue: runAttentionQuery("handoverOverdue", (from, to) => client
        .from("service_tickets")
        .select(HANDOVER_ATTENTION_SELECT_FIELDS)
        .eq("status", "chờ bàn giao")
        .not("ready_for_handover_at", "is", null)
        .lte("ready_for_handover_at", handoverThresholdIso(48))
        .order("ready_for_handover_at", { ascending: true })
        .order("ticket_code", { ascending: true })
        .range(from, to)).catch((error) => {
          if (isWorkflowSchemaError(error)) {
            return [];
          }
          throw error;
        })
    };
    const entries = Object.entries(requests);
    const results = await Promise.allSettled(entries.map((entry) => entry[1]));
    const groups = {};
    const partialErrors = [];

    entries.forEach(([key], index) => {
      const result = results[index];

      if (result.status === "fulfilled") {
        groups[key] = result.value;
      } else {
        groups[key] = [];
        partialErrors.push(result.reason && result.reason.message ? result.reason.message : `${key}: Không tải được dữ liệu.`);
      }
    });

    return summarizeAttentionTasks(buildAttentionTasks(groups), partialErrors);
  }

  async function getAttentionTasks() {
    const payload = await getAttentionSummary();

    return Object.assign({}, payload, {
      tasks: sortAttentionTasks(payload.tasks || [])
    });
  }

  function paginateAttentionTasks(tasks, page, pageSize) {
    const safeTasks = sortAttentionTasks(tasks || []);
    const safePageSize = Math.max(Number.parseInt(pageSize, 10) || 8, 1);
    const total = safeTasks.length;
    const totalPages = Math.max(1, Math.ceil(total / safePageSize));
    const currentPage = Math.min(Math.max(Number.parseInt(page, 10) || 1, 1), totalPages);
    const startIndex = (currentPage - 1) * safePageSize;
    const items = safeTasks.slice(startIndex, startIndex + safePageSize);

    return {
      items,
      total,
      page: currentPage,
      pageSize: safePageSize,
      totalPages,
      startIndex,
      endIndex: Math.min(startIndex + items.length, total)
    };
  }

  async function runPagedRows(label, buildRequest) {
    const pageSize = 1000;
    const rows = [];
    let from = 0;

    while (true) {
      const { data, error } = await buildRequest(from, from + pageSize - 1);

      if (error) {
        throw new Error(`${label}: ${error.message || "Không tải được dữ liệu."}`);
      }

      if (!data || data.length === 0) {
        break;
      }

      rows.push(...data);

      if (data.length < pageSize) {
        break;
      }

      from += pageSize;
    }

    return rows;
  }

  function activeProcessingKey(ticket) {
    const status = ticket && ticket.status;

    if (status === "mới nhận") {
      return "new";
    }

    if (status === "đang kiểm tra") {
      return "checking";
    }

    if (status === "chờ bàn giao") {
      return "handover_waiting";
    }

    if (status !== "đang sửa") {
      return null;
    }

    if (!ticket.repair_started_at) {
      return "repair_missing_start";
    }

    const hours = hoursSinceTimestamp(ticket.repair_started_at);

    if (hours >= 72) {
      return "repair_over_72";
    }

    if (hours >= 48) {
      return "repair_over_48";
    }

    return "repair_under_48";
  }

  function summarizeActiveProcessingRows(rows) {
    const counts = new Map(ACTIVE_PROCESSING_GROUPS.map((group) => [group.key, 0]));

    (rows || []).forEach((ticket) => {
      const key = activeProcessingKey(ticket);

      if (key) {
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    });

    const total = Array.from(counts.values()).reduce((sum, count) => sum + count, 0);
    const groups = ACTIVE_PROCESSING_GROUPS.map((group) => {
      const count = counts.get(group.key) || 0;
      return Object.assign({}, group, {
        count,
        percent: total > 0 ? Math.round((count / total) * 100) : 0
      });
    });
    const over48 = (counts.get("repair_over_48") || 0) + (counts.get("repair_over_72") || 0);

    return {
      total,
      groups,
      summary: total > 0
        ? `Hiện có ${total} phiếu đang xử lý, trong đó ${over48} phiếu đã sửa quá 48 giờ.`
        : "Hiện không có phiếu đang trong quá trình xử lý.",
      generatedAt: new Date().toISOString()
    };
  }

  async function getActiveProcessingSummary() {
    try {
      const client = getClient();
      const rows = await runPagedRows("activeProcessing", (from, to) => client
        .from("service_tickets")
        .select("id,status,repair_started_at,created_at")
        .in("status", ["mới nhận", "đang kiểm tra", "đang sửa", "chờ bàn giao"])
        .order("status", { ascending: true })
        .order("repair_started_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true })
        .range(from, to));

      return summarizeActiveProcessingRows(rows);
    } catch (error) {
      throw friendlyError(error, "Không thể tải dữ liệu biểu đồ tiến độ xử lý.");
    }
  }

  async function getActiveProgressSummary() {
    const stats = await getDashboardStats();
    const statuses = stats.statuses || {};
    const totalActive = ACTIVE_PROGRESS_STATUSES.reduce((sum, item) => sum + (statuses[item.status] || 0), 0);
    const segments = ACTIVE_PROGRESS_STATUSES.map((item) => {
      const count = statuses[item.status] || 0;
      return {
        status: item.status,
        label: item.label,
        count,
        percent: totalActive > 0 ? Math.round((count / totalActive) * 100) : 0,
        href: item.href
      };
    });

    return {
      totalActive,
      segments
    };
  }

  function currentWeekStartYmd() {
    const today = todayVietnamYmd();
    return addDaysYmd(today, -ymdWeekdayIndex(today));
  }

  async function getWeeklyIntakeRows(weekStart, weekEnd) {
    const client = getClient();
    const nextWeekStart = addDaysYmd(weekEnd, 1);
    const startIso = vietnamYmdToUtcIso(weekStart);
    const endIso = vietnamYmdToUtcIso(nextWeekStart);

    return runPagedRows("weeklyIntake", (from, to) => client
      .from("service_tickets")
      .select("id,received_date,created_at")
      .or([
        `and(received_date.gte.${weekStart},received_date.lte.${weekEnd})`,
        `and(received_date.is.null,created_at.gte.${startIso},created_at.lt.${endIso})`
      ].join(","))
      .order("received_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true })
      .range(from, to));
  }

  async function getWeeklyIntakeSummary(options) {
    const params = options || {};
    const requestedOffset = Number.parseInt(params.weekOffset || 0, 10);
    const weekOffset = Number.isFinite(requestedOffset) ? Math.min(requestedOffset, 0) : 0;
    const weekStart = addDaysYmd(currentWeekStartYmd(), weekOffset * 7);
    const weekEnd = addDaysYmd(weekStart, 6);
    const nextWeekStart = addDaysYmd(weekEnd, 1);
    const queryStartIso = vietnamYmdToUtcIso(weekStart);
    const queryEndIso = vietnamYmdToUtcIso(nextWeekStart);
    const today = todayVietnamYmd();
    const labels = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"];
    const shortLabels = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
    const dates = labels.map((label, index) => ({
      label,
      shortLabel: shortLabels[index],
      date: addDaysYmd(weekStart, index)
    }));
    const countByDate = new Map(dates.map((item) => [item.date, 0]));
    const rows = await getWeeklyIntakeRows(weekStart, weekEnd);

    rows.forEach((ticket) => {
      const intakeDate = ticket.received_date || timestampToVietnamYmd(ticket.created_at);

      if (countByDate.has(intakeDate)) {
        countByDate.set(intakeDate, countByDate.get(intakeDate) + 1);
      }
    });

    const maxCount = Math.max(0, ...Array.from(countByDate.values()));
    const days = dates.map((item) => {
      const count = countByDate.get(item.date) || 0;
      return Object.assign({}, item, {
        count,
        percent: maxCount > 0 ? Math.round((count / maxCount) * 100) : 0,
        isPeak: maxCount > 0 && count === maxCount,
        isToday: item.date === today && weekOffset === 0
      });
    });
    const total = days.reduce((sum, item) => sum + item.count, 0);
    const peak = days.find((item) => item.count === maxCount) || days[0];

    return {
      sourceField: "received_date, fallback created_at",
      sourceReason: "Biểu đồ tuần ưu tiên received_date vì đây là ngày tiếp nhận nghiệp vụ; nếu thiếu mới fallback theo created_at.",
      weekOffset,
      weekStart,
      weekEnd,
      queryStartIso,
      queryEndIso,
      canGoNext: weekOffset < 0,
      days,
      total,
      average: Number((total / 7).toFixed(1)),
      peak: maxCount > 0 ? peak : null,
      summary: total > 0 && peak
        ? `Tuần này tiếp nhận ${total} phiếu; ${peak.label} cao nhất với ${peak.count} phiếu.`
        : "Tuần này chưa có phiếu tiếp nhận."
    };
  }

  async function getTicketReceiptHistory(params) {
    try {
      const client = getClient();
      const options = params || {};
      const pageSize = Math.min(Math.max(Number(options.pageSize) || 20, 1), 100);
      const page = Math.max(Number(options.page) || 1, 1);
      const keyword = String(options.keyword || "").trim();
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      const customerIds = keyword ? await findTicketHistoryCustomerIds(keyword) : [];
      const historyFilter = buildTicketHistoryFilter(keyword, customerIds);
      let query = client
        .from("service_tickets")
        .select(TICKET_HISTORY_SELECT_FIELDS, { count: "exact" })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to);

      if (historyFilter) {
        query = query.or(historyFilter);
      }

      const { data, error, count } = await query;

      if (error) {
        throw error;
      }

      return {
        tickets: mapTickets(data || []),
        total: count || 0,
        page,
        pageSize
      };
    } catch (error) {
      throw friendlyError(error, "Không tải được lịch sử nhận phiếu.");
    }
  }

  async function getRepairingTickets(params) {
    try {
      const client = getClient();
      const options = params || {};
      const pageSize = Math.min(Math.max(Number(options.pageSize) || 15, 1), 50);
      const page = Math.max(Number(options.page) || 1, 1);
      const keyword = String(options.keyword || "").trim();
      const filter = options.filter || "all";
      const sort = options.sort || "priority";
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      const customerIds = keyword ? await findTicketHistoryCustomerIds(keyword) : [];
      let query = buildRepairingTicketsQuery(client, {
        keyword,
        customerIds,
        filter
      }, REPAIRING_TICKET_SELECT_FIELDS, { count: "exact" });

      query = applyRepairingSort(query, sort).range(from, to);

      const countFilters = ["all", "under48", "over48", "over72", "missing-start"];
      const [{ data, error, count }, countValues] = await Promise.all([
        query,
        Promise.all(countFilters.map((key) => countRepairingTickets({ keyword }, customerIds, key)))
      ]);

      if (error) {
        throw error;
      }

      const filterCounts = {};
      countFilters.forEach((key, index) => {
        filterCounts[key] = countValues[index] || 0;
      });

      const totalCount = count || 0;
      const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

      return {
        tickets: mapTickets(data || []),
        totalCount,
        page,
        pageSize,
        totalPages,
        filterCounts
      };
    } catch (error) {
      throw friendlyError(error, "Không tải được danh sách phiếu đang sửa chữa.");
    }
  }

  async function getHandoverTickets(params) {
    try {
      const client = getClient();
      const options = params || {};
      const pageSize = Math.min(Math.max(Number(options.pageSize) || 20, 1), 50);
      const page = Math.max(Number(options.page) || 1, 1);
      const keyword = String(options.keyword || "").trim();
      const filter = options.filter || "all";
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      const customerIds = keyword ? await findTicketHistoryCustomerIds(keyword) : [];
      let query = buildHandoverTicketsQuery(client, {
        keyword,
        customerIds,
        filter
      }, HANDOVER_TICKET_SELECT_FIELDS, { count: "exact" });

      query = query
        .order("ready_for_handover_at", { ascending: true, nullsFirst: false })
        .order("ticket_code", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);

      const countFilters = ["all", "under24", "warning", "over48"];
      const [{ data, error, count }, countValues] = await Promise.all([
        query,
        Promise.all(countFilters.map((key) => countHandoverTickets({ keyword }, customerIds, key)))
      ]);

      if (error) {
        throw error;
      }

      const filterCounts = {};
      countFilters.forEach((key, index) => {
        filterCounts[key] = countValues[index] || 0;
      });

      const totalCount = count || 0;

      return {
        available: true,
        tickets: mapTickets((data || []).map((ticket) => Object.assign({}, ticket, { workflow_available: true }))),
        totalCount,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
        filterCounts,
        message: ""
      };
    } catch (error) {
      if (isWorkflowSchemaError(error)) {
        return {
          available: false,
          tickets: [],
          totalCount: 0,
          page: 1,
          pageSize: Math.min(Math.max(Number(params && params.pageSize) || 20, 1), 50),
          totalPages: 1,
          filterCounts: { all: 0, under24: 0, warning: 0, over48: 0 },
          message: "Khu Bàn giao tivi sẽ sẵn sàng sau khi backend được kích hoạt."
        };
      }

      throw friendlyError(error, "Không tải được danh sách tivi chờ bàn giao.");
    }
  }

  function isReminderSchemaError(error) {
    const code = String((error && error.code) || "").toLowerCase();
    const message = String((error && (error.message || error.details || error.hint)) || "").toLowerCase();
    return code === "42p01"
      || code === "42883"
      || code === "pgrst202"
      || code === "pgrst205"
      || message.includes("ticket_reminders")
      || message.includes("ticket_reminder");
  }

  function reminderError(error, fallbackMessage) {
    if (isReminderSchemaError(error)) {
      const unavailable = new Error("Module lịch hẹn chưa được kích hoạt trên dữ liệu hệ thống.");
      unavailable.code = "REMINDERS_UNAVAILABLE";
      return unavailable;
    }

    const message = String((error && (error.message || error.details || error.hint)) || "");

    if (message.includes("Reminder was updated by another session")) {
      const stale = new Error("Lịch hẹn vừa được cập nhật ở nơi khác. Vui lòng tải lại trước khi tiếp tục.");
      stale.code = "REMINDER_STALE";
      return stale;
    }

    const code = String((error && error.code) || "").toLowerCase();
    const networkMessage = message.toLowerCase();
    if (code === "fetch_error"
      || code === "etimedout"
      || networkMessage.includes("failed to fetch")
      || networkMessage.includes("network")
      || networkMessage.includes("timeout")) {
      const uncertain = new Error("Kết nối bị gián đoạn. Bạn có thể bấm lưu lại; hệ thống sẽ dùng cùng mã yêu cầu để tránh tạo trùng.");
      uncertain.code = "REMINDER_OUTCOME_UNKNOWN";
      return uncertain;
    }

    return friendlyError(error, fallbackMessage);
  }

  function reminderDayBoundaries() {
    const today = todayVietnamYmd();
    const tomorrow = addDaysYmd(today, 1);
    return {
      nowIso: new Date().toISOString(),
      today,
      todayStartIso: vietnamYmdToUtcIso(today),
      tomorrowStartIso: vietnamYmdToUtcIso(tomorrow)
    };
  }

  async function countReminders(configure) {
    let query = getClient()
      .from("ticket_reminders")
      .select("id", { count: "exact", head: true });
    query = configure(query);
    const { count, error } = await query;

    if (error) {
      throw error;
    }

    return count || 0;
  }

  async function getReminderSummary() {
    try {
      const boundaries = reminderDayBoundaries();
      const [overdue, today, upcoming, completed, cancelled] = await Promise.all([
        countReminders((query) => query
          .eq("status", "pending")
          .lt("scheduled_at", boundaries.nowIso)),
        countReminders((query) => query
          .eq("status", "pending")
          .gte("scheduled_at", boundaries.nowIso)
          .lt("scheduled_at", boundaries.tomorrowStartIso)),
        countReminders((query) => query
          .eq("status", "pending")
          .gte("scheduled_at", boundaries.tomorrowStartIso)),
        countReminders((query) => query.eq("status", "completed")),
        countReminders((query) => query.eq("status", "cancelled"))
      ]);

      return {
        available: true,
        overdue,
        today,
        upcoming,
        completed,
        cancelled,
        needsAction: overdue + today + upcoming,
        immediate: overdue + today
      };
    } catch (error) {
      throw reminderError(error, "Không tải được tổng quan lịch hẹn.");
    }
  }

  async function getAttentionReminderCounts() {
    const summary = await getReminderSummary();
    return {
      overdue: summary.overdue,
      today: summary.today,
      total: summary.immediate
    };
  }

  function applyReminderListFilter(query, filter, boundaries) {
    const normalized = String(filter || "needs_action");

    if (normalized === "completed" || normalized === "cancelled") {
      return query.eq("status", normalized);
    }

    query = query.eq("status", "pending");

    if (normalized === "overdue") {
      return query.lt("scheduled_at", boundaries.nowIso);
    }

    if (normalized === "today") {
      return query
        .gte("scheduled_at", boundaries.nowIso)
        .lt("scheduled_at", boundaries.tomorrowStartIso);
    }

    if (normalized === "upcoming") {
      return query.gte("scheduled_at", boundaries.tomorrowStartIso);
    }

    return query;
  }

  function applyReminderSearch(query, keyword) {
    const safeKeyword = cleanPostgrestSearchValue(keyword);

    if (!safeKeyword) {
      return query;
    }

    const normalizedCode = safeKeyword.toUpperCase();
    return query.or([
      `ticket_code.ilike.%${normalizedCode}%`,
      `customer_code.ilike.%${normalizedCode}%`,
      `customer_name.ilike.%${safeKeyword}%`,
      `customer_phone.ilike.%${safeKeyword}%`,
      `device_brand.ilike.%${safeKeyword}%`,
      `device_model.ilike.%${safeKeyword}%`,
      `title.ilike.%${safeKeyword}%`,
      `note.ilike.%${safeKeyword}%`
    ].join(","));
  }

  async function searchReminderSuggestions(keyword, limit) {
    try {
      const safeLimit = Math.min(Math.max(Number(limit) || 5, 1), 5);
      let query = getClient()
        .from("ticket_reminders")
        .select("id,ticket_code,customer_code,customer_name,device_brand,device_model,title,scheduled_at")
        .order("scheduled_at", { ascending: true })
        .limit(safeLimit);

      query = applyReminderSearch(query, keyword);
      const { data, error } = await query;

      if (error) {
        throw error;
      }

      return data || [];
    } catch (error) {
      throw reminderError(error, "Không tải được gợi ý lịch hẹn.");
    }
  }

  async function getRemindersPage(params) {
    try {
      const options = params || {};
      const pageSize = Math.min(Math.max(Number(options.pageSize) || 10, 1), 50);
      const page = Math.max(Number(options.page) || 1, 1);
      const filter = String(options.filter || "needs_action");
      const reminderType = String(options.reminderType || "all");
      const boundaries = reminderDayBoundaries();
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      let query = getClient()
        .from("ticket_reminders")
        .select(REMINDER_FIELDS, { count: "exact" });

      query = applyReminderListFilter(query, filter, boundaries);
      query = applyReminderSearch(query, options.keyword);

      if (reminderType !== "all") {
        query = query.eq("reminder_type", reminderType);
      }

      if (filter === "completed" || filter === "cancelled") {
        query = query
          .order("updated_at", { ascending: false })
          .order("id", { ascending: true });
      } else {
        query = query
          .order("scheduled_at", { ascending: true })
          .order("priority_rank", { ascending: true })
          .order("created_at", { ascending: true })
          .order("ticket_code", { ascending: true })
          .order("id", { ascending: true });
      }

      const { data, error, count } = await query.range(from, to);

      if (error) {
        throw error;
      }

      const total = count || 0;
      return {
        available: true,
        reminders: data || [],
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
      };
    } catch (error) {
      throw reminderError(error, "Không tải được danh sách lịch hẹn.");
    }
  }

  async function executeReminderRpc(name, payload, fallbackMessage) {
    try {
      const { data, error } = await getClient().rpc(name, payload);

      if (error) {
        throw error;
      }

      return Array.isArray(data) ? (data[0] || null) : data;
    } catch (error) {
      throw reminderError(error, fallbackMessage);
    }
  }

  function createTicketReminder(data) {
    const payload = data || {};
    return executeReminderRpc("create_ticket_reminder", {
      p_ticket_id: payload.ticketId,
      p_reminder_type: payload.reminderType,
      p_title: payload.title,
      p_note: payload.note || null,
      p_scheduled_at: payload.scheduledAt,
      p_client_request_id: payload.clientRequestId,
      p_contact_phone: payload.customerPhone || null,
      p_priority: payload.priority || "normal"
    }, "Không tạo được lịch hẹn.");
  }

  function updateTicketReminder(data) {
    const payload = data || {};
    return executeReminderRpc("update_ticket_reminder", {
      p_reminder_id: payload.id,
      p_expected_updated_at: payload.expectedUpdatedAt,
      p_reminder_type: payload.reminderType,
      p_title: payload.title,
      p_note: payload.note || null,
      p_scheduled_at: payload.scheduledAt,
      p_customer_phone: payload.customerPhone || null,
      p_priority: payload.priority || "normal"
    }, "Không cập nhật được lịch hẹn.");
  }

  function completeTicketReminder(reminder) {
    return executeReminderRpc("complete_ticket_reminder", {
      p_reminder_id: reminder && reminder.id,
      p_expected_updated_at: reminder && reminder.updated_at
    }, "Không hoàn thành được lịch hẹn.");
  }

  function cancelTicketReminder(reminder) {
    return executeReminderRpc("cancel_ticket_reminder", {
      p_reminder_id: reminder && reminder.id,
      p_expected_updated_at: reminder && reminder.updated_at
    }, "Không hủy được lịch hẹn.");
  }

  window.AMTvUtils = {
    brands: TV_BRANDS.slice(),
    sizes: TV_SIZE_VALUES.slice(),
    normalizeBrand,
    inferTvSizeFromModel,
    formatTvSize,
    populateBrandDatalist,
    attachTvModelAssist
  };

  window.AMMoneyUtils = {
    digits: moneyDigits,
    format: formatMoneyValue,
    normalize: normalizeMoneyValue,
    attachInput: attachMoneyInput,
    attachInputs: attachMoneyInputs,
    formatInput: formatMoneyInput,
    formatInputs: formatMoneyInputs
  };

  window.AMApi = {
    TICKET_STATUSES,
    CREATABLE_TICKET_STATUSES,
    PRE_REPAIR_STATUSES,
    WORKFLOW_ACTIONS,
    getClient,
    normalizeVNPhone,
    formatTicketStatusLabel,
    classifyHandoverTiming,
    formatHandoverDateTime,
    getCurrentUser,
    checkInternalAccess,
    requireInternalAccess,
    signOut,
    createTicket,
    findCustomersByPhone,
    searchCustomers,
    getTicketHistoryByCustomerId,
    getDashboardCustomers,
    getTicketReceiptHistory,
    getRepairingTickets,
    getHandoverTickets,
    getReminderSummary,
    getAttentionReminderCounts,
    getRemindersPage,
    searchReminderSuggestions,
    createTicketReminder,
    updateTicketReminder,
    completeTicketReminder,
    cancelTicketReminder,
    getWarrantyRecords,
    getWarrantySearchSuggestions,
    searchWarrantyRecords,
    getAttentionTasks,
    getAttentionSummary,
    sortAttentionTasks,
    paginateAttentionTasks,
    getActiveProcessingSummary,
    getActiveProgressSummary,
    getWeeklyIntakeSummary,
    getDashboardWorkflowTickets,
    getDashboardStats,
    searchTickets,
    getTicketsPage,
    getTicketSearchSuggestions,
    getTicketYears,
    getTicketsForExport,
    getTicketByCode,
    getTicketById,
    getTicketForDeliveryReceipt,
    getTicketForLabel,
    updateTicket,
    ensureWorkflowClientRequestId,
    clearWorkflowClientRequestId,
    shouldClearWorkflowClientRequestId,
    recordTicketWorkflowAction
  };
})();

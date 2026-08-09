(function () {
  "use strict";

  const MODE_SINGLE = "single";
  const MODE_BATCH = "batch";
  const MAX_FRESH_CONCURRENCY = 4;
  const LABEL_FIT_STEP = 0.25;
  const LABEL_FIT_TOLERANCE = 0.75;
  const MAX_LABEL_FIT_ATTEMPTS = 80;
  const MULTI_PRINT_RECOVERY_STORAGE_KEY = "anhminh.multiPrintRecovery.v1";
  const LEGACY_BATCH_REPRINT_STORAGE_KEY = "anhMinhLastBatchPrintRefsV1";
  const MULTI_PRINT_RECOVERY_VERSION = 1;
  const BATCH_REPRINT_TRACE_KEY = "__AMBatchPrintTrace";
  const BATCH_STATES = Object.freeze({
    DRAFT: "draft",
    VALIDATING: "validating",
    CREATING: "creating",
    PARTIAL: "partial",
    CREATED: "created",
    PREPARING_PRINT: "preparing_print",
    PRINT_READY: "print_ready",
    PRINT_FAILED: "print_failed",
    PRINT_TRIGGERED: "print_triggered"
  });
  const DEVICE_FIELDS = [
    "device_type",
    "brand",
    "model",
    "size",
    "serial_number",
    "condition_text",
    "external_condition",
    "received_date",
    "status",
    "deposit_amount",
    "estimated_price",
    "final_price",
    "internal_note"
  ];
  const DUPLICATE_FIELDS = ["device_type", "brand", "size"];
  const DEFAULT_MULTI_LABEL_SIZE = "60x40";
  const MULTI_LABEL_SIZES = Object.freeze({
    "50x30": { label: "50 × 30 mm", width: "50mm", height: "30mm", className: "label-50x30" },
    "58x30": { label: "58 × 30 mm", width: "58mm", height: "30mm", className: "label-58x30" },
    "58x40": { label: "58 × 40 mm", width: "58mm", height: "40mm", className: "label-58x40" },
    "60x40": { label: "60 × 40 mm", width: "60mm", height: "40mm", className: "label-60x40" },
    "80x50": { label: "80 × 50 mm", width: "80mm", height: "50mm", className: "label-80x50" }
  });
  const MULTI_LABEL_LAYOUTS = Object.freeze({
    "50x30": { nameLines: 2, modelLines: 1, conditionLines: 2 },
    "58x30": { nameLines: 2, modelLines: 1, conditionLines: 2 },
    "58x40": { nameLines: 2, modelLines: 2, conditionLines: 3 },
    "60x40": { nameLines: 2, modelLines: 2, conditionLines: 3 },
    "80x50": { nameLines: 2, modelLines: 2, conditionLines: 4 }
  });

  const form = document.getElementById("ticketForm");
  const modeGroup = document.getElementById("ticketCreateMode");
  const sharedCustomerHint = document.getElementById("sharedCustomerHint");
  const deviceListHeading = document.getElementById("deviceListHeading");
  const primaryDeviceCard = document.getElementById("primaryDeviceCard");
  const additionalDeviceCards = document.getElementById("additionalDeviceCards");
  const deviceCardTemplate = document.getElementById("deviceCardTemplate");
  const addDeviceButton = document.getElementById("addDeviceButton");
  const singleCreateActions = document.getElementById("singleCreateActions");
  const batchActionBar = document.getElementById("batchActionBar");
  const batchActionSummary = document.getElementById("batchActionSummary");
  const cancelBatchButton = document.getElementById("cancelBatchButton");
  const validateBatchButton = document.getElementById("validateBatchButton");
  const createBatchButton = document.getElementById("createBatchButton");
  const batchLabelSizeSelect = document.getElementById("batchLabelSizeSelect");
  const batchResult = document.getElementById("batchResult");
  const batchResultTitle = document.getElementById("batchResultTitle");
  const batchResultList = document.getElementById("batchResultList");
  const reprintBatchButton = document.getElementById("reprintBatchButton");
  const batchResultLabelSizeSelect = document.getElementById("batchResultLabelSizeSelect");
  const newBatchButton = document.getElementById("newBatchButton");
  const addForSameCustomerButton = document.getElementById("addForSameCustomerButton");
  const batchPrintSurface = document.getElementById("batchPrintSurface");

  let creationMode = MODE_SINGLE;
  let cards = [];
  let batchRunning = false;
  let batchPrintRunning = false;
  let batchState = BATCH_STATES.DRAFT;
  let currentDraftLabelSize = DEFAULT_MULTI_LABEL_SIZE;
  let lastBatchLabelSize = DEFAULT_MULTI_LABEL_SIZE;
  let suppressResetHandling = false;
  let pendingAfterPrintCleanup = null;
  let lastCreatedBatchTicketRefs = [];
  let currentBatchPrintRecovery = null;
  let recoveredBatchEntries = [];
  let currentIntakeBatchId = null;
  let intakeBatchCapabilityAvailable = null;
  let batchRecoveryIssue = "";
  let batchRecoveryBlocked = false;
  let batchRecoveryLoading = false;
  let batchWorkflowIntent = "start";
  let batchWorkflowIntentRequest = 0;

  function isBatchPrintDebugEnabled() {
    const params = new URLSearchParams(window.location.search);
    return params.get("batchPrintDebug") === "1"
      || ["localhost", "127.0.0.1"].includes(window.location.hostname);
  }

  function traceBatchPrint(stage, details) {
    const trace = Array.isArray(window[BATCH_REPRINT_TRACE_KEY])
      ? window[BATCH_REPRINT_TRACE_KEY]
      : [];
    const entry = Object.assign({ stage, at: Date.now() }, details || {});
    trace.push(entry);
    window[BATCH_REPRINT_TRACE_KEY] = trace.slice(-40);
    if (isBatchPrintDebugEnabled()) {
      console.info("[reprint]", entry);
    }
  }

  function isValidBatchTicketId(value) {
    return /^[A-Za-z0-9][A-Za-z0-9-]{7,127}$/.test(String(value || "").trim());
  }

  function isValidBatchTicketCode(value) {
    return /^AM[A-Za-z0-9-]{1,63}$/.test(String(value || "").trim());
  }

  function normalizeBatchTicketRefs(value) {
    if (!Array.isArray(value)) {
      return [];
    }

    const seen = new Set();
    return value.reduce((refs, item) => {
      const ticketId = String(item && item.ticketId || "").trim();
      const ticketCode = String(item && item.ticketCode || "").trim();
      if (!isValidBatchTicketId(ticketId) || !isValidBatchTicketCode(ticketCode) || seen.has(ticketId)) {
        return refs;
      }
      seen.add(ticketId);
      refs.push(Object.freeze({ ticketId, ticketCode }));
      return refs;
    }, []);
  }

  function buildBatchPrintRecovery(refs, options) {
    const settings = options || {};
    const normalized = normalizeBatchTicketRefs(refs);
    if (!normalized.length) {
      return null;
    }

    return Object.freeze({
      version: MULTI_PRINT_RECOVERY_VERSION,
      ticketIds: normalized.map((ref) => ref.ticketId),
      ticketCodes: normalized.map((ref) => ref.ticketCode),
      selectedLabelSize: normalizeMultiLabelSize(settings.selectedLabelSize || lastBatchLabelSize),
      createdAt: settings.createdAt || new Date().toISOString()
    });
  }

  function parseBatchPrintRecovery(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    if (value.version !== MULTI_PRINT_RECOVERY_VERSION || !Array.isArray(value.ticketIds) || !Array.isArray(value.ticketCodes)) {
      return null;
    }
    if (!value.ticketIds.length || value.ticketIds.length !== value.ticketCodes.length) {
      return null;
    }
    if (!Number.isFinite(Date.parse(String(value.createdAt || "")))) {
      return null;
    }

    const refs = normalizeBatchTicketRefs(value.ticketIds.map((ticketId, index) => ({
      ticketId,
      ticketCode: value.ticketCodes[index]
    })));
    if (refs.length !== value.ticketIds.length) {
      return null;
    }

    return buildBatchPrintRecovery(refs, {
      selectedLabelSize: normalizeMultiLabelSize(value.selectedLabelSize),
      createdAt: String(value.createdAt)
    });
  }

  function clearBatchPrintRecovery() {
    lastCreatedBatchTicketRefs = [];
    currentBatchPrintRecovery = null;
    recoveredBatchEntries = [];
    batchRecoveryIssue = "";
    batchRecoveryBlocked = false;
    batchRecoveryLoading = false;
    lastBatchLabelSize = DEFAULT_MULTI_LABEL_SIZE;
    if (batchResultLabelSizeSelect) {
      batchResultLabelSizeSelect.value = lastBatchLabelSize;
    }
    try {
      window.sessionStorage.removeItem(MULTI_PRINT_RECOVERY_STORAGE_KEY);
      window.sessionStorage.removeItem(LEGACY_BATCH_REPRINT_STORAGE_KEY);
    } catch (_error) {
      // Page-session state is already cleared even when storage is unavailable.
    }
  }

  function saveBatchTicketRefs(refs, options) {
    const settings = options || {};
    const normalized = normalizeBatchTicketRefs(refs);
    lastCreatedBatchTicketRefs = normalized;
    if (!settings.preserveRuntimeState) {
      recoveredBatchEntries = [];
      batchRecoveryIssue = "";
      batchRecoveryBlocked = false;
    }
    const recovery = buildBatchPrintRecovery(normalized, {
      selectedLabelSize: settings.selectedLabelSize || lastBatchLabelSize,
      createdAt: settings.createdAt || (currentBatchPrintRecovery && currentBatchPrintRecovery.createdAt)
    });
    currentBatchPrintRecovery = recovery;
    lastBatchLabelSize = recovery
      ? normalizeMultiLabelSize(recovery.selectedLabelSize)
      : DEFAULT_MULTI_LABEL_SIZE;
    if (batchResultLabelSizeSelect) {
      batchResultLabelSizeSelect.value = lastBatchLabelSize;
    }
    try {
      if (recovery) {
        window.sessionStorage.setItem(MULTI_PRINT_RECOVERY_STORAGE_KEY, JSON.stringify(recovery));
        window.sessionStorage.removeItem(LEGACY_BATCH_REPRINT_STORAGE_KEY);
      } else {
        window.sessionStorage.removeItem(MULTI_PRINT_RECOVERY_STORAGE_KEY);
        window.sessionStorage.removeItem(LEGACY_BATCH_REPRINT_STORAGE_KEY);
      }
    } catch (_error) {
      // Retry can still work during this page session when sessionStorage is unavailable.
    }
    if (
      normalized.length > 1
      && window.AMMultiTicketPresentation
      && typeof window.AMMultiTicketPresentation.registerGroup === "function"
    ) {
      window.AMMultiTicketPresentation.registerGroup(normalized, {
        createdAt: recovery && recovery.createdAt
      });
    }
    return normalized;
  }

  function loadBatchPrintRecovery() {
    try {
      const rawRecovery = window.sessionStorage.getItem(MULTI_PRINT_RECOVERY_STORAGE_KEY);
      if (rawRecovery) {
        const recovery = parseBatchPrintRecovery(JSON.parse(rawRecovery));
        if (!recovery) {
          window.sessionStorage.removeItem(MULTI_PRINT_RECOVERY_STORAGE_KEY);
          return null;
        }
        currentBatchPrintRecovery = recovery;
        return recovery;
      }

      // Migrate the old local-only reference list once so an already-created batch remains recoverable.
      const legacyRefs = normalizeBatchTicketRefs(JSON.parse(
        window.sessionStorage.getItem(LEGACY_BATCH_REPRINT_STORAGE_KEY) || "[]"
      ));
      if (!legacyRefs.length) {
        return null;
      }
      saveBatchTicketRefs(legacyRefs, { selectedLabelSize: DEFAULT_MULTI_LABEL_SIZE });
      return currentBatchPrintRecovery;
    } catch (_error) {
      try {
        window.sessionStorage.removeItem(MULTI_PRINT_RECOVERY_STORAGE_KEY);
      } catch (_storageError) {
        // Invalid storage must never block the normal form.
      }
      return null;
    }
  }

  function getExistingCreatedCardTicketRefs() {
    return normalizeBatchTicketRefs(cards.filter((card) => card.created && card.created.id).map((card) => ({
      ticketId: card.created && card.created.id,
      ticketCode: card.created && card.created.ticket_code
    })));
  }

  function getCreatedCardTicketRefs() {
    const normalized = getExistingCreatedCardTicketRefs();
    return normalized.length === cards.length ? normalized : [];
  }

  function getExactBatchTicketRefs() {
    if (lastCreatedBatchTicketRefs.length) {
      return lastCreatedBatchTicketRefs;
    }

    const currentBatchRefs = getCreatedCardTicketRefs();
    return currentBatchRefs.length ? saveBatchTicketRefs(currentBatchRefs) : [];
  }

  function hasBatchWorkflowApiContract() {
    return Boolean(
      window.AMApi
      && typeof window.AMApi.resolveLabelWorkflowAction === "function"
    );
  }

  function resolveBatchWorkflowAction(ticket) {
    if (!hasBatchWorkflowApiContract()) {
      return null;
    }
    const action = window.AMApi.resolveLabelWorkflowAction(ticket);
    return action === "START_REPAIR" || action === "REPRINT_LABEL" ? action : null;
  }

  function resolveBatchWorkflowIntent(entries) {
    const actions = (entries || []).map((entry) => resolveBatchWorkflowAction(entry.printJob));

    if (actions.some((action) => action === "START_REPAIR")) {
      return "start";
    }

    return actions.length && actions.every((action) => action === "REPRINT_LABEL")
      ? "reprint"
      : "unavailable";
  }

  function getBatchPrintActionLabel(count, options) {
    const settings = options || {};
    const safeCount = Math.max(Number.parseInt(count, 10) || 0, 1);
    const prefix = settings.retry ? "Thử in" : "In";

    return batchWorkflowIntent === "reprint"
      ? `${prefix} lại ${safeCount} tem`
      : `${prefix} ${safeCount} tem & bắt đầu sửa chữa`;
  }

  function randomId() {
    if (!window.crypto || typeof window.crypto.randomUUID !== "function") {
      throw new Error("Trình duyệt không hỗ trợ crypto.randomUUID().");
    }

    return window.crypto.randomUUID();
  }

  function todayValue() {
    return new Date().toISOString().slice(0, 10);
  }

  function normalizeMultiLabelSize(value) {
    return MULTI_LABEL_SIZES[value] ? value : DEFAULT_MULTI_LABEL_SIZE;
  }

  function getMultiLabelSize(value) {
    return MULTI_LABEL_SIZES[normalizeMultiLabelSize(value)];
  }

  function populateMultiLabelSizeControls() {
    const options = Object.entries(MULTI_LABEL_SIZES).map(([value, size]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = size.label;
      return option;
    });

    [batchLabelSizeSelect, batchResultLabelSizeSelect].filter(Boolean).forEach((select) => {
      select.replaceChildren(...options.map((option) => option.cloneNode(true)));
    });
  }

  function setCurrentDraftLabelSize(value) {
    currentDraftLabelSize = normalizeMultiLabelSize(value);
    if (batchLabelSizeSelect) {
      batchLabelSizeSelect.value = currentDraftLabelSize;
    }
  }

  function setLastBatchLabelSize(value) {
    lastBatchLabelSize = normalizeMultiLabelSize(value);
    if (batchResultLabelSizeSelect) {
      batchResultLabelSizeSelect.value = lastBatchLabelSize;
    }

    if (currentBatchPrintRecovery) {
      saveBatchTicketRefs(lastCreatedBatchTicketRefs, {
        selectedLabelSize: lastBatchLabelSize,
        createdAt: currentBatchPrintRecovery.createdAt,
        preserveRuntimeState: true
      });
    }
  }

  function setCurrentDraftLabelSizeDisabled(disabled) {
    if (batchLabelSizeSelect) {
      batchLabelSizeSelect.disabled = Boolean(disabled);
    }
  }

  function setLastBatchLabelSizeDisabled(disabled) {
    if (batchResultLabelSizeSelect) {
      batchResultLabelSizeSelect.disabled = Boolean(disabled);
    }
  }

  function padDeviceNumber(value) {
    return String(value).padStart(2, "0");
  }

  function getFieldMap(root) {
    return DEVICE_FIELDS.reduce((fields, name) => {
      fields[name] = root.querySelector(`[data-ticket-field="${name}"]`);
      return fields;
    }, {});
  }

  function collectCardData(card) {
    return DEVICE_FIELDS.reduce((data, name) => {
      const field = card.fields[name];
      data[name] = field ? field.value : "";
      return data;
    }, {});
  }

  function setCardValues(card, values) {
    DEVICE_FIELDS.forEach((name) => {
      if (card.fields[name] && Object.prototype.hasOwnProperty.call(values, name)) {
        card.fields[name].value = values[name] == null ? "" : String(values[name]);
      }
    });

    if (card.fields.status && !card.fields.status.value) {
      card.fields.status.value = "mới nhận";
    }
    if (card.fields.device_type && !card.fields.device_type.value) {
      card.fields.device_type.value = "Tivi";
    }
    if (card.fields.received_date && !card.fields.received_date.value) {
      card.fields.received_date.value = todayValue();
    }

    if (card.isPrimary && window.AMNewTicket && typeof window.AMNewTicket.resetDeviceAssists === "function") {
      window.AMNewTicket.resetDeviceAssists();
    } else {
      card.assists.forEach((assist) => {
        if (assist && typeof assist.reset === "function") {
          assist.reset();
        }
      });
    }
    updateCardPresentation(card);
  }

  function fillCardStatusOptions(select) {
    if (!select) {
      return;
    }

    const currentValue = select.value;
    select.replaceChildren();
    window.AMApi.CREATABLE_TICKET_STATUSES.forEach((status) => {
      const option = document.createElement("option");
      option.value = status;
      option.textContent = status;
      select.appendChild(option);
    });
    select.value = window.AMApi.CREATABLE_TICKET_STATUSES.includes(currentValue)
      ? currentValue
      : "mới nhận";
  }

  function assignDynamicFieldIdentity(card) {
    DEVICE_FIELDS.forEach((name) => {
      const field = card.fields[name];
      if (!field) {
        return;
      }

      const id = `batch-${card.key}-${name}`;
      field.id = id;
      field.name = `batch_${card.key}_${name}`;
      const label = card.root.querySelector(`[data-field-label="${name}"]`);
      if (label) {
        label.htmlFor = id;
      }
    });
  }

  function attachCardAssists(card) {
    const assists = [];

    if (window.AMTvUtils && typeof window.AMTvUtils.attachTvModelAssist === "function") {
      const deviceAssist = window.AMTvUtils.attachTvModelAssist({
        brandInput: card.fields.brand,
        modelInput: card.fields.model,
        sizeInput: card.fields.size,
        brandListElement: document.getElementById("tv-brand-options"),
        hintElement: card.root.querySelector("[data-size-assist-hint]")
      });
      if (deviceAssist) {
        assists.push(deviceAssist);
      }
    }

    if (window.AMTvConditionUtils && typeof window.AMTvConditionUtils.attachConditionPicker === "function") {
      [
        { type: "machine", field: "condition_text", label: "Chọn nhanh tình trạng máy" },
        { type: "appearance", field: "external_condition", label: "Chọn nhanh ngoại quan" }
      ].forEach((settings) => {
        const assist = window.AMTvConditionUtils.attachConditionPicker({
          type: settings.type,
          label: settings.label,
          textarea: card.fields[settings.field],
          container: card.root.querySelector(`[data-condition-picker="${settings.type}"]`)
        });
        if (assist) {
          assists.push(assist);
        }
      });
    }

    if (window.AMMoneyUtils && typeof window.AMMoneyUtils.attachInputs === "function") {
      window.AMMoneyUtils.attachInputs(card.root);
    }

    card.assists = assists;
  }

  function makeCard(root, options) {
    const settings = options || {};
    const card = {
      root,
      key: settings.key || randomId(),
      isPrimary: settings.isPrimary === true,
      fields: getFieldMap(root),
      assists: settings.assists || [],
      requestId: null,
      intakeBatchItemNo: null,
      created: null,
      printSnapshot: null,
      workflowCompleted: false,
      failed: false
    };

    root.dataset.deviceKey = card.key;
    if (!card.isPrimary) {
      assignDynamicFieldIdentity(card);
      fillCardStatusOptions(card.fields.status);
      attachCardAssists(card);
    }

    if (settings.values) {
      setCardValues(card, settings.values);
    } else if (!card.isPrimary) {
      setCardValues(card, {});
    }

    root.addEventListener("input", () => {
      if (!card.created) {
        card.failed = false;
        updateCardPresentation(card);
        updateBatchActionBar();
      }
    });
    root.addEventListener("change", () => {
      if (!card.created) {
        card.failed = false;
        updateCardPresentation(card);
        updateBatchActionBar();
      }
    });

    return card;
  }

  function createAdditionalCard(values) {
    const fragment = deviceCardTemplate.content.cloneNode(true);
    const root = fragment.querySelector("[data-device-card]");
    additionalDeviceCards.appendChild(fragment);
    const card = makeCard(root, { values: values || {} });
    cards.push(card);
    renumberCards();
    updateBatchActionBar();
    return card;
  }

  function cardRequiredFields(card) {
    return Object.values(card.fields).filter((field) => field && field.required);
  }

  function isCardValid(card) {
    return cardRequiredFields(card).every((field) => field.checkValidity());
  }

  function updateCardPresentation(card) {
    const data = collectCardData(card);
    const brand = String(data.brand || "").trim();
    const model = String(data.model || "").trim();
    const size = String(data.size || "").trim();
    const condition = String(data.condition_text || "").trim();
    const summary = [brand, model, size].filter(Boolean).join(" • ");
    const summaryElement = card.root.querySelector("[data-device-summary]");
    const conditionElement = card.root.querySelector("[data-device-condition-summary]");
    const statusElement = card.root.querySelector("[data-device-status]");
    const codeElement = card.root.querySelector("[data-device-code]");

    summaryElement.textContent = summary || "Chưa nhập thông tin thiết bị";
    conditionElement.textContent = condition || "Thêm hãng, model và tình trạng để dễ nhận diện.";

    if (card.created) {
      statusElement.textContent = card.created.status === "đang sửa"
        ? "Đang sửa"
        : "Đã tạo phiếu";
      statusElement.dataset.tone = "success";
      codeElement.textContent = window.AMApi.formatTicketCode(card.created.ticket_code);
      codeElement.hidden = false;
    } else if (card.failed) {
      statusElement.textContent = "Tạo chưa thành công";
      statusElement.dataset.tone = "danger";
      codeElement.hidden = true;
    } else if (isCardValid(card)) {
      statusElement.textContent = "Đã đủ thông tin";
      statusElement.dataset.tone = "success";
      codeElement.hidden = true;
    } else {
      statusElement.textContent = "Cần bổ sung";
      statusElement.dataset.tone = "warning";
      codeElement.hidden = true;
    }
  }

  function setCardCollapsed(card, collapsed) {
    const body = card.root.querySelector("[data-device-card-body]");
    const button = card.root.querySelector('[data-device-action="toggle"]');
    body.hidden = collapsed;
    card.root.classList.toggle("is-collapsed", collapsed);
    button.setAttribute("aria-expanded", String(!collapsed));
    button.textContent = collapsed ? "Mở rộng" : "Thu gọn";
  }

  function setCardLocked(card, locked) {
    Object.values(card.fields).forEach((field) => {
      if (field) {
        field.disabled = locked;
      }
    });
    card.root.querySelectorAll('[data-device-action="duplicate"], [data-device-action="remove"]').forEach((button) => {
      button.disabled = locked;
    });
    card.root.classList.toggle("is-created", locked);
  }

  function renumberCards() {
    cards.forEach((card, index) => {
      card.root.dataset.deviceIndex = String(index);
      card.root.querySelector("[data-device-number]").textContent = `Tivi ${padDeviceNumber(index + 1)}`;
    });

    updateRemoveButtons();
  }

  function updateRemoveButtons() {
    cards.forEach((card) => {
      const button = card.root.querySelector('[data-device-action="remove"]');
      button.disabled = cards.length === 1 || Boolean(card.created);
      button.title = cards.length === 1
        ? "Cần giữ ít nhất một tivi trong danh sách."
        : card.created
          ? "Phiếu đã tạo không thể xóa khỏi đợt."
          : "";
    });
  }

  function removeCard(card) {
    if (cards.length === 1 || card.created) {
      return;
    }

    if (card.isPrimary) {
      const replacement = cards[1];
      setCardValues(card, collectCardData(replacement));
      replacement.root.remove();
      cards.splice(1, 1);
    } else {
      card.root.remove();
      cards = cards.filter((item) => item !== card);
    }

    renumberCards();
    updateBatchActionBar();
  }

  function duplicateCard(card) {
    if (card.created || batchRunning) {
      return;
    }

    const source = collectCardData(card);
    const values = DUPLICATE_FIELDS.reduce((result, field) => {
      result[field] = source[field];
      return result;
    }, {});
    const newCard = createAdditionalCard(values);
    const firstField = newCard.fields.device_type;
    firstField.focus({ preventScroll: true });
    newCard.root.scrollIntoView({ block: "nearest" });
  }

  function createdCardCount() {
    return cards.filter((card) => Boolean(card.created && card.created.id)).length;
  }

  function allCardsCreated() {
    return cards.length > 0 && createdCardCount() === cards.length;
  }

  function setBatchState(nextState) {
    batchState = nextState;
    form.dataset.batchState = nextState;
    updateBatchActionBar();
  }

  function updateBatchActionBar() {
    const validCount = cards.filter((card) => isCardValid(card)).length;
    const incompleteCount = cards.length - validCount;
    const createdCount = cards.filter((card) => card.created).length;
    const reprintCount = getExactBatchTicketRefs().length;
    const remainingCount = cards.length - createdCount;

    const phaseMessages = {
      [BATCH_STATES.VALIDATING]: `Đang kiểm tra ${cards.length} tivi…`,
      [BATCH_STATES.CREATING]: `Đang tạo ${remainingCount || cards.length} phiếu…`,
      [BATCH_STATES.CREATED]: `Đã tạo ${createdCount} phiếu.`,
      [BATCH_STATES.PREPARING_PRINT]: `Đã tạo ${createdCount} phiếu. Đang chuẩn bị ${createdCount} tem…`,
      [BATCH_STATES.PRINT_READY]: `Đã chuẩn bị đủ ${createdCount} tem.`,
      [BATCH_STATES.PRINT_FAILED]: `Đã tạo ${createdCount} phiếu. Chuẩn bị tem thất bại.`,
      [BATCH_STATES.PRINT_TRIGGERED]: `Đã tạo ${createdCount} phiếu và mở hộp thoại in.`
    };

    batchActionSummary.textContent = phaseMessages[batchState] || [
      `${cards.length} tivi`,
      `${validCount} đã đủ thông tin`,
      `${incompleteCount} cần bổ sung`,
      createdCount ? `${createdCount} đã tạo phiếu` : ""
    ].filter(Boolean).join(" • ");

    if (createdCount === cards.length && cards.length > 0) {
      createBatchButton.textContent = `Đã tạo ${createdCount} phiếu`;
    } else if (batchState === BATCH_STATES.CREATING) {
      createBatchButton.textContent = `Đang tạo ${remainingCount || cards.length} phiếu…`;
    } else if (createdCount > 0 && remainingCount > 0) {
      createBatchButton.textContent = `Tiếp tục tạo ${remainingCount} phiếu còn lại`;
    } else {
      createBatchButton.textContent = `Tạo ${cards.length} phiếu, in ${cards.length} tem & bắt đầu sửa chữa`;
    }

    if (batchPrintRunning) {
      reprintBatchButton.textContent = `Đang chuẩn bị ${reprintCount} tem…`;
    } else if (batchRecoveryIssue) {
      reprintBatchButton.textContent = getBatchPrintActionLabel(reprintCount, { retry: true });
    } else if (reprintCount) {
      reprintBatchButton.textContent = getBatchPrintActionLabel(reprintCount);
    }

    createBatchButton.disabled = Boolean(batchRunning || batchPrintRunning || allCardsCreated());
    reprintBatchButton.disabled = Boolean(batchRunning || batchPrintRunning || batchRecoveryLoading || batchRecoveryBlocked);
  }

  function selectedMode() {
    const selected = modeGroup.querySelector('input[name="ticket_create_mode"]:checked');
    return selected ? selected.value : MODE_SINGLE;
  }

  function restoreModeRadio(value) {
    const input = modeGroup.querySelector(`input[value="${value}"]`);
    if (input) {
      input.checked = true;
    }
  }

  function setMode(value) {
    creationMode = value === MODE_BATCH ? MODE_BATCH : MODE_SINGLE;
    const isBatch = creationMode === MODE_BATCH;
    form.dataset.ticketCreateMode = creationMode;
    sharedCustomerHint.hidden = !isBatch;
    deviceListHeading.hidden = !isBatch;
    primaryDeviceCard.querySelector("[data-device-card-header]").hidden = !isBatch;
    addDeviceButton.hidden = !isBatch;
    singleCreateActions.hidden = isBatch;
    batchActionBar.hidden = !isBatch;
    if (!isBatch) {
      setCardCollapsed(cards[0], false);
    }
    updateBatchActionBar();
  }

  function handleModeChange() {
    const targetMode = selectedMode();
    if (targetMode === creationMode) {
      return;
    }

    if (
      creationMode === MODE_BATCH
      && targetMode === MODE_SINGLE
      && cards.length > 1
      && !window.confirm(`Chuyển về chế độ một tivi sẽ loại ${cards.length - 1} card từ Tivi 02 trở đi khỏi form. Tiếp tục?`)
    ) {
      restoreModeRadio(MODE_BATCH);
      return;
    }

    if (targetMode === MODE_SINGLE && cards.length > 1) {
      cards.slice(1).forEach((card) => card.root.remove());
      cards = [cards[0]];
      renumberCards();
    }

    setMode(targetMode);
  }

  function findCardFromAction(target) {
    const root = target.closest("[data-device-card]");
    return cards.find((card) => card.root === root) || null;
  }

  function handleDeviceAction(event) {
    const button = event.target.closest("[data-device-action]");
    if (!button) {
      return;
    }

    const card = findCardFromAction(button);
    if (!card) {
      return;
    }

    const action = button.dataset.deviceAction;
    if (action === "toggle") {
      setCardCollapsed(card, !card.root.querySelector("[data-device-card-body]").hidden);
    } else if (action === "duplicate") {
      duplicateCard(card);
    } else if (action === "remove") {
      removeCard(card);
    }
  }

  function focusFirstInvalidCard() {
    for (const card of cards) {
      const invalidField = cardRequiredFields(card).find((field) => !field.checkValidity());
      if (!invalidField) {
        continue;
      }

      setCardCollapsed(card, false);
      card.failed = true;
      updateCardPresentation(card);
      card.root.scrollIntoView({ block: "center" });
      invalidField.focus({ preventScroll: true });
      invalidField.reportValidity();
      return false;
    }

    return true;
  }

  function validateBatch(options) {
    const settings = options || {};
    let customerOptions;

    try {
      customerOptions = window.AMNewTicket.getCustomerSubmitOptions();
    } catch (error) {
      window.AMNewTicket.showNotice("error", error.message);
      document.getElementById("customer_phone").focus({ preventScroll: true });
      return null;
    }

    if (!focusFirstInvalidCard()) {
      window.AMNewTicket.showNotice("error", "Hãy bổ sung trường còn thiếu trong tivi được đánh dấu.");
      return null;
    }

    if (settings.showSuccess) {
      window.AMNewTicket.showNotice("success", `Đã kiểm tra ${cards.length} tivi. Dữ liệu sẵn sàng để tạo phiếu.`);
    }

    return customerOptions;
  }

  function setBatchBusy(isBusy) {
    batchRunning = isBusy;
    const creationLocked = isBusy || allCardsCreated();
    createBatchButton.disabled = creationLocked;
    validateBatchButton.disabled = creationLocked;
    cancelBatchButton.disabled = creationLocked;
    addDeviceButton.disabled = creationLocked;
    modeGroup.querySelectorAll("input").forEach((input) => {
      input.disabled = creationLocked;
    });
    setCurrentDraftLabelSizeDisabled(isBusy || batchPrintRunning);
    form.setAttribute("aria-busy", String(isBusy));
  }

  function customerPayload() {
    return window.AMNewTicket.getSharedCustomerData();
  }

  function nextIntakeBatchItemNo() {
    return cards.reduce((highest, card) => {
      const itemNo = Number.parseInt(card.intakeBatchItemNo, 10);
      return Number.isInteger(itemNo) ? Math.max(highest, itemNo) : highest;
    }, 0) + 1;
  }

  async function prepareIntakeBatchMetadata() {
    if (intakeBatchCapabilityAvailable === null) {
      const capability = await window.AMApi.getIntakeBatchCapability();
      intakeBatchCapabilityAvailable = capability.available === true;
    }

    if (!intakeBatchCapabilityAvailable) {
      return null;
    }

    currentIntakeBatchId = currentIntakeBatchId || randomId();
    cards.forEach((card) => {
      if (!Number.isInteger(card.intakeBatchItemNo)) {
        card.intakeBatchItemNo = nextIntakeBatchItemNo();
      }
    });

    return currentIntakeBatchId;
  }

  function normalizePrintFieldValue(field, value) {
    const text = String(value == null ? "" : value).trim();
    if (field === "brand" && window.AMTvUtils && typeof window.AMTvUtils.normalizeBrand === "function") {
      return window.AMTvUtils.normalizeBrand(text);
    }
    return text;
  }

  function assertFreshTicketMatchesPrintSnapshot(card, ticket) {
    const snapshot = card.printSnapshot;
    if (!snapshot) {
      throw new Error("Thiếu snapshot dữ liệu của tivi vừa tạo.");
    }

    const mismatchedField = ["brand", "model", "size", "condition_text"].find((field) => (
      normalizePrintFieldValue(field, ticket[field]) !== normalizePrintFieldValue(field, snapshot[field])
    ));

    if (mismatchedField) {
      throw new Error("Dữ liệu phiếu mới nhất không khớp với tivi đã gửi. Chưa mở in.");
    }
  }

  async function createPendingCards(customerOptions, intakeBatchId) {
    let options = Object.assign({}, customerOptions);
    const sharedCustomer = customerPayload();

    for (let index = 0; index < cards.length; index += 1) {
      const card = cards[index];
      if (card.created) {
        if (card.created.customer_id) {
          options = {
            customerMode: "existing",
            existingCustomerId: card.created.customer_id
          };
        }
        continue;
      }

      window.AMNewTicket.showNotice("info", `Đang tạo phiếu ${index + 1}/${cards.length}…`);
      card.requestId = card.requestId || randomId();
      const printSnapshot = Object.freeze(Object.assign({}, collectCardData(card)));

      try {
        const createOptions = {
          clientRequestId: card.requestId,
          customerMode: options.customerMode,
          existingCustomerId: options.existingCustomerId
        };
        if (intakeBatchId) {
          createOptions.intakeBatchId = intakeBatchId;
          createOptions.intakeBatchItemNo = card.intakeBatchItemNo;
        }
        const created = await window.AMApi.createTicket(
          Object.assign({}, sharedCustomer, printSnapshot),
          createOptions
        );
        card.created = created;
        card.printSnapshot = printSnapshot;
        card.failed = false;
        setCardLocked(card, true);
        updateCardPresentation(card);

        if (options.customerMode === "new") {
          window.AMNewTicket.setExistingCustomerFromCreatedTicket(created);
        }
        options = {
          customerMode: "existing",
          existingCustomerId: created.customer_id
        };
      } catch (error) {
        card.failed = true;
        setCardCollapsed(card, false);
        updateCardPresentation(card);
        card.root.scrollIntoView({ block: "center" });
        const code = card.created && card.created.ticket_code
          ? ` ${window.AMApi.formatTicketCode(card.created.ticket_code)}`
          : "";
        throw new Error(`Tivi ${padDeviceNumber(index + 1)}${code}: ${error.message}`);
      } finally {
        updateBatchActionBar();
      }
    }
  }

  async function mapWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    let cursor = 0;

    async function runWorker() {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index], index);
      }
    }

    const workerCount = Math.min(Math.max(limit, 1), items.length);
    await Promise.all(Array.from({ length: workerCount }, runWorker));
    return results;
  }

  async function fetchFreshBatchTickets(options) {
    const settings = options || {};
    const seen = new Set();
    const entries = cards.map((card, index) => ({ card, index })).filter(({ card }) => {
      if (!card.created || !card.created.id || seen.has(card.created.id)) {
        return false;
      }
      seen.add(card.created.id);
      return true;
    });

    if (entries.length !== cards.length) {
      throw new Error("Danh sách phiếu vừa tạo có UUID thiếu hoặc bị trùng. Chưa mở in.");
    }

    return await mapWithConcurrency(entries, MAX_FRESH_CONCURRENCY, async ({ card, index }) => {
      try {
        const expectedTicketId = String(card.created.id);
        const ticket = await window.AMApi.getFreshTicketForPrint(expectedTicketId);
        if (!ticket) {
          throw new Error("Không có dữ liệu mới nhất.");
        }
        if (String(ticket.id || "") !== expectedTicketId) {
          throw new Error("Dữ liệu trả về không khớp với phiếu vừa tạo.");
        }
        if (settings.verifySnapshot !== false) {
          assertFreshTicketMatchesPrintSnapshot(card, ticket);
        }

        return {
          card,
          ticketId: expectedTicketId,
          printJob: Object.freeze(Object.assign({}, ticket))
        };
      } catch (error) {
        throw new Error(`${window.AMApi.formatTicketCode(card.created.ticket_code)} (Tivi ${padDeviceNumber(index + 1)}): ${error.message || "Không tải được dữ liệu mới nhất."}`);
      }
    });
  }

  async function fetchFreshBatchTicketsFromRefs(ticketRefs, options) {
    const settings = options || {};
    const refs = normalizeBatchTicketRefs(ticketRefs);
    const cardByTicketId = new Map(cards.map((card) => [String(card.created && card.created.id || ""), card]));

    if (!refs.length) {
      throw new Error("Không còn UUID phiếu chính xác của đợt in này.");
    }

    return await mapWithConcurrency(refs, MAX_FRESH_CONCURRENCY, async (ref, index) => {
      try {
        const card = cardByTicketId.get(ref.ticketId) || null;
        const ticket = await window.AMApi.getFreshTicketForPrint(ref.ticketId);
        if (!ticket || String(ticket.id || "") !== ref.ticketId) {
          throw new Error("Dữ liệu mới nhất không khớp với phiếu cần in.");
        }
        if (settings.verifySnapshot !== false && card) {
          assertFreshTicketMatchesPrintSnapshot(card, ticket);
        }

        return {
          card,
          ticketId: ref.ticketId,
          printJob: Object.freeze(Object.assign({}, ticket))
        };
      } catch (error) {
        throw new Error(`${window.AMApi.formatTicketCode(ref.ticketCode)} (Tivi ${padDeviceNumber(index + 1)}): ${error.message || "Không tải được dữ liệu mới nhất."}`);
      }
    });
  }

  async function fetchRecoveryEntries(ticketRefs) {
    const refs = normalizeBatchTicketRefs(ticketRefs);
    return await mapWithConcurrency(refs, MAX_FRESH_CONCURRENCY, async (ref, index) => {
      try {
        const ticket = await window.AMApi.getFreshTicketForPrint(ref.ticketId);
        if (!ticket) {
          return {
            ref,
            index,
            entry: null,
            issueKind: "missing",
            issue: `Không tìm thấy ${window.AMApi.formatTicketCode(ref.ticketCode)}.`
          };
        }
        if (String(ticket.id || "") !== ref.ticketId) {
          return {
            ref,
            index,
            entry: null,
            issueKind: "mismatch",
            issue: `Không thể xác minh UUID của ${window.AMApi.formatTicketCode(ref.ticketCode)}.`
          };
        }
        return {
          ref,
          index,
          entry: {
            card: null,
            ticketId: ref.ticketId,
            printJob: Object.freeze(Object.assign({}, ticket))
          },
          issueKind: "",
          issue: ""
        };
      } catch (_error) {
        return {
          ref,
          index,
          entry: null,
          issueKind: "transient",
          issue: `Chưa thể tải ${window.AMApi.formatTicketCode(ref.ticketCode)}. Vui lòng thử lại.`
        };
      }
    });
  }

  function syncBatchCardFromPrintJob(entry) {
    if (!entry.card || !entry.card.created) {
      return;
    }

    entry.card.created = Object.assign({}, entry.card.created, {
      status: entry.printJob.status,
      repair_started_at: entry.printJob.repair_started_at,
      ready_for_handover_at: entry.printJob.ready_for_handover_at,
      completed_at: entry.printJob.completed_at,
      last_activity_at: entry.printJob.last_activity_at
    });
    entry.card.workflowCompleted = entry.card.created.status === "đang sửa";
    updateCardPresentation(entry.card);
  }

  function getBatchEntryDisplayCode(entry) {
    return window.AMApi.formatTicketCode(entry.printJob.ticket_code || "");
  }

  function patchBatchEntryFromWorkflowResult(entry, result) {
    const expectedTicketId = String(entry.ticketId || "").trim();
    const expectedTicketCode = String(entry.printJob.ticket_code || "").trim();

    if (
      !result
      || String(result.ticket_id || "").trim() !== expectedTicketId
      || String(result.ticket_code || "").trim() !== expectedTicketCode
    ) {
      throw createBatchPrintError(
        "BATCH_WORKFLOW_RESULT_MISMATCH",
        `Workflow trả về dữ liệu không khớp với phiếu ${getBatchEntryDisplayCode(entry)}.`
      );
    }

    entry.printJob = Object.freeze(Object.assign({}, entry.printJob, {
      status: result.status,
      repair_started_at: result.repair_started_at,
      ready_for_handover_at: result.ready_for_handover_at,
      completed_at: result.completed_at,
      last_activity_at: result.last_activity_at || result.activity_created_at,
      workflow_available: true
    }));
    syncBatchCardFromPrintJob(entry);
  }

  async function runBatchWorkflowAction(entry, action) {
    const ticketId = String(entry.ticketId || "").trim();
    const ticketCode = getBatchEntryDisplayCode(entry);
    let requestId = null;

    if (!ticketId || String(entry.printJob.id || "").trim() !== ticketId) {
      throw createBatchPrintError(
        "BATCH_WORKFLOW_TICKET_MISMATCH",
        `Không xác minh được UUID chính xác của phiếu ${ticketCode}.`
      );
    }

    try {
      traceBatchPrint("workflow-request", { ticketId, ticketCode, action });
      requestId = window.AMApi.ensureWorkflowClientRequestId(ticketId, action);
      const result = await window.AMApi.recordTicketWorkflowAction(ticketId, action, requestId);
      window.AMApi.clearWorkflowClientRequestId(ticketId, action);
      patchBatchEntryFromWorkflowResult(entry, result);

      if (action === "START_REPAIR" && entry.printJob.status !== "đang sửa") {
        throw createBatchPrintError(
          "BATCH_START_REPAIR_STATUS_MISMATCH",
          `Phiếu ${ticketCode} chưa chuyển sang trạng thái đang sửa.`
        );
      }

      traceBatchPrint("workflow-complete", {
        ticketId,
        ticketCode,
        action,
        status: entry.printJob.status
      });
      return result;
    } catch (error) {
      if (
        requestId
        && typeof window.AMApi.shouldClearWorkflowClientRequestId === "function"
        && window.AMApi.shouldClearWorkflowClientRequestId(error)
      ) {
        window.AMApi.clearWorkflowClientRequestId(ticketId, action);
      }

      const target = action === "START_REPAIR"
        ? "chuyển sang đang sửa"
        : "ghi nhận in lại tem";
      const workflowError = createBatchPrintError(
        "BATCH_WORKFLOW_FAILED",
        `Phiếu ${ticketCode} chưa ${target}: ${error.message || "Không rõ lỗi workflow."}`
      );
      workflowError.ticketId = ticketId;
      workflowError.ticketCode = ticketCode;
      workflowError.workflowAction = action;
      traceBatchPrint("workflow-failed", {
        ticketId,
        ticketCode,
        action,
        message: workflowError.message
      });
      throw workflowError;
    }
  }

  async function runBatchWorkflowBeforePrint(entries) {
    const plan = entries.map((entry) => ({
      entry,
      action: resolveBatchWorkflowAction(entry.printJob)
    }));
    const unavailable = plan.find((item) => !item.action);

    if (unavailable) {
      throw createBatchPrintError(
        "BATCH_WORKFLOW_UNAVAILABLE",
        `Phiếu ${getBatchEntryDisplayCode(unavailable.entry)} chưa ở trạng thái phù hợp để in tem.`
      );
    }

    batchWorkflowIntent = plan.some((item) => item.action === "START_REPAIR")
      ? "start"
      : "reprint";
    entries.forEach(syncBatchCardFromPrintJob);

    const startRepairEntries = plan.filter((item) => item.action === "START_REPAIR");
    const reprintEntries = plan.filter((item) => item.action === "REPRINT_LABEL");

    for (const item of plan) {
      await runBatchWorkflowAction(item.entry, item.action);
    }

    batchWorkflowIntent = "reprint";
    traceBatchPrint("workflow-ready", {
      ticketIds: entries.map((entry) => entry.ticketId),
      startRepairCalls: startRepairEntries.length,
      reprintLabelCalls: reprintEntries.length
    });
    return {
      startRepairCalls: startRepairEntries.length,
      reprintLabelCalls: reprintEntries.length
    };
  }

  async function refreshBatchWorkflowIntent(ticketRefs) {
    const refs = normalizeBatchTicketRefs(ticketRefs);
    const requestId = ++batchWorkflowIntentRequest;

    if (!refs.length || batchPrintRunning) {
      return;
    }

    batchRecoveryLoading = true;
    batchRecoveryIssue = "";
    batchRecoveryBlocked = false;
    updateBatchActionBar();

    try {
      const recoveryResults = await fetchRecoveryEntries(refs);
      if (requestId !== batchWorkflowIntentRequest || batchPrintRunning) {
        return;
      }

      const entries = recoveryResults
        .filter((result) => result.entry)
        .map((result) => result.entry);
      const issues = recoveryResults
        .filter((result) => result.issue)
        .map((result) => result.issue);

      if (!entries.length && issues.length === refs.length && recoveryResults.every((result) => result.issueKind === "missing")) {
        clearBatchPrintRecovery();
        batchWorkflowIntent = "start";
        batchResult.hidden = true;
        updateBatchActionBar();
        window.AMNewTicket.showNotice("error", "Không tìm thấy các phiếu của đợt in trước. Đợt đang nhập vẫn được giữ nguyên.");
        return;
      }

      recoveredBatchEntries = entries;
      batchRecoveryIssue = issues.join(" ");
      batchRecoveryBlocked = recoveryResults.some((result) => (
        result.issueKind === "missing" || result.issueKind === "mismatch"
      ));
      batchWorkflowIntent = batchRecoveryIssue
        ? "unavailable"
        : resolveBatchWorkflowIntent(entries);
    } finally {
      if (requestId === batchWorkflowIntentRequest && !batchPrintRunning) {
        batchRecoveryLoading = false;
      }
    }

    updateBatchActionBar();
    if (!batchResult.hidden) {
      renderBatchResult();
    }
  }

  function removeClonedLabelIds(label) {
    label.querySelectorAll("[id]").forEach((element) => {
      element.removeAttribute("id");
    });
  }

  function createBatchPrintError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function labelDisplayValue(value) {
    const text = String(value == null ? "" : value).trim();
    return !text || /^(null|undefined)$/i.test(text) ? "Chưa có" : text;
  }

  function assertRenderedLabelMatchesPrintJob(label, printJob) {
    const expected = {
      ticketCode: window.AMApi.formatTicketCode(printJob.ticket_code),
      brand: normalizePrintFieldValue("brand", printJob.brand) || "Chưa xác định",
      model: labelDisplayValue(printJob.model),
      condition: labelDisplayValue(printJob.condition_text)
    };
    const actual = {
      ticketCode: label.querySelector(".label-code .label-value")?.textContent.trim() || "",
      brand: label.querySelector(".label-type .label-value")?.textContent.trim() || "",
      model: label.querySelector(".label-model .label-value")?.textContent.trim() || "",
      condition: label.querySelector(".label-condition .label-value")?.textContent.trim() || ""
    };
    const mismatch = Object.keys(expected).find((field) => actual[field] !== expected[field]);

    if (mismatch) {
      throw createBatchPrintError(
        "DATA_MISMATCH",
        `Dữ liệu tem ${expected.ticketCode} không khớp với phiếu. Chưa mở in.`
      );
    }
  }

  function formatLabelDate(value) {
    if (!value) {
      return "Chưa có";
    }
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("vi-VN");
  }

  function normalizeLabelCustomerName(ticket) {
    const values = [ticket && ticket.customer_name, ticket && ticket.customer_master_name];
    const match = values.find((value) => {
      const text = String(value == null ? "" : value).trim();
      return text && !/^(null|undefined)$/i.test(text);
    });
    return match ? String(match).trim() : "—";
  }

  function createLabelRow(className, keyText, value, fieldName) {
    const row = document.createElement("p");
    const key = document.createElement("strong");
    const field = document.createElement("span");
    row.className = `label-row ${className}`;
    key.className = "label-key";
    key.textContent = keyText;
    field.className = "label-value";
    field.dataset.labelField = fieldName;
    field.textContent = value;
    row.append(key, document.createTextNode(" "), field);
    return row;
  }

  function createDirectBatchLabel(printJob, labelSize) {
    const normalizedSize = normalizeMultiLabelSize(labelSize);
    const size = getMultiLabelSize(normalizedSize);
    const label = document.createElement("article");
    const header = document.createElement("div");
    const logo = document.createElement("img");
    const brandStack = document.createElement("div");
    const companyName = document.createElement("h1");
    const phone = document.createElement("span");
    const address = document.createElement("span");
    const content = document.createElement("div");

    label.className = `thermal-label print-label ${size.className}`;
    label.dataset.ticketId = String(printJob.id || "");
    label.dataset.ticketCode = String(printJob.ticket_code || "");
    label.dataset.labelSize = normalizedSize;

    header.className = "label-brand label-header";
    logo.className = "label-logo";
    logo.src = "assets/logo-am.jpeg";
    logo.alt = "AM";
    brandStack.className = "label-brand-stack";
    companyName.className = "label-brand-text";
    companyName.textContent = "ĐIỆN TỬ ANH MINH";
    phone.className = "label-phone";
    phone.textContent = "0905111223 - 0774111223";
    address.className = "label-address";
    address.textContent = "100 Tiểu La, Đà Nẵng";
    brandStack.append(companyName, phone, address);
    header.append(logo, brandStack);

    content.className = "label-device-content";
    const customerName = normalizeLabelCustomerName(printJob);
    const customerRow = createLabelRow("label-customer label-primary-info", "Tên:", customerName, "customer-name");
    customerRow.querySelector(".label-value").dataset.fullText = customerName;
    content.append(
      customerRow,
      createLabelRow("label-code label-primary-info", "Mã:", window.AMApi.formatTicketCode(printJob.ticket_code), "ticket-code"),
      createLabelRow("label-type", "Loại:", normalizePrintFieldValue("brand", printJob.brand) || "Chưa xác định", "brand"),
      createLabelRow("label-model label-primary-info", "Model:", labelDisplayValue(printJob.model), "model"),
      createLabelRow("label-condition label-primary-info", "Tình trạng:", labelDisplayValue(printJob.condition_text), "condition"),
      createLabelRow("label-date label-received-date", "Ngày nhận:", formatLabelDate(printJob.received_date), "received-date")
    );
    label.append(header, content);
    return label;
  }

  function readDirectLabelMetric(label, name, fallback) {
    const value = Number.parseFloat(window.getComputedStyle(label).getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  }

  function getDirectLabelLineHeight(element) {
    const computed = window.getComputedStyle(element);
    const fontSize = Number.parseFloat(computed.fontSize) || 8;
    return Number.parseFloat(computed.lineHeight) || fontSize;
  }

  function directLabelTextFits(element, maxLines, availableHeight) {
    const height = element.getBoundingClientRect().height;
    const lines = Math.max(1, Math.ceil((height - LABEL_FIT_TOLERANCE) / getDirectLabelLineHeight(element)));
    return element.clientWidth > 0
      && element.scrollWidth <= element.clientWidth + LABEL_FIT_TOLERANCE
      && lines <= maxLines
      && (!Number.isFinite(availableHeight) || height <= availableHeight + LABEL_FIT_TOLERANCE);
  }

  function fitDirectLabelText(element, options) {
    let fontSize = options.max;
    let attempts = 0;
    while (attempts < MAX_LABEL_FIT_ATTEMPTS) {
      element.style.fontSize = `${Math.round(fontSize * 100) / 100}px`;
      if (typeof options.renderLayout === "function") {
        options.renderLayout(fontSize);
      }
      if (directLabelTextFits(element, options.lines, options.height)) {
        return true;
      }
      if (fontSize <= options.min + 0.01) {
        break;
      }
      fontSize = Math.max(options.min, fontSize - LABEL_FIT_STEP);
      attempts += 1;
    }
    return directLabelTextFits(element, options.lines, options.height);
  }

  function measureDirectLabelText(text, element, fontSize, weight) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      return String(text || "").length * fontSize * 0.55;
    }
    const computed = window.getComputedStyle(element);
    context.font = `${weight || computed.fontWeight || 800} ${fontSize}px ${computed.fontFamily}`;
    return context.measureText(String(text || "")).width;
  }

  function chooseDirectLabelNameLines(fullName, row, fontSize) {
    const words = String(fullName || "").trim().split(/\s+/).filter(Boolean);
    if (words.length < 2) {
      return [words.join(" ")];
    }
    const prefixWidth = measureDirectLabelText("Tên: ", row, fontSize, 900);
    const availableWidth = Math.max(1, row.clientWidth - 1);
    let best = null;
    for (let index = 1; index < words.length; index += 1) {
      const first = words.slice(0, index).join(" ");
      const second = words.slice(index).join(" ");
      const firstWidth = prefixWidth + measureDirectLabelText(first, row, fontSize, 900);
      const secondWidth = measureDirectLabelText(second, row, fontSize, 900);
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

  function renderDirectLabelName(valueElement, lines) {
    const nodes = [];
    lines.forEach((line, index) => {
      if (index) {
        nodes.push(document.createElement("br"));
      }
      nodes.push(document.createTextNode(line));
    });
    valueElement.replaceChildren(...nodes);
  }

  function getDirectOuterHeight(element, ignoreMarginTop) {
    const computed = window.getComputedStyle(element);
    return element.getBoundingClientRect().height
      + (ignoreMarginTop ? 0 : Number.parseFloat(computed.marginTop) || 0)
      + (Number.parseFloat(computed.marginBottom) || 0);
  }

  function fitDirectBatchLabel(label, labelSize) {
    const layout = MULTI_LABEL_LAYOUTS[normalizeMultiLabelSize(labelSize)];
    const content = label.querySelector(".label-device-content");
    const rows = {
      customer: label.querySelector(".label-customer"),
      code: label.querySelector(".label-code"),
      type: label.querySelector(".label-type"),
      model: label.querySelector(".label-model"),
      condition: label.querySelector(".label-condition"),
      date: label.querySelector(".label-date"),
      title: label.querySelector(".label-brand-text"),
      phone: label.querySelector(".label-phone"),
      address: label.querySelector(".label-address")
    };
    const nameValue = rows.customer.querySelector(".label-value");
    const fullName = nameValue.dataset.fullText || nameValue.textContent.trim();
    const profile = {
      nameMax: readDirectLabelMetric(label, "--label-name-max-size", 10.8),
      nameSingleMin: readDirectLabelMetric(label, "--label-name-single-line-min-size", 8.5),
      nameMin: readDirectLabelMetric(label, "--label-name-min-size", 7.5),
      codeMax: readDirectLabelMetric(label, "--label-code-max-size", 10.4),
      codeMin: readDirectLabelMetric(label, "--label-code-min-size", 7.4),
      typeMax: readDirectLabelMetric(label, "--label-type-max-size", 9.1),
      typeMin: readDirectLabelMetric(label, "--label-type-min-size", 6.6),
      modelMax: readDirectLabelMetric(label, "--label-model-max-size", 9.9),
      modelMin: readDirectLabelMetric(label, "--label-model-min-size", 6.8),
      conditionMax: readDirectLabelMetric(label, "--label-condition-max-size", 8.8),
      conditionMin: readDirectLabelMetric(label, "--label-condition-min-size", 6.6),
      dateMax: readDirectLabelMetric(label, "--label-date-max-size", 7.4),
      dateMin: readDirectLabelMetric(label, "--label-date-min-size", 6.1)
    };

    function run(mode) {
      label.classList.toggle("label-content--compact", mode !== "normal");
      label.classList.toggle("label-content--tight", mode === "tight");
      Object.values(rows).forEach((row) => row.style.removeProperty("font-size"));
      rows.customer.classList.remove("label-name--two-lines", "label-name--break-anywhere");
      rows.model.classList.remove("label-model--wrapped");
      renderDirectLabelName(nameValue, [fullName]);

      fitDirectLabelText(rows.title, {
        max: Number.parseFloat(window.getComputedStyle(rows.title).fontSize),
        min: readDirectLabelMetric(label, "--label-title-min-size", 6.8),
        lines: 1
      });
      fitDirectLabelText(rows.phone, {
        max: Number.parseFloat(window.getComputedStyle(rows.phone).fontSize),
        min: readDirectLabelMetric(label, "--label-phone-min-size", 5.8),
        lines: 1
      });
      fitDirectLabelText(rows.address, {
        max: Number.parseFloat(window.getComputedStyle(rows.address).fontSize),
        min: readDirectLabelMetric(label, "--label-address-min-size", 5.7),
        lines: 1
      });

      const nameSingleFits = fitDirectLabelText(rows.customer, {
        max: profile.nameMax,
        min: profile.nameSingleMin,
        lines: 1
      });
      if (!nameSingleFits) {
        rows.customer.classList.add("label-name--two-lines");
        const nameFits = fitDirectLabelText(rows.customer, {
          max: profile.nameMax,
          min: profile.nameMin,
          lines: layout.nameLines,
          renderLayout: (fontSize) => renderDirectLabelName(
            nameValue,
            chooseDirectLabelNameLines(fullName, rows.customer, fontSize)
          )
        });
        rows.customer.classList.toggle("label-name--break-anywhere", !nameFits);
      }

      fitDirectLabelText(rows.code, { max: profile.codeMax, min: profile.codeMin, lines: 1 });
      const modelSingleFits = fitDirectLabelText(rows.model, {
        max: profile.modelMax,
        min: profile.modelMin,
        lines: 1
      });
      if (!modelSingleFits && layout.modelLines > 1) {
        rows.model.classList.add("label-model--wrapped");
        fitDirectLabelText(rows.model, {
          max: profile.modelMax,
          min: profile.modelMin,
          lines: layout.modelLines
        });
      }
      const modelFontSize = Number.parseFloat(window.getComputedStyle(rows.model).fontSize) || profile.modelMax;
      fitDirectLabelText(rows.type, {
        max: Math.min(profile.typeMax, Math.max(profile.typeMin, modelFontSize - 0.6)),
        min: profile.typeMin,
        lines: 1
      });
      fitDirectLabelText(rows.date, { max: profile.dateMax, min: profile.dateMin, lines: 1 });

      const fixedHeight = [rows.customer, rows.code, rows.type, rows.model]
        .reduce((total, row) => total + getDirectOuterHeight(row, false), 0)
        + getDirectOuterHeight(rows.date, true);
      const conditionStyle = window.getComputedStyle(rows.condition);
      const conditionMargins = (Number.parseFloat(conditionStyle.marginTop) || 0)
        + (Number.parseFloat(conditionStyle.marginBottom) || 0);
      const conditionHeight = Math.max(0, content.clientHeight - fixedHeight - conditionMargins - 1);
      const conditionFits = fitDirectLabelText(rows.condition, {
        max: profile.conditionMax,
        min: profile.conditionMin,
        lines: layout.conditionLines,
        height: conditionHeight
      });
      return conditionFits && label.scrollHeight <= label.clientHeight + 1;
    }

    let fits = run("normal");
    if (!fits) {
      fits = run("compact");
    }
    if (!fits) {
      fits = run("tight");
    }
    label.dataset.fitStatus = fits ? "fit" : "overflow";
    return fits;
  }

  async function waitForDirectBatchAssets() {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready.catch(() => undefined);
    }
    const images = Array.from(batchPrintSurface.querySelectorAll("img"));
    await Promise.all(images.map(async (image) => {
      if (!image.complete) {
        await new Promise((resolve) => {
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", resolve, { once: true });
        });
      }
      if (typeof image.decode === "function") {
        await image.decode().catch(() => undefined);
      }
    }));
  }

  function waitForDirectBatchFrame() {
    return new Promise((resolve) => window.requestAnimationFrame(resolve));
  }

  function syncBatchPrintPageSize(size) {
    let style = document.getElementById("dynamicBatchLabelPageSize");
    if (!style) {
      style = document.createElement("style");
      style.id = "dynamicBatchLabelPageSize";
      document.head.appendChild(style);
    }
    style.textContent = `@page { size: ${size.width} ${size.height}; margin: 0; }`;
    document.documentElement.style.setProperty("--print-label-width", size.width);
    document.documentElement.style.setProperty("--print-label-height", size.height);
  }

  async function renderFreshBatch(entries, options) {
    const settings = options || {};
    const labelSize = normalizeMultiLabelSize(settings.labelSize);
    const size = getMultiLabelSize(labelSize);
    const sheets = entries.map((entry, index) => {
      const label = createDirectBatchLabel(entry.printJob, labelSize);
      const sheet = document.createElement("section");
      sheet.className = "ticket-batch-label-sheet";
      sheet.dataset.batchLabelIndex = String(index);
      sheet.dataset.ticketId = String(entry.ticketId || entry.printJob.id || "");
      sheet.appendChild(label);
      return sheet;
    });

    syncBatchPrintPageSize(size);
    batchPrintSurface.classList.add("is-preparing");
    batchPrintSurface.replaceChildren(...sheets);
    if (sheets.length !== entries.length) {
      throw createBatchPrintError("BATCH_OUTPUT_MISMATCH", "Số tem đã dựng không khớp số phiếu. Chưa mở in.");
    }
    await waitForDirectBatchAssets();
    await waitForDirectBatchFrame();
    const labels = Array.from(batchPrintSurface.querySelectorAll(".ticket-batch-label-sheet .print-label"));
    labels.forEach((label, index) => {
      assertRenderedLabelMatchesPrintJob(label, entries[index].printJob);
      fitDirectBatchLabel(label, labelSize);
    });
    await waitForDirectBatchFrame();
    labels.forEach((label) => fitDirectBatchLabel(label, labelSize));
    batchPrintSurface.classList.remove("is-preparing");
    traceBatchPrint("labels-ready", { labelsPrepared: sheets.length });
  }

  async function callBatchPrintOnce(expectedLabelCount) {
    await waitForDirectBatchFrame();
    const labels = batchPrintSurface.querySelectorAll(".ticket-batch-label-sheet .print-label");
    if (labels.length !== expectedLabelCount) {
      throw createBatchPrintError("BATCH_PRINT_NOT_READY", "Chưa dựng đủ tem để mở hộp thoại in.");
    }
    const internalIds = Array.from(batchPrintSurface.querySelectorAll("[id]"));
    if (internalIds.length) {
      throw createBatchPrintError("BATCH_DUPLICATE_IDS", "Tem hàng loạt còn chứa ID nội bộ. Chưa mở in.");
    }

    batchPrintSurface.classList.remove("is-preparing");
    document.body.classList.add("is-batch-label-printing");
    batchPrintSurface.setAttribute("aria-hidden", "false");
    if (pendingAfterPrintCleanup) {
      window.removeEventListener("afterprint", pendingAfterPrintCleanup);
    }
    pendingAfterPrintCleanup = () => {
      document.body.classList.remove("is-batch-label-printing");
      batchPrintSurface.setAttribute("aria-hidden", "true");
      batchPrintSurface.replaceChildren();
      pendingAfterPrintCleanup = null;
    };
    window.addEventListener("afterprint", pendingAfterPrintCleanup, { once: true });
    traceBatchPrint("invoking-print", { labelsPrepared: labels.length, printInvocationCount: 1 });
    window.print();
  }

  async function prepareAndPrintBatch(options) {
    if (batchPrintRunning) {
      return;
    }
    if (batchRecoveryLoading || batchRecoveryBlocked) {
      window.AMNewTicket.showNotice(
        "error",
        batchRecoveryIssue || "Đang khôi phục danh sách phiếu. Vui lòng chờ trong giây lát."
      );
      return;
    }
    const settings = options || {};
    const isLastBatchAction = settings.reprint === true;
    const ticketRefs = normalizeBatchTicketRefs(settings.ticketRefs || getExactBatchTicketRefs());
    if (!settings.reprint && !allCardsCreated()) {
      window.AMNewTicket.showNotice("error", "Chỉ có thể chuẩn bị tem sau khi tất cả phiếu đã được tạo thành công.");
      return;
    }
    if (!ticketRefs.length) {
      const error = createBatchPrintError("BATCH_TICKET_REFS_MISSING", "Không có UUID phiếu chính xác để in lại. Chưa mở in.");
      traceBatchPrint("failed", { code: error.code, message: error.message });
      window.AMNewTicket.showNotice("error", error.message);
      return;
    }

    const sessionLabelSize = normalizeMultiLabelSize(settings.labelSize);
    batchWorkflowIntentRequest += 1;
    batchPrintRunning = true;
    reprintBatchButton.disabled = true;
    setLastBatchLabelSizeDisabled(true);
    if (!isLastBatchAction) {
      setBatchState(BATCH_STATES.PREPARING_PRINT);
    } else {
      updateBatchActionBar();
    }

    try {
      traceBatchPrint("ticket-ids-ready", {
        ticketIds: ticketRefs.map((ref) => ref.ticketId),
        labelsExpected: ticketRefs.length
      });
      const freshEntries = await fetchFreshBatchTicketsFromRefs(ticketRefs, {
        verifySnapshot: settings.reprint !== true
      });
      recoveredBatchEntries = freshEntries;
      batchRecoveryIssue = "";
      traceBatchPrint("tickets-fetched", { ticketsFetched: freshEntries.length });
      const workflowSummary = await runBatchWorkflowBeforePrint(freshEntries);
      traceBatchPrint("jobs-ready", { labelsPrepared: freshEntries.length });
      await renderFreshBatch(freshEntries, { labelSize: sessionLabelSize });
      if (!isLastBatchAction) {
        setBatchState(BATCH_STATES.PRINT_READY);
      }
      await callBatchPrintOnce(freshEntries.length);
      renderBatchResult();
      if (!isLastBatchAction) {
        setBatchState(BATCH_STATES.PRINT_TRIGGERED);
      }
      window.AMNewTicket.showNotice(
        "success",
        workflowSummary.startRepairCalls
          ? `Đã chuyển ${workflowSummary.startRepairCalls} phiếu sang đang sửa và chuẩn bị đủ ${freshEntries.length} tem.`
          : `Đã chuẩn bị đủ ${freshEntries.length} tem để in lại.`
      );
    } catch (error) {
      traceBatchPrint("failed", { code: error.code || "UNKNOWN", message: error.message || "" });
      batchPrintSurface.classList.remove("is-preparing");
      batchPrintSurface.replaceChildren();
      if (!isLastBatchAction) {
        setBatchState(BATCH_STATES.PRINT_FAILED);
      }
      renderBatchResult();
      window.AMNewTicket.showNotice(
        "error",
        `Đã tạo ${ticketRefs.length} phiếu. Chưa thể chuẩn bị tem: ${error.message} Không tạo lại phiếu; hãy dùng “${getBatchPrintActionLabel(ticketRefs.length, { retry: true })}”.`
      );
      throw error;
    } finally {
      batchPrintRunning = false;
      reprintBatchButton.disabled = false;
      setLastBatchLabelSizeDisabled(false);
      updateBatchActionBar();
    }
  }

  function renderBatchResult() {
    const ticketRefs = getExactBatchTicketRefs();
    if (!ticketRefs.length) {
      batchResult.hidden = true;
      return;
    }
    batchResultTitle.textContent = batchRecoveryIssue
      ? batchRecoveryIssue
      : batchWorkflowIntent === "reprint"
        ? `Sẵn sàng in lại ${ticketRefs.length} tem của đợt trước.`
        : `Sẵn sàng in ${ticketRefs.length} tem và bắt đầu sửa chữa.`;
    const items = recoveredBatchEntries.length ? recoveredBatchEntries.map((entry) => {
      const item = document.createElement("li");
      const device = [entry.printJob.brand, entry.printJob.model]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join(" ");
      item.textContent = `${window.AMApi.formatTicketCode(entry.printJob.ticket_code)} — ${device || "Tivi"}.`;
      return item;
    }) : ticketRefs.map((ref) => {
      const item = document.createElement("li");
      item.textContent = `${window.AMApi.formatTicketCode(ref.ticketCode)} — Tivi.`;
      return item;
    });

    if (batchRecoveryIssue) {
      const issue = document.createElement("li");
      issue.className = "batch-result-issue";
      issue.textContent = batchRecoveryIssue;
      items.push(issue);
    }
    batchResultList.replaceChildren(...items);
    addForSameCustomerButton.hidden = false;
    batchResult.hidden = false;
  }

  function captureCreatedCardsAsLastBatchEntries() {
    const sharedCustomer = customerPayload();
    return cards.filter((card) => card.created && card.created.id).map((card) => ({
      card,
      ticketId: String(card.created.id),
      printJob: Object.freeze(Object.assign(
        {},
        sharedCustomer,
        card.printSnapshot || collectCardData(card),
        card.created
      ))
    }));
  }

  async function runBatchCreation() {
    if (batchRunning || batchPrintRunning) {
      return;
    }
    if (allCardsCreated()) {
      renderBatchResult();
      window.AMNewTicket.showNotice("info", `Các phiếu đã được tạo. Dùng “${reprintBatchButton.textContent}” để chuẩn bị lại tem.`);
      return;
    }

    window.AMNewTicket.clearNotice();
    setBatchState(BATCH_STATES.VALIDATING);
    const customerOptions = validateBatch();
    if (!customerOptions) {
      setBatchState(createdCardCount() > 0 ? BATCH_STATES.PARTIAL : BATCH_STATES.DRAFT);
      return;
    }

    const sessionLabelSize = normalizeMultiLabelSize(currentDraftLabelSize);
    let capturedAsLastBatch = false;
    setBatchBusy(true);
    try {
      setBatchState(BATCH_STATES.CREATING);
      await createPendingCards(customerOptions, null);
      if (!allCardsCreated()) {
        throw new Error("Chưa tạo đủ phiếu trong đợt này.");
      }
      const createdTicketRefs = getCreatedCardTicketRefs();
      saveBatchTicketRefs(createdTicketRefs, {
        selectedLabelSize: sessionLabelSize,
        createdAt: new Date().toISOString()
      });
      recoveredBatchEntries = captureCreatedCardsAsLastBatchEntries();
      capturedAsLastBatch = true;
      batchWorkflowIntent = "start";
      setBatchState(BATCH_STATES.CREATED);
      renderBatchResult();
      await prepareAndPrintBatch({
        reprint: false,
        labelSize: sessionLabelSize,
        ticketRefs: createdTicketRefs
      });
    } catch (error) {
      const createdCount = cards.filter((card) => card.created).length;
      if (createdCount > 0 && createdCount < cards.length) {
        setBatchState(BATCH_STATES.PARTIAL);
        window.AMNewTicket.showNotice(
          "error",
          `${error.message} ${createdCount} phiếu trước đó đã được giữ nguyên; hãy sửa card lỗi rồi tiếp tục các phiếu còn lại.`
        );
      } else if (createdCount === 0) {
        setBatchState(BATCH_STATES.DRAFT);
        window.AMNewTicket.showNotice("error", error.message);
      } else if (batchState !== BATCH_STATES.PRINT_FAILED) {
        window.AMNewTicket.showNotice("error", error.message);
      }
    } finally {
      setBatchBusy(false);
      if (capturedAsLastBatch) {
        resetCurrentDraft({ preserveNotice: true });
        renderBatchResult();
      }
      updateBatchActionBar();
    }
  }

  function clearDeviceCard(card) {
    DEVICE_FIELDS.forEach((name) => {
      if (!card.fields[name]) {
        return;
      }
      card.fields[name].value = name === "device_type"
        ? "Tivi"
        : name === "received_date"
          ? todayValue()
          : name === "status"
            ? "mới nhận"
            : "";
      card.fields[name].disabled = false;
    });
    card.requestId = null;
    card.intakeBatchItemNo = null;
    card.created = null;
    card.printSnapshot = null;
    card.workflowCompleted = false;
    card.failed = false;
    card.assists.forEach((assist) => {
      if (assist && typeof assist.reset === "function") {
        assist.reset();
      }
    });
    card.root.classList.remove("is-created");
    card.root.querySelectorAll("[data-device-action]").forEach((button) => {
      button.disabled = false;
    });
    setCardCollapsed(card, false);
    updateCardPresentation(card);
  }

  function resetCardsToOne() {
    cards.slice(1).forEach((card) => card.root.remove());
    cards = [cards[0]];
    clearDeviceCard(cards[0]);
    currentIntakeBatchId = null;
    intakeBatchCapabilityAvailable = null;
    renumberCards();
    setCurrentDraftLabelSize(DEFAULT_MULTI_LABEL_SIZE);
    batchWorkflowIntentRequest += 1;
    setBatchState(BATCH_STATES.DRAFT);
  }

  function resetCurrentDraft(options) {
    const settings = options || {};
    const notice = document.getElementById("ticketNotice");
    const noticeSnapshot = settings.preserveNotice && notice
      ? { className: notice.className, textContent: notice.textContent }
      : null;
    suppressResetHandling = true;
    window.AMNewTicket.resetForNewTicket();
    suppressResetHandling = false;
    resetCardsToOne();
    restoreModeRadio(MODE_BATCH);
    setMode(MODE_BATCH);
    if (noticeSnapshot && notice) {
      notice.className = noticeSnapshot.className;
      notice.textContent = noticeSnapshot.textContent;
    }
  }

  function cancelBatch() {
    const createdCount = cards.filter((card) => card.created).length;
    if (
      createdCount > 0
      && !window.confirm("Một số phiếu đã được tạo và sẽ không bị xóa. Dữ liệu chưa lưu sẽ bị mất. Tiếp tục hủy đợt?")
    ) {
      return;
    }
    resetCurrentDraft();
  }

  async function createAnotherBatchForSameCustomer() {
    const ticketRefs = getExactBatchTicketRefs();
    let sourceTicket = recoveredBatchEntries[0] && recoveredBatchEntries[0].printJob;
    if (!sourceTicket && ticketRefs[0]) {
      sourceTicket = await window.AMApi.getFreshTicketForPrint(ticketRefs[0].ticketId);
    }
    if (!sourceTicket || !sourceTicket.customer_id) {
      window.AMNewTicket.showNotice("error", "Không còn customer_id để tạo thêm tivi cho cùng khách.");
      return;
    }
    resetCurrentDraft();
    document.getElementById("customer_name").value = sourceTicket.customer_name || "";
    document.getElementById("customer_phone").value = sourceTicket.customer_phone || "";
    document.getElementById("customer_address").value = sourceTicket.customer_address || "";
    window.AMNewTicket.setExistingCustomerFromCreatedTicket(sourceTicket);
    setBatchBusy(false);
    restoreModeRadio(MODE_BATCH);
    setMode(MODE_BATCH);
    primaryDeviceCard.scrollIntoView({ block: "start" });
    cards[0].fields.device_type.focus({ preventScroll: true });
  }

  function handleBeforeUnload(event) {
    const createdCount = cards.filter((card) => card.created).length;
    if (!batchRunning && !(creationMode === MODE_BATCH && createdCount > 0 && createdCount < cards.length)) {
      return;
    }
    event.preventDefault();
    event.returnValue = "";
  }

  function initBatchTicketCreation() {
    if (
      !form
      || !window.AMNewTicket
      || !primaryDeviceCard
      || !deviceCardTemplate
      || form.dataset.batchTicketAttached === "true"
    ) {
      return;
    }

    if (!hasBatchWorkflowApiContract()) {
      console.error("[multi-print] AMApi.resolveLabelWorkflowAction is unavailable.");
      window.AMNewTicket.showNotice(
        "error",
        "Không thể khởi tạo workflow in nhiều tem. Vui lòng tải lại trang."
      );
      return;
    }

    form.dataset.batchTicketAttached = "true";
    const primaryCard = makeCard(primaryDeviceCard, {
      isPrimary: true,
      key: "primary"
    });
    cards = [primaryCard];
    updateCardPresentation(primaryCard);
    populateMultiLabelSizeControls();
    setCurrentDraftLabelSize(DEFAULT_MULTI_LABEL_SIZE);
    setLastBatchLabelSize(DEFAULT_MULTI_LABEL_SIZE);
    updateBatchActionBar();

    modeGroup.addEventListener("change", handleModeChange);
    document.getElementById("deviceListSection").addEventListener("click", handleDeviceAction);
    addDeviceButton.addEventListener("click", () => {
      const card = createAdditionalCard();
      card.fields.device_type.focus({ preventScroll: true });
      card.root.scrollIntoView({ block: "nearest" });
    });
    validateBatchButton.addEventListener("click", () => validateBatch({ showSuccess: true }));
    batchLabelSizeSelect.addEventListener("change", () => setCurrentDraftLabelSize(batchLabelSizeSelect.value));
    batchResultLabelSizeSelect.addEventListener("change", () => setLastBatchLabelSize(batchResultLabelSizeSelect.value));
    createBatchButton.addEventListener("click", runBatchCreation);
    cancelBatchButton.addEventListener("click", cancelBatch);
    reprintBatchButton.addEventListener("click", async () => {
      const sessionLabelSize = normalizeMultiLabelSize(lastBatchLabelSize);
      const ticketRefs = getExactBatchTicketRefs();
      traceBatchPrint("clicked", {
        ticketIds: ticketRefs.map((ref) => ref.ticketId),
        labelsExpected: ticketRefs.length
      });
      await prepareAndPrintBatch({
        reprint: true,
        labelSize: sessionLabelSize,
        ticketRefs
      }).catch(() => {});
    });
    newBatchButton.addEventListener("click", () => resetCurrentDraft());
    addForSameCustomerButton.addEventListener("click", () => {
      createAnotherBatchForSameCustomer().catch((error) => {
        window.AMNewTicket.showNotice("error", error.message || "Không thể tạo đợt mới cho cùng khách.");
      });
    });
    window.addEventListener("beforeunload", handleBeforeUnload);
    form.addEventListener("reset", () => {
      if (!suppressResetHandling && creationMode === MODE_BATCH) {
        window.setTimeout(resetCardsToOne, 0);
      }
    });
    const recovery = loadBatchPrintRecovery();
    lastCreatedBatchTicketRefs = recovery
      ? normalizeBatchTicketRefs(recovery.ticketIds.map((ticketId, index) => ({
        ticketId,
        ticketCode: recovery.ticketCodes[index]
      })))
      : [];
    if (recovery) {
      setLastBatchLabelSize(recovery.selectedLabelSize);
    }
    setMode(MODE_SINGLE);
    if (lastCreatedBatchTicketRefs.length) {
      restoreModeRadio(MODE_BATCH);
      setMode(MODE_BATCH);
      setBatchState(BATCH_STATES.DRAFT);
      renderBatchResult();
      refreshBatchWorkflowIntent(lastCreatedBatchTicketRefs);
    }
  }

  document.addEventListener("DOMContentLoaded", initBatchTicketCreation);
})();

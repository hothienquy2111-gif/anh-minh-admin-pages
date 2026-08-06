(function () {
  "use strict";

  const MODE_SINGLE = "single";
  const MODE_BATCH = "batch";
  const MAX_FRESH_CONCURRENCY = 4;
  const RENDER_TIMEOUT_MS = 12000;
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
  const LABEL_SIZES = {
    "50x30": { width: "50mm", height: "30mm", className: "label-50x30" },
    "58x30": { width: "58mm", height: "30mm", className: "label-58x30" },
    "58x40": { width: "58mm", height: "40mm", className: "label-58x40" },
    "60x40": { width: "60mm", height: "40mm", className: "label-60x40" },
    "80x50": { width: "80mm", height: "50mm", className: "label-80x50" }
  };

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
  const batchResult = document.getElementById("batchResult");
  const batchResultTitle = document.getElementById("batchResultTitle");
  const batchResultList = document.getElementById("batchResultList");
  const reprintBatchButton = document.getElementById("reprintBatchButton");
  const newBatchButton = document.getElementById("newBatchButton");
  const addForSameCustomerButton = document.getElementById("addForSameCustomerButton");
  const rendererHost = document.getElementById("batchLabelRendererHost");
  const batchPrintSurface = document.getElementById("batchPrintSurface");

  let creationMode = MODE_SINGLE;
  let cards = [];
  let batchRunning = false;
  let batchPrintRunning = false;
  let suppressResetHandling = false;
  let rendererFrame = null;
  let rendererReadyPromise = null;
  let rendererReadyResolve = null;
  let rendererReadyReject = null;
  let activeRenderRequest = null;

  function randomId() {
    if (!window.crypto || typeof window.crypto.randomUUID !== "function") {
      throw new Error("Trình duyệt không hỗ trợ crypto.randomUUID().");
    }

    return window.crypto.randomUUID();
  }

  function todayValue() {
    return new Date().toISOString().slice(0, 10);
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
      created: null,
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
      statusElement.textContent = "Đã tạo phiếu";
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

  function updateBatchActionBar() {
    const validCount = cards.filter((card) => isCardValid(card)).length;
    const incompleteCount = cards.length - validCount;
    const createdCount = cards.filter((card) => card.created).length;
    const remainingCount = cards.length - createdCount;

    batchActionSummary.textContent = [
      `${cards.length} tivi`,
      `${validCount} đã đủ thông tin`,
      `${incompleteCount} cần bổ sung`,
      createdCount ? `${createdCount} đã tạo phiếu` : ""
    ].filter(Boolean).join(" • ");

    if (createdCount > 0 && remainingCount > 0) {
      createBatchButton.textContent = `Tiếp tục tạo ${remainingCount} phiếu còn lại`;
    } else {
      createBatchButton.textContent = `Tạo ${cards.length} phiếu & in ${cards.length} tem`;
    }
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
    createBatchButton.disabled = isBusy;
    validateBatchButton.disabled = isBusy;
    cancelBatchButton.disabled = isBusy;
    addDeviceButton.disabled = isBusy;
    modeGroup.querySelectorAll("input").forEach((input) => {
      input.disabled = isBusy;
    });
    form.setAttribute("aria-busy", String(isBusy));
  }

  function customerPayload() {
    return window.AMNewTicket.getSharedCustomerData();
  }

  async function createPendingCards(customerOptions) {
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

      try {
        const created = await window.AMApi.createTicket(
          Object.assign({}, sharedCustomer, collectCardData(card)),
          {
            clientRequestId: card.requestId,
            customerMode: options.customerMode,
            existingCustomerId: options.existingCustomerId
          }
        );
        card.created = created;
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

  async function fetchFreshBatchTickets() {
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
        const ticket = await window.AMApi.getFreshTicketForPrint(card.created.id);
        if (!ticket) {
          throw new Error("Không có dữ liệu mới nhất.");
        }
        return { card, ticket };
      } catch (_error) {
        throw new Error(`Không tải được dữ liệu mới nhất của ${window.AMApi.formatTicketCode(card.created.ticket_code)} (Tivi ${padDeviceNumber(index + 1)}).`);
      }
    });
  }

  function createRendererFrame() {
    rendererHost.hidden = false;
    rendererFrame = document.createElement("iframe");
    rendererFrame.className = "ticket-batch-renderer-frame";
    rendererFrame.title = "Bộ dựng tem nội bộ";
    rendererFrame.src = "print-label.html?embed=1";
    rendererHost.replaceChildren(rendererFrame);

    rendererReadyPromise = new Promise((resolve, reject) => {
      rendererReadyResolve = resolve;
      rendererReadyReject = reject;
      window.setTimeout(() => {
        if (rendererReadyReject) {
          rendererReadyReject(new Error("Bộ dựng tem không phản hồi."));
          rendererReadyResolve = null;
          rendererReadyReject = null;
        }
      }, RENDER_TIMEOUT_MS);
    });
  }

  async function ensureRendererFrame() {
    if (!rendererFrame || !rendererFrame.isConnected) {
      createRendererFrame();
    }

    await rendererReadyPromise;
    return rendererFrame;
  }

  function handleRendererMessage(event) {
    if (!rendererFrame || event.source !== rendererFrame.contentWindow || event.origin !== window.location.origin) {
      return;
    }

    const data = event.data || {};
    if (data.type === "am-label-embed-ready") {
      if (rendererReadyResolve) {
        rendererReadyResolve();
        rendererReadyResolve = null;
        rendererReadyReject = null;
      }
      return;
    }

    if (!activeRenderRequest || data.token !== activeRenderRequest.token) {
      return;
    }

    if (data.type === "am-label-embed-error") {
      activeRenderRequest.reject(new Error(data.message || "Không dựng được tem."));
      activeRenderRequest = null;
      return;
    }

    if (data.type === "am-label-embed-rendered") {
      const renderedLabel = rendererFrame.contentDocument.getElementById("thermalLabel");
      if (!renderedLabel) {
        activeRenderRequest.reject(new Error("Bộ dựng tem không trả về mẫu tem."));
        activeRenderRequest = null;
        return;
      }

      const clone = renderedLabel.cloneNode(true);
      clone.removeAttribute("id");
      clone.dataset.ticketId = data.ticketId || "";
      activeRenderRequest.resolve({
        label: clone,
        workflowApplied: data.workflowApplied === true
      });
      activeRenderRequest = null;
    }
  }

  async function renderTicketWithExistingTemplate(entry, options) {
    const frame = await ensureRendererFrame();
    const token = randomId();
    const settings = options || {};

    return await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        if (activeRenderRequest && activeRenderRequest.token === token) {
          activeRenderRequest = null;
          reject(new Error(`Dựng tem ${window.AMApi.formatTicketCode(entry.ticket.ticket_code)} quá thời gian.`));
        }
      }, RENDER_TIMEOUT_MS);

      activeRenderRequest = {
        token,
        resolve(value) {
          window.clearTimeout(timeout);
          resolve(value);
        },
        reject(error) {
          window.clearTimeout(timeout);
          reject(error);
        }
      };

      frame.contentWindow.postMessage({
        type: "am-label-embed-render",
        token,
        ticket: entry.ticket,
        runWorkflow: settings.runWorkflow === true
      }, window.location.origin);
    });
  }

  function selectedLabelSize(label) {
    return Object.entries(LABEL_SIZES).find(([_key, size]) => label.classList.contains(size.className))
      || ["50x30", LABEL_SIZES["50x30"]];
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
    const sheets = [];

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      window.AMNewTicket.showNotice("info", `Đang chuẩn bị tem ${index + 1}/${entries.length}…`);
      const rendered = await renderTicketWithExistingTemplate(entry, {
        runWorkflow: settings.reprint === true || !entry.card.workflowCompleted
      });
      if (rendered.workflowApplied) {
        entry.card.workflowCompleted = true;
      }

      const sheet = document.createElement("section");
      sheet.className = "ticket-batch-label-sheet";
      sheet.dataset.batchLabelIndex = String(index);
      sheet.appendChild(rendered.label);
      sheets.push(sheet);
    }

    batchPrintSurface.replaceChildren(...sheets);
    const firstLabel = sheets[0].querySelector(".print-label");
    const [_key, size] = selectedLabelSize(firstLabel);
    syncBatchPrintPageSize(size);
  }

  function callBatchPrintOnce() {
    document.body.classList.add("is-batch-label-printing");
    batchPrintSurface.setAttribute("aria-hidden", "false");
    window.addEventListener("afterprint", () => {
      document.body.classList.remove("is-batch-label-printing");
      batchPrintSurface.setAttribute("aria-hidden", "true");
    }, { once: true });
    window.print();
  }

  async function prepareAndPrintBatch(options) {
    if (batchPrintRunning) {
      return;
    }

    batchPrintRunning = true;
    reprintBatchButton.disabled = true;

    try {
      const freshEntries = await fetchFreshBatchTickets();
      await renderFreshBatch(freshEntries, options);
      callBatchPrintOnce();
      renderBatchResult();
      window.AMNewTicket.showNotice("success", `Đã tạo ${cards.length} phiếu và chuẩn bị ${cards.length} tem.`);
    } catch (error) {
      window.AMNewTicket.showNotice("error", `${error.message} Không tạo lại phiếu. Hãy dùng “Chuẩn bị và in lại toàn bộ tem”.`);
      reprintBatchButton.textContent = "Chuẩn bị và in lại toàn bộ tem";
      batchResult.hidden = false;
      throw error;
    } finally {
      batchPrintRunning = false;
      reprintBatchButton.disabled = false;
    }
  }

  function renderBatchResult() {
    const customerName = document.getElementById("customer_name").value.trim() || "khách hàng";
    batchResultTitle.textContent = `Đã tạo ${cards.length} phiếu cho ${customerName}.`;
    const items = cards.map((card) => {
      const data = collectCardData(card);
      const item = document.createElement("li");
      const code = window.AMApi.formatTicketCode(card.created.ticket_code);
      const device = [data.brand, data.model].map((value) => String(value || "").trim()).filter(Boolean).join(" ");
      item.textContent = `${code} — ${device || "Tivi"}.`;
      return item;
    });
    batchResultList.replaceChildren(...items);
    batchResult.hidden = false;
  }

  async function runBatchCreation() {
    if (batchRunning || batchPrintRunning) {
      return;
    }

    window.AMNewTicket.clearNotice();
    const customerOptions = validateBatch();
    if (!customerOptions) {
      return;
    }

    setBatchBusy(true);
    try {
      await createPendingCards(customerOptions);
      await prepareAndPrintBatch({ reprint: false });
    } catch (error) {
      const createdCount = cards.filter((card) => card.created).length;
      if (createdCount > 0 && createdCount < cards.length) {
        window.AMNewTicket.showNotice(
          "error",
          `${error.message} ${createdCount} phiếu trước đó đã được giữ nguyên; hãy sửa card lỗi rồi tiếp tục các phiếu còn lại.`
        );
      } else if (!String(error.message || "").includes("Không tạo lại phiếu")) {
        window.AMNewTicket.showNotice("error", error.message);
      }
    } finally {
      setBatchBusy(false);
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
    card.created = null;
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
    renumberCards();
    batchResult.hidden = true;
    batchPrintSurface.replaceChildren();
    updateBatchActionBar();
  }

  function resetWholeBatch() {
    suppressResetHandling = true;
    window.AMNewTicket.resetForNewTicket();
    suppressResetHandling = false;
    resetCardsToOne();
    restoreModeRadio(MODE_BATCH);
    setMode(MODE_BATCH);
  }

  function cancelBatch() {
    const createdCount = cards.filter((card) => card.created).length;
    if (
      createdCount > 0
      && !window.confirm("Một số phiếu đã được tạo và sẽ không bị xóa. Dữ liệu chưa lưu sẽ bị mất. Tiếp tục hủy đợt?")
    ) {
      return;
    }
    resetWholeBatch();
  }

  function createAnotherBatchForSameCustomer() {
    const customerId = document.getElementById("customer_id").value;
    if (!customerId) {
      window.AMNewTicket.showNotice("error", "Không còn customer_id để tạo thêm tivi cho cùng khách.");
      return;
    }
    resetCardsToOne();
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

    form.dataset.batchTicketAttached = "true";
    const primaryCard = makeCard(primaryDeviceCard, {
      isPrimary: true,
      key: "primary"
    });
    cards = [primaryCard];
    updateCardPresentation(primaryCard);
    updateBatchActionBar();

    modeGroup.addEventListener("change", handleModeChange);
    document.getElementById("deviceListSection").addEventListener("click", handleDeviceAction);
    addDeviceButton.addEventListener("click", () => {
      const card = createAdditionalCard();
      card.fields.device_type.focus({ preventScroll: true });
      card.root.scrollIntoView({ block: "nearest" });
    });
    validateBatchButton.addEventListener("click", () => validateBatch({ showSuccess: true }));
    createBatchButton.addEventListener("click", runBatchCreation);
    cancelBatchButton.addEventListener("click", cancelBatch);
    reprintBatchButton.addEventListener("click", async () => {
      cards.forEach((card) => {
        card.workflowCompleted = false;
      });
      await prepareAndPrintBatch({ reprint: true }).catch(() => {});
    });
    newBatchButton.addEventListener("click", resetWholeBatch);
    addForSameCustomerButton.addEventListener("click", createAnotherBatchForSameCustomer);
    window.addEventListener("message", handleRendererMessage);
    window.addEventListener("beforeunload", handleBeforeUnload);
    form.addEventListener("reset", () => {
      if (!suppressResetHandling && creationMode === MODE_BATCH) {
        window.setTimeout(resetCardsToOne, 0);
      }
    });
    setMode(MODE_SINGLE);
  }

  document.addEventListener("DOMContentLoaded", initBatchTicketCreation);
})();

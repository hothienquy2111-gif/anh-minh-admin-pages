(function () {
  "use strict";

  const form = document.getElementById("ticketForm");
  const notice = document.getElementById("ticketNotice");
  const createButton = document.getElementById("createTicketButton");
  const createdActions = document.getElementById("createdActions");
  const printCreatedLink = document.getElementById("printCreatedLink");
  const printReceiptCreatedLink = document.getElementById("printReceiptCreatedLink");
  const viewCreatedLink = document.getElementById("viewCreatedLink");
  const newTicketButton = document.getElementById("newTicketButton");
  const statusSelect = document.getElementById("status");
  const customerNameInput = document.getElementById("customer_name");
  const customerPhoneInput = document.getElementById("customer_phone");
  const customerAddressInput = document.getElementById("customer_address");
  const customerIdInput = document.getElementById("customer_id");
  const customerCodeInput = document.getElementById("customer_code");
  const customerLookupState = document.getElementById("customerLookupState");
  const customerLookupResults = document.getElementById("customerLookupResults");
  const customerLookupActions = document.getElementById("customerLookupActions");
  const customerCreateNewButton = document.getElementById("customerCreateNewButton");
  const customerHistoryButton = document.getElementById("customerHistoryButton");
  const customerHistoryPanel = document.getElementById("customerHistoryPanel");
  const brandInput = document.getElementById("brand");
  const modelInput = document.getElementById("model");
  const sizeInput = document.getElementById("size");
  const brandList = document.getElementById("tv-brand-options");
  const sizeAssistHint = document.getElementById("sizeAssistHint");
  const conditionTextInput = document.getElementById("condition_text");
  const externalConditionInput = document.getElementById("external_condition");
  const machineConditionPicker = document.getElementById("machineConditionPicker");
  const appearanceConditionPicker = document.getElementById("appearanceConditionPicker");

  const CUSTOMER_LOOKUP_DELAY = 200;
  const CUSTOMER_RESULT_LIMIT = 8;
  const CUSTOMER_SEARCH_MIN_LENGTH = Object.freeze({
    name: 2,
    phone: 3
  });
  let customerLookupTimer = null;
  let customerLookupAbortController = null;
  let customerLookupRequestId = 0;
  let activeCustomerLookupInput = null;
  let activeCustomerLookupSource = null;
  let activeCustomerOptionIndex = -1;
  let lastCompletedLookupKey = "";
  let lastCompletedCustomers = [];
  let matchedCustomers = [];
  let selectedCustomer = null;
  let selectionNeedsVerification = false;
  let customerMode = "new";
  let currentClientRequestId = null;
  let isSubmitting = false;
  let isCustomerLookupPending = false;
  let deviceAssist = null;
  let conditionAssists = [];

  function showNotice(type, message) {
    notice.className = `notice ${type} show`;
    notice.textContent = message;
  }

  function clearNotice() {
    notice.className = "notice";
    notice.textContent = "";
  }

  function setLoading(isLoading) {
    form.setAttribute("aria-busy", String(isLoading));
    if (window.AMUI && typeof window.AMUI.setButtonBusy === "function") {
      window.AMUI.setButtonBusy(createButton, isLoading, {
        busyText: "Đang tạo phiếu...",
        idleText: "Tạo phiếu"
      });
      return;
    }

    createButton.disabled = isLoading;
    createButton.textContent = isLoading ? "Đang tạo phiếu..." : "Tạo phiếu";
  }

  function textOrDash(value) {
    const text = String(value || "").trim();
    return text || "—";
  }

  function formatDate(value) {
    if (!value) {
      return "Chưa có";
    }

    const date = String(value).includes("T")
      ? new Date(value)
      : new Date(`${value}T00:00:00`);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleDateString("vi-VN");
  }

  function resetCustomerHistory() {
    if (!customerHistoryPanel) {
      return;
    }

    customerHistoryPanel.classList.add("hidden");
    customerHistoryPanel.innerHTML = "";
  }

  function setCustomerLookupState(type, message) {
    if (!customerLookupState) {
      return;
    }

    customerLookupState.className = `customer-lookup-state ${type || ""}`.trim();
    customerLookupState.textContent = message;
  }

  function customerLookupInputs() {
    return [customerNameInput, customerPhoneInput].filter(Boolean);
  }

  function normalizeCustomerName(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, " ")
      .toLocaleLowerCase("vi-VN");
  }

  function customerPhoneDigits(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function customerLookupSource(input) {
    return input === customerPhoneInput ? "phone" : "name";
  }

  function customerLookupQuery(input) {
    if (customerLookupSource(input) === "phone") {
      return customerPhoneDigits(input && input.value);
    }

    return String(input && input.value || "").trim().replace(/\s+/g, " ");
  }

  function customerLookupKey(source, query) {
    return `${source}:${String(query || "").toLocaleLowerCase("vi-VN")}`;
  }

  function formatCustomerPhone(value) {
    const digits = customerPhoneDigits(value);

    if (/^0\d{9}$/.test(digits)) {
      return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
    }

    return String(value || "").trim() || "—";
  }

  function setComboboxExpanded(input, isExpanded) {
    customerLookupInputs().forEach((field) => {
      field.setAttribute("aria-expanded", String(field === input && isExpanded));
      if (field !== input || !isExpanded) {
        field.removeAttribute("aria-activedescendant");
      }
    });
  }

  function cancelCustomerLookupRequest() {
    if (customerLookupTimer) {
      window.clearTimeout(customerLookupTimer);
      customerLookupTimer = null;
    }

    if (customerLookupAbortController) {
      customerLookupAbortController.abort();
      customerLookupAbortController = null;
    }

    isCustomerLookupPending = false;
  }

  function closeCustomerSuggestions(options) {
    const settings = options || {};

    if (settings.cancelRequest) {
      customerLookupRequestId += 1;
      cancelCustomerLookupRequest();
    }

    activeCustomerOptionIndex = -1;
    setComboboxExpanded(null, false);

    if (customerLookupResults) {
      customerLookupResults.hidden = true;
    }
  }

  function openCustomerSuggestions(input) {
    if (!customerLookupResults || !input) {
      return;
    }

    const field = input.closest("[data-customer-autocomplete-field]");

    if (!field) {
      return;
    }

    if (customerLookupResults.parentElement !== field) {
      field.appendChild(customerLookupResults);
    }

    activeCustomerLookupInput = input;
    activeCustomerLookupSource = customerLookupSource(input);
    customerLookupResults.hidden = false;
    setComboboxExpanded(input, true);
  }

  function clearCustomerSuggestionContent() {
    if (customerLookupResults) {
      customerLookupResults.replaceChildren();
    }

    activeCustomerOptionIndex = -1;
    customerLookupInputs().forEach((input) => input.removeAttribute("aria-activedescendant"));
  }

  function setCustomerLookupActions(options) {
    if (!customerLookupActions) {
      return;
    }

    const settings = options || {};
    const showCreate = Boolean(settings.showCreate);
    const showHistory = Boolean(settings.showHistory);

    customerCreateNewButton.classList.toggle("hidden", !showCreate);
    customerHistoryButton.classList.toggle("hidden", !showHistory);
    customerLookupActions.classList.toggle("hidden", !showCreate && !showHistory);
  }

  function clearSelectedCustomerState() {
    selectedCustomer = null;

    if (customerIdInput) {
      customerIdInput.value = "";
    }

    if (customerCodeInput) {
      customerCodeInput.value = "";
    }

    resetCustomerHistory();
  }

  function updateActiveCustomerOption(nextIndex) {
    if (!customerLookupResults) {
      return;
    }

    const options = Array.from(customerLookupResults.querySelectorAll('[role="option"]'));

    if (options.length === 0) {
      activeCustomerOptionIndex = -1;
      return;
    }

    activeCustomerOptionIndex = Math.min(Math.max(nextIndex, 0), options.length - 1);

    options.forEach((option, index) => {
      const isActive = index === activeCustomerOptionIndex;
      option.classList.toggle("is-active", isActive);
      option.setAttribute("aria-selected", String(isActive));
    });

    const activeOption = options[activeCustomerOptionIndex];
    activeCustomerLookupInput.setAttribute("aria-activedescendant", activeOption.id);

    if (activeOption.offsetTop < customerLookupResults.scrollTop) {
      customerLookupResults.scrollTop = activeOption.offsetTop;
    } else if (
      activeOption.offsetTop + activeOption.offsetHeight
      > customerLookupResults.scrollTop + customerLookupResults.clientHeight
    ) {
      customerLookupResults.scrollTop = activeOption.offsetTop
        + activeOption.offsetHeight
        - customerLookupResults.clientHeight;
    }
  }

  function renderCustomerSuggestionState(input, type, message) {
    clearCustomerSuggestionContent();

    const state = document.createElement("div");
    state.className = `customer-suggestion-state ${type || ""}`.trim();
    state.setAttribute("role", "status");
    state.textContent = message;
    customerLookupResults.appendChild(state);
    openCustomerSuggestions(input);
  }

  function renderCustomerSuggestions(input, customers) {
    clearCustomerSuggestionContent();

    customers.forEach((customer, index) => {
      const option = document.createElement("button");
      const name = document.createElement("strong");
      const meta = document.createElement("span");
      const address = document.createElement("span");
      const code = window.AMApi.formatCustomerCode(customer.customer_code);
      const addressText = String(customer.address || "").trim();

      option.id = `customerLookupOption-${customerLookupRequestId}-${index}`;
      option.type = "button";
      option.className = "customer-suggestion-option";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");

      name.className = "customer-suggestion-name";
      name.textContent = String(customer.name || "").trim() || "Khách hàng chưa có tên";

      meta.className = "customer-suggestion-meta";
      meta.textContent = `${formatCustomerPhone(customer.phone)} • ${code}`;

      option.append(name, meta);

      if (addressText) {
        address.className = "customer-suggestion-address";
        address.textContent = addressText;
        option.appendChild(address);
      }

      option.addEventListener("pointerdown", (event) => event.preventDefault());
      option.addEventListener("click", () => setExistingCustomer(customer));
      customerLookupResults.appendChild(option);
    });

    openCustomerSuggestions(input);
  }

  function fillCustomerFields(customer) {
    customerNameInput.value = customer.name || "";
    customerPhoneInput.value = customer.phone || "";
    customerAddressInput.value = customer.address || "";
  }

  function setExistingCustomer(customer) {
    selectedCustomer = customer;
    selectionNeedsVerification = false;
    customerMode = "existing";
    fillCustomerFields(customer);
    if (customerIdInput) {
      customerIdInput.value = customer.id || "";
    }
    if (customerCodeInput) {
      customerCodeInput.value = customer.customer_code || "";
    }
    resetCustomerHistory();
    setCustomerLookupState(
      "selected",
      `Đã chọn ${window.AMApi.formatCustomerCode(customer.customer_code)} — ${customer.name || "khách hàng cũ"}.`
    );
    setCustomerLookupActions({ showHistory: true });
    closeCustomerSuggestions({ cancelRequest: true });

    try {
      customerAddressInput.focus({ preventScroll: true });
    } catch (error) {
      customerAddressInput.focus();
    }
  }

  function setNewCustomerMode(message) {
    clearSelectedCustomerState();
    selectionNeedsVerification = false;
    customerMode = "new";
    setCustomerLookupState("new", message || "Đang dùng thông tin nhập tay để tạo khách hàng mới.");
    setCustomerLookupActions({});
    closeCustomerSuggestions({ cancelRequest: true });
  }

  function invalidateSelectedCustomerIfNeeded() {
    if (!selectedCustomer) {
      return;
    }

    const nameChanged = normalizeCustomerName(customerNameInput.value)
      !== normalizeCustomerName(selectedCustomer.name);
    const phoneChanged = customerPhoneDigits(customerPhoneInput.value)
      !== customerPhoneDigits(selectedCustomer.phone);

    if (!nameChanged && !phoneChanged) {
      return;
    }

    clearSelectedCustomerState();
    selectionNeedsVerification = true;
    customerMode = null;
    setCustomerLookupState(
      "warning",
      "Tên hoặc số điện thoại đã thay đổi. Hãy chọn lại khách phù hợp hoặc xác nhận tạo khách mới."
    );
    setCustomerLookupActions({ showCreate: true });
  }

  async function showCustomerHistory(customer) {
    if (!customerHistoryPanel || !customer) {
      return;
    }

    customerHistoryPanel.classList.remove("hidden");
    customerHistoryPanel.innerHTML = "<strong>Đang tải lịch sử phiếu...</strong>";

    try {
      const tickets = await window.AMApi.getTicketHistoryByCustomerId(customer.id, 50);
      customerHistoryPanel.innerHTML = "";

      const title = document.createElement("strong");
      title.textContent = `Lịch sử ${window.AMApi.formatCustomerCode(customer.customer_code)} - ${tickets.length} phiếu`;
      customerHistoryPanel.appendChild(title);

      if (tickets.length === 0) {
        const empty = document.createElement("p");
        empty.textContent = "Chưa có phiếu trước đây.";
        customerHistoryPanel.appendChild(empty);
        return;
      }

      const list = document.createElement("div");
      list.className = "customer-history-list";

      tickets.forEach((ticket) => {
        const link = document.createElement("a");
        link.href = `search.html?code=${encodeURIComponent(ticket.ticket_code || "")}`;
        link.textContent = `${window.AMApi.formatTicketCode(ticket.ticket_code)} - ${ticket.model || "Chưa có model"} - ${formatDate(ticket.received_date)}`;
        list.appendChild(link);
      });

      customerHistoryPanel.appendChild(list);
    } catch (error) {
      customerHistoryPanel.innerHTML = "";
      const message = document.createElement("p");
      message.textContent = error.message;
      customerHistoryPanel.appendChild(message);
    }
  }

  async function runCustomerLookup(input, source, query, requestId, controller) {
    try {
      const customers = await window.AMApi.searchCustomers(query, {
        mode: source,
        limit: CUSTOMER_RESULT_LIMIT,
        signal: controller.signal
      });

      if (requestId !== customerLookupRequestId || controller.signal.aborted) {
        return;
      }

      isCustomerLookupPending = false;
      matchedCustomers = customers;
      lastCompletedLookupKey = customerLookupKey(source, query);
      lastCompletedCustomers = customers.slice();
      resetCustomerHistory();

      if (customers.length === 0) {
        renderCustomerSuggestionState(input, "empty", "Không tìm thấy khách hàng phù hợp.");

        if (selectionNeedsVerification) {
          customerMode = null;
          setCustomerLookupState(
            "warning",
            "Không tìm thấy khách phù hợp với thông tin mới. Hãy xác nhận tạo khách mới nếu muốn tiếp tục."
          );
          setCustomerLookupActions({ showCreate: true });
        } else {
          customerMode = "new";
          setCustomerLookupState("new", "Không tìm thấy khách hàng phù hợp. Bạn có thể tiếp tục nhập khách mới.");
          setCustomerLookupActions({});
        }
        return;
      }

      customerMode = null;
      setCustomerLookupState(
        "found",
        `Tìm thấy ${customers.length} khách hàng phù hợp.`
      );
      setCustomerLookupActions({ showCreate: true });
      renderCustomerSuggestions(input, customers);
    } catch (error) {
      if (requestId !== customerLookupRequestId || controller.signal.aborted) {
        return;
      }

      isCustomerLookupPending = false;
      clearSelectedCustomerState();
      selectionNeedsVerification = false;
      customerMode = "new";
      matchedCustomers = [];
      lastCompletedLookupKey = "";
      lastCompletedCustomers = [];
      setCustomerLookupState("error", "Không thể tải khách hàng. Bạn vẫn có thể nhập thông tin thủ công.");
      setCustomerLookupActions({});
      renderCustomerSuggestionState(input, "error", "Không thể tải khách hàng. Vui lòng thử lại.");
    }
  }

  function showCachedCustomerLookup(input, source, query) {
    const customers = lastCompletedCustomers.slice();
    matchedCustomers = [];

    if (customers.length === 0) {
      customerMode = selectionNeedsVerification ? null : "new";
      renderCustomerSuggestionState(input, "empty", "Không tìm thấy khách hàng phù hợp.");
      setCustomerLookupActions({ showCreate: selectionNeedsVerification });
      return;
    }

    matchedCustomers = customers;
    customerMode = null;
    setCustomerLookupState("found", `Tìm thấy ${customers.length} khách hàng phù hợp.`);
    setCustomerLookupActions({ showCreate: true });
    renderCustomerSuggestions(input, customers);
  }

  function scheduleCustomerLookup(event) {
    const input = event.currentTarget;
    const source = customerLookupSource(input);
    const query = customerLookupQuery(input);
    const lookupKey = customerLookupKey(source, query);
    const minimumLength = CUSTOMER_SEARCH_MIN_LENGTH[source];

    activeCustomerLookupInput = input;
    activeCustomerLookupSource = source;
    invalidateSelectedCustomerIfNeeded();
    customerLookupRequestId += 1;
    cancelCustomerLookupRequest();
    matchedCustomers = [];
    clearCustomerSuggestionContent();
    closeCustomerSuggestions();

    if (query.length < minimumLength) {
      if (!selectionNeedsVerification) {
        customerMode = "new";
        setCustomerLookupActions({});
        setCustomerLookupState("", "Nhập tên hoặc số điện thoại để tìm khách hàng đã có.");
      }
      return;
    }

    if (lookupKey === lastCompletedLookupKey) {
      showCachedCustomerLookup(input, source, query);
      return;
    }

    const requestId = customerLookupRequestId;
    const controller = new AbortController();
    customerLookupAbortController = controller;
    isCustomerLookupPending = true;
    setCustomerLookupState("loading", "Đang tìm khách hàng…");
    renderCustomerSuggestionState(input, "loading", "Đang tìm khách hàng…");
    customerLookupTimer = window.setTimeout(() => {
      customerLookupTimer = null;
      runCustomerLookup(input, source, query, requestId, controller);
    }, CUSTOMER_LOOKUP_DELAY);
  }

  function handleCustomerLookupFocus(event) {
    const input = event.currentTarget;
    const source = customerLookupSource(input);
    const query = customerLookupQuery(input);

    activeCustomerLookupInput = input;
    activeCustomerLookupSource = source;

    if (
      query.length >= CUSTOMER_SEARCH_MIN_LENGTH[source]
      && customerLookupKey(source, query) === lastCompletedLookupKey
    ) {
      showCachedCustomerLookup(input, source, query);
    }
  }

  function handleCustomerLookupKeydown(event) {
    const isOpen = customerLookupResults && !customerLookupResults.hidden;
    const options = isOpen
      ? Array.from(customerLookupResults.querySelectorAll('[role="option"]'))
      : [];

    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      closeCustomerSuggestions({ cancelRequest: true });
      return;
    }

    if (event.key === "Tab") {
      closeCustomerSuggestions({ cancelRequest: true });
      return;
    }

    if (!isOpen || options.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      updateActiveCustomerOption(activeCustomerOptionIndex < 0 ? 0 : activeCustomerOptionIndex + 1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      updateActiveCustomerOption(activeCustomerOptionIndex < 0 ? options.length - 1 : activeCustomerOptionIndex - 1);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (activeCustomerOptionIndex >= 0) {
        setExistingCustomer(matchedCustomers[activeCustomerOptionIndex]);
      }
    }
  }

  function handleCustomerLookupDocumentPointer(event) {
    if (!customerLookupResults || customerLookupResults.hidden) {
      return;
    }

    if (!event.target.closest("[data-customer-autocomplete-field]")) {
      closeCustomerSuggestions({ cancelRequest: true });
    }
  }

  function resetCustomerLookup() {
    customerLookupRequestId += 1;
    cancelCustomerLookupRequest();
    activeCustomerLookupInput = null;
    activeCustomerLookupSource = null;
    activeCustomerOptionIndex = -1;
    lastCompletedLookupKey = "";
    lastCompletedCustomers = [];
    matchedCustomers = [];
    selectionNeedsVerification = false;
    customerMode = "new";
    clearSelectedCustomerState();
    clearCustomerSuggestionContent();
    closeCustomerSuggestions();
    setCustomerLookupActions({});
    setCustomerLookupState("", "Nhập tên hoặc số điện thoại để tìm khách hàng đã có.");
  }

  function ensureClientRequestId() {
    if (!currentClientRequestId) {
      if (!window.crypto || typeof window.crypto.randomUUID !== "function") {
        throw new Error("Trình duyệt không hỗ trợ crypto.randomUUID().");
      }

      currentClientRequestId = window.crypto.randomUUID();
    }

    return currentClientRequestId;
  }

  function getCustomerSubmitOptions() {
    const normalizedPhone = window.AMApi.normalizeVNPhone(customerPhoneInput.value);

    if (!normalizedPhone) {
      throw new Error("Số điện thoại khách hàng chưa hợp lệ.");
    }

    if (isCustomerLookupPending) {
      throw new Error("Đang kiểm tra khách hàng theo SĐT, vui lòng đợi trong giây lát.");
    }

    if (customerMode === "existing" && selectedCustomer) {
      if (
        !customerIdInput
        || customerIdInput.value !== String(selectedCustomer.id || "")
        || !customerCodeInput
        || customerCodeInput.value !== String(selectedCustomer.customer_code || "")
      ) {
        throw new Error("Thông tin khách hàng đã chọn không còn đồng nhất. Vui lòng chọn lại khách hàng.");
      }

      return {
        customerMode: "existing",
        existingCustomerId: selectedCustomer.id
      };
    }

    if (selectionNeedsVerification && customerMode !== "new") {
      throw new Error("Tên hoặc số điện thoại đã thay đổi. Hãy chọn lại khách phù hợp hoặc xác nhận tạo khách mới.");
    }

    if (matchedCustomers.length > 0 && customerMode !== "new") {
      throw new Error("Hãy chọn khách cũ hoặc chọn tạo người khác cùng SĐT trước khi tạo phiếu.");
    }

    return {
      customerMode: "new",
      existingCustomerId: null
    };
  }

  function setExistingCustomerFromCreatedTicket(created) {
    if (!created || !created.customer_id) {
      throw new Error("Phiếu đã tạo không trả về customer_id để tiếp tục đợt.");
    }

    selectedCustomer = {
      id: created.customer_id,
      customer_code: created.customer_code || "",
      name: created.customer_name || customerNameInput.value.trim(),
      phone: created.customer_phone || customerPhoneInput.value.trim(),
      address: customerAddressInput.value.trim()
    };
    customerMode = "existing";
    selectionNeedsVerification = false;
    matchedCustomers = [selectedCustomer];
    customerIdInput.value = selectedCustomer.id;
    customerCodeInput.value = selectedCustomer.customer_code;
    setCustomerLookupState(
      "success",
      `Đã khóa ${window.AMApi.formatCustomerCode(selectedCustomer.customer_code)} cho toàn bộ đợt tạo phiếu.`
    );
    setCustomerLookupActions({ showHistory: true });
  }

  function getSharedCustomerData() {
    return {
      customer_name: customerNameInput.value.trim(),
      customer_phone: customerPhoneInput.value.trim(),
      customer_address: customerAddressInput.value.trim()
    };
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

  function fillStatusOptions() {
    statusSelect.innerHTML = "";

    window.AMApi.CREATABLE_TICKET_STATUSES.forEach((status) => {
      const option = document.createElement("option");
      option.value = status;
      option.textContent = status;
      statusSelect.appendChild(option);
    });
  }

  function setDefaultDate() {
    form.received_date.value = new Date().toISOString().slice(0, 10);
    form.status.value = "mới nhận";
    form.device_type.value = "Tivi";
  }

  function collectFormData() {
    return Object.fromEntries(new FormData(form).entries());
  }

  function showCreatedActions(ticket) {
    const code = encodeURIComponent(ticket.ticket_code);
    printCreatedLink.href = `print-label.html?code=${code}`;
    printReceiptCreatedLink.href = `print-delivery-receipt.html?code=${code}`;
    viewCreatedLink.href = `search.html?code=${code}`;
    createdActions.classList.remove("hidden");
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    clearNotice();
    isSubmitting = true;
    setLoading(true);
    let createdSuccessfully = false;

    try {
      const customerOptions = getCustomerSubmitOptions();
      const created = await window.AMApi.createTicket(collectFormData(), {
        clientRequestId: ensureClientRequestId(),
        customerMode: customerOptions.customerMode,
        existingCustomerId: customerOptions.existingCustomerId
      });
      createdSuccessfully = true;
      currentClientRequestId = null;
      showNotice(
        "success",
        created.was_replayed
          ? `Đã lấy lại phiếu ${window.AMApi.formatTicketCode(created.ticket_code)} từ lần gửi trước.`
          : `Đã tạo phiếu ${window.AMApi.formatTicketCode(created.ticket_code)}.`
      );
      if (window.AMUI && typeof window.AMUI.toast === "function") {
        window.AMUI.toast(
          created.was_replayed
            ? `Đã khôi phục phiếu ${window.AMApi.formatTicketCode(created.ticket_code)} từ lần gửi trước.`
            : `Đã tạo phiếu ${window.AMApi.formatTicketCode(created.ticket_code)}.`,
          { type: "success" }
        );
      }
      showCreatedActions(created);
      form.querySelectorAll("input, textarea, select, button").forEach((field) => {
        if (field.type !== "button") {
          field.disabled = true;
        }
      });
    } catch (error) {
      showNotice("error", error.message);
    } finally {
      if (createdSuccessfully) {
        form.setAttribute("aria-busy", "false");
        if (window.AMUI && typeof window.AMUI.setButtonBusy === "function") {
          window.AMUI.setButtonBusy(createButton, false, { idleText: "Đã tạo phiếu" });
        }
        createButton.disabled = true;
        createButton.textContent = "Đã tạo phiếu";
      } else {
        setLoading(false);
      }

      isSubmitting = false;
    }
  }

  function resetForNewTicket() {
    form.reset();
    form.querySelectorAll("input, textarea, select, button").forEach((field) => {
      field.disabled = false;
    });
    currentClientRequestId = null;
    isSubmitting = false;
    resetCustomerLookup();
    setDefaultDate();
    if (deviceAssist) {
      deviceAssist.reset();
    }
    conditionAssists.forEach((assist) => assist.reset());
    createdActions.classList.add("hidden");
    clearNotice();
  }

  function resetDeviceAssists() {
    if (deviceAssist) {
      deviceAssist.reset();
    }

    conditionAssists.forEach((assist) => assist.reset());
  }

  async function initNewTicket() {
    attachLogout();
    fillStatusOptions();
    setDefaultDate();
    if (window.AMMoneyUtils && typeof window.AMMoneyUtils.attachInputs === "function") {
      window.AMMoneyUtils.attachInputs(form);
    }
    if (window.AMTvUtils && typeof window.AMTvUtils.attachTvModelAssist === "function") {
      deviceAssist = window.AMTvUtils.attachTvModelAssist({
        brandInput,
        modelInput,
        sizeInput,
        brandListElement: brandList,
        hintElement: sizeAssistHint
      });
    }
    if (window.AMTvConditionUtils && typeof window.AMTvConditionUtils.attachConditionPicker === "function") {
      conditionAssists = [
        window.AMTvConditionUtils.attachConditionPicker({
          type: "machine",
          label: "Chọn nhanh tình trạng máy",
          textarea: conditionTextInput,
          container: machineConditionPicker
        }),
        window.AMTvConditionUtils.attachConditionPicker({
          type: "appearance",
          label: "Chọn nhanh ngoại quan",
          textarea: externalConditionInput,
          container: appearanceConditionPicker
        })
      ].filter(Boolean);
    }

    try {
      const access = await window.AMApi.requireInternalAccess();
      if (!access) {
        return;
      }

      form.addEventListener("submit", handleSubmit);
      form.addEventListener("reset", function () {
        currentClientRequestId = null;
        resetCustomerLookup();
        setTimeout(() => {
          setDefaultDate();
          if (deviceAssist) {
            deviceAssist.reset();
          }
          conditionAssists.forEach((assist) => assist.reset());
        }, 0);
      });

      if (form.dataset.customerAutocompleteAttached !== "true") {
        form.dataset.customerAutocompleteAttached = "true";
        customerLookupInputs().forEach((input) => {
          input.addEventListener("input", scheduleCustomerLookup);
          input.addEventListener("focus", handleCustomerLookupFocus);
          input.addEventListener("keydown", handleCustomerLookupKeydown);
        });
        customerCreateNewButton.addEventListener("click", () => {
          setNewCustomerMode("Đã xác nhận dùng thông tin hiện tại để tạo khách hàng mới.");
        });
        customerHistoryButton.addEventListener("click", () => {
          if (selectedCustomer) {
            showCustomerHistory(selectedCustomer);
          }
        });
        document.addEventListener("pointerdown", handleCustomerLookupDocumentPointer);
        window.addEventListener("pagehide", cancelCustomerLookupRequest, { once: true });
      }

      newTicketButton.addEventListener("click", resetForNewTicket);
    } catch (error) {
      showNotice("error", error.message);
    }
  }

  window.AMNewTicket = Object.freeze({
    clearNotice,
    getCustomerSubmitOptions,
    getSharedCustomerData,
    resetCustomerLookup,
    resetDeviceAssists,
    resetForNewTicket,
    setExistingCustomerFromCreatedTicket,
    showNotice
  });

  document.addEventListener("DOMContentLoaded", initNewTicket);
})();

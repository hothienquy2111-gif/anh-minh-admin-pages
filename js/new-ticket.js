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
  const customerLookupState = document.getElementById("customerLookupState");
  const customerLookupResults = document.getElementById("customerLookupResults");
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

  const CUSTOMER_LOOKUP_DELAY = 420;
  let customerLookupTimer = null;
  let customerLookupRequestId = 0;
  let matchedCustomers = [];
  let selectedCustomer = null;
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

  function clearCustomerLookupResults() {
    if (customerLookupResults) {
      customerLookupResults.innerHTML = "";
    }

    resetCustomerHistory();
  }

  function createCustomerMeta(label, value) {
    const item = document.createElement("span");
    const key = document.createElement("b");
    const val = document.createElement("span");

    key.textContent = `${label}: `;
    val.textContent = textOrDash(value);
    item.append(key, val);
    return item;
  }

  function fillCustomerFields(customer) {
    customerNameInput.value = customer.name || "";
    customerPhoneInput.value = customer.phone || customerPhoneInput.value;
    customerAddressInput.value = customer.address || "";
  }

  function setExistingCustomer(customer) {
    selectedCustomer = customer;
    customerMode = "existing";
    fillCustomerFields(customer);
    resetCustomerHistory();
    setCustomerLookupState(
      "selected",
      `Đã chọn ${customer.customer_code || "khách hàng"} - ${customer.name || "khách hàng cũ"}. Phiếu mới sẽ lưu snapshot hiện tại.`
    );
    renderCustomerMatches(matchedCustomers);
  }

  function setNewCustomerMode(message) {
    selectedCustomer = null;
    customerMode = "new";
    resetCustomerHistory();
    setCustomerLookupState("new", message || "Khách hàng mới. Phiếu sẽ tạo customer mới và gắn customer_id.");
    renderCustomerMatches(matchedCustomers);
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
      title.textContent = `Lịch sử ${customer.customer_code || ""} - ${tickets.length} phiếu`;
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
        link.textContent = `${ticket.ticket_code || "Chưa có mã"} - ${ticket.model || "Chưa có model"} - ${formatDate(ticket.received_date)}`;
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

  function renderCustomerMatches(customers) {
    if (!customerLookupResults) {
      return;
    }

    customerLookupResults.innerHTML = "";

    customers.forEach((customer) => {
      const card = document.createElement("article");
      const header = document.createElement("div");
      const title = document.createElement("strong");
      const code = document.createElement("span");
      const meta = document.createElement("div");
      const actions = document.createElement("div");
      const useButton = document.createElement("button");
      const historyButton = document.createElement("button");
      const isSelected = selectedCustomer && selectedCustomer.id === customer.id;

      card.className = `customer-match-card ${isSelected ? "selected" : ""}`.trim();
      header.className = "customer-match-header";
      meta.className = "customer-match-meta";
      actions.className = "customer-match-actions";

      title.textContent = textOrDash(customer.name);
      code.textContent = customer.customer_code || "Chưa có mã KH";
      header.append(title, code);

      meta.append(
        createCustomerMeta("SĐT", customer.phone),
        createCustomerMeta("Địa chỉ", customer.address),
        createCustomerMeta("Số phiếu", customer.ticket_count || 0),
        createCustomerMeta("Phiếu gần nhất", customer.latest_ticket && customer.latest_ticket.ticket_code)
      );

      useButton.type = "button";
      useButton.className = "btn primary compact";
      useButton.textContent = isSelected ? "Đang dùng" : "Dùng khách này";
      useButton.disabled = isSelected;
      useButton.addEventListener("click", () => setExistingCustomer(customer));

      historyButton.type = "button";
      historyButton.className = "btn secondary compact";
      historyButton.textContent = "Xem lịch sử";
      historyButton.addEventListener("click", () => showCustomerHistory(customer));

      actions.append(useButton, historyButton);
      card.append(header, meta, actions);
      customerLookupResults.appendChild(card);
    });

    if (customers.length > 0) {
      const createOther = document.createElement("button");
      createOther.type = "button";
      createOther.className = "btn secondary compact customer-create-other";
      createOther.textContent = "Tạo người khác cùng SĐT";
      createOther.addEventListener("click", () => setNewCustomerMode("Đang tạo người khác cùng số điện thoại. Customer cũ sẽ không bị ghi đè."));
      customerLookupResults.appendChild(createOther);
    }
  }

  async function runCustomerLookup(phone, requestId) {
    try {
      setCustomerLookupState("loading", "Đang tìm khách hàng theo số điện thoại...");
      const customers = await window.AMApi.findCustomersByPhone(phone);

      if (requestId !== customerLookupRequestId) {
        return;
      }

      isCustomerLookupPending = false;
      matchedCustomers = customers;
      selectedCustomer = null;
      resetCustomerHistory();

      if (customers.length === 0) {
        setNewCustomerMode("Khách hàng mới. Khi tạo phiếu sẽ tạo mã KH mới.");
        return;
      }

      customerMode = null;
      setCustomerLookupState(
        "found",
        customers.length === 1
          ? "Tìm thấy 1 khách hàng. Hãy xác nhận dùng khách này hoặc tạo người khác cùng SĐT."
          : `Tìm thấy ${customers.length} khách hàng dùng chung SĐT. Hãy chọn đúng khách.`
      );
      renderCustomerMatches(customers);
    } catch (error) {
      if (requestId !== customerLookupRequestId) {
        return;
      }

      isCustomerLookupPending = false;
      selectedCustomer = null;
      customerMode = null;
      matchedCustomers = [];
      clearCustomerLookupResults();
      setCustomerLookupState("error", error.message);
    }
  }

  function scheduleCustomerLookup() {
    const phone = customerPhoneInput.value;
    const normalizedPhone = window.AMApi.normalizeVNPhone(phone);

    selectedCustomer = null;
    customerMode = normalizedPhone ? "new" : null;
    matchedCustomers = [];
    clearCustomerLookupResults();

    if (customerLookupTimer) {
      window.clearTimeout(customerLookupTimer);
    }

    customerLookupRequestId += 1;

    if (!String(phone || "").trim()) {
      isCustomerLookupPending = false;
      setCustomerLookupState("", "Nhập số điện thoại hợp lệ để nhận diện khách hàng.");
      return;
    }

    if (!normalizedPhone) {
      isCustomerLookupPending = false;
      setCustomerLookupState("warning", "Số điện thoại chưa hợp lệ, chưa tìm khách hàng.");
      return;
    }

    const requestId = customerLookupRequestId;
    isCustomerLookupPending = true;
    customerLookupTimer = window.setTimeout(() => {
      runCustomerLookup(normalizedPhone, requestId);
    }, CUSTOMER_LOOKUP_DELAY);
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
      return {
        customerMode: "existing",
        existingCustomerId: selectedCustomer.id
      };
    }

    if (matchedCustomers.length > 0 && customerMode !== "new") {
      throw new Error("Hãy chọn khách cũ hoặc chọn tạo người khác cùng SĐT trước khi tạo phiếu.");
    }

    return {
      customerMode: "new",
      existingCustomerId: null
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
          ? `Đã lấy lại phiếu ${created.ticket_code} từ lần gửi trước.`
          : `Đã tạo phiếu ${created.ticket_code}.`
      );
      if (window.AMUI && typeof window.AMUI.toast === "function") {
        window.AMUI.toast(
          created.was_replayed
            ? `Đã khôi phục phiếu ${created.ticket_code} từ lần gửi trước.`
            : `Đã tạo phiếu ${created.ticket_code}.`,
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
    selectedCustomer = null;
    matchedCustomers = [];
    customerMode = "new";
    isCustomerLookupPending = false;
    clearCustomerLookupResults();
    setCustomerLookupState("", "Nhập số điện thoại hợp lệ để nhận diện khách hàng.");
    setDefaultDate();
    if (deviceAssist) {
      deviceAssist.reset();
    }
    conditionAssists.forEach((assist) => assist.reset());
    createdActions.classList.add("hidden");
    clearNotice();
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
        selectedCustomer = null;
        matchedCustomers = [];
        customerMode = "new";
        isCustomerLookupPending = false;
        clearCustomerLookupResults();
        setCustomerLookupState("", "Nhập số điện thoại hợp lệ để nhận diện khách hàng.");
        setTimeout(() => {
          setDefaultDate();
          if (deviceAssist) {
            deviceAssist.reset();
          }
          conditionAssists.forEach((assist) => assist.reset());
        }, 0);
      });
      customerPhoneInput.addEventListener("input", scheduleCustomerLookup);
      newTicketButton.addEventListener("click", resetForNewTicket);
    } catch (error) {
      showNotice("error", error.message);
    }
  }

  document.addEventListener("DOMContentLoaded", initNewTicket);
})();

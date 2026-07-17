(function () {
  "use strict";

  const notice = document.getElementById("labelNotice");
  const labelCode = document.getElementById("labelCode");
  const labelModel = document.getElementById("labelModel");
  const labelCondition = document.getElementById("labelCondition");
  const labelDate = document.getElementById("labelDate");
  const printButton = document.getElementById("printButton");
  const labelSizeSelect = document.getElementById("labelSizeSelect");
  const thermalLabel = document.getElementById("thermalLabel");
  const workflowHint = document.getElementById("labelWorkflowHint");
  let currentTicket = null;
  let currentWorkflowAction = null;

  const LABEL_SIZES = {
    "50x30": { className: "label-50x30", width: "50mm", height: "30mm" },
    "58x40": { className: "label-58x40", width: "58mm", height: "40mm" },
    "58x30": { className: "label-58x30", width: "58mm", height: "30mm" },
    "80x50": { className: "label-80x50", width: "80mm", height: "50mm" }
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

  function renderLabel(ticket) {
    labelCode.textContent = textOrBlank(ticket.ticket_code);
    labelModel.textContent = textOrBlank(ticket.model);
    labelCondition.textContent = textOrBlank(ticket.condition_text);
    labelDate.textContent = formatDate(ticket.received_date);
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
        completed_at: result.completed_at,
        last_activity_at: result.activity_created_at,
        workflow_available: true
      });

      renderWorkflowControls(currentTicket);
      if (action === "START_REPAIR") {
        showNotice("success", "Phiếu đã chuyển trạng thái. Trường hợp chưa in được, hãy dùng chức năng Chỉ in lại.");
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
    const selected = LABEL_SIZES[value] || LABEL_SIZES["50x30"];
    const classNames = Object.values(LABEL_SIZES).map((size) => size.className);

    document.body.classList.remove(...classNames);
    thermalLabel.classList.remove(...classNames);
    document.body.classList.add(selected.className);
    thermalLabel.classList.add(selected.className);
    syncPageSize(selected);
  }

  function attachPaperControls() {
    applyLabelSize(labelSizeSelect ? labelSizeSelect.value : "50x30");

    if (!labelSizeSelect) {
      return;
    }

    labelSizeSelect.addEventListener("change", function () {
      applyLabelSize(labelSizeSelect.value);
    });
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

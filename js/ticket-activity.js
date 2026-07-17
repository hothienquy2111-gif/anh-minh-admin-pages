(function () {
  "use strict";

  const notice = document.getElementById("ticketActivityNotice");
  const workflow = {
    section: document.getElementById("workflowSection"),
    state: document.getElementById("workflowState"),
    content: document.getElementById("workflowContent"),
    tableBody: document.getElementById("workflowTableBody"),
    cards: document.getElementById("workflowCards")
  };

  const WORKFLOW_MAX_ITEMS = 20;
  const WORKFLOW_PRE_REPAIR_STATUSES = ["mới nhận", "đang kiểm tra", "báo giá"];
  let workflowRequestId = 0;

  function showNotice(type, message) {
    if (!notice) {
      return;
    }

    notice.className = `notice ${type} show`;
    notice.textContent = message;
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

  function textOrDash(value) {
    const text = String(value || "").trim();
    return text || "—";
  }

  function parseTicketTime(value) {
    if (!value) {
      return 0;
    }

    const date = String(value).includes("T")
      ? new Date(value)
      : new Date(`${value}T00:00:00`);

    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }

  function elapsedParts(milliseconds) {
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

  function timeFrom(value) {
    const time = parseTicketTime(value);
    return time ? Date.now() - time : 0;
  }

  function statusClass(status) {
    const normalized = String(status || "").toLowerCase();
    const classes = {
      "mới nhận": "status-new",
      "đang kiểm tra": "status-checking",
      "báo giá": "status-quote",
      "đang sửa": "status-repairing",
      "đã xong": "status-done",
      "đã trả": "status-returned",
      "huỷ": "status-cancelled"
    };

    return classes[normalized] || "";
  }

  function statusLabel(status) {
    if (status === "đã trả") {
      return "Đã hoàn thành";
    }

    if (status === "đã xong") {
      return "Legacy đã xong";
    }

    return textOrDash(status);
  }

  function canStartRepair(ticket) {
    return WORKFLOW_PRE_REPAIR_STATUSES.includes(ticket.status)
      && !ticket.repair_started_at
      && !ticket.completed_at;
  }

  function canPrintAndComplete(ticket) {
    return ticket.status === "đang sửa"
      && Boolean(ticket.repair_started_at)
      && !ticket.completed_at;
  }

  function canReprintLabel(ticket) {
    return Boolean(ticket.repair_started_at) && ticket.status !== "huỷ";
  }

  function canReprintReceipt(ticket) {
    return ticket.status === "đã trả" && Boolean(ticket.completed_at);
  }

  function workflowPriority(ticket) {
    if (ticket.status === "đang sửa" && ticket.repair_started_at) {
      const waited = timeFrom(ticket.repair_started_at);

      if (waited >= 48 * 60 * 60 * 1000) {
        return { rank: 1, className: "priority-overdue", label: "Sửa chữa quá hạn", wait: waited };
      }

      return {
        rank: 2,
        className: "priority-repairing",
        label: "Đang sửa",
        wait: waited
      };
    }

    if (WORKFLOW_PRE_REPAIR_STATUSES.includes(ticket.status)) {
      return {
        rank: 3,
        className: "priority-neutral",
        label: "Chưa bắt đầu sửa",
        wait: timeFrom(ticket.created_at)
      };
    }

    return {
      rank: 4,
      className: "priority-neutral",
      label: ticket.status === "đã xong" ? "Dữ liệu workflow cũ" : ticket.status === "huỷ" ? "Đã huỷ" : "Hoạt động gần đây",
      wait: timeFrom(ticket.last_activity_at || ticket.created_at)
    };
  }

  function workflowActivityText(ticket) {
    if (ticket.status === "đã trả") {
      return "Đã hoàn thành";
    }

    if (ticket.status === "đã xong") {
      return "Dữ liệu workflow cũ chưa đầy đủ";
    }

    if (ticket.status === "đang sửa") {
      return "Đang sửa chữa";
    }

    if (ticket.status === "huỷ") {
      return "Phiếu đã huỷ";
    }

    return "Chưa bắt đầu sửa";
  }

  function workflowWaitText(ticket) {
    const priority = workflowPriority(ticket);

    if (priority.rank === 1) {
      return `${priority.label} — ${elapsedParts(priority.wait)}`;
    }

    if (priority.rank === 2) {
      return `Đang sửa — ${elapsedParts(priority.wait)}`;
    }

    return priority.label;
  }

  function createCell(text, className) {
    const cell = document.createElement("td");
    cell.textContent = text;

    if (className) {
      cell.className = className;
    }

    return cell;
  }

  function createStatusBadge(status) {
    const badge = document.createElement("span");
    badge.className = `status-pill ${statusClass(status)}`.trim();
    badge.textContent = statusLabel(status);
    return badge;
  }

  function createPriorityBadge(ticket) {
    const priority = workflowPriority(ticket);
    const badge = document.createElement("span");
    badge.className = `workflow-priority ${priority.className}`;
    badge.textContent = priority.rank === 1 || priority.rank === 2
      ? `! ${priority.label}`
      : priority.label;
    return badge;
  }

  function createWorkflowLink(label, href, primary) {
    const link = document.createElement("a");
    link.className = `btn ${primary ? "primary" : "secondary"} compact workflow-action`;
    link.textContent = label;
    link.href = href;
    return link;
  }

  function createWorkflowActions(ticket) {
    const actions = document.createElement("div");
    const code = encodeURIComponent(ticket.ticket_code || "");
    const id = encodeURIComponent(ticket.id || "");
    const ticketQuery = ticket.ticket_code ? `code=${code}` : `id=${id}`;

    actions.className = "workflow-actions ticket-activity-actions";

    if (canStartRepair(ticket)) {
      actions.appendChild(createWorkflowLink("In tem & bắt đầu sửa chữa", `print-label.html?${ticketQuery}`, true));
    } else if (canPrintAndComplete(ticket)) {
      actions.appendChild(createWorkflowLink("In biên nhận & hoàn thành phiếu", `print-delivery-receipt.html?${ticketQuery}`, true));
      actions.appendChild(createWorkflowLink("Chỉ in lại tem", `print-label.html?${ticketQuery}`, false));
    } else if (canReprintReceipt(ticket)) {
      actions.appendChild(createWorkflowLink("Chỉ in lại biên nhận", `print-delivery-receipt.html?${ticketQuery}`, false));
    } else if (ticket.status === "đã xong") {
      const note = document.createElement("span");
      note.className = "workflow-inline-note";
      note.textContent = "Dữ liệu workflow cũ cần xử lý thủ công";
      actions.appendChild(note);
    } else if (canReprintLabel(ticket)) {
      actions.appendChild(createWorkflowLink("Chỉ in lại tem", `print-label.html?${ticketQuery}`, false));
    }

    actions.appendChild(createWorkflowLink("Xem phiếu", `search.html?${ticketQuery}`, false));
    return actions;
  }

  function setWorkflowState(type, message) {
    if (!workflow.state || !workflow.content) {
      return;
    }

    workflow.state.textContent = message;
    window.AMUI.setSectionState({
      section: workflow.section,
      stateElement: workflow.state,
      dataElement: workflow.content
    }, type);
  }

  function setWorkflowLoading() {
    const hasVisibleData = !workflow.content.hidden && workflow.tableBody.childElementCount > 0;

    if (hasVisibleData) {
      workflow.state.textContent = "";
      window.AMUI.setSectionState({
        section: workflow.section,
        stateElement: workflow.state,
        dataElement: workflow.content
      }, "refreshing");
      return;
    }

    setWorkflowState("loading", "Đang tải hoạt động của phiếu...");
  }

  function showWorkflowContent() {
    workflow.state.textContent = "";
    window.AMUI.setSectionState({
      section: workflow.section,
      stateElement: workflow.state,
      dataElement: workflow.content
    }, "data");
  }

  function sortWorkflowTickets(tickets) {
    return (tickets || []).slice().sort((a, b) => {
      const pa = workflowPriority(a);
      const pb = workflowPriority(b);
      const aTie = String(a.ticket_code || a.id || "");
      const bTie = String(b.ticket_code || b.id || "");

      if (pa.rank !== pb.rank) {
        return pa.rank - pb.rank;
      }

      if (pa.rank === 1 || pa.rank === 2 || pa.rank === 3) {
        const waitDiff = pb.wait - pa.wait;
        return waitDiff || bTie.localeCompare(aTie, "vi", { numeric: true });
      }

      const timeDiff = parseTicketTime(b.last_activity_at || b.created_at) - parseTicketTime(a.last_activity_at || a.created_at);
      return timeDiff || bTie.localeCompare(aTie, "vi", { numeric: true });
    });
  }

  function renderWorkflowRows(tickets) {
    workflow.tableBody.innerHTML = "";

    tickets.forEach((ticket) => {
      const row = document.createElement("tr");
      const priorityCell = document.createElement("td");
      const statusCell = document.createElement("td");
      const actionCell = document.createElement("td");
      row.dataset.ticketCode = ticket.ticket_code || "";
      actionCell.className = "ticket-activity-action-cell";

      priorityCell.appendChild(createPriorityBadge(ticket));
      statusCell.appendChild(createStatusBadge(ticket.status));
      actionCell.appendChild(createWorkflowActions(ticket));

      row.append(
        priorityCell,
        createCell(textOrDash(ticket.ticket_code), "workflow-ticket-code"),
        createCell(textOrDash(ticket.customer_code), "workflow-customer-code"),
        createCell(textOrDash(ticket.customer_name || ticket.customer_master_name), "workflow-customer-name"),
        createCell(textOrDash(ticket.model)),
        createCell(workflowActivityText(ticket)),
        createCell(workflowWaitText(ticket), "workflow-wait"),
        statusCell,
        actionCell
      );

      workflow.tableBody.appendChild(row);
    });
  }

  function createWorkflowMeta(label, value) {
    const item = document.createElement("div");
    const key = document.createElement("span");
    const val = document.createElement("strong");

    key.textContent = label;
    val.textContent = textOrDash(value);
    item.append(key, val);
    return item;
  }

  function renderWorkflowCards(tickets) {
    workflow.cards.innerHTML = "";

    tickets.forEach((ticket) => {
      const card = document.createElement("article");
      const top = document.createElement("div");
      const title = document.createElement("div");
      const code = document.createElement("strong");
      const customer = document.createElement("span");
      const meta = document.createElement("div");

      card.className = "workflow-card";
      card.dataset.ticketCode = ticket.ticket_code || "";
      top.className = "workflow-card-top";
      title.className = "workflow-card-title";
      meta.className = "workflow-card-meta";

      code.textContent = textOrDash(ticket.ticket_code);
      customer.textContent = `${textOrDash(ticket.customer_code)} · ${textOrDash(ticket.customer_name || ticket.customer_master_name)}`;
      title.append(code, customer);
      top.append(title, createPriorityBadge(ticket));

      meta.append(
        createWorkflowMeta("Model", ticket.model),
        createWorkflowMeta("Hoạt động", workflowActivityText(ticket)),
        createWorkflowMeta("Thời gian", workflowWaitText(ticket)),
        createWorkflowMeta("Trạng thái", ticket.status)
      );

      card.append(top, meta, createWorkflowActions(ticket));
      workflow.cards.appendChild(card);
    });
  }

  function renderWorkflow(tickets) {
    const visibleTickets = sortWorkflowTickets(tickets)
      .filter((ticket) => ticket.status === "đang sửa" && ticket.repair_started_at && !ticket.completed_at)
      .slice(0, WORKFLOW_MAX_ITEMS);

    if (visibleTickets.length === 0) {
      setWorkflowState("empty", "Chưa có phiếu đang sửa cần theo dõi.");
      return;
    }

    renderWorkflowRows(visibleTickets);
    renderWorkflowCards(visibleTickets);
    showWorkflowContent();

    const requestedCode = new URLSearchParams(window.location.search).get("code");
    if (requestedCode) {
      const match = Array.from(workflow.section.querySelectorAll("[data-ticket-code]"))
        .find((element) => element.dataset.ticketCode === requestedCode);
      if (match) {
        match.classList.add("workflow-focus-ticket");
        const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.setTimeout(() => match.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" }), 0);
      }
    }
  }

  async function loadWorkflowTickets() {
    if (!workflow.section) {
      return;
    }

    const requestId = ++workflowRequestId;
    setWorkflowLoading();

    try {
      const result = await window.AMApi.getDashboardWorkflowTickets(WORKFLOW_MAX_ITEMS);

      if (requestId !== workflowRequestId) {
        return;
      }

      if (!result.available) {
        setWorkflowState("info", result.message || "Workflow chưa được kích hoạt.");
        return;
      }

      renderWorkflow(result.tickets || []);
    } catch (error) {
      if (requestId !== workflowRequestId) {
        return;
      }

      setWorkflowState("error", "Không tải được hoạt động của phiếu. Vui lòng thử lại.");
    } finally {
      if (requestId === workflowRequestId) {
        workflow.section.setAttribute("aria-busy", "false");
      }
    }
  }

  async function initTicketActivity() {
    attachLogout();

    try {
      const access = await window.AMApi.requireInternalAccess();
      if (!access) {
        return;
      }

      await loadWorkflowTickets();
    } catch (error) {
      showNotice("error", error.message);
    }
  }

  document.addEventListener("DOMContentLoaded", initTicketActivity);
})();

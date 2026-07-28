(function () {
  "use strict";

  const notice = document.getElementById("ticketActivityNotice");
  const workflow = {
    section: document.getElementById("workflowSection"),
    form: document.getElementById("workflowSearchForm"),
    searchInput: document.getElementById("workflowSearchInput"),
    clearButton: document.getElementById("workflowSearchClear"),
    filters: document.getElementById("workflowStatusFilters"),
    refreshing: document.getElementById("workflowRefreshIndicator"),
    state: document.getElementById("workflowState"),
    content: document.getElementById("workflowContent"),
    listSummary: document.getElementById("workflowListSummary"),
    tableBody: document.getElementById("workflowTableBody"),
    cards: document.getElementById("workflowCards"),
    pagination: document.getElementById("workflowPagination")
  };

  const PAGE_SIZE = 8;
  const SEARCH_DELAY = 280;
  const PRE_REPAIR_STATUSES = Array.isArray(window.AMApi && window.AMApi.PRE_REPAIR_STATUSES)
    ? window.AMApi.PRE_REPAIR_STATUSES
    : ["mới nhận", "đang kiểm tra", "báo giá"];
  let workflowRequestId = 0;
  let totalCount = 0;
  let totalPages = 1;
  let searchTimer = null;
  let visibleTickets = [];
  let actionMenu = null;
  let actionMenuTrigger = null;
  let actionMenuTriggerSerial = 0;
  const ACTION_MENU_ID = "ticketActivityActionMenu";
  const state = {
    page: 1,
    keyword: "",
    filter: "all"
  };

  function showNotice(type, message) {
    if (!notice) {
      return;
    }

    notice.className = `notice ${type} show`;
    notice.textContent = message;
  }

  function attachLogout() {
    document.querySelectorAll("[data-logout]").forEach((button) => {
      if (button.dataset.logoutReady === "true") {
        return;
      }

      button.dataset.logoutReady = "true";
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
    const time = Date.parse(String(value || ""));
    return Number.isFinite(time) ? time : 0;
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
    return time ? Math.max(0, Date.now() - time) : 0;
  }

  function statusClass(status) {
    const classes = {
      "mới nhận": "status-new",
      "đang kiểm tra": "status-checking",
      "báo giá": "status-quote",
      "đang sửa": "status-repairing",
      "chờ bàn giao": "status-handover",
      "đã xong": "status-done",
      "đã trả": "status-returned",
      "huỷ": "status-cancelled"
    };

    return classes[String(status || "").toLowerCase()] || "";
  }

  function statusLabel(status) {
    return window.AMApi.formatTicketStatusLabel(status, "—");
  }

  function canStartRepair(ticket) {
    return PRE_REPAIR_STATUSES.includes(ticket.status)
      && !ticket.repair_started_at
      && !ticket.completed_at;
  }

  function canReadyForHandover(ticket) {
    return ticket.status === "đang sửa"
      && Boolean(ticket.repair_started_at)
      && !ticket.ready_for_handover_at
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

      return { rank: 2, className: "priority-repairing", label: "Đang sửa", wait: waited };
    }

    if (PRE_REPAIR_STATUSES.includes(ticket.status)) {
      return { rank: 3, className: "priority-neutral", label: "Đang xử lý", wait: timeFrom(ticket.created_at) };
    }

    if (ticket.status === "chờ bàn giao") {
      return { rank: 4, className: "priority-handover", label: "Chờ bàn giao", wait: timeFrom(ticket.ready_for_handover_at) };
    }

    return {
      rank: 5,
      className: "priority-neutral",
      label: ticket.status === "đã trả" ? "Đã bàn giao" : ticket.status === "huỷ" ? "Đã huỷ" : "Hoạt động khác",
      wait: timeFrom(ticket.last_activity_at || ticket.created_at)
    };
  }

  function workflowActivityText(ticket) {
    if (ticket.status === "đã trả") {
      return "Đã hoàn tất bàn giao";
    }

    if (ticket.status === "chờ bàn giao") {
      return "Đã kết thúc sửa chữa, đang chờ bàn giao";
    }

    if (ticket.status === "đang sửa") {
      return "Đang sửa chữa";
    }

    if (ticket.status === "đã xong") {
      return "Dữ liệu workflow cũ";
    }

    if (ticket.status === "huỷ") {
      return "Phiếu đã huỷ";
    }

    return "Đang tiếp nhận và kiểm tra";
  }

  function repairResultText(ticket) {
    const note = String(ticket.internal_note || "");
    const returnMarker = "[Kết quả sửa chữa: Giao trả]";
    const returnLine = note
      .split(/\r?\n/)
      .reverse()
      .find((line) => line.trim().startsWith(returnMarker));

    if (returnLine) {
      const recordedValue = returnLine.trim().slice(returnMarker.length).trim();
      const reason = recordedValue.split(/\s+—\s+/)[0].trim();
      return reason ? `Giao trả — ${reason}` : "Giao trả sửa chữa";
    }

    if (["chờ bàn giao", "đã trả"].includes(ticket.status) && ticket.ready_for_handover_at) {
      return "Đã sửa hoàn tất";
    }

    if (ticket.status === "đang sửa") {
      return "Đang xử lý";
    }

    return "Chưa có kết quả";
  }

  function latestUpdateTime(ticket) {
    return ticket.last_activity_at
      || ticket.updated_at
      || ticket.ready_for_handover_at
      || ticket.repair_started_at
      || ticket.created_at;
  }

  function relativeUpdateText(value) {
    const time = parseTicketTime(value);

    if (!time) {
      return "Chưa có mốc cập nhật";
    }

    const elapsed = Math.max(0, Date.now() - time);
    const minutes = Math.floor(elapsed / 60000);

    if (minutes < 1) {
      return "Vừa cập nhật";
    }

    if (minutes < 60) {
      return `Cập nhật ${minutes} phút trước`;
    }

    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `Cập nhật ${hours} giờ trước`;
    }

    return `Cập nhật ${Math.floor(hours / 24)} ngày trước`;
  }

  function workflowActivityDetails(ticket) {
    const workflowText = workflowActivityText(ticket);
    const resultText = repairResultText(ticket);
    let mainText = resultText;

    if (ticket.status === "đã trả") {
      mainText = "Đã hoàn tất bàn giao";
    } else if (resultText === "Chưa có kết quả") {
      mainText = workflowText;
    }

    return {
      mainText,
      relativeText: relativeUpdateText(latestUpdateTime(ticket)),
      title: `${workflowText} · ${resultText}`
    };
  }

  function workflowWaitDetails(ticket) {
    const priority = workflowPriority(ticket);

    if (priority.rank === 1) {
      const overdue = Math.max(0, priority.wait - 48 * 60 * 60 * 1000);
      return {
        mainText: elapsedParts(priority.wait),
        detailText: overdue > 0 ? `Quá hạn ${elapsedParts(overdue)}` : "Quá hạn 48 giờ",
        overdue: true
      };
    }

    if (priority.rank === 2) {
      return {
        mainText: elapsedParts(priority.wait),
        detailText: "Đang sửa",
        overdue: false
      };
    }

    if (ticket.status === "chờ bàn giao" && ticket.ready_for_handover_at) {
      return {
        mainText: elapsedParts(timeFrom(ticket.ready_for_handover_at)),
        detailText: "Chờ bàn giao",
        overdue: false
      };
    }

    if (priority.wait > 0 && PRE_REPAIR_STATUSES.includes(ticket.status)) {
      return {
        mainText: elapsedParts(priority.wait),
        detailText: priority.label,
        overdue: false
      };
    }

    return {
      mainText: priority.label || "—",
      detailText: "",
      overdue: false
    };
  }

  function formatDeviceSize(value) {
    const size = String(value || "").trim();

    if (!size) {
      return "";
    }

    if (/^\d+(?:[.,]\d+)?$/.test(size)) {
      return `${size.replace(",", ".")} inch`;
    }

    return size.replace(/\binch\b/gi, "inch");
  }

  function employeeInitials(value) {
    const words = String(value || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (words.length === 0) {
      return "NV";
    }

    return words
      .slice(-2)
      .map((word) => Array.from(word)[0] || "")
      .join("")
      .toLocaleUpperCase("vi-VN");
  }

  function ticketAssignmentDetails(ticket) {
    if (ticket.assignment_load_error) {
      return { state: "error" };
    }

    const assignment = ticket.current_assignment;
    if (!assignment) {
      return { state: "empty" };
    }

    const relation = Array.isArray(assignment.employee)
      ? assignment.employee[0]
      : assignment.employee;

    if (!relation || !relation.full_name) {
      return { state: "error" };
    }

    return {
      state: assignment.status === "completed" ? "completed" : "active",
      fullName: relation.full_name,
      employeeCode: window.AMApi.formatCompactBusinessCode(relation.employee_code, "NV"),
      jobTitle: String(relation.job_title || "").trim(),
      initials: employeeInitials(relation.full_name)
    };
  }

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);

    if (className) {
      element.className = className;
    }

    if (text !== undefined) {
      element.textContent = text;
    }

    return element;
  }

  function createCell(text, className) {
    return createElement("td", className, text);
  }

  function createStatusBadge(status) {
    return createElement("span", `status-pill ${statusClass(status)}`.trim(), statusLabel(status));
  }

  function createPriorityBadge(ticket) {
    const priority = workflowPriority(ticket);

    if (priority.rank !== 1) {
      return createElement("span", "ticket-activity-priority-empty", "—");
    }

    return createElement("span", `workflow-priority ${priority.className}`, priority.label);
  }

  function ticketQuery(ticket) {
    if (ticket.ticket_code) {
      return `code=${encodeURIComponent(ticket.ticket_code)}`;
    }

    return `id=${encodeURIComponent(ticket.id || "")}`;
  }

  function createWorkflowLink(label, href, primary) {
    const link = createElement("a", `btn ${primary ? "primary" : "secondary"} compact workflow-action`, label);
    link.href = href;
    return link;
  }

  async function refreshCurrentView() {
    await loadWorkflowTickets({ refresh: true, forceRefresh: true });
  }

  function createReadyButton(ticket) {
    const button = createElement("button", "btn primary compact workflow-action", "Hoàn thành sửa chữa");
    button.type = "button";
    button.dataset.workflowAction = "ready-for-handover";
    button.dataset.ticketId = ticket.id || "";
    return button;
  }

  function createRepairReturnButton(ticket) {
    const button = createElement("button", "btn secondary compact workflow-action workflow-return-action", "Giao trả sửa chữa");
    button.type = "button";
    button.dataset.workflowAction = "return-repair";
    button.dataset.ticketId = ticket.id || "";
    return button;
  }

  function createActionMenuTrigger(ticket) {
    const button = createElement(
      "button",
      "btn secondary compact workflow-action workflow-action-menu-trigger",
      "Thêm thao tác"
    );
    button.type = "button";
    button.id = `ticketActivityActionTrigger${++actionMenuTriggerSerial}`;
    button.dataset.actionMenuTrigger = "true";
    button.dataset.ticketId = ticket.id || "";
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", ACTION_MENU_ID);
    return button;
  }

  function createWorkflowActions(ticket) {
    const actions = createElement("div", "workflow-actions ticket-activity-actions");
    const query = ticketQuery(ticket);

    if (canStartRepair(ticket)) {
      actions.appendChild(createWorkflowLink("In tem & bắt đầu sửa chữa", `print-label.html?${query}`, true));
    } else if (canReadyForHandover(ticket)) {
      actions.append(createReadyButton(ticket), createRepairReturnButton(ticket));
    } else if (ticket.status === "chờ bàn giao") {
      actions.appendChild(createWorkflowLink("Mở Bàn giao tivi", `handover-tickets.html?${query}`, true));
    } else if (canReprintReceipt(ticket)) {
      actions.appendChild(createWorkflowLink("Chỉ in lại biên nhận", `print-delivery-receipt.html?${query}`, false));
    } else if (ticket.status === "đã xong") {
      actions.appendChild(createElement("span", "workflow-inline-note", "Dữ liệu workflow cũ"));
    }

    actions.appendChild(createActionMenuTrigger(ticket));
    return actions;
  }

  function findVisibleTicket(ticketId) {
    return visibleTickets.find((ticket) => String(ticket.id || "") === String(ticketId || "")) || null;
  }

  function createActionMenuItem(label, href, disabledReason) {
    if (href) {
      const link = createElement("a", "ticket-activity-menu-item", label);
      link.href = href;
      link.setAttribute("role", "menuitem");
      link.tabIndex = -1;
      return link;
    }

    const item = createElement("button", "ticket-activity-menu-item is-disabled", label);
    item.type = "button";
    item.disabled = true;
    item.setAttribute("role", "menuitem");
    item.setAttribute("aria-disabled", "true");
    item.title = disabledReason || "";
    item.tabIndex = -1;
    return item;
  }

  function actionMenuItems(ticket) {
    const query = ticketQuery(ticket);
    return [
      createActionMenuItem(
        "Chỉ in lại tem",
        canReprintLabel(ticket) ? `print-label.html?${query}` : "",
        "Phiếu chưa đủ điều kiện in lại tem."
      ),
      createActionMenuItem("Xem phiếu", `search.html?${query}`),
      createActionMenuItem(
        "Lịch sử khách hàng",
        ticket.customer_id ? `search.html?customer_id=${encodeURIComponent(ticket.customer_id)}` : "",
        "Phiếu chưa liên kết với hồ sơ khách hàng."
      )
    ];
  }

  function positionActionMenu() {
    if (!actionMenu || !actionMenuTrigger || actionMenu.hidden) {
      return;
    }

    const triggerRect = actionMenuTrigger.getBoundingClientRect();
    const menuRect = actionMenu.getBoundingClientRect();
    const viewportPadding = 8;
    const gap = 6;
    const spaceBelow = window.innerHeight - triggerRect.bottom - viewportPadding;
    const openUpward = spaceBelow < menuRect.height + gap && triggerRect.top > menuRect.height + gap;
    const top = openUpward
      ? Math.max(viewportPadding, triggerRect.top - menuRect.height - gap)
      : Math.min(window.innerHeight - menuRect.height - viewportPadding, triggerRect.bottom + gap);
    const left = Math.min(
      Math.max(viewportPadding, triggerRect.right - menuRect.width),
      window.innerWidth - menuRect.width - viewportPadding
    );

    actionMenu.classList.toggle("opens-upward", openUpward);
    actionMenu.style.top = `${Math.round(top)}px`;
    actionMenu.style.left = `${Math.round(left)}px`;
  }

  function closeActionMenu(options) {
    const config = options || {};
    const trigger = actionMenuTrigger;

    if (!actionMenu || actionMenu.hidden) {
      return;
    }

    actionMenu.classList.remove("is-open", "opens-upward");
    actionMenu.hidden = true;
    actionMenu.replaceChildren();
    actionMenu.removeAttribute("aria-labelledby");
    actionMenu.style.removeProperty("top");
    actionMenu.style.removeProperty("left");
    actionMenuTrigger = null;

    if (trigger) {
      trigger.setAttribute("aria-expanded", "false");
      if (config.restoreFocus && document.contains(trigger)) {
        trigger.focus({ preventScroll: true });
      }
    }
  }

  function openActionMenu(trigger, ticket) {
    if (!actionMenu || !trigger || !ticket) {
      return;
    }

    if (actionMenuTrigger === trigger && !actionMenu.hidden) {
      closeActionMenu({ restoreFocus: true });
      return;
    }

    closeActionMenu();
    actionMenuTrigger = trigger;
    actionMenu.replaceChildren(...actionMenuItems(ticket));
    actionMenu.setAttribute("aria-labelledby", trigger.id);
    actionMenu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    positionActionMenu();

    window.requestAnimationFrame(() => {
      if (!actionMenu.hidden) {
        actionMenu.classList.add("is-open");
        const firstItem = actionMenu.querySelector('[role="menuitem"]:not([aria-disabled="true"])');
        if (firstItem) {
          firstItem.focus({ preventScroll: true });
        }
      }
    });
  }

  function moveActionMenuFocus(direction) {
    if (!actionMenu || actionMenu.hidden) {
      return;
    }

    const items = Array.from(
      actionMenu.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])')
    );

    if (items.length === 0) {
      return;
    }

    const currentIndex = items.indexOf(document.activeElement);
    const nextIndex = direction === "first"
      ? 0
      : direction === "last"
        ? items.length - 1
        : (currentIndex + direction + items.length) % items.length;
    items[nextIndex].focus({ preventScroll: true });
  }

  function setupActionMenu() {
    actionMenu = createElement("div", "ticket-activity-action-popover");
    actionMenu.id = ACTION_MENU_ID;
    actionMenu.hidden = true;
    actionMenu.setAttribute("role", "menu");
    actionMenu.setAttribute("aria-label", "Thêm thao tác cho phiếu");
    document.body.appendChild(actionMenu);
  }

  function createTicketCustomerCell(ticket) {
    const cell = createElement("td", "ticket-activity-identity-cell");
    const code = createElement(
      "strong",
      "workflow-ticket-code-value",
      window.AMApi.formatTicketCode(ticket.ticket_code)
    );
    const customerName = textOrDash(ticket.customer_name || ticket.customer_master_name);
    const customerCode = window.AMApi.formatCustomerCode(ticket.customer_code);
    const name = createElement("span", "ticket-activity-customer-name", customerName);
    const codeMeta = createElement("span", "ticket-activity-customer-code", customerCode);

    code.dataset.ticketCode = ticket.ticket_code || "";
    name.title = customerName;
    cell.title = ticket.search_match_label || "";
    cell.append(code, name, codeMeta);
    return cell;
  }

  function createDeviceCell(ticket) {
    const cell = createElement("td", "ticket-activity-device-cell");
    const brand = String(ticket.brand || "").trim();
    const model = String(ticket.model || "").trim();
    const deviceName = model ? [brand, model].filter(Boolean).join(" ") : "Chưa cập nhật model";
    const primary = createElement("strong", "ticket-activity-device-name", deviceName);
    const size = formatDeviceSize(ticket.size);

    primary.title = deviceName;
    cell.appendChild(primary);

    if (size) {
      cell.appendChild(createElement("span", "ticket-activity-device-size", size));
    }

    return cell;
  }

  function createEmployeeDisplay(ticket) {
    const details = ticketAssignmentDetails(ticket);
    const container = createElement("div", "ticket-activity-employee");

    if (details.state === "error") {
      container.appendChild(createElement(
        "span",
        "ticket-activity-assignment-state assignment-unavailable",
        "Không thể tải phân công"
      ));
      return container;
    }

    if (details.state === "empty") {
      container.appendChild(createElement(
        "span",
        "ticket-activity-assignment-state",
        "Chưa phân công"
      ));
      return container;
    }

    const identity = createElement("div", "ticket-activity-employee-identity");
    const avatar = createElement("span", "ticket-activity-employee-avatar", details.initials);
    const copy = createElement("span", "ticket-activity-employee-copy");
    const name = createElement("strong", "", details.fullName);
    const metadata = createElement("span", "ticket-activity-employee-meta");

    name.title = details.fullName;
    metadata.appendChild(createElement(
      "span",
      "ticket-activity-employee-code",
      details.employeeCode || "Nhân viên"
    ));
    if (details.jobTitle) {
      metadata.append(
        createElement("span", "ticket-activity-employee-separator", " · "),
        createElement("span", "ticket-activity-employee-title", details.jobTitle)
      );
    }
    copy.append(name, metadata);
    identity.append(avatar, copy);

    if (details.state === "completed") {
      container.appendChild(createElement(
        "span",
        "ticket-activity-assignment-context",
        "Đã thực hiện bởi"
      ));
    }

    container.appendChild(identity);
    return container;
  }

  function createEmployeeCell(ticket) {
    const cell = createElement("td", "ticket-activity-employee-cell");
    cell.appendChild(createEmployeeDisplay(ticket));
    return cell;
  }

  function createActivityCell(ticket) {
    const activity = workflowActivityDetails(ticket);
    const cell = createElement("td", "ticket-activity-update-cell");
    const main = createElement("strong", "ticket-activity-update-main", activity.mainText);

    main.title = activity.title;
    cell.append(
      main,
      createElement("span", "ticket-activity-update-relative", activity.relativeText)
    );
    return cell;
  }

  function createWaitCell(ticket) {
    const wait = workflowWaitDetails(ticket);
    const cell = createElement(
      "td",
      `workflow-wait ticket-activity-wait-cell${wait.overdue ? " is-overdue" : ""}`
    );

    cell.appendChild(createElement("strong", "ticket-activity-wait-main", wait.mainText));
    if (wait.detailText) {
      cell.appendChild(createElement(
        "span",
        `ticket-activity-wait-detail${wait.overdue ? " is-overdue" : ""}`,
        wait.detailText
      ));
    }

    return cell;
  }

  function renderWorkflowRows(tickets) {
    const fragment = document.createDocumentFragment();

    tickets.forEach((ticket) => {
      const row = document.createElement("tr");
      const priorityCell = document.createElement("td");
      const statusCell = document.createElement("td");
      const actionCell = createElement("td", "ticket-activity-action-cell");

      row.dataset.ticketCode = ticket.ticket_code || "";
      priorityCell.appendChild(createPriorityBadge(ticket));
      statusCell.appendChild(createStatusBadge(ticket.status));
      actionCell.appendChild(createWorkflowActions(ticket));
      row.append(
        priorityCell,
        createTicketCustomerCell(ticket),
        createDeviceCell(ticket),
        createEmployeeCell(ticket),
        createActivityCell(ticket),
        createWaitCell(ticket),
        statusCell,
        actionCell
      );
      fragment.appendChild(row);
    });

    workflow.tableBody.replaceChildren(fragment);
  }

  function createWorkflowMeta(label, value) {
    const item = document.createElement("div");
    item.append(
      createElement("span", "", label),
      createElement("strong", "", textOrDash(value))
    );
    return item;
  }

  function createWorkflowMetaContent(label, content) {
    const item = document.createElement("div");
    item.append(createElement("span", "", label), content);
    return item;
  }

  function renderWorkflowCards(tickets) {
    const fragment = document.createDocumentFragment();

    tickets.forEach((ticket) => {
      const card = createElement("article", "workflow-card ticket-activity-mobile-card");
      const top = createElement("div", "workflow-card-top ticket-activity-mobile-top");
      const title = createElement("div", "workflow-card-title");
      const code = createElement("strong", "", window.AMApi.formatTicketCode(ticket.ticket_code));
      const customer = createElement("span", "", textOrDash(ticket.customer_name || ticket.customer_master_name));
      const customerCode = createElement(
        "small",
        "ticket-activity-mobile-customer-code",
        window.AMApi.formatCustomerCode(ticket.customer_code)
      );
      const badges = createElement("div", "workflow-card-badges");
      const meta = createElement("div", "workflow-card-meta");
      const activity = workflowActivityDetails(ticket);
      const wait = workflowWaitDetails(ticket);
      const device = createElement("strong", "ticket-activity-card-device");
      const brand = String(ticket.brand || "").trim();
      const model = String(ticket.model || "").trim();
      const deviceName = model ? [brand, model].filter(Boolean).join(" ") : "Chưa cập nhật model";
      const size = formatDeviceSize(ticket.size);

      card.dataset.ticketCode = ticket.ticket_code || "";
      code.dataset.ticketCode = ticket.ticket_code || "";
      customer.title = customer.textContent;
      title.append(code, customer, customerCode);
      badges.append(createPriorityBadge(ticket), createStatusBadge(ticket.status));
      top.append(badges, title);
      device.textContent = size ? `${deviceName} · ${size}` : deviceName;
      device.title = device.textContent;
      meta.append(
        createWorkflowMetaContent("Thiết bị", device),
        createWorkflowMetaContent("Nhân viên thực hiện", createEmployeeDisplay(ticket)),
        createWorkflowMeta("Thời gian chờ", wait.mainText),
        createWorkflowMeta("Cập nhật gần nhất", `${activity.mainText} · ${activity.relativeText}`)
      );

      card.append(top, meta, createWorkflowActions(ticket));
      fragment.appendChild(card);
    });

    workflow.cards.replaceChildren(fragment);
  }

  function createPaginationButton(label, page, options) {
    const config = options || {};
    const button = createElement("button", `pagination-button ${config.active ? "active" : ""}`.trim(), label);
    button.type = "button";
    button.dataset.page = String(page);
    button.disabled = Boolean(config.disabled);
    button.setAttribute("aria-label", config.ariaLabel || `Trang ${page}`);

    if (config.active) {
      button.setAttribute("aria-current", "page");
    }

    return button;
  }

  function paginationItems(pageCount, currentPage) {
    if (pageCount <= 7) {
      return Array.from({ length: pageCount }, (_, index) => index + 1);
    }

    const items = [1];
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(pageCount - 1, currentPage + 1);

    if (start > 2) {
      items.push("ellipsis");
    }

    for (let page = start; page <= end; page += 1) {
      items.push(page);
    }

    if (end < pageCount - 1) {
      items.push("ellipsis");
    }

    items.push(pageCount);
    return items;
  }

  function renderPagination() {
    workflow.pagination.replaceChildren();
    workflow.pagination.hidden = totalPages <= 1 || totalCount === 0;

    if (workflow.pagination.hidden) {
      return;
    }

    workflow.pagination.appendChild(createPaginationButton("← Trước", state.page - 1, {
      disabled: state.page === 1,
      ariaLabel: "Trang trước"
    }));

    paginationItems(totalPages, state.page).forEach((item) => {
      if (item === "ellipsis") {
        const ellipsis = createElement("span", "pagination-ellipsis", "…");
        ellipsis.setAttribute("aria-hidden", "true");
        workflow.pagination.appendChild(ellipsis);
        return;
      }

      workflow.pagination.appendChild(createPaginationButton(String(item), item, {
        active: item === state.page,
        ariaLabel: `Trang ${item}`
      }));
    });

    workflow.pagination.appendChild(createPaginationButton("Sau →", state.page + 1, {
      disabled: state.page === totalPages,
      ariaLabel: "Trang sau"
    }));
  }

  function emptyMessage() {
    return "Không có phiếu phù hợp.";
  }

  function renderSummary(tickets) {
    if (totalCount === 0) {
      workflow.listSummary.textContent = emptyMessage();
      return;
    }

    const start = (state.page - 1) * PAGE_SIZE + 1;
    const end = Math.min(start + tickets.length - 1, totalCount);
    workflow.listSummary.textContent = `Hiển thị ${start}–${end} trên tổng số ${totalCount} phiếu.`;
  }

  function renderFilterCounts(filterCounts) {
    const counts = filterCounts || {};

    workflow.filters.querySelectorAll("[data-filter-count]").forEach((element) => {
      element.textContent = String(Number(counts[element.dataset.filterCount] || 0));
    });
  }

  function syncFilterButtons() {
    workflow.filters.querySelectorAll("[data-activity-filter]").forEach((button) => {
      const active = button.dataset.activityFilter === state.filter;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function setWorkflowState(type, message) {
    const messageElement = createElement("span", "ticket-activity-state-message", message);
    workflow.state.replaceChildren(messageElement);

    if (type === "loading") {
      const skeleton = createElement("div", "ticket-activity-skeleton");
      skeleton.setAttribute("aria-hidden", "true");

      for (let rowIndex = 0; rowIndex < 4; rowIndex += 1) {
        const row = createElement("div", "ticket-activity-skeleton-row");
        for (let columnIndex = 0; columnIndex < 8; columnIndex += 1) {
          row.appendChild(createElement("span", ""));
        }
        skeleton.appendChild(row);
      }

      workflow.state.appendChild(skeleton);
    }

    window.AMUI.setSectionState({
      section: workflow.section,
      stateElement: workflow.state,
      dataElement: workflow.content,
      refreshingElement: workflow.refreshing
    }, type);
  }

  function showWorkflowContent() {
    workflow.state.textContent = "";
    window.AMUI.setSectionState({
      section: workflow.section,
      stateElement: workflow.state,
      dataElement: workflow.content,
      refreshingElement: workflow.refreshing
    }, "data");
  }

  function highlightRequestedTicket() {
    const requestedCode = new URLSearchParams(window.location.search).get("code");

    if (!requestedCode) {
      return;
    }

    const canonical = window.AMApi.expandCompactBusinessCode(requestedCode, "AM");
    const match = Array.from(workflow.section.querySelectorAll("[data-ticket-code]"))
      .find((element) => element.dataset.ticketCode === canonical);

    if (match) {
      const target = match.closest("tr, article") || match;
      target.classList.add("workflow-focus-ticket");
    }
  }

  function renderWorkflow(tickets, filterCounts) {
    closeActionMenu();
    visibleTickets = tickets.slice();
    renderFilterCounts(filterCounts);
    renderSummary(tickets);

    if (totalCount === 0) {
      workflow.tableBody.replaceChildren();
      workflow.cards.replaceChildren();
      renderPagination();
      setWorkflowState("empty", emptyMessage());
      return;
    }

    renderWorkflowRows(tickets);
    renderWorkflowCards(tickets);
    renderPagination();
    showWorkflowContent();
    highlightRequestedTicket();
  }

  function readStateFromUrl() {
    const code = new URLSearchParams(window.location.search).get("code");

    if (code) {
      state.keyword = code;
      workflow.searchInput.value = code;
    }
  }

  function setPage(page) {
    const nextPage = Math.min(Math.max(Number(page) || 1, 1), totalPages);

    if (nextPage === state.page) {
      return;
    }

    state.page = nextPage;
    loadWorkflowTickets({ refresh: true });
  }

  async function loadWorkflowTickets(options) {
    const config = options || {};

    if (!workflow.section) {
      return;
    }

    const requestId = ++workflowRequestId;
    const hasVisibleData = !workflow.content.hidden && visibleTickets.length > 0;

    if (config.refresh || hasVisibleData) {
      window.AMUI.setSectionState({
        section: workflow.section,
        stateElement: workflow.state,
        dataElement: workflow.content,
        refreshingElement: workflow.refreshing
      }, "refreshing");
    } else {
      setWorkflowState("loading", "Đang tải hoạt động của phiếu...");
    }

    try {
      const result = await window.AMApi.getTicketActivityTickets({
        page: state.page,
        pageSize: PAGE_SIZE,
        keyword: state.keyword,
        filter: state.filter,
        forceRefresh: config.forceRefresh === true
      });

      if (requestId !== workflowRequestId) {
        return;
      }

      if (!result.available) {
        setWorkflowState("unavailable", result.message || "Workflow chưa được kích hoạt.");
        return;
      }

      totalCount = Number(result.totalCount || 0);
      totalPages = Math.max(1, Number(result.totalPages || 1));
      state.page = Math.min(Math.max(Number(result.page) || 1, 1), totalPages);
      renderWorkflow(result.tickets || [], result.filterCounts || {});
    } catch (error) {
      if (requestId !== workflowRequestId) {
        return;
      }

      setWorkflowState("error", "Không thể tải danh sách phiếu.");
      const retry = createElement("button", "btn secondary list-state-action", "Thử lại");
      retry.type = "button";
      retry.addEventListener("click", () => loadWorkflowTickets({ refresh: true, forceRefresh: true }));
      workflow.state.appendChild(retry);
    }
  }

  function runSearchNow() {
    if (searchTimer) {
      window.clearTimeout(searchTimer);
      searchTimer = null;
    }

    const keyword = workflow.searchInput.value.trim();

    if (keyword === state.keyword && state.page === 1) {
      return;
    }

    state.keyword = keyword;
    state.page = 1;
    loadWorkflowTickets({ refresh: true });
  }

  function scheduleSearch() {
    if (searchTimer) {
      window.clearTimeout(searchTimer);
    }

    searchTimer = window.setTimeout(runSearchNow, SEARCH_DELAY);
  }

  function clearSearch() {
    if (searchTimer) {
      window.clearTimeout(searchTimer);
      searchTimer = null;
    }

    if (!state.keyword && state.page === 1 && !workflow.searchInput.value) {
      return;
    }

    workflow.searchInput.value = "";
    state.keyword = "";
    state.page = 1;
    loadWorkflowTickets({ refresh: true });
  }

  function changeFilter(nextFilter) {
    if (!nextFilter || nextFilter === state.filter) {
      return;
    }

    state.filter = nextFilter;
    state.page = 1;
    syncFilterButtons();
    loadWorkflowTickets({ refresh: true });
  }

  async function runWorkflowAction(button, ticket) {
    if (!button || !ticket || button.dataset.actionPending === "true") {
      return;
    }

    button.dataset.actionPending = "true";

    try {
      if (button.dataset.workflowAction === "ready-for-handover") {
        await window.AMUI.completeRepairInPlace({
          ticketId: ticket.id,
          ticket,
          expectedStatus: ticket.status,
          button,
          source: "ticket-activity",
          onSuccess: refreshCurrentView
        });
      } else if (button.dataset.workflowAction === "return-repair") {
        await window.AMUI.returnRepairInPlace({
          ticket,
          button,
          source: "ticket-activity",
          onSuccess: refreshCurrentView
        });
      }
    } catch (error) {
      window.AMUI.toast(
        error && error.message ? error.message : "Không thể thực hiện thao tác. Vui lòng thử lại.",
        { type: "error" }
      );
    } finally {
      if (document.contains(button)) {
        delete button.dataset.actionPending;
      }
    }
  }

  function handleWorkflowInteraction(event) {
    const menuTrigger = event.target.closest("[data-action-menu-trigger]");
    if (menuTrigger && workflow.section.contains(menuTrigger)) {
      event.preventDefault();
      event.stopPropagation();
      openActionMenu(menuTrigger, findVisibleTicket(menuTrigger.dataset.ticketId));
      return;
    }

    const actionButton = event.target.closest("[data-workflow-action]");
    if (actionButton && workflow.section.contains(actionButton)) {
      event.preventDefault();
      event.stopPropagation();
      runWorkflowAction(actionButton, findVisibleTicket(actionButton.dataset.ticketId));
    }
  }

  function handleDocumentClick(event) {
    if (!actionMenu || actionMenu.hidden) {
      return;
    }

    if (actionMenu.contains(event.target)) {
      const menuItem = event.target.closest('[role="menuitem"]');
      if (menuItem && menuItem.getAttribute("aria-disabled") !== "true") {
        closeActionMenu();
      }
      return;
    }

    if (actionMenuTrigger && actionMenuTrigger.contains(event.target)) {
      return;
    }

    closeActionMenu();
  }

  function handleActionMenuKeydown(event) {
    if (event.key === "ArrowDown" && event.target.closest("[data-action-menu-trigger]")) {
      event.preventDefault();
      const trigger = event.target.closest("[data-action-menu-trigger]");
      openActionMenu(trigger, findVisibleTicket(trigger.dataset.ticketId));
      return;
    }

    if (!actionMenu || actionMenu.hidden) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeActionMenu({ restoreFocus: true });
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActionMenuFocus(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActionMenuFocus(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveActionMenuFocus("first");
    } else if (event.key === "End") {
      event.preventDefault();
      moveActionMenuFocus("last");
    } else if (event.key === " " && event.target.closest('[role="menuitem"]:not([aria-disabled="true"])')) {
      event.preventDefault();
      event.target.closest('[role="menuitem"]').click();
    } else if (event.key === "Tab") {
      closeActionMenu();
    }
  }

  async function initTicketActivity() {
    attachLogout();
    setupActionMenu();
    readStateFromUrl();
    syncFilterButtons();

    workflow.form.addEventListener("submit", (event) => {
      event.preventDefault();
      runSearchNow();
    });
    workflow.searchInput.addEventListener("input", scheduleSearch);
    workflow.clearButton.addEventListener("click", clearSearch);
    workflow.filters.addEventListener("click", (event) => {
      const button = event.target.closest("[data-activity-filter]");
      if (button) {
        changeFilter(button.dataset.activityFilter);
      }
    });
    workflow.pagination.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-page]");
      if (button && !button.disabled) {
        setPage(button.dataset.page);
      }
    });
    workflow.section.addEventListener("click", handleWorkflowInteraction);
    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("keydown", handleActionMenuKeydown);
    window.addEventListener("resize", () => closeActionMenu());
    document.addEventListener("scroll", positionActionMenu, true);

    try {
      const access = await window.AMApi.requireInternalAccess();
      if (access) {
        await loadWorkflowTickets();
      }
    } catch (error) {
      showNotice("error", error.message);
    }
  }

  document.addEventListener("DOMContentLoaded", initTicketActivity);
})();

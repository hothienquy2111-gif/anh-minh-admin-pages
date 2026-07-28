(function () {
  "use strict";

  const SEARCH_DELAY_MS = 280;
  let dialogState = null;
  let openContext = null;
  let searchTimer = null;
  let loadVersion = 0;
  let selectedEmployeeId = null;
  let isSubmitting = false;
  let previewTimer = null;
  let previewVersion = 0;

  function element(tagName, className, text) {
    const node = document.createElement(tagName);

    if (className) {
      node.className = className;
    }

    if (text !== undefined && text !== null) {
      node.textContent = String(text);
    }

    return node;
  }

  function ticketCode(ticket) {
    if (!ticket) {
      return "—";
    }

    return window.AMApi && typeof window.AMApi.formatTicketCode === "function"
      ? window.AMApi.formatTicketCode(ticket.ticket_code)
      : String(ticket.ticket_code || "—");
  }

  function employeeInitials(name) {
    if (window.AMEmployeeKpi && typeof window.AMEmployeeKpi.getInitials === "function") {
      return window.AMEmployeeKpi.getInitials(name);
    }

    return String(name || "NV").trim().slice(0, 2).toUpperCase();
  }

  function setStatus(type, message) {
    if (!dialogState) {
      return;
    }

    dialogState.status.className = `employee-assignment-state employee-assignment-state--${type}`;
    dialogState.status.textContent = message || "";
    dialogState.status.hidden = !message;
  }

  function createDialog() {
    if (dialogState) {
      return dialogState;
    }

    const backdrop = element("div", "employee-assignment-backdrop no-print");
    const dialog = element("section", "employee-assignment-dialog");
    const header = element("div", "employee-assignment-dialog__header");
    const heading = element("div");
    const title = element("h2", "employee-assignment-dialog__title", "Giao cho nhân viên");
    const description = element(
      "p",
      "employee-assignment-dialog__description",
      "Chọn một kỹ thuật viên đang hoạt động để bắt đầu tính thời gian xử lý."
    );
    const close = element("button", "employee-assignment-dialog__close", "Đóng");
    const ticketSummary = element("div", "employee-assignment-ticket");
    const searchField = element("label", "employee-assignment-search");
    const searchLabel = element("span", "employee-assignment-search__label", "Tìm nhân viên");
    const search = element("input", "employee-assignment-search__input");
    const status = element("div", "employee-assignment-state");
    const list = element("div", "employee-assignment-list");
    const classification = element("fieldset", "employee-assignment-classification");
    const classificationLegend = element("legend", "", "Phân loại khối lượng công việc");
    const classificationGrid = element("div", "employee-assignment-classification__grid");
    const complexityField = element("label", "employee-assignment-classification__field");
    const complexityLabel = element("span", "", "Độ khó");
    const complexity = document.createElement("select");
    const manualSizeField = element("label", "employee-assignment-classification__field");
    const manualSizeLabel = element("span", "", "Kích thước xác nhận (inch, nếu cần)");
    const manualSize = document.createElement("input");
    const pointPreview = element("p", "employee-assignment-points-preview", "Điểm sẽ được xem trước từ cấu hình backend.");
    const noteField = element("label", "employee-assignment-note");
    const noteLabel = element("span", "employee-assignment-note__label", "Ghi chú phân công");
    const note = element("textarea", "employee-assignment-note__input");
    const footer = element("div", "employee-assignment-dialog__footer");
    const cancel = element("button", "btn secondary", "Hủy");
    const submit = element("button", "btn primary", "Xác nhận giao việc");

    backdrop.hidden = true;
    backdrop.setAttribute("aria-hidden", "true");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "employeeAssignmentTitle");
    dialog.setAttribute("aria-describedby", "employeeAssignmentDescription");
    dialog.tabIndex = -1;
    title.id = "employeeAssignmentTitle";
    description.id = "employeeAssignmentDescription";
    close.type = "button";
    close.setAttribute("aria-label", "Đóng cửa sổ giao nhân viên");
    search.type = "search";
    search.autocomplete = "off";
    search.placeholder = "Tìm theo tên, mã, vai trò hoặc bộ phận...";
    search.setAttribute("aria-controls", "employeeAssignmentList");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.hidden = true;
    list.id = "employeeAssignmentList";
    list.setAttribute("role", "radiogroup");
    list.setAttribute("aria-label", "Danh sách nhân viên");
    [
      ["basic", "Cơ bản"],
      ["standard", "Tiêu chuẩn (mặc định)"],
      ["hard", "Khó"],
      ["very_hard", "Rất khó"]
    ].forEach(([value, label]) => {
      const option = element("option", "", label);
      option.value = value;
      complexity.appendChild(option);
    });
    complexity.value = "standard";
    manualSize.type = "number";
    manualSize.min = "20";
    manualSize.max = "120";
    manualSize.step = "1";
    manualSize.inputMode = "numeric";
    manualSize.placeholder = "Ví dụ: 65";
    pointPreview.setAttribute("role", "status");
    pointPreview.setAttribute("aria-live", "polite");
    note.rows = 3;
    note.maxLength = 1000;
    note.placeholder = "Ví dụ: kiểm tra nguồn và màn hình trước.";
    cancel.type = "button";
    submit.type = "button";
    submit.disabled = true;

    heading.append(title, description);
    header.append(heading, close);
    searchField.append(searchLabel, search);
    complexityField.append(complexityLabel, complexity);
    manualSizeField.append(manualSizeLabel, manualSize);
    classificationGrid.append(complexityField, manualSizeField);
    classification.append(classificationLegend, classificationGrid, pointPreview);
    noteField.append(noteLabel, note);
    footer.append(cancel, submit);
    dialog.append(header, ticketSummary, searchField, status, list, classification, noteField, footer);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    dialogState = {
      backdrop,
      dialog,
      title,
      description,
      close,
      ticketSummary,
      search,
      status,
      list,
      complexity,
      manualSize,
      pointPreview,
      note,
      cancel,
      submit,
      returnFocus: null
    };

    close.addEventListener("click", () => closeDialog());
    cancel.addEventListener("click", () => closeDialog());
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop && !isSubmitting) {
        closeDialog();
      }
    });
    search.addEventListener("input", () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => loadEmployees(search.value), SEARCH_DELAY_MS);
    });
    complexity.addEventListener("change", schedulePointPreview);
    manualSize.addEventListener("input", schedulePointPreview);
    submit.addEventListener("click", submitAssignment);
    dialog.addEventListener("keydown", trapFocus);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && dialogState && !dialogState.backdrop.hidden && !isSubmitting) {
        event.preventDefault();
        closeDialog();
      }
    });

    return dialogState;
  }

  function schedulePointPreview() {
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => {
      updatePointPreview().catch(() => {});
    }, 180);
  }

  async function updatePointPreview() {
    const state = createDialog();
    const ticket = openContext && openContext.ticket;
    const version = ++previewVersion;
    if (!ticket || !window.AMApi || typeof window.AMApi.previewEmployeeWorkPoints !== "function") {
      state.pointPreview.textContent = "Điểm quy đổi sẽ được chụp khi hoàn thành sửa chữa.";
      return;
    }
    const rawSize = String(state.manualSize.value || "").trim();
    if (rawSize && (Number(rawSize) < 20 || Number(rawSize) > 120)) {
      state.pointPreview.textContent = "Kích thước xác nhận phải từ 20 đến 120 inch.";
      return;
    }
    state.pointPreview.textContent = "Đang xem trước điểm quy đổi...";
    try {
      const preview = await window.AMApi.previewEmployeeWorkPoints({
        size: ticket.size || ticket.tv_size || "",
        model: ticket.model || "",
        manualSize: rawSize || null,
        complexityLevel: state.complexity.value
      });
      if (version !== previewVersion || !openContext) {
        return;
      }
      const sizeLabel = preview && preview.tv_size_inches
        ? `${preview.tv_size_inches} inch`
        : "chưa xác định kích thước";
      const points = window.AMEmployeeKpi && typeof window.AMEmployeeKpi.formatWorkPoints === "function"
        ? window.AMEmployeeKpi.formatWorkPoints(preview && preview.work_points)
        : Number(preview && preview.work_points || 0).toLocaleString("vi-VN", { maximumFractionDigits: 2 });
      state.pointPreview.textContent = `${sizeLabel} · ${preview && preview.complexity_label || "Tiêu chuẩn"} · ${points} điểm dự kiến`;
    } catch (_error) {
      if (version === previewVersion) {
        state.pointPreview.textContent = "Chưa xem trước được điểm; phân loại vẫn được lưu an toàn khi xác nhận.";
      }
    }
  }

  function trapFocus(event) {
    if (event.key !== "Tab" || !dialogState || dialogState.backdrop.hidden) {
      return;
    }

    const focusable = Array.from(
      dialogState.dialog.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((node) => node.offsetParent !== null);

    if (focusable.length === 0) {
      event.preventDefault();
      dialogState.dialog.focus({ preventScroll: true });
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  function renderTicketSummary(ticket, currentAssignment) {
    const state = createDialog();
    const code = element("strong", "employee-assignment-ticket__code", ticketCode(ticket));
    const device = element(
      "span",
      "employee-assignment-ticket__device",
      [ticket && ticket.brand, ticket && ticket.model].filter(Boolean).join(" · ") || "Chưa có hãng/model"
    );
    const current = currentAssignment
      ? element(
        "span",
        "employee-assignment-ticket__current",
        `Đang phụ trách: ${currentAssignment.employee_name || currentAssignment.full_name || "—"}`
      )
      : null;

    state.ticketSummary.replaceChildren(code, device);
    if (current) {
      state.ticketSummary.appendChild(current);
    }
  }

  function selectEmployee(employeeId) {
    selectedEmployeeId = String(employeeId || "");
    const state = createDialog();

    state.list.querySelectorAll("[data-employee-id]").forEach((item) => {
      const selected = item.dataset.employeeId === selectedEmployeeId;
      item.classList.toggle("is-selected", selected);
      item.setAttribute("aria-checked", String(selected));
    });
    state.submit.disabled = !selectedEmployeeId || isSubmitting;
  }

  function renderEmployees(rows) {
    const state = createDialog();
    state.list.replaceChildren();

    if (!rows.length) {
      setStatus("empty", "Không tìm thấy nhân viên đang hoạt động.");
      state.submit.disabled = true;
      return;
    }

    setStatus("data", "");
    rows.forEach((employee) => {
      const item = element("button", "employee-assignment-option");
      const avatar = element(
        "span",
        "employee-assignment-option__avatar",
        employeeInitials(employee.full_name)
      );
      const copy = element("span", "employee-assignment-option__copy");
      const name = element("strong", null, employee.full_name || "Chưa có tên");
      const meta = element(
        "span",
        null,
        [
          employee.employee_code,
          employee.job_title,
          employee.department
        ].filter(Boolean).join(" · ") || "Nhân viên kỹ thuật"
      );
      const workload = element(
        "span",
        "employee-assignment-option__workload",
        `${Number(employee.active_assignment_count) || 0} việc đang làm`
      );

      item.type = "button";
      item.dataset.employeeId = employee.employee_id;
      item.setAttribute("role", "radio");
      item.setAttribute("aria-checked", "false");
      copy.append(name, meta);
      item.append(avatar, copy, workload);
      item.addEventListener("click", () => selectEmployee(employee.employee_id));
      state.list.appendChild(item);
    });

    if (selectedEmployeeId) {
      const stillExists = rows.some((employee) => employee.employee_id === selectedEmployeeId);
      selectEmployee(stillExists ? selectedEmployeeId : "");
    }
  }

  async function loadEmployees(search) {
    const state = createDialog();
    const version = ++loadVersion;
    setStatus("loading", "Đang tải nhân viên...");
    state.list.replaceChildren();
    state.submit.disabled = true;

    try {
      const rows = await window.AMApi.listAssignableEmployees(search, 50);
      if (version !== loadVersion || state.backdrop.hidden) {
        return;
      }
      renderEmployees(rows);
    } catch (error) {
      if (version !== loadVersion || state.backdrop.hidden) {
        return;
      }
      setStatus("error", error.message || "Không thể tải danh sách nhân viên.");
    }
  }

  async function submitAssignment() {
    const state = createDialog();

    if (!openContext || !selectedEmployeeId || isSubmitting) {
      return;
    }

    const wasReassignment = Boolean(openContext.currentAssignment);
    let succeeded = false;
    isSubmitting = true;
    state.submit.disabled = true;
    state.cancel.disabled = true;
    state.close.disabled = true;
    state.search.disabled = true;
    state.complexity.disabled = true;
    state.manualSize.disabled = true;
    state.note.disabled = true;
    state.submit.textContent = wasReassignment
      ? "Đang đổi người..."
      : "Đang giao việc...";
    setStatus("loading", "Đang xác nhận phân công...");

    try {
      const classification = {
        complexityLevel: state.complexity.value,
        manualSize: state.manualSize.value || null,
        classificationNote: state.note.value
      };
      const needsClassifiedRpc = classification.complexityLevel !== "standard"
        || Boolean(classification.manualSize);
      let result;
      if (wasReassignment) {
        result = needsClassifiedRpc
          ? await window.AMApi.reassignTicketToEmployeeClassified(
            openContext.currentAssignment.assignment_id || openContext.currentAssignment.id,
            selectedEmployeeId,
            state.note.value,
            classification
          )
          : await window.AMApi.reassignTicketToEmployee(
            openContext.currentAssignment.assignment_id || openContext.currentAssignment.id,
            selectedEmployeeId,
            state.note.value
          );
      } else {
        result = needsClassifiedRpc
          ? await window.AMApi.assignTicketToEmployeeClassified(
            openContext.ticket.id,
            selectedEmployeeId,
            state.note.value,
            classification
          )
          : await window.AMApi.assignTicketToEmployee(
            openContext.ticket.id,
            selectedEmployeeId,
            state.note.value
          );
      }
      const callback = openContext.onSuccess;
      succeeded = true;
      isSubmitting = false;
      closeDialog({ returnFocus: false });

      if (typeof callback === "function") {
        try {
          await callback(result);
        } catch (_refreshError) {
          if (window.AMUI && typeof window.AMUI.toast === "function") {
            window.AMUI.toast(
              "Đã giao việc, nhưng dữ liệu màn hình chưa tải lại được. Hãy bấm Tải lại.",
              { type: "warning" }
            );
          }
        }
      }

      if (window.AMUI && typeof window.AMUI.toast === "function") {
        window.AMUI.toast(
          wasReassignment
            ? "Đã đổi nhân viên phụ trách."
            : "Đã giao tivi cho nhân viên.",
          { type: "success" }
        );
      }
    } catch (error) {
      setStatus("error", error.message || "Không thể giao việc.");
    } finally {
      isSubmitting = false;
      if (succeeded || state.backdrop.hidden) {
        return;
      }
      state.cancel.disabled = false;
      state.close.disabled = false;
      state.search.disabled = false;
      state.complexity.disabled = false;
      state.manualSize.disabled = false;
      state.note.disabled = false;
      state.submit.textContent = openContext && openContext.currentAssignment
        ? "Xác nhận đổi người"
        : "Xác nhận giao việc";
      state.submit.disabled = !selectedEmployeeId;
    }
  }

  function closeDialog(options) {
    const state = createDialog();
    const settings = options || {};
    const returnFocus = state.returnFocus;

    if (isSubmitting) {
      return;
    }

    window.clearTimeout(searchTimer);
    window.clearTimeout(previewTimer);
    loadVersion += 1;
    previewVersion += 1;
    state.backdrop.hidden = true;
    state.backdrop.setAttribute("aria-hidden", "true");
    document.body.classList.remove("employee-assignment-modal-open");
    openContext = null;
    selectedEmployeeId = null;

    if (settings.returnFocus !== false && returnFocus && document.contains(returnFocus)) {
      returnFocus.focus({ preventScroll: true });
    }
  }

  async function open(options) {
    const settings = options || {};
    const ticket = settings.ticket;

    if (!ticket || !ticket.id) {
      throw new Error("Thiếu phiếu để giao cho nhân viên.");
    }

    const state = createDialog();
    openContext = {
      ticket,
      currentAssignment: settings.currentAssignment || null,
      onSuccess: settings.onSuccess || null,
      preselectedEmployeeId: String(settings.preselectedEmployeeId || "")
    };
    selectedEmployeeId = openContext.preselectedEmployeeId;
    state.returnFocus = settings.trigger || document.activeElement;
    state.title.textContent = settings.currentAssignment ? "Đổi nhân viên phụ trách" : "Giao cho nhân viên";
    state.description.textContent = settings.currentAssignment
      ? "Lịch sử người cũ được giữ nguyên; KPI chỉ tính cho assignment active cuối cùng."
      : "Chọn một kỹ thuật viên đang hoạt động để bắt đầu tính thời gian xử lý.";
    state.search.value = "";
    state.complexity.value = "standard";
    state.manualSize.value = "";
    state.pointPreview.textContent = "Điểm sẽ được xem trước từ cấu hình backend.";
    state.note.value = "";
    state.submit.textContent = settings.currentAssignment
      ? "Xác nhận đổi người"
      : "Xác nhận giao việc";
    state.submit.disabled = true;
    renderTicketSummary(ticket, settings.currentAssignment);
    state.backdrop.hidden = false;
    state.backdrop.setAttribute("aria-hidden", "false");
    document.body.classList.add("employee-assignment-modal-open");
    state.dialog.focus({ preventScroll: true });
    schedulePointPreview();
    await loadEmployees("");
  }

  function renderAssignmentSummary(container, assignment) {
    if (!container) {
      return;
    }

    container.replaceChildren();
    if (!assignment) {
      container.hidden = true;
      return;
    }

    const label = element("span", "employee-assignment-summary__label", "Đã giao việc");
    const name = element(
      "strong",
      "employee-assignment-summary__name",
      assignment.employee_name || assignment.full_name || "—"
    );
    const time = element(
      "span",
      "employee-assignment-summary__time",
      window.AMEmployeeKpi
        ? `Giao lúc ${window.AMEmployeeKpi.formatDateTime(assignment.assigned_at)}`
        : ""
    );
    container.append(label, name, time);
    container.hidden = false;
  }

  window.AMEmployeeAssignment = Object.freeze({
    close: closeDialog,
    open,
    renderAssignmentSummary
  });
})();

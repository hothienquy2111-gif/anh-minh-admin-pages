(function () {
  "use strict";

  function createElement(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) {
      node.className = className;
    }
    if (text !== undefined && text !== null) {
      node.textContent = String(text);
    }
    return node;
  }

  function initials(value) {
    if (window.AMEmployeeKpi && typeof window.AMEmployeeKpi.getInitials === "function") {
      return window.AMEmployeeKpi.getInitials(value);
    }

    return String(value || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(-2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "NV";
  }

  function employeeStatusLabel(status) {
    const key = String(status || "").toLowerCase();
    if (key === "active") {
      return "Đang hoạt động";
    }
    if (key === "inactive") {
      return "Ngừng hoạt động";
    }
    if (key === "suspended") {
      return "Tạm khóa";
    }
    return "Chưa xác định";
  }

  function formatCode(value) {
    if (window.AMApi && typeof window.AMApi.formatCompactBusinessCode === "function") {
      return window.AMApi.formatCompactBusinessCode(value, "NV");
    }
    return String(value || "—");
  }

  function createEmployeeItem(employee, selectedId) {
    const employeeId = String(employee.employee_id || employee.id || "");
    const button = createElement("button", "employee-directory-item");
    button.type = "button";
    button.dataset.employeeId = employeeId;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", employeeId === selectedId ? "true" : "false");

    if (employeeId === selectedId) {
      button.classList.add("is-selected");
      button.setAttribute("aria-current", "true");
    }

    const avatar = createElement("span", "employee-directory-avatar", initials(employee.full_name));
    avatar.setAttribute("aria-hidden", "true");

    const body = createElement("span", "employee-directory-body");
    const heading = createElement("span", "employee-directory-heading");
    heading.appendChild(createElement("strong", "", employee.full_name || "Chưa đặt tên"));
    heading.appendChild(createElement(
      "span",
      `employee-status-dot employee-status-dot--${String(employee.employment_status || "unknown")}`,
      employeeStatusLabel(employee.employment_status)
    ));

    const meta = createElement("span", "employee-directory-meta");
    meta.appendChild(createElement("span", "", formatCode(employee.employee_code)));
    meta.appendChild(createElement("span", "", employee.job_title || "Chưa có chức danh"));

    const metrics = createElement("span", "employee-directory-metrics");
    const active = createElement("span");
    active.appendChild(createElement("strong", "", Number(employee.active_assignments) || 0));
    active.append(" đang sửa");
    const completed = createElement("span");
    completed.appendChild(createElement("strong", "", Number(employee.completed_this_month) || 0));
    completed.append(" tháng này");
    metrics.append(active, completed);

    body.append(heading, meta, metrics);
    button.append(avatar, body);
    return button;
  }

  class EmployeeSidebar {
    constructor(options) {
      const settings = options || {};
      this.root = settings.root;
      this.list = settings.list;
      this.count = settings.count;
      this.toggle = settings.toggle;
      this.closeButton = settings.closeButton;
      this.backdrop = settings.backdrop;
      this.mobileSummary = settings.mobileSummary;
      this.onSelect = typeof settings.onSelect === "function" ? settings.onSelect : function () {};
      this.rows = [];
      this.selectedId = "";
      this.isOpen = false;

      this.handleListClick = this.handleListClick.bind(this);
      this.handleToggle = this.handleToggle.bind(this);
      this.handleClose = this.handleClose.bind(this);
      this.handleKeydown = this.handleKeydown.bind(this);

      if (this.list) {
        this.list.addEventListener("click", this.handleListClick);
      }
      if (this.toggle) {
        this.toggle.addEventListener("click", this.handleToggle);
      }
      if (this.closeButton) {
        this.closeButton.addEventListener("click", this.handleClose);
      }
      if (this.backdrop) {
        this.backdrop.addEventListener("click", this.handleClose);
      }
      document.addEventListener("keydown", this.handleKeydown);
    }

    handleListClick(event) {
      const item = event.target.closest("[data-employee-id]");
      if (!item || !this.list.contains(item)) {
        return;
      }

      const employee = this.rows.find((row) => {
        return String(row.employee_id || row.id || "") === item.dataset.employeeId;
      });
      if (!employee) {
        return;
      }

      this.onSelect(employee);
      this.close();
    }

    handleToggle() {
      if (this.isOpen) {
        this.close();
      } else {
        this.open();
      }
    }

    handleClose() {
      this.close();
    }

    handleKeydown(event) {
      if (event.key === "Escape" && this.isOpen) {
        event.preventDefault();
        this.close({ restoreFocus: true });
      }
    }

    open() {
      if (!this.root || this.isOpen) {
        return;
      }

      this.isOpen = true;
      this.root.classList.add("is-open");
      this.backdrop.hidden = false;
      document.body.classList.add("employee-directory-open");
      this.toggle.setAttribute("aria-expanded", "true");
      window.requestAnimationFrame(() => {
        const selected = this.list.querySelector(".employee-directory-item.is-selected");
        const first = this.list.querySelector(".employee-directory-item");
        (selected || first || this.closeButton).focus();
      });
    }

    close(options) {
      if (!this.root || !this.isOpen) {
        return;
      }

      const settings = options || {};
      this.isOpen = false;
      this.root.classList.remove("is-open");
      this.backdrop.hidden = true;
      document.body.classList.remove("employee-directory-open");
      this.toggle.setAttribute("aria-expanded", "false");
      if (settings.restoreFocus && this.toggle) {
        this.toggle.focus({ preventScroll: true });
      }
    }

    setLoading(message) {
      if (!this.list) {
        return;
      }
      this.list.replaceChildren();
      const loading = createElement(
        "div",
        "employee-directory-state employee-directory-state--loading",
        message || "Đang tải nhân viên..."
      );
      loading.setAttribute("role", "status");
      this.list.appendChild(loading);
    }

    setError(message, onRetry) {
      if (!this.list) {
        return;
      }
      this.list.replaceChildren();
      const state = createElement("div", "employee-directory-state employee-directory-state--error");
      state.appendChild(createElement("strong", "", "Không thể tải nhân viên"));
      state.appendChild(createElement("p", "", message || "Vui lòng thử lại."));
      if (typeof onRetry === "function") {
        const retry = createElement("button", "btn secondary compact", "Thử lại");
        retry.type = "button";
        retry.addEventListener("click", onRetry, { once: true });
        state.appendChild(retry);
      }
      this.list.appendChild(state);
    }

    render(rows, selectedId, options) {
      const settings = options || {};
      this.rows = Array.isArray(rows) ? rows.slice() : [];
      this.selectedId = String(selectedId || "");
      this.list.replaceChildren();

      if (this.count) {
        const count = Number(settings.activeCount);
        this.count.textContent = Number.isFinite(count)
          ? `${count} đang hoạt động`
          : `${this.rows.length} hồ sơ`;
      }

      if (this.rows.length === 0) {
        const state = createElement("div", "employee-directory-state");
        state.appendChild(createElement("strong", "", "Không có nhân viên phù hợp"));
        state.appendChild(createElement(
          "p",
          "",
          settings.isFiltered
            ? "Thử đổi từ khóa hoặc bộ lọc trạng thái."
            : "Hãy thêm hồ sơ nhân viên đầu tiên."
        ));
        this.list.appendChild(state);
        this.updateMobileSummary(null);
        return;
      }

      const fragment = document.createDocumentFragment();
      this.rows.forEach((employee) => {
        fragment.appendChild(createEmployeeItem(employee, this.selectedId));
      });
      this.list.appendChild(fragment);

      const selected = this.rows.find((employee) => {
        return String(employee.employee_id || employee.id || "") === this.selectedId;
      });
      this.updateMobileSummary(selected || null);
    }

    setSelected(employeeId) {
      this.selectedId = String(employeeId || "");
      this.list.querySelectorAll("[data-employee-id]").forEach((item) => {
        const selected = item.dataset.employeeId === this.selectedId;
        item.classList.toggle("is-selected", selected);
        item.setAttribute("aria-selected", selected ? "true" : "false");
        if (selected) {
          item.setAttribute("aria-current", "true");
        } else {
          item.removeAttribute("aria-current");
        }
      });

      const selected = this.rows.find((employee) => {
        return String(employee.employee_id || employee.id || "") === this.selectedId;
      });
      this.updateMobileSummary(selected || null);
    }

    updateMobileSummary(employee) {
      if (!this.mobileSummary) {
        return;
      }
      this.mobileSummary.replaceChildren();
      if (!employee) {
        this.mobileSummary.appendChild(createElement("strong", "", "Chọn nhân viên"));
        this.mobileSummary.appendChild(createElement("span", "", "Mở danh sách hồ sơ"));
        return;
      }
      this.mobileSummary.appendChild(createElement("strong", "", employee.full_name || "Nhân viên"));
      this.mobileSummary.appendChild(createElement(
        "span",
        "",
        `${formatCode(employee.employee_code)} · ${employee.job_title || "Chưa có chức danh"}`
      ));
    }

    destroy() {
      if (this.list) {
        this.list.removeEventListener("click", this.handleListClick);
      }
      if (this.toggle) {
        this.toggle.removeEventListener("click", this.handleToggle);
      }
      if (this.closeButton) {
        this.closeButton.removeEventListener("click", this.handleClose);
      }
      if (this.backdrop) {
        this.backdrop.removeEventListener("click", this.handleClose);
      }
      document.removeEventListener("keydown", this.handleKeydown);
    }
  }

  window.AMEmployeeSidebar = Object.freeze({
    create(options) {
      return new EmployeeSidebar(options);
    },
    employeeStatusLabel
  });
})();

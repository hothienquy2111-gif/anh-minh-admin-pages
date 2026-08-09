(function () {
  "use strict";

  const APPOINTMENT_PAGE = "appointment-reminders.html";
  const HANDOVER_PAGE = "handover-tickets.html";
  const EMPLOYEES_PAGE = "employees.html";
  const EMPLOYEE_ACCESS_SCRIPT = "js/employee-access-guard.js";
  const CLOSE_DELAY_MS = 180;
  const EXIT_DURATION_MS = 140;
  let employeeAccessScriptPromise = null;

  function currentPageName() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    return parts.pop() || "index.html";
  }

  function createMenuCopy(titleText, descriptionText) {
    const copy = document.createElement("span");
    const title = document.createElement("strong");
    const description = document.createElement("small");

    copy.className = "admin-more-menu-copy";
    title.textContent = titleText;
    description.textContent = descriptionText;
    copy.append(title, description);
    return copy;
  }

  function createEmployeesIcon() {
    const namespace = "http://www.w3.org/2000/svg";
    const icon = document.createElementNS(namespace, "svg");
    const head = document.createElementNS(namespace, "circle");
    const shoulders = document.createElementNS(namespace, "path");

    icon.classList.add("admin-more-menu-icon");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("focusable", "false");

    head.setAttribute("cx", "12");
    head.setAttribute("cy", "8");
    head.setAttribute("r", "3.25");
    shoulders.setAttribute("d", "M5.5 20c.45-4.05 2.65-6.25 6.5-6.25s6.05 2.2 6.5 6.25");

    icon.append(head, shoulders);
    return icon;
  }

  function createEmployeesAccessIcon() {
    const icon = document.createElement("span");
    const shackle = document.createElement("span");
    const body = document.createElement("span");

    icon.className = "admin-more-menu-access-icon";
    icon.setAttribute("aria-hidden", "true");
    shackle.className = "admin-more-menu-access-icon__shackle";
    body.className = "admin-more-menu-access-icon__body";
    icon.append(shackle, body);
    return icon;
  }

  function loadEmployeeAccessGuard() {
    if (window.AMEmployeeAccess) {
      return Promise.resolve(window.AMEmployeeAccess);
    }
    if (employeeAccessScriptPromise) {
      return employeeAccessScriptPromise;
    }

    employeeAccessScriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${EMPLOYEE_ACCESS_SCRIPT}"]`);
      const script = existing || document.createElement("script");

      const handleLoad = () => {
        if (window.AMEmployeeAccess) {
          resolve(window.AMEmployeeAccess);
          return;
        }
        reject(new Error("Employee access guard is unavailable."));
      };
      const handleError = () => reject(new Error("Employee access guard could not load."));

      script.addEventListener("load", handleLoad, { once: true });
      script.addEventListener("error", handleError, { once: true });
      if (!existing) {
        script.src = EMPLOYEE_ACCESS_SCRIPT;
        document.head.appendChild(script);
      }
    }).catch((error) => {
      employeeAccessScriptPromise = null;
      throw error;
    });

    return employeeAccessScriptPromise;
  }

  function showEmployeeAccessError() {
    const message = "Không thể xác thực quyền truy cập lúc này.";
    if (window.AMUI && typeof window.AMUI.toast === "function") {
      window.AMUI.toast(message, { type: "error" });
      return;
    }
    window.alert(message);
  }

  function createTrigger() {
    const button = document.createElement("button");
    const icon = document.createElement("span");
    const label = document.createElement("span");

    button.type = "button";
    button.className = "admin-more-trigger";
    button.setAttribute("aria-label", "Mở menu thêm");
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");

    icon.className = "admin-more-trigger-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));

    label.className = "admin-more-trigger-label";
    label.textContent = "Thêm";
    button.append(icon, label);
    return button;
  }

  function createAppointmentLink(isCurrentPage) {
    const link = document.createElement("a");

    link.className = "admin-more-menu-item";
    link.href = APPOINTMENT_PAGE;
    link.setAttribute("role", "menuitem");
    link.appendChild(createMenuCopy(
      "Lịch hẹn & nhắc việc",
      "Quản lý lịch gọi khách, báo giá, giao và nhận máy."
    ));

    if (isCurrentPage) {
      link.setAttribute("aria-current", "page");
    }

    return link;
  }

  function ensurePrimaryHandoverLink(nav, isCurrentPage) {
    const existing = nav.querySelector(`:scope > a[href="${HANDOVER_PAGE}"]`);
    const link = existing || document.createElement("a");

    link.href = HANDOVER_PAGE;
    link.textContent = "Bàn giao";

    if (isCurrentPage) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }

    if (existing) {
      return link;
    }

    const warrantyLink = nav.querySelector(':scope > a[href="warranty-search.html"]');
    if (warrantyLink) {
      nav.insertBefore(link, warrantyLink);
    } else {
      nav.insertBefore(link, nav.querySelector(":scope > [data-logout]") || null);
    }

    return link;
  }

  function createEmployeesLink(isCurrentPage) {
    const link = document.createElement("a");
    const accessIcon = createEmployeesAccessIcon();

    link.className = "admin-more-menu-item admin-more-menu-item-with-icon";
    link.href = EMPLOYEES_PAGE;
    link.setAttribute("role", "menuitem");
    link.dataset.employeeAccessLink = "true";
    link.append(
      createEmployeesIcon(),
      createMenuCopy(
        "Nhân viên",
        "Phân công công việc và theo dõi KPI hiệu suất."
      ),
      accessIcon
    );

    if (isCurrentPage) {
      link.setAttribute("aria-current", "page");
    }

    return link;
  }

  function prepareLogoutButton(button) {
    button.classList.add("admin-more-menu-item", "admin-more-logout");
    button.setAttribute("role", "menuitem");
    button.replaceChildren(createMenuCopy(
      "Đăng xuất",
      "Thoát khỏi tài khoản nội bộ."
    ));
    return button;
  }

  function createMobileMenuIcon(className) {
    const icon = document.createElement("span");
    icon.className = className;
    icon.setAttribute("aria-hidden", "true");
    icon.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
    return icon;
  }

  function initMobileDrawer(nav, closeMoreMenu) {
    const topbar = nav.closest(".topbar");

    if (!topbar || topbar.dataset.mobileNavReady === "true") {
      return;
    }

    topbar.dataset.mobileNavReady = "true";
    const media = window.matchMedia("(max-width: 900px)");
    const trigger = document.createElement("button");
    const triggerLabel = document.createElement("span");
    const close = document.createElement("button");
    const overlay = document.createElement("button");
    let isOpen = false;

    nav.id = nav.id || "adminPrimaryNavigation";
    trigger.type = "button";
    trigger.className = "admin-mobile-nav-trigger no-print";
    trigger.setAttribute("aria-label", "Mở menu chính");
    trigger.setAttribute("aria-controls", nav.id);
    trigger.setAttribute("aria-expanded", "false");
    triggerLabel.className = "admin-mobile-nav-label";
    triggerLabel.textContent = "Menu";
    trigger.append(createMobileMenuIcon("admin-mobile-nav-icon"), triggerLabel);

    close.type = "button";
    close.className = "admin-mobile-nav-close no-print";
    close.setAttribute("aria-label", "Đóng menu chính");
    close.textContent = "Đóng ×";

    overlay.type = "button";
    overlay.className = "admin-mobile-nav-overlay no-print";
    overlay.setAttribute("aria-label", "Đóng menu chính");
    overlay.hidden = true;

    nav.prepend(close);
    topbar.appendChild(trigger);
    document.body.appendChild(overlay);

    function setNavInert(inert) {
      if ("inert" in nav) {
        nav.inert = inert;
      }
    }

    function closeDrawer(options) {
      const config = options || {};
      isOpen = false;
      nav.classList.remove("mobile-open");
      document.body.classList.remove("admin-mobile-nav-open");
      trigger.setAttribute("aria-expanded", "false");
      overlay.hidden = true;
      if (typeof closeMoreMenu === "function") {
        closeMoreMenu();
      }

      if (media.matches) {
        nav.setAttribute("aria-hidden", "true");
        setNavInert(true);
      }

      if (config.returnFocus && document.contains(trigger)) {
        trigger.focus({ preventScroll: true });
      }
    }

    function openDrawer() {
      if (!media.matches) {
        return;
      }

      isOpen = true;
      nav.classList.add("mobile-open");
      document.body.classList.add("admin-mobile-nav-open");
      trigger.setAttribute("aria-expanded", "true");
      nav.setAttribute("aria-hidden", "false");
      setNavInert(false);
      overlay.hidden = false;
      close.focus({ preventScroll: true });
    }

    function syncViewport() {
      if (media.matches) {
        trigger.hidden = false;
        close.hidden = false;
        if (!isOpen) {
          nav.setAttribute("aria-hidden", "true");
          setNavInert(true);
        }
        return;
      }

      isOpen = false;
      trigger.hidden = true;
      close.hidden = true;
      overlay.hidden = true;
      nav.classList.remove("mobile-open");
      nav.removeAttribute("aria-hidden");
      setNavInert(false);
      document.body.classList.remove("admin-mobile-nav-open");
    }

    trigger.addEventListener("click", () => {
      if (isOpen) {
        closeDrawer({ returnFocus: true });
      } else {
        openDrawer();
      }
    });
    close.addEventListener("click", () => closeDrawer({ returnFocus: true }));
    overlay.addEventListener("click", () => closeDrawer({ returnFocus: true }));
    nav.addEventListener("click", (event) => {
      if (media.matches && event.target.closest("a[href], [data-logout]")) {
        closeDrawer();
      }
    });
    nav.addEventListener("keydown", (event) => {
      if (!media.matches || !isOpen || event.key !== "Tab") {
        return;
      }

      const focusable = Array.from(nav.querySelectorAll("a[href], button:not([disabled])"))
        .filter((element) => element.offsetParent !== null);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isOpen) {
        event.preventDefault();
        closeDrawer({ returnFocus: true });
      }
    });

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", syncViewport);
    } else {
      media.addListener(syncViewport);
    }

    syncViewport();
  }

  function initNavigation() {
    const nav = document.querySelector(".page-shell > .topbar .nav");
    const logoutButton = nav && nav.querySelector("[data-logout]");

    if (!nav || !logoutButton || nav.dataset.adminMoreReady === "true") {
      return;
    }

    nav.dataset.adminMoreReady = "true";

    const pageName = currentPageName();
    const isAppointmentPage = pageName === APPOINTMENT_PAGE;
    const isHandoverPage = pageName === HANDOVER_PAGE;
    const isEmployeesPage = pageName === EMPLOYEES_PAGE;
    const wrapper = document.createElement("div");
    const trigger = createTrigger();
    const menu = document.createElement("div");
    const menuHeading = document.createElement("span");
    const divider = document.createElement("span");
    const appointmentLink = createAppointmentLink(isAppointmentPage);
    const employeesLink = createEmployeesLink(isEmployeesPage);
    const employeesAccessIcon = employeesLink.querySelector(".admin-more-menu-access-icon");
    let closeTimerId = null;
    let hideTimerId = null;
    let openFrameId = null;
    let isOpen = false;
    let isClickLatched = false;

    wrapper.className = "admin-more-nav";
    menu.className = "admin-more-menu";
    menu.id = "adminMoreMenu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Menu thêm");
    menu.hidden = true;
    trigger.setAttribute("aria-controls", menu.id);

    menuHeading.className = "admin-more-menu-heading";
    menuHeading.textContent = "Menu thêm";
    divider.className = "admin-more-menu-divider";
    divider.setAttribute("aria-hidden", "true");

    ensurePrimaryHandoverLink(nav, isHandoverPage);

    if (isAppointmentPage || isEmployeesPage) {
      trigger.classList.add("active");
    }

    menu.append(
      menuHeading,
      appointmentLink,
      employeesLink,
      divider,
      prepareLogoutButton(logoutButton)
    );
    wrapper.append(trigger, menu);
    nav.appendChild(wrapper);

    function menuItems() {
      return Array.from(menu.querySelectorAll('[role="menuitem"]:not([disabled])'));
    }

    function clearCloseTimer() {
      if (closeTimerId) {
        window.clearTimeout(closeTimerId);
        closeTimerId = null;
      }
    }

    function clearVisualTimers() {
      if (hideTimerId) {
        window.clearTimeout(hideTimerId);
        hideTimerId = null;
      }

      if (openFrameId) {
        window.cancelAnimationFrame(openFrameId);
        openFrameId = null;
      }
    }

    function setOpen(nextOpen, options) {
      const params = options || {};
      clearCloseTimer();
      clearVisualTimers();
      isOpen = Boolean(nextOpen);
      if (!isOpen) {
        isClickLatched = false;
      }
      trigger.setAttribute("aria-expanded", String(isOpen));

      if (isOpen) {
        menu.hidden = false;
        menu.classList.remove("closing");
        openFrameId = window.requestAnimationFrame(() => {
          wrapper.classList.add("open");
          openFrameId = null;
        });
      } else {
        wrapper.classList.remove("open");
        menu.classList.add("closing");
        const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        hideTimerId = window.setTimeout(() => {
          menu.hidden = true;
          menu.classList.remove("closing");
          hideTimerId = null;
        }, reduceMotion ? 0 : EXIT_DURATION_MS);
      }

      if (isOpen && params.focusFirst) {
        const firstItem = menuItems()[0];
        if (firstItem) {
          firstItem.focus();
        }
      }

      if (!isOpen && params.returnFocus) {
        trigger.focus();
      }
    }

    function scheduleClose() {
      clearCloseTimer();
      closeTimerId = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
    }

    function supportsDesktopHover() {
      return window.innerWidth > 900
        && window.matchMedia
        && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    }

    wrapper.addEventListener("pointerenter", function (event) {
      if (event.pointerType === "mouse" && supportsDesktopHover()) {
        clearCloseTimer();
        setOpen(true);
      }
    });

    wrapper.addEventListener("pointerleave", function (event) {
      if (event.pointerType === "mouse" && supportsDesktopHover()) {
        scheduleClose();
      }
    });

    trigger.addEventListener("click", function () {
      if (isOpen && isClickLatched) {
        setOpen(false);
        return;
      }

      isClickLatched = true;
      setOpen(true);
    });

    employeesLink.addEventListener("click", async function (event) {
      if (
        event.button !== 0
        || event.metaKey
        || event.ctrlKey
        || event.shiftKey
        || event.altKey
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (employeesLink.getAttribute("aria-busy") === "true") {
        return;
      }

      setOpen(false);
      employeesLink.setAttribute("aria-busy", "true");
      try {
        const guard = await loadEmployeeAccessGuard();
        const unlocked = await guard.requireUnlock({
          mode: "menu",
          returnFocus: trigger
        });
        if (unlocked) {
          window.location.assign(EMPLOYEES_PAGE);
        }
      } catch (error) {
        showEmployeeAccessError();
      } finally {
        employeesLink.removeAttribute("aria-busy");
      }
    });

    document.addEventListener("am:employee-access-change", function (event) {
      const unlocked = Boolean(event.detail && event.detail.unlocked);
      if (employeesAccessIcon) {
        employeesAccessIcon.classList.toggle("is-unlocked", unlocked);
      }
    });

    if (
      employeesAccessIcon
      && window.AMEmployeeAccess
      && typeof window.AMEmployeeAccess.hasLocalUnlock === "function"
    ) {
      employeesAccessIcon.classList.toggle(
        "is-unlocked",
        window.AMEmployeeAccess.hasLocalUnlock()
      );
    }

    trigger.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setOpen(true, { focusFirst: true });
      }

      if (event.key === "Escape" && isOpen) {
        event.preventDefault();
        setOpen(false, { returnFocus: true });
      }
    });

    menu.addEventListener("keydown", function (event) {
      const items = menuItems();
      const currentIndex = items.indexOf(document.activeElement);

      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false, { returnFocus: true });
        return;
      }

      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
        return;
      }

      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = currentIndex < 0
        ? 0
        : (currentIndex + direction + items.length) % items.length;
      items[nextIndex].focus();
    });

    wrapper.addEventListener("focusout", function (event) {
      if (!wrapper.contains(event.relatedTarget)) {
        scheduleClose();
      }
    });

    document.addEventListener("click", function (event) {
      if (isOpen && !wrapper.contains(event.target)) {
        setOpen(false);
      }
    });

    initMobileDrawer(nav, () => setOpen(false));
  }

  document.addEventListener("DOMContentLoaded", function () {
    initNavigation();
  });
})();

(function () {
  "use strict";

  const APPOINTMENT_PAGE = "appointment-reminders.html";
  const CLOSE_DELAY_MS = 180;
  const EXIT_DURATION_MS = 140;

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

  function prepareLogoutButton(button) {
    button.classList.add("admin-more-menu-item", "admin-more-logout");
    button.setAttribute("role", "menuitem");
    button.replaceChildren(createMenuCopy(
      "Đăng xuất",
      "Thoát khỏi tài khoản nội bộ."
    ));
    return button;
  }

  function initNavigation() {
    const nav = document.querySelector(".page-shell > .topbar .nav");
    const logoutButton = nav && nav.querySelector("[data-logout]");

    if (!nav || !logoutButton || nav.dataset.adminMoreReady === "true") {
      return;
    }

    nav.dataset.adminMoreReady = "true";

    const isAppointmentPage = currentPageName() === APPOINTMENT_PAGE;
    const wrapper = document.createElement("div");
    const trigger = createTrigger();
    const menu = document.createElement("div");
    const menuHeading = document.createElement("span");
    const divider = document.createElement("span");
    const appointmentLink = createAppointmentLink(isAppointmentPage);
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

    if (isAppointmentPage) {
      trigger.classList.add("active");
    }

    menu.append(menuHeading, appointmentLink, divider, prepareLogoutButton(logoutButton));
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

    wrapper.addEventListener("pointerenter", function (event) {
      if (event.pointerType === "mouse") {
        clearCloseTimer();
        setOpen(true);
      }
    });

    wrapper.addEventListener("pointerleave", function (event) {
      if (event.pointerType === "mouse") {
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
  }

  document.addEventListener("DOMContentLoaded", initNavigation);
})();

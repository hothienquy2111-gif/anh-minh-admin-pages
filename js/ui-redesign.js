(function () {
  "use strict";

  const NAV_ICONS = {
    "ticket-activity.html": [
      "M4 6h16",
      "M4 12h10",
      "M4 18h7",
      "M17 15v6",
      "M14 18h6"
    ],
    "user-guide.html": [
      "M5 4.5h10a3 3 0 0 1 3 3v12H8a3 3 0 0 0-3 3z",
      "M8 8h7",
      "M8 12h7",
      "M8 16h5"
    ],
    "dashboard.html": [
      "M4 4h6v6H4z",
      "M14 4h6v6h-6z",
      "M4 14h6v6H4z",
      "M14 14h6v6h-6z"
    ],
    "overview.html": [
      "M4 19V9",
      "M10 19V5",
      "M16 19v-7",
      "M22 19H2"
    ],
    "ticket-history.html": [
      "M12 8v5l3 2",
      "M4.9 4.9A10 10 0 1 1 2 12",
      "M2 5v7h7"
    ],
    "new-ticket.html": [
      "M12 5v14",
      "M5 12h14",
      "M4 4h16v16H4z"
    ],
    "search.html": [
      "m20 20-4.4-4.4",
      "M10.8 18a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4z"
    ],
    "handover-tickets.html": [
      "M4 8l8-4 8 4-8 4z",
      "M4 8v9l8 4 8-4V8",
      "M12 12v9",
      "m15.5 14 1.5 1.5 3-3"
    ],
    "warranty-search.html": [
      "M12 3 5 6v5c0 4.6 2.8 8 7 10 4.2-2 7-5.4 7-10V6z",
      "m9 12 2 2 4-4"
    ],
    "invoice.html": [
      "M6 3h9l3 3v15H6z",
      "M15 3v4h4",
      "M9 12h6",
      "M9 16h6"
    ]
  };
  const SIDEBAR_STORAGE_KEY = "am-admin-sidebar-pinned";
  const PERSISTENCE_DISABLED = /(?:^|\/)invoice\.html$/.test(window.location.pathname);
  const DESKTOP_AUTO_QUERY = "(min-width: 901px) and (hover: hover) and (pointer: fine)";
  const MOBILE_QUERY = "(max-width: 900px)";
  const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
  const HOVER_OPEN_DELAY_MS = 55;
  const HOVER_CLOSE_DELAY_MS = 270;
  const OPEN_MOTION_DURATION_MS = 460;
  const CLOSE_MOTION_DURATION_MS = 380;
  const SIDEBAR_MOTION_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";
  const MIN_INTERRUPTED_MOTION_MS = 90;

  function readPinnedState() {
    if (PERSISTENCE_DISABLED) {
      return false;
    }
    try {
      return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
    } catch (_error) {
      return false;
    }
  }

  function writePinnedState(isPinned) {
    if (PERSISTENCE_DISABLED) {
      return;
    }
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(Boolean(isPinned)));
    } catch (_error) {
      // A blocked storage API must not break navigation.
    }
  }

  function applySidebarState(root, pinned, expanded) {
    root.setAttribute(
      "data-sidebar-state",
      pinned ? "pinned" : expanded ? "expanded" : "collapsed"
    );
  }

  const initialSidebarPinned = readPinnedState();
  document.documentElement.classList.add("am-ui-redesign");
  document.documentElement.dataset.amSidebarPinned = String(initialSidebarPinned);
  document.documentElement.dataset.amSidebarExpanded = String(initialSidebarPinned);
  applySidebarState(
    document.documentElement,
    initialSidebarPinned,
    initialSidebarPinned
  );

  function pageNameFromHref(href) {
    try {
      return new URL(href, window.location.href).pathname.split("/").pop();
    } catch (_error) {
      return "";
    }
  }

  function createNavigationIcon(paths) {
    const namespace = "http://www.w3.org/2000/svg";
    const icon = document.createElementNS(namespace, "svg");

    icon.classList.add("am-nav-icon");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("focusable", "false");
    icon.setAttribute("fill", "none");

    paths.forEach((pathData) => {
      const path = document.createElementNS(namespace, "path");
      path.setAttribute("d", pathData);
      icon.appendChild(path);
    });

    return icon;
  }

  function createPinIcon() {
    const namespace = "http://www.w3.org/2000/svg";
    const icon = document.createElementNS(namespace, "svg");
    const pin = document.createElementNS(namespace, "path");

    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("focusable", "false");
    pin.setAttribute("d", "m14 4 6 6-3 1-3.5 3.5L12 20l-2-2 5.5-5.5L19 9l1-3zM9 15l-5 5");
    icon.appendChild(pin);
    return icon;
  }

  function createPinButton(sidebarId) {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "am-sidebar-pin";
    button.setAttribute("aria-controls", sidebarId);
    button.appendChild(createPinIcon());
    return button;
  }

  function ensureInvoiceNavigationLink(navigation) {
    const existing = navigation.querySelector(':scope > a[href="invoice.html"]');
    if (existing) {
      return;
    }

    const link = document.createElement("a");
    link.href = "invoice.html";
    link.textContent = "Báo giá";

    if (pageNameFromHref(window.location.href) === "invoice.html") {
      link.setAttribute("aria-current", "page");
    }

    const moreMenu = navigation.querySelector(":scope > .admin-more-nav");
    if (moreMenu) {
      navigation.insertBefore(link, moreMenu);
      return;
    }

    const warrantyLink = navigation.querySelector(':scope > a[href="warranty-search.html"]');
    if (warrantyLink) {
      warrantyLink.insertAdjacentElement("afterend", link);
      return;
    }

    navigation.appendChild(link);
  }

  function enhancePrimaryNavigation() {
    const navigation = document.querySelector(".page-shell > .topbar .nav");
    if (!navigation || navigation.dataset.uiRedesignEnhanced === "true") {
      return;
    }

    navigation.dataset.uiRedesignEnhanced = "true";
    ensureInvoiceNavigationLink(navigation);
    navigation.querySelectorAll(":scope > a[href]").forEach((link) => {
      const pageName = pageNameFromHref(link.getAttribute("href"));
      const iconPaths = NAV_ICONS[pageName];
      if (!iconPaths || link.querySelector(".am-nav-icon")) {
        return;
      }

      const label = document.createElement("span");
      label.className = "am-nav-label";
      label.textContent = link.textContent.trim();
      link.replaceChildren(createNavigationIcon(iconPaths), label);
    });
  }

  function initializeSidebarBehavior() {
    const root = document.documentElement;
    const topbar = document.querySelector(".page-shell > .topbar");
    const pageShell = topbar && topbar.parentElement;
    const navigation = topbar && topbar.querySelector(".nav");
    const brand = topbar && topbar.querySelector(".brand");

    if (
      !topbar
      || !pageShell
      || !navigation
      || !brand
      || topbar.dataset.amSidebarReady === "true"
    ) {
      return;
    }

    topbar.dataset.amSidebarReady = "true";
    topbar.id = topbar.id || "amAdminSidebar";

    const sidebarHeader = document.createElement("div");
    const pinButton = createPinButton(topbar.id);
    const tooltip = document.createElement("div");
    const desktopAutoMedia = window.matchMedia(DESKTOP_AUTO_QUERY);
    const mobileMedia = window.matchMedia(MOBILE_QUERY);
    const reducedMotionMedia = window.matchMedia(REDUCED_MOTION_QUERY);
    let pinned = readPinnedState();
    let pointerInside = false;
    let focusInside = false;
    let menuOpen = false;
    let openTimerId = null;
    let closeTimerId = null;
    let animationTimerId = null;
    let tooltipTarget = null;
    let motionSequence = 0;
    let sidebarRevealAnimation = null;
    let sidebarShadowAnimation = null;
    let workspaceAnimations = new Map();
    let shellLayoutFrameId = null;
    const flipMotionSupported = Boolean(
      Element.prototype.animate
      && window.CSS
      && typeof window.CSS.supports === "function"
      && window.CSS.supports("clip-path", "inset(0 0 0 0)")
    );
    const sidebarShadow = flipMotionSupported
      ? document.createElement("div")
      : null;

    if (flipMotionSupported) {
      root.classList.add("am-sidebar-flip");
      sidebarShadow.className = "am-sidebar-shadow";
      sidebarShadow.setAttribute("aria-hidden", "true");
      document.body.appendChild(sidebarShadow);
    }

    function syncSidebarState() {
      applySidebarState(
        root,
        pinned,
        root.dataset.amSidebarExpanded === "true"
      );
    }

    sidebarHeader.className = "am-sidebar-header";
    brand.before(sidebarHeader);
    sidebarHeader.append(brand, pinButton);

    tooltip.id = "amSidebarTooltip";
    tooltip.className = "am-sidebar-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.setAttribute("aria-hidden", "true");
    tooltip.dataset.visible = "false";
    document.body.appendChild(tooltip);

    function clearTimer(timerName) {
      if (timerName === "open" && openTimerId) {
        window.clearTimeout(openTimerId);
        openTimerId = null;
      }

      if (timerName === "close" && closeTimerId) {
        window.clearTimeout(closeTimerId);
        closeTimerId = null;
      }
    }

    function cancelAnimation(animation) {
      if (!animation) {
        return;
      }

      try {
        animation.cancel();
      } catch (_error) {
        // A cancelled compositor animation must not interrupt navigation.
      }
    }

    function clearMotionAnimations() {
      motionSequence += 1;
      cancelAnimation(sidebarRevealAnimation);
      cancelAnimation(sidebarShadowAnimation);
      sidebarRevealAnimation = null;
      sidebarShadowAnimation = null;

      workspaceAnimations.forEach((animation, element) => {
        cancelAnimation(animation);
        element.classList.remove("am-workspace-motion-surface");
      });
      workspaceAnimations = new Map();

      if (animationTimerId) {
        window.clearTimeout(animationTimerId);
        animationTimerId = null;
      }
      root.classList.remove("am-sidebar-animating");
      delete root.dataset.amSidebarMotion;
    }

    function clearAnimationTimer() {
      clearMotionAnimations();
    }

    function syncShellLayout(options) {
      const params = options || {};

      if (params.reloadPinned) {
        pinned = readPinnedState();
      }
      syncInteractionMode({ animate: false });
    }

    function scheduleShellLayoutSync(options) {
      const params = options || {};

      hideTooltip();
      if (shellLayoutFrameId) {
        window.cancelAnimationFrame(shellLayoutFrameId);
      }
      shellLayoutFrameId = window.requestAnimationFrame(() => {
        shellLayoutFrameId = null;
        syncShellLayout(params);
      });
    }

    function hideTooltip() {
      if (tooltipTarget) {
        const previousDescription = tooltipTarget.dataset.amSidebarPreviousDescribedby;
        if (previousDescription) {
          tooltipTarget.setAttribute("aria-describedby", previousDescription);
        } else {
          tooltipTarget.removeAttribute("aria-describedby");
        }
        delete tooltipTarget.dataset.amSidebarPreviousDescribedby;
      }
      tooltipTarget = null;
      tooltip.dataset.visible = "false";
      tooltip.setAttribute("aria-hidden", "true");
    }

    function sidebarCanAutoCollapse() {
      return desktopAutoMedia.matches;
    }

    function shouldRemainExpanded() {
      return pinned || pointerInside || focusInside || menuOpen;
    }

    function cssPixelValue(propertyName, fallback) {
      const value = Number.parseFloat(
        window.getComputedStyle(root).getPropertyValue(propertyName)
      );
      return Number.isFinite(value) ? value : fallback;
    }

    function sidebarWidths() {
      return {
        collapsed: cssPixelValue("--sidebar-collapsed-width", 76),
        expanded: cssPixelValue("--sidebar-expanded-width", 272)
      };
    }

    function visibleWidthFromClipPath(clipPath, widths) {
      if (!clipPath || clipPath === "none") {
        return widths.expanded;
      }

      const match = clipPath.match(/^inset\((.+)\)$/);
      if (!match) {
        return root.dataset.amSidebarExpanded === "true"
          ? widths.expanded
          : widths.collapsed;
      }

      const values = match[1]
        .trim()
        .split(/\s+/)
        .map((value) => Number.parseFloat(value));
      let rightInset = 0;

      if (values.length === 1) {
        rightInset = values[0];
      } else if (values.length >= 2) {
        rightInset = values[1];
      }

      return Number.isFinite(rightInset)
        ? Math.max(widths.collapsed, widths.expanded - rightInset)
        : widths.collapsed;
    }

    function clipPathForState(expanded, widths) {
      const rightInset = expanded
        ? 0
        : Math.max(0, widths.expanded - widths.collapsed);
      return `inset(0px ${rightInset}px 0px 0px)`;
    }

    function activeWorkspaceSurfaces() {
      return Array.from(pageShell.children).filter((element) => {
        if (element === topbar || element.hidden) {
          return false;
        }

        return element.getClientRects().length > 0;
      });
    }

    function captureFirstMotionState() {
      const surfaces = activeWorkspaceSurfaces();
      const surfaceRects = surfaces.map((element) => ({
        element,
        rect: element.getBoundingClientRect()
      }));
      const clipPath = window.getComputedStyle(topbar).clipPath;
      const shadowLeft = sidebarShadow
        ? sidebarShadow.getBoundingClientRect().left
        : 0;

      return {
        surfaceRects,
        clipPath,
        shadowLeft,
        scrollX: window.scrollX,
        scrollY: window.scrollY
      };
    }

    function stopRunningMotionForRetarget() {
      motionSequence += 1;
      cancelAnimation(sidebarRevealAnimation);
      cancelAnimation(sidebarShadowAnimation);
      sidebarRevealAnimation = null;
      sidebarShadowAnimation = null;

      workspaceAnimations.forEach((animation, element) => {
        cancelAnimation(animation);
        element.classList.remove("am-workspace-motion-surface");
      });
      workspaceAnimations = new Map();

      if (animationTimerId) {
        window.clearTimeout(animationTimerId);
        animationTimerId = null;
      }
    }

    function commitExpandedState(expanded) {
      root.dataset.amSidebarExpanded = String(expanded);
      topbar.dataset.expanded = String(expanded);
      pinButton.setAttribute("aria-expanded", String(expanded));
      syncSidebarState();
    }

    function finishFlipMotion(sequence, expanded) {
      if (sequence !== motionSequence) {
        return;
      }

      motionSequence += 1;
      cancelAnimation(sidebarRevealAnimation);
      cancelAnimation(sidebarShadowAnimation);
      sidebarRevealAnimation = null;
      sidebarShadowAnimation = null;
      workspaceAnimations.forEach((animation, element) => {
        cancelAnimation(animation);
        element.classList.remove("am-workspace-motion-surface");
      });
      workspaceAnimations = new Map();

      if (animationTimerId) {
        window.clearTimeout(animationTimerId);
        animationTimerId = null;
      }

      root.classList.remove("am-sidebar-animating");
      root.dataset.amSidebarMotion = pinned
        ? "pinned"
        : expanded
          ? "expanded"
          : "collapsed";
      window.dispatchEvent(new CustomEvent("am:sidebar-motion-end", {
        detail: {
          expanded,
          pinned
        }
      }));
    }

    function playFlipMotion(firstState, expanded) {
      const widths = sidebarWidths();
      const targetClipPath = clipPathForState(expanded, widths);
      const currentVisibleWidth = visibleWidthFromClipPath(
        firstState.clipPath,
        widths
      );
      const targetVisibleWidth = expanded ? widths.expanded : widths.collapsed;
      const fullTravel = Math.max(1, widths.expanded - widths.collapsed);
      const travelRatio = Math.min(
        1,
        Math.max(0, Math.abs(targetVisibleWidth - currentVisibleWidth) / fullTravel)
      );
      const baseDuration = expanded
        ? OPEN_MOTION_DURATION_MS
        : CLOSE_MOTION_DURATION_MS;
      const duration = Math.max(
        MIN_INTERRUPTED_MOTION_MS,
        Math.round(baseDuration * travelRatio)
      );
      const sequence = ++motionSequence;
      const lastRects = new Map(
        firstState.surfaceRects.map(({ element }) => [
          element,
          element.getBoundingClientRect()
        ])
      );
      const animations = [];

      root.classList.add("am-sidebar-animating");
      root.dataset.amSidebarMotion = expanded ? "opening" : "closing";

      sidebarRevealAnimation = topbar.animate(
        [
          { clipPath: firstState.clipPath },
          { clipPath: targetClipPath }
        ],
        {
          duration,
          easing: SIDEBAR_MOTION_EASING,
          fill: "both"
        }
      );
      animations.push(sidebarRevealAnimation);

      if (sidebarShadow) {
        sidebarShadowAnimation = sidebarShadow.animate(
          [
            { transform: `translate3d(${firstState.shadowLeft}px, 0, 0)` },
            { transform: `translate3d(${targetVisibleWidth}px, 0, 0)` }
          ],
          {
            duration,
            easing: SIDEBAR_MOTION_EASING,
            fill: "both"
          }
        );
        animations.push(sidebarShadowAnimation);
      }

      firstState.surfaceRects.forEach(({ element, rect: firstRect }) => {
        const lastRect = lastRects.get(element);
        if (!lastRect || lastRect.width <= 0 || firstRect.width <= 0) {
          return;
        }

        const deltaX = firstRect.left - lastRect.left;
        const scaleX = firstRect.width / lastRect.width;
        if (Math.abs(deltaX) < 0.05 && Math.abs(scaleX - 1) < 0.0005) {
          return;
        }

        element.classList.add("am-workspace-motion-surface");
        const animation = element.animate(
          [
            {
              transform: `translate3d(${deltaX}px, 0, 0) scaleX(${scaleX})`,
              transformOrigin: "left top"
            },
            {
              transform: "translate3d(0, 0, 0) scaleX(1)",
              transformOrigin: "left top"
            }
          ],
          {
            duration,
            easing: SIDEBAR_MOTION_EASING,
            fill: "both"
          }
        );
        workspaceAnimations.set(element, animation);
        animations.push(animation);
      });

      if (
        window.scrollX !== firstState.scrollX
        || window.scrollY !== firstState.scrollY
      ) {
        window.scrollTo(firstState.scrollX, firstState.scrollY);
      }

      Promise.allSettled(animations.map((animation) => animation.finished))
        .then(() => finishFlipMotion(sequence, expanded));
      animationTimerId = window.setTimeout(
        () => finishFlipMotion(sequence, expanded),
        duration + 120
      );
    }

    function setExpanded(nextExpanded, options) {
      const params = options || {};
      const expanded = Boolean(nextExpanded);
      const current = root.dataset.amSidebarExpanded === "true";

      clearTimer("open");
      clearTimer("close");
      if (current === expanded) {
        if (params.animate === false) {
          clearMotionAnimations();
        }
        pinButton.setAttribute("aria-expanded", String(expanded));
        syncSidebarState();
        return;
      }

      hideTooltip();
      const shouldAnimate = params.animate !== false
        && !reducedMotionMedia.matches
        && !mobileMedia.matches;

      if (flipMotionSupported && shouldAnimate && desktopAutoMedia.matches) {
        const firstState = captureFirstMotionState();
        stopRunningMotionForRetarget();
        commitExpandedState(expanded);
        playFlipMotion(firstState, expanded);
        return;
      }

      clearMotionAnimations();
      commitExpandedState(expanded);
    }

    function openSidebar(delay) {
      clearTimer("close");
      clearTimer("open");
      if (!sidebarCanAutoCollapse() || root.dataset.amSidebarExpanded === "true") {
        return;
      }

      openTimerId = window.setTimeout(() => {
        openTimerId = null;
        setExpanded(true);
      }, Math.max(0, delay || 0));
    }

    function scheduleClose() {
      clearTimer("open");
      clearTimer("close");
      if (!sidebarCanAutoCollapse() || shouldRemainExpanded()) {
        return;
      }

      closeTimerId = window.setTimeout(() => {
        closeTimerId = null;
        if (!shouldRemainExpanded()) {
          setExpanded(false);
        }
      }, HOVER_CLOSE_DELAY_MS);
    }

    function syncPinButton() {
      const label = pinned ? "Bỏ ghim thanh điều hướng" : "Ghim thanh điều hướng mở";

      pinButton.hidden = !desktopAutoMedia.matches;
      pinButton.setAttribute("aria-pressed", String(pinned));
      pinButton.setAttribute("aria-label", label);
      pinButton.title = label;
      root.dataset.amSidebarPinned = String(pinned);
      syncSidebarState();
    }

    function syncInteractionMode(options) {
      const params = options || {};

      clearTimer("open");
      clearTimer("close");
      hideTooltip();
      syncPinButton();

      if (mobileMedia.matches) {
        pointerInside = false;
        focusInside = false;
        setExpanded(false, { animate: false });
        return;
      }

      if (!desktopAutoMedia.matches) {
        setExpanded(true, { animate: false });
        return;
      }

      setExpanded(pinned || shouldRemainExpanded(), {
        animate: params.animate !== false
      });
    }

    function currentMenuOpenState() {
      const moreWrapper = navigation.querySelector(".admin-more-nav");
      const moreTrigger = navigation.querySelector(".admin-more-trigger");

      return Boolean(
        (moreWrapper && moreWrapper.classList.contains("open"))
        || (moreTrigger && moreTrigger.getAttribute("aria-expanded") === "true")
      );
    }

    function syncMenuOpenState() {
      const nextMenuOpen = currentMenuOpenState();
      if (menuOpen === nextMenuOpen) {
        return;
      }

      menuOpen = nextMenuOpen;
      root.classList.toggle("am-sidebar-menu-open", menuOpen);
      if (menuOpen) {
        clearTimer("close");
        setExpanded(true);
      } else {
        scheduleClose();
      }
    }

    function tooltipControlFromEventTarget(target) {
      if (!(target instanceof Element)) {
        return null;
      }

      const control = target.closest("[data-am-sidebar-tooltip]");
      return control && topbar.contains(control) ? control : null;
    }

    function showTooltip(control) {
      if (
        !control
        || !desktopAutoMedia.matches
        || root.dataset.amSidebarExpanded === "true"
      ) {
        hideTooltip();
        return;
      }

      const text = control.dataset.amSidebarTooltip;
      if (!text) {
        return;
      }

      if (tooltipTarget !== control) {
        hideTooltip();
        tooltipTarget = control;
        const previousDescription = control.getAttribute("aria-describedby") || "";
        control.dataset.amSidebarPreviousDescribedby = previousDescription;
        control.setAttribute(
          "aria-describedby",
          previousDescription ? `${previousDescription} ${tooltip.id}` : tooltip.id
        );
      }

      tooltip.textContent = text;
      tooltip.dataset.visible = "true";
      tooltip.setAttribute("aria-hidden", "false");

      const controlRect = control.getBoundingClientRect();
      const tooltipWidth = tooltip.offsetWidth;
      const tooltipHeight = tooltip.offsetHeight;
      const safeGap = 10;
      const safeEdge = 8;
      const widths = sidebarWidths();
      const sidebarRight = flipMotionSupported
        ? visibleWidthFromClipPath(window.getComputedStyle(topbar).clipPath, widths)
        : controlRect.right;
      const left = Math.min(
        sidebarRight + safeGap,
        window.innerWidth - tooltipWidth - safeEdge
      );
      const centerY = controlRect.top + (controlRect.height / 2);
      const top = Math.min(
        Math.max(centerY, (tooltipHeight / 2) + safeEdge),
        window.innerHeight - (tooltipHeight / 2) - safeEdge
      );

      tooltip.style.left = `${Math.max(safeEdge, left)}px`;
      tooltip.style.top = `${top}px`;
    }

    function decorateTooltipControls() {
      const controls = [
        ...navigation.querySelectorAll(":scope > a[href]"),
        ...navigation.querySelectorAll(":scope > .admin-more-nav > .admin-more-trigger")
      ];

      controls.forEach((control) => {
        const label = control.querySelector(".am-nav-label, .admin-more-trigger-label");
        const text = label ? label.textContent.trim() : control.textContent.trim();
        if (text) {
          control.dataset.amSidebarTooltip = text;
        }
      });
    }

    pinButton.addEventListener("click", function () {
      pinned = !pinned;
      writePinnedState(pinned);
      syncPinButton();

      if (pinned) {
        setExpanded(true);
      } else if (!shouldRemainExpanded()) {
        scheduleClose();
      }
    });

    topbar.addEventListener("pointerenter", function (event) {
      if (event.pointerType !== "mouse" || !desktopAutoMedia.matches) {
        return;
      }

      pointerInside = true;
      clearTimer("close");
      openSidebar(HOVER_OPEN_DELAY_MS);
    });

    topbar.addEventListener("pointerleave", function (event) {
      if (event.pointerType !== "mouse" || !desktopAutoMedia.matches) {
        return;
      }

      pointerInside = false;
      scheduleClose();
    });

    topbar.addEventListener("pointerover", function (event) {
      showTooltip(tooltipControlFromEventTarget(event.target));
    });

    topbar.addEventListener("pointerout", function (event) {
      const control = tooltipControlFromEventTarget(event.target);
      if (!control || control !== tooltipTarget) {
        return;
      }

      if (event.relatedTarget instanceof Node && control.contains(event.relatedTarget)) {
        return;
      }

      hideTooltip();
    });

    topbar.addEventListener("focusin", function () {
      if (mobileMedia.matches) {
        focusInside = false;
        return;
      }

      focusInside = true;
      clearTimer("close");
      setExpanded(true);
    });

    topbar.addEventListener("focusout", function () {
      window.setTimeout(() => {
        if (mobileMedia.matches) {
          focusInside = false;
          return;
        }

        focusInside = topbar.contains(document.activeElement);
        if (!focusInside) {
          scheduleClose();
        }
      }, 0);
    });

    topbar.addEventListener("transitionend", function (event) {
      if (
        !flipMotionSupported
        && event.target === topbar
        && event.propertyName === "width"
      ) {
        clearAnimationTimer();
      }
    });

    const menuObserver = new MutationObserver(syncMenuOpenState);
    menuObserver.observe(navigation, {
      attributes: true,
      attributeFilter: ["aria-expanded", "class", "hidden"],
      childList: true,
      subtree: true
    });

    const scheduleViewportSync = () => scheduleShellLayoutSync();
    desktopAutoMedia.addEventListener("change", scheduleViewportSync);
    mobileMedia.addEventListener("change", scheduleViewportSync);
    reducedMotionMedia.addEventListener("change", scheduleViewportSync);

    window.addEventListener("resize", scheduleViewportSync, { passive: true });
    window.addEventListener("scroll", hideTooltip, { passive: true });
    window.addEventListener("storage", function (event) {
      if (event.key !== SIDEBAR_STORAGE_KEY) {
        return;
      }

      pinned = event.newValue === "true";
      syncPinButton();
      syncInteractionMode();
    });
    window.addEventListener("pageshow", function () {
      scheduleShellLayoutSync({ reloadPinned: true });
    });
    window.addEventListener("pagehide", function () {
      clearTimer("open");
      clearTimer("close");
      clearAnimationTimer();
      if (shellLayoutFrameId) {
        window.cancelAnimationFrame(shellLayoutFrameId);
        shellLayoutFrameId = null;
      }
      hideTooltip();
    });

    decorateTooltipControls();
    syncMenuOpenState();
    syncShellLayout();
    if (document.readyState === "complete") {
      scheduleShellLayoutSync();
    } else {
      window.addEventListener("load", scheduleViewportSync, { once: true });
    }
  }

  function addSkipLink() {
    const main = document.querySelector("main");
    if (!main || document.querySelector(".am-skip-link")) {
      return;
    }

    main.id = main.id || "mainContent";
    const link = document.createElement("a");
    link.className = "am-skip-link";
    link.href = `#${main.id}`;
    link.textContent = "Bỏ qua menu";
    document.body.prepend(link);
  }

  function initializeRedesignLayer() {
    document.documentElement.classList.add("am-ui-redesign");
    addSkipLink();
    enhancePrimaryNavigation();
    initializeSidebarBehavior();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeRedesignLayer, { once: true });
  } else {
    initializeRedesignLayer();
  }
})();

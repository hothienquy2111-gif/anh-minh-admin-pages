(function () {
  "use strict";

  let initialized = false;

  function normalizeSearchText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function sectionById(id) {
    return document.getElementById(id);
  }

  function setActiveSection(id) {
    if (!id) {
      return;
    }

    document.querySelectorAll("[data-guide-target]").forEach((link) => {
      const isActive = link.dataset.guideTarget === id;
      link.classList.toggle("is-active", isActive);
      if (isActive) {
        link.setAttribute("aria-current", "true");
      } else {
        link.removeAttribute("aria-current");
      }
    });

    const select = document.getElementById("guideTocSelect");
    if (select && select.value !== id) {
      select.value = id;
    }
  }

  function scrollToSection(id) {
    const section = sectionById(id);
    if (!section || section.hidden) {
      return;
    }

    setActiveSection(id);
    section.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "start"
    });
  }

  function setupToc() {
    document.querySelectorAll("[data-guide-target]").forEach((link) => {
      link.addEventListener("click", function (event) {
        event.preventDefault();
        scrollToSection(link.dataset.guideTarget);
      });
    });

    const select = document.getElementById("guideTocSelect");
    if (select) {
      select.addEventListener("change", function () {
        scrollToSection(select.value);
      });
    }

    const sections = Array.from(document.querySelectorAll("[data-guide-section]"));
    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver((entries) => {
        const visibleEntry = entries
          .filter((entry) => entry.isIntersecting && !entry.target.hidden)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (visibleEntry) {
          setActiveSection(visibleEntry.target.id);
        }
      }, {
        rootMargin: "-25% 0px -65% 0px",
        threshold: [0.1, 0.3, 0.6]
      });

      sections.forEach((section) => observer.observe(section));
    }

    if (sections[0]) {
      setActiveSection(sections[0].id);
    }
  }

  function updateSearchResults(query) {
    const normalizedQuery = normalizeSearchText(query);
    const sections = Array.from(document.querySelectorAll("[data-guide-section]"));
    const emptyState = document.getElementById("guideEmptyState");
    let visibleCount = 0;

    sections.forEach((section) => {
      const sectionText = normalizeSearchText(`${section.textContent} ${section.dataset.guideKeywords || ""}`);
      const isMatch = !normalizedQuery || sectionText.includes(normalizedQuery);

      section.hidden = !isMatch;
      section.classList.toggle("is-search-match", Boolean(normalizedQuery && isMatch));

      const tocLink = document.querySelector(`[data-guide-target="${section.id}"]`);
      if (tocLink) {
        tocLink.hidden = !isMatch;
      }

      const option = document.querySelector(`#guideTocSelect option[value="${section.id}"]`);
      if (option) {
        option.hidden = !isMatch;
      }

      if (isMatch) {
        visibleCount += 1;
      }
    });

    if (emptyState) {
      emptyState.hidden = visibleCount > 0;
    }

    const firstVisible = sections.find((section) => !section.hidden);
    if (firstVisible) {
      setActiveSection(firstVisible.id);
    }
  }

  function setupSearch() {
    const input = document.getElementById("guideSearchInput");
    const clearButton = document.getElementById("guideSearchClear");

    if (!input || !clearButton) {
      return;
    }

    input.addEventListener("input", function () {
      const hasValue = input.value.trim().length > 0;
      clearButton.hidden = !hasValue;
      updateSearchResults(input.value);
    });

    clearButton.addEventListener("click", function () {
      input.value = "";
      clearButton.hidden = true;
      updateSearchResults("");
      input.focus();
    });
  }

  function setFaqOpen(button, open) {
    const panelId = button.getAttribute("aria-controls");
    const panel = panelId ? document.getElementById(panelId) : null;

    button.setAttribute("aria-expanded", open ? "true" : "false");
    if (panel) {
      panel.hidden = !open;
    }
  }

  function setupFaq() {
    const questions = Array.from(document.querySelectorAll(".guide-faq-question"));
    const expandAll = document.getElementById("guideExpandAll");
    const collapseAll = document.getElementById("guideCollapseAll");

    questions.forEach((button) => {
      button.addEventListener("click", function () {
        const isOpen = button.getAttribute("aria-expanded") === "true";
        setFaqOpen(button, !isOpen);
      });
    });

    if (expandAll) {
      expandAll.addEventListener("click", function () {
        questions.forEach((button) => setFaqOpen(button, true));
      });
    }

    if (collapseAll) {
      collapseAll.addEventListener("click", function () {
        questions.forEach((button) => setFaqOpen(button, false));
      });
    }
  }

  function setupLogout() {
    const logoutButton = document.querySelector("[data-logout]");
    if (!logoutButton || !window.AMApi || typeof window.AMApi.signOut !== "function") {
      return;
    }

    logoutButton.addEventListener("click", function () {
      window.AMApi.signOut(true);
    });
  }

  async function requireAccess() {
    if (!window.AMApi || typeof window.AMApi.requireInternalAccess !== "function") {
      window.location.replace("login.html");
      return;
    }

    await window.AMApi.requireInternalAccess();
  }

  async function init() {
    if (initialized) {
      return;
    }
    initialized = true;

    await requireAccess();
    setupLogout();
    setupSearch();
    setupToc();
    setupFaq();
  }

  document.addEventListener("DOMContentLoaded", function () {
    init().catch(() => {
      window.location.replace("login.html");
    });
  });
})();

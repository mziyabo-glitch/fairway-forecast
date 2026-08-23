import { esc } from "../../../shared/utils.js";

const NAV_ITEMS = [
  { id: "home", label: "Home", icon: "home" },
  { id: "courses", label: "Courses", icon: "search" },
  { id: "forecast", label: "Forecast", icon: "cloud-sun" },
  { id: "rounds", label: "Rounds", icon: "flag" },
];

let sheetTrigger = null;

export function renderAppShell(activeTab = "home") {
  return `
    <div class="fw-dev-banner" role="status">
      <span class="fw-dev-dot" aria-hidden="true"></span>
      <span>DEV — Rebuild Preview (Milestone 1.5)</span>
      <a href="/" class="fw-dev-link">Production</a>
    </div>
    <div class="fw-app">
      <header id="fwCourseHeaderMount" class="fw-course-header-mount" aria-live="polite"></header>
      <main id="fwMain" class="fw-main" tabindex="-1"></main>
      <nav class="fw-bottom-nav" aria-label="Main navigation">
        ${NAV_ITEMS.map(
          (item) => `
          <button type="button" class="fw-nav-item ${item.id === activeTab ? "is-active" : ""}"
            data-tab="${item.id}" aria-current="${item.id === activeTab ? "page" : "false"}">
            <i data-lucide="${item.icon}" class="fw-nav-icon" aria-hidden="true"></i>
            <span class="fw-nav-label">${esc(item.label)}</span>
          </button>`
        ).join("")}
      </nav>
    </div>
    <div id="fwSheetBackdrop" class="fw-sheet-backdrop" hidden></div>
    <div id="fwSheet" class="fw-sheet" role="dialog" aria-modal="true" aria-labelledby="fwSheetTitle" hidden>
      <div class="fw-sheet-handle" aria-hidden="true"></div>
      <div class="fw-sheet-header">
        <h2 id="fwSheetTitle" class="fw-sheet-title"></h2>
        <button type="button" id="fwSheetClose" class="fw-sheet-close" aria-label="Close dialog">×</button>
      </div>
      <div id="fwSheetBody" class="fw-sheet-body"></div>
    </div>
  `;
}

export function wireBottomNav(onTabChange) {
  document.querySelectorAll(".fw-nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab");
      if (tab) onTabChange(tab);
    });
  });
}

export function setActiveTab(tab) {
  document.querySelectorAll(".fw-nav-item").forEach((btn) => {
    const isActive = btn.getAttribute("data-tab") === tab;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-current", isActive ? "page" : "false");
  });
}

function getFocusable(container) {
  return container.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
}

function trapFocus(e, sheet) {
  if (e.key !== "Tab" || sheet.hidden) return;
  const focusable = getFocusable(sheet);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

export function openSheet(title, bodyHtml, triggerEl = null) {
  const backdrop = document.getElementById("fwSheetBackdrop");
  const sheet = document.getElementById("fwSheet");
  const titleEl = document.getElementById("fwSheetTitle");
  const bodyEl = document.getElementById("fwSheetBody");
  if (!backdrop || !sheet || !titleEl || !bodyEl) return;

  sheetTrigger = triggerEl || document.activeElement;
  titleEl.textContent = title;
  bodyEl.innerHTML = bodyHtml;
  backdrop.hidden = false;
  sheet.hidden = false;
  document.body.classList.add("fw-sheet-open");
  document.getElementById("fwSheetClose")?.focus();
}

export function closeSheet() {
  const backdrop = document.getElementById("fwSheetBackdrop");
  const sheet = document.getElementById("fwSheet");
  if (backdrop) backdrop.hidden = true;
  if (sheet) sheet.hidden = true;
  document.body.classList.remove("fw-sheet-open");
  if (sheetTrigger?.focus) sheetTrigger.focus();
  sheetTrigger = null;
}

export function wireSheet() {
  document.getElementById("fwSheetClose")?.addEventListener("click", closeSheet);
  document.getElementById("fwSheetBackdrop")?.addEventListener("click", closeSheet);
  document.addEventListener("keydown", (e) => {
    const sheet = document.getElementById("fwSheet");
    if (e.key === "Escape" && sheet && !sheet.hidden) closeSheet();
    trapFocus(e, sheet);
  });
}

import { esc } from "../../shared/utils.js";

const NAV_ITEMS = [
  { id: "home", label: "Home", icon: "home" },
  { id: "courses", label: "Courses", icon: "search" },
  { id: "forecast", label: "Forecast", icon: "cloud-sun" },
  { id: "rounds", label: "Rounds", icon: "flag" },
];

export function renderAppShell(activeTab = "forecast") {
  return `
    <div class="fw-dev-banner" role="status">
      <span class="fw-dev-dot" aria-hidden="true"></span>
      <span>DEV — Rebuild Preview</span>
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
        <button type="button" id="fwSheetClose" class="fw-sheet-close" aria-label="Close">×</button>
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

export function openSheet(title, bodyHtml) {
  const backdrop = document.getElementById("fwSheetBackdrop");
  const sheet = document.getElementById("fwSheet");
  const titleEl = document.getElementById("fwSheetTitle");
  const bodyEl = document.getElementById("fwSheetBody");
  if (!backdrop || !sheet || !titleEl || !bodyEl) return;

  titleEl.textContent = title;
  bodyEl.innerHTML = bodyHtml;
  backdrop.hidden = false;
  sheet.hidden = false;
  document.body.classList.add("fw-sheet-open");
}

export function closeSheet() {
  const backdrop = document.getElementById("fwSheetBackdrop");
  const sheet = document.getElementById("fwSheet");
  if (backdrop) backdrop.hidden = true;
  if (sheet) sheet.hidden = true;
  document.body.classList.remove("fw-sheet-open");
}

export function wireSheet() {
  document.getElementById("fwSheetClose")?.addEventListener("click", closeSheet);
  document.getElementById("fwSheetBackdrop")?.addEventListener("click", closeSheet);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSheet();
  });
}

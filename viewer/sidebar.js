// sidebar.js – Themen- und Projekt-Verwaltung (Sidebar)
// Nutzt ausschließlich storage.js für Datenzugriff

import { storageManager, DEFAULT_PROJECT_ID } from "./storage.js";

// ── DOM-Referenzen ────────────────────────────────────────────────────────

const sidebar         = document.getElementById("sidebar");
const btnToggle       = document.getElementById("btn-sidebar-toggle");
const viewerContainer = document.getElementById("viewer-container");
const btnNewTheme     = document.getElementById("btn-new-theme");
const themeForm       = document.getElementById("theme-form");
const themeNameInput  = document.getElementById("theme-name-input");
const themeColorInput = document.getElementById("theme-color-input");
const btnSaveTheme    = document.getElementById("btn-save-theme");
const btnCancelTheme  = document.getElementById("btn-cancel-theme");
const themeList       = document.getElementById("theme-list");
const themeEmptyHint  = document.getElementById("theme-empty-hint");

// Projekt-Bereich
const projectSelect      = document.getElementById("project-select");
const btnManageProjects  = document.getElementById("btn-manage-projects");

// Projekt-Modal
const projectModal         = document.getElementById("project-modal");
const btnCloseProjectModal = document.getElementById("btn-close-project-modal");
const btnNewProject        = document.getElementById("btn-new-project");
const projectEditForm      = document.getElementById("project-edit-form");
const projectNameInput     = document.getElementById("project-name-input");
const projectDescInput     = document.getElementById("project-desc-input");
const projectColorInput    = document.getElementById("project-color-input");
const btnSaveProject       = document.getElementById("btn-save-project");
const btnCancelProject     = document.getElementById("btn-cancel-project");
const projectListEl        = document.getElementById("project-list");

// Backup-Bereich
const btnBackupExport  = document.getElementById("btn-backup-export");
const btnBackupImport  = document.getElementById("btn-backup-import");
const backupFileInput  = document.getElementById("backup-file-input");

// ── Zustand ───────────────────────────────────────────────────────────────

let themes          = [];      // Themen des aktiven Projekts
let editingId       = null;    // ID des gerade bearbeiteten Themas (null = Neu)
let sidebarOpen     = false;
let activeProjectId = DEFAULT_PROJECT_ID;
let projects        = [];      // Alle Projekte

let editingProjectId = null;   // ID des gerade bearbeiteten Projekts (null = Neu)

// ── Sidebar Toggle ────────────────────────────────────────────────────────

function toggleSidebar() {
  sidebarOpen = !sidebarOpen;
  sidebar.classList.toggle("open", sidebarOpen);
  viewerContainer.classList.toggle("sidebar-open", sidebarOpen);
}

btnToggle.addEventListener("click", toggleSidebar);

// Ctrl+Shift+S: Sidebar öffnen/schließen
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === "S") {
    e.preventDefault();
    toggleSidebar();
  }
});

// ── Projekt-Verwaltung ────────────────────────────────────────────────────

// Alle Projekte aus der Datenbank laden
async function loadProjects() {
  const all = await storageManager.getProjects();
  // Standard-Projekt zuerst, dann alphabetisch
  projects = all.sort((a, b) => {
    if (a.id === DEFAULT_PROJECT_ID) return -1;
    if (b.id === DEFAULT_PROJECT_ID) return  1;
    return a.name.localeCompare(b.name);
  });
  renderProjectDropdown();
}

// Projekt-Dropdown befüllen
function renderProjectDropdown() {
  projectSelect.innerHTML = "";
  for (const p of projects) {
    const opt = document.createElement("option");
    opt.value       = p.id;
    opt.textContent = p.name;
    if (p.id === activeProjectId) opt.selected = true;
    projectSelect.appendChild(opt);
  }
}

// Projekt wechseln
async function switchProject(projectId) {
  activeProjectId = projectId;
  window.activeProjectId = projectId;

  const project = projects.find(p => p.id === projectId);
  window.activeProjectName = project?.name ?? "Standard";

  await storageManager.touchProject(projectId);
  await loadThemes();

  // coding.js über Projektwechsel informieren
  window.codingApi?.switchProject?.(projectId);
}

// Projekt-Dropdown: Änderung durch Nutzer
projectSelect.addEventListener("change", () => {
  switchProject(projectSelect.value);
});

// Schaltfläche "Verwalten"
btnManageProjects.addEventListener("click", openProjectModal);

// ── Projekt-Modal ─────────────────────────────────────────────────────────

function openProjectModal() {
  projectEditForm.hidden = true;
  editingProjectId = null;
  renderProjectList();
  projectModal.hidden = false;
}

function closeProjectModal() {
  projectModal.hidden = true;
  projectEditForm.hidden = true;
  editingProjectId = null;
}

btnCloseProjectModal.addEventListener("click", closeProjectModal);

// Klick außerhalb des Dialogs schließt Modal
projectModal.addEventListener("click", (e) => {
  if (e.target === projectModal) closeProjectModal();
});

// "Neues Projekt"-Schaltfläche
btnNewProject.addEventListener("click", () => {
  editingProjectId = null;
  projectNameInput.value  = "";
  projectDescInput.value  = "";
  projectColorInput.value = "#89b4fa";
  projectEditForm.hidden  = false;
  projectNameInput.focus();
});

// Abbrechen im Formular
btnCancelProject.addEventListener("click", () => {
  projectEditForm.hidden = true;
  editingProjectId = null;
});

// Speichern im Formular
btnSaveProject.addEventListener("click", saveProject);

projectNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter")  saveProject();
  if (e.key === "Escape") { projectEditForm.hidden = true; editingProjectId = null; }
});

// Projekt speichern (erstellen oder aktualisieren)
async function saveProject() {
  const name  = projectNameInput.value.trim();
  const desc  = projectDescInput.value.trim();
  const color = projectColorInput.value;

  if (!name) {
    projectNameInput.focus();
    return;
  }

  if (editingProjectId) {
    await storageManager.updateProject(editingProjectId, { name, description: desc, color });
  } else {
    await storageManager.createProject({ name, description: desc, color });
  }

  projectEditForm.hidden = true;
  editingProjectId = null;

  await loadProjects();
  renderProjectList();
}

// Projekt-Liste im Modal rendern
async function renderProjectList() {
  projectListEl.innerHTML = "";
  await loadProjects();

  for (const p of projects) {
    const div = document.createElement("div");
    div.className = "project-item";

    div.innerHTML = `
      <span class="project-color-dot" style="background:${escapeHtml(p.color ?? "#89b4fa")}"></span>
      <span class="project-item-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
      <div class="project-item-actions">
        <button class="btn-icon edit"      title="Bearbeiten">✎</button>
        <button class="btn-icon duplicate" title="Duplizieren">⧉</button>
        ${p.id !== DEFAULT_PROJECT_ID
          ? `<button class="btn-icon delete" title="Löschen">✕</button>`
          : ""}
      </div>
    `;

    div.querySelector(".edit").addEventListener("click", () => {
      editingProjectId        = p.id;
      projectNameInput.value  = p.name;
      projectDescInput.value  = p.description ?? "";
      projectColorInput.value = p.color ?? "#89b4fa";
      projectEditForm.hidden  = false;
      projectNameInput.focus();
    });

    div.querySelector(".duplicate").addEventListener("click", async () => {
      await duplicateProject(p.id);
    });

    const delBtn = div.querySelector(".delete");
    if (delBtn) {
      delBtn.addEventListener("click", async () => {
        await deleteProject(p.id, p.name);
      });
    }

    projectListEl.appendChild(div);
  }
}

// Projekt duplizieren
async function duplicateProject(id) {
  await storageManager.duplicateProject(id);
  await loadProjects();
  renderProjectList();
  showToast("Projekt dupliziert.");
}

// Projekt löschen (mit Bestätigung)
async function deleteProject(id, name) {
  if (!confirm(`Projekt „${name}" und alle zugehörigen Themen und Codierungen löschen?`)) return;

  try {
    await storageManager.deleteProject(id);
  } catch (err) {
    alert(err.message);
    return;
  }

  // Falls aktives Projekt gelöscht wurde: auf Standard wechseln
  if (activeProjectId === id) {
    activeProjectId = DEFAULT_PROJECT_ID;
    await switchProject(DEFAULT_PROJECT_ID);
  }

  await loadProjects();
  renderProjectList();
}

// ── Themen-Verwaltung ─────────────────────────────────────────────────────

// Themen des aktiven Projekts laden
async function loadThemes() {
  themes = await storageManager.getThemes(activeProjectId);
  renderThemeList();
  notifyThemesUpdated();
}

// ── UUID generieren ───────────────────────────────────────────────────────

function generateId() {
  return "theme-" + crypto.randomUUID();
}

// ── Formular ──────────────────────────────────────────────────────────────

function openForm(theme = null) {
  editingId = theme?.id ?? null;
  themeNameInput.value  = theme?.name  ?? "";
  themeColorInput.value = theme?.color ?? "#FF6B6B";
  themeForm.hidden = false;
  themeNameInput.focus();
}

function closeForm() {
  themeForm.hidden = true;
  themeNameInput.value = "";
  editingId = null;
}

async function submitForm() {
  const name  = themeNameInput.value.trim();
  const color = themeColorInput.value;

  if (!name) {
    themeNameInput.focus();
    return;
  }

  if (editingId) {
    // Bestehendes Thema aktualisieren
    const existing = themes.find(t => t.id === editingId);
    if (existing) {
      await storageManager.saveTheme({ ...existing, name, color });
    }
  } else {
    // Neues Thema erstellen
    const newTheme = {
      id:         generateId(),
      project_id: activeProjectId,
      name,
      color,
      sort_order: themes.length,
      created_at: new Date().toISOString(),
    };
    await storageManager.saveTheme(newTheme);
  }

  await loadThemes();
  closeForm();
}

btnNewTheme.addEventListener("click", () => openForm());
btnSaveTheme.addEventListener("click", submitForm);
btnCancelTheme.addEventListener("click", closeForm);

themeNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter")  submitForm();
  if (e.key === "Escape") closeForm();
});

// ── Themen-Liste rendern ──────────────────────────────────────────────────

let dragSrcIndex = null;

function renderThemeList() {
  themeList.innerHTML = "";
  themeEmptyHint.hidden = themes.length > 0;

  themes.forEach((theme, idx) => {
    const li = document.createElement("li");
    li.className = "theme-item";
    li.dataset.id = theme.id;
    li.draggable = true;

    const shortcutHtml = idx < 9
      ? `<span class="theme-shortcut" title="Tastaturkürzel">⌃⇧${idx + 1}</span>`
      : "";

    li.innerHTML = `
      <span class="theme-drag-handle" title="Ziehen zum Neuanordnen">⠿</span>
      <span class="theme-dot" style="background:${theme.color}"></span>
      <span class="theme-name" title="${escapeHtml(theme.name)}">${escapeHtml(theme.name)}</span>
      ${shortcutHtml}
      <span class="theme-actions">
        <button class="btn-icon edit"   title="Bearbeiten">✎</button>
        <button class="btn-icon delete" title="Löschen">✕</button>
      </span>
    `;

    li.querySelector(".edit").addEventListener("click", () => openForm(theme));
    li.querySelector(".delete").addEventListener("click", () => deleteTheme(theme.id, theme.name));

    // ── Drag & Drop ──
    li.addEventListener("dragstart", (e) => {
      dragSrcIndex = idx;
      li.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });

    li.addEventListener("dragend", () => {
      li.classList.remove("dragging");
      themeList.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
    });

    li.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      themeList.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
      if (dragSrcIndex !== idx) li.classList.add("drag-over");
    });

    li.addEventListener("dragleave", () => {
      li.classList.remove("drag-over");
    });

    li.addEventListener("drop", async (e) => {
      e.preventDefault();
      li.classList.remove("drag-over");
      if (dragSrcIndex === null || dragSrcIndex === idx) return;

      // Reihenfolge anpassen
      const moved = themes.splice(dragSrcIndex, 1)[0];
      themes.splice(idx, 0, moved);
      dragSrcIndex = null;

      // sort_order aller Themen aktualisieren
      for (let i = 0; i < themes.length; i++) {
        await storageManager.saveTheme({ ...themes[i], sort_order: i });
      }

      await loadThemes();
    });

    themeList.appendChild(li);
  });
}

// ── Thema löschen ─────────────────────────────────────────────────────────

async function deleteTheme(id, name) {
  if (!confirm(`Thema „${name}" wirklich löschen?`)) return;
  await storageManager.deleteTheme(id);
  await loadThemes();
}

// ── XSS-Schutz ────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Themen-API für coding.js ──────────────────────────────────────────────

window.themesApi = {
  getThemes: () => themes,
};

function notifyThemesUpdated() {
  document.dispatchEvent(new CustomEvent("themes-updated", { detail: themes }));
}

// ── Statistik-Bereich ─────────────────────────────────────────────────────

const statsSection = document.getElementById("stats-section");
const statsChart   = document.getElementById("stats-chart");

function renderStats(codings) {
  statsChart.innerHTML = "";

  if (themes.length === 0 || codings.length === 0) {
    statsSection.hidden = true;
    return;
  }

  // Häufigkeit pro Thema zählen (neues Feld: theme_id)
  const counts = themes.map(t => ({
    theme: t,
    count: codings.filter(c => c.theme_id === t.id).length,
  })).filter(x => x.count > 0);

  if (counts.length === 0) {
    statsSection.hidden = true;
    return;
  }

  statsSection.hidden = false;
  const max = Math.max(...counts.map(x => x.count));

  for (const { theme, count } of counts) {
    const row = document.createElement("div");
    row.className = "stats-row";

    const pct = Math.round((count / max) * 100);
    row.innerHTML = `
      <span class="stats-label" title="${escapeHtml(theme.name)}">${escapeHtml(theme.name)}</span>
      <div class="stats-bar-track">
        <div class="stats-bar" style="width:${pct}%; background:${theme.color}"></div>
      </div>
      <span class="stats-count">${count}</span>
    `;
    statsChart.appendChild(row);
  }
}

// ── Codierungen-Bereich in der Sidebar ────────────────────────────────────

const codingsSection   = document.getElementById("codings-section");
const codingsList      = document.getElementById("codings-list");
const codingsEmptyHint = document.getElementById("codings-empty-hint");
const codingsCount     = document.getElementById("codings-count");
const codingsSearch    = document.getElementById("codings-search");

let searchTerm = "";

codingsSearch.addEventListener("input", () => {
  searchTerm = codingsSearch.value.trim().toLowerCase();
  // Mit letzten bekannten Codings neu rendern
  if (lastCodings !== null) renderCodingsList(lastCodings, lastUnresolvableIds);
});

let lastCodings         = null;
let lastUnresolvableIds = [];

function renderCodingsList(codings, unresolvableIds = []) {
  lastCodings         = codings;
  lastUnresolvableIds = unresolvableIds;

  codingsList.innerHTML = "";
  codingsCount.textContent = codings.length;
  codingsEmptyHint.hidden = codings.length > 0;

  // Suchfilter anwenden
  const filtered = searchTerm
    ? codings.filter(c => c.text.toLowerCase().includes(searchTerm))
    : codings;

  // Statistik immer mit allen Codings rendern (unabhängig vom Filter)
  renderStats(codings);

  if (filtered.length === 0 && codings.length > 0) {
    const hint = document.createElement("p");
    hint.className = "codings-search-empty";
    hint.textContent = "Keine Treffer für diese Suche.";
    codingsList.appendChild(hint);
    codingsEmptyHint.hidden = true;
    return;
  }

  // Gruppierung: theme_id → [codings]
  const grouped = new Map();
  for (const coding of filtered) {
    if (!grouped.has(coding.theme_id)) grouped.set(coding.theme_id, []);
    grouped.get(coding.theme_id).push(coding);
  }

  for (const [themeId, items] of grouped) {
    const theme      = themes.find(t => t.id === themeId);
    const themeName  = theme?.name  ?? "(Thema gelöscht)";
    const themeColor = theme?.color ?? "#888";

    const header = document.createElement("div");
    header.className = "codings-group-header";
    header.innerHTML = `
      <span class="theme-dot" style="background:${themeColor}"></span>
      <span>${escapeHtml(themeName)}</span>
      <span class="codings-group-count">${items.length}</span>
    `;
    codingsList.appendChild(header);

    for (const coding of items) {
      const div = document.createElement("div");
      div.className = "coding-item" + (unresolvableIds.includes(coding.id) ? " unresolvable" : "");
      div.title = unresolvableIds.includes(coding.id)
        ? "Nicht zuordbar – Text wurde möglicherweise verändert"
        : coding.text;

      // Suchbegriff im Text hervorheben
      const displayText = searchTerm
        ? highlightMatch(truncate(coding.text, 60), searchTerm)
        : escapeHtml(truncate(coding.text, 60));

      div.innerHTML = `
        <span class="coding-text">${displayText}</span>
        <div class="coding-item-footer">
          <span class="coding-meta">Seite ${coding.page}</span>
          <button class="btn-icon delete coding-delete" title="Codierung entfernen">✕</button>
        </div>
      `;
      div.querySelector(".coding-text").addEventListener("click", () => {
        window.scrollToPage?.(coding.page);
      });
      div.querySelector(".coding-delete").addEventListener("click", (e) => {
        e.stopPropagation();
        window.codingApi?.removeCoding(coding.id);
      });
      codingsList.appendChild(div);
    }
  }
}

// Suchbegriff im Text fett markieren
function highlightMatch(text, term) {
  const safe     = escapeHtml(text);
  const safeTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return safe.replace(new RegExp(`(${safeTerm})`, "gi"), "<mark>$1</mark>");
}

document.addEventListener("codings-updated", (e) => {
  renderCodingsList(e.detail.codings, e.detail.unresolvableIds ?? []);
});

// ── Hilfsfunktionen ───────────────────────────────────────────────────────

function truncate(str, max) {
  return str.length > max ? str.slice(0, max) + "…" : str;
}

// ── Sidebar resizable ─────────────────────────────────────────────────────

const resizeHandle = document.getElementById("sidebar-resize-handle");

resizeHandle.addEventListener("mousedown", (e) => {
  e.preventDefault();

  const onMove = (mv) => {
    const newWidth = Math.max(200, Math.min(520, window.innerWidth - mv.clientX));
    document.documentElement.style.setProperty("--sidebar-width", newWidth + "px");
  };

  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup",   onUp);
    document.body.style.cursor     = "";
    document.body.style.userSelect = "";
  };

  document.body.style.cursor     = "col-resize";
  document.body.style.userSelect = "none";
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup",   onUp);
});

// ── Backup ────────────────────────────────────────────────────────────────

// Backup exportieren: JSON-Datei herunterladen
btnBackupExport.addEventListener("click", async () => {
  try {
    const json    = await storageManager.exportBackup();
    const blob    = new Blob([json], { type: "application/json" });
    const url     = URL.createObjectURL(blob);
    const a       = document.createElement("a");
    const stamp   = new Date().toISOString().slice(0, 10);
    a.href        = url;
    a.download    = `PDFCoder_Backup_${stamp}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    showToast("Backup exportiert.");
  } catch (err) {
    alert("Backup fehlgeschlagen: " + err.message);
  }
});

// Backup importieren: Datei-Dialog öffnen
btnBackupImport.addEventListener("click", () => {
  backupFileInput.value = "";
  backupFileInput.click();
});

backupFileInput.addEventListener("change", async () => {
  const file = backupFileInput.files?.[0];
  if (!file) return;

  if (!confirm("Alle vorhandenen Daten werden durch das Backup ersetzt. Fortfahren?")) return;

  try {
    const text = await file.text();
    await storageManager.importBackup(text);
    await loadProjects();
    await loadThemes();
    showToast("Backup importiert.");
  } catch (err) {
    alert("Import fehlgeschlagen: " + err.message);
  }
});

// ── Toast-Benachrichtigung ────────────────────────────────────────────────

function showToast(message, duration = 3500) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => { toast.hidden = true; }, duration);
}

// ── Initialisierung ───────────────────────────────────────────────────────

async function init() {
  try {
    // Auf Bereitschaft der Datenbank warten
    await storageManager.ready;

    // Aktives Projekt aus globalem Zustand laden (kann von coding.js gesetzt werden)
    activeProjectId = window.activeProjectId ?? DEFAULT_PROJECT_ID;

    await loadProjects();
    await loadThemes();

    // Globale Variablen setzen
    window.activeProjectId = activeProjectId;
    const project = projects.find(p => p.id === activeProjectId);
    window.activeProjectName = project?.name ?? "Standard";

    // Migration-Toast anzeigen falls Daten migriert wurden
    if (storageManager.migrationResult) {
      const r = storageManager.migrationResult;
      showToast(
        `Migration: ${r.themes} Thema${r.themes !== 1 ? "en" : ""} und ` +
        `${r.documents} Dokument${r.documents !== 1 ? "e" : ""} übertragen.`,
        6000
      );
    }
  } catch (err) {
    console.error("[sidebar] Initialisierung fehlgeschlagen:", err);
  }
}

// Initialisierung starten (fire-and-forget, Fehler intern abgefangen)
init();

// Nachrichten vom Dashboard empfangen und Ansicht aktualisieren
chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== "DATA_CHANGED") return;
  if (message.scope === "themes" || message.scope === "projects") {
    loadProjects().then(() => loadThemes().then(() => notifyThemesUpdated()));
  }
});

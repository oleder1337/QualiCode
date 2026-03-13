// dashboard.js – Vollständige Dashboard-Implementierung
// Importiert aus storage.js; nutzt window.XLSX für Excel-Export

import { storageManager } from "../viewer/storage.js";

// ── Hilfsfunktionen ───────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(isoString) {
  try {
    const d = new Date(isoString);
    const p = n => String(n).padStart(2, "0");
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
  } catch { return "–"; }
}

function formatDateTime(isoString) {
  try {
    const d = new Date(isoString);
    const p = n => String(n).padStart(2, "0");
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch { return String(isoString ?? ""); }
}

function extractDocName(doc) {
  if (doc.name) return doc.name;
  try { return decodeURIComponent(new URL(doc.url).pathname.split("/").pop()) || doc.url; }
  catch { return doc.url || "Unbekannt"; }
}

function sanitizeFileName(name) {
  return String(name).replace(/[^\w\-äöüÄÖÜß ]/g, "_").slice(0, 40);
}

function sanitizeSheetName(name) {
  return String(name).replace(/[:\\\/\?\*\[\]]/g, "_").slice(0, 31) || "Thema";
}

// ── Toast ─────────────────────────────────────────────────────────────────

function showToast(message, isError = false) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.style.borderLeftColor = isError ? "#f38ba8" : "#a6e3a1";
  toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toast.hidden = true; }, 3500);
}

// ── DATA_CHANGED-Nachricht senden ─────────────────────────────────────────

function notifyDataChanged(scope, projectId = null) {
  chrome.runtime.sendMessage({ type: "DATA_CHANGED", scope, projectId }).catch(() => {});
}

// ── Viewer öffnen ─────────────────────────────────────────────────────────

function openInViewer(url) {
  const base = chrome.runtime.getURL("viewer/viewer.html");
  chrome.tabs.create({ url: `${base}?url=${encodeURIComponent(url)}` });
}

// ── Navigation ────────────────────────────────────────────────────────────

const pages    = document.querySelectorAll(".page");
const navItems = document.querySelectorAll(".nav-item");

let currentPage = "start";

async function renderPage(pageId) {
  currentPage = pageId;

  // Seiten und Nav-Einträge umschalten
  pages.forEach(p => p.classList.toggle("active", p.id === `page-${pageId}`));
  navItems.forEach(n => n.classList.toggle("active", n.dataset.page === pageId));

  // Inhalte je nach Seite laden
  switch (pageId) {
    case "start":     await renderStart();     break;
    case "projects":  await renderProjects();  break;
    case "themes":    await renderThemes();    break;
    case "documents": await renderDocuments(); break;
    case "export":    await renderExport();    break;
    case "backup":    await renderBackup();    break;
  }
}

navItems.forEach(item => {
  item.addEventListener("click", () => renderPage(item.dataset.page));
});

// ── Seite: Übersicht ──────────────────────────────────────────────────────

async function renderStart() {
  const [projects, themes, docs, codings] = await Promise.all([
    storageManager.getProjects(),
    // Alle Themen laden: über alle Projekte
    storageManager.getProjects().then(ps =>
      Promise.all(ps.map(p => storageManager.getThemes(p.id))).then(all => all.flat())
    ),
    storageManager.getDocuments(),
    storageManager.getAllCodings(),
  ]);

  // Statistik-Karten rendern
  const statsCards = document.getElementById("stats-cards");
  statsCards.innerHTML = "";

  const stats = [
    { value: projects.length,    label: "Projekte"    },
    { value: themes.length,      label: "Themen"      },
    { value: docs.length,        label: "Dokumente"   },
    { value: codings.length,     label: "Codierungen" },
  ];

  for (const s of stats) {
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = `
      <div class="stat-value">${s.value}</div>
      <div class="stat-label">${escapeHtml(s.label)}</div>
    `;
    statsCards.appendChild(card);
  }

  // Zuletzt bearbeitete Dokumente (max. 5)
  const recentDocs = document.getElementById("recent-docs");
  recentDocs.innerHTML = "";

  const sorted = [...docs]
    .sort((a, b) => (b.last_edited ?? "").localeCompare(a.last_edited ?? ""))
    .slice(0, 5);

  if (sorted.length === 0) {
    recentDocs.innerHTML = `<p style="color:#585b70;font-size:13px">Noch keine Dokumente vorhanden.</p>`;
    return;
  }

  // Codierungen pro Dokument zählen
  const countByDoc = new Map();
  for (const c of codings) {
    countByDoc.set(c.document_id, (countByDoc.get(c.document_id) ?? 0) + 1);
  }

  for (const doc of sorted) {
    const item = document.createElement("div");
    item.className = "recent-doc-item";
    const name  = extractDocName(doc);
    const count = countByDoc.get(doc.id) ?? 0;
    const date  = doc.last_edited ? formatDate(doc.last_edited) : "–";

    item.innerHTML = `
      <span style="font-size:18px">📄</span>
      <span class="recent-doc-name">${escapeHtml(name)}</span>
      <span class="recent-doc-meta">${count} Codierung${count !== 1 ? "en" : ""} · ${escapeHtml(date)}</span>
    `;
    item.addEventListener("click", () => openInViewer(doc.url));
    recentDocs.appendChild(item);
  }
}

// ── Seite: Projekte ───────────────────────────────────────────────────────

let editingProjectId = null; // null = Neues Projekt

async function renderProjects() {
  // Detail-Panel ausblenden und Tabelle anzeigen
  document.getElementById("project-detail").hidden = true;
  document.getElementById("projects-table").hidden = false;
  document.getElementById("project-form-container").hidden = true;
  editingProjectId = null;

  const [projects, allCodings] = await Promise.all([
    storageManager.getProjects(),
    storageManager.getAllCodings(),
  ]);

  // Themen und Dokumente pro Projekt laden
  const themeCountMap = new Map();
  const docCountMap   = new Map();
  const codingCountMap = new Map();

  // Projekt-Dokument-Verknüpfungen und Themen parallel laden
  await Promise.all(projects.map(async p => {
    const themes = await storageManager.getThemes(p.id);
    themeCountMap.set(p.id, themes.length);
  }));

  // Codierungen pro Projekt zählen
  for (const c of allCodings) {
    codingCountMap.set(c.project_id, (codingCountMap.get(c.project_id) ?? 0) + 1);
  }

  // Dokumente pro Projekt zählen (über Codierungen)
  for (const p of projects) {
    const projCodings = allCodings.filter(c => c.project_id === p.id);
    const uniqueDocs  = new Set(projCodings.map(c => c.document_id));
    docCountMap.set(p.id, uniqueDocs.size);
  }

  // Tabellen-Body befüllen
  const tbody = document.getElementById("projects-tbody");
  tbody.innerHTML = "";

  for (const p of projects) {
    const tr = document.createElement("tr");
    const lastOpened = p.last_opened ? formatDate(p.last_opened) : "–";

    tr.innerHTML = `
      <td>
        <span style="display:inline-flex;align-items:center;gap:8px">
          <span style="width:10px;height:10px;border-radius:50%;background:${escapeHtml(p.color ?? "#89b4fa")};flex-shrink:0;display:inline-block"></span>
          <strong>${escapeHtml(p.name)}</strong>
        </span>
        ${p.description ? `<div style="font-size:11px;color:#585b70;margin-top:2px">${escapeHtml(p.description)}</div>` : ""}
      </td>
      <td><span class="num-badge">${themeCountMap.get(p.id) ?? 0}</span></td>
      <td><span class="num-badge">${docCountMap.get(p.id) ?? 0}</span></td>
      <td><span class="num-badge">${codingCountMap.get(p.id) ?? 0}</span></td>
      <td style="color:#585b70;font-size:12px">${escapeHtml(lastOpened)}</td>
      <td>
        <div class="table-actions">
          <button class="btn-icon" data-action="edit"      title="Bearbeiten">✎</button>
          <button class="btn-icon" data-action="duplicate" title="Duplizieren">⧉</button>
          ${p.id !== "project-standard"
            ? `<button class="btn-icon delete" data-action="delete" title="Löschen">✕</button>`
            : ""}
        </div>
      </td>
    `;

    // Zeilen-Klick → Detail-Panel
    tr.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      showProjectDetail(p, projects, allCodings);
    });

    // Aktions-Schaltflächen
    tr.querySelector("[data-action='edit']").addEventListener("click", (e) => {
      e.stopPropagation();
      openProjectForm(p);
    });

    tr.querySelector("[data-action='duplicate']").addEventListener("click", async (e) => {
      e.stopPropagation();
      await storageManager.duplicateProject(p.id);
      notifyDataChanged("projects");
      await renderProjects();
      showToast("Projekt dupliziert.");
    });

    const delBtn = tr.querySelector("[data-action='delete']");
    if (delBtn) {
      delBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`Projekt „${p.name}" und alle Themen und Codierungen löschen?`)) return;
        await storageManager.deleteProject(p.id);
        notifyDataChanged("projects");
        await renderProjects();
        showToast("Projekt gelöscht.");
      });
    }

    tbody.appendChild(tr);
  }

  // Formular-Schaltflächen verdrahten (einmalig via Delegation)
  setupProjectForm();
}

function setupProjectForm() {
  const container = document.getElementById("project-form-container");
  const btnCreate = document.getElementById("btn-create-project");
  const btnSave   = document.getElementById("pf-save");
  const btnCancel = document.getElementById("pf-cancel");

  // Neue Listener nur setzen falls noch nicht gesetzt
  btnCreate.onclick = () => openProjectForm(null);
  btnSave.onclick   = saveProjectForm;
  btnCancel.onclick = () => {
    container.hidden = true;
    editingProjectId = null;
  };

  document.getElementById("pf-name").onkeydown = (e) => {
    if (e.key === "Enter")  saveProjectForm();
    if (e.key === "Escape") { container.hidden = true; editingProjectId = null; }
  };
}

function openProjectForm(project) {
  editingProjectId = project?.id ?? null;
  document.getElementById("pf-name").value  = project?.name  ?? "";
  document.getElementById("pf-desc").value  = project?.description ?? "";
  document.getElementById("pf-color").value = project?.color ?? "#89b4fa";
  document.getElementById("project-form-container").hidden = false;
  document.getElementById("pf-name").focus();
}

async function saveProjectForm() {
  const name  = document.getElementById("pf-name").value.trim();
  const desc  = document.getElementById("pf-desc").value.trim();
  const color = document.getElementById("pf-color").value;

  if (!name) { document.getElementById("pf-name").focus(); return; }

  if (editingProjectId) {
    await storageManager.updateProject(editingProjectId, { name, description: desc, color });
  } else {
    await storageManager.createProject({ name, description: desc, color });
  }

  document.getElementById("project-form-container").hidden = true;
  editingProjectId = null;
  notifyDataChanged("projects");
  await renderProjects();
  showToast(editingProjectId ? "Projekt gespeichert." : "Projekt erstellt.");
}

async function showProjectDetail(project, allProjects, allCodings) {
  // Tabelle ausblenden, Detail anzeigen
  document.getElementById("projects-table").hidden = true;
  document.getElementById("project-form-container").hidden = true;
  const detail = document.getElementById("project-detail");
  detail.hidden = false;

  document.getElementById("project-detail-name").textContent = project.name;

  // Themen laden
  const themes = await storageManager.getThemes(project.id);
  const themesList = document.getElementById("project-detail-themes");
  themesList.innerHTML = "";

  if (themes.length === 0) {
    themesList.innerHTML = `<li style="color:#585b70">Keine Themen vorhanden.</li>`;
  } else {
    for (const t of themes) {
      const count = allCodings.filter(c => c.theme_id === t.id && c.project_id === project.id).length;
      const li = document.createElement("li");
      li.innerHTML = `
        <span style="width:10px;height:10px;border-radius:50%;background:${escapeHtml(t.color)};flex-shrink:0;display:inline-block"></span>
        <span style="flex:1">${escapeHtml(t.name)}</span>
        <span class="num-badge">${count}</span>
      `;
      themesList.appendChild(li);
    }
  }

  // Dokumente laden (eindeutige Dokument-IDs aus Codierungen)
  const projCodings = allCodings.filter(c => c.project_id === project.id);
  const docIds = [...new Set(projCodings.map(c => c.document_id))];
  const allDocs = await storageManager.getDocuments();
  const docsList = document.getElementById("project-detail-documents");
  docsList.innerHTML = "";

  if (docIds.length === 0) {
    docsList.innerHTML = `<li style="color:#585b70">Keine Dokumente vorhanden.</li>`;
  } else {
    for (const docId of docIds) {
      const doc   = allDocs.find(d => d.id === docId);
      if (!doc) continue;
      const count = projCodings.filter(c => c.document_id === docId).length;
      const li    = document.createElement("li");
      li.innerHTML = `
        <span>📄</span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(doc.url)}">${escapeHtml(extractDocName(doc))}</span>
        <span class="num-badge">${count}</span>
      `;
      docsList.appendChild(li);
    }
  }

  // Zurück-Schaltfläche
  document.getElementById("btn-back-projects").onclick = () => {
    detail.hidden = true;
    document.getElementById("projects-table").hidden = false;
  };
}

// ── Seite: Themen ─────────────────────────────────────────────────────────

// Zustand für Themen-Seite
let themesMoveModalThemeId     = null;
let themesMoveModalFromProject = null;

async function renderThemes() {
  const projects  = await storageManager.getProjects();
  const allCodings = await storageManager.getAllCodings();

  // Filter-Dropdown befüllen
  const filterSel = document.getElementById("themes-filter-project");
  const filterVal = filterSel.value;
  filterSel.innerHTML = `<option value="">Alle Projekte</option>`;
  for (const p of projects) {
    const opt = document.createElement("option");
    opt.value       = p.id;
    opt.textContent = p.name;
    if (p.id === filterVal) opt.selected = true;
    filterSel.appendChild(opt);
  }

  // Listener einmalig setzen
  filterSel.onchange  = () => renderThemesContent(projects, allCodings);
  document.getElementById("themes-search").oninput = () => renderThemesContent(projects, allCodings);

  await renderThemesContent(projects, allCodings);
}

async function renderThemesContent(projects, allCodings) {
  const filterProjectId = document.getElementById("themes-filter-project").value;
  const searchTerm      = document.getElementById("themes-search").value.trim().toLowerCase();

  const container = document.getElementById("themes-list");
  container.innerHTML = "";

  // Projekte filtern
  const filteredProjects = filterProjectId
    ? projects.filter(p => p.id === filterProjectId)
    : projects;

  for (const project of filteredProjects) {
    const themes = await storageManager.getThemes(project.id);

    // Suchfilter
    const filtered = searchTerm
      ? themes.filter(t => t.name.toLowerCase().includes(searchTerm))
      : themes;

    if (filtered.length === 0) continue;

    const group = document.createElement("div");
    group.className = "themes-project-group";

    const header = document.createElement("div");
    header.className = "themes-project-header";
    header.innerHTML = `
      <span style="width:10px;height:10px;border-radius:50%;background:${escapeHtml(project.color ?? "#89b4fa")};flex-shrink:0;display:inline-block"></span>
      <span>${escapeHtml(project.name)}</span>
      <span class="num-badge">${filtered.length}</span>
    `;
    group.appendChild(header);

    for (const theme of filtered) {
      const count = allCodings.filter(c => c.theme_id === theme.id && c.project_id === project.id).length;
      const row = document.createElement("div");
      row.className = "theme-row";

      row.innerHTML = `
        <span class="color-dot" style="background:${escapeHtml(theme.color)}"></span>
        <span class="theme-row-name">${escapeHtml(theme.name)}</span>
        <span class="theme-row-count">${count}</span>
        <div class="theme-row-actions">
          <button class="btn-icon" data-action="edit"       title="Bearbeiten">✎</button>
          <button class="btn-icon" data-action="move"       title="Verschieben/Kopieren">⇄</button>
          <button class="btn-icon delete" data-action="delete" title="Löschen">✕</button>
        </div>
      `;

      // Inline-Bearbeiten
      row.querySelector("[data-action='edit']").addEventListener("click", (e) => {
        e.stopPropagation();
        openThemeInlineEdit(row, theme, project, allCodings);
      });

      // Verschieben/Kopieren Modal öffnen
      row.querySelector("[data-action='move']").addEventListener("click", (e) => {
        e.stopPropagation();
        openThemeMoveModal(theme.id, project.id);
      });

      // Thema löschen
      row.querySelector("[data-action='delete']").addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`Thema „${theme.name}" löschen? Codierungen bleiben erhalten, sind aber keinem Thema mehr zugeordnet.`)) return;
        await storageManager.deleteTheme(theme.id);
        notifyDataChanged("themes", project.id);
        await renderThemes();
        showToast("Thema gelöscht.");
      });

      group.appendChild(row);
    }

    container.appendChild(group);
  }

  if (container.children.length === 0) {
    container.innerHTML = `<p style="color:#585b70;font-size:13px">Keine Themen gefunden.</p>`;
  }
}

function openThemeInlineEdit(row, theme, project, allCodings) {
  // Bestehende Inline-Edits schließen
  document.querySelectorAll(".theme-inline-edit").forEach(el => el.remove());
  document.querySelectorAll(".theme-row").forEach(r => r.style.display = "");

  row.style.display = "none";

  const editRow = document.createElement("div");
  editRow.className = "theme-inline-edit inline-form";
  editRow.style.cssText = "flex-direction:row;align-items:center;gap:8px;padding:8px 12px;margin-bottom:4px";

  editRow.innerHTML = `
    <span class="color-dot" style="background:${escapeHtml(theme.color)};flex-shrink:0"></span>
    <input type="text" value="${escapeHtml(theme.name)}" style="flex:1;padding:4px 8px;font-size:13px;background:#313244;border:1px solid #89b4fa;border-radius:4px;color:#cdd6f4;outline:none">
    <input type="color" value="${escapeHtml(theme.color)}" style="width:32px;height:28px;border:none;border-radius:4px;cursor:pointer;padding:2px;background:#313244">
    <button class="btn-primary" style="padding:4px 10px;font-size:12px">Speichern</button>
    <button class="btn-ghost"   style="padding:4px 10px;font-size:12px">Abbrechen</button>
  `;

  row.parentNode.insertBefore(editRow, row);

  const nameInput  = editRow.querySelector("input[type='text']");
  const colorInput = editRow.querySelector("input[type='color']");
  const btnSave    = editRow.querySelectorAll("button")[0];
  const btnCancel  = editRow.querySelectorAll("button")[1];

  // Farb-Dot live aktualisieren
  colorInput.addEventListener("input", () => {
    editRow.querySelector(".color-dot").style.background = colorInput.value;
  });

  const save = async () => {
    const name  = nameInput.value.trim();
    const color = colorInput.value;
    if (!name) { nameInput.focus(); return; }
    await storageManager.saveTheme({ ...theme, name, color });
    notifyDataChanged("themes", project.id);
    editRow.remove();
    row.style.display = "";
    await renderThemes();
    showToast("Thema gespeichert.");
  };

  const cancel = () => {
    editRow.remove();
    row.style.display = "";
  };

  btnSave.addEventListener("click", save);
  btnCancel.addEventListener("click", cancel);
  nameInput.addEventListener("keydown", e => {
    if (e.key === "Enter")  save();
    if (e.key === "Escape") cancel();
  });

  nameInput.focus();
  nameInput.select();
}

// Verschieben/Kopieren-Modal
function openThemeMoveModal(themeId, fromProjectId) {
  themesMoveModalThemeId     = themeId;
  themesMoveModalFromProject = fromProjectId;

  const modal = document.getElementById("theme-move-modal");
  modal.hidden = false;

  // Ziel-Projekt-Dropdown befüllen (alle Projekte für Kopieren; ohne fromProject für Verschieben)
  storageManager.getProjects().then(projects => {
    const sel = document.getElementById("theme-move-target");
    sel.innerHTML = "";
    for (const p of projects) {
      if (p.id === fromProjectId) continue; // Quell-Projekt ausschließen
      const opt = document.createElement("option");
      opt.value       = p.id;
      opt.textContent = p.name;
      sel.appendChild(opt);
    }
  });
}

// Modal-Schaltflächen verdrahten
document.getElementById("btn-close-theme-move").addEventListener("click", () => {
  document.getElementById("theme-move-modal").hidden = true;
});

document.getElementById("theme-move-modal").addEventListener("click", (e) => {
  if (e.target === document.getElementById("theme-move-modal")) {
    document.getElementById("theme-move-modal").hidden = true;
  }
});

document.getElementById("btn-theme-move-confirm").addEventListener("click", async () => {
  const toProjectId = document.getElementById("theme-move-target").value;
  if (!toProjectId || !themesMoveModalThemeId) return;

  await storageManager.moveTheme(themesMoveModalThemeId, themesMoveModalFromProject, toProjectId);
  document.getElementById("theme-move-modal").hidden = true;
  notifyDataChanged("themes");
  notifyDataChanged("codings");
  await renderThemes();
  showToast("Thema verschoben.");
});

document.getElementById("btn-theme-copy-confirm").addEventListener("click", async () => {
  const toProjectId = document.getElementById("theme-move-target").value;
  if (!toProjectId || !themesMoveModalThemeId) return;

  await storageManager.copyTheme(themesMoveModalThemeId, toProjectId);
  document.getElementById("theme-move-modal").hidden = true;
  notifyDataChanged("themes", toProjectId);
  await renderThemes();
  showToast("Thema kopiert.");
});

// ── Seite: Dokumente ──────────────────────────────────────────────────────

async function renderDocuments() {
  const projects   = await storageManager.getProjects();
  const allCodings = await storageManager.getAllCodings();
  const allDocs    = await storageManager.getDocuments();

  // Filter-Dropdowns befüllen
  const filterSel = document.getElementById("docs-filter-project");
  const filterVal = filterSel.value;
  filterSel.innerHTML = `<option value="">Alle Projekte</option>`;
  for (const p of projects) {
    const opt = document.createElement("option");
    opt.value       = p.id;
    opt.textContent = p.name;
    if (p.id === filterVal) opt.selected = true;
    filterSel.appendChild(opt);
  }

  // Listener einmalig setzen
  filterSel.onchange = () => renderDocumentsContent(projects, allCodings, allDocs);
  document.getElementById("docs-sort").onchange = () => renderDocumentsContent(projects, allCodings, allDocs);

  await renderDocumentsContent(projects, allCodings, allDocs);
}

async function renderDocumentsContent(projects, allCodings, allDocs) {
  const filterProjectId = document.getElementById("docs-filter-project").value;
  const sortMode        = document.getElementById("docs-sort").value;
  const container       = document.getElementById("documents-list");
  container.innerHTML   = "";

  // Codierungen pro Dokument zählen
  const countByDoc = new Map();
  for (const c of allCodings) {
    // Falls Projekt-Filter aktiv: nur Codierungen des gefilterten Projekts zählen
    if (filterProjectId && c.project_id !== filterProjectId) continue;
    countByDoc.set(c.document_id, (countByDoc.get(c.document_id) ?? 0) + 1);
  }

  // Projekt-Zugehörigkeit pro Dokument ermitteln
  const docProjectsMap = new Map(); // document_id → [project]
  for (const c of allCodings) {
    const proj = projects.find(p => p.id === c.project_id);
    if (!proj) continue;
    if (!docProjectsMap.has(c.document_id)) docProjectsMap.set(c.document_id, new Map());
    docProjectsMap.get(c.document_id).set(proj.id, proj);
  }

  // Dokumente filtern
  let docs = allDocs.filter(d => {
    if (filterProjectId) {
      return allCodings.some(c => c.document_id === d.id && c.project_id === filterProjectId);
    }
    return countByDoc.has(d.id);
  });

  // Sortieren
  if (sortMode === "date") {
    docs.sort((a, b) => (b.last_edited ?? "").localeCompare(a.last_edited ?? ""));
  } else if (sortMode === "name") {
    docs.sort((a, b) => extractDocName(a).localeCompare(extractDocName(b)));
  } else if (sortMode === "count") {
    docs.sort((a, b) => (countByDoc.get(b.id) ?? 0) - (countByDoc.get(a.id) ?? 0));
  }

  if (docs.length === 0) {
    container.innerHTML = `<p style="color:#585b70;font-size:13px">Keine Dokumente gefunden.</p>`;
    return;
  }

  for (const doc of docs) {
    const count    = countByDoc.get(doc.id) ?? 0;
    const name     = extractDocName(doc);
    const docProjs = docProjectsMap.get(doc.id) ?? new Map();
    const date     = doc.last_edited ? formatDate(doc.last_edited) : "–";

    const row = document.createElement("div");
    row.className = "doc-row";

    // Projekt-Badges erstellen
    const badges = [...docProjs.values()].map(p =>
      `<span class="project-badge">
        <span class="project-badge-dot" style="background:${escapeHtml(p.color ?? "#89b4fa")}"></span>
        ${escapeHtml(p.name)}
      </span>`
    ).join("");

    row.innerHTML = `
      <span class="doc-row-icon">📄</span>
      <div class="doc-row-info">
        <div class="doc-row-name" title="${escapeHtml(doc.url)}">${escapeHtml(name)}</div>
        <div class="doc-row-meta">
          <span>${count} Codierung${count !== 1 ? "en" : ""}</span>
          <span>${escapeHtml(date)}</span>
          ${badges}
        </div>
      </div>
      <div class="doc-row-actions">
        <button class="btn-ghost" data-action="open"   style="padding:5px 10px;font-size:12px" title="Im Viewer öffnen">Öffnen</button>
        <button class="btn-ghost" data-action="delete" style="padding:5px 10px;font-size:12px;color:#f38ba8;border-color:#f38ba8" title="Alle Codierungen löschen">Codierungen löschen</button>
        ${filterProjectId
          ? `<button class="btn-ghost" data-action="remove-from-project" style="padding:5px 10px;font-size:12px" title="Aus Projekt entfernen">Aus Projekt entfernen</button>`
          : ""}
      </div>
    `;

    // Öffnen
    row.querySelector("[data-action='open']").addEventListener("click", (e) => {
      e.stopPropagation();
      openInViewer(doc.url);
    });

    // Alle Codierungen löschen
    row.querySelector("[data-action='delete']").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`Alle Codierungen für „${name}" löschen?`)) return;

      // Codierungen für alle Projekte löschen
      for (const p of projects) {
        await storageManager.deleteCodingsForDocument(p.id, doc.id);
      }
      notifyDataChanged("codings");
      await renderDocuments();
      showToast("Codierungen gelöscht.");
    });

    // Aus Projekt entfernen (nur wenn Projekt-Filter aktiv)
    const removeBtn = row.querySelector("[data-action='remove-from-project']");
    if (removeBtn) {
      removeBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const proj = projects.find(p => p.id === filterProjectId);
        if (!confirm(`Dokument „${name}" aus Projekt „${proj?.name ?? ""}" entfernen? Codierungen dieses Projekts werden ebenfalls gelöscht.`)) return;
        await storageManager.removeDocumentFromProject(filterProjectId, doc.id);
        notifyDataChanged("codings", filterProjectId);
        await renderDocuments();
        showToast("Dokument aus Projekt entfernt.");
      });
    }

    container.appendChild(row);
  }
}

// ── Seite: Export (Wizard) ────────────────────────────────────────────────

// Wizard-Zustand
let wizardStep      = 1;
let wizardCodings   = [];
let wizardThemes    = [];
let wizardDocuments = [];
let wizardProject   = null;

async function renderExport() {
  wizardStep = 1;
  updateWizardUI(1);

  const projects = await storageManager.getProjects();

  // Projekt-Auswahl befüllen
  const projSel = document.getElementById("export-project-select");
  projSel.innerHTML = "";
  for (const p of projects) {
    const opt = document.createElement("option");
    opt.value       = p.id;
    opt.textContent = p.name;
    projSel.appendChild(opt);
  }

  // Scope-Radios: Event-Handler setzen
  document.querySelectorAll("input[name='export-scope']").forEach(radio => {
    radio.onchange = () => onScopeChange(projects);
  });

  // Projekt-Dropdown-Änderung
  projSel.onchange = () => onProjectChange(projects);

  // Initialen Zustand herstellen
  await onScopeChange(projects);

  // Wizard-Navigation verdrahten
  document.getElementById("btn-wizard-next").onclick    = () => wizardGoToStep2();
  document.getElementById("btn-wizard-back-1").onclick  = () => goToStep(1);
  document.getElementById("btn-wizard-to-3").onclick    = () => goToStep(3);
  document.getElementById("btn-wizard-back-2").onclick  = () => goToStep(2);
  document.getElementById("btn-do-export").onclick      = () => runDashboardExport();
}

async function onScopeChange(projects) {
  const scope = document.querySelector("input[name='export-scope']:checked")?.value ?? "project";

  document.getElementById("themes-checkboxes").hidden       = scope !== "themes";
  document.getElementById("document-select-wrapper").hidden = scope !== "document";

  if (scope === "themes" || scope === "document") {
    await onProjectChange(projects);
  }
}

async function onProjectChange(projects) {
  const scope     = document.querySelector("input[name='export-scope']:checked")?.value ?? "project";
  const projectId = document.getElementById("export-project-select").value;

  if (scope === "themes") {
    const themes = await storageManager.getThemes(projectId);
    const box    = document.getElementById("themes-checkboxes");
    box.innerHTML = "";
    for (const t of themes) {
      const label = document.createElement("label");
      label.className = "theme-checkbox-row";
      label.innerHTML = `
        <input type="checkbox" value="${escapeHtml(t.id)}" checked>
        <span class="color-dot" style="background:${escapeHtml(t.color)}"></span>
        <span>${escapeHtml(t.name)}</span>
      `;
      box.appendChild(label);
    }
  } else if (scope === "document") {
    const codings = await storageManager.getCodingsByProject(projectId);
    const docIds  = [...new Set(codings.map(c => c.document_id))];
    const allDocs = await storageManager.getDocuments();
    const docs    = allDocs.filter(d => docIds.includes(d.id));

    const sel = document.getElementById("export-document-select");
    sel.innerHTML = "";
    for (const d of docs) {
      const opt = document.createElement("option");
      opt.value       = d.id;
      opt.textContent = extractDocName(d);
      sel.appendChild(opt);
    }
  }
}

async function wizardGoToStep2() {
  // Auswahl validieren und Codings laden
  const scope     = document.querySelector("input[name='export-scope']:checked")?.value ?? "project";
  const projectId = document.getElementById("export-project-select").value;

  if (!projectId) { showToast("Bitte ein Projekt auswählen.", true); return; }

  const projects = await storageManager.getProjects();
  wizardProject  = projects.find(p => p.id === projectId);

  if (scope === "project") {
    wizardCodings = await storageManager.getCodingsByProject(projectId);
  } else if (scope === "themes") {
    const checked = [...document.querySelectorAll("#themes-checkboxes input:checked")].map(i => i.value);
    if (checked.length === 0) { showToast("Bitte mindestens ein Thema auswählen.", true); return; }
    wizardCodings = await storageManager.getCodingsByThemes(projectId, checked);
  } else if (scope === "document") {
    const docId = document.getElementById("export-document-select").value;
    if (!docId) { showToast("Bitte ein Dokument auswählen.", true); return; }
    wizardCodings = await storageManager.getCodings(projectId, docId);
  }

  wizardThemes    = await storageManager.getThemes(projectId);
  const allDocs   = await storageManager.getDocuments();
  const docIds    = [...new Set(wizardCodings.map(c => c.document_id))];
  wizardDocuments = allDocs.filter(d => docIds.includes(d.id));

  // Vorschau rendern
  renderExportPreview();
  goToStep(2);
}

function renderExportPreview() {
  const preview = document.getElementById("export-preview");

  if (wizardCodings.length === 0) {
    preview.innerHTML = `<p style="color:#f38ba8">⚠ Keine Codierungen für diese Auswahl gefunden.</p>`;
    return;
  }

  // Codierungen pro Thema zählen
  const countByTheme = new Map();
  for (const c of wizardCodings) {
    countByTheme.set(c.theme_id, (countByTheme.get(c.theme_id) ?? 0) + 1);
  }

  const themeListHtml = wizardThemes
    .filter(t => countByTheme.has(t.id))
    .map(t => `
      <div class="preview-theme-row">
        <span class="color-dot" style="background:${escapeHtml(t.color)}"></span>
        <span style="flex:1;font-size:12px">${escapeHtml(t.name)}</span>
        <span class="num-badge">${countByTheme.get(t.id)}</span>
      </div>
    `).join("");

  preview.innerHTML = `
    <div class="preview-stat">Projekt: <strong>${escapeHtml(wizardProject?.name ?? "–")}</strong></div>
    <div class="preview-stat">Codierungen gesamt: <strong>${wizardCodings.length}</strong></div>
    <div class="preview-stat">Dokumente: <strong>${wizardDocuments.length}</strong></div>
    <div class="preview-theme-list">${themeListHtml}</div>
  `;
}

function goToStep(step) {
  wizardStep = step;
  updateWizardUI(step);
}

function updateWizardUI(step) {
  // Panels umschalten
  document.querySelectorAll(".wizard-panel").forEach((panel, i) => {
    panel.classList.toggle("active", i + 1 === step);
  });

  // Schritt-Indikatoren aktualisieren
  document.querySelectorAll(".wizard-step").forEach((indicator) => {
    const s = parseInt(indicator.dataset.step, 10);
    indicator.classList.remove("active", "done");
    if (s === step) indicator.classList.add("active");
    else if (s < step) indicator.classList.add("done");
  });
}

async function runDashboardExport() {
  if (wizardCodings.length === 0) {
    showToast("Keine Codierungen zum Exportieren.", true);
    return;
  }

  const layout    = document.querySelector("input[name='export-layout']:checked")?.value ?? "per_theme";
  const XLSX      = window.XLSX;
  const projectName = wizardProject?.name ?? "Projekt";
  const date      = new Date();
  const p         = n => String(n).padStart(2, "0");
  const dateStamp = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`;

  let wb;
  if (layout === "per_theme") {
    wb = buildPerThemeWorkbook(XLSX, wizardThemes, wizardCodings, wizardDocuments, projectName);
  } else {
    wb = buildCombinedWorkbook(XLSX, wizardThemes, wizardCodings, wizardDocuments, projectName);
  }

  const fileName = `${sanitizeFileName(projectName)}_${dateStamp}.xlsx`;
  downloadWorkbook(XLSX, wb, fileName);
  showToast("Excel-Datei wird heruntergeladen.");
}

// ── Excel-Export-Hilfsfunktionen ──────────────────────────────────────────

// Pro Thema ein Sheet
function buildPerThemeWorkbook(XLSX, themes, codings, documents, projectName) {
  const wb = XLSX.utils.book_new();

  // Dokument-Lookup: id → name
  const docNameMap = new Map(documents.map(d => [d.id, extractDocName(d)]));

  for (const theme of themes) {
    const themeCodings = codings.filter(c => c.theme_id === theme.id);
    if (themeCodings.length === 0) continue;

    const rows = [
      ["Textstelle", "Seite", "Dokument", "Codiert am"],
      ...themeCodings.map(c => [
        c.text,
        c.page,
        docNameMap.get(c.document_id) ?? c.document_id,
        formatDateTime(c.created_at),
      ]),
    ];

    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Seite-Spalte als Zahl
    themeCodings.forEach((c, i) => {
      const ref = `B${i + 2}`;
      if (ws[ref]) { ws[ref].t = "n"; ws[ref].v = c.page; }
    });

    ws["!cols"] = [{ wch: 65 }, { wch: 7 }, { wch: 32 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(theme.name));
  }

  // Fallback: leeres Sheet wenn kein Thema Codierungen hat
  if (wb.SheetNames.length === 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Keine Codierungen"]]), "Leer");
  }

  return wb;
}

// Alles in einem Sheet
function buildCombinedWorkbook(XLSX, themes, codings, documents, projectName) {
  const wb = XLSX.utils.book_new();

  // Dokument- und Thema-Lookup
  const docNameMap   = new Map(documents.map(d => [d.id, extractDocName(d)]));
  const themeNameMap = new Map(themes.map(t => [t.id, t.name]));

  const rows = [
    ["Thema", "Textstelle", "Seite", "Dokument", "Codiert am"],
    ...codings.map(c => [
      themeNameMap.get(c.theme_id) ?? "(Thema gelöscht)",
      c.text,
      c.page,
      docNameMap.get(c.document_id) ?? c.document_id,
      formatDateTime(c.created_at),
    ]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Seite-Spalte als Zahl
  codings.forEach((c, i) => {
    const ref = `C${i + 2}`;
    if (ws[ref]) { ws[ref].t = "n"; ws[ref].v = c.page; }
  });

  ws["!cols"] = [{ wch: 20 }, { wch: 60 }, { wch: 7 }, { wch: 32 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws, "Codierungen");

  return wb;
}

// Excel-Datei herunterladen
function downloadWorkbook(XLSX, wb, filename) {
  const wbOut = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob  = new Blob([wbOut], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ── Seite: Backup ─────────────────────────────────────────────────────────

async function renderBackup() {
  // Einzelnes-Projekt-Dropdown befüllen
  const projects = await storageManager.getProjects();
  const sel      = document.getElementById("single-project-select");
  sel.innerHTML  = "";
  for (const p of projects) {
    const opt       = document.createElement("option");
    opt.value       = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  }

  // Schaltflächen verdrahten
  document.getElementById("btn-full-export").onclick = async () => {
    try {
      const json  = await storageManager.exportBackup();
      downloadJson(json, `PDFCoder_Backup_${todayStamp()}.json`);
      showToast("Backup erstellt.");
    } catch (err) {
      showToast("Backup fehlgeschlagen: " + err.message, true);
    }
  };

  document.getElementById("btn-full-import").onclick = () => {
    document.getElementById("full-import-file").value = "";
    document.getElementById("full-import-file").click();
  };

  document.getElementById("full-import-file").onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm("Alle vorhandenen Daten werden durch das Backup ersetzt. Fortfahren?")) return;
    try {
      const text = await file.text();
      await storageManager.importBackup(text);
      notifyDataChanged("projects");
      await renderBackup();
      showToast("Backup importiert.");
    } catch (err) {
      showToast("Import fehlgeschlagen: " + err.message, true);
    }
  };

  document.getElementById("btn-project-export").onclick = async () => {
    const projectId = document.getElementById("single-project-select").value;
    if (!projectId) return;
    try {
      const json    = await storageManager.exportProject(projectId);
      const project = projects.find(p => p.id === projectId);
      downloadJson(json, `PDFCoder_Projekt_${sanitizeFileName(project?.name ?? "export")}_${todayStamp()}.json`);
      showToast("Projekt exportiert.");
    } catch (err) {
      showToast("Export fehlgeschlagen: " + err.message, true);
    }
  };

  document.getElementById("btn-project-import").onclick = () => {
    document.getElementById("project-import-file").value = "";
    document.getElementById("project-import-file").click();
  };

  document.getElementById("project-import-file").onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const newProjectId = await storageManager.importProject(text);
      notifyDataChanged("projects");
      await renderBackup();
      showToast("Projekt importiert.");
    } catch (err) {
      showToast("Import fehlgeschlagen: " + err.message, true);
    }
  };

  document.getElementById("btn-clear-all").onclick = async () => {
    if (!confirm("Alle Daten löschen? Dieser Schritt kann nicht rückgängig gemacht werden.")) return;
    if (!confirm("Wirklich alle Daten löschen? Das kann nicht rückgängig gemacht werden!")) return;
    await storageManager.clearAllData();
    notifyDataChanged("projects");
    await renderBackup();
    showToast("Alle Daten gelöscht.");
  };
}

// JSON-Datei herunterladen
function downloadJson(json, filename) {
  const blob = new Blob([json], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function todayStamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

// ── Initialisierung ───────────────────────────────────────────────────────

async function init() {
  await storageManager.ready;
  await renderPage("start");
}

init();

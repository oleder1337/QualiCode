// coding.js – Kernfunktion: Text selektieren, Thema zuordnen, Highlights anzeigen
// Kommuniziert mit viewer.js (Events: page-rendered, viewer-ready)
// und sidebar.js (window.themesApi, Event: codings-updated)
// Datenzugriff ausschließlich über storage.js

import { storageManager, DEFAULT_PROJECT_ID } from "./storage.js";

// ── DOM-Referenzen ─────────────────────────────────────────────────────────

const codingMenu       = document.getElementById("coding-menu");
const codingMenuThemes = document.getElementById("coding-menu-themes");

// ── Zustand ────────────────────────────────────────────────────────────────

let codings           = [];     // Alle Codierungen des aktuellen Projekts + Dokuments
let pdfUrl            = null;   // URL des geladenen PDFs
let docName           = null;   // Dateiname für Anzeige
let docHash           = null;   // Hash der ersten 8 KB (robuste Identifikation)
let documentId        = null;   // IndexedDB-ID des Dokument-Eintrags
let activeProjectId   = DEFAULT_PROJECT_ID;
let pendingSelection  = null;   // Laufende Selektion (bis Thema gewählt wird)

// IDs von Codierungen, die nicht wiederhergestellt werden konnten
const unresolvableIds = new Set();

// ── Themen-Zugriff (sidebar.js setzt window.themesApi) ────────────────────

function getThemes() {
  return window.themesApi?.getThemes() ?? [];
}

// ── Codings laden ─────────────────────────────────────────────────────────

async function loadCodings() {
  if (!documentId) return;
  codings = await storageManager.getCodings(activeProjectId, documentId);
  dispatchCodingsUpdated();

  // Alle bereits gerenderten Seiten nachträglich mit Highlights versehen.
  // (page-rendered feuerte noch bevor die Codings geladen waren.)
  for (const page of document.querySelectorAll(".pdf-page")) {
    applyHighlightsForPage(parseInt(page.dataset.pageNum, 10));
  }

  // Kurze Toast-Benachrichtigung wenn Codierungen wiederhergestellt wurden
  if (codings.length > 0) {
    showToast(`${codings.length} Codierung${codings.length !== 1 ? "en" : ""} wiederhergestellt`);
  }
}

// ── Projektwechsel ────────────────────────────────────────────────────────

async function switchProject(newProjectId) {
  activeProjectId = newProjectId;
  window.activeProjectId = newProjectId;

  // Alle Highlight-Schichten entfernen
  document.querySelectorAll(".highlights-layer").forEach(el => el.remove());

  // Zustand zurücksetzen
  unresolvableIds.clear();
  codings = [];
  dispatchCodingsUpdated();

  // Falls ein Dokument geladen ist: Verknüpfung herstellen und Codings laden
  if (documentId) {
    await storageManager.ensureProjectDocument(newProjectId, documentId);
    await loadCodings();
    // Highlights für alle bereits gerenderten Seiten anwenden
    for (const page of document.querySelectorAll(".pdf-page")) {
      applyHighlightsForPage(parseInt(page.dataset.pageNum, 10));
    }
  }
}

// ── Highlights rendern ────────────────────────────────────────────────────

// Alle Highlights einer bestimmten Seite (neu) zeichnen
// Wird nach jedem page-rendered-Event und nach Zoom aufgerufen
function applyHighlightsForPage(pageNum) {
  const pageContainer = document.querySelector(`.pdf-page[data-page-num="${pageNum}"]`);
  if (!pageContainer) return;

  // Highlight-Schicht zurücksetzen (bei Re-Render nach Zoom)
  const existingLayer = pageContainer.querySelector(".highlights-layer");
  if (existingLayer) existingLayer.remove();

  const pageCodings = codings.filter(c => c.page === pageNum);
  if (pageCodings.length === 0) return;

  // Highlights-Layer vor dem Text-Layer einfügen
  const layer = document.createElement("div");
  layer.className = "highlights-layer";
  const textLayer = pageContainer.querySelector(".textLayer");
  pageContainer.insertBefore(layer, textLayer ?? null);

  for (const coding of pageCodings) {
    drawHighlight(coding, pageContainer, layer);
  }
}

// Highlight-Overlays für eine einzelne Codierung in die Highlights-Schicht zeichnen
function drawHighlight(coding, pageContainer, layer, animate = false) {
  // layer kann fehlen wenn drawHighlight direkt nach applyHighlightForPage aufgerufen wird
  if (!layer) {
    layer = pageContainer.querySelector(".highlights-layer");
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "highlights-layer";
      const textLayer = pageContainer.querySelector(".textLayer");
      pageContainer.insertBefore(layer, textLayer ?? null);
    }
  }

  const textLayer = pageContainer.querySelector(".textLayer");
  if (!textLayer) return;

  // Primär: Range aus gespeicherten Span-Indizes wiederherstellen
  let range = rebuildRange(coding, textLayer);

  // Fallback: Text-Suche im Text-Layer wenn Span-Indizes nicht mehr stimmen
  if (!range) {
    range = findRangeByText(coding.text, textLayer);
  }

  // Nicht zuordbar: In Sidebar markieren und abbrechen
  if (!range) {
    unresolvableIds.add(coding.id);
    dispatchCodingsUpdated();
    return;
  }
  // Falls die Codierung zuvor als nicht zuordbar galt, zurücksetzen
  unresolvableIds.delete(coding.id);

  const themes = getThemes();
  // Thema über theme_id finden (neues Feld)
  const theme  = themes.find(t => t.id === coding.theme_id);
  const color  = theme?.color ?? "#888888";
  const label  = theme?.name  ?? "(Thema gelöscht)";

  const pageRect = pageContainer.getBoundingClientRect();

  for (const rect of range.getClientRects()) {
    if (rect.width < 1) continue;

    const div = document.createElement("div");
    div.className        = "highlight-overlay";
    div.dataset.codingId = coding.id;
    div.title            = label;

    div.style.cssText = `
      left:          ${rect.left  - pageRect.left}px;
      top:           ${rect.top   - pageRect.top}px;
      width:         ${rect.width}px;
      height:        ${rect.height}px;
      background:    ${hexToRgba(color, 0.32)};
      border-bottom: 2px solid ${hexToRgba(color, 0.75)};
    `;
    if (animate) div.classList.add("highlight-animate");

    layer.appendChild(div);
  }
}

// Range aus gespeicherten Span-Indizes und Zeichen-Offsets rekonstruieren
function rebuildRange(coding, textLayer) {
  const spans     = textLayer.querySelectorAll("span");
  const startSpan = spans[coding.startSpanIndex];
  const endSpan   = spans[coding.endSpanIndex];
  if (!startSpan || !endSpan) return null;

  const startNode = startSpan.firstChild;
  const endNode   = endSpan.firstChild;
  if (!startNode || !endNode) return null;

  try {
    const range = document.createRange();
    range.setStart(startNode, Math.min(coding.startOffset, startNode.length));
    range.setEnd(endNode,     Math.min(coding.endOffset,   endNode.length));
    // Plausibilitätsprüfung: stimmt der selektierte Text noch überein?
    if (!range.toString().trim()) return null;
    return range;
  } catch {
    return null;
  }
}

// Fallback: Codierungs-Text in den Seiten-Spans suchen und Range erstellen
function findRangeByText(searchText, textLayer) {
  const spans  = Array.from(textLayer.querySelectorAll("span"));
  const texts  = spans.map(s => s.textContent);
  const full   = texts.join("");
  const target = searchText.trim();
  if (!target) return null;

  const idx = full.indexOf(target);
  if (idx === -1) return null;

  // Zeichenposition auf Span + Offset innerhalb des Spans mappen
  let charCount = 0;
  let startSpan = -1, startOff = 0, endSpan = -1, endOff = 0;

  for (let i = 0; i < spans.length; i++) {
    const len = texts[i].length;
    if (startSpan === -1 && charCount + len > idx) {
      startSpan = i;
      startOff  = idx - charCount;
    }
    if (startSpan !== -1 && charCount + len >= idx + target.length) {
      endSpan = i;
      endOff  = idx + target.length - charCount;
      break;
    }
    charCount += len;
  }

  if (startSpan === -1 || endSpan === -1) return null;

  try {
    const range      = document.createRange();
    const startNode  = spans[startSpan].firstChild;
    const endNode    = spans[endSpan].firstChild;
    if (!startNode || !endNode) return null;
    range.setStart(startNode, Math.min(startOff, startNode.length));
    range.setEnd(endNode,     Math.min(endOff,   endNode.length));
    return range;
  } catch {
    return null;
  }
}

// ── Text-Selektion erkennen ────────────────────────────────────────────────

document.addEventListener("mouseup", (e) => {
  // Klicks im Coding-Menü selbst ignorieren (würden Selektion löschen)
  if (e.target.closest("#coding-menu")) return;

  // Kleines Delay: Browser braucht einen Tick um die Selektion zu setzen
  setTimeout(() => {
    const selection = window.getSelection();

    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      hideCodingMenu();
      pendingSelection = null;
      return;
    }

    const range = selection.getRangeAt(0);

    // Prüfe ob Selektion im Text-Layer liegt
    const startEl   = range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : range.startContainer;
    const textLayer = startEl.closest(".textLayer");
    if (!textLayer) {
      hideCodingMenu();
      return;
    }

    const pageContainer = textLayer.closest(".pdf-page");
    if (!pageContainer) return;

    const pageNum = parseInt(pageContainer.dataset.pageNum, 10);
    const spans   = Array.from(textLayer.querySelectorAll("span"));

    // Span-Eltern der Start- und End-Textknoten ermitteln
    const startParent = range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement : range.startContainer;
    const endParent   = range.endContainer.nodeType === Node.TEXT_NODE
      ? range.endContainer.parentElement : range.endContainer;

    const startSpanIndex = spans.indexOf(startParent);
    const endSpanIndex   = spans.indexOf(endParent);
    if (startSpanIndex === -1 || endSpanIndex === -1) return;

    pendingSelection = {
      text:            selection.toString().trim(),
      page:            pageNum,
      startSpanIndex,
      startOffset:     range.startOffset,
      endSpanIndex,
      endOffset:       range.endOffset,
      pageContainer,
      range:           range.cloneRange(),
    };

    showCodingMenu(range.getBoundingClientRect(), e.clientX);
  }, 10);
});

// Klick außerhalb des Menüs → schließen
document.addEventListener("mousedown", (e) => {
  if (!e.target.closest("#coding-menu")) {
    hideCodingMenu();
  }
});

// ── Floating Menü ─────────────────────────────────────────────────────────

function showCodingMenu(selectionRect, mouseX) {
  const themes = getThemes();

  codingMenuThemes.innerHTML = "";

  if (themes.length === 0) {
    const li = document.createElement("li");
    li.className   = "coding-menu-empty";
    li.textContent = "Keine Themen vorhanden – zuerst Themen anlegen.";
    codingMenuThemes.appendChild(li);
  } else {
    themes.forEach((theme, idx) => {
      const li = document.createElement("li");
      li.className = "coding-menu-theme";
      const shortcut = idx < 9 ? `<span class="coding-menu-shortcut">⌃⇧${idx + 1}</span>` : "";
      li.innerHTML = `
        <span class="coding-menu-dot" style="background:${theme.color}"></span>
        <span>${escapeHtml(theme.name)}</span>
        ${shortcut}
      `;
      // mousedown statt click: verhindert Verlust der Text-Selektion
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        applyCodeToSelection(theme);
      });
      codingMenuThemes.appendChild(li);
    });
  }

  codingMenu.hidden = false;

  // Position: unterhalb der Selektion, linksbündig mit Mausklick
  const menuH = codingMenu.offsetHeight;
  let top  = selectionRect.bottom + 8;
  let left = mouseX - 10;

  // Viewport-Grenzen einhalten
  if (left + 200 > window.innerWidth)  left = window.innerWidth - 210;
  if (top  + menuH > window.innerHeight) top = selectionRect.top - menuH - 8;

  codingMenu.style.top  = `${top}px`;
  codingMenu.style.left = `${left}px`;
}

function hideCodingMenu() {
  codingMenu.hidden = true;
}

// ── Codierung anwenden ────────────────────────────────────────────────────

async function applyCodeToSelection(theme) {
  if (!pendingSelection) return;

  const { text, page, startSpanIndex, startOffset, endSpanIndex, endOffset, pageContainer } = pendingSelection;

  const coding = {
    id:             "coding-" + crypto.randomUUID(),
    project_id:     activeProjectId,
    document_id:    documentId,
    theme_id:       theme.id,       // neues Feld (war: themeId)
    text,
    page,
    startSpanIndex,
    startOffset,
    endSpanIndex,
    endOffset,
    created_at:     new Date().toISOString(),  // neues Feld (war: createdAt)
  };

  codings.push(coding);
  await storageManager.addCoding(coding);
  dispatchCodingsUpdated();

  // Highlight sofort anzeigen (layer=null → drawHighlight sucht/erstellt ihn selbst)
  drawHighlight(coding, pageContainer, null, true);

  // Selektion und Menü aufräumen
  window.getSelection().removeAllRanges();
  hideCodingMenu();
  pendingSelection = null;
}

// ── Codierung entfernen ───────────────────────────────────────────────────

async function removeCoding(id) {
  await storageManager.removeCoding(id);
  codings = codings.filter(c => c.id !== id);
  document.querySelectorAll(`.highlight-overlay[data-coding-id="${id}"]`)
    .forEach(el => el.remove());
  dispatchCodingsUpdated();
}

// Codierung finden, die den gegebenen Viewport-Punkt überdeckt
function findCodingAtPoint(clientX, clientY, pageContainer) {
  const pageRect = pageContainer.getBoundingClientRect();
  const relX = clientX - pageRect.left;
  const relY = clientY - pageRect.top;

  for (const overlay of pageContainer.querySelectorAll(".highlight-overlay")) {
    const l = parseFloat(overlay.style.left);
    const t = parseFloat(overlay.style.top);
    const r = l + parseFloat(overlay.style.width);
    const b = t + parseFloat(overlay.style.height);
    if (relX >= l && relX <= r && relY >= t && relY <= b) {
      return codings.find(c => c.id === overlay.dataset.codingId) ?? null;
    }
  }
  return null;
}

// ── Globale API (für sidebar.js) ──────────────────────────────────────────

window.codingApi = {
  removeCoding,
  getCodings:    () => codings,
  switchProject,
};

// ── Rechtsklick auf Highlights ────────────────────────────────────────────

document.addEventListener("contextmenu", (e) => {
  // Nur innerhalb einer PDF-Seite reagieren
  const pageContainer = e.target.closest(".pdf-page");
  if (!pageContainer) return;

  const hit = findCodingAtPoint(e.clientX, e.clientY, pageContainer);
  if (!hit) return;

  e.preventDefault();
  const preview = hit.text.length > 60 ? hit.text.slice(0, 60) + "…" : hit.text;
  if (confirm(`Codierung entfernen?\n\n„${preview}"`)) removeCoding(hit.id);
});

// ── Sidebar informieren ───────────────────────────────────────────────────

function dispatchCodingsUpdated() {
  document.dispatchEvent(new CustomEvent("codings-updated", {
    detail: { codings, unresolvableIds: [...unresolvableIds] }
  }));
}

// ── Toast-Benachrichtigung ────────────────────────────────────────────────

function showToast(message, duration = 3500) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => { toast.hidden = true; }, duration);
}

// ── Hilfsfunktionen ───────────────────────────────────────────────────────

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Tastaturkürzel ────────────────────────────────────────────────────────

document.addEventListener("keydown", (e) => {
  // Escape: Floating-Menü schließen
  if (e.key === "Escape") {
    hideCodingMenu();
    pendingSelection = null;
    return;
  }

  // Ctrl+Shift+1-9: Selektierten Text dem n-ten Thema zuordnen
  if (e.ctrlKey && e.shiftKey && e.key >= "1" && e.key <= "9") {
    if (!pendingSelection) return;
    const idx   = parseInt(e.key, 10) - 1;
    const theme = getThemes()[idx];
    if (!theme) return;
    e.preventDefault();
    applyCodeToSelection(theme);
  }
});

// ── Event-Listener: viewer.js ─────────────────────────────────────────────

// Viewer ist fertig gerendert → Codings laden und alle Highlights anzeigen
document.addEventListener("viewer-ready", async (e) => {
  pdfUrl  = e.detail.pdfUrl;
  docName = e.detail.docName;
  docHash = e.detail.docHash ?? null;

  // Auf Datenbank-Bereitschaft warten
  await storageManager.ready;

  // Aktives Projekt aus globalem Zustand übernehmen
  activeProjectId = window.activeProjectId ?? DEFAULT_PROJECT_ID;

  // Dokument in der Datenbank anlegen oder finden
  const doc = await storageManager.ensureDocument(pdfUrl, docHash, docName);
  documentId = doc.id;

  // Projekt-Dokument-Verknüpfung sicherstellen
  await storageManager.ensureProjectDocument(activeProjectId, documentId);

  // Codings laden
  await loadCodings();
});

// Einzelne Seite wurde (neu) gerendert → Highlights für diese Seite anwenden
// Wird auch nach Zoom aufgerufen, da renderAllPages() alle Seiten neu rendert
document.addEventListener("page-rendered", (e) => {
  applyHighlightsForPage(e.detail.pageNum);
});

// Nachrichten vom Dashboard empfangen
chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== "DATA_CHANGED") return;
  if (message.scope === "codings" && documentId) {
    // Highlights neu laden
    document.querySelectorAll(".highlights-layer").forEach(el => el.remove());
    codings = [];
    unresolvableIds.clear();
    dispatchCodingsUpdated();
    if (activeProjectId && documentId) loadCodings();
  }
});

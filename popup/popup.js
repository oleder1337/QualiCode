// popup.js – Minimales Popup: Statistik + Dashboard-Button + zuletzt bearbeitete Dokumente
import { storageManager } from "../viewer/storage.js";

const statProjects = document.getElementById("stat-projects");
const statDocs     = document.getElementById("stat-docs");
const statCodings  = document.getElementById("stat-codings");
const btnDashboard = document.getElementById("btn-open-dashboard");
const docList      = document.getElementById("doc-list");
const docEmpty     = document.getElementById("doc-empty");

btnDashboard.addEventListener("click", () => {
  const url = chrome.runtime.getURL("dashboard/dashboard.html");
  chrome.tabs.create({ url });
});

async function init() {
  await storageManager.ready;

  const [projects, docs, allCodings] = await Promise.all([
    storageManager.getProjects(),
    storageManager.getDocuments(),
    storageManager.getAllCodings(),
  ]);

  // Statistik
  const countByDoc = new Map();
  for (const c of allCodings) {
    countByDoc.set(c.document_id, (countByDoc.get(c.document_id) ?? 0) + 1);
  }
  const docsWithCodings = docs.filter(d => (countByDoc.get(d.id) ?? 0) > 0);

  statProjects.textContent = projects.length;
  statDocs.textContent     = docsWithCodings.length;
  statCodings.textContent  = allCodings.length;

  // Zuletzt bearbeitet (max 5)
  const recent = docsWithCodings
    .sort((a, b) => (b.last_edited ?? "").localeCompare(a.last_edited ?? ""))
    .slice(0, 5);

  docEmpty.hidden = recent.length > 0;
  docList.innerHTML = "";

  for (const doc of recent) {
    const count = countByDoc.get(doc.id) ?? 0;
    const li    = document.createElement("li");
    li.className = "doc-item";
    const name = doc.name || extractName(doc.url) || "Unbekannt";
    li.innerHTML = `
      <span class="doc-icon">📄</span>
      <div class="doc-info">
        <div class="doc-name" title="${escapeHtml(doc.url ?? "")}">${escapeHtml(name)}</div>
        <div class="doc-meta"><span>${count} Codierung${count !== 1 ? "en" : ""}</span></div>
      </div>
    `;
    li.querySelector(".doc-info").addEventListener("click", () => openInViewer(doc.url));
    docList.appendChild(li);
  }
}

function openInViewer(url) {
  if (!url) return;
  const base = chrome.runtime.getURL("viewer/viewer.html");
  chrome.tabs.create({ url: `${base}?url=${encodeURIComponent(url)}` });
}

function extractName(url) {
  if (!url) return "";
  try { return decodeURIComponent(new URL(url).pathname.split("/").pop()); }
  catch { return url.slice(-40); }
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

init();

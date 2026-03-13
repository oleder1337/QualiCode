// Viewer-Logik: Lädt das PDF per PDF.js und rendert alle Seiten
// mit Canvas und Text-Layer (selektierbarer Text)

// PDF.js als ES-Modul lokal laden (CDN ist in MV3 per CSP verboten)
import * as pdfjsLib from "../lib/pdf.min.mjs";

// Worker-URL auf die lokale Kopie setzen
pdfjsLib.GlobalWorkerOptions.workerSrc =
  chrome.runtime.getURL("lib/pdf.worker.min.mjs");

// ── DOM-Referenzen ──────────────────────────────────────

const pagesWrapper    = document.getElementById("pages-wrapper");
const loadingOverlay  = document.getElementById("loading-overlay");
const errorOverlay    = document.getElementById("error-overlay");
const errorText       = document.getElementById("error-text");
const pageCurrent     = document.getElementById("page-current");
const pageTotal       = document.getElementById("page-total");
const pdfTitle        = document.getElementById("pdf-title");
const zoomLabel       = document.getElementById("zoom-label");
const btnPrev         = document.getElementById("btn-prev");
const btnNext         = document.getElementById("btn-next");
const btnZoomIn       = document.getElementById("btn-zoom-in");
const btnZoomOut      = document.getElementById("btn-zoom-out");
const viewerContainer = document.getElementById("viewer-container");

// ── Zustand ─────────────────────────────────────────────

let pdfDoc        = null;   // Geladenes PDF-Dokument
let currentPage   = 1;      // Aktuelle Seite (für Anzeige)
let scale         = 1.5;    // Zoom-Faktor (1.5 = 150%)
let isRendering   = false;  // Verhindert parallele Render-Aufrufe

const SCALE_MIN   = 0.5;
const SCALE_MAX   = 3.0;
const SCALE_STEP  = 0.25;

// ── PDF-URL aus Query-String auslesen ───────────────────

function getPdfUrl() {
  const params = new URLSearchParams(window.location.search);
  const url = params.get("url");
  if (!url) return null;
  return decodeURIComponent(url);
}

// ── Fehlermeldung anzeigen ──────────────────────────────

function showError(message) {
  loadingOverlay.hidden = true;
  errorText.textContent = message;
  errorOverlay.hidden = false;
}

// ── Ladeindikator ausblenden ────────────────────────────

function hideLoading() {
  loadingOverlay.hidden = true;
}

// ── Einzelne Seite rendern ──────────────────────────────

async function renderPage(pageNum) {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  // Container für diese Seite erstellen
  const pageContainer = document.createElement("div");
  pageContainer.className = "pdf-page";
  pageContainer.dataset.pageNum = pageNum;
  pageContainer.style.width  = `${viewport.width}px`;
  pageContainer.style.height = `${viewport.height}px`;
  // PDF.js 4.x berechnet font-size/left/top der Text-Spans als
  // calc(var(--scale-factor) * Xpx) – ohne diese Variable sind alle Spans 0px groß
  pageContainer.style.setProperty("--scale-factor", scale);

  // Canvas für das gerenderte PDF-Bild
  const canvas = document.createElement("canvas");
  canvas.width  = viewport.width;
  canvas.height = viewport.height;

  // Text-Layer-Div (liegt über dem Canvas, macht Text selektierbar)
  const textLayerDiv = document.createElement("div");
  textLayerDiv.className = "textLayer";
  textLayerDiv.style.width  = `${viewport.width}px`;
  textLayerDiv.style.height = `${viewport.height}px`;

  pageContainer.appendChild(canvas);
  pageContainer.appendChild(textLayerDiv);
  pagesWrapper.appendChild(pageContainer);

  // PDF-Seite auf Canvas rendern
  const renderContext = {
    canvasContext: canvas.getContext("2d"),
    viewport,
  };
  await page.render(renderContext).promise;

  // coding.js informieren, damit Highlights für diese Seite angewendet werden
  document.dispatchEvent(new CustomEvent("page-rendered", { detail: { pageNum } }));

  // Text-Layer aufbauen mit ReadableStream (bevorzugtes Format in PDF.js 4.x)
  try {
    const textStream = page.streamTextContent();
    const textLayerTask = pdfjsLib.renderTextLayer({
      textContentSource: textStream,
      container: textLayerDiv,
      viewport,
    });
    await textLayerTask.promise;
  } catch (textErr) {
    // Text-Layer-Fehler sind nicht kritisch – Canvas-Rendering bleibt sichtbar
    console.warn(`[PDF Coder] Text-Layer Seite ${pageNum} fehlgeschlagen:`, textErr);
  }
}

// ── Alle Seiten rendern ─────────────────────────────────

async function renderAllPages() {
  if (isRendering) return;
  isRendering = true;

  // Bestehende Seiten entfernen (z.B. nach Zoom-Änderung)
  pagesWrapper.innerHTML = "";

  const total = pdfDoc.numPages;
  pageTotal.textContent = total;

  for (let i = 1; i <= total; i++) {
    await renderPage(i);
  }

  isRendering = false;
  updatePageIndicator();
}

// ── Aktuelle Seite anhand Scroll-Position ermitteln ─────

function updatePageIndicator() {
  const containerTop = viewerContainer.scrollTop;
  const pages = pagesWrapper.querySelectorAll(".pdf-page");

  let visible = 1;
  for (const page of pages) {
    const pageTop = page.offsetTop - pagesWrapper.offsetTop;
    if (pageTop <= containerTop + viewerContainer.clientHeight / 2) {
      visible = parseInt(page.dataset.pageNum, 10);
    }
  }

  currentPage = visible;
  pageCurrent.textContent = currentPage;

  // Navigations-Buttons aktivieren/deaktivieren
  btnPrev.disabled = currentPage <= 1;
  btnNext.disabled = currentPage >= pdfDoc.numPages;
}

// ── Zu einer bestimmten Seite scrollen ──────────────────

function scrollToPage(pageNum) {
  const target = pagesWrapper.querySelector(`[data-page-num="${pageNum}"]`);
  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// ── Zoom aktualisieren ──────────────────────────────────

async function applyZoom(newScale) {
  scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, newScale));
  zoomLabel.textContent = `${Math.round(scale * 100)}%`;
  const pageBeforeZoom = currentPage;
  await renderAllPages();
  scrollToPage(pageBeforeZoom);
}

// ── Event-Listener ──────────────────────────────────────

// Scroll → Seitenzahl aktualisieren
viewerContainer.addEventListener("scroll", updatePageIndicator, { passive: true });

// Navigation: zurück / vor
btnPrev.addEventListener("click", () => {
  if (currentPage > 1) scrollToPage(currentPage - 1);
});
btnNext.addEventListener("click", () => {
  if (pdfDoc && currentPage < pdfDoc.numPages) scrollToPage(currentPage + 1);
});

// Zoom
btnZoomIn.addEventListener("click",  () => applyZoom(scale + SCALE_STEP));
btnZoomOut.addEventListener("click", () => applyZoom(scale - SCALE_STEP));

// Tastaturkürzel
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight" || e.key === "ArrowDown") {
    if (pdfDoc && currentPage < pdfDoc.numPages) scrollToPage(currentPage + 1);
  } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
    if (currentPage > 1) scrollToPage(currentPage - 1);
  } else if (e.key === "+" || e.key === "=") {
    applyZoom(scale + SCALE_STEP);
  } else if (e.key === "-") {
    applyZoom(scale - SCALE_STEP);
  }
});

// ── Hash-Berechnung ─────────────────────────────────────

// djb2-Hash über die ersten 8 KB des PDFs als Hex-String
function computeHash(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer, 0, Math.min(8192, arrayBuffer.byteLength));
  let hash = 5381;
  for (const byte of bytes) {
    hash = (((hash << 5) + hash) ^ byte) & 0xffffffff;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// ── Haupt-Einstiegspunkt ────────────────────────────────

async function init() {
  const pdfUrl = getPdfUrl();

  if (!pdfUrl) {
    showError("Keine PDF-URL angegeben. Öffne eine .pdf-Datei im Browser.");
    return;
  }

  // PDF-URL global verfügbar machen (wird von coding.js benötigt)
  window.currentPdfUrl = pdfUrl;

  // Dateiname als Titel anzeigen
  let docName = "";
  try {
    const urlObj = new URL(pdfUrl);
    docName = decodeURIComponent(urlObj.pathname.split("/").pop());
    if (docName) {
      document.title = `${docName} – PDF Coder`;
      pdfTitle.textContent = docName;
    }
  } catch {
    // Fehler beim URL-Parsen ignorieren
  }
  window.currentDocName = docName;

  try {
    // PDF zuerst selbst fetchen: Extension-Pages mit <all_urls>-Permission
    // dürfen Cross-Origin-Requests stellen und umgehen damit CORS-Blockaden.
    // Anschließend das ArrayBuffer direkt an PDF.js übergeben.
    let arrayBuffer;
    try {
      const response = await fetch(pdfUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} – ${response.statusText}`);
      }
      arrayBuffer = await response.arrayBuffer();
    } catch (fetchErr) {
      console.error("[PDF Coder] fetch fehlgeschlagen:", fetchErr);
      throw new Error(`Fetch fehlgeschlagen: ${fetchErr.message}`);
    }

    // Hash VOR getDocument berechnen – PDF.js transferiert den ArrayBuffer
    // intern und macht ihn danach detached (unbrauchbar für weitere Zugriffe)
    const hashHex = computeHash(arrayBuffer);

    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    pdfDoc = await loadingTask.promise;
    hideLoading();

    // Zoom-Label initialisieren
    zoomLabel.textContent = `${Math.round(scale * 100)}%`;

    // Alle Seiten rendern
    await renderAllPages();

    // coding.js signalisieren, dass der Viewer vollständig bereit ist
    document.dispatchEvent(new CustomEvent("viewer-ready", {
      detail: { pdfUrl, docName, docHash: hashHex }
    }));

    // scrollToPage global verfügbar machen (wird von sidebar.js benötigt)
    window.scrollToPage = scrollToPage;
  } catch (err) {
    console.error("Fehler beim Laden des PDFs:", err);
    showError(`Fehler beim Laden: ${err.message}`);
  }
}

init();

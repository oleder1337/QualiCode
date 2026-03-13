// Service Worker: Fängt PDF-Navigationen ab und leitet sie zum eigenen Viewer weiter

// Höre auf alle abgeschlossenen Navigationen
chrome.webNavigation.onBeforeNavigate.addListener(
  async (details) => {
    // Nur Haupt-Frame-Navigationen behandeln (kein iframe etc.)
    if (details.frameId !== 0) return;

    const url = details.url;

    // Prüfe ob die URL auf .pdf endet (case-insensitive)
    // Ignoriere bereits umgeleitete URLs (unser eigener Viewer)
    if (isPdfUrl(url) && !isAlreadyRedirected(url)) {
      const viewerUrl = buildViewerUrl(url, details.tabId);

      // Leite den Tab auf den eigenen Viewer um
      chrome.tabs.update(details.tabId, { url: viewerUrl });
    }
  },
  { url: [{ urlMatches: ".*\\.pdf(\\?.*)?$" }] }
);

// Prüft ob eine URL auf eine PDF-Datei zeigt
function isPdfUrl(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    return path.endsWith(".pdf");
  } catch {
    return false;
  }
}

// Prüft ob die URL bereits unser Viewer ist (Endlos-Redirect verhindern)
function isAlreadyRedirected(url) {
  return url.includes(chrome.runtime.id) || url.includes("viewer.html");
}

// Baut die Viewer-URL auf: viewer.html?url=<kodierte-PDF-URL>
function buildViewerUrl(pdfUrl, tabId) {
  const viewerBase = chrome.runtime.getURL("viewer/viewer.html");
  const encodedPdfUrl = encodeURIComponent(pdfUrl);
  return `${viewerBase}?url=${encodedPdfUrl}`;
}

// Nachrichten vom Dashboard an alle offenen Viewer-Tabs weiterleiten
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "DATA_CHANGED") {
    broadcastToViewers(message);
  }
  sendResponse({ ok: true });
  return true;
});

async function broadcastToViewers(message) {
  const viewerBase = chrome.runtime.getURL("viewer/viewer.html");
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.url && tab.url.startsWith(viewerBase)) {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  }
}

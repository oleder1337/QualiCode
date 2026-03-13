# PDF Coder – Chrome Extension

Eine Chrome-Extension (Manifest V3) für **qualitatives PDF-Coding** – ideal für Forschung, Literaturarbeit und qualitative Inhaltsanalyse. PDFs werden automatisch in einem eigenen Viewer geöffnet, wo du Textstellen markieren, Themen zuordnen und Codierungen projektweise verwalten kannst.

---

## Features

### Viewer
- Automatische Weiterleitung aller `.pdf`-URLs in den eigenen Viewer (kein Chrome-Standard-PDF-Viewer)
- Selektierbarer Text-Layer via PDF.js – Text ist kopierbar, markierbar, durchsuchbar
- Seitennavigation (Buttons + Pfeiltasten), Zoom 50–300% (+/- Tasten)
- Persistente Highlights: Codierungen werden wiederhergestellt wenn du dasselbe PDF erneut öffnest

### Coding
- Textstelle markieren → schwebendes Menü → Thema zuordnen
- Tastaturkürzel: `Ctrl+Shift+1–9` für die ersten 9 Themen
- Rechtsklick auf ein Highlight → Codierung entfernen
- Sidebar zeigt alle Codierungen des Dokuments, gruppiert nach Thema, mit Suchfunktion und Statistik-Balkendiagramm

### Projekt-Verwaltung
- Unbegrenzt viele Projekte – jedes Projekt hat eigene Themen und Codierungen
- Dasselbe PDF kann in mehreren Projekten mit unterschiedlichen Codierungen erscheinen
- Projekte erstellen, bearbeiten, duplizieren (kopiert Themen, nicht Codierungen), löschen
- Projekt-Dropdown direkt in der Sidebar zum schnellen Wechsel

### Themen
- Themen pro Projekt mit Name und Farbe
- Reihenfolge per Drag & Drop anpassen
- Im Dashboard: Themen zwischen Projekten verschieben oder kopieren

### Excel-Export
- Export der Codierungen als `.xlsx` (via SheetJS)
- Dateiname: `{Projektname}_{Dokumentname}_{Datum}.xlsx`
- Zusammenfassungs-Sheet mit Statistik + ein Sheet pro Thema

### Dashboard
- Vollständiges Verwaltungs-Dashboard als eigener Tab (`Extension-Icon → Dashboard öffnen`)
- **Übersicht**: Statistik-Kacheln (Projekte, Themen, Dokumente, Codierungen), zuletzt bearbeitete Dokumente
- **Projekte**: Tabelle mit Kennzahlen, Detailansicht mit Themen und Dokumenten
- **Themen**: Alle Themen über alle Projekte, filterbar, verschiebbar/kopierbar
- **Dokumente**: Alle codierten Dokumente mit Projekt-Badges, Codierungen löschen, aus Projekt entfernen
- **Export-Wizard** (3 Schritte): Scope wählen → Vorschau → Download als `.xlsx`
- **Backup**: Vollständiges JSON-Backup, Einzel-Projekt-Export/Import, Alle-Daten-löschen

### Backup & Sync
- Backup der gesamten Datenbank als JSON
- Einzelne Projekte exportieren und importieren
- Änderungen im Dashboard synchronisieren sich live in offene Viewer-Tabs

---

## Installation

> Keine Store-Veröffentlichung – manuelle Installation als Entwickler-Extension.

1. Repository klonen oder als ZIP herunterladen
2. Chrome öffnen → `chrome://extensions`
3. **Entwicklermodus** (oben rechts) aktivieren
4. **„Entpackte Erweiterung laden"** klicken
5. Den Ordner `pdf-coding-extension/` auswählen (der Ordner, der `manifest.json` enthält)

Danach: Jede `.pdf`-URL im Browser wird automatisch im PDF Coder geöffnet.

---

## Verwendung

### Erster Start
Beim ersten Öffnen eines PDFs wird automatisch ein Standard-Projekt angelegt. Bestehende Daten aus einer älteren Version werden automatisch migriert.

### Workflow
1. PDF im Browser öffnen (wird automatisch umgeleitet)
2. Sidebar öffnen (`Ctrl+Shift+S` oder Button rechts oben)
3. Projekt auswählen oder neues Projekt erstellen
4. Themen anlegen (Name + Farbe)
5. Text im PDF markieren → Thema im Menü auswählen
6. Codierungen über die Sidebar durchsuchen und verwalten
7. Export: Sidebar → „Als Excel exportieren" oder Dashboard → Export-Wizard

### Tastaturkürzel

| Kürzel | Funktion |
|---|---|
| `Ctrl+Shift+S` | Sidebar öffnen/schließen |
| `Ctrl+Shift+1–9` | Markierten Text dem n-ten Thema zuordnen |
| `←` / `→` | Seite zurück / vor |
| `+` / `-` | Zoom rein / raus |
| `Escape` | Coding-Menü schließen |

---

## Projektstruktur

```
pdf-coding-extension/
├── manifest.json                  # Extension-Manifest (Manifest V3)
├── background/
│   └── service-worker.js          # PDF-Navigation abfangen, Dashboard-Sync
├── popup/
│   ├── popup.html/css/js          # Minimal-Popup: Statistik + Dashboard-Link
├── dashboard/
│   ├── dashboard.html             # Vollständiges Dashboard (eigener Tab)
│   ├── dashboard.css
│   └── dashboard.js               # Alle Dashboard-Seiten und Export-Wizard
├── viewer/
│   ├── viewer.html/css/js         # PDF-Viewer (PDF.js)
│   ├── storage.js                 # IndexedDB-Abstraktionsschicht (PDFCoderDB)
│   ├── sidebar.js                 # Projekt- und Themen-Verwaltung
│   ├── coding.js                  # Highlight-Logik und Codierungen
│   └── export.js                  # Excel-Export via SheetJS
├── lib/
│   ├── pdf.min.mjs                # PDF.js (lokal, kein CDN)
│   ├── pdf.worker.min.mjs
│   └── xlsx.full.min.js           # SheetJS (lokal, kein CDN)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Technische Details

| | |
|---|---|
| Manifest | V3 |
| Storage | IndexedDB (`PDFCoderDB`) via eigenem `storage.js`-Modul |
| PDF-Rendering | [PDF.js](https://mozilla.github.io/pdf.js/) 4.x (lokal eingebunden) |
| Excel-Export | [SheetJS](https://sheetjs.com/) (lokal eingebunden) |
| Skript-Typ | ES-Module (`type="module"`) durchgängig |
| Permissions | `activeTab`, `tabs`, `storage`, `webNavigation`, `downloads` |

### Datenmodell

```
projects       → id, name, description, color, created_at, last_opened
themes         → id, project_id, name, color, sort_order, created_at
documents      → id, url, url_hash, name, first_opened, last_edited
project_documents → id, project_id, document_id, added_at
codings        → id, project_id, document_id, theme_id, text, page,
                 startSpanIndex, startOffset, endSpanIndex, endOffset, created_at
```

### Viewer-Sync

Änderungen im Dashboard werden per `chrome.runtime.sendMessage` → Service Worker → `chrome.tabs.sendMessage` an alle offenen Viewer-Tabs übertragen, sodass Highlights und Themen-Listen sofort aktualisiert werden.

---

## Hinweise

- **CORS**: Remote-PDFs müssen vom Server CORS-Header (`Access-Control-Allow-Origin`) setzen. Lokale `file://`-PDFs funktionieren direkt.
- **Reload nach Code-Änderungen**: `chrome://extensions` → Neu laden-Symbol bei der Extension.
- **Nur Chrome**: Getestet mit Chrome/Chromium. Andere Chromium-basierte Browser (Edge, Brave) sollten funktionieren, sind aber nicht getestet.

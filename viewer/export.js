// export.js – Excel-Export der Codierungen via SheetJS
// SheetJS wird als klassisches Script geladen (window.XLSX), kein ES-Modul-Import

const btnExport = document.getElementById("btn-export-xlsx");

// ── Export-Button aktivieren sobald Codierungen vorhanden sind ──

document.addEventListener("codings-updated", (e) => {
  btnExport.disabled = e.detail.codings.length === 0;
});

btnExport.addEventListener("click", runExport);

// ── Farb-Konstanten (PDF Coder Palette) ─────────────────

const COLOR = {
  BRAND:        "89B4FA",  // PDF Coder Blau
  BRAND_DARK:   "1E1E2E",  // Hintergrund dunkel
  HEADER_TEXT:  "FFFFFF",  // Weiße Header-Schrift
  LABEL:        "45475A",  // Grau für Labels
  LABEL_TEXT:   "CDD6F4",  // Helles Grau für Text
  ROW_ALT:      "F5F5F8",  // Leicht getöntes Weiß für alternierende Zeilen
  BORDER:       "313244",  // Dunkler Rand
  WHITE:        "FFFFFF",
};

// ── Haupt-Export-Funktion ────────────────────────────────

// Dateinamen-sicherer Projekt-Name (max. 40 Zeichen)
function sanitizeFileName(name) {
  return name.replace(/[^\w\-äöüÄÖÜß ]/g, "_").slice(0, 40);
}

async function runExport() {
  const themes      = window.themesApi?.getThemes() ?? [];
  const codings     = window.codingApi?.getCodings() ?? [];
  const docName     = window.currentDocName || "Dokument";
  const projectName = window.activeProjectName || "Projekt";

  if (codings.length === 0) return;

  const XLSX  = window.XLSX;
  const wb    = XLSX.utils.book_new();
  const today = new Date();

  // ── 1. Zusammenfassungs-Sheet ─────────────────────────

  const wsSummary = buildSummarySheet(XLSX, themes, codings, docName, projectName, today);
  XLSX.utils.book_append_sheet(wb, wsSummary, "Zusammenfassung");

  // ── 2. Pro Thema ein Sheet ────────────────────────────

  for (const theme of themes) {
    // Neues Feld: theme_id (war: themeId)
    const themeCodings = codings.filter(c => c.theme_id === theme.id);
    if (themeCodings.length === 0) continue;

    const ws = buildThemeSheet(XLSX, theme, themeCodings, docName);
    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(theme.name));
  }

  // ── 3. Download ───────────────────────────────────────

  const dateStamp = formatDateStamp(today);
  const baseName  = docName.replace(/\.pdf$/i, "").replace(/[^\w\-äöüÄÖÜß ]/g, "_");
  // Dateiname enthält jetzt auch den Projektnamen
  const fileName  = `${sanitizeFileName(projectName)}_${baseName}_Codierung_${dateStamp}.xlsx`;

  const wbOut = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob  = new Blob([wbOut], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href    = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ── Zusammenfassungs-Sheet aufbauen ──────────────────────

function buildSummarySheet(XLSX, themes, codings, docName, projectName, today) {
  // Zeilen: Titel-Block + Leerzeile + Statistik-Tabelle
  const statsRows = themes
    .map(t => {
      // Neues Feld: theme_id (war: themeId)
      const count = codings.filter(c => c.theme_id === t.id).length;
      return count > 0 ? [t.name, count] : null;
    })
    .filter(Boolean);

  // Neues Feld: theme_id (war: themeId)
  const orphaned = codings.filter(c => !themes.find(t => t.id === c.theme_id)).length;
  if (orphaned > 0) statsRows.push(["(Thema gelöscht)", orphaned]);

  const data = [
    ["PDF Coder",    "Codierungs-Export"],
    [],
    ["Projekt",      projectName],
    ["Dokument",     docName],
    ["Export-Datum", formatDateTime(today)],
    ["Codierungen",  codings.length],
    [],
    ["Thema",        "Anzahl"],  // Tabellen-Header
    ...statsRows,
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);

  // ── Zellen stylen ──

  // Titelzeile: großes Branding
  setCell(ws, "A1", "PDF Coder", "s", {
    font:      { bold: true, sz: 16, color: { rgb: COLOR.BRAND } },
    fill:      { fgColor: { rgb: COLOR.BRAND_DARK } },
    alignment: { vertical: "center" },
  });
  setCell(ws, "B1", "Codierungs-Export", "s", {
    font:      { sz: 13, color: { rgb: COLOR.LABEL_TEXT } },
    fill:      { fgColor: { rgb: COLOR.BRAND_DARK } },
    alignment: { vertical: "center" },
  });

  // Zeile 1 höher machen
  ws["!rows"] = [{ hpt: 28 }];

  // Info-Labels (A3:A6) fett (Projekt, Dokument, Export-Datum, Codierungen)
  ["A3", "A4", "A5", "A6"].forEach(ref => {
    if (ws[ref]) ws[ref].s = { font: { bold: true, color: { rgb: "585B70" } } };
  });

  // Tabellen-Header (A8:B8) – eine Zeile nach unten verschoben durch Projekt-Zeile
  const headerRow = 8;
  ["A", "B"].forEach(col => {
    const ref = `${col}${headerRow}`;
    setCell(ws, ref, ws[ref]?.v ?? "", "s", {
      font:      { bold: true, sz: 11, color: { rgb: COLOR.HEADER_TEXT } },
      fill:      { fgColor: { rgb: COLOR.BRAND } },
      alignment: { horizontal: "left", vertical: "center" },
      border:    thinBorder(COLOR.BRAND),
    });
  });

  // Statistik-Zeilen abwechselnd einfärben
  statsRows.forEach((_, i) => {
    const rowIdx = headerRow + 1 + i;
    const fill   = i % 2 === 0
      ? { fgColor: { rgb: COLOR.WHITE } }
      : { fgColor: { rgb: COLOR.ROW_ALT } };
    ["A", "B"].forEach(col => {
      const ref = `${col}${rowIdx}`;
      if (ws[ref]) {
        ws[ref].s = {
          fill,
          border: thinBorder("DDDDDD"),
          alignment: { vertical: "center" },
        };
      }
    });
  });

  // Excel-Tabelle (ListObject) für die Statistik
  if (statsRows.length > 0) {
    ws["!tables"] = [{
      ref:            `A${headerRow}:B${headerRow + statsRows.length}`,
      name:           "Statistik",
      tableStyleInfo: {
        name:            "TableStyleMedium2",
        showRowStripes:  true,
        showFirstColumn: false,
        showLastColumn:  false,
      },
    }];
  }

  ws["!cols"] = [{ wch: 26 }, { wch: 20 }];

  return ws;
}

// ── Theme-Sheet aufbauen ─────────────────────────────────

function buildThemeSheet(XLSX, theme, themeCodings, docName) {
  const headerColor = hexToRgb(theme.color); // Themen-Farbe als Header
  const textColor   = contrastColor(theme.color); // Weiß oder Schwarz je nach Kontrast

  const rows = [
    ["Textstelle", "Seite", "Dokument", "Codiert am"],
    ...themeCodings.map(c => [
      c.text,
      c.page,           // als Zahl, damit Excel sortieren kann
      docName,
      formatDateTime(c.created_at),  // neues Feld (war: createdAt)
    ]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Seite-Spalte als Zahl kennzeichnen (nicht als String)
  themeCodings.forEach((c, i) => {
    const ref = `B${i + 2}`;
    if (ws[ref]) { ws[ref].t = "n"; ws[ref].v = c.page; }
  });

  // ── Header-Zeile stylen ──
  ["A1", "B1", "C1", "D1"].forEach(ref => {
    setCell(ws, ref, ws[ref]?.v ?? "", "s", {
      font:      { bold: true, sz: 11, color: { rgb: textColor } },
      fill:      { fgColor: { rgb: headerColor } },
      alignment: { horizontal: "left", vertical: "center", wrapText: false },
      border:    thinBorder(darken(headerColor)),
    });
  });

  // ── Daten-Zeilen: Textstelle umbruchfähig, abwechselnd eingefärbt ──
  themeCodings.forEach((_, i) => {
    const rowIdx = i + 2;
    const fill   = i % 2 === 0
      ? { fgColor: { rgb: COLOR.WHITE } }
      : { fgColor: { rgb: COLOR.ROW_ALT } };
    ["A", "B", "C", "D"].forEach(col => {
      const ref = `${col}${rowIdx}`;
      if (!ws[ref]) return;
      ws[ref].s = {
        fill,
        border:    thinBorder("DDDDDD"),
        alignment: {
          vertical:  "top",
          wrapText:  col === "A",  // Textstelle umbrechen
          horizontal: col === "B" ? "center" : "left",
        },
      };
    });
  });

  // ── Excel-Tabelle (ListObject) ──
  const lastRow = themeCodings.length + 1;
  ws["!tables"] = [{
    ref:            `A1:D${lastRow}`,
    name:           sanitizeSheetName(theme.name).replace(/\s/g, "_"),
    tableStyleInfo: {
      name:            "TableStyleMedium2",
      showRowStripes:  true,
      showFirstColumn: false,
      showLastColumn:  false,
    },
  }];

  // ── AutoFilter + Fixierte Kopfzeile ──
  ws["!autofilter"] = { ref: `A1:D1` };
  ws["!freeze"]     = { xSplit: 0, ySplit: 1 };  // Erste Zeile eingefroren

  // ── Zeilenhöhe: Datenzeilen etwas höher für Lesbarkeit ──
  const rowHeights = [{ hpt: 22 }]; // Header
  themeCodings.forEach(() => rowHeights.push({ hpt: 40 })); // Datenzeilen
  ws["!rows"] = rowHeights;

  // ── Spaltenbreiten ──
  ws["!cols"] = [
    { wch: 65 },  // Textstelle
    { wch: 7  },  // Seite
    { wch: 32 },  // Dokument
    { wch: 18 },  // Datum
  ];

  return ws;
}

// ── Hilfsfunktionen ──────────────────────────────────────

// Zelle mit Wert und Style setzen (überschreibt vorhandene Zelle)
function setCell(ws, ref, value, type, style) {
  ws[ref] = { t: type, v: value, s: style };
}

// Dünnen Rahmen in einer Farbe erzeugen
function thinBorder(rgb) {
  const side = { style: "thin", color: { rgb } };
  return { top: side, bottom: side, left: side, right: side };
}

// Hex-Farbe #RRGGBB → "RRGGBB" (ohne #)
function hexToRgb(hex) {
  return hex.replace("#", "").toUpperCase();
}

// Farbe um ~20 % abdunkeln (für Rahmen um Header)
function darken(rgb) {
  const r = Math.max(0, parseInt(rgb.slice(0, 2), 16) - 40);
  const g = Math.max(0, parseInt(rgb.slice(2, 4), 16) - 40);
  const b = Math.max(0, parseInt(rgb.slice(4, 6), 16) - 40);
  return [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}

// Kontrastfarbe (Weiß oder Schwarz) basierend auf Helligkeit des Hintergrunds
function contrastColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Relative Leuchtdichte (WCAG-Formel)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? "1E1E2E" : "FFFFFF";
}

// Datum als "TT.MM.JJJJ HH:MM"
function formatDateTime(value) {
  try {
    const d = new Date(value);
    const p = n => String(n).padStart(2, "0");
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch { return String(value ?? ""); }
}

// Datum als "JJJJMMTT" für den Dateinamen
function formatDateStamp(date) {
  const p = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`;
}

// Ungültige Excel-Sheet-Namen bereinigen (max. 31 Zeichen)
function sanitizeSheetName(name) {
  return name.replace(/[:\\\/\?\*\[\]]/g, "_").slice(0, 31) || "Thema";
}

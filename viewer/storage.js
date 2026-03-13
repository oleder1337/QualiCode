// storage.js – IndexedDB-Abstraktion für den PDF Coder
// Alle Datenzugriffe der Extension laufen ausschließlich über dieses Modul.

export const DEFAULT_PROJECT_ID = "project-standard";

// ── Hilfsfunktion: IDBRequest in Promise umwandeln ─────────────────────────

function req(request) {
  return new Promise((res, rej) => {
    request.onsuccess = () => res(request.result);
    request.onerror  = () => rej(request.error);
  });
}

// ── Haupt-Klasse ───────────────────────────────────────────────────────────

class StorageManager {
  constructor() {
    // Bereitschafts-Promise: wird von allen Aufrufen abgewartet
    this.ready           = this._init();
    this.migrationResult = null;
  }

  // ── Datenbank initialisieren ─────────────────────────────────────────────

  async _init() {
    this._db = await this._openDB();
    await this._ensureDefaultProject();
    await this._migrate();
  }

  // IndexedDB öffnen und Schema anlegen
  _openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("PDFCoderDB", 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;

        // Projekte-Store
        if (!db.objectStoreNames.contains("projects")) {
          db.createObjectStore("projects", { keyPath: "id" });
        }

        // Themen-Store mit Index nach Projekt
        if (!db.objectStoreNames.contains("themes")) {
          const themesStore = db.createObjectStore("themes", { keyPath: "id" });
          themesStore.createIndex("by_project", "project_id", { unique: false });
        }

        // Dokumente-Store mit Index nach Hash und URL
        if (!db.objectStoreNames.contains("documents")) {
          const docsStore = db.createObjectStore("documents", { keyPath: "id" });
          docsStore.createIndex("by_hash", "url_hash", { unique: false });
          docsStore.createIndex("by_url",  "url",      { unique: false });
        }

        // Projekt-Dokument-Verknüpfungen
        if (!db.objectStoreNames.contains("project_documents")) {
          const pdStore = db.createObjectStore("project_documents", { keyPath: "id" });
          pdStore.createIndex("by_project", "project_id", { unique: false });
        }

        // Codierungen-Store mit mehreren Indizes
        if (!db.objectStoreNames.contains("codings")) {
          const codingsStore = db.createObjectStore("codings", { keyPath: "id" });
          codingsStore.createIndex("by_project",  "project_id",  { unique: false });
          codingsStore.createIndex("by_document", "document_id", { unique: false });
          codingsStore.createIndex("by_theme",    "theme_id",    { unique: false });
          // Zusammengesetzter Index für schnelles Laden pro Projekt+Dokument
          codingsStore.createIndex("by_proj_doc", ["project_id", "document_id"], { unique: false });
        }
      };
    });
  }

  // Standard-Projekt sicherstellen (kann nicht gelöscht werden)
  async _ensureDefaultProject() {
    const existing = await req(
      this._db.transaction("projects", "readonly")
        .objectStore("projects")
        .get(DEFAULT_PROJECT_ID)
    );
    if (!existing) {
      await req(
        this._db.transaction("projects", "readwrite")
          .objectStore("projects")
          .put({
            id:          DEFAULT_PROJECT_ID,
            name:        "Standard",
            description: "",
            color:       "#89b4fa",
            created_at:  new Date().toISOString(),
            last_opened: new Date().toISOString(),
          })
      );
    }
  }

  // ── Migration von chrome.storage.local → IndexedDB ──────────────────────

  async _migrate() {
    // Prüfen ob Migration bereits durchgeführt wurde
    const flags = await chrome.storage.local.get("migrated_v2");
    if (flags.migrated_v2) return;

    let themeCount    = 0;
    let documentCount = 0;

    // Alle Daten aus dem alten Storage laden
    const all = await chrome.storage.local.get(null);

    // Themen migrieren
    const oldThemes = all["themes"] ?? [];
    for (let i = 0; i < oldThemes.length; i++) {
      const t = oldThemes[i];
      await this.saveTheme({
        id:         t.id,
        project_id: DEFAULT_PROJECT_ID,
        name:       t.name,
        color:      t.color,
        sort_order: i,
        created_at: t.created ?? new Date().toISOString(),
      });
      themeCount++;
    }

    // Codierungen migrieren: alle "codings_*"-Einträge
    const codingKeys = Object.keys(all).filter(k => k.startsWith("codings_"));

    for (const key of codingKeys) {
      const entry = all[key];
      if (!entry) continue;

      const url      = entry.document_id   ?? key.replace(/^codings_/, "");
      const name     = entry.document_name ?? url.split("/").pop() ?? "Dokument";
      const urlHash  = entry.document_hash ?? url;

      // Dokument-Eintrag anlegen
      const doc = await this.ensureDocument(url, urlHash, name);
      documentCount++;

      // Projekt-Dokument-Verknüpfung anlegen
      await this.ensureProjectDocument(DEFAULT_PROJECT_ID, doc.id);

      // Einzelne Codierungen einfügen
      const codings = entry.codings ?? [];
      for (const c of codings) {
        await this.addCoding({
          id:             c.id,
          project_id:     DEFAULT_PROJECT_ID,
          document_id:    doc.id,
          theme_id:       c.themeId,   // alter Feldname
          text:           c.text,
          page:           c.page,
          startSpanIndex: c.startSpanIndex,
          startOffset:    c.startOffset,
          endSpanIndex:   c.endSpanIndex,
          endOffset:      c.endOffset,
          created_at:     c.createdAt ?? new Date().toISOString(),
        });
      }
    }

    // Migrations-Flag setzen
    await chrome.storage.local.set({ migrated_v2: true });

    // Ergebnis für Toast-Anzeige speichern
    this.migrationResult = {
      themes:    themeCount,
      documents: documentCount,
    };
  }

  // ── Projekt-Methoden ─────────────────────────────────────────────────────

  // Alle Projekte zurückgeben
  async getProjects() {
    return req(
      this._db.transaction("projects", "readonly")
        .objectStore("projects")
        .getAll()
    );
  }

  // Ein Projekt anhand der ID laden
  async getProject(id) {
    return req(
      this._db.transaction("projects", "readonly")
        .objectStore("projects")
        .get(id)
    );
  }

  // Neues Projekt erstellen
  async createProject({ name, description = "", color = "#89b4fa" }) {
    const project = {
      id:          "project-" + crypto.randomUUID(),
      name,
      description,
      color,
      created_at:  new Date().toISOString(),
      last_opened: new Date().toISOString(),
    };
    await req(
      this._db.transaction("projects", "readwrite")
        .objectStore("projects")
        .put(project)
    );
    return project;
  }

  // Projekt-Daten aktualisieren
  async updateProject(id, data) {
    const existing = await this.getProject(id);
    if (!existing) throw new Error(`Projekt ${id} nicht gefunden`);
    const updated = { ...existing, ...data };
    await req(
      this._db.transaction("projects", "readwrite")
        .objectStore("projects")
        .put(updated)
    );
    return updated;
  }

  // Projekt löschen (Standard-Projekt ist geschützt)
  async deleteProject(id) {
    if (id === DEFAULT_PROJECT_ID) {
      throw new Error("Das Standard-Projekt kann nicht gelöscht werden.");
    }
    const tx = this._db.transaction(
      ["projects", "themes", "codings", "project_documents"],
      "readwrite"
    );

    // Zugehörige Themen löschen
    const themesStore = tx.objectStore("themes");
    const themes = await req(themesStore.index("by_project").getAll(id));
    for (const t of themes) {
      await req(themesStore.delete(t.id));
    }

    // Zugehörige Codierungen löschen
    const codingsStore = tx.objectStore("codings");
    const codings = await req(codingsStore.index("by_project").getAll(id));
    for (const c of codings) {
      await req(codingsStore.delete(c.id));
    }

    // Zugehörige Projekt-Dokument-Verknüpfungen löschen
    const pdStore = tx.objectStore("project_documents");
    const pds = await req(pdStore.index("by_project").getAll(id));
    for (const pd of pds) {
      await req(pdStore.delete(pd.id));
    }

    // Projekt selbst löschen
    await req(tx.objectStore("projects").delete(id));
  }

  // Projekt duplizieren (Themen werden kopiert, Codierungen nicht)
  async duplicateProject(id) {
    const source = await this.getProject(id);
    if (!source) throw new Error(`Projekt ${id} nicht gefunden`);

    const newProject = await this.createProject({
      name:        source.name + " (Kopie)",
      description: source.description,
      color:       source.color,
    });

    // Themen kopieren
    const themes = await this.getThemes(id);
    for (const t of themes) {
      await this.saveTheme({
        id:         "theme-" + crypto.randomUUID(),
        project_id: newProject.id,
        name:       t.name,
        color:      t.color,
        sort_order: t.sort_order,
        created_at: new Date().toISOString(),
      });
    }

    return newProject;
  }

  // Letzten Öffnungszeitpunkt aktualisieren
  async touchProject(id) {
    await this.updateProject(id, { last_opened: new Date().toISOString() });
  }

  // ── Themen-Methoden ──────────────────────────────────────────────────────

  // Alle Themen eines Projekts, sortiert nach sort_order
  async getThemes(projectId) {
    const all = await req(
      this._db.transaction("themes", "readonly")
        .objectStore("themes")
        .index("by_project")
        .getAll(projectId)
    );
    return all.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }

  // Thema speichern (erstellen oder aktualisieren)
  async saveTheme(theme) {
    await req(
      this._db.transaction("themes", "readwrite")
        .objectStore("themes")
        .put(theme)
    );
    return theme;
  }

  // Thema löschen
  async deleteTheme(id) {
    await req(
      this._db.transaction("themes", "readwrite")
        .objectStore("themes")
        .delete(id)
    );
  }

  // ── Dokument-Methoden ────────────────────────────────────────────────────

  // Dokument anhand von Hash suchen oder neu anlegen
  async ensureDocument(url, urlHash, name) {
    // Zuerst nach Hash suchen (robusteste Identifikation)
    const byHash = await req(
      this._db.transaction("documents", "readonly")
        .objectStore("documents")
        .index("by_hash")
        .getAll(urlHash)
    );
    if (byHash.length > 0) {
      // Letzten Bearbeitungszeitpunkt aktualisieren
      const doc = { ...byHash[0], last_edited: new Date().toISOString() };
      await req(
        this._db.transaction("documents", "readwrite")
          .objectStore("documents")
          .put(doc)
      );
      return doc;
    }

    // Neues Dokument anlegen
    const doc = {
      id:           "doc-" + crypto.randomUUID(),
      url,
      url_hash:     urlHash,
      name,
      first_opened: new Date().toISOString(),
      last_edited:  new Date().toISOString(),
    };
    await req(
      this._db.transaction("documents", "readwrite")
        .objectStore("documents")
        .put(doc)
    );
    return doc;
  }

  // Alle Dokumente zurückgeben
  async getDocuments() {
    return req(
      this._db.transaction("documents", "readonly")
        .objectStore("documents")
        .getAll()
    );
  }

  // ── Projekt-Dokument-Methoden ────────────────────────────────────────────

  // Verknüpfung zwischen Projekt und Dokument sicherstellen
  async ensureProjectDocument(projectId, documentId) {
    const existing = await req(
      this._db.transaction("project_documents", "readonly")
        .objectStore("project_documents")
        .index("by_project")
        .getAll(projectId)
    );

    const found = existing.find(pd => pd.document_id === documentId);
    if (found) return found;

    const pd = {
      id:          "pd-" + crypto.randomUUID(),
      project_id:  projectId,
      document_id: documentId,
      added_at:    new Date().toISOString(),
    };
    await req(
      this._db.transaction("project_documents", "readwrite")
        .objectStore("project_documents")
        .put(pd)
    );
    return pd;
  }

  // ── Codierungs-Methoden ──────────────────────────────────────────────────

  // Alle Codierungen für Projekt + Dokument laden
  async getCodings(projectId, documentId) {
    return req(
      this._db.transaction("codings", "readonly")
        .objectStore("codings")
        .index("by_proj_doc")
        .getAll(IDBKeyRange.only([projectId, documentId]))
    );
  }

  // Codierung hinzufügen
  async addCoding(coding) {
    await req(
      this._db.transaction("codings", "readwrite")
        .objectStore("codings")
        .put(coding)
    );
    return coding;
  }

  // Codierung entfernen
  async removeCoding(id) {
    await req(
      this._db.transaction("codings", "readwrite")
        .objectStore("codings")
        .delete(id)
    );
  }

  // Alle Codierungen aus allen Projekten (für Popup-Übersicht)
  async getAllCodings() {
    return req(
      this._db.transaction("codings", "readonly")
        .objectStore("codings")
        .getAll()
    );
  }

  // Alle Codierungen eines Projekts laden
  async getCodingsByProject(projectId) {
    return req(
      this._db.transaction("codings", "readonly")
               .objectStore("codings")
               .index("by_project")
               .getAll(projectId)
    );
  }

  // Codierungen für bestimmte Themen in einem Projekt laden
  async getCodingsByThemes(projectId, themeIds) {
    const all = await this.getCodingsByProject(projectId);
    return all.filter(c => themeIds.includes(c.theme_id));
  }

  // Alle Codierungen eines Dokuments (über alle Projekte)
  async getCodingsByDocument(documentId) {
    return req(
      this._db.transaction("codings", "readonly")
               .objectStore("codings")
               .index("by_document")
               .getAll(documentId)
    );
  }

  // Codierungen eines Dokuments in einem Projekt löschen
  async deleteCodingsForDocument(projectId, documentId) {
    const codings = await this.getCodings(projectId, documentId);
    for (const c of codings) {
      await req(this._db.transaction("codings", "readwrite").objectStore("codings").delete(c.id));
    }
  }

  // Dokument aus einem Projekt entfernen (project_document + Codierungen löschen)
  async removeDocumentFromProject(projectId, documentId) {
    await this.deleteCodingsForDocument(projectId, documentId);
    const pds = await req(
      this._db.transaction("project_documents", "readonly")
               .objectStore("project_documents")
               .index("by_project")
               .getAll(projectId)
    );
    const toDelete = pds.filter(pd => pd.document_id === documentId);
    for (const pd of toDelete) {
      await req(this._db.transaction("project_documents", "readwrite").objectStore("project_documents").delete(pd.id));
    }
  }

  // Thema in anderes Projekt verschieben (theme.project_id + codings.project_id aktualisieren)
  async moveTheme(themeId, fromProjectId, toProjectId) {
    const theme = await req(this._db.transaction("themes", "readonly").objectStore("themes").get(themeId));
    if (!theme) return;
    await this.saveTheme({ ...theme, project_id: toProjectId });
    // Alle Codierungen dieses Themas im Quell-Projekt ins Ziel-Projekt verschieben
    const all = await this.getCodingsByProject(fromProjectId);
    const toMove = all.filter(c => c.theme_id === themeId);
    for (const c of toMove) {
      // Dokument-Verknüpfung im Ziel-Projekt sicherstellen
      await this.ensureProjectDocument(toProjectId, c.document_id);
      // Codierung aktualisieren
      await req(this._db.transaction("codings", "readwrite").objectStore("codings").put({ ...c, project_id: toProjectId }));
    }
  }

  // Thema in anderes Projekt kopieren (nur Thema, keine Codierungen)
  async copyTheme(themeId, toProjectId) {
    const theme = await req(this._db.transaction("themes", "readonly").objectStore("themes").get(themeId));
    if (!theme) return;
    const existingThemes = await this.getThemes(toProjectId);
    const newTheme = {
      ...theme,
      id:         "theme-" + crypto.randomUUID(),
      project_id: toProjectId,
      sort_order: existingThemes.length,
      created_at: new Date().toISOString(),
    };
    await this.saveTheme(newTheme);
    return newTheme;
  }

  // Alle Daten löschen und Standard-Projekt neu anlegen
  async clearAllData() {
    for (const s of ["projects", "themes", "documents", "project_documents", "codings"]) {
      await req(this._db.transaction(s, "readwrite").objectStore(s).clear());
    }
    await this._ensureDefaultProject();
  }

  // Einzelnes Projekt als JSON exportieren
  async exportProject(projectId) {
    const project  = await this.getProject(projectId);
    if (!project) throw new Error("Projekt nicht gefunden");
    const themes   = await this.getThemes(projectId);
    const codings  = await this.getCodingsByProject(projectId);
    // Dokument-IDs sammeln
    const docIds   = [...new Set(codings.map(c => c.document_id))];
    const allDocs  = await this.getDocuments();
    const documents = allDocs.filter(d => docIds.includes(d.id));
    const allPDs   = await req(
      this._db.transaction("project_documents", "readonly")
               .objectStore("project_documents")
               .index("by_project")
               .getAll(projectId)
    );
    return JSON.stringify({
      version: 2,
      type:    "project",
      exported: new Date().toISOString(),
      project, themes, documents,
      project_documents: allPDs, codings,
    }, null, 2);
  }

  // Einzelnes Projekt aus JSON importieren (neue IDs, kein Überschreiben)
  async importProject(jsonString) {
    const data = JSON.parse(jsonString);
    if (data.type !== "project") throw new Error("Keine Projekt-Export-Datei");

    // ID-Mapping für kollisionsfreien Import
    const projectId = "project-" + crypto.randomUUID();
    const themeMap  = new Map(); // alte ID → neue ID
    const docMap    = new Map(); // alte ID → DB-ID

    // Projekt anlegen
    await req(this._db.transaction("projects", "readwrite").objectStore("projects").put({
      ...data.project,
      id:   projectId,
      name: data.project.name + " (Import)",
    }));

    // Themen anlegen
    for (const t of data.themes ?? []) {
      const newId = "theme-" + crypto.randomUUID();
      themeMap.set(t.id, newId);
      await this.saveTheme({ ...t, id: newId, project_id: projectId });
    }

    // Dokumente sicherstellen (können bereits existieren)
    for (const d of data.documents ?? []) {
      const existing = await this.ensureDocument(d.url, d.url_hash, d.name);
      docMap.set(d.id, existing.id);
    }

    // Projekt-Dokument-Verknüpfungen
    for (const pd of data.project_documents ?? []) {
      const docId = docMap.get(pd.document_id) ?? pd.document_id;
      await this.ensureProjectDocument(projectId, docId);
    }

    // Codierungen mit neuen IDs anlegen
    for (const c of data.codings ?? []) {
      await this.addCoding({
        ...c,
        id:          "coding-" + crypto.randomUUID(),
        project_id:  projectId,
        document_id: docMap.get(c.document_id)  ?? c.document_id,
        theme_id:    themeMap.get(c.theme_id)   ?? c.theme_id,
      });
    }

    return projectId;
  }

  // ── Backup-Methoden ──────────────────────────────────────────────────────

  // Vollständiges Backup aller Daten als JSON-String exportieren
  async exportBackup() {
    const [projects, themes, documents, project_documents, codings] = await Promise.all([
      this.getProjects(),
      req(this._db.transaction("themes", "readonly").objectStore("themes").getAll()),
      this.getDocuments(),
      req(this._db.transaction("project_documents", "readonly").objectStore("project_documents").getAll()),
      this.getAllCodings(),
    ]);

    return JSON.stringify({
      version:           2,
      exported_at:       new Date().toISOString(),
      projects,
      themes,
      documents,
      project_documents,
      codings,
    }, null, 2);
  }

  // Backup einspielen: alle Stores leeren und Daten wiederherstellen
  async importBackup(jsonString) {
    const data = JSON.parse(jsonString);

    if (data.version !== 2) {
      throw new Error(`Unbekannte Backup-Version: ${data.version}`);
    }

    // Alle Stores in einer Transaktion leeren
    const storeNames = ["projects", "themes", "documents", "project_documents", "codings"];
    const clearTx    = this._db.transaction(storeNames, "readwrite");

    for (const name of storeNames) {
      await req(clearTx.objectStore(name).clear());
    }

    // Daten wiederherstellen
    const writeTx = this._db.transaction(storeNames, "readwrite");

    for (const p  of (data.projects          ?? [])) await req(writeTx.objectStore("projects").put(p));
    for (const t  of (data.themes            ?? [])) await req(writeTx.objectStore("themes").put(t));
    for (const d  of (data.documents         ?? [])) await req(writeTx.objectStore("documents").put(d));
    for (const pd of (data.project_documents ?? [])) await req(writeTx.objectStore("project_documents").put(pd));
    for (const c  of (data.codings           ?? [])) await req(writeTx.objectStore("codings").put(c));

    // Standard-Projekt sicherstellen falls im Backup nicht vorhanden
    await this._ensureDefaultProject();
  }
}

// ── Singleton-Instanz ──────────────────────────────────────────────────────

export const storageManager = new StorageManager();

// Globaler Zugriff für Nicht-Modul-Kontexte
window.storageManager = storageManager;

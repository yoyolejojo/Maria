-- Schéma initial de maria-db
-- created_at au format ISO 8601 UTC (ex. 2026-10-27T12:00:00.000Z), lisible par new Date()

CREATE TABLE commentaires (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT NOT NULL,
  auteur TEXT NOT NULL,
  commentaire TEXT NOT NULL,
  note INTEGER NOT NULL CHECK (note BETWEEN 1 AND 5),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_commentaires_post_id ON commentaires (post_id);

CREATE TABLE sorties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titre TEXT NOT NULL,
  categorie TEXT NOT NULL,
  fait INTEGER NOT NULL DEFAULT 0 CHECK (fait IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE boissons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  categorie TEXT NOT NULL CHECK (categorie IN ('biere', 'vin', 'autre')),
  volume_cl REAL NOT NULL CHECK (volume_cl > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

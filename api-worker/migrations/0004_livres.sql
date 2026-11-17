-- Livres lus ensemble. Les reviews (note + commentaire) sont dans la table commentaires,
-- avec post_id = '/livres/lire/?id=<id du livre>'
CREATE TABLE livres (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titre TEXT NOT NULL,
  auteur TEXT NOT NULL DEFAULT '',
  couverture_photo_id INTEGER,
  date_fin TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT
);

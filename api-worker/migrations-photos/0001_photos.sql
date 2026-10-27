-- Photos des articles, compressées côté navigateur avant l'envoi (WebP ou JPEG)
CREATE TABLE photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mime TEXT NOT NULL CHECK (mime IN ('image/webp', 'image/jpeg')),
  data BLOB NOT NULL,
  taille INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Articles écrits depuis le site
-- contenu : texte brut, un paragraphe par ligne ; une ligne "[photo:12]" insère la photo 12 (base maria-photos)
CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titre TEXT NOT NULL,
  pub_date TEXT NOT NULL,
  hero_photo_id INTEGER,
  contenu TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT
);

CREATE INDEX idx_posts_pub_date ON posts (pub_date);

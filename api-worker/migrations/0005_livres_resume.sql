-- Petit résumé du livre (texte brut, un paragraphe par ligne)
ALTER TABLE livres ADD COLUMN resume TEXT NOT NULL DEFAULT '';

// Outils partagés par les pages Livres (liste, fiche, ajout / modification).

import { parseDay } from './posts';

export type Livre = {
	id: number;
	titre: string;
	auteur: string;
	resume: string;
	couverture_photo_id: number | null;
	date_fin: string | null; // AAAA-MM-JJ
	created_at: string;
	updated_at?: string | null;
	// Seulement dans la liste : moyenne des reviews
	note_moyenne?: number | null;
	nb_avis?: number;
};

export function livreUrl(id: number) {
	return `/livres/lire/?id=${id}`;
}

// 4.5 -> "★★★★☆" (arrondi inférieur, comme la note moyenne des articles)
export function stars(note: number) {
	const full = Math.floor(note);
	return '★'.repeat(full) + '☆'.repeat(5 - full);
}

// "2026-11-14" -> "14 novembre 2026"
export function formatDateFr(day: string) {
	return parseDay(day).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

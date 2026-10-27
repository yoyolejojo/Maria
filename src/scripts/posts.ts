// Outils partagés par les pages d'articles écrits depuis le site (liste, lecture, écriture).

import { API_URL } from './api-url';

export { API_URL };

export type Post = {
	id: number;
	titre: string;
	pub_date: string; // AAAA-MM-JJ
	hero_photo_id: number | null;
	contenu: string;
	created_at: string;
	updated_at: string | null;
};

const PHOTO_LINE = /^\[photo:(\d+)\]$/;

// Taille max des photos envoyées : plus grand côté en pixels, poids visé
const PHOTO_MAX_SIDE = 1600;
const PHOTO_MAX_BYTES = 1400 * 1024;

export function photoUrl(id: number) {
	return `${API_URL}/photos/${id}`;
}

export function postUrl(id: number) {
	return `/blog/lire/?id=${id}`;
}

export function photoLine(id: number) {
	return `[photo:${id}]`;
}

// "2026-10-27" -> Date locale (sans décalage de fuseau)
export function parseDay(day: string) {
	const [y, m, d] = day.split('-').map(Number);
	return new Date(y, m - 1, d);
}

// Même format que le composant FormattedDate des anciens articles
export function formatDate(day: string) {
	return parseDay(day).toLocaleDateString('en-us', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function today() {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Affiche le texte d'un article : une ligne = un paragraphe, "[photo:N]" seul sur sa ligne = une photo.
// Construit le DOM sans innerHTML : le texte n'est jamais interprété comme du HTML.
export function renderContenu(contenu: string, container: HTMLElement) {
	container.replaceChildren();
	for (const raw of contenu.split('\n')) {
		const line = raw.trim();
		if (!line) continue;
		const match = line.match(PHOTO_LINE);
		if (match) {
			const img = document.createElement('img');
			img.src = photoUrl(Number(match[1]));
			img.alt = '';
			img.loading = 'lazy';
			img.className = 'post-photo';
			container.append(img);
		} else {
			const p = document.createElement('p');
			p.textContent = line;
			container.append(p);
		}
	}
}

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
	const res = await fetch(`${API_URL}${path}`, options);
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data.error || 'Erreur réseau');
	return data;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
	return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

// Encode un canvas en WebP si le navigateur sait le faire (pas Safari), sinon en JPEG,
// en baissant la qualité jusqu'à passer sous la taille maximale.
export async function encodeCanvas(canvas: HTMLCanvasElement): Promise<Blob> {
	for (const quality of [0.82, 0.7, 0.55, 0.4]) {
		let blob = await canvasToBlob(canvas, 'image/webp', quality);
		if (!blob || blob.type !== 'image/webp') blob = await canvasToBlob(canvas, 'image/jpeg', quality);
		if (blob && blob.size <= PHOTO_MAX_BYTES) return blob;
	}
	throw new Error('Photo trop lourde, même compressée');
}

// Redimensionne et compresse une photo dans le navigateur avant l'envoi.
export async function compressImage(file: File): Promise<Blob> {
	const bitmap = await createImageBitmap(file);
	const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
	const canvas = document.createElement('canvas');
	canvas.width = Math.round(bitmap.width * scale);
	canvas.height = Math.round(bitmap.height * scale);
	canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	bitmap.close();
	return encodeCanvas(canvas);
}

export async function uploadBlob(blob: Blob): Promise<number> {
	const data = await api<{ id: number }>('/photos', {
		method: 'POST',
		headers: { 'Content-Type': blob.type },
		body: blob,
	});
	return data.id;
}

export async function uploadPhoto(file: File): Promise<number> {
	return uploadBlob(await compressImage(file));
}

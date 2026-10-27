// API du site Maria : articles et photos, commentaires, sorties, compteur de boissons, notifications Telegram.
// Toutes les requêtes SQL passent par prepare().bind().

const SORTIE_CATEGORIES = ['Restaurant', 'Balade', 'Culture', 'Sport', 'Cinéma', 'Voyage', 'Autre'];
const BOISSON_CATEGORIES = ['biere', 'vin', 'autre'];
const MAX_BODY_BYTES = 4096;
const MAX_POST_BODY_BYTES = 256 * 1024;
const MAX_CONTENU_CHARS = 50000;
const MAX_PHOTO_BYTES = 1500 * 1024;
const PHOTO_LINE = /^\[photo:(\d+)\]$/;

class HttpError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

// ---------- Utilitaires ----------

function allowedOrigins(env) {
	return (env.ALLOWED_ORIGINS || '')
		.split(',')
		.map((o) => o.trim().replace(/\/$/, ''))
		.filter(Boolean);
}

// Adresses du réseau local (localhost, 192.168.x.x, 10.x.x.x, 172.16-31.x.x), en http uniquement
const LAN_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

function isAllowedOrigin(origin, env) {
	if (allowedOrigins(env).includes(origin)) return true;
	// Uniquement en local (.dev.vars) : évite de changer la config quand l'IP du PC change
	return env.DEV_ALLOW_LAN === 'true' && LAN_ORIGIN.test(origin);
}

function corsHeaders(request, env) {
	const origin = request.headers.get('Origin');
	const headers = { Vary: 'Origin' };
	if (origin && isAllowedOrigin(origin, env)) {
		headers['Access-Control-Allow-Origin'] = origin;
		headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
		headers['Access-Control-Allow-Headers'] = 'Content-Type';
		headers['Access-Control-Max-Age'] = '86400';
	}
	return headers;
}

function json(data, status = 200) {
	return Response.json(data, { status });
}

async function readJson(request, maxBytes = MAX_BODY_BYTES) {
	const type = request.headers.get('Content-Type') || '';
	if (!type.includes('application/json')) throw new HttpError(415, 'Content-Type application/json attendu');

	const text = await request.text();
	if (new TextEncoder().encode(text).length > maxBytes) throw new HttpError(413, 'Requête trop volumineuse');

	try {
		const body = JSON.parse(text);
		if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error();
		return body;
	} catch {
		throw new HttpError(400, 'JSON invalide');
	}
}

function requireText(value, field, max) {
	if (typeof value !== 'string') throw new HttpError(400, `${field} doit être un texte`);
	const trimmed = value.trim();
	if (trimmed.length === 0) throw new HttpError(400, `${field} est obligatoire`);
	if (trimmed.length > max) throw new HttpError(400, `${field} : ${max} caractères maximum`);
	return trimmed;
}

function requireOneOf(value, field, allowed) {
	if (!allowed.includes(value)) throw new HttpError(400, `${field} invalide`);
	return value;
}

// Extrait l'id numérique de "/prefixe/12"
function parseId(path, prefix) {
	const id = Number(path.slice(prefix.length));
	if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(404, 'Route inconnue');
	return id;
}

// ---------- Telegram ----------

async function sendTelegram(env, text) {
	if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
		console.warn('Secrets Telegram manquants, notification ignorée');
		return false;
	}
	try {
		const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
		});
		const data = await res.json();
		if (!data.ok) console.error('Erreur Telegram :', data.description);
		return data.ok === true;
	} catch (err) {
		console.error('Erreur Telegram :', err);
		return false;
	}
}

function nowFr() {
	return new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
}

async function checkRateLimit(env, key) {
	if (!env.NOTIFY_LIMITER) return;
	const { success } = await env.NOTIFY_LIMITER.limit({ key });
	if (!success) throw new HttpError(429, 'Trop de demandes, réessaie dans une minute');
}

// ---------- Commentaires ----------

async function listCommentaires(env, url) {
	const postId = requireText(url.searchParams.get('post_id') ?? '', 'post_id', 200);
	const { results } = await env.DB.prepare(
		'SELECT id, post_id, auteur, commentaire, note, created_at, updated_at FROM commentaires WHERE post_id = ? ORDER BY created_at DESC, id DESC'
	)
		.bind(postId)
		.run();
	return json(results);
}

async function addCommentaire(request, env, ctx) {
	const body = await readJson(request);
	const postId = requireText(body.post_id, 'post_id', 200);
	const auteur = requireText(body.auteur, 'auteur', 50);
	const commentaire = requireText(body.commentaire, 'commentaire', 500);
	const note = body.note;
	if (!Number.isInteger(note) || note < 1 || note > 5) throw new HttpError(400, 'note doit être un entier de 1 à 5');

	const row = await env.DB.prepare(
		'INSERT INTO commentaires (post_id, auteur, commentaire, note) VALUES (?, ?, ?, ?) RETURNING id, post_id, auteur, commentaire, note, created_at, updated_at'
	)
		.bind(postId, auteur, commentaire, note)
		.first();

	ctx.waitUntil(
		sendTelegram(
			env,
			`📝 Nouveau commentaire sur le blog !\n\n` +
				`👤 Auteur : ${auteur}\n` +
				`⭐ Note : ${note}/5\n` +
				`📄 Post : ${postId}\n` +
				`💬 Commentaire : "${commentaire}"\n\n` +
				`🕐 ${nowFr()}`
		)
	);

	return json(row, 201);
}

async function updateCommentaire(request, env, id) {
	const body = await readJson(request);
	const auteur = body.auteur === undefined ? null : requireText(body.auteur, 'auteur', 50);
	const commentaire = body.commentaire === undefined ? null : requireText(body.commentaire, 'commentaire', 500);
	let note = null;
	if (body.note !== undefined) {
		if (!Number.isInteger(body.note) || body.note < 1 || body.note > 5) throw new HttpError(400, 'note doit être un entier de 1 à 5');
		note = body.note;
	}
	if (auteur === null && commentaire === null && note === null) throw new HttpError(400, 'Rien à modifier');

	const row = await env.DB.prepare(
		`UPDATE commentaires
		 SET auteur = COALESCE(?, auteur), commentaire = COALESCE(?, commentaire), note = COALESCE(?, note),
		     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
		 WHERE id = ?
		 RETURNING id, post_id, auteur, commentaire, note, created_at, updated_at`
	)
		.bind(auteur, commentaire, note, id)
		.first();
	if (!row) throw new HttpError(404, 'Commentaire introuvable');
	return json(row);
}

async function deleteCommentaire(env, id) {
	const row = await env.DB.prepare('DELETE FROM commentaires WHERE id = ? RETURNING id').bind(id).first();
	if (!row) throw new HttpError(404, 'Commentaire introuvable');
	return json({ ok: true });
}

// ---------- Articles ----------

// Identifiant utilisé par les commentaires d'un article écrit depuis le site
function postCommentId(id) {
	return `/blog/lire/?id=${id}`;
}

function validatePost(body) {
	const titre = requireText(body.titre, 'titre', 200);

	const pubDate = body.pub_date;
	if (typeof pubDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(pubDate) || Number.isNaN(Date.parse(pubDate))) {
		throw new HttpError(400, 'pub_date doit être une date AAAA-MM-JJ');
	}

	const heroPhotoId = body.hero_photo_id ?? null;
	if (heroPhotoId !== null && (!Number.isSafeInteger(heroPhotoId) || heroPhotoId <= 0)) {
		throw new HttpError(400, 'hero_photo_id invalide');
	}

	if (typeof body.contenu !== 'string') throw new HttpError(400, 'contenu doit être un texte');
	const contenu = body.contenu.replace(/\r\n?/g, '\n').trim();
	if (contenu.length === 0) throw new HttpError(400, 'contenu est obligatoire');
	if (contenu.length > MAX_CONTENU_CHARS) throw new HttpError(400, `contenu : ${MAX_CONTENU_CHARS} caractères maximum`);

	return { titre, pubDate, heroPhotoId, contenu };
}

// Toutes les photos utilisées par un article (couverture + lignes [photo:N])
function photoIds(post) {
	const ids = new Set();
	if (post.hero_photo_id) ids.add(post.hero_photo_id);
	for (const line of post.contenu.split('\n')) {
		const match = line.trim().match(PHOTO_LINE);
		if (match) ids.add(Number(match[1]));
	}
	return ids;
}

async function deletePhotos(env, ids) {
	const list = [...ids];
	// Par paquets de 50 pour rester sous la limite de paramètres liés
	for (let i = 0; i < list.length; i += 50) {
		const chunk = list.slice(i, i + 50);
		await env.PHOTOS.prepare(`DELETE FROM photos WHERE id IN (${chunk.map(() => '?').join(', ')})`)
			.bind(...chunk)
			.run();
	}
}

async function findPost(env, id) {
	const post = await env.DB.prepare(
		'SELECT id, titre, pub_date, hero_photo_id, contenu, created_at, updated_at FROM posts WHERE id = ?'
	)
		.bind(id)
		.first();
	if (!post) throw new HttpError(404, 'Article introuvable');
	return post;
}

async function listPosts(env) {
	const { results } = await env.DB.prepare(
		'SELECT id, titre, pub_date, hero_photo_id, created_at FROM posts ORDER BY pub_date DESC, id DESC'
	).run();
	return json(results);
}

async function addPost(request, env) {
	const { titre, pubDate, heroPhotoId, contenu } = validatePost(await readJson(request, MAX_POST_BODY_BYTES));
	const post = await env.DB.prepare(
		'INSERT INTO posts (titre, pub_date, hero_photo_id, contenu) VALUES (?, ?, ?, ?) RETURNING id, titre, pub_date, hero_photo_id, contenu, created_at, updated_at'
	)
		.bind(titre, pubDate, heroPhotoId, contenu)
		.first();
	return json(post, 201);
}

async function updatePost(request, env, id) {
	const { titre, pubDate, heroPhotoId, contenu } = validatePost(await readJson(request, MAX_POST_BODY_BYTES));
	const before = await findPost(env, id);

	const post = await env.DB.prepare(
		`UPDATE posts
		 SET titre = ?, pub_date = ?, hero_photo_id = ?, contenu = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
		 WHERE id = ?
		 RETURNING id, titre, pub_date, hero_photo_id, contenu, created_at, updated_at`
	)
		.bind(titre, pubDate, heroPhotoId, contenu, id)
		.first();

	// Supprime les photos retirées de l'article
	const kept = photoIds(post);
	await deletePhotos(env, [...photoIds(before)].filter((p) => !kept.has(p)));
	return json(post);
}

async function deletePost(env, id) {
	const post = await findPost(env, id);
	await env.DB.batch([
		env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(id),
		env.DB.prepare('DELETE FROM commentaires WHERE post_id = ?').bind(postCommentId(id)),
	]);
	await deletePhotos(env, photoIds(post));
	return json({ ok: true });
}

// ---------- Photos ----------

function detectImage(bytes) {
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
	const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
	if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
	return null;
}

async function addPhoto(request, env) {
	const length = Number(request.headers.get('Content-Length') || 0);
	if (length > MAX_PHOTO_BYTES) throw new HttpError(413, 'Photo trop lourde');

	const bytes = new Uint8Array(await request.arrayBuffer());
	if (bytes.length === 0) throw new HttpError(400, 'Photo vide');
	if (bytes.length > MAX_PHOTO_BYTES) throw new HttpError(413, 'Photo trop lourde');

	// Le type est déduit du contenu, pas de l'en-tête envoyé
	const mime = detectImage(bytes);
	if (!mime) throw new HttpError(415, 'Format accepté : WebP ou JPEG');

	const row = await env.PHOTOS.prepare('INSERT INTO photos (mime, data, taille) VALUES (?, ?, ?) RETURNING id')
		.bind(mime, bytes, bytes.length)
		.first();
	return json({ id: row.id }, 201);
}

async function getPhoto(env, id) {
	const row = await env.PHOTOS.prepare('SELECT mime, data FROM photos WHERE id = ?').bind(id).first();
	if (!row) throw new HttpError(404, 'Photo introuvable');
	return new Response(new Uint8Array(row.data), {
		headers: {
			'Content-Type': row.mime,
			// Une photo ne change jamais pour un id donné
			'Cache-Control': 'public, max-age=31536000, immutable',
			'X-Content-Type-Options': 'nosniff',
		},
	});
}

// ---------- Sorties ----------

async function listSorties(env) {
	const { results } = await env.DB.prepare(
		'SELECT id, titre, categorie, fait, created_at FROM sorties ORDER BY created_at DESC, id DESC'
	).run();
	return json(results);
}

async function addSortie(request, env) {
	const body = await readJson(request);
	const titre = requireText(body.titre, 'titre', 200);
	const categorie = requireOneOf(body.categorie, 'categorie', SORTIE_CATEGORIES);

	const row = await env.DB.prepare(
		'INSERT INTO sorties (titre, categorie) VALUES (?, ?) RETURNING id, titre, categorie, fait, created_at'
	)
		.bind(titre, categorie)
		.first();
	return json(row, 201);
}

async function updateSortie(request, env, id) {
	const body = await readJson(request);
	if (typeof body.fait !== 'boolean') throw new HttpError(400, 'fait doit être un booléen');

	const row = await env.DB.prepare(
		'UPDATE sorties SET fait = ? WHERE id = ? RETURNING id, titre, categorie, fait, created_at'
	)
		.bind(body.fait ? 1 : 0, id)
		.first();
	if (!row) throw new HttpError(404, 'Sortie introuvable');
	return json(row);
}

// ---------- Boissons ----------

async function boissonTotals(env) {
	const { results } = await env.DB.prepare(
		'SELECT categorie, SUM(volume_cl) AS total FROM boissons GROUP BY categorie'
	).run();
	const totals = { biere: 0, vin: 0, autre: 0 };
	for (const r of results) totals[r.categorie] = r.total;
	return totals;
}

async function addBoisson(request, env) {
	const body = await readJson(request);
	const categorie = requireOneOf(body.categorie, 'categorie', BOISSON_CATEGORIES);
	const volume = body.volume_cl;
	if (typeof volume !== 'number' || !Number.isFinite(volume) || volume <= 0 || volume > 200) {
		throw new HttpError(400, 'volume_cl doit être un nombre entre 0 et 200');
	}

	await env.DB.prepare('INSERT INTO boissons (categorie, volume_cl) VALUES (?, ?)').bind(categorie, volume).run();
	return json(await boissonTotals(env), 201);
}

async function undoBoisson(env, url) {
	const categorie = requireOneOf(url.searchParams.get('categorie'), 'categorie', BOISSON_CATEGORIES);
	const row = await env.DB.prepare(
		'DELETE FROM boissons WHERE id = (SELECT id FROM boissons WHERE categorie = ? ORDER BY id DESC LIMIT 1) RETURNING id'
	)
		.bind(categorie)
		.first();
	if (!row) throw new HttpError(404, 'Rien à annuler.');
	return json(await boissonTotals(env));
}

// ---------- Notifications ----------

async function notifyDodo(request, env) {
	const body = await readJson(request);
	const phrase = requireText(body.phrase, 'phrase', 500);
	await checkRateLimit(env, 'dodo');

	const ok = await sendTelegram(env, `🛏️ Maria te dis d'aller dormir là ! 💤\n\n"${phrase}"`);
	if (!ok) throw new HttpError(502, "Échec de l'envoi Telegram");
	return json({ ok: true });
}

async function notifyValentine(env, ctx) {
	await checkRateLimit(env, 'valentine');
	ctx.waitUntil(
		sendTelegram(
			env,
			`Elle a dit oui, mais prend pas la confiance\n\n` +
				`Maintenant faut organisé hein...\n\n` +
				`Heure : ${nowFr()}`
		)
	);
	return json({ ok: true });
}

// ---------- Routeur ----------

async function route(request, env, ctx) {
	const url = new URL(request.url);
	const path = url.pathname.replace(/\/+$/, '') || '/';
	const method = request.method;

	if (path === '/posts') {
		if (method === 'GET') return listPosts(env);
		if (method === 'POST') return addPost(request, env);
	} else if (path.startsWith('/posts/')) {
		const id = parseId(path, '/posts/');
		if (method === 'GET') return json(await findPost(env, id));
		if (method === 'PUT') return updatePost(request, env, id);
		if (method === 'DELETE') return deletePost(env, id);
	} else if (path === '/photos') {
		if (method === 'POST') return addPhoto(request, env);
	} else if (path.startsWith('/photos/')) {
		const id = parseId(path, '/photos/');
		if (method === 'GET') return getPhoto(env, id);
	} else if (path === '/commentaires') {
		if (method === 'GET') return listCommentaires(env, url);
		if (method === 'POST') return addCommentaire(request, env, ctx);
	} else if (path.startsWith('/commentaires/')) {
		const id = Number(path.slice('/commentaires/'.length));
		if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(404, 'Route inconnue');
		if (method === 'PATCH') return updateCommentaire(request, env, id);
		if (method === 'DELETE') return deleteCommentaire(env, id);
	} else if (path === '/sorties') {
		if (method === 'GET') return listSorties(env);
		if (method === 'POST') return addSortie(request, env);
	} else if (path.startsWith('/sorties/')) {
		const id = Number(path.slice('/sorties/'.length));
		if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(404, 'Route inconnue');
		if (method === 'PATCH') return updateSortie(request, env, id);
	} else if (path === '/boissons') {
		if (method === 'GET') return json(await boissonTotals(env));
		if (method === 'POST') return addBoisson(request, env);
	} else if (path === '/boissons/dernier') {
		if (method === 'DELETE') return undoBoisson(env, url);
	} else if (path === '/notify/dodo') {
		if (method === 'POST') return notifyDodo(request, env);
	} else if (path === '/notify/valentine') {
		if (method === 'POST') return notifyValentine(env, ctx);
	} else {
		throw new HttpError(404, 'Route inconnue');
	}
	throw new HttpError(405, 'Méthode non autorisée');
}

export default {
	async fetch(request, env, ctx) {
		const cors = corsHeaders(request, env);

		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: cors });
		}

		let response;
		try {
			response = await route(request, env, ctx);
		} catch (err) {
			if (err instanceof HttpError) {
				response = json({ error: err.message }, err.status);
			} else {
				console.error(err);
				response = json({ error: 'Erreur serveur' }, 500);
			}
		}

		const headers = new Headers(response.headers);
		for (const [k, v] of Object.entries(cors)) headers.set(k, v);
		return new Response(response.body, { status: response.status, headers });
	},
};

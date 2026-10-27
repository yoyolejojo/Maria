// Convertit les exports CSV de Supabase (tables commentaires et sorties) en un fichier SQL pour D1.
//
// Usage :
//   node scripts/import-csv.mjs --commentaires chemin/commentaires.csv --sorties chemin/sorties.csv [--out import.sql]
//   npx wrangler d1 execute maria-db --local  --file import.sql   (test)
//   npx wrangler d1 execute maria-db --remote --file import.sql   (production)
//
// Les id d'origine sont conservés. Le script s'arrête si une ligne viole une contrainte de la base.
// Sans dépendance : parseur CSV maison (guillemets, virgules et retours à la ligne dans les champs).

import { readFileSync, writeFileSync } from 'node:fs';

function parseArgs(argv) {
	const args = {};
	for (let i = 0; i < argv.length; i += 2) {
		const key = argv[i]?.replace(/^--/, '');
		if (!key || argv[i + 1] === undefined) throw new Error(`Argument invalide : ${argv[i]}`);
		args[key] = argv[i + 1];
	}
	return args;
}

function parseCsv(text) {
	const rows = [];
	let row = [];
	let field = '';
	let inQuotes = false;
	text = text.replace(/^﻿/, '');

	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (inQuotes) {
			if (c === '"' && text[i + 1] === '"') {
				field += '"';
				i++;
			} else if (c === '"') {
				inQuotes = false;
			} else {
				field += c;
			}
		} else if (c === '"') {
			inQuotes = true;
		} else if (c === ',') {
			row.push(field);
			field = '';
		} else if (c === '\n' || c === '\r') {
			if (c === '\r' && text[i + 1] === '\n') i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else {
			field += c;
		}
	}
	if (field !== '' || row.length > 0) {
		row.push(field);
		rows.push(row);
	}

	const [header, ...data] = rows.filter((r) => r.length > 1 || r[0] !== '');
	return data.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])));
}

// "2025-01-14 10:22:33.123456+00" -> "2025-01-14T10:22:33.123Z"
function toIso(value, line) {
	const normalized = value
		.trim()
		.replace(' ', 'T')
		.replace(/(\.\d{3})\d+/, '$1')
		.replace(/([+-]\d{2})$/, '$1:00');
	const date = new Date(normalized);
	if (Number.isNaN(date.getTime())) throw new Error(`${line} : date invalide "${value}"`);
	return date.toISOString();
}

function toBool(value, line) {
	const v = String(value).trim().toLowerCase();
	if (['true', 't', '1'].includes(v)) return 1;
	if (['false', 'f', '0', ''].includes(v)) return 0;
	throw new Error(`${line} : booléen invalide "${value}"`);
}

function toId(value, line) {
	const id = Number(value);
	if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${line} : id invalide "${value}"`);
	return id;
}

// Littéral SQL (usage hors ligne uniquement ; le Worker, lui, utilise bind())
function sql(value) {
	if (typeof value === 'number') return String(value);
	return `'${String(value).replace(/'/g, "''")}'`;
}

function commentairesSql(rows) {
	return rows.map((r, i) => {
		const line = `commentaires ligne ${i + 2}`;
		const note = Number(r.note);
		if (!Number.isInteger(note) || note < 1 || note > 5) throw new Error(`${line} : note invalide "${r.note}"`);
		if (!r.post_id || !r.auteur || !r.commentaire) throw new Error(`${line} : champ vide`);
		if (r.auteur.length > 50 || r.commentaire.length > 500) console.warn(`⚠️  ${line} : texte plus long que la limite de l'API (importé quand même)`);
		const values = [toId(r.id, line), r.post_id, r.auteur, r.commentaire, note, toIso(r.created_at, line)];
		return `INSERT INTO commentaires (id, post_id, auteur, commentaire, note, created_at) VALUES (${values.map(sql).join(', ')});`;
	});
}

function sortiesSql(rows) {
	return rows.map((r, i) => {
		const line = `sorties ligne ${i + 2}`;
		if (!r.titre || !r.categorie) throw new Error(`${line} : champ vide`);
		const values = [toId(r.id, line), r.titre, r.categorie, toBool(r.fait, line), toIso(r.created_at, line)];
		return `INSERT INTO sorties (id, titre, categorie, fait, created_at) VALUES (${values.map(sql).join(', ')});`;
	});
}

const args = parseArgs(process.argv.slice(2));
if (!args.commentaires && !args.sorties) {
	console.error('Usage : node scripts/import-csv.mjs --commentaires fichier.csv --sorties fichier.csv [--out import.sql]');
	process.exit(1);
}

const out = args.out || 'import.sql';
const statements = [];
if (args.commentaires) {
	const s = commentairesSql(parseCsv(readFileSync(args.commentaires, 'utf8')));
	console.log(`commentaires : ${s.length} ligne(s)`);
	statements.push(...s);
}
if (args.sorties) {
	const s = sortiesSql(parseCsv(readFileSync(args.sorties, 'utf8')));
	console.log(`sorties : ${s.length} ligne(s)`);
	statements.push(...s);
}

writeFileSync(out, statements.join('\n') + '\n');
console.log(`✅ ${out} écrit (${statements.length} INSERT)`);

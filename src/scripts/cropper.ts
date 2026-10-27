// Recadrage d'une photo dans un cadre au format fixe (2:1 pour les couvertures).
// Déplacement au doigt / à la souris, zoom par pincement, molette ou curseur.
// La zone visible dans le cadre est exactement ce qui sera exporté.

const MAX_ZOOM = 4;
// Taille max de la photo chargée dans l'outil (limite mémoire des canvas sur téléphone)
const SOURCE_MAX_SIDE = 3000;
// Largeur max de l'image exportée
const OUTPUT_MAX_WIDTH = 1600;

export type CropperElements = {
	modal: HTMLElement;
	stage: HTMLElement;
	zoom: HTMLInputElement;
	cancel: HTMLButtonElement;
	confirm: HTMLButtonElement;
};

export function createCropper(els: CropperElements, aspect = 2) {
	let source: HTMLCanvasElement | null = null;
	let frameW = 0;
	let frameH = 0;
	let minScale = 1;
	let zoom = 1;
	let x = 0;
	let y = 0;
	let resolveCrop: ((canvas: HTMLCanvasElement | null) => void) | null = null;
	const pointers = new Map<number, { x: number; y: number }>();

	function layout() {
		const rect = els.stage.getBoundingClientRect();
		const oldScale = minScale * zoom;
		// Point de l'image au centre du cadre, pour le garder centré après un redimensionnement
		const cx = frameW ? (frameW / 2 - x) / oldScale : 0;
		const cy = frameH ? (frameH / 2 - y) / oldScale : 0;
		frameW = rect.width;
		frameH = rect.height;
		if (!source) return;
		minScale = Math.max(frameW / source.width, frameH / source.height);
		const scale = minScale * zoom;
		x = frameW / 2 - (cx || source.width / 2) * scale;
		y = frameH / 2 - (cy || source.height / 2) * scale;
		render();
	}

	// Empêche de laisser apparaître du vide dans le cadre
	function clamp() {
		if (!source) return;
		const scale = minScale * zoom;
		x = Math.min(0, Math.max(frameW - source.width * scale, x));
		y = Math.min(0, Math.max(frameH - source.height * scale, y));
	}

	function render() {
		if (!source) return;
		clamp();
		source.style.transform = `translate(${x}px, ${y}px) scale(${minScale * zoom})`;
	}

	// Zoom autour d'un point du cadre (centre par défaut)
	function setZoom(value: number, cx = frameW / 2, cy = frameH / 2) {
		const before = minScale * zoom;
		const ix = (cx - x) / before;
		const iy = (cy - y) / before;
		zoom = Math.min(MAX_ZOOM, Math.max(1, value));
		const after = minScale * zoom;
		x = cx - ix * after;
		y = cy - iy * after;
		els.zoom.value = String(zoom);
		render();
	}

	function stagePoint(e: { clientX: number; clientY: number }) {
		const rect = els.stage.getBoundingClientRect();
		return { x: e.clientX - rect.left, y: e.clientY - rect.top };
	}

	// ---------- Gestes ----------

	els.stage.addEventListener('pointerdown', (e) => {
		els.stage.setPointerCapture(e.pointerId);
		pointers.set(e.pointerId, stagePoint(e));
	});

	els.stage.addEventListener('pointermove', (e) => {
		const prev = pointers.get(e.pointerId);
		if (!prev) return;
		const point = stagePoint(e);

		if (pointers.size === 1) {
			x += point.x - prev.x;
			y += point.y - prev.y;
			pointers.set(e.pointerId, point);
			render();
			return;
		}

		// Pincement à deux doigts
		const [a, b] = [...pointers.entries()];
		const other = a[0] === e.pointerId ? b[1] : a[1];
		const prevDist = Math.hypot(prev.x - other.x, prev.y - other.y);
		const dist = Math.hypot(point.x - other.x, point.y - other.y);
		pointers.set(e.pointerId, point);
		if (prevDist > 0) setZoom(zoom * (dist / prevDist), (point.x + other.x) / 2, (point.y + other.y) / 2);
	});

	const release = (e: PointerEvent) => pointers.delete(e.pointerId);
	els.stage.addEventListener('pointerup', release);
	els.stage.addEventListener('pointercancel', release);

	els.stage.addEventListener(
		'wheel',
		(e) => {
			e.preventDefault();
			const p = stagePoint(e);
			setZoom(zoom * Math.exp(-e.deltaY * 0.002), p.x, p.y);
		},
		{ passive: false }
	);

	els.zoom.addEventListener('input', () => setZoom(Number(els.zoom.value)));
	window.addEventListener('resize', () => {
		if (!els.modal.hidden) layout();
	});

	// ---------- Ouverture / fermeture ----------

	function close(result: HTMLCanvasElement | null) {
		els.modal.hidden = true;
		document.body.style.overflow = '';
		pointers.clear();
		source?.remove();
		source = null;
		resolveCrop?.(result);
		resolveCrop = null;
	}

	function exportCrop() {
		if (!source) return null;
		const scale = minScale * zoom;
		const sx = -x / scale;
		const sy = -y / scale;
		const sw = frameW / scale;
		const sh = frameH / scale;
		const out = document.createElement('canvas');
		out.width = Math.round(Math.min(OUTPUT_MAX_WIDTH, sw));
		out.height = Math.round(out.width / aspect);
		out.getContext('2d')!.drawImage(source, sx, sy, sw, sh, 0, 0, out.width, out.height);
		return out;
	}

	els.cancel.addEventListener('click', () => close(null));
	els.confirm.addEventListener('click', () => close(exportCrop()));
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape' && !els.modal.hidden) close(null);
	});

	// Ouvre l'outil sur une photo ; renvoie le canvas recadré, ou null si annulé
	async function crop(file: File): Promise<HTMLCanvasElement | null> {
		const bitmap = await createImageBitmap(file);
		const scale = Math.min(1, SOURCE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
		source = document.createElement('canvas');
		source.width = Math.round(bitmap.width * scale);
		source.height = Math.round(bitmap.height * scale);
		source.getContext('2d')!.drawImage(bitmap, 0, 0, source.width, source.height);
		bitmap.close();
		source.className = 'crop-source';
		els.stage.append(source);

		zoom = 1;
		els.zoom.value = '1';
		frameW = 0;
		frameH = 0;
		els.modal.hidden = false;
		document.body.style.overflow = 'hidden';
		layout();

		return new Promise((resolve) => {
			resolveCrop = resolve;
		});
	}

	return { crop };
}

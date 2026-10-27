// Adresse de l'API (Worker Cloudflare).
// En production : PUBLIC_API_URL, défini dans les variables d'environnement Netlify.
// En local, si la variable est absente : même adresse que la page, port 8787
// (localhost ou IP du réseau, sans rien changer quand l'IP du PC change).
export const API_URL: string =
	import.meta.env.PUBLIC_API_URL || `${location.protocol}//${location.hostname}:8787`;

/**
 * Welcome to Cloudflare Workers!
 *
 * This is the core logic of your application. It handles:
 * 1. Serving the static frontend (HTML, CSS, JS) from an R2 bucket.
 * 2. Handling API requests from the frontend to convert subscription links.
 * 3. Parsing different proxy protocols.
 * 4. Generating Clash and Sing-box configuration files.
 * 5. Storing the generated files back into the R2 bucket.
 * 6. Providing download links for the generated files.
 *
 * @see https://developers.cloudflare.com/workers/
 */

// A simple router
const Router = () => {
	const routes = [];
	const add = (method, path, handler) => routes.push({ method, path, handler });
	const handle = async (request, env, ctx) => {
		const url = new URL(request.url);
		for (const route of routes) {
			if (request.method !== route.method) continue;
			const match = url.pathname.match(route.path);
			if (match) {
				const params = match.groups || {};
				return await route.handler({ request, params, url, env, ctx });
			}
		}

		// Fallback for static assets for GET requests
		if (request.method === 'GET') {
			return serveStaticAsset({ request, env });
		}

		return new Response('Not Found', { status: 404 });
	};
	return {
		get: (path, handler) => add('GET', path, handler),
		post: (path, handler) => add('POST', path, handler),
		handle,
	};
};


const router = Router();

/**
 * Handles POST requests to /convert
 * This is where the main conversion logic happens.
 */
router.post(/^\/convert$/, async ({ request, env }) => {
	try {
		const body = await request.text();
		if (!body) {
			return new Response('Request body is empty.', { status: 400 });
		}

		const lines = body.split(/[\r\n]+/).filter(line => line.trim() !== '');
		let allProxies = [];

		for (const line of lines) {
			if (line.startsWith('http://') || line.startsWith('https://')) {
				// It's a remote subscription link
				const response = await fetch(line);
				if (!response.ok) continue;
				const content = await response.text();
				const remoteLines = content.split(/[\r\n]+/).filter(l => l.trim() !== '');
				for (const remoteLine of remoteLines) {
					const proxies = await parseShareLink(remoteLine);
					allProxies.push(...proxies);
				}
			} else {
				// It's a direct share link
				const proxies = await parseShareLink(line);
				allProxies.push(...proxies);
			}
		}

		if (allProxies.length === 0) {
			return new Response('No valid proxy nodes found.', { status: 400 });
		}
		
		// Remove duplicate proxies by name
		allProxies = allProxies.filter((proxy, index, self) =>
            index === self.findIndex((p) => (
                p.name === proxy.name
            ))
        );


		// Generate configurations
		const clashConfig = generateClashConfig(allProxies);
		const singboxConfig = generateSingboxConfig(allProxies);

		// Store files in R2
		const fileId = crypto.randomUUID();
		const clashKey = `configs/clash-${fileId}.yaml`;
		const singboxKey = `configs/singbox-${fileId}.json`;

		await env.SUB_STORE.put(clashKey, clashConfig, {
			httpMetadata: { contentType: 'application/x-yaml; charset=utf-8' },
		});
		await env.SUB_STORE.put(singboxKey, singboxConfig, {
			httpMetadata: { contentType: 'application/json; charset=utf-8' },
		});

		return new Response(JSON.stringify({
			success: true,
			clashUrl: `/download/${clashKey}`,
			singboxUrl: `/download/${singboxKey}`,
		}), {
			headers: { 'Content-Type': 'application/json' },
		});

	} catch (error) {
		console.error('Conversion error:', error);
		return new Response(`An error occurred: ${error.message}`, { status: 500 });
	}
});

/**
 * Handles GET requests to /download/:key
 * Serves the generated configuration files from R2.
 */
router.get(/^\/download\/(?<key>.+)$/, async ({ params, env }) => {
	const { key } = params;
	const object = await env.SUB_STORE.get(key);

	if (object === null) {
		return new Response('Object Not Found', { status: 404 });
	}

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set('etag', object.httpEtag);
	// Add Content-Disposition to suggest a filename for download
	const filename = key.split('/').pop();
	headers.set('Content-Disposition', `attachment; filename="${filename}"`);

	return new Response(object.body, {
		headers,
	});
});


/**
 * Serves static assets from the R2 bucket.
 * This function handles requests for frontend files like index.html, script.js, etc.
 */
async function serveStaticAsset({ request, env }) {
	const url = new URL(request.url);
	let key = url.pathname.slice(1);

	if (key === '') {
		key = 'index.html';
	}

	const object = await env.SUB_STORE.get(key);

	if (object === null) {
		return new Response(`Object Not Found: ${key}`, { status: 404 });
	}

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set('etag', object.httpEtag);

	// Determine content type based on file extension
	const fileExtension = key.split('.').pop();
	if (fileExtension === 'html') headers.set('Content-Type', 'text/html; charset=utf-8');
	if (fileExtension === 'css') headers.set('Content-Type', 'text/css; charset=utf-8');
	if (fileExtension === 'js') headers.set('Content-Type', 'application/javascript; charset=utf-8');

	return new Response(object.body, {
		headers,
	});
}

/**
 * Main fetch event handler.
 */
export default {
	async fetch(request, env, ctx) {
		return router.handle(request, env, ctx);
	},
};

// --- Conversion and Parsing Logic ---

/**
 * Parses a share link (e.g., vless://, trojan://)
 * @param {string} link The share link
 * @returns {Promise<Object[]>} A promise that resolves to an array of proxy objects
 */
async function parseShareLink(link) {
	try {
        // Handle Base64 encoded links
        let decodedLink = link;
        // A simple check for potential Base64 content
        if (!link.includes('://') && (link.length % 4 === 0)) {
             try {
                decodedLink = atob(link);
             } catch (e) {
                // Not a valid base64 string, proceed with original link
             }
        }
        
		if (decodedLink.startsWith('vless://')) {
			return [parseVless(decodedLink)];
		}
		if (decodedLink.startsWith('vmess://')) {
			// In a real app, you would parse the Base64 encoded JSON here
			return [parseVmess(decodedLink)];
		}
		if (decodedLink.startsWith('trojan://')) {
			return [parseTrojan(decodedLink)];
		}
		// Add other protocols here...
		// e.g., if (decodedLink.startsWith('ss://')) return [parseSS(decodedLink)];
		// e.g., if (decodedLink.startsWith('tuic://')) return [parseTuic(decodedLink)];
		// e.g., if (decodedLink.startsWith('hysteria2://')) return [parseHysteria2(decodedLink)];
	} catch (error) {
		console.warn(`Skipping invalid link: ${link.substring(0, 30)}...`, error.message);
		return []; // Return empty array for invalid links
	}
	return [];
}


/**
 * Parses a VLESS link. This is a detai

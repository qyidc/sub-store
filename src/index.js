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
 * Parses a VLESS link. This is a detailed example.
 * @param {string} link - The VLESS share link.
 * @returns {Object} A Clash-compatible proxy object.
 */
function parseVless(link) {
	const url = new URL(link);
	const params = url.searchParams;

	const proxy = {
		name: decodeURIComponent(url.hash).substring(1) || url.hostname,
		type: 'vless',
		server: url.hostname,
		port: parseInt(url.port, 10),
		uuid: url.username,
		network: params.get('type') || 'tcp',
		tls: params.get('security') === 'tls' || params.get('security') === 'reality',
		udp: true, // Commonly enabled
		flow: params.get('flow') || '',
		'client-fingerprint': params.get('fp') || 'chrome',
	};

	if (proxy.tls) {
		proxy.servername = params.get('sni') || url.hostname;
		proxy.alpn = params.get('alpn') ? params.get('alpn').split(',') : ["h2", "http/1.1"];
		if (params.get('security') === 'reality') {
			// FIX: Use bracket notation for property names with hyphens.
			proxy['reality-opts'] = {
				'public-key': params.get('pbk'),
				'short-id': params.get('sid'),
			};
		}
	}

	if (proxy.network === 'ws') {
		proxy['ws-opts'] = {
			path: params.get('path') || '/',
			headers: { Host: params.get('host') || url.hostname }
		};
	}
    
    // Add support for other network types like gRPC
    if (proxy.network === 'grpc') {
        proxy['grpc-opts'] = {
            'grpc-service-name': params.get('serviceName') || '',
        };
    }

	return proxy;
}

/**
 * Placeholder parser for VMess links.
 * @param {string} link - The VMess share link.
 * @returns {Object} A placeholder proxy object.
 */
function parseVmess(link) {
    const base64String = link.substring('vmess://'.length);
    const decodedJson = atob(base64String);
    const vmessConfig = JSON.parse(decodedJson);

    return {
        name: vmessConfig.ps || vmessConfig.add,
        type: 'vmess',
        server: vmessConfig.add,
        port: vmessConfig.port,
        uuid: vmessConfig.id,
        alterId: vmessConfig.aid,
        cipher: vmessConfig.scy || 'auto',
        tls: vmessConfig.tls === 'tls',
        network: vmessConfig.net || 'tcp',
        udp: true,
        'ws-opts': vmessConfig.net === 'ws' ? {
            path: vmessConfig.path || '/',
            headers: { Host: vmessConfig.host || vmessConfig.add }
        } : undefined
    };
}


/**
 * Placeholder parser for Trojan links.
 * @param {string} link - The Trojan share link.
 * @returns {Object} A Clash-compatible proxy object.
 */
function parseTrojan(link) {
	const url = new URL(link);
	const params = url.searchParams;
    return {
        name: decodeURIComponent(url.hash).substring(1) || url.hostname,
        type: 'trojan',
        server: url.hostname,
        port: parseInt(url.port, 10),
        password: url.username,
        udp: true,
        sni: params.get('sni') || url.hostname,
        alpn: params.get('alpn') ? params.get('alpn').split(',') : ["h2", "http/1.1"],
    };
}


// --- Configuration Generators ---

/**
 * Generates a Clash configuration file content.
 * @param {Object[]} proxies - An array of proxy objects.
 * @returns {string} The YAML content for the Clash config.
 */
function generateClashConfig(proxies) {
	const proxyNames = proxies.map(p => p.name);

	const config = {
		'port': 7890,
		'socks-port': 7891,
		'allow-lan': false,
		'mode': 'rule',
		'log-level': 'info',
		'external-controller': '127.0.0.1:9090',
		'proxies': proxies,
		'proxy-groups': [{
			'name': 'PROXY',
			'type': 'select',
			'proxies': ['DIRECT', ...proxyNames],
		}],
		'rules': [
			'DOMAIN-SUFFIX,google.com,PROXY',
			'DOMAIN-KEYWORD,google,PROXY',
			'DOMAIN-SUFFIX,github.com,PROXY',
			'DOMAIN-KEYWORD,github,PROXY',
			'DOMAIN-SUFFIX,telegram.org,PROXY',
			'MATCH,DIRECT',
		],
	};
    
    // A more reliable way to serialize to YAML-like string for Clash
    const serializeClash = (config) => {
        let out = "";
        const simpleDump = (key, val) => out += `${key}: ${val}\n`;

        simpleDump('port', config.port);
        simpleDump('socks-port', config['socks-port']);
        simpleDump('allow-lan', config['allow-lan']);
        simpleDump('mode', config.mode);
        simpleDump('log-level', config['log-level']);
        simpleDump('external-controller', config['external-controller']);
        
        out += "proxies:\n";
        for (const proxy of config.proxies) {
            out += "  - name: " + JSON.stringify(proxy.name) + "\n";
            out += "    type: " + proxy.type + "\n";
            out += "    server: " + proxy.server + "\n";
            out += "    port: " + proxy.port + "\n";
            if (proxy.uuid) out += "    uuid: " + proxy.uuid + "\n";
            if (proxy.password) out += "    password: " + JSON.stringify(proxy.password) + "\n";
            if (proxy.alterId) out += "    alterId: " + proxy.alterId + "\n";
            if (proxy.cipher) out += "    cipher: " + proxy.cipher + "\n";
            if (proxy.network) out += "    network: " + proxy.network + "\n";
            if (proxy.tls) out += "    tls: " + proxy.tls + "\n";
            if (proxy.udp) out += "    udp: " + proxy.udp + "\n";
            if (proxy.flow) out += "    flow: " + proxy.flow + "\n";
            if (proxy['client-fingerprint']) out += "    client-fingerprint: " + proxy['client-fingerprint'] + "\n";
            if (proxy.servername) out += "    servername: " + proxy.servername + "\n";
            if (proxy.sni) out += "    sni: " + proxy.sni + "\n";
            if (proxy.alpn) out += "    alpn: [" + proxy.alpn.join(', ') + "]\n";
            
            if (proxy['ws-opts']) {
                out += "    ws-opts:\n";
                out += "      path: " + JSON.stringify(proxy['ws-opts'].path) + "\n";
                if (proxy['ws-opts'].headers && proxy['ws-opts'].headers.Host) {
                   out += "      headers:\n";
                   out += "        Host: " + JSON.stringify(proxy['ws-opts'].headers.Host) + "\n";
                }
            }
            if (proxy['grpc-opts']) {
                out += "    grpc-opts:\n";
                out += "      grpc-service-name: " + JSON.stringify(proxy['grpc-opts']['grpc-service-name']) + "\n";
            }
             if (proxy['reality-opts']) {
                out += "    reality-opts:\n";
                out += "      public-key: " + JSON.stringify(proxy['reality-opts']['public-key']) + "\n";
                if (proxy['reality-opts']['short-id']) {
                  out += "      short-id: " + JSON.stringify(proxy['reality-opts']['short-id']) + "\n";
                }
            }
        }
        
        out += "proxy-groups:\n";
        for(const group of config['proxy-groups']) {
             out += `  - name: ${group.name}\n`;
             out += `    type: ${group.type}\n`;
             out += `    proxies:\n`;
             for(const proxyName of group.proxies){
                 out += `      - ${proxyName}\n`;
             }
        }

        out += "rules:\n";
        for (const rule of config.rules) {
            out += `  - ${rule}\n`;
        }
        
        return out;
    }

	return serializeClash(config);
}


/**
 * Generates a Sing-box configuration file content.
 * @param {Object[]} proxies - An array of proxy objects from Clash format.
 * @returns {string} The JSON content for the Sing-box config.
 */
function generateSingboxConfig(proxies) {
	const outbounds = proxies.map(clashProxy => {
		// This is a simplified mapping. A real implementation needs more detail.
		const singboxOutbound = {
			type: clashProxy.type,
			tag: clashProxy.name,
			server: clashProxy.server,
			server_port: clashProxy.port,
		};

        // Add protocol-specific fields
        if(clashProxy.uuid) singboxOutbound.uuid = clashProxy.uuid;
        if(clashProxy.password) singboxOutbound.password = clashProxy.password;
        if (clashProxy.type === 'vmess') {
            singboxOutbound.security = clashProxy.cipher || 'auto';
            singboxOutbound.alter_id = clashProxy.alterId;
        }

		if (clashProxy.type === 'vless') {
			singboxOutbound.flow = clashProxy.flow;
		}

        // Common TLS and Transport settings
		if (clashProxy.tls) {
			singboxOutbound.tls = {
				enabled: true,
				server_name: clashProxy.servername || clashProxy.sni,
				alpn: clashProxy.alpn,
				utls: {
                    enabled: true,
                    fingerprint: clashProxy['client-fingerprint'] || 'chrome',
                }
			};

            if (clashProxy['reality-opts']) {
                singboxOutbound.tls.reality = {
                    enabled: true,
                    public_key: clashProxy['reality-opts']['public-key'],
                    short_id: clashProxy['reality-opts']['short-id'],
                }
            }
		}

		if(clashProxy.network === 'ws' && clashProxy['ws-opts']) {
            singboxOutbound.transport = {
                type: 'ws',
                path: clashProxy['ws-opts'].path,
                headers: {
                    Host: clashProxy['ws-opts'].headers.Host
                }
            }
        } else if (clashProxy.network === 'grpc' && clashProxy['grpc-opts']) {
            singboxOutbound.transport = {
                type: 'grpc',
                service_name: clashProxy['grpc-opts']['grpc-service-name']
            }
        }
		return singboxOutbound;
	});

    // Add a selector and DIRECT/REJECT outbounds
    outbounds.push({
        type: 'selector',
        tag: 'PROXY',
        outbounds: proxies.map(p => p.name).concat(['DIRECT', 'REJECT'])
    }, {
        type: 'direct',
        tag: 'DIRECT'
    }, {
        type: 'block',
        tag: 'REJECT'
    }, {
        type: 'dns',
        tag: 'dns-out'
    });


	const config = {
		"log": { "level": "info", "timestamp": true },
		"inbounds": [
            { "type": "mixed", "tag": "mixed-in", "listen": "127.0.0.1", "listen_port": 2080 }
        ],
		"outbounds": outbounds,
		"route": {
			"rules": [
                { "protocol": "dns", "outbound": "dns-out" },
                { "domain_suffix": ["cn", "qq.com", "wechat.com"], "outbound": "DIRECT" },
				{ "outbound": "PROXY" }
			],
            "auto_detect_interface": true
		},
        "experimental": { "clash_api": { "external_controller": "127.0.0.1:9090", "secret": "" } }
	};
	return JSON.stringify(config, null, 2);
}

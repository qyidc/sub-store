/**
 * Welcome to Cloudflare Workers!
 *
 * This is the core logic of your application. It handles:
 * 1. Serving the static frontend (HTML, CSS, JS) from an R2 bucket.
 * 2. Handling API requests from the frontend to convert subscription links.
 * 3. Parsing different proxy protocols, now including TUIC and Hysteria2.
 * 4. Generating Clash and Sing-box configuration files.
 * 5. Storing the generated files with a TTL into the R2 bucket.
 * 6. Providing both download links and a direct Clash subscription link.
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
                // This is a remote subscription link
				const response = await fetch(line);
				if (!response.ok) {
                    console.warn(`Failed to fetch subscription: ${line}, status: ${response.status}`);
                    continue;
                }
                const subContent = await response.text();
                
                // Check if the subscription content is Base64 encoded.
                let decodedContent;
                try {
                    // It's common for the entire list of nodes to be base64 encoded.
                    decodedContent = atob(subContent);
                } catch (e) {
                    // If decoding fails, assume it's a plain text list of links.
                    decodedContent = subContent;
                }

				const remoteLines = decodedContent.split(/[\r\n]+/).filter(l => l.trim() !== '');
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
			return new Response('未找到有效的代理节点。请检查您的链接或订阅。', { status: 400 });
		}
		
		// Remove duplicate proxies by name
		allProxies = allProxies.filter((proxy, index, self) =>
            proxy && proxy.name && index === self.findIndex((p) => p && p.name === proxy.name)
        );


		// Generate configurations
		const clashConfig = generateClashConfig(allProxies);
		const singboxConfig = generateSingboxConfig(allProxies);

		// Store files in R2 with a 7-day TTL
		const fileId = crypto.randomUUID();
        const clashSubKey = `subs/clash-${fileId}.yaml`;
		const clashDownloadKey = `configs/clash-${fileId}.yaml`;
		const singboxKey = `configs/singbox-${fileId}.json`;
        const expiration = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now

		await env.SUB_STORE.put(clashSubKey, clashConfig, {
			httpMetadata: { contentType: 'application/x-yaml; charset=utf-8' },
            expires: expiration,
		});
        await env.SUB_STORE.put(clashDownloadKey, clashConfig, {
			httpMetadata: { contentType: 'application/x-yaml; charset=utf-8' },
            expires: expiration,
		});
		await env.SUB_STORE.put(singboxKey, singboxConfig, {
			httpMetadata: { contentType: 'application/json; charset=utf-8' },
            expires: expiration,
		});

        // Get the current URL base to construct the subscription link
        const urlBase = new URL(request.url).origin;

		return new Response(JSON.stringify({
			success: true,
            clashSubUrl: `${urlBase}/${clashSubKey}`,
			clashDownloadUrl: `/download/${clashDownloadKey}`,
			singboxDownloadUrl: `/download/${singboxKey}`,
		}), {
			headers: { 'Content-Type': 'application/json' },
		});

	} catch (error) {
		console.error('Conversion error:', error);
		return new Response(`发生错误: ${error.message}`, { status: 500 });
	}
});

/**
 * Handles GET requests to /download/:key
 * Serves the generated configuration files for download.
 */
router.get(/^\/download\/(?<path>.+)$/, async ({ params, env }) => {
	const object = await env.SUB_STORE.get(params.path);

	if (object === null) {
		return new Response('Object Not Found', { status: 404 });
	}

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set('etag', object.httpEtag);
	const filename = params.path.split('/').pop();
	headers.set('Content-Disposition', `attachment; filename="${filename}"`);

	return new Response(object.body, { headers });
});

/**
 * Handles GET requests for the Clash subscription link
 */
router.get(/^\/(?<path>.+)$/, async ({ params, env, request }) => {
    const object = await env.SUB_STORE.get(params.path);

    if (object === null) {
        return new Response('Subscription not found', { status: 404 });
    }

    // Read the body content ONCE into a string variable to avoid "body already read" errors.
    const configText = await object.text();

    const headers = new Headers();
    object.writeHttpMetadata(headers); // This reads metadata, which is fine.
    headers.set('etag', object.httpEtag);    
     
    // Add subscription-info header for Clash clients, using the string variable.
    const proxyCount = (configText.match(/name:/g) || []).length;
    headers.set('subscription-userinfo', `upload=0; download=0; total=107374182400; expire=${Math.floor(object.expires.getTime() / 1000)}`);
    headers.set('profile-update-interval', '24'); // 24 hours
    headers.set('profile-web-page-url', new URL(request.url).origin);
    // 代码增加后会导致 Clash 订阅地址无法解析
    // headers.set('Content-Type', 'application/x-yaml; charset=utf-8');

    // Return a new response using the string variable as the body.
    return new Response(configText, { headers });
});


/**
 * Serves static assets from the R2 bucket.
 */
async function serveStaticAsset({ request, env }) {
	const url = new URL(request.url);
	let key = url.pathname.slice(1);
	if (key === '') key = 'index.html';

	const object = await env.SUB_STORE.get(key);
	if (object === null) return new Response(`Object Not Found: ${key}`, { status: 404 });

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set('etag', object.httpEtag);

	if (key.endsWith('.html')) headers.set('Content-Type', 'text/html; charset=utf-8');
	else if (key.endsWith('.css')) headers.set('Content-Type', 'text/css; charset=utf-8');
	else if (key.endsWith('.js')) headers.set('Content-Type', 'application/javascript; charset=utf-8');

	return new Response(object.body, { headers });
}

export default {
	async fetch(request, env, ctx) {
		return router.handle(request, env, ctx);
	},
};

// --- Conversion and Parsing Logic ---

async function parseShareLink(link) {
	if (!link) return [];
	try {
        let decodedLink = link;
        if (!link.includes('://') && (link.length % 4 === 0) && /^[a-zA-Z0-9+/]*={0,2}$/.test(link)) {
             try { decodedLink = atob(link); } catch (e) { /* ignore */}
        }
        
		if (decodedLink.startsWith('vless://')) return [parseVless(decodedLink)];
		if (decodedLink.startsWith('vmess://')) return [parseVmess(decodedLink)];
		if (decodedLink.startsWith('trojan://')) return [parseTrojan(decodedLink)];
        if (decodedLink.startsWith('tuic://')) return [parseTuic(decodedLink)];
        if (decodedLink.startsWith('hysteria2://')) return [parseHysteria2(decodedLink)];
	} catch (error) {
		console.warn(`Skipping invalid link: ${link.substring(0, 40)}...`, error.message);
		return [];
	}
	return [];
}


// --- Protocol Parsers ---

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
		udp: true,
		flow: params.get('flow') || '',
		'client-fingerprint': params.get('fp') || 'chrome',
	};

	if (proxy.tls) {
		proxy.servername = params.get('sni') || url.hostname;
		proxy.alpn = params.get('alpn') ? params.get('alpn').split(',') : ["h2", "http/1.1"];
		if (params.get('security') === 'reality') {
			proxy['reality-opts'] = { 'public-key': params.get('pbk'), 'short-id': params.get('sid') };
		}
	}
	if (proxy.network === 'ws') proxy['ws-opts'] = { path: params.get('path') || '/', headers: { Host: params.get('host') || url.hostname } };
    if (proxy.network === 'grpc') proxy['grpc-opts'] = { 'grpc-service-name': params.get('serviceName') || '' };
	return proxy;
}

function parseVmess(link) {
    const jsonStr = atob(link.substring('vmess://'.length));
    const config = JSON.parse(jsonStr);
    return {
        name: config.ps || config.add, type: 'vmess', server: config.add, port: parseInt(config.port, 10),
        uuid: config.id, alterId: config.aid, cipher: config.scy || 'auto',
        tls: config.tls === 'tls', network: config.net || 'tcp', udp: true,
        servername: config.sni || undefined,
        'ws-opts': config.net === 'ws' ? { path: config.path || '/', headers: { Host: config.host || config.add } } : undefined,
        'h2-opts': config.net === 'h2' ? { path: config.path || '/', host: [config.host || config.add] } : undefined,
        'grpc-opts': config.net === 'grpc' ? { 'grpc-service-name': config.path || ''} : undefined,
    };
}

function parseTrojan(link) {
	const url = new URL(link);
	const params = url.searchParams;
    return {
        name: decodeURIComponent(url.hash).substring(1) || url.hostname,
        type: 'trojan', server: url.hostname, port: parseInt(url.port, 10),
        password: url.username, udp: true, sni: params.get('sni') || url.hostname,
        servername: params.get('sni') || url.hostname,
        alpn: params.get('alpn') ? params.get('alpn').split(',') : ["h2", "http/1.1"],
    };
}

function parseTuic(link) {
    const url = new URL(link);
    const params = url.searchParams;
    const [uuid, password] = url.username.split(':');
    return {
        name: decodeURIComponent(url.hash).substring(1) || url.hostname,
        type: 'tuic', server: url.hostname, port: parseInt(url.port, 10),
        uuid: uuid, password: password,
        servername: params.get('sni') || url.hostname,
        udp: true,
        'congestion-controller': params.get('congestion_control') || 'bbr',
        'udp-relay-mode': params.get('udp_relay_mode') || 'native',
        alpn: params.get('alpn') ? params.get('alpn').split(',') : ["h3"],
        'disable-sni': params.get('disable_sni') === 'true',
    };
}

function parseHysteria2(link) {
    const url = new URL(link);
    const params = url.searchParams;
    return {
        name: decodeURIComponent(url.hash).substring(1) || url.hostname,
        type: 'hysteria2', server: url.hostname, port: parseInt(url.port, 10),
        password: url.username,
        servername: params.get('sni') || url.hostname,
        udp: true,
        'skip-cert-verify': params.get('insecure') === '1' || params.get('skip_cert_verify') === 'true',
        obfs: params.get('obfs'),
        'obfs-password': params.get('obfs-password'),
    };
}

// --- Configuration Generators ---

function generateClashConfig(proxies) {
	const proxyNames = proxies.map(p => p.name);
	const config = {
		'port': 7890, 'socks-port': 7891, 'allow-lan': false,
		'mode': 'rule', 'log-level': 'info', 'external-controller': '127.0.0.1:9090',
		'proxies': proxies,
		'proxy-groups': [{
			'name': 'PROXY', 'type': 'select', 'proxies': ['DIRECT', 'REJECT', ...proxyNames],
		}],
		'rules': [
            'DOMAIN-SUFFIX,google.com,PROXY', 'DOMAIN-SUFFIX,github.com,PROXY',
            'DOMAIN-SUFFIX,youtube.com,PROXY', 'DOMAIN-SUFFIX,telegram.org,PROXY',
            'GEOIP,CN,DIRECT', 'MATCH,PROXY',
        ],
	};
    
    // A more reliable way to serialize to YAML-like string for Clash
    const serializeClash = (config) => {
        let out = "";
        const simpleDump = (key, val) => { if(val !== undefined) out += `${key}: ${val}\n`};

        simpleDump('port', config.port);
        simpleDump('socks-port', config['socks-port']);
        simpleDump('allow-lan', config['allow-lan']);
        simpleDump('mode', config.mode);
        simpleDump('log-level', config['log-level']);
        simpleDump('external-controller', config['external-controller']);
        
        out += "proxies:\n";
        for (const proxy of config.proxies) {
            out += "  - {\n";
            for (const [k, v] of Object.entries(proxy)) {
                if(v === undefined) continue;
                if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
                    out += `      ${k}: { `;
                    out += Object.entries(v).map(([sk, sv]) => `${sk}: ${JSON.stringify(sv)}`).join(', ');
                    out += ` },\n`;
                } else if (k === 'alpn') {
                     out += `      ${k}: [${v.map(i => JSON.stringify(i)).join(', ')}],\n`
                }
                else {
                    out += `      ${k}: ${JSON.stringify(v)},\n`;
                }
            }
            out = out.slice(0, -2) + "\n    }\n";
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
 * Generates a Sing-box configuration from a list of proxy objects.
 * This function is more robust and handles the mapping from Clash-style objects
 * to the format required by Sing-box, preventing the 'Cannot create property on boolean' error.
 * @param {Array<Object>} proxies - An array of proxy objects.
 * @returns {string} - A JSON string representing the Sing-box configuration.
 */
function generateSingboxConfig(proxies) {
    const outbounds = proxies.map(clashProxy => {
        // Destructure all possible properties from the Clash-style proxy object
        const {
            name, type, server, port, password, uuid, alterId, cipher,
            network, tls, udp, flow, 'client-fingerprint': fingerprint,
            servername, alpn, 'reality-opts': realityOpts,
            'ws-opts': wsOpts, 'grpc-opts': grpcOpts,
            'congestion-controller': congestion, 'udp-relay-mode': udpRelayMode,
            'skip-cert-verify': skipCertVerify, obfs, 'obfs-password': obfsPassword
        } = clashProxy;

        // Base structure for the Sing-box outbound object
        const singboxOutbound = {
            tag: name,
            type: type,
            server: server,
            server_port: parseInt(port, 10),
        };

        // Add common properties based on protocol
        if (uuid) singboxOutbound.uuid = uuid;
        if (password) singboxOutbound.password = password;

        // VLESS specific properties
        if (type === 'vless') {
            if (flow) singboxOutbound.flow = flow;
        }

        // VMess specific properties
        if (type === 'vmess') {
            singboxOutbound.alter_id = alterId;
            singboxOutbound.security = cipher || 'auto';
        }

        // TLS, Reality, and UTLS settings
        if (tls) {
            singboxOutbound.tls = {
                enabled: true,
                server_name: servername || server,
                alpn: alpn,
                insecure: skipCertVerify || false,
            };
            if (fingerprint) {
                singboxOutbound.tls.utls = { enabled: true, fingerprint: fingerprint };
            }
            if (realityOpts) {
                singboxOutbound.tls.reality = {
                    enabled: true,
                    public_key: realityOpts['public-key'],
                    short_id: realityOpts['short-id'],
                };
            }
        }
        
        // Hysteria2 specific settings
        if(type === 'hysteria2') {
            if (obfs && obfsPassword) {
                singboxOutbound.obfs = { type: 'salamander', password: obfsPassword };
            }
            singboxOutbound.up_mbps = 20; // Default values for sing-box
            singboxOutbound.down_mbps = 100;
        }
        
        // TUIC specific settings
        if(type === 'tuic') {
            singboxOutbound.congestion_control = congestion;
            singboxOutbound.udp_relay_mode = udpRelayMode;
            // sing-box uses TUIC v5 protocol
            singboxOutbound.version = 'v5';
        }

        // Transport (WebSocket, gRPC) settings
        if (network && network !== 'tcp') {
            singboxOutbound.transport = { type: network };
            if (network === 'ws' && wsOpts) {
                singboxOutbound.transport.path = wsOpts.path;
                if (wsOpts.headers && wsOpts.headers.Host) {
                    singboxOutbound.transport.headers = { Host: wsOpts.headers.Host };
                }
            }
            if (network === 'grpc' && grpcOpts) {
                singboxOutbound.transport.service_name = grpcOpts['grpc-service-name'];
            }
        }

        return singboxOutbound;
    });

    // Add selector, direct, and block outbounds
    outbounds.push(
        { type: 'selector', tag: 'PROXY', outbounds: proxies.map(p => p.name).concat(['DIRECT', 'REJECT']) },
        { type: 'direct', tag: 'DIRECT' },
        { type: 'block', tag: 'REJECT' },
        { type: 'dns', tag: 'dns-out' }
    );

    // Final Sing-box configuration structure
	const config = {
		log: { level: "info", timestamp: true },
		inbounds: [{ type: "mixed", tag: "mixed-in", listen: "127.0.0.1", listen_port: 2080 }],
		outbounds: outbounds,
		route: {
			rules: [
                { protocol: "dns", outbound: "dns-out" },
                { geoip: ["cn"], outbound: "DIRECT" },
                { domain_suffix: ["cn", "qq.com", "wechat.com"], outbound: "DIRECT" },
				{ outbound: "PROXY" }
			],
            auto_detect_interface: true
		},
        experimental: { clash_api: { external_controller: "127.0.0.1:9090", secret: "" } }
	};
	return JSON.stringify(config, null, 2);
}

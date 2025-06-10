/**
 * =================================================================================
 * 欢迎来到 Cloudflare Workers! (人机验证已禁用版)
 * =================================================================================
 *
 * 【调试说明】:
 * 1. 【验证已禁用】: 为了排查兼容性问题，本版本已通过注释的方式，暂时禁用了Cloudflare Turnstile人机验证功能。
 * 2. 【功能保留】: 所有与Turnstile相关的代码逻辑均被保留在注释中，方便未来重新启用或进一步调试。
 */

// =================================================================================
// CORS 和 (已禁用的) Turnstile 验证模块
// =================================================================================
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function handleOptions(request) {
  if (
    request.headers.get('Origin') !== null &&
    request.headers.get('Access-Control-Request-Method') !== null &&
    request.headers.get('Access-Control-Request-Headers') !== null
  ) {
    return new Response(null, { headers: corsHeaders });
  } else {
    return new Response(null, { headers: { Allow: 'GET, POST, OPTIONS' } });
  }
}

/* 【调试】: 暂时禁用Turnstile验证函数
async function verifyTurnstileToken(token, secret, remoteip) {
    if (!secret) {
        console.warn("Turnstile secret (TURNSTILE_SECRET) is not set. Skipping verification for development.");
        return true; 
    }
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            secret: secret,
            response: token,
            remoteip: remoteip,
        }),
    });
    const data = await response.json();
    return data.success;
}
*/

// =================================================================================
// 路由模块 (Simple Router)
// =================================================================================
const Router = () => {
	const routes = [];
	const add = (method, path, handler) => routes.push({ method, path, handler });
	const handle = async (request, env, ctx) => {
        if (request.method === 'OPTIONS') {
            return handleOptions(request);
        }
		const url = new URL(request.url);
		for (const route of routes) {
			if (request.method !== route.method) continue;
			const match = url.pathname.match(route.path);
			if (match) {
				const params = match.groups || {};
				return await route.handler({ request, params, url, env, ctx });
			}
		}
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

// =================================================================================
// API 路由: /convert (核心转换逻辑)
// =================================================================================
router.post(/^\/convert$/, async ({ request, env }) => {
	try {
        // 【调试】: 暂时不解析 turnstileToken
		const { subscription_data, expirationDays /*, turnstileToken*/ } = await request.json();

        /* 【调试】: 暂时禁用人机验证逻辑
        const userIp = request.headers.get('CF-Connecting-IP');
        const isValid = await verifyTurnstileToken(turnstileToken, env.TURNSTILE_SECRET, userIp);
        if (!isValid) {
            return new Response('人机验证失败。请刷新页面重试。', { status: 403, headers: corsHeaders });
        }
        */

		if (!subscription_data) {
			return new Response('Request body is empty or invalid.', { status: 400, headers: corsHeaders });
		}

		const lines = subscription_data.split(/[\r\n]+/).filter(line => line.trim() !== '');
		let allProxies = [];
        let allShareLinks = [];

		for (const line of lines) {
			if (line.startsWith('http://') || line.startsWith('https://')) {
				const response = await fetch(line);
				if (!response.ok) {
                    console.warn(`Failed to fetch subscription: ${line}, status: ${response.status}`);
                    continue;
                }
                const subContent = await response.text();
                let decodedContent;
                try { decodedContent = atob(subContent); } catch (e) { decodedContent = subContent; }
				const remoteLines = decodedContent.split(/[\r\n]+/).filter(l => l.trim() !== '');
				for (const remoteLine of remoteLines) {
					const proxies = parseShareLink(remoteLine);
                    if (proxies.length > 0) {
					    allProxies.push(...proxies);
                        allShareLinks.push(remoteLine);
                    }
				}
			} else {
				const proxies = parseShareLink(line);
                if (proxies.length > 0) {
				    allProxies.push(...proxies);
                    allShareLinks.push(line);
                }
			}
		}

		if (allProxies.length === 0) {
			return new Response('未找到有效的代理节点。请检查您的链接或订阅。', { status: 400, headers: corsHeaders });
		}
		
		allProxies = allProxies.filter((proxy, index, self) => proxy && proxy.name && index === self.findIndex((p) => p && p.name === proxy.name));

		const clashConfig = generateClashConfig(allProxies);
		const singboxConfig = generateSingboxConfig(allProxies);
        const genericSubContent = btoa(allShareLinks.join('\n'));
        
        const extractionCode = crypto.randomUUID();
        const clashFileId = `clash-${extractionCode}.yaml`;
        const singboxFileId = `singbox-${extractionCode}.json`;
        const genericFileId = `generic-${extractionCode}.txt`;

        const clashSubR2Key = `subs/${clashFileId}`;
		const singboxR2Key = `configs/${singboxFileId}`;
        const genericSubR2Key = `generic/${genericFileId}`;
        
        const days = parseInt(expirationDays);
        let expiration;
        if (days === 0) {
            expiration = new Date(Date.now() + 5 * 60 * 1000); 
        } else {
            expiration = new Date(Date.now() + (days || 7) * 24 * 60 * 60 * 1000);
        }

        const r2Options = { expires: expiration };

		await env.SUB_STORE.put(clashSubR2Key, clashConfig, { ...r2Options, httpMetadata: { contentType: 'application/x-yaml; charset=utf-8' }});
        await env.SUB_STORE.put(singboxR2Key, singboxConfig, { ...r2Options, httpMetadata: { contentType: 'application/json; charset=utf-8' } });
        await env.SUB_STORE.put(genericSubR2Key, genericSubContent, { ...r2Options, httpMetadata: { contentType: 'text/plain; charset=utf-8' } });

		return new Response(JSON.stringify({ success: true, extractionCode: extractionCode, }), {
			headers: { 'Content-Type': 'application/json', ...corsHeaders },
		});

	} catch (error) {
		console.error('Conversion error:', error);
		return new Response(`发生错误: ${error.message}`, { status: 500, headers: corsHeaders });
	}
});

// =================================================================================
// 提取路由: /extract 
// =================================================================================
router.post(/^\/extract$/, async ({ request, env }) => {
    try {
        const { extractionCode } = await request.json();
        if (!extractionCode) {
            return new Response('提取码不能为空。', { status: 400, headers: corsHeaders });
        }
        
        const clashFileId = `clash-${extractionCode}.yaml`;
        const singboxFileId = `singbox-${extractionCode}.json`;
        const genericFileId = `generic-${extractionCode}.txt`;
        
        const clashR2Key = `subs/${clashFileId}`;
        const singboxR2Key = `configs/${singboxFileId}`;

        const object = await env.SUB_STORE.head(clashR2Key);
        if (object === null) {
            return new Response('提取码无效或链接已过期。', { status: 404, headers: corsHeaders });
        }
        
        const urlBase = new URL(request.url).origin;
        const clashUrl = `${urlBase}/sub/${clashFileId}`;
        const singboxUrl = `${urlBase}/download/${singboxR2Key}`;
        const genericSubUrl = `${urlBase}/generic/${genericFileId}`;
        
        return new Response(JSON.stringify({ 
            success: true, 
            clashUrl: clashUrl,
            singboxUrl: singboxUrl,
            genericSubUrl: genericSubUrl,
        }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });

    } catch (e) {
        console.error('Extraction error:', e);
        return new Response(`发生错误: ${e.message}`, { status: 500, headers: corsHeaders });
    }
});


// =================================================================================
// GET 路由
// =================================================================================
router.get(/^\/generic\/(?<path>.+)$/, async ({ params, env }) => {
	const object = await env.SUB_STORE.get(`generic/${params.path}`);
	if (object === null) return new Response('Generic subscription not found.', { status: 404 });
	return new Response(object.body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'etag': object.httpEtag, ...corsHeaders } });
});

router.get(/^\/download\/(?<path>.+)$/, async ({ params, env }) => {
	const object = await env.SUB_STORE.get(params.path);
	if (object === null) return new Response('Object Not Found', { status: 404 });
	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set('etag', object.httpEtag);
	headers.set('Content-Disposition', `attachment; filename="${params.path.split('/').pop()}"`);
    for(const [key, value] of Object.entries(corsHeaders)) { headers.set(key, value); }
	return new Response(object.body, { headers });
});

router.get(/^\/sub\/(?<path>.+)$/, async ({ params, env, request }) => {
    const r2Key = `subs/${params.path}`;
    const object = await env.SUB_STORE.get(r2Key);
    if (object === null) return new Response('Subscription not found in R2.', { status: 404 });
    const configText = await object.text();
    const headers = new Headers({ 'Content-Type': 'text/plain; charset=utf-8', 'etag': object.httpEtag, ...corsHeaders });
    const expireTimestamp = object.expires ? Math.floor(object.expires.getTime() / 1000) : 0;
    headers.set('subscription-userinfo', `upload=0; download=0; total=107374182400; expire=${expireTimestamp}`);
    headers.set('profile-update-interval', '24');
    headers.set('profile-web-page-url', new URL(request.url).origin);
    return new Response(configText, { headers });
});

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

// =================================================================================
// Worker 入口点
// =================================================================================
export default {
	async fetch(request, env, ctx) {
		return router.handle(request, env, ctx);
	},
};

// =================================================================================
// 解析和生成逻辑 (省略以保持简洁，这部分无需修改)
// =================================================================================
function parseShareLink(link) {if (!link) return [];try {let decodedLink = link;if (!link.includes('://') && (link.length % 4 === 0) && /^[a-zA-Z0-9+/]*={0,2}$/.test(link)) {try { decodedLink = atob(link); } catch (e) { /* ignore */ }}if (decodedLink.startsWith('ss://')) return [parseShadowsocks(decodedLink)];if (decodedLink.startsWith('ssr://')) return [parseShadowsocksR(decodedLink)];if (decodedLink.startsWith('vless://')) return [parseVless(decodedLink)];if (decodedLink.startsWith('vmess://')) return [parseVmess(decodedLink)];if (decodedLink.startsWith('trojan://')) return [parseTrojan(decodedLink)];if (decodedLink.startsWith('tuic://')) return [parseTuic(decodedLink)];if (decodedLink.startsWith('hysteria2://')) return [parseHysteria2(decodedLink)];} catch (error) {console.warn(`Skipping invalid link: ${link.substring(0, 40)}...`, error.message);return [];}return [];}
function parseShadowsocks(link) {try{const url = new URL(link);const b64part = url.href.substring(5, url.href.indexOf('@'));const decoded = atob(b64part);const [cipher, password] = decoded.split(':');return {name: decodeURIComponent(url.hash).substring(1) || `${url.hostname}:${url.port}`,type: 'ss',server: url.hostname,port: parseInt(url.port, 10),cipher: cipher,password: password,udp: true};}catch(e){try{let newLink = "ss://" + atob(link.substring(5)); return parseShadowsocks(newLink);} catch(e2){return null;}}}
function parseShadowsocksR(link) {const decoded = atob(link.substring('ssr://'.length));const mainParts = decoded.split('/?');const [server, port, protocol, cipher, obfs, password_b64] = mainParts[0].split(':');const params = new URLSearchParams(mainParts[1] ? atob(mainParts[1]) : '');return {name: params.get('remarks') ? atob(params.get('remarks')) : `${server}:${port}`,type: 'ssr',server: server,port: parseInt(port, 10),cipher: cipher,password: atob(password_b64),protocol: protocol,'protocol-param': params.get('protoparam') ? atob(params.get('protoparam')) : '',obfs: obfs,'obfs-param': params.get('obfsparam') ? atob(params.get('obfsparam')) : '',udp: true};}
function parseVless(link) {const url = new URL(link);const params = url.searchParams;const proxy = {name: decodeURIComponent(url.hash).substring(1) || url.hostname,type: 'vless',server: url.hostname,port: parseInt(url.port, 10),uuid: url.username,network: params.get('type') || 'tcp',tls: params.get('security') === 'tls' || params.get('security') === 'reality',udp: true,flow: params.get('flow') || '','client-fingerprint': params.get('fp') || 'chrome',};if (proxy.tls) {proxy.servername = params.get('sni') || url.hostname;proxy.alpn = params.get('alpn') ? params.get('alpn').split(',') : ["h2", "http/1.1"];if (params.get('security') === 'reality') {proxy['reality-opts'] = { 'public-key': params.get('pbk'), 'short-id': params.get('sid') };}}if (proxy.network === 'ws') proxy['ws-opts'] = { path: params.get('path') || '/', headers: { Host: params.get('host') || url.hostname } };if (proxy.network === 'grpc') proxy['grpc-opts'] = { 'grpc-service-name': params.get('serviceName') || '' };return proxy;}
function parseVmess(link) {const jsonStr = atob(link.substring('vmess://'.length));const config = JSON.parse(jsonStr);return {name: config.ps || config.add, type: 'vmess', server: config.add, port: parseInt(config.port, 10),uuid: config.id, alterId: config.aid, cipher: config.scy || 'auto',tls: config.tls === 'tls', network: config.net || 'tcp', udp: true,servername: config.sni || undefined,'ws-opts': config.net === 'ws' ? { path: config.path || '/', headers: { Host: config.host || config.add } } : undefined,'h2-opts': config.net === 'h2' ? { path: config.path || '/', host: [config.host || config.add] } : undefined,'grpc-opts': config.net === 'grpc' ? { 'grpc-service-name': config.path || ''} : undefined,};}
function parseTrojan(link) {const url = new URL(link);const params = url.searchParams;return {name: decodeURIComponent(url.hash).substring(1) || url.hostname,type: 'trojan', server: url.hostname, port: parseInt(url.port, 10),password: url.username, udp: true, sni: params.get('sni') || url.hostname,servername: params.get('sni') || url.hostname,alpn: params.get('alpn') ? params.get('alpn').split(',') : ["h2", "http/1.1"],};}
function parseTuic(link) {const url = new URL(link);const params = url.searchParams;const [uuid, password] = url.username.split(':');return {name: decodeURIComponent(url.hash).substring(1) || url.hostname,type: 'tuic', server: url.hostname, port: parseInt(url.port, 10),uuid: uuid, password: password,servername: params.get('sni') || url.hostname,udp: true,'congestion-controller': params.get('congestion_control') || 'bbr','udp-relay-mode': params.get('udp_relay_mode') || 'native',alpn: params.get('alpn') ? params.get('alpn').split(',') : ["h3"],'disable-sni': params.get('disable_sni') === 'true',};}
function parseHysteria2(link) {const url = new URL(link);const params = url.searchParams;return {name: decodeURIComponent(url.hash).substring(1) || url.hostname,type: 'hysteria2', server: url.hostname, port: parseInt(url.port, 10),password: url.username,servername: params.get('sni') || url.hostname,udp: true,'skip-cert-verify': params.get('insecure') === '1' || params.get('skip_cert_verify') === 'true',obfs: params.get('obfs'),'obfs-password': params.get('obfs-password'),};}
function generateClashConfig(proxies) {const proxyNames = proxies.map(p => p.name);const config = {'port': 7890, 'socks-port': 7891, 'allow-lan': false,'mode': 'rule', 'log-level': 'info', 'external-controller': '127.0.0.1:9090','proxies': proxies,'proxy-groups': [{'name': 'PROXY', 'type': 'select', 'proxies': ['DIRECT', 'REJECT', ...proxyNames],}],'rules': ['DOMAIN-SUFFIX,google.com,PROXY', 'DOMAIN-SUFFIX,github.com,PROXY','DOMAIN-SUFFIX,youtube.com,PROXY', 'DOMAIN-SUFFIX,telegram.org,PROXY','GEOIP,CN,DIRECT', 'MATCH,PROXY',],};const serializeClash = (config) => {let out = "";const simpleDump = (key, val) => { if(val !== undefined) out += `${key}: ${val}\n`};simpleDump('port', config.port);simpleDump('socks-port', config['socks-port']);simpleDump('allow-lan', config['allow-lan']);simpleDump('mode', config.mode);simpleDump('log-level', config['log-level']);simpleDump('external-controller', config['external-controller']);out += "proxies:\n";for (const proxy of config.proxies) {out += "  - {";let first = true;for (const [k, v] of Object.entries(proxy)) {if (v === undefined) continue;if (!first) out += ", ";if (typeof v === 'object' && v !== null && !Array.isArray(v)) {out += `${k}: {${Object.entries(v).map(([sk, sv]) => `${sk}: ${JSON.stringify(sv)}`).join(', ')}}`;} else {out += `${k}: ${JSON.stringify(v)}`;}first = false;}out += "}\n";}out += "proxy-groups:\n";for(const group of config['proxy-groups']) {out += `- name: ${JSON.stringify(group.name)}\n  type: ${group.type}\n  proxies:\n`;for(const proxyName of group.proxies){out += `    - ${JSON.stringify(proxyName)}\n`;}}out += "rules:\n";for (const rule of config.rules) {out += `  - ${rule}\n`;}return out;};return serializeClash(config);}
function generateSingboxConfig(proxies) {const outbounds = proxies.map(clashProxy => {const {name, type, server, port, password, uuid, alterId, cipher,network, tls, udp, flow, 'client-fingerprint': fingerprint,servername, alpn, 'reality-opts': realityOpts,'ws-opts': wsOpts, 'grpc-opts': grpcOpts,'congestion-controller': congestion, 'udp-relay-mode': udpRelayMode,'skip-cert-verify': skipCertVerify, obfs, 'obfs-password': obfsPassword} = clashProxy;const singboxOutbound = {tag: name,type: type,server: server,server_port: parseInt(port, 10),};if (uuid) singboxOutbound.uuid = uuid;if (password) singboxOutbound.password = password;if (type === 'vless') {if (flow) singboxOutbound.flow = flow;}if (type === 'vmess') {singboxOutbound.alter_id = alterId;singboxOutbound.security = cipher || 'auto';}if (type === 'ssr') {singboxOutbound.method = cipher; singboxOutbound.protocol = clashProxy.protocol; singboxOutbound.protocol_param = clashProxy['protocol-param']; singboxOutbound.obfs = obfs; singboxOutbound.obfs_param = clashProxy['obfs-param'];}if (tls) {singboxOutbound.tls = {enabled: true,server_name: servername || server,alpn: alpn,insecure: skipCertVerify || false,};if (fingerprint) {singboxOutbound.tls.utls = { enabled: true, fingerprint: fingerprint };}if (realityOpts) {singboxOutbound.tls.reality = {enabled: true,public_key: realityOpts['public-key'],short_id: realityOpts['short-id'],};}}if(type === 'hysteria2') {if (obfs && obfsPassword) {singboxOutbound.obfs = { type: 'salamander', password: obfsPassword };}singboxOutbound.up_mbps = 20; singboxOutbound.down_mbps = 100;}if(type === 'tuic') {singboxOutbound.congestion_control = congestion;singboxOutbound.udp_relay_mode = udpRelayMode;singboxOutbound.version = 'v5';}if (network && network !== 'tcp') {singboxOutbound.transport = { type: network };if (network === 'ws' && wsOpts) {singboxOutbound.transport.path = wsOpts.path;if (wsOpts.headers && wsOpts.headers.Host) {singboxOutbound.transport.headers = { Host: wsOpts.headers.Host };}}if (network === 'grpc' && grpcOpts) {singboxOutbound.transport.service_name = grpcOpts['grpc-service-name'];}}return singboxOutbound;});outbounds.push({ type: 'selector', tag: 'PROXY', outbounds: proxies.map(p => p.name).concat(['DIRECT', 'REJECT']) },{ type: 'direct', tag: 'DIRECT' },{ type: 'block', tag: 'REJECT' },{ type: 'dns', tag: 'dns-out' });const config = {log: { level: "info", timestamp: true },inbounds: [{ type: "mixed", tag: "mixed-in", listen: "127.0.0.1", listen_port: 2080 }],outbounds: outbounds,route: {rules: [{ protocol: "dns", outbound: "dns-out" },{ geoip: ["cn"], outbound: "DIRECT" },{ domain_suffix: ["cn", "qq.com", "wechat.com"], outbound: "DIRECT" },{ outbound: "PROXY" }],auto_detect_interface: true},experimental: { clash_api: { external_controller: "127.0.0.1:9090", secret: "" } }};return JSON.stringify(config, null, 2);}

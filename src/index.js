/**
 * =================================================================================
 * 欢迎来到 Cloudflare Workers! (带通用订阅链接的最终版)
 * =================================================================================
 *
 * 【核心升级】:
 * 1. 【通用订阅】: 新增生成一个Base64编码的、包含所有原始节点链接的通用订阅文件，适用于V2RayN等客户端。
 * 2. 【新增路由】: 添加 /generic/... 路由，专门用于提供此通用订阅。
 * 3. 【API增强】: /extract 接口现在会一次性返回Clash, Sing-box, 和通用订阅三个链接。
 */

// =================================================================================
// 路由模块 (Simple Router)
// =================================================================================
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
		const { subscription_data, expirationDays } = await request.json();

		if (!subscription_data) {
			return new Response('Request body is empty or invalid.', { status: 400 });
		}

		const lines = subscription_data.split(/[\r\n]+/).filter(line => line.trim() !== '');
		let allProxies = [];
        let allShareLinks = []; // 【新增】用于收集所有有效的原始分享链接

		for (const line of lines) {
			if (line.startsWith('http://') || line.startsWith('https://')) {
				const response = await fetch(line);
				if (!response.ok) {
                    console.warn(`Failed to fetch subscription: ${line}, status: ${response.status}`);
                    continue;
                }
                const subContent = await response.text();
                let decodedContent;
                try {
                    decodedContent = atob(subContent);
                } catch (e) {
                    decodedContent = subContent;
                }
				const remoteLines = decodedContent.split(/[\r\n]+/).filter(l => l.trim() !== '');
				for (const remoteLine of remoteLines) {
					const proxies = await parseShareLink(remoteLine);
                    if (proxies.length > 0) {
					    allProxies.push(...proxies);
                        allShareLinks.push(remoteLine); // 收集远程订阅中的链接
                    }
				}
			} else {
				const proxies = await parseShareLink(line);
                if (proxies.length > 0) {
				    allProxies.push(...proxies);
                    allShareLinks.push(line); // 收集直接输入的链接
                }
			}
		}

		if (allProxies.length === 0) {
			return new Response('未找到有效的代理节点。请检查您的链接或订阅。', { status: 400 });
		}
		
		allProxies = allProxies.filter((proxy, index, self) =>
            proxy && proxy.name && index === self.findIndex((p) => p && p.name === proxy.name)
        );

		const clashConfig = generateClashConfig(allProxies);
		const singboxConfig = generateSingboxConfig(allProxies);
        // 【新增】生成通用订阅内容
        const genericSubContent = btoa(allShareLinks.join('\n'));
        
        const extractionCode = crypto.randomUUID();

        const clashFileId = `clash-${extractionCode}.yaml`;
        const singboxFileId = `singbox-${extractionCode}.json`;
        const genericFileId = `generic-${extractionCode}.txt`; // 通用订阅文件名

        const clashSubR2Key = `subs/${clashFileId}`;
		const singboxR2Key = `configs/${singboxFileId}`;
        const genericSubR2Key = `generic/${genericFileId}`; // 通用订阅存储路径
        
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

		return new Response(JSON.stringify({
			success: true,
            extractionCode: extractionCode,
		}), {
			headers: { 'Content-Type': 'application/json' },
		});

	} catch (error) {
		console.error('Conversion error:', error);
		return new Response(`发生错误: ${error.message}`, { status: 500 });
	}
});

// =================================================================================
// 提取路由: /extract 
// =================================================================================
router.post(/^\/extract$/, async ({ request, env }) => {
    try {
        const { extractionCode } = await request.json();
        if (!extractionCode) {
            return new Response('Extraction code is required.', { status: 400 });
        }
        
        const clashFileId = `clash-${extractionCode}.yaml`;
        const singboxFileId = `singbox-${extractionCode}.json`;
        const genericFileId = `generic-${extractionCode}.txt`;
        
        const clashR2Key = `subs/${clashFileId}`;
        const singboxR2Key = `configs/${singboxFileId}`;
        const genericR2Key = `generic/${genericFileId}`;

        const object = await env.SUB_STORE.head(clashR2Key);
        if (object === null) {
            return new Response('提取码无效或链接已过期。', { status: 404 });
        }
        
        const urlBase = new URL(request.url).origin;
        const clashUrl = `${urlBase}/sub/${clashFileId}`;
        const singboxUrl = `${urlBase}/download/${singboxR2Key}`;
        const genericSubUrl = `${urlBase}/generic/${genericFileId}`;
        
        return new Response(JSON.stringify({ 
            success: true, 
            clashUrl: clashUrl,
            singboxUrl: singboxUrl,
            genericSubUrl: genericSubUrl, // 【新增】返回通用订阅链接
        }), {
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (e) {
        console.error('Extraction error:', e);
        return new Response(`An error occurred: ${e.message}`, { status: 500 });
    }
});


// =================================================================================
// 新增路由: /generic (提供通用订阅)
// =================================================================================
router.get(/^\/generic\/(?<path>.+)$/, async ({ params, env }) => {
	const object = await env.SUB_STORE.get(`generic/${params.path}`);
	if (object === null) {
		return new Response('Generic subscription not found.', { status: 404 });
	}
	const headers = new Headers();
    // 直接返回纯文本，客户端会自行处理Base64
	headers.set('Content-Type', 'text/plain; charset=utf-8');
	headers.set('etag', object.httpEtag);
	return new Response(object.body, { headers });
});


// =================================================================================
// 下载和订阅路由
// =================================================================================
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


router.get(/^\/sub\/(?<path>.+)$/, async ({ params, env, request }) => {
    const r2Key = `subs/${params.path}`;
    const object = await env.SUB_STORE.get(r2Key);
    if (object === null) {
        return new Response('Subscription not found in R2.', { status: 404 });
    }
    const configText = await object.text();
    const headers = new Headers();
    headers.set('Content-Type', 'text/plain; charset=utf-8');
    headers.set('etag', object.httpEtag);
    const proxyCount = (configText.match(/name:/g) || []).length;
    const expireTimestamp = object.expires 
        ? Math.floor(object.expires.getTime() / 1000) 
        : Math.floor((Date.now() + 7 * 24 * 60 * 60 * 1000) / 1000);
    headers.set('subscription-userinfo', `upload=0; download=0; total=107374182400; expire=${expireTimestamp}`);
    headers.set('profile-update-interval', '24');
    headers.set('profile-web-page-url', new URL(request.url).origin);
    return new Response(configText, { headers });
});


// =================================================================================
// 静态资源服务 (Serving Static Assets)
// =================================================================================
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
// Worker 入口点 (Entry Point)
// =================================================================================
export default {
	async fetch(request, env, ctx) {
		return router.handle(request, env, ctx);
	},
};

// #################################################################################
//                          协议解析与配置生成模块 - 无需修改
// #################################################################################
async function parseShareLink(link) {if (!link) return [];try {let decodedLink = link;if (!link.includes('://') && (link.length % 4 === 0) && /^[a-zA-Z0-9+/]*={0,2}$/.test(link)) {try { decodedLink = atob(link); } catch (e) { /* ignore */ }}if (decodedLink.startsWith('vless://')) return [parseVless(decodedLink)];if (decodedLink.startsWith('vmess://')) return [parseVmess(decodedLink)];if (decodedLink.startsWith('trojan://')) return [parseTrojan(decodedLink)];if (decodedLink.startsWith('tuic://')) return [parseTuic(decodedLink)];if (decodedLink.startsWith('hysteria2://')) return [parseHysteria2(decodedLink)];} catch (error) {console.warn(`Skipping invalid link: ${link.substring(0, 40)}...`, error.message);return [];}return [];}
function parseVless(link) {const url = new URL(link);const params = url.searchParams;const proxy = {name: decodeURIComponent(url.hash).substring(1) || url.hostname,type: 'vless',server: url.hostname,port: parseInt(url.port, 10),uuid: url.username,network: params.get('type') || 'tcp',tls: params.get('security') === 'tls' || params.get('security') === 'reality',udp: true,flow: params.get('flow') || '','client-fingerprint': params.get('fp') || 'chrome',};if (proxy.tls) {proxy.servername = params.get('sni') || url.hostname;proxy.alpn = params.get('alpn') ? params.get('alpn').split(',') : ["h2", "http/1.1"];if (params.get('security') === 'reality') {proxy['reality-opts'] = { 'public-key': params.get('pbk'), 'short-id': params.get('sid') };}}if (proxy.network === 'ws') proxy['ws-opts'] = { path: params.get('path') || '/', headers: { Host: params.get('host') || url.hostname } };if (proxy.network === 'grpc') proxy['grpc-opts'] = { 'grpc-service-name': params.get('serviceName') || '' };return proxy;}
function parseVmess(link) {const jsonStr = atob(link.substring('vmess://'.length));const config = JSON.parse(jsonStr);return {name: config.ps || config.add, type: 'vmess', server: config.add, port: parseInt(config.port, 10),uuid: config.id, alterId: config.aid, cipher: config.scy || 'auto',tls: config.tls === 'tls', network: config.net || 'tcp', udp: true,servername: config.sni || undefined,'ws-opts': config.net === 'ws' ? { path: config.path || '/', headers: { Host: config.host || config.add } } : undefined,'h2-opts': config.net === 'h2' ? { path: config.path || '/', host: [config.host || config.add] } : undefined,'grpc-opts': config.net === 'grpc' ? { 'grpc-service-name': config.path || ''} : undefined,};}
function parseTrojan(link) {const url = new URL(link);const params = url.searchParams;return {name: decodeURIComponent(url.hash).substring(1) || url.hostname,type: 'trojan', server: url.hostname, port: parseInt(url.port, 10),password: url.username, udp: true, sni: params.get('sni') || url.hostname,servername: params.get('sni') || url.hostname,alpn: params.get('alpn') ? params.get('alpn').split(',') : ["h2", "http/1.1"],};}
function parseTuic(link) {const url = new URL(link);const params = url.searchParams;const [uuid, password] = url.username.split(':');return {name: decodeURIComponent(url.hash).substring(1) || url.hostname,type: 'tuic', server: url.hostname, port: parseInt(url.port, 10),uuid: uuid, password: password,servername: params.get('sni') || url.hostname,udp: true,'congestion-controller': params.get('congestion_control') || 'bbr','udp-relay-mode': params.get('udp_relay_mode') || 'native',alpn: params.get('alpn') ? params.get('alpn').split(',') : ["h3"],'disable-sni': params.get('disable_sni') === 'true',};}
function parseHysteria2(link) {const url = new URL(link);const params = url.searchParams;return {name: decodeURIComponent(url.hash).substring(1) || url.hostname,type: 'hysteria2', server: url.hostname, port: parseInt(url.port, 10),password: url.username,servername: params.get('sni') || url.hostname,udp: true,'skip-cert-verify': params.get('insecure') === '1' || params.get('skip_cert_verify') === 'true',obfs: params.get('obfs'),'obfs-password': params.get('obfs-password'),};}
function generateClashConfig(proxies) {const proxyNames = proxies.map(p => p.name);const config = {'port': 7890, 'socks-port': 7891, 'allow-lan': false,'mode': 'rule', 'log-level': 'info', 'external-controller': '127.0.0.1:9090','proxies': proxies,'proxy-groups': [{'name': 'PROXY', 'type': 'select', 'proxies': ['DIRECT', 'REJECT', ...proxyNames],}],'rules': ['DOMAIN-SUFFIX,google.com,PROXY', 'DOMAIN-SUFFIX,github.com,PROXY','DOMAIN-SUFFIX,youtube.com,PROXY', 'DOMAIN-SUFFIX,telegram.org,PROXY','GEOIP,CN,DIRECT', 'MATCH,PROXY',],};const serializeClash = (config) => {let out = "";const simpleDump = (key, val) => { if(val !== undefined) out += `${key}: ${val}\n`};simpleDump('port', config.port);simpleDump('socks-port', config['socks-port']);simpleDump('allow-lan', config['allow-lan']);simpleDump('mode', config.mode);simpleDump('log-level', config['log-level']);simpleDump('external-controller', config['external-controller']);out += "proxies:\n";for (const proxy of config.proxies) {out += "  - {\n";for (const [k, v] of Object.entries(proxy)) {if(v === undefined) continue;if (typeof v === 'object' && v !== null && !Array.isArray(v)) {out += `      ${k}: { `;out += Object.entries(v).map(([sk, sv]) => `${sk}: ${JSON.stringify(sv)}`).join(', ');out += ` },\n`;} else if (k === 'alpn' && Array.isArray(v)) {out += `      ${k}: [${v.map(i => JSON.stringify(i)).join(', ')}],\n`;}else {out += `      ${k}: ${JSON.stringify(v)},\n`;}}out = out.slice(0, -2) + "\n    }\n";}out += "proxy-groups:\n";for(const group of config['proxy-groups']) {out += `  - name: ${group.name}\n`;out += `    type: ${group.type}\n`;out += `    proxies:\n`;for(const proxyName of group.proxies){out += `      - ${proxyName}\n`;}}out += "rules:\n";for (const rule of config.rules) {out += `  - ${rule}\n`;}return out;}
	return serializeClash(config);}
function generateSingboxConfig(proxies) {const outbounds = proxies.map(clashProxy => {const {name, type, server, port, password, uuid, alterId, cipher,network, tls, udp, flow, 'client-fingerprint': fingerprint,servername, alpn, 'reality-opts': realityOpts,'ws-opts': wsOpts, 'grpc-opts': grpcOpts,'congestion-controller': congestion, 'udp-relay-mode': udpRelayMode,'skip-cert-verify': skipCertVerify, obfs, 'obfs-password': obfsPassword} = clashProxy;const singboxOutbound = {tag: name,type: type,server: server,server_port: parseInt(port, 10),};if (uuid) singboxOutbound.uuid = uuid;if (password) singboxOutbound.password = password;if (type === 'vless') {if (flow) singboxOutbound.flow = flow;}if (type === 'vmess') {singboxOutbound.alter_id = alterId;singboxOutbound.security = cipher || 'auto';}if (tls) {singboxOutbound.tls = {enabled: true,server_name: servername || server,alpn: alpn,insecure: skipCertVerify || false,};if (fingerprint) {singboxOutbound.tls.utls = { enabled: true, fingerprint: fingerprint };}if (realityOpts) {singboxOutbound.tls.reality = {enabled: true,public_key: realityOpts['public-key'],short_id: realityOpts['short-id'],};}}if(type === 'hysteria2') {if (obfs && obfsPassword) {singboxOutbound.obfs = { type: 'salamander', password: obfsPassword };}singboxOutbound.up_mbps = 20; singboxOutbound.down_mbps = 100;}if(type === 'tuic') {singboxOutbound.congestion_control = congestion;singboxOutbound.udp_relay_mode = udpRelayMode;singboxOutbound.version = 'v5';}if (network && network !== 'tcp') {singboxOutbound.transport = { type: network };if (network === 'ws' && wsOpts) {singboxOutbound.transport.path = wsOpts.path;if (wsOpts.headers && wsOpts.headers.Host) {singboxOutbound.transport.headers = { Host: wsOpts.headers.Host };}}if (network === 'grpc' && grpcOpts) {singboxOutbound.transport.service_name = grpcOpts['grpc-service-name'];}}return singboxOutbound;});outbounds.push({ type: 'selector', tag: 'PROXY', outbounds: proxies.map(p => p.name).concat(['DIRECT', 'REJECT']) },{ type: 'direct', tag: 'DIRECT' },{ type: 'block', tag: 'REJECT' },{ type: 'dns', tag: 'dns-out' });const config = {log: { level: "info", timestamp: true },inbounds: [{ type: "mixed", tag: "mixed-in", listen: "127.0.0.1", listen_port: 2080 }],outbounds: outbounds,route: {rules: [{ protocol: "dns", outbound: "dns-out" },{ geoip: ["cn"], outbound: "DIRECT" },{ domain_suffix: ["cn", "qq.com", "wechat.com"], outbound: "DIRECT" },{ outbound: "PROXY" }],auto_detect_interface: true},experimental: { clash_api: { external_controller: "127.0.0.1:9090", secret: "" } }};return JSON.stringify(config, null, 2);}

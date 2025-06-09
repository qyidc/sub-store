/**
 * =================================================================================
 * 欢迎来到 Cloudflare Workers! (带诊断标记的最终版)
 * =================================================================================
 *
 * 这是您订阅转换器应用的核心后端逻辑。
 * 它由 Cloudflare Workers 驱动，运行在全球边缘网络，具有高性能和低延迟的特点。
 *
 * 主要功能：
 * 1.  【静态网站托管】: 从 Cloudflare R2 存储桶中提供前端页面 (index.html, script.js 等)。
 * 2.  【API 接口】: 提供 `/convert` 接口，接收前端发来的转换请求。
 * 3.  【协议解析】: 解析多种主流的代理协议分享链接 (VLESS, VMess, Trojan, TUIC, Hysteria2)。
 * 4.  【订阅源处理】: 支持处理单个分享链接、多个链接，以及远程订阅地址(URL)。
 * 5.  【配置生成】: 生成 Clash 和 Sing-box 客户端兼容的标准化配置文件。
 * 6.  【文件存储】: 将生成的配置文件临时存入 R2 存储桶，并设置7天自动过期 (TTL)。
 * 7.  【链接提供】: 返回可供下载的配置文件链接，以及可以直接在客户端使用的 Clash 订阅链接。
 *
 * @see 官方文档: https://developers.cloudflare.com/workers/
 */

// =================================================================================
// 路由模块 (Simple Router)
// =================================================================================
// 这是一个轻量级的路由实现，用于根据请求的 URL 路径和方法，将其分发到不同的处理函数。
const Router = () => {
	// routes 数组用于存储所有已定义的路由规则。
	const routes = [];
	// add 方法用于向 routes 数组中添加一条新的路由规则。
	const add = (method, path, handler) => routes.push({ method, path, handler });

	// handle 方法是路由器的核心，它接收请求并进行处理。
	const handle = async (request, env, ctx) => {
		const url = new URL(request.url);
		for (const route of routes) {
			// 如果请求方法不匹配，则跳过此条规则。
			if (request.method !== route.method) continue;
			// 使用正则表达式匹配 URL 路径。
			const match = url.pathname.match(route.path);
			if (match) {
				// 如果匹配成功，提取路径参数（例如 /download/:key 中的 key）。
				const params = match.groups || {};
				// 调用该路由对应的处理函数，并传入请求相关的所有上下文。
				return await route.handler({ request, params, url, env, ctx });
			}
		}

		// 如果没有任何路由规则匹配成功，并且请求是 GET 方法，则尝试作为静态资源请求来处理。
		// 这是为了让 Worker 能够提供前端页面文件。
		if (request.method === 'GET') {
			return serveStaticAsset({ request, env });
		}

		// 如果以上所有情况都不匹配，则返回 404 Not Found。
		return new Response('Not Found', { status: 404 });
	};

	// 返回一个包含 get, post, handle 方法的对象，方便外部调用。
	return {
		get: (path, handler) => add('GET', path, handler),
		post: (path, handler) => add('POST', path, handler),
		handle,
	};
};


// 初始化路由器实例。
const router = Router();

// =================================================================================
// API 路由: /convert (核心转换逻辑)
// =================================================================================
/**
 * @description 处理对 /convert 的 POST 请求。
 * 这是整个应用的核心业务逻辑所在，负责接收用户输入，解析节点，生成配置，并返回结果。
 */
router.post(/^\/convert$/, async ({ request, env }) => {
	try {
		// 1. 获取并验证请求体
		const body = await request.text();
		if (!body) {
			return new Response('Request body is empty.', { status: 400 });
		}

		// 2. 解析输入内容
		// 按行分割输入，并过滤掉空行。
		const lines = body.split(/[\r\n]+/).filter(line => line.trim() !== '');
		let allProxies = []; // 用于存储所有解析出的代理节点对象。

		// 遍历每一行输入
		for (const line of lines) {
			// 如果是远程订阅链接 (http/https开头)
			if (line.startsWith('http://') || line.startsWith('https://')) {
                // 发起请求获取远程订阅内容
				const response = await fetch(line);
				if (!response.ok) {
                    // 如果获取失败，在后台记录警告，并继续处理下一行。
                    console.warn(`Failed to fetch subscription: ${line}, status: ${response.status}`);
                    continue;
                }
                const subContent = await response.text();
                
                // 尝试对订阅内容进行 Base64 解码。因为很多订阅源是整体 Base64 编码的。
                let decodedContent;
                try {
                    decodedContent = atob(subContent);
                } catch (e) {
                    // 如果解码失败，则认为它就是普通文本（每行一个分享链接）。
                    decodedContent = subContent;
                }

				// 将解码后的内容再次按行分割，并解析其中的每一个分享链接。
				const remoteLines = decodedContent.split(/[\r\n]+/).filter(l => l.trim() !== '');
				for (const remoteLine of remoteLines) {
					const proxies = await parseShareLink(remoteLine);
					allProxies.push(...proxies);
				}
			} else {
				// 如果不是远程订阅链接，则直接作为分享链接进行解析。
				const proxies = await parseShareLink(line);
				allProxies.push(...proxies);
			}
		}

		// 3. 后处理和验证
		if (allProxies.length === 0) {
			return new Response('未找到有效的代理节点。请检查您的链接或订阅。', { status: 400 });
		}
		
		// 根据节点名称进行去重，确保每个节点在配置中是唯一的。
		allProxies = allProxies.filter((proxy, index, self) =>
            proxy && proxy.name && index === self.findIndex((p) => p && p.name === proxy.name)
        );

		// 4. 生成配置文件内容
		const clashConfig = generateClashConfig(allProxies);
		const singboxConfig = generateSingboxConfig(allProxies);

		// 5. 将配置文件存入 R2 存储桶
		const fileId = crypto.randomUUID(); // 为本次转换生成一个唯一ID

        const clashSubId = `clash-${fileId}.yaml`; // 这是给URL用的，干净，不含路径
        const clashSubR2Key = `subs/${clashSubId}`; // 这是在R2中存储的完整Key，带文件夹

		const clashDownloadKey = `configs/clash-${fileId}.yaml`;
		const singboxKey = `configs/singbox-${fileId}.json`;
        
        // 设置7天的过期时间，到期后 Cloudflare 会自动删除这些文件。
        const expiration = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        // 将文件写入 R2
		await env.SUB_STORE.put(clashSubR2Key, clashConfig, {
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

        // 6. 构造并返回响应
        const urlBase = new URL(request.url).origin; // 获取当前 Worker 的基础URL (e.g., https://xxx.workers.dev)

		return new Response(JSON.stringify({
			success: true,
            // 使用干净的 clashSubId 构造 URL，确保URL是 `.../sub/clash-xxx.yaml`
            clashSubUrl: `${urlBase}/sub/${clashSubId}`, 
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

// =================================================================================
// 下载路由: /download/:path (提供文件下载)
// =================================================================================
/**
 * @description 处理对 /download/ 开头路径的 GET 请求。
 * 从 R2 中获取对应的文件并作为附件(包裹)提供给用户下载。
 */
router.get(/^\/download\/(?<path>.+)$/, async ({ params, env }) => {
	// params.path 会捕获 /download/ 之后的所有路径 (e.g., configs/clash-xxx.yaml)
	const object = await env.SUB_STORE.get(params.path);

	if (object === null) {
		return new Response('Object Not Found', { status: 404 });
	}

	const headers = new Headers();
	object.writeHttpMetadata(headers); // 将存储时设置的元数据(如ContentType)写入响应头
	headers.set('etag', object.httpEtag);
	
    // 【关键】设置 Content-Disposition 头，告诉浏览器这是一个需要下载的附件。
	const filename = params.path.split('/').pop();
	headers.set('Content-Disposition', `attachment; filename="${filename}"`);

	return new Response(object.body, { headers });
});

// =================================================================================
// 订阅路由: /sub/:path (为Clash等客户端提供订阅)
// =================================================================================
/**
 * @description 处理对 /sub/ 开头路径的 GET 请求。
 * 这是专门为 Clash 等客户端设计的订阅接口，它返回的是纯文本内容（信件）。
 */
router.get(/^\/sub\/(?<path>.+)$/, async ({ params, env, request }) => {
    // 根据URL路径 `.../sub/clash-xxx.yaml` 中的 `clash-xxx.yaml` 部分，
    // 重新构造出它在R2中实际的存储路径 `subs/clash-xxx.yaml`。
    const r2Key = `subs/${params.path}`;
    const object = await env.SUB_STORE.get(r2Key);

    if (object === null) {
        return new Response('Subscription not found', { status: 404 });
    }

    // 【解决1101错误的核心】
    // 对应“一次性电影票”的比喻：先把票上的信息（文件内容）抄到手上。
    // `object.text()` 会消耗掉文件的数据流，将其完整读入一个字符串变量中。
    const configText = await object.text();

    const headers = new Headers();
    
    // 【诊断标记】为响应添加一个自定义头部，用于判断部署的代码版本。
    headers.set('X-Worker-Version', '2025-06-09-FINAL-DEBUG');
    
    // object.writeHttpMetadata() 只是读取元数据，不会消耗数据流，是安全的。
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    
    // 【关键】这里绝对不能设置 `Content-Disposition: attachment` 头。
    // 我们要让Clash直接“读信”，而不是“收包裹”。
    
    // 为 Clash 客户端添加特定的订阅信息头，告知流量和过期时间等信息。
    // 我们在这里使用已经抄在手上的 `configText` 来统计节点，而不是去读第二次文件。
    const proxyCount = (configText.match(/name:/g) || []).length;
    headers.set('subscription-userinfo', `upload=0; download=0; total=107374182400; expire=${Math.floor(object.expires.getTime() / 1000)}`);
    headers.set('profile-update-interval', '24'); // 建议客户端24小时更新一次订阅
    headers.set('profile-web-page-url', new URL(request.url).origin);

    // 【解决1101错误的核心】
    // 最后，返回一个全新的响应，它的内容是我们早已抄在手上的 `configText` 字符串。
    // 这样就完全避免了重复读取原始数据流的问题。
    return new Response(configText, { headers });
});


// =================================================================================
// 静态资源服务 (Serving Static Assets)
// =================================================================================
/**
 * @description 作为 GET 请求的后备处理，用于从 R2 提供前端静态文件。
 */
async function serveStaticAsset({ request, env }) {
	const url = new URL(request.url);
	let key = url.pathname.slice(1); // 移除路径开头的 "/"
	if (key === '') key = 'index.html'; // 如果访问根路径，则提供 index.html

	const object = await env.SUB_STORE.get(key);
	if (object === null) return new Response(`Object Not Found: ${key}`, { status: 404 });

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set('etag', object.httpEtag);

    // 根据文件扩展名，手动设置正确的 Content-Type，确保浏览器能正确解析。
	if (key.endsWith('.html')) headers.set('Content-Type', 'text/html; charset=utf-8');
	else if (key.endsWith('.css')) headers.set('Content-Type', 'text/css; charset=utf-8');
	else if (key.endsWith('.js')) headers.set('Content-Type', 'application/javascript; charset=utf-8');

	return new Response(object.body, { headers });
}

// =================================================================================
// Worker 入口点 (Entry Point)
// =================================================================================
// 所有到此 Worker 的请求都会从这里开始处理。
export default {
	async fetch(request, env, ctx) {
		// 将请求交给路由器去处理。
		return router.handle(request, env, ctx);
	},
};

// #################################################################################
//                          协议解析与配置生成模块 (无需修改)
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

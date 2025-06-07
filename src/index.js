export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        // Log every incoming request to the worker for debugging routing issues
        console.log(`Worker received request: ${request.method} ${url.href}`);

        try {
            if (request.method === 'POST' && url.pathname === '/api/generate') {
                return await handleGenerateSubscription(request, env);
            }

            if (request.method === 'GET' && url.pathname.startsWith('/sub/')) {
                return await handleServeSubscription(url, env);
            }

            if (request.method === 'GET' && env.R2_STATIC_ASSETS) {
                let path = url.pathname;
                if (path === '/' |
| path === '') path = '/index.html'; // Default document for root path
                const objectKey = path.substring(1);

                const object = await env.R2_STATIC_ASSETS.get(objectKey);
                if (object === null) {
                    console.log(`Static asset not found by Worker: R2 Key='${objectKey}' from URL='${url.pathname}'`);
                    return new Response(JSON.stringify({ error: `静态资源未找到: ${objectKey}`, details: `Static asset not found by Worker: ${objectKey}` }), {
                        status: 404, headers: { 'Content-Type': 'application/json;charset=UTF-8' }
                    });
                }
                const headers = new Headers();
                object.writeHttpMetadata(headers);
                headers.set('etag', object.httpEtag);
                // Determine content type based on file extension
                if (objectKey.endsWith('.html')) headers.set('Content-Type', 'text/html;charset=UTF-8');
                else if (objectKey.endsWith('.js')) headers.set('Content-Type', 'application/javascript;charset=UTF-8');
                else if (objectKey.endsWith('.css')) headers.set('Content-Type', 'text/css;charset=UTF-8');
                else if (objectKey.endsWith('.json')) headers.set('Content-Type', 'application/json;charset=UTF-8');
                else if (objectKey.endsWith('.txt')) headers.set('Content-Type', 'text/plain;charset=UTF-8');

                return new Response(object.body, { headers });
            }

            // If no specific route inside the worker matched
            console.log(`Route not matched by Worker's internal logic: ${url.pathname}`);
            return new Response(JSON.stringify({ error: '请求的路径未被Worker内部逻辑处理', details: `Route not handled by Worker's internal logic: ${url.pathname}` }), {
                status: 404, headers: { 'Content-Type': 'application/json;charset=UTF-8' }
            });

        } catch (err) {
            const errorResponsePayload = {
                error: '服务器内部发生意外错误',
                details: err.message |
| '未知错误 (Unknown error)',
                stack: err.stack? err.stack.split('\n').slice(0, 7).join('\n') : '无可用堆栈信息 (No stack available)'
            };
            console.error("全局Worker错误 (Global Worker Error):", err.stack |
| err.message |
| err);
            return new Response(JSON.stringify(errorResponsePayload), {
                status: 500,
                headers: { 'Content-Type': 'application/json;charset=UTF-8' },
            });
        }
    },
};

async function handleGenerateSubscription(request, env) {
    try {
        const { links =, remoteSubs = } = await request.json();
        if ((!links ||!Array.isArray(links) |
| links.length === 0) &&
            (!remoteSubs ||!Array.isArray(remoteSubs) |
| remoteSubs.length === 0)) {
            return new Response(JSON.stringify({ error: '无效的输入', details: '需要提供节点链接数组或远程订阅链接数组 (Input requires an array of node links or remote subscription links)' }), {
                status: 400, headers: { 'Content-Type': 'application/json;charset=UTF-8' },
            });
        }

        const proxies =;

        // 处理本地/直接提供的节点链接
        for (const link of links) {
            if (!link |
| typeof link!== 'string' ||!link.trim()) continue;
            const trimmedLine = link.trim();
            console.log(`尝试解析本地链接: ${trimmedLine.substring(0, 100)}`);
            let proxyConfig = null;
            if (trimmedLine.startsWith('ss://')) proxyConfig = parseSS(trimmedLine);
            else if (trimmedLine.startsWith('vmess://')) proxyConfig = parseVmess(trimmedLine);
            else if (trimmedLine.startsWith('vless://')) proxyConfig = parseVless(trimmedLine);
            else if (trimmedLine.startsWith('trojan://')) proxyConfig = parseTrojan(trimmedLine);
            else if (trimmedLine.startsWith('tuic://')) proxyConfig = parseTuic(trimmedLine);
            else if (trimmedLine.startsWith('hysteria2://') |
| trimmedLine.startsWith('hy2://')) proxyConfig = parseHysteria2(trimmedLine);

            if (proxyConfig) {
                proxies.push(proxyConfig);
                console.log(`成功解析本地链接: ${trimmedLine.substring(0, 50)}`);
            } else {
                console.warn(`无法解析或不支持的本地链接格式: ${trimmedLine.substring(0, 100)}...`);
            }
        }

        // 处理远程订阅链接
        for (const subUrl of remoteSubs) {
            if (!subUrl |
| typeof subUrl!== 'string' ||!subUrl.trim()) continue;
            try {
                console.log(`开始请求远程订阅链接: ${subUrl}`);
                const response = await fetch(subUrl, { headers: { 'User-Agent': 'ClashCompatibleClient/1.0' } }); // Added User-Agent
                if (!response.ok) {
                    throw new Error(`Failed to fetch subscription from ${subUrl}: ${response.status} ${response.statusText}`);
                }
                const subscriptionContent = await response.text();
                console.log(`成功获取远程订阅内容，前 200 字符: ${subscriptionContent.substring(0, 200)}`);

                let decodedContent;
                try {
                    decodedContent = atob(subscriptionContent);
                    console.log('远程订阅内容尝试 Base64 解码成功，使用解码后内容。前 200 字符:', decodedContent.substring(0, 200));
                } catch (e) {
                    decodedContent = subscriptionContent;
                    console.log('远程订阅内容 Base64 解码失败或内容非 Base64，使用原始内容。前 200 字符:', decodedContent.substring(0, 200));
                }

                const lines = decodedContent.split(/[\r\n]+/); // Split by newline, handling both \n and \r\n
                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (!trimmedLine) continue;
                    console.log(`尝试解析远程订阅中的链接: ${trimmedLine.substring(0, 100)}`);
                    let proxyConfig = null;
                    if (trimmedLine.startsWith('ss://')) proxyConfig = parseSS(trimmedLine);
                    else if (trimmedLine.startsWith('vmess://')) proxyConfig = parseVmess(trimmedLine);
                    else if (trimmedLine.startsWith('vless://')) proxyConfig = parseVless(trimmedLine);
                    else if (trimmedLine.startsWith('trojan://')) proxyConfig = parseTrojan(trimmedLine);
                    else if (trimmedLine.startsWith('tuic://')) proxyConfig = parseTuic(trimmedLine);
                    else if (trimmedLine.startsWith('hysteria2://') |
| trimmedLine.startsWith('hy2://')) proxyConfig = parseHysteria2(trimmedLine);

                    if (proxyConfig) {
                        proxies.push(proxyConfig);
                        console.log(`成功解析远程订阅中的链接: ${trimmedLine.substring(0, 50)}`);
                    } else {
                        console.warn(`无法解析或不支持的远程订阅链接格式: ${trimmedLine.substring(0, 100)}...`);
                    }
                }
            } catch (e) {
                console.error(`处理远程订阅 ${subUrl} 时出错:`, e.message, e.stack);
            }
        }

        if (proxies.length === 0) {
            console.log('未找到有效节点，links 数量:', links.length, 'remoteSubs 数量:', remoteSubs.length);
            return new Response(JSON.stringify({ error: '没有可用的有效节点 (No valid nodes available)', details: '未能从输入中解析出任何有效节点配置 (Failed to parse any valid node configuration from input)' }), {
                status: 400, headers: { 'Content-Type': 'application/json;charset=UTF-8' },
            });
        }

        const clashConfigYaml = generateFullClashConfig(proxies); // Removed env from here

        if (!env.R2_SUBS_BUCKET) {
            console.error('R2_SUBS_BUCKET is not bound in worker environment for generation.');
            return new Response(JSON.stringify({ error: '服务器配置错误 (Server configuration error)', details: 'R2订阅存储桶未绑定 (R2_SUBS_BUCKET not bound for generation)' }), {
                status: 500, headers: { 'Content-Type': 'application/json;charset=UTF-8' }
            });
        }

        const subId = crypto.randomUUID();
        const subKey = `subs/${subId}.yaml`;

        await env.R2_SUBS_BUCKET.put(subKey, clashConfigYaml, {
            httpMetadata: {
                contentType: 'text/plain; charset=utf-8',
                // cacheControl: 'public, max-age=3600', // Optional: cache on CDN for 1 hour
            },
            customMetadata: { // Optional
                createdAt: new Date().toISOString(),
                sourceLinksCount: links.length,
                sourceRemoteSubsCount: remoteSubs.length,
                proxiesGenerated: proxies.length.toString()
            }
        });

        const requestUrl = new URL(request.url);
        const subscriptionUrl = `${requestUrl.protocol}//${requestUrl.host}/sub/${subId}`;

        return new Response(JSON.stringify({
            message: '订阅生成成功 (Subscription generated successfully)',
            subscriptionId: subId,
            subscriptionUrl: subscriptionUrl,
            proxiesFound: proxies.length,
            // firstTenProxies: proxies.slice(0, 10).map(p => ({ name: p.name, type: p.type, server: p.server })) // For debugging
        }), {
            status: 200, headers: { 'Content-Type': 'application/json;charset=UTF-8' },
        });

    } catch (e) {
        console.error("处理生成订阅时出错 (Error in handleGenerateSubscription):", e.message, e.stack);
        return new Response(JSON.stringify({
            error: '生成订阅过程中发生内部错误 (Internal error during subscription generation)',
            details: e.message,
            stack: e.stack? e.stack.split('\n').slice(0, 5).join('\n') : 'No stack'
        }), {
            status: 500, headers: { 'Content-Type': 'application/json;charset=UTF-8' },
        });
    }
}

async function handleServeSubscription(url, env) {
    const subId = url.pathname.substring('/sub/'.length);
    if (!subId) {
        return new Response(JSON.stringify({ error: '无效的订阅ID (Invalid subscription ID)', details: 'Subscription ID is missing or invalid' }), {
            status: 400, headers: { 'Content-Type': 'application/json;charset=UTF-8' }
        });
    }
    const subKey = `subs/${subId}.yaml`;

    if (!env.R2_SUBS_BUCKET) {
        console.error('R2_SUBS_BUCKET is not bound in worker environment for serving.');
        return new Response(JSON.stringify({ error: '服务器配置错误 (Server configuration error)', details: 'R2订阅存储桶未绑定 (R2_SUBS_BUCKET not bound)' }), {
            status: 500, headers: { 'Content-Type': 'application/json;charset=UTF-8' }
        });
    }

    const object = await env.R2_SUBS_BUCKET.get(subKey);

    if (object === null) {
        return new Response(JSON.stringify({ error: '订阅未找到或已过期 (Subscription not found or expired)', details: `Subscription with ID ${subId} not found.` }), {
            status: 404, headers: { 'Content-Type': 'application/json;charset=UTF-8' }
        });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    // Ensure correct Clash subscription headers
    headers.set('Content-Type', 'text/plain; charset=utf-8'); // Crucial for Clash
    headers.set('Profile-Update-Interval', '86400'); // 24 hours
    headers.set('Subscription-Userinfo', `upload=0; download=0; total=10737418240000000; expire=${Math.floor(Date.now() / 1000) + 86400 * 365}`); // Mock userinfo, expires in 1 year

    // Add other headers that might be useful for clients or prevent caching issues
    headers.set('Content-Disposition', 'inline; filename="clash_config.yaml"'); // Suggest filename
    headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    headers.set('Pragma', 'no-cache');
    headers.set('Expires', '0');

    return new Response(object.body, { headers });
}

// --- Protocol Parsers (largely unchanged, ensure they are robust) ---
function parseSS(link) {
    try {
        const url = new URL(link);
        const name = url.hash? decodeURIComponent(url.hash.substring(1)) : `SS-${url.hostname}:${url.port}`;
        let userInfo = '';
        if (url.username && url.password) { // Standard: ss://method:password@server:port
            userInfo = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
        } else if (url.username) { // Common: ss://base64(method:password)@server:port or ss://method@server:port (empty pass)
            try {
                const decodedUserInfo = atob(url.username); // Try decoding username as base64(method:password)
                if (decodedUserInfo.includes(':')) {
                    userInfo = decodedUserInfo;
                } else { // If not base64 or decoded doesn't have ':', assume url.username is method, password might be empty or in fragment
                    userInfo = decodeURIComponent(url.username); // Fallback to username as method, password might be empty
                }
            } catch (e) { // atob failed, assume url.username is "method" or "method:password" (not base64)
                userInfo = decodeURIComponent(url.username);
            }
        }

        const [method, password_val = ''] = userInfo.split(':', 2);
        if (!method) { console.warn(`SS: missing method - ${link.substring(0, 50)}`); return null; }
        return { name, type: 'ss', server: url.hostname, port: parseInt(url.port), cipher: method, password: password_val, udp: true };
    } catch (e) { console.error(`SS解析失败: ${link.substring(0, 50)} - ${e.message}`); return null; }
}

function parseVmess(link) {
    try {
        const b64Config = link.substring('vmess://'.length);
        if (!b64Config) throw new Error("VMess: link content empty");
        const jsonConfigStr = atob(b64Config);
        const vmessConfig = JSON.parse(jsonConfigStr);
        if (!vmessConfig.add ||!vmessConfig.id) { console.warn(`VMess: missing server or uuid - ${link.substring(0, 50)}`); return null; }
        const proxy = {
            name: vmessConfig.ps |
| `VMess-${vmessConfig.add}:${vmessConfig.port}`, type: 'vmess', server: vmessConfig.add, port: parseInt(vmessConfig.port),
            uuid: vmessConfig.id, alterId: parseInt(vmessConfig.aid |
| '0'), cipher: vmessConfig.scy |
| 'auto', tls: vmessConfig.tls === 'tls', udp: true,
            network: vmessConfig.net |
| 'tcp',
        };
        if (proxy.tls) {
            proxy.servername = vmessConfig.sni |
| vmessConfig.host |
| vmessConfig.add;
            if (vmessConfig.allowInsecure === true |
| String(vmessConfig.allowInsecure) === 'true' |
| vmessConfig.skipVerify === true |
| String(vmessConfig.skipVerify) === 'true') proxy['skip-cert-verify'] = true;
            if (vmessConfig.fp) proxy['client-fingerprint'] = vmessConfig.fp;
        }
        if (vmessConfig.net === 'ws') {
            proxy['ws-opts'] = { path: vmessConfig.path |
| '/', headers: { Host: vmessConfig.host |
| vmessConfig.add } };
            if (vmessConfig.wsHeaders && typeof vmessConfig.wsHeaders === 'object') proxy['ws-opts'].headers = {...proxy['ws-opts'].headers,...vmessConfig.wsHeaders };
        } else if (vmessConfig.net === 'tcp' && vmessConfig.type === 'http') { // HTTP Obfuscation
            proxy['tcp-opts'] = { header: { type: "http", request: vmessConfig.request, response: vmessConfig.response } };
        } else if (vmessConfig.net === 'h2') {
            proxy['h2-opts'] = { path: vmessConfig.path |
| '/', host: Array.isArray(vmessConfig.host)? vmessConfig.host : [vmessConfig.host |
| vmessConfig.add].filter(Boolean) };
        } else if (vmessConfig.net === 'grpc') {
            proxy['grpc-opts'] = { 'grpc-service-name': vmessConfig.path |
| vmessConfig.serviceName |
| '' };
            if (vmessConfig.mode === 'multi') proxy['grpc-opts']['grpc-mode'] = 'multi';
        }
        return proxy;
    } catch (e) { console.error(`VMess解析失败: ${link.substring(0, 50)} - ${e.message}`); return null; }
}

function parseVless(link) {
    try {
        const url = new URL(link);
        const name = url.hash? decodeURIComponent(url.hash.substring(1)) : `VLESS-${url.hostname}:${url.port}`;
        const params = url.searchParams;
        if (!url.username) { console.warn(`VLESS: missing uuid - ${link.substring(0, 50)}`); return null; }
        const proxy = {
            name, type: 'vless', server: url.hostname, port: parseInt(url.port), uuid: url.username, udp: true,
            tls: params.get('security') === 'tls' |
| params.get('security') === 'xtls', network: params.get('type') |
| 'tcp',
            flow: params.get('flow') |
| '', // Keep flow, even if not xtls, Clash might use it
        };
        if (proxy.tls) {
            proxy.servername = params.get('sni') |
| url.hostname;
            if (params.get('fp')) proxy['client-fingerprint'] = params.get('fp');
            if (params.get('alpn')) proxy.alpn = params.get('alpn').split(',').map(s => s.trim()).filter(Boolean);
            if (params.get('allowInsecure') === '1' |
| params.get('allowInsecure') === 'true') proxy['skip-cert-verify'] = true;
            // XTLS specific flow is usually set with security=xtls
            if (params.get('security') === 'xtls' &&!proxy.flow) proxy.flow = 'xtls-rprx-vision'; // Default for xtls if not specified
            if (params.get('pbk')) proxy.publicKey = params.get('pbk'); // REALITY
            if (params.get('sid')) proxy.shortId = params.get('sid'); // REALITY
        }
        if (proxy.network === 'ws') {
            proxy['ws-opts'] = { path: params.get('path') |
| '/', headers: { Host: params.get('host') |
| url.hostname } };
            if (params.get('maxEarlyData') && params.get('earlyDataHeaderName')) {
                proxy['ws-opts']['max-early-data'] = parseInt(params.get('maxEarlyData'));
                proxy['ws-opts']['early-data-header-name'] = params.get('earlyDataHeaderName');
            }
        } else if (proxy.network === 'grpc') {
            proxy['grpc-opts'] = { 'grpc-service-name': params.get('serviceName') |
| params.get('path') |
| '' };
            if (params.get('mode') === 'multi' |
| params.get('gunMode') === 'multi') proxy['grpc-opts']['grpc-mode'] = 'multi'; // gunMode for some clients
        } else if (proxy.network === 'h2') {
            proxy['h2-opts'] = { path: params.get('path') |
| '/', host: params.get('host')? params.get('host').split(',').map(s => s.trim()).filter(Boolean) : [url.hostname].filter(Boolean) };
        }
        return proxy;
    } catch (e) { console.error(`VLESS解析失败: ${link.substring(0, 50)} - ${e.message}`); return null; }
}

function parseTrojan(link) {
    try {
        const url = new URL(link);
        const name = url.hash? decodeURIComponent(url.hash.substring(1)) : `Trojan-${url.hostname}:${url.port}`;
        const params = url.searchParams;
        const password = url.password |
| url.username; // password can be in username field if no colon in userinfo
        if (!password) { console.warn(`Trojan: missing password - ${link.substring(0, 50)}`); return null; }
        const proxy = {
            name, type: 'trojan', server: url.hostname, port: parseInt(url.port), password, udp: true,
            sni: params.get('sni') |
| params.get('peer') |
| url.hostname,
        };
        if (params.get('allowInsecure') === '1' |
| params.get('skip-cert-verify') === '1' |
| params.get('allowInsecure') === 'true') proxy['skip-cert-verify'] = true;
        if (params.get('alpn')) proxy.alpn = params.get('alpn').split(',').map(s => s.trim()).filter(Boolean);
        if (params.get('type') === 'ws' |
| params.get('network') === 'ws' |
| params.get('ws') === '1') { // Check 'ws' param too
            proxy.network = 'ws';
            proxy['ws-opts'] = { path: params.get('path') |
| params.get('wsPath') |
| '/', headers: { Host: params.get('host') |
| params.get('wsHost') |
| url.hostname } };
        }
        // Trojan over gRPC (less common but possible)
        if (params.get('type') === 'grpc' |
| params.get('network') === 'grpc') {
            proxy.network = 'grpc';
            proxy['grpc-opts'] = { 'grpc-service-name': params.get('serviceName') |
| params.get('path') |
| '' };
        }
        return proxy;
    } catch (e) { console.error(`Trojan解析失败: ${link.substring(0, 50)} - ${e.message}`); return null; }
}

function parseTuic(link) { // TUIC v5 format
    try {
        const url = new URL(link);
        const name = url.hash? decodeURIComponent(url.hash.substring(1)) : `TUIC-${url.hostname}:${url.port}`;
        const params = url.searchParams;
        // TUIC v5: tuic://uuid:password@host:port?sni=example.com...
        // Older TUIC (v4 or client variations) might just use token in password field.
        let uuid_val = url.username;
        let password_val = url.password |
| '';

        if (!uuid_val && url.password) { // If username is empty but password is not, some clients put token in password
            uuid_val = url.password; // Treat password as token/uuid
            password_val = ''; // No separate password
        } else if (url.username &&!url.password && url.username.includes(':')) {
             // This case is already handled by URL parser if format is user:pass@
             // but if it's just user@ and user contains ':', it's ambiguous.
             // Let's assume standard parsing is okay for user:pass.
        }


        if (!uuid_val) { console.warn(`TUIC: missing uuid/token - ${link.substring(0, 50)}`); return null; }

        const proxy = {
            name, type: 'tuic', server: url.hostname, port: parseInt(url.port),
            // For TUIC v5, 'token' is the primary identifier, not uuid. Clash uses 'token'.
            // If 'uuid' is present from link, map it to 'token'. If 'password' is also present, it's the actual password.
            token: uuid_val, // Assuming uuid from link is the token for Clash
            password: password_val,
            sni: params.get('sni') |
| url.hostname,
            'congestion-controller': params.get('congestion_control') |
| params.get('congestion-controller') |
| 'bbr',
            'udp-relay-mode': params.get('udp_relay_mode') |
| params.get('udp-relay-mode') |
| params.get('uot') |
| 'native', // uot is another name
            alpn: params.get('alpn')? params.get('alpn').split(',').map(s => s.trim()).filter(Boolean) : ['h3'], // Default h3 for TUIC
        };
        if (params.get('allow_insecure') === '1' |
| params.get('skip-cert-verify') === '1' |
| params.get('allow_insecure') === 'true') proxy['skip-cert-verify'] = true;
        if (params.get('disable_sni') === 'true') proxy.sni = ''; // Disable SNI by setting it to empty
        if (params.get('reduce-rtt') === 'true') proxy['reduce-rtt'] = true;
        if (params.get('fast-open') === 'true') proxy['tcp-fast-open'] = true; // Map to tcp-fast-open
        if (params.get('heartbeat-interval')) proxy['heartbeat-interval'] = parseInt(params.get('heartbeat-interval'));


        return proxy;
    } catch (e) { console.error(`TUIC解析失败: ${link.substring(0, 50)} - ${e.message}`); return null; }
}

function parseHysteria2(link) {
    try {
        const url = new URL(link); // Handles hy2:// and hysteria2://
        const name = url.hash? decodeURIComponent(url.hash.substring(1)) : `Hy2-${url.hostname}:${url.port}`;
        const params = url.searchParams;
        const password = url.password |
| url.username; // Password is in userinfo part
        if (!password) { console.warn(`Hysteria2: missing password - ${link.substring(0, 50)}`); return null; }

        const proxy = {
            name, type: 'hysteria2', server: url.hostname, port: parseInt(url.port), password,
            sni: params.get('sni') |
| url.hostname, // SNI is crucial
        };

        if (params.get('insecure') === '1' |
| params.get('skip-cert-verify') === 'true' |
| params.get('allowInsecure') === 'true') proxy['skip-cert-verify'] = true;

        if (params.get('obfs')) {
            proxy.obfs = params.get('obfs'); // e.g., 'salamander'
            proxy['obfs-password'] = params.get('obfs-password') |
| params.get('obfs_password') |
| '';
        }

        // Bandwidth settings (up/down)
        // Clash expects format like "100 Mbps" or "10 Gbps"
        if (params.get('upmbps')) proxy.up = `${params.get('upmbps')} Mbps`;
        else if (params.get('up')) proxy.up = params.get('up'); // Allow direct specification e.g., "50 Mbps"

        if (params.get('downmbps')) proxy.down = `${params.get('downmbps')} Mbps`;
        else if (params.get('down')) proxy.down = params.get('down');

        if (params.get('alpn')) proxy.alpn = params.get('alpn').split(',').map(s => s.trim()).filter(Boolean);

        return proxy;
    } catch (e) { console.error(`Hysteria2解析失败: ${link.substring(0, 50)} - ${e.message}`); return null; }
}


// --- YAML Generation ---
function generateFullClashConfig(proxies) { // Removed env, not used
    const proxyNames = proxies.map((p, i) => p.name |
| `${p.type |
| 'Proxy'}-${i}`).filter((value, index, self) => self.indexOf(value) === index);

    function escapeYamlString(str) {
        if (typeof str!== 'string') return String(str);
        // More robust escaping for YAML: handle quotes, newlines, and other special chars
        if (str.includes('"') |
| str.includes('\n') |
| str.includes(': ') |
| str.includes('# ') |
| str.startsWith('- ') |
| str.startsWith('*') |
| str.startsWith('&') |
| str.startsWith('!') |
| str.startsWith('%') |
| str.startsWith('@') |
| str.startsWith('`')) {
             // If it contains double quotes or newlines, use double-quoted literal style with escaped internal quotes and newlines
            return `"${str.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
        }
        // If it looks like a number, boolean, or null, but should be a string, quote it
        if (/^(true|false|null|yes|no|on|off)$/i.test(str) |
| /^[0-9]+(\.[0-9]+)?$/.test(str)) {
            return `"${str}"`;
        }
        return str; // Return as is if no special handling needed
    }


    function objectToYamlParts(obj, baseIndent) {
        const parts =;
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                const value = obj[key];
                let valueStr;
                if (typeof value === 'string') {
                    valueStr = escapeYamlString(value);
                } else if (typeof value === 'boolean' |
| typeof value === 'number') {
                    valueStr = value.toString();
                } else if (Array.isArray(value)) {
                    if (value.length === 0) valueStr = ''; // Empty array
                    else valueStr = `\n${value.map(item => `${baseIndent}  - ${escapeYamlString(item)}`).join('\n')}`;
                } else if (typeof value === 'object' && value!== null) {
                    const nestedParts = objectToYamlParts(value, baseIndent + '  ');
                    valueStr = nestedParts.length === 0? '{}' : `\n${nestedParts.join('\n')}`; // Empty object
                } else if (value === null) {
                    valueStr = 'null';
                } else continue; // Skip undefined or other types
                parts.push(`${baseIndent}${key}: ${valueStr}`);
            }
        }
        return parts;
    }

    let proxiesYaml = proxies.map((p_orig, index) => {
        const p = {...p_orig };
        p.name = p.name |
| `${p.type |
| 'Proxy'}-${index}`;
        // Ensure name is properly escaped for the initial - name: field
        let parts =;
        const { name: _,...otherFields } = p; // Exclude name from otherFields
        parts.push(...objectToYamlParts(otherFields, '    ')); // Indent for other fields
        return parts.join('\n');
    }).join('\n\n');


    const uniqueProxyNamesForGroup = proxyNames.length > 0? proxyNames :; // Fallback if no proxies
    const proxyGroupItems = uniqueProxyNamesForGroup.map(name => `      - ${escapeYamlString(name)}`).join('\n');

    // Default proxy groups and rules
    const groupsAndRules = `
proxy-groups:
  - name: "🔰 PROXY"
    type: select
    proxies:
${proxyGroupItems}
      - DIRECT
      - REJECT
  - name: "🎯 Auto"
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 150
    proxies:
${proxyGroupItems}
  - name: "🌍 Global"
    type: select
    proxies:
      - "🔰 PROXY"
      - "🎯 Auto"
      - DIRECT
rules:
  - GEOIP,CN,DIRECT
  - GEOSITE,CN,DIRECT
  - GEOSITE,PRIVATE,DIRECT
  - MATCH,🔰 PROXY`; // Default to PROXY group

    return `port: 7890
socks-port: 7891
allow-lan: true
mode: rule
log-level: info
external-controller: '0.0.0.0:9090'
dns:
  enable: true
  listen: 0.0.0.0:5353
  ipv6: false
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  nameserver:
    - 223.5.5.5
    - 119.29.29.29
    - 1.1.1.1
    - https://doh.pub/dns-query
    - https://dns.alidns.com/dns-query
  fallback:
    - 8.8.8.8
    - tls://1.0.0.1:853
    - tls://dns.google:853
  fallback-filter:
    geoip: true
    geoip-code: CN
proxies:
${proxiesYaml}
${groupsAndRules}`;
}

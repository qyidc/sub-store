import { parseRemoteSubscription, mergeProxies } from './utils.js';

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        console.log(`Worker received request: ${request.method} ${url.href}`);

        try { 
            if (request.method === 'POST' && url.pathname === '/api/generate') {
                return await handleGenerateSubscription(request, env, ctx);
            }

            if (request.method === 'GET' && url.pathname.startsWith('/sub/')) {
                return await handleServeSubscription(url, env);
            }
            
            // 静态文件服务
            if (request.method === 'GET' && env.R2_STATIC_ASSETS) {
                return await handleStaticAssets(url, env);
            }

            return new Response(JSON.stringify({ error: '请求的路径未被处理' }), { 
                status: 404, headers: { 'Content-Type': 'application/json;charset=UTF-8' } 
            });

        } catch (err) {
            console.error("全局Worker错误:", err.stack || err.message || err); 
            return new Response(JSON.stringify({ 
                error: '服务器内部错误',
                details: err.message,
                stack: err.stack ? err.stack.split('\n').slice(0, 7).join('\n') : '无堆栈信息'
            }), { status: 500, headers: { 'Content-Type': 'application/json;charset=UTF-8' } });
        }
    },
};

async function handleStaticAssets(url, env) {
    let path = url.pathname;
    if (path === '/' || path === '') path = '/index.html';
    
    const objectKey = path.substring(1); 
    const object = await env.R2_STATIC_ASSETS.get(objectKey);
    
    if (object === null) {
        console.log(`静态资源未找到: ${objectKey}`);
        return new Response(JSON.stringify({ error: `静态资源未找到: ${objectKey}` }), { 
            status: 404, headers: { 'Content-Type': 'application/json;charset=UTF-8' } 
        });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    
    // 设置内容类型
    if (objectKey.endsWith('.html')) headers.set('Content-Type', 'text/html;charset=UTF-8');
    else if (objectKey.endsWith('.js')) headers.set('Content-Type', 'application/javascript');
    else if (objectKey.endsWith('.css')) headers.set('Content-Type', 'text/css');
    else if (objectKey.endsWith('.json')) headers.set('Content-Type', 'application/json');
    else if (objectKey.endsWith('.txt')) headers.set('Content-Type', 'text/plain');
    else if (objectKey.endsWith('.png')) headers.set('Content-Type', 'image/png');
    else if (objectKey.endsWith('.jpg') || objectKey.endsWith('.jpeg')) headers.set('Content-Type', 'image/jpeg');
    
    return new Response(object.body, { headers });
}

async function handleGenerateSubscription(request, env, ctx) {
    try {
        const { links = [], remoteSubs = [] } = await request.json();
        
        if ((!links || !Array.isArray(links) || links.length === 0) && 
            (!remoteSubs || !Array.isArray(remoteSubs) || remoteSubs.length === 0)) {
            return new Response(JSON.stringify({ error: '无效的输入', details: '需要提供节点链接或远程订阅URL数组' }), {
                status: 400, headers: { 'Content-Type': 'application/json;charset=UTF-8' },
            });
        }

        // 处理本地链接
        const localProxies = [];
        for (const rawLink of links) {
            if (!rawLink || typeof rawLink !== 'string' || !rawLink.trim()) continue;
            const proxy = parseSingleLink(rawLink.trim());
            if (proxy) localProxies.push(proxy);
        }

        // 处理远程订阅
        const remoteProxies = [];
        for (const subUrl of remoteSubs) {
            if (!subUrl || typeof subUrl !== 'string' || !subUrl.trim()) continue;
            try {
                const proxies = await parseRemoteSubscription(subUrl.trim(), env, ctx);
                if (proxies && proxies.length > 0) {
                    remoteProxies.push(...proxies);
                }
            } catch (e) {
                console.error(`Failed to parse remote subscription ${subUrl}:`, e.message);
            }
        }

        // 合并代理
        const allProxies = mergeProxies(localProxies, remoteProxies);
        
        if (allProxies.length === 0) {
            return new Response(JSON.stringify({ error: '没有可用的有效节点', details: '未能从输入中解析出任何有效节点配置' }), {
                status: 400, headers: { 'Content-Type': 'application/json;charset=UTF-8' },
            });
        }

        const fullYamlConfig = generateFullClashConfig(allProxies, env);
        const subId = crypto.randomUUID();
        const subKey = `subs/${subId}.yaml`;

        await env.R2_SUBS_BUCKET.put(subKey, fullYamlConfig, {
            httpMetadata: { contentType: 'application/x-yaml;charset=UTF-8' },
        });
        
        const workerUrl = new URL(request.url);
        const subscriptionLink = `${workerUrl.protocol}//${workerUrl.host}/sub/${subId}`;

        return new Response(JSON.stringify({ 
            subscriptionLink, 
            yaml: fullYamlConfig,
            stats: {
                localProxies: localProxies.length,
                remoteProxies: remoteProxies.length,
                totalProxies: allProxies.length
            }
        }), {
            headers: { 
                'Content-Type': 'application/json;charset=UTF-8',
                'Access-Control-Allow-Origin': '*'
            },
        });

    } catch (e) { 
        console.error('Error in handleGenerateSubscription:', e.stack || e.message || e);
        return new Response(JSON.stringify({ 
            error: '转换处理失败', 
            details: e.message,
            stack: e.stack ? e.stack.split('\n').slice(0, 7).join('\n') : 'No stack available'
        }), {
            status: 500, headers: { 'Content-Type': 'application/json;charset=UTF-8' },
        });
    }
}

async function handleServeSubscription(url, env) {
    const subId = url.pathname.substring('/sub/'.length);
    if (!subId) {
        return new Response(JSON.stringify({ error: '无效的订阅ID' }), { 
            status: 400, headers: { 'Content-Type': 'application/json;charset=UTF-8' } 
        });
    }
    const subKey = `subs/${subId}.yaml`;
    const object = await env.R2_SUBS_BUCKET.get(subKey);

    if (object === null) {
        return new Response(JSON.stringify({ error: '订阅未找到或已过期' }), { 
            status: 404, headers: { 'Content-Type': 'application/json;charset=UTF-8' } 
        });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('Content-Type', 'text/plain; charset=utf-8');
    headers.set('Profile-Update-Interval', '86400');
    headers.set('Subscription-Userinfo', 'upload=0; download=0; total=10737418240000000; expire=2546249531');
    headers.set('Content-Disposition', 'inline');
    headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    headers.set('Pragma', 'no-cache');
    headers.set('Expires', '0');
    
    return new Response(object.body, { headers });
}

// --- Base64 Helper ---
function tryDecodeBase64(str) {
    try {
        if (!str || typeof str !== 'string') return str;
        if (str.startsWith('vmess://')) return str; 
        if (str.includes('://')) return str; 
        const base64CharsRegex = /^[A-Za-z0-9+/]*={0,2}$/;
        if (!base64CharsRegex.test(str)) return str; 
        const decoded = atob(str); 
        if (isLikelyProtocolLink(decoded)) return decoded; 
        return str; 
    } catch (e) { return str; }
}

function isLikelyProtocolLink(str) {
    if (typeof str !== 'string') return false;
    const protocols = ['ss://', 'vmess://', 'vless://', 'trojan://', 'tuic://', 'hysteria2://', 'hy2://'];
    return protocols.some(p => str.startsWith(p));
}

// --- Protocol Parsers ---
function parseSS(link) {
    try {
        const url = new URL(link);
        const name = url.hash ? decodeURIComponent(url.hash.substring(1)) : `SS-${url.hostname}:${url.port}`;
        let userInfo = '';
        if (url.username && url.password) userInfo = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
        else if (url.username) { 
             try {
                const decodedUserInfo = atob(url.username); 
                if (decodedUserInfo.includes(':')) userInfo = decodedUserInfo;
                else if (decodeURIComponent(url.username).includes(':') && !url.password) userInfo = decodeURIComponent(url.username);
                else userInfo = decodeURIComponent(url.username);
             } catch (e) { userInfo = decodeURIComponent(url.username); }
        }
        const [method, password = ''] = userInfo.split(':', 2); 
        if (!method) { console.warn(`SS: missing method - ${link.substring(0,50)}`); return null; }
        return { name, type: 'ss', server: url.hostname, port: parseInt(url.port), cipher: method, password, udp: true };
    } catch (e) { console.error(`SS解析失败: ${link.substring(0,50)} - ${e.message}`); return null; }
}

function parseVmess(link) {
    try {
        const b64Config = link.substring('vmess://'.length);
        if (!b64Config) throw new Error("VMess: link content empty");
        const jsonConfigStr = atob(b64Config);
        const vmessConfig = JSON.parse(jsonConfigStr);
        if (!vmessConfig.add || !vmessConfig.id) { console.warn(`VMess: missing server or uuid - ${link.substring(0,50)}`); return null;}
        const proxy = {
            name: vmessConfig.ps || `VMess-${vmessConfig.add}`, type: 'vmess', server: vmessConfig.add, port: parseInt(vmessConfig.port),
            uuid: vmessConfig.id, alterId: parseInt(vmessConfig.aid || '0'), cipher: vmessConfig.scy || 'auto', tls: vmessConfig.tls === 'tls', udp: true,
            network: vmessConfig.net || 'tcp',
        };
        if (proxy.tls) {
            proxy.servername = vmessConfig.sni || vmessConfig.host || vmessConfig.add;
            if (vmessConfig.allowInsecure === true || String(vmessConfig.allowInsecure) === 'true' || vmessConfig.skipVerify === true) proxy['skip-cert-verify'] = true;
            if (vmessConfig.fp) proxy['client-fingerprint'] = vmessConfig.fp;
        }
        if (vmessConfig.net === 'ws') {
            proxy['ws-opts'] = { path: vmessConfig.path || '/', headers: { Host: vmessConfig.host || vmessConfig.add }};
            if (vmessConfig.wsHeaders && typeof vmessConfig.wsHeaders === 'object') proxy['ws-opts'].headers = { ...proxy['ws-opts'].headers, ...vmessConfig.wsHeaders };
        } else if (vmessConfig.net === 'tcp' && vmessConfig.type === 'http') {
             proxy.tcp_opts = { header: { type: "http", request: vmessConfig.request, response: vmessConfig.response }};
        } else if (vmessConfig.net === 'h2') {
            proxy['h2-opts'] = { path: vmessConfig.path || '/', host: Array.isArray(vmessConfig.host) ? vmessConfig.host : [vmessConfig.host || vmessConfig.add].filter(Boolean)};
        } else if (vmessConfig.net === 'grpc') {
            proxy['grpc-opts'] = { 'grpc-service-name': vmessConfig.path || vmessConfig.serviceName || ''};
            if (vmessConfig.mode === 'multi') proxy['grpc-opts']['grpc-mode'] = 'multi';
        }
        return proxy;
    } catch (e) { console.error(`VMess解析失败: ${link.substring(0,50)} - ${e.message}`); return null; }
}

function parseVless(link) {
    try {
        const url = new URL(link);
        const name = url.hash ? decodeURIComponent(url.hash.substring(1)) : `VLESS-${url.hostname}:${url.port}`;
        const params = url.searchParams;
        if (!url.username) { console.warn(`VLESS: missing uuid - ${link.substring(0,50)}`); return null; }
        const proxy = {
            name, type: 'vless', server: url.hostname, port: parseInt(url.port), uuid: url.username, udp: true, 
            tls: params.get('security') === 'tls' || params.get('security') === 'xtls', network: params.get('type') || 'tcp',
        };
        if (proxy.tls) {
            proxy.servername = params.get('sni') || url.hostname;
            if (params.get('fp')) proxy['client-fingerprint'] = params.get('fp');
            if (params.get('alpn')) proxy.alpn = params.get('alpn').split(',').map(s => s.trim()).filter(Boolean);
            if (params.get('allowInsecure') === '1' || params.get('allowInsecure') === 'true') proxy['skip-cert-verify'] = true;
            if (params.get('security') === 'xtls') proxy.flow = params.get('flow') || 'xtls-rprx-vision'; 
            if (params.get('pbk')) proxy.publicKey = params.get('pbk');
            if (params.get('sid')) proxy.shortId = params.get('sid');
        }
        if (proxy.network === 'ws') {
            proxy['ws-opts'] = { path: params.get('path') || '/', headers: { Host: params.get('host') || url.hostname }};
            if (params.get('maxEarlyData') && params.get('earlyDataHeaderName')) {
                proxy['ws-opts']['max-early-data'] = parseInt(params.get('maxEarlyData'));
                proxy['ws-opts']['early-data-header-name'] = params.get('earlyDataHeaderName');
            }
        } else if (proxy.network === 'grpc') {
            proxy['grpc-opts'] = { 'grpc-service-name': params.get('serviceName') || params.get('path') || ''};
            if (params.get('mode') === 'multi') proxy['grpc-opts']['grpc-mode'] = 'multi';
        } else if (proxy.network === 'h2') {
            proxy['h2-opts'] = { path: params.get('path') || '/', host: params.get('host') ? params.get('host').split(',').map(s => s.trim()).filter(Boolean) : [url.hostname].filter(Boolean)};
        }
        return proxy;
    } catch (e) { console.error(`VLESS解析失败: ${link.substring(0,50)} - ${e.message}`); return null; }
}

function parseTrojan(link) {
    try {
        const url = new URL(link);
        const name = url.hash ? decodeURIComponent(url.hash.substring(1)) : `Trojan-${url.hostname}:${url.port}`;
        const params = url.searchParams;
        const password = url.password || url.username;
        if (!password) { console.warn(`Trojan: missing password - ${link.substring(0,50)}`); return null;}
        const proxy = {
            name, type: 'trojan', server: url.hostname, port: parseInt(url.port), password, udp: true, 
            sni: params.get('sni') || params.get('peer') || url.hostname,
        };
        if (params.get('allowInsecure') === '1' || params.get('skip-cert-verify') === '1' || params.get('allowInsecure') === 'true' ) proxy['skip-cert-verify'] = true;
        if (params.get('alpn')) proxy.alpn = params.get('alpn').split(',').map(s=>s.trim()).filter(Boolean);
        if (params.get('type') === 'ws' || params.get('network') === 'ws') {
            proxy.network = 'ws';
            proxy['ws-opts'] = { path: params.get('path') || params.get('wsPath') || '/', headers: { Host: params.get('host') || params.get('wsHost') || url.hostname }};
        }
        return proxy;
    } catch (e) { console.error(`Trojan解析失败: ${link.substring(0,50)} - ${e.message}`); return null; }
}

function parseTuic(link) {
    try {
        const url = new URL(link);
        const name = url.hash ? decodeURIComponent(url.hash.substring(1)) : `TUIC-${url.hostname}:${url.port}`;
        const params = url.searchParams;
        let uuid = url.username; 
        let password = url.password || ''; 
        if (url.username && url.username.includes(':') && !url.password) [uuid, password] = url.username.split(':', 2);
        if (!uuid) { console.warn(`TUIC: missing uuid/token - ${link.substring(0,50)}`); return null; }
        const proxy = {
            name, type: 'tuic', server: url.hostname, port: parseInt(url.port), uuid, password,
            sni: params.get('sni') || url.hostname,
            'congestion-controller': params.get('congestion_control') || params.get('congestion-controller') || 'bbr',
            'udp-relay-mode': params.get('udp_relay_mode') || params.get('udp-relay-mode') || 'native',
            alpn: params.get('alpn') ? params.get('alpn').split(',').map(s=>s.trim()).filter(Boolean) : ['h3'],
        };
        if (params.get('allow_insecure') === '1' || params.get('skip-cert-verify') === '1' || params.get('allow_insecure') === 'true') proxy['skip-cert-verify'] = true;
        if (params.get('disable_sni') === 'true') proxy.sni = ''; 
        if (params.get('reduce-rtt')) proxy['reduce-rtt'] = params.get('reduce-rtt') === 'true';
        return proxy;
    } catch (e) { console.error(`TUIC解析失败: ${link.substring(0,50)} - ${e.message}`); return null; }
}

function parseHysteria2(link) {
    try {
        const url = new URL(link);
        const name = url.hash ? decodeURIComponent(url.hash.substring(1)) : `Hy2-${url.hostname}:${url.port}`;
        const params = url.searchParams;
        const password = url.password || url.username;
        if (!password) { console.warn(`Hysteria2: missing password - ${link.substring(0,50)}`); return null;}
        const proxy = {
            name, type: 'hysteria2', server: url.hostname, port: parseInt(url.port), password, 
            sni: params.get('sni') || url.hostname,
        };
        if (params.get('insecure') === '1' || params.get('skip-cert-verify') === 'true' || params.get('allowInsecure') === 'true') proxy['skip-cert-verify'] = true;
        if (params.get('obfs')) {
            proxy.obfs = params.get('obfs');
            proxy['obfs-password'] = params.get('obfs-password') || params.get('obfs_password') || '';
        }
        if (params.get('upmbps')) proxy.up = `${params.get('upmbps')} Mbps`;
        else if (params.get('up')) proxy.up = params.get('up');
        if (params.get('downmbps')) proxy.down = `${params.get('downmbps')} Mbps`;
        else if (params.get('down')) proxy.down = params.get('down');
        if(params.get('alpn')) proxy.alpn = params.get('alpn').split(',').map(s=>s.trim()).filter(Boolean);
        return proxy;
    } catch (e) { console.error(`Hysteria2解析失败: ${link.substring(0,50)} - ${e.message}`); return null; }
}

// --- YAML Generation ---
function generateFullClashConfig(proxies, env) {
    const proxyNames = proxies.map((p, i) => p.name || `${p.type || 'Proxy'}-${i}` ).filter((value, index, self) => self.indexOf(value) === index);
    
    function escapeYamlString(str) {
        if (typeof str !== 'string') return String(str); 
        return `"${str.replace(/"/g, '\\"')}"`;
    }

    function objectToYamlParts(obj, baseIndent) {
        const parts = [];
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                const value = obj[key];
                let valueStr;
                if (typeof value === 'string') {
                    valueStr = escapeYamlString(value); 
                } else if (typeof value === 'boolean' || typeof value === 'number') {
                    valueStr = value.toString();
                } else if (Array.isArray(value)) {
                    if (value.length === 0)  valueStr = '[]';
                    else valueStr = `\n${value.map(item => `${baseIndent}  - ${escapeYamlString(item)}`).join('\n')}`;
                } else if (typeof value === 'object' && value !== null) {
                    const nestedParts = objectToYamlParts(value, baseIndent + '  ');
                    valueStr = nestedParts.length === 0 ? '{}' : `\n${nestedParts.join('\n')}`;
                } else if (value === null) {
                    valueStr = 'null';
                } else continue; 
                parts.push(`${baseIndent}${key}: ${valueStr}`);
            }
        }
        return parts;
    }

    let proxiesYaml = proxies.map((p_orig, index) => {
        const p = {...p_orig}; 
        p.name = p.name || `${p.type || 'Proxy'}-${index}`; 
        let parts = [`  - name: ${escapeYamlString(p.name)}`]; 
        const { name: _, ...otherFields } = p; 
        parts.push(...objectToYamlParts(otherFields, '    '));
        return parts.join('\n');
    }).join('\n\n'); 

    const uniqueProxyNamesForGroup = proxyNames.length > 0 ? proxyNames : ['DIRECT'];
    const groupsAndRules = `
proxy-groups:
  - name: "🔰 PROXY" 
    type: select
    proxies:
${uniqueProxyNamesForGroup.map(name => `      - ${escapeYamlString(name)}`).join('\n')}
      - DIRECT
      - REJECT
  - name: "🎯 Auto" 
    type: url-test
    url: http://www.gstatic.com/generate_204 
    interval: 300 
    tolerance: 150 
    proxies:
${uniqueProxyNamesForGroup.map(name => `      - ${escapeYamlString(name)}`).join('\n')}
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
  - MATCH,🔰 PROXY`;

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

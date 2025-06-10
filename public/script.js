document.addEventListener('DOMContentLoaded', () => {
    // #################################################################################
    //                          协议解析与配置生成模块 (最终修复版)
    // #################################################################################
    
    function b64UrlDecode(str) {try {str = str.replace(/-/g, '+').replace(/_/g, '/');while (str.length % 4) { str += '='; }return atob(str);} catch(e) {console.error("Base64URL Decode Failed for string:", str, e);return "";}}
    function parseShadowsocks(link) {try {if (!link.startsWith("ss://")) throw new Error("Not an SS link");const hashIndex = link.indexOf('#');const name = hashIndex > -1 ? decodeURIComponent(link.substring(hashIndex + 1)) : null;const corePart = hashIndex > -1 ? link.substring(5, hashIndex) : link.substring(5);if (corePart.indexOf('@') === -1) {const decoded = b64UrlDecode(corePart);if (!decoded) throw new Error("SIP002 core part is not valid Base64.");const atIndex = decoded.lastIndexOf('@');if (atIndex === -1) throw new Error("Invalid SIP002 format: missing '@' after decoding.");const authPart = decoded.substring(0, atIndex);const hostPart = decoded.substring(atIndex + 1);const [cipher, password] = authPart.split(':');const [server, port] = hostPart.split(':');if (server && port && cipher && password) {return { name: name || `${server}:${port}`, type: 'ss', server, port: parseInt(port), cipher, password, udp: true };}}else {const atIndex = corePart.lastIndexOf('@');const authPartB64 = corePart.substring(0, atIndex);const hostPart = corePart.substring(atIndex + 1);let cipher, password;const decodedAuth = atob(authPartB64);const colonIndex = decodedAuth.indexOf(':');if (colonIndex > 0) {cipher = decodedAuth.substring(0, colonIndex);password = decodedAuth.substring(colonIndex + 1);} else {throw new Error("Decoded auth part is invalid.");}const hostColonIndex = hostPart.lastIndexOf(':');if (hostColonIndex === -1) throw new Error("Invalid host part: missing port");const server = hostPart.substring(0, hostColonIndex);const port = hostPart.substring(hostColonIndex + 1);if (server && port && cipher && password) {return { name: name || `${server}:${port}`, type: 'ss', server, port: parseInt(port), cipher, password, udp: true };}}} catch (e) {throw new Error(`SS link parsing failed: ${e.message}`);}throw new Error("Could not parse SS link in any known format.");}
    function parseShadowsocksR(link) {try {const decoded = b64UrlDecode(link.substring('ssr://'.length));const mainParts = decoded.split('/?');const requiredParts = mainParts[0].split(':');if (requiredParts.length < 6) throw new Error("Invalid SSR main part");const [server, port, protocol, cipher, obfs, password_b64] = requiredParts;const paramsStr = mainParts.length > 1 ? mainParts[1] : '';const params = new URLSearchParams(paramsStr);const name = params.get('remarks') ? b64UrlDecode(params.get('remarks')) : `${server}:${port}`;const password = b64UrlDecode(password_b64);const obfsParam = params.get('obfsparam') ? b64UrlDecode(params.get('obfsparam')) : '';const protoParam = params.get('protoparam') ? b64UrlDecode(params.get('protoparam')) : '';return { name, type: 'ssr', server, port: parseInt(port, 10), cipher, password, protocol, 'protocol-param': protoParam, obfs, 'obfs-param': obfsParam, udp: true };} catch (e) {throw new Error(`SSR link parsing failed: ${e.message}`);}}
    function parseShareLink(link) {if (!link) return []; let decodedLink = link; if (!link.includes('://') && (link.length % 4 === 0) && /^[a-zA-Z0-9+/]*={0,2}$/.test(link)) {try { decodedLink = atob(link); } catch (e) { /* ignore */ }} if (decodedLink.startsWith('ss://')) return [parseShadowsocks(decodedLink)]; if (decodedLink.startsWith('ssr://')) return [parseShadowsocksR(decodedLink)]; if (decodedLink.startsWith('vless://')) return [parseVless(decodedLink)]; if (decodedLink.startsWith('vmess://')) return [parseVmess(decodedLink)]; if (decodedLink.startsWith('trojan://')) return [parseTrojan(decodedLink)]; if (decodedLink.startsWith('tuic://')) return [parseTuic(decodedLink)]; if (decodedLink.startsWith('hysteria2://')) return [parseHysteria2(decodedLink)]; return [];}
    function parseVless(link) {try {const url = new URL(link);const params = url.searchParams;const proxy = {name: decodeURIComponent(url.hash).substring(1) || url.hostname,type: 'vless',server: url.hostname,port: parseInt(url.port, 10),uuid: url.username,network: params.get('type') || 'tcp',tls: params.get('security') === 'tls' || params.get('security') === 'reality',udp: true,flow: params.get('flow') || '','client-fingerprint': params.get('fp') || 'chrome',};if (proxy.tls) {proxy.servername = params.get('sni') || url.hostname;proxy.alpn = params.get('alpn') ? params.get('alpn').split(',') : ["h2", "http/1.1"];if (params.get('security') === 'reality') {proxy['reality-opts'] = { 'public-key': params.get('pbk'), 'short-id': params.get('sid') };}}if (proxy.network === 'ws') proxy['ws-opts'] = { path: params.get('path') || '/', headers: { Host: params.get('host') || url.hostname } };if (proxy.network === 'grpc') proxy['grpc-opts'] = { 'grpc-service-name': params.get('serviceName') || '' };return proxy;} catch(e) { throw new Error(`VLESS link parsing failed: ${e.message}`); } }
    function parseVmess(link) {try {const jsonStr = atob(link.substring('vmess://'.length));const config = JSON.parse(jsonStr);return {name: config.ps || config.add, type: 'vmess', server: config.add, port: parseInt(config.port, 10),uuid: config.id, alterId: config.aid, cipher: config.scy || 'auto',tls: config.tls === 'tls', network: config.net || 'tcp', udp: true,servername: config.sni || undefined,'ws-opts': config.net === 'ws' ? { path: config.path || '/', headers: { Host: config.host || config.add } } : undefined,'h2-opts': config.net === 'h2' ? { path: config.path || '/', host: [config.host || config.add] } : undefined,'grpc-opts': config.net === 'grpc' ? { 'grpc-service-name': config.path || ''} : undefined,};} catch(e) { throw new Error(`VMess link parsing failed: ${e.message}`); } }
    function parseTrojan(link) {try {const url = new URL(link);const params = url.searchParams;return {name: decodeURIComponent(url.hash).substring(1) || url.hostname,type: 'trojan', server: url.hostname, port: parseInt(url.port, 10),password: url.username, udp: true, sni: params.get('sni') || url.hostname,servername: params.get('sni') || url.hostname,alpn: params.get('alpn') ? params.get('alpn').split(',') : ["h2", "http/1.1"],};} catch(e) { throw new Error(`Trojan link parsing failed: ${e.message}`); } }
    function parseTuic(link) {try {const url = new URL(link);const params = url.searchParams;const [uuid, password] = url.username.split(':');return {name: decodeURIComponent(url.hash).substring(1) || url.hostname,type: 'tuic', server: url.hostname, port: parseInt(url.port, 10),uuid: uuid, password: password,servername: params.get('sni') || url.hostname,udp: true,'congestion-controller': params.get('congestion_control') || 'bbr','udp-relay-mode': params.get('udp_relay_mode') || 'native',alpn: params.get('alpn') ? params.get('alpn').split(',') : ["h3"],'disable-sni': params.get('disable_sni') === 'true',};} catch(e) { throw new Error(`TUIC link parsing failed: ${e.message}`); } }
    function parseHysteria2(link) {try {const url = new URL(link);const params = url.searchParams;return {name: decodeURIComponent(url.hash).substring(1) || url.hostname,type: 'hysteria2', server: url.hostname, port: parseInt(url.port, 10),password: url.username,servername: params.get('sni') || url.hostname,udp: true,'skip-cert-verify': params.get('insecure') === '1' || params.get('skip_cert_verify') === 'true',obfs: params.get('obfs'),'obfs-password': params.get('obfs-password'),};} catch(e) { throw new Error(`Hysteria2 link parsing failed: ${e.message}`); } }
    function generateClashConfig(proxies) {const proxyNames = proxies.map(p => p.name);const config = {'port': 7890, 'socks-port': 7891, 'allow-lan': false,'mode': 'rule', 'log-level': 'info', 'external-controller': '127.0.0.1:9090','proxies': proxies,'proxy-groups': [{'name': 'PROXY', 'type': 'select', 'proxies': ['DIRECT', 'REJECT', ...proxyNames],}],'rules': ['DOMAIN-SUFFIX,google.com,PROXY', 'DOMAIN-SUFFIX,github.com,PROXY','DOMAIN-SUFFIX,youtube.com,PROXY', 'DOMAIN-SUFFIX,telegram.org,PROXY','GEOIP,CN,DIRECT', 'MATCH,PROXY',],};const serializeClash = (config) => {let out = "";const simpleDump = (key, val) => { if(val !== undefined) out += `${key}: ${val}\n`};simpleDump('port', config.port);simpleDump('socks-port', config['socks-port']);simpleDump('allow-lan', config['allow-lan']);simpleDump('mode', config.mode);simpleDump('log-level', config['log-level']);simpleDump('external-controller', config['external-controller']);out += "proxies:\n";for (const proxy of config.proxies) {out += "  - {";let first = true;for (const [k, v] of Object.entries(proxy)) {if (v === undefined) continue;if (!first) out += ", ";if (typeof v === 'object' && v !== null && !Array.isArray(v)) {out += `${k}: {${Object.entries(v).map(([sk, sv]) => `${sk}: ${JSON.stringify(sv)}`).join(', ')}}`;} else {out += `${k}: ${JSON.stringify(v)}`;}first = false;}out += "}\n";}out += "proxy-groups:\n";for(const group of config['proxy-groups']) {out += `- name: ${JSON.stringify(group.name)}\n  type: ${group.type}\n  proxies:\n`;for(const proxyName of group.proxies){out += `    - ${JSON.stringify(proxyName)}\n`;}}out += "rules:\n";for (const rule of config.rules) {out += `  - ${rule}\n`;}return out;};return serializeClash(config);}
    function generateSingboxConfig(proxies) {const outbounds = proxies.map(clashProxy => {const {name, type, server, port, password, uuid, alterId, cipher,network, tls, udp, flow, 'client-fingerprint': fingerprint,servername, alpn, 'reality-opts': realityOpts,'ws-opts': wsOpts, 'grpc-opts': grpcOpts,'congestion-controller': congestion, 'udp-relay-mode': udpRelayMode,'skip-cert-verify': skipCertVerify, obfs, 'obfs-password': obfsPassword} = clashProxy;const singboxOutbound = {tag: name,type: type,server: server,server_port: parseInt(port, 10),};if (uuid) singboxOutbound.uuid = uuid;if (password) singboxOutbound.password = password;if (type === 'vless') {if (flow) singboxOutbound.flow = flow;}if (type === 'vmess') {singboxOutbound.alter_id = alterId;singboxOutbound.security = cipher || 'auto';}if (type === 'ssr') {singboxOutbound.method = cipher; singboxOutbound.protocol = clashProxy.protocol; singboxOutbound.protocol_param = clashProxy['protocol-param']; singboxOutbound.obfs = obfs; singboxOutbound.obfs_param = clashProxy['obfs-param'];}if (tls) {singboxOutbound.tls = {enabled: true,server_name: servername || server,alpn: alpn,insecure: skipCertVerify || false,};if (fingerprint) {singboxOutbound.tls.utls = { enabled: true, fingerprint: fingerprint };}if (realityOpts) {singboxOutbound.tls.reality = {enabled: true,public_key: realityOpts['public-key'],short_id: realityOpts['short-id'],};}}if(type === 'hysteria2') {if (obfs && obfsPassword) {singboxOutbound.obfs = { type: 'salamander', password: obfsPassword };}singboxOutbound.up_mbps = 20; singboxOutbound.down_mbps = 100;}if(type === 'tuic') {singboxOutbound.congestion_control = congestion;singboxOutbound.udp_relay_mode = udpRelayMode;singboxOutbound.version = 'v5';}if (network && network !== 'tcp') {singboxOutbound.transport = { type: network };if (network === 'ws' && wsOpts) {singboxOutbound.transport.path = wsOpts.path;if (wsOpts.headers && wsOpts.headers.Host) {singboxOutbound.transport.headers = { Host: wsOpts.headers.Host };}}if (network === 'grpc' && grpcOpts) {singboxOutbound.transport.service_name = grpcOpts['grpc-service-name'];}}return singboxOutbound;});outbounds.push({ type: 'selector', tag: 'PROXY', outbounds: proxies.map(p => p.name).concat(['DIRECT', 'REJECT']) },{ type: 'direct', tag: 'DIRECT' },{ type: 'block', tag: 'REJECT' },{ type: 'dns', tag: 'dns-out' });const config = {log: { level: "info", timestamp: true },inbounds: [{ type: "mixed", tag: "mixed-in", listen: "127.0.0.1", listen_port: 2080 }],outbounds: outbounds,route: {rules: [{ protocol: "dns", outbound: "dns-out" },{ geoip: ["cn"], outbound: "DIRECT" },{ domain_suffix: ["cn", "qq.com", "wechat.com"], outbound: "DIRECT" },{ outbound: "PROXY" }],auto_detect_interface: true},experimental: { clash_api: { external_controller: "127.0.0.1:9090", secret: "" } }};return JSON.stringify(config, null, 2);}

    // --- DOM Elements ---
    const subInput = document.getElementById('sub-input');
    const expirationSelect = document.getElementById('expiration-select');
    const convertBtn = document.getElementById('convert-btn');
    const convertResultArea = document.getElementById('convert-result-area');
    const extractionCodeDisplay = document.getElementById('extraction-code-display');
    const convertBtnText = document.getElementById('btn-text');
    const convertLoader = document.getElementById('loader');
    const extractCodeInput = document.getElementById('extract-code-input');
    const extractBtn = document.getElementById('extract-btn');
    const extractResultArea = document.getElementById('extract-result-area');
    const genericResultLink = document.getElementById('generic-result-link');
    const clashResultLink = document.getElementById('clash-result-link');
    const singboxResultLink = document.getElementById('singbox-result-link');
    const extractBtnText = document.getElementById('extract-btn-text');
    const extractLoader = document.getElementById('extract-loader');
    const errorMessage = document.getElementById('error-message');
    const errorText = document.getElementById('error-text');

    /**
     * 【新增】: 通过后端代理获取远程订阅内容的函数
     * @param {string} url The remote subscription URL.
     * @returns {Promise<string[]>} A promise that resolves to an array of share links.
     */
    async function fetchRemoteSubscription(url) {
        console.log(`[FRONTEND LOG] Fetching remote subscription via proxy: ${url}`);
        const response = await fetch('/proxy-fetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`获取远程订阅失败 (${url.substring(0, 30)}...): ${errText}`);
        }

        const content = await response.text();
        try {
            const decoded = atob(content);
            return decoded.split(/[\r\n]+/).filter(line => line.trim() !== '');
        } catch (e) {
            return content.split(/[\r\n]+/).filter(line => line.trim() !== '');
        }
    }


    // --- Event Listeners ---
    convertBtn.addEventListener('click', async () => {
        const inputData = subInput.value.trim();
        if (!inputData) {
            showError('订阅链接或分享链接不能为空。');
            return;
        }

        setLoading(convertBtn, convertLoader, convertBtnText, true);
        hideError();
        convertResultArea.classList.add('hidden');

        try {
            const lines = inputData.split(/[\r\n]+/).filter(line => line.trim() !== '');
            let allProxies = [];
            let allShareLinks = [];
            let parsingErrors = [];

            // 使用 for...of 循环来正确处理 await
            for (const line of lines) {
                try {
                    let linesToParse = [line];
                    if (line.startsWith('http')) {
                        linesToParse = await fetchRemoteSubscription(line);
                    }
                    
                    for (const singleLink of linesToParse) {
                        if (!singleLink.trim()) continue;
                        
                        const proxies = parseShareLink(singleLink);
                        if (proxies && proxies.length > 0) {
                            const validProxies = proxies.filter(p => p);
                            if (validProxies.length > 0) {
                                allProxies.push(...validProxies);
                                allShareLinks.push(singleLink);
                            } else {
                                parsingErrors.push(`- 无法识别的链接格式: "${singleLink.substring(0, 40)}..."`);
                            }
                        } else if (singleLink.trim()) {
                            parsingErrors.push(`- 不支持的链接类型: "${singleLink.substring(0, 40)}..."`);
                        }
                    }
                } catch (e) {
                    parsingErrors.push(`- 处理时出错 "${line.substring(0, 40)}...": ${e.message}`);
                }
            }

            if (allProxies.length === 0) {
                let finalMessage = "未找到任何可解析的有效代理节点。";
                if (parsingErrors.length > 0) {
                    finalMessage += "\n\n解析详情如下:\n" + parsingErrors.join('\n');
                } else {
                    finalMessage += " 请检查您输入的链接。";
                }
                throw new Error(finalMessage);
            }

            allProxies = allProxies.filter((proxy, index, self) => proxy && proxy.name && index === self.findIndex((p) => p && p.name === proxy.name));

            const clashConfig = generateClashConfig(allProxies);
            const singboxConfig = generateSingboxConfig(allProxies);
            const genericSubContent = btoa(allShareLinks.join('\n'));

            const extractionCode = crypto.randomUUID(); 
            const dataToEncrypt = JSON.stringify({
                clash: clashConfig,
                singbox: singboxConfig,
                generic: genericSubContent
            });
            const encryptedData = CryptoJS.AES.encrypt(dataToEncrypt, extractionCode).toString();
            
            const requestBody = {
                extractionCode: extractionCode,
                encryptedData: encryptedData,
                expirationDays: expirationSelect.value,
            };

            const response = await fetch('/convert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            });
            
            if (!response.ok) {
                const errText = await response.text();
                throw new Error(errText || `服务器错误: ${response.status}`);
            }

            const result = await response.json();

            if (result.success) {
                extractionCodeDisplay.textContent = extractionCode;
                convertResultArea.classList.remove('hidden');
            } else {
                 throw new Error('转换失败，但未提供明确原因。');
            }
        } catch (error) {
            showError(error.message);
        } finally {
            setLoading(convertBtn, convertLoader, convertBtnText, false);
        }
    });

    extractBtn.addEventListener('click', async() => {
        const extractionCode = extractCodeInput.value.trim();
        if (!extractionCode) {
            showError('提取码不能为空。');
            return;
        }
        
        setLoading(extractBtn, extractLoader, extractBtnText, true);
        hideError();
        extractResultArea.classList.add('hidden');
        
        try {
            const response = await fetch('/extract', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ extractionCode }),
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(errText || `服务器错误: ${response.status}`);
            }

            const result = await response.json();
            
            if(result.success) {
                const decryptedBytes = CryptoJS.AES.decrypt(result.encryptedData, extractionCode);
                const decryptedText = decryptedBytes.toString(CryptoJS.enc.Utf8);
                
                if (!decryptedText) {
                    throw new Error("解密失败！提取码可能不正确。");
                }
                
                const configs = JSON.parse(decryptedText);

                const clashBlob = new Blob([configs.clash], { type: 'text/plain;charset=utf-8' });
                const singboxBlob = new Blob([configs.singbox], { type: 'application/json;charset=utf-8' });
                const genericBlob = new Blob([atob(configs.generic)], { type: 'text/plain;charset=utf-8' });
                
                clashResultLink.href = URL.createObjectURL(clashBlob);
                clashResultLink.textContent = "在浏览器中预览/复制 (Clash)";
                
                singboxResultLink.href = URL.createObjectURL(singboxBlob);
                singboxResultLink.download = `singbox-config-${extractionCode.substring(0,8)}.json`;
                
                genericResultLink.href = URL.createObjectURL(genericBlob);
                genericResultLink.textContent = "在浏览器中预览/复制 (通用)";

                extractResultArea.classList.remove('hidden');
            } else {
                 throw new Error(result.message || '提取失败。');
            }
        } catch (error) {
            showError(error.message);
        } finally {
             setLoading(extractBtn, extractLoader, extractBtnText, false);
        }
    });

    // --- Helper Functions and other listeners ---
    document.body.addEventListener('click', (event) => {
        const target = event.target;
        if (target.classList.contains('copy-btn')) {
            const elementToCopy = document.querySelector(target.dataset.clipboardTarget);
            if (elementToCopy && (elementToCopy.textContent || elementToCopy.href)) {
                const textToCopy = elementToCopy.href || elementToCopy.textContent;
                navigator.clipboard.writeText(textToCopy).then(() => {
                    const originalText = target.textContent;
                    target.textContent = '已复制!';
                    target.classList.add('text-green-500');
                    setTimeout(() => {
                        target.textContent = originalText;
                        target.classList.remove('text-green-500');
                    }, 2000);
                }).catch(err => {
                    showError('复制失败: ' + err);
                });
            }
        }
    });
    function setLoading(btn, loader, btnText, isLoading) {
        btn.disabled = isLoading;
        if (isLoading) {
            btn.classList.add('cursor-not-allowed');
            loader.classList.remove('hidden');
            btnText.classList.add('hidden');
        } else {
            btn.classList.remove('cursor-not-allowed');
            loader.classList.add('hidden');
            btnText.classList.remove('hidden');
        }
    }
    let errorTimeout;
    function showError(message) {
        clearTimeout(errorTimeout);
        const formattedMessage = String(message).replace(/\n/g, '<br>');
        errorText.innerHTML = formattedMessage;
        errorMessage.classList.remove('hidden', 'opacity-0');
        errorMessage.classList.add('opacity-100');
        errorTimeout = setTimeout(() => {
            errorMessage.classList.add('opacity-0');
            setTimeout(() => errorMessage.classList.add('hidden'), 8000);
        }, 8000); 
    }
    function hideError() {
        errorMessage.classList.add('hidden', 'opacity-0');
    }
});

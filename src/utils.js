export async function parseRemoteSubscription(subUrl, env, ctx) {
    try {
        // 检查缓存
        const cacheKey = `remote_sub:${btoa(subUrl)}`;
        const cachedData = await env.KV_REMOTE_CACHE.get(cacheKey, { type: 'json' });
        
        if (cachedData) {
            console.log(`Using cached data for ${subUrl}`);
            return cachedData;
        }

        // 获取远程订阅内容
        const response = await fetch(subUrl, {
            headers: {
                'User-Agent': 'ClashSubConverter/1.0'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch remote subscription: HTTP ${response.status}`);
        }

        const content = await response.text();
        let proxies = [];

        // 尝试解析为Base64编码的节点列表
        try {
            const decoded = atob(content);
            const lines = decoded.split('\n').filter(line => line.trim());
            for (const line of lines) {
                const proxy = parseSingleLink(line.trim());
                if (proxy) proxies.push(proxy);
            }
        } catch (e) {
            // 如果不是Base64，尝试解析为Clash配置YAML
            try {
                const yamlContent = content;
                const config = parseClashYaml(yamlContent);
                if (config && config.proxies) {
                    proxies = config.proxies;
                }
            } catch (yamlError) {
                throw new Error(`无法解析远程订阅内容: ${yamlError.message}`);
            }
        }

        // 缓存结果 (1小时)
        if (proxies.length > 0) {
            await env.KV_REMOTE_CACHE.put(cacheKey, JSON.stringify(proxies), {
                expirationTtl: 3600 // 1小时
            });
        }

        return proxies;
    } catch (e) {
        console.error(`Error parsing remote subscription ${subUrl}:`, e.message);
        throw e;
    }
}

export function mergeProxies(localProxies = [], remoteProxies = []) {
    const allProxies = [...localProxies];
    const remoteProxyNames = new Set(localProxies.map(p => p.name));

    // 避免名称冲突
    for (const proxy of remoteProxies) {
        let name = proxy.name;
        let counter = 1;
        while (remoteProxyNames.has(name)) {
            name = `${proxy.name} (${counter++})`;
        }
        remoteProxyNames.add(name);
        allProxies.push({ ...proxy, name });
    }

    return allProxies;
}

function parseSingleLink(link) {
    let proxy = null;
    if (link.startsWith('ss://')) proxy = parseSS(link);
    else if (link.startsWith('vmess://')) proxy = parseVmess(link);
    else if (link.startsWith('vless://')) proxy = parseVless(link);
    else if (link.startsWith('trojan://')) proxy = parseTrojan(link);
    else if (link.startsWith('tuic://')) proxy = parseTuic(link);
    else if (link.startsWith('hysteria2://') || link.startsWith('hy2://')) proxy = parseHysteria2(link);
    return proxy;
}

function parseClashYaml(yamlContent) {
    // 简化的YAML解析 - 实际实现可能需要使用YAML解析库
    try {
        const lines = yamlContent.split('\n');
        const proxiesStart = lines.findIndex(line => line.trim() === 'proxies:');
        if (proxiesStart === -1) return null;
        
        const proxies = [];
        for (let i = proxiesStart + 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('-') && line.includes('name:')) {
                const proxy = {};
                let j = i;
                while (j < lines.length && lines[j].trim() !== '') {
                    const parts = lines[j].trim().split(':');
                    if (parts.length >= 2) {
                        const key = parts[0].replace('-', '').trim();
                        const value = parts.slice(1).join(':').trim();
                        proxy[key] = value;
                    }
                    j++;
                }
                proxies.push(proxy);
                i = j;
            } else if (line.startsWith('proxy-groups:')) {
                break; // 停止在proxy-groups部分
            }
        }
        return { proxies };
    } catch (e) {
        throw new Error(`YAML解析失败: ${e.message}`);
    }
}

// 其他辅助函数...
export function tryDecodeBase64(str) {
    try {
        if (!str || typeof str !== 'string') return str;
        if (str.startsWith('vmess://')) return str;
        
        // 尝试直接解码
        try {
            const decoded = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
            if (isLikelyProtocolLink(decoded)) return decoded;
        } catch (e) {}
        
        // 尝试URI解码后再Base64解码
        try {
            const uriDecoded = decodeURIComponent(str);
            if (uriDecoded !== str) {
                const decoded = atob(uriDecoded);
                if (isLikelyProtocolLink(decoded)) return decoded;
            }
        } catch (e) {}
        
        return str;
    } catch (e) {
        return str;
    }
}

export function isLikelyProtocolLink(str) {
    if (typeof str !== 'string') return false;
    const protocols = ['ss://', 'vmess://', 'vless://', 'trojan://', 'tuic://', 'hysteria2://', 'hy2://'];
    return protocols.some(p => str.startsWith(p));
}

/**
 * =================================================================================
 * 欢迎来到 Cloudflare Workers! (纯粹的端到端加密1.1版)
 * =================================================================================
 *
 * 【架构定型】:
 * 1. 【纯粹的E2EE】: 此后端只负责存储和提取加密数据。所有明文处理逻辑和相关GET路由已被彻底移除。
 * 2. 【角色明确】: 后端是“零知识”的仓库管理员，前端是“全能”的安全处理器。
 * 3. 【TTL机制说明】: 通过 `expires` 属性为R2对象设置生命周期，Cloudflare将在后台定期清理过期对象。
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
		// 【重要】: 对于E2EE架构，后端不再需要 /sub, /download, /generic 等GET路由，
		// 因为所有文件内容都在前端解密和处理。我们只保留静态资源服务。
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
// API 路由: /convert (只存储加密数据)
// =================================================================================
router.post(/^\/convert$/, async ({ request, env }) => {
	try {
		const { extractionCode, encryptedData, expirationDays } = await request.json();

		if (!extractionCode || !encryptedData) {
			return new Response('Missing extraction code or encrypted data.', { status: 400 });
		}

        const r2Key = `e2ee/${extractionCode}`; // 使用特定前缀以区分
        
        const days = parseInt(expirationDays);
        let expiration;
        if (days === 0) {
            // "0" 代表会话级，设置为5分钟后过期
            expiration = new Date(Date.now() + 5 * 60 * 1000); 
        } else {
            // 否则按天数计算
            expiration = new Date(Date.now() + (days || 7) * 24 * 60 * 60 * 1000);
        }

		await env.SUB_STORE.put(r2Key, encryptedData, {
            httpMetadata: { contentType: 'application/octet-stream' }, // 存储为二进制流
            expires: expiration, // 设置过期时间
        });

		return new Response(JSON.stringify({ success: true }), {
			headers: { 'Content-Type': 'application/json' },
		});

	} catch (error) {
		console.error('Storage error:', error);
		return new Response(`Error storing data: ${error.message}`, { status: 500 });
	}
});

// =================================================================================
// 提取路由: /extract (只返回加密数据)
// =================================================================================
router.post(/^\/extract$/, async ({ request, env }) => {
    try {
        const { extractionCode } = await request.json();
        if (!extractionCode) {
            return new Response('Extraction code is required.', { status: 400 });
        }
        
        const r2Key = `e2ee/${extractionCode}`;
        const object = await env.SUB_STORE.get(r2Key, { type: 'text' });

        if (object === null) {
            return new Response('提取码无效或链接已过期。', { status: 404 });
        }
        
        // 原封不动地返回加密后的数据
        return new Response(JSON.stringify({ 
            success: true, 
            encryptedData: object,
        }), {
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (e) {
        console.error('Extraction error:', e);
        return new Response(`An error occurred: ${e.message}`, { status: 500 });
    }
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
		// 【重要】在E2EE架构下，后端不再需要处理CORS预检请求，因为GET请求是开放的，
        // 而POST请求的响应是非关键的JSON，现代浏览器通常不需要为简单的JSON POST预检。
        // 如果未来有更复杂的请求头，再考虑加回CORS处理。
		return router.handle(request, env, ctx);
	},
};

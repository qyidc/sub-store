/**
 * =================================================================================
 * 欢迎来到 Cloudflare Workers! (带提取日志的最终版)
 * =================================================================================
 *
 * 【架构定型】:
 * 1. 【CORS支持】: 正确处理CORS预检请求(OPTIONS)，允许前端发送 `application/json` 类型的POST请求。
 * 2. 【纯粹的E2EE】: 此后端只负责存储和提取加密数据。所有明文处理逻辑和相关GET路由已被彻底移除。
 * 3. 【提取调试】: 在 /extract 接口中加入了详细的日志，用于追踪数据从R2到前端的全过程。
 */

// =================================================================================
// CORS 预检请求处理模块
// =================================================================================
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', 
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
    return new Response(null, { headers: { Allow: 'POST, OPTIONS' } });
  }
}

// =================================================================================
// 路由模块 (极简版)
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
// API 路由: /convert (只存储加密数据)
// =================================================================================
router.post(/^\/convert$/, async ({ request, env }) => {
	try {
		const { extractionCode, encryptedData, expirationDays } = await request.json();

		if (!extractionCode || !encryptedData) {
			return new Response('Missing extraction code or encrypted data.', { status: 400, headers: corsHeaders });
		}

        const r2Key = `e2ee/${extractionCode}`;
        
        const days = parseInt(expirationDays);
        let expiration;
        if (days === 0) {
            expiration = new Date(Date.now() + 5 * 60 * 1000); 
        } else {
            expiration = new Date(Date.now() + (days || 7) * 24 * 60 * 60 * 1000);
        }

		await env.SUB_STORE.put(r2Key, encryptedData, {
            httpMetadata: { contentType: 'application/octet-stream' }, 
            expires: expiration,
        });

		return new Response(JSON.stringify({ success: true }), {
			headers: { 'Content-Type': 'application/json', ...corsHeaders },
		});

	} catch (error) {
		console.error('Storage error:', error);
		return new Response(`Error storing data: ${error.message}`, { status: 500, headers: corsHeaders });
	}
});

// =================================================================================
// 提取路由: /extract (只返回加密数据) - 【带详细日志】
// =================================================================================
router.post(/^\/extract$/, async ({ request, env }) => {
    try {
        console.log("[BACKEND LOG] /extract endpoint hit.");
        const { extractionCode } = await request.json();
        console.log(`[BACKEND LOG] Received request for extractionCode: ${extractionCode}`);
        
        if (!extractionCode) {
            console.error("[BACKEND LOG] Extraction code is missing from request.");
            return new Response('Extraction code is required.', { status: 400, headers: corsHeaders });
        }
        
        const r2Key = `e2ee/${extractionCode}`;
        console.log(`[BACKEND LOG] Constructed R2 key: ${r2Key}`);
        
        const object = await env.SUB_STORE.get(r2Key, { type: 'text' });
        console.log("[BACKEND LOG] Performed R2 get operation.");

        if (object === null) {
            console.error(`[BACKEND LOG] Object not found in R2 for key: ${r2Key}`);
            return new Response('提取码无效或链接已过期。', { status: 404, headers: corsHeaders });
        }
        
        console.log(`[BACKEND LOG] Object found. Data length: ${object.length}. Preparing to send to frontend.`);
        
        return new Response(JSON.stringify({ 
            success: true, 
            encryptedData: object,
        }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });

    } catch (e) {
        console.error(`[BACKEND LOG] CRITICAL ERROR in /extract: ${e.message}`, e.stack);
        return new Response(`An error occurred during extraction: ${e.message}`, { status: 500, headers: corsHeaders });
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
		return router.handle(request, env, ctx);
	},
};

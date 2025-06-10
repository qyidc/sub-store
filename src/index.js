/**
 * =================================================================================
 * 欢迎来到 Cloudflare Workers! (端到端加密 + CORS修复版)
 * =================================================================================
 *
 * 【核心升级】:
 * 1. 【CORS修复】: 新增了对CORS预检请求(OPTIONS)的处理，允许前端发送 `application/json` 类型的POST请求。
 * 2. 【响应头增强】: 为所有API响应添加了 `Access-Control-Allow-Origin` 头，确保浏览器能正常接收数据。
 */

// =================================================================================
// 【新增】CORS 预检请求处理函数
// =================================================================================
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function handleOptions(request) {
  // 确保这是一个有效的CORS预检请求
  if (
    request.headers.get('Origin') !== null &&
    request.headers.get('Access-Control-Request-Method') !== null &&
    request.headers.get('Access-Control-Request-Headers') !== null
  ) {
    // 直接返回带有允许策略的响应头
    return new Response(null, { headers: corsHeaders });
  } else {
    // 处理标准的OPTIONS请求
    return new Response(null, {
      headers: {
        Allow: 'GET, POST, OPTIONS',
      },
    });
  }
}

// =================================================================================
// 路由模块 (Simple Router)
// =================================================================================
const Router = () => {
	const routes = [];
	const add = (method, path, handler) => routes.push({ method, path, handler });
	const handle = async (request, env, ctx) => {
        // 【新增】在处理任何路由之前，先处理OPTIONS请求
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
			return new Response('Missing extraction code or encrypted data.', { status: 400 });
		}

        const r2Key = `e2ee/${extractionCode}`;
        
        const days = parseInt(expirationDays);
        let expiration;
        if (days === 0) {
            expiration = new Date(Date.now() + 5 * 60 * 1000); // 5分钟
        } else {
            expiration = new Date(Date.now() + (days || 7) * 24 * 60 * 60 * 1000);
        }

		await env.SUB_STORE.put(r2Key, encryptedData, {
            httpMetadata: { contentType: 'application/octet-stream' },
            expires: expiration,
        });

		return new Response(JSON.stringify({ success: true }), {
			headers: { 
                'Content-Type': 'application/json',
                ...corsHeaders // 【新增】为响应添加CORS头
            },
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
        
        return new Response(JSON.stringify({ 
            success: true, 
            encryptedData: object,
        }), {
            headers: { 
                'Content-Type': 'application/json',
                ...corsHeaders // 【新增】为响应添加CORS头
            },
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
		return router.handle(request, env, ctx);
	},
};

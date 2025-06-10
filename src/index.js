/**
 * =================================================================================
 * 欢迎来到 Cloudflare Workers! (端到端加密 + 人机验证最终版)
 * =================================================================================
 *
 * 【架构定型】:
 * 1. 【CORS修复】: 正确处理CORS预检请求(OPTIONS)，允许前端发送 `application/json` 类型的POST请求。
 * 2. 【人机验证】: /convert 接口现在会验证前端提交的Cloudflare Turnstile令牌。
 * 3. 【纯粹的E2EE】: 此后端只负责存储和提取加密数据。所有明文处理逻辑已被移除。
 */

// =================================================================================
// CORS 和 Turnstile 验证模块
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
// API 路由: /convert (只存储加密数据)
// =================================================================================
router.post(/^\/convert$/, async ({ request, env }) => {
	try {
        // 【重要】: 请求体现在包含了turnstileToken
		const { extractionCode, encryptedData, expirationDays, turnstileToken } = await request.json();

        // 【新增】: 人机验证检查
        if (!turnstileToken) {
            return new Response('缺少人机验证令牌。', { status: 403, headers: corsHeaders });
        }
        const userIp = request.headers.get('CF-Connecting-IP');
        const isHuman = await verifyTurnstileToken(turnstileToken, env.TURNSTILE_SECRET, userIp);
        if (!isHuman) {
            return new Response('人机验证失败。', { status: 403, headers: corsHeaders });
        }

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
// 提取路由: /extract (只返回加密数据)
// =================================================================================
router.post(/^\/extract$/, async ({ request, env }) => {
    try {
        const { extractionCode } = await request.json();
        if (!extractionCode) {
            return new Response('Extraction code is required.', { status: 400, headers: corsHeaders });
        }
        
        const r2Key = `e2ee/${extractionCode}`;
        const object = await env.SUB_STORE.get(r2Key, { type: 'text' });

        if (object === null) {
            return new Response('提取码无效或链接已过期。', { status: 404, headers: corsHeaders });
        }
        
        return new Response(JSON.stringify({ 
            success: true, 
            encryptedData: object,
        }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });

    } catch (e) {
        console.error('Extraction error:', e);
        return new Response(`An error occurred: ${e.message}`, { status: 500, headers: corsHeaders });
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

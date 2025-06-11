/**
 * =================================================================================
 * 欢迎来到 Cloudflare Workers! (远程订阅修复最终版)
 * =================================================================================
 *
 * 【架构定型】:
 * 1. 【CORS支持】: 正确处理CORS预检请求(OPTIONS)，允许前端发送 `application/json` 类型的POST请求。
 * 2. 【纯粹的E2EE】: 此后端只负责存储和提取加密数据。所有明文处理逻辑和相关GET路由已被彻底移除。
 * 3. 【远程订阅修复】: 为 /proxy-fetch 接口的 fetch 请求添加了更完整的浏览器请求头，以绕过目标服务器的机器人检测。
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
  // 提取路由: /extract (只返回加密数据)
  // =================================================================================
  router.post(/^\/extract$/, async ({ request, env }) => {
      try {
          const { extractionCode } = await request.json();
          if (!extractionCode) {
              return new Response('Extraction code is required.', { status: 400, headers: corsHeaders });
          }
          
          const r2Key = `e2ee/${extractionCode}`;
          const object = await env.SUB_STORE.get(r2Key);
  
          if (object === null) {
              return new Response('提取码无效或链接已过期。', { status: 404, headers: corsHeaders });
          }
          
          const encryptedDataString = await object.text();
          
          return new Response(JSON.stringify({ 
              success: true, 
              encryptedData: encryptedDataString,
          }), {
              headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
  
      } catch (e) {
          console.error(`[BACKEND LOG] CRITICAL ERROR in /extract: ${e.message}`, e.stack);
          return new Response(`An error occurred during extraction: ${e.message}`, { status: 500, headers: corsHeaders });
      }
  });
  
  // =================================================================================
  // 【已修复】代理获取路由: /proxy-fetch - 用于安全地获取远程订阅
  // =================================================================================
  router.post(/^\/proxy-fetch$/, async ({ request }) => {
      try {
          const { url } = await request.json();
          if (!url || !url.startsWith('http')) {
              return new Response('A valid URL is required.', { status: 400, headers: corsHeaders });
          }
  
          // 【核心修复】: 构造一个更像真实浏览器的请求头
          const browserHeaders = {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
              'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
              'Accept-Encoding': 'gzip, deflate, br',
              'Connection': 'keep-alive',
              'Upgrade-Insecure-Requests': '1',
              'Sec-Fetch-Dest': 'document',
              'Sec-Fetch-Mode': 'navigate',
              'Sec-Fetch-Site': 'none',
              'Sec-Fetch-User': '?1',
          };
  
          const response = await fetch(url, { headers: browserHeaders });
  
          if (!response.ok) {
              // 返回目标服务器的真实状态码和错误信息
              return new Response(`获取远程订阅失败 (状态: ${response.status})`, { status: response.status, headers: corsHeaders });
          }
  
          const content = await response.text();
  
          return new Response(content, {
              headers: { 'Content-Type': 'text/plain;charset=utf-8', ...corsHeaders }
          });
  
      } catch (e) {
          console.error('Proxy fetch error:', e);
          return new Response(`获取远程订阅时发生错误: ${e.message}`, { status: 500, headers: corsHeaders });
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
  
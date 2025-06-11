/**
 * =================================================================================
 * 欢迎来到 Cloudflare Workers! (KV临时链接最终版)
 * =================================================================================
 *
 * 【架构升级】:
 * 1. 【引入KV】: 使用Cloudflare KV作为“阅后即焚”的临时存储，用于存放解密后的明文配置。
 * 2. 【混合模式】: 长期数据在R2中端到端加密存储；临时生成的订阅链接通过KV提供，并设置极短TTL。
 * 3. 【API增强】: 新增 /stage-link 接口用于创建临时链接，并新增 /live/... 路由用于提供临时链接的访问。
 */

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  
  function handleOptions(request) {
    if (request.headers.get('Origin') !== null && request.headers.get('Access-Control-Request-Method') !== null && request.headers.get('Access-Control-Request-Headers') !== null) {
      return new Response(null, { headers: corsHeaders });
    } else {
      return new Response(null, { headers: { Allow: 'POST, OPTIONS' } });
    }
  }
  
  const Router = () => {
      const routes = [];
      const add = (method, path, handler) => routes.push({ method, path, handler });
      const handle = async (request, env, ctx) => {
          if (request.method === 'OPTIONS') { return handleOptions(request); }
          const url = new URL(request.url);
          for (const route of routes) {
              if (request.method !== route.method) continue;
              const match = url.pathname.match(route.path);
              if (match) {
                  const params = match.groups || {};
                  return await route.handler({ request, params, url, env, ctx });
              }
          }
          if (request.method === 'GET') { return serveStaticAsset({ request, env }); }
          return new Response('Not Found', { status: 404 });
      };
      return { get: (path, handler) => add('GET', path, handler), post: (path, handler) => add('POST', path, handler), handle };
  };
  
  const router = Router();
  
  // API 路由: /convert (只存储加密数据)
  router.post(/^\/convert$/, async ({ request, env }) => {
      try {
          const { extractionCode, encryptedData, expirationDays } = await request.json();
          if (!extractionCode || !encryptedData) {
              return new Response('Missing extraction code or encrypted data.', { status: 400, headers: corsHeaders });
          }
          const r2Key = `e2ee/${extractionCode}`;
          const days = parseInt(expirationDays);
          let expiration;
          if (days === 0) { expiration = new Date(Date.now() + 5 * 60 * 1000); } 
          else { expiration = new Date(Date.now() + (days || 7) * 24 * 60 * 60 * 1000); }
          await env.SUB_STORE.put(r2Key, encryptedData, { httpMetadata: { contentType: 'application/octet-stream' }, expires: expiration });
          return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (error) {
          console.error('Storage error:', error);
          return new Response(`Error storing data: ${error.message}`, { status: 500, headers: corsHeaders });
      }
  });
  
  // 提取路由: /extract (只返回加密数据)
  router.post(/^\/extract$/, async ({ request, env }) => {
      try {
          const { extractionCode } = await request.json();
          if (!extractionCode) { return new Response('Extraction code is required.', { status: 400, headers: corsHeaders }); }
          const r2Key = `e2ee/${extractionCode}`;
          const object = await env.SUB_STORE.get(r2Key, { type: 'text' });
          if (object === null) { return new Response('提取码无效或链接已过期。', { status: 404, headers: corsHeaders }); }
          return new Response(JSON.stringify({ success: true, encryptedData: object }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (e) {
          console.error('Extraction error:', e);
          return new Response(`An error occurred during extraction: ${e.message}`, { status: 500, headers: corsHeaders });
      }
  });
  
  // 【新增】暂存路由: /stage-link (接收明文，存入KV，返回临时链接)
  router.post(/^\/stage-link$/, async ({ request, env }) => {
      try {
          const { type, content } = await request.json();
          if (!type || !content) {
              return new Response("Type and content are required.", { status: 400, headers: corsHeaders });
          }
  
          const tempId = crypto.randomUUID();
          // 将明文存入KV，并设置60秒后自动过期
          await env.TEMP_SUBS.put(tempId, content, { expirationTtl: 60 });
  
          const urlBase = new URL(request.url).origin;
          const liveUrl = `${urlBase}/live/${tempId}`;
  
          return new Response(JSON.stringify({ success: true, url: liveUrl }), {
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
      } catch (e) {
          console.error('Staging error:', e);
          return new Response(`Error staging link: ${e.message}`, { status: 500, headers: corsHeaders });
      }
  });
  
  
  // 【新增】临时链接访问路由: /live/:id
  router.get(/^\/live\/(?<id>.+)$/, async ({ params, env }) => {
      const { id } = params;
      const content = await env.TEMP_SUBS.get(id, { type: "text" });
  
      if (content === null) {
          return new Response("Link expired or not found.", { status: 404 });
      }
      
      // （可选）实现一次性链接：获取后立即删除
      // await env.TEMP_SUBS.delete(id);
  
      return new Response(content, {
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
  });
  
  
  // 静态资源服务
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
  
  // Worker 入口点
  export default {
      async fetch(request, env, ctx) {
          return router.handle(request, env, ctx);
      },
  };  
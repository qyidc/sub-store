/**
 * =================================================================================
 * 欢迎来到 Cloudflare Workers! (永久保存与删除最终版)
 * =================================================================================
 *
 * 【架构定型】:
 * 1. 【永久保存】: /convert 接口现在支持永久保存选项。
 * 2. 【安全删除】: 新增 /delete 接口，允许用户通过提取码删除其存储的加密数据。
 * 3. 【功能完备】: 这是为当前所有功能设计的最终稳定版后端代码。
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
  // 路由模块
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
          const r2Options = { httpMetadata: { contentType: 'application/octet-stream' } };
  
          // 【升级】: 如果days为-1，则不设置expires属性，实现永久保存
          if (days >= 0) {
              let expiration;
              if (days === 0) {
                  expiration = new Date(Date.now() + 5 * 60 * 1000); 
              } else {
                  expiration = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
              }
              r2Options.expires = expiration;
          }
  
          await env.SUB_STORE.put(r2Key, encryptedData, r2Options);
  
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
          if (!extractionCode) { return new Response('Extraction code is required.', { status: 400, headers: corsHeaders }); }
          const r2Key = `e2ee/${extractionCode}`;
          const object = await env.SUB_STORE.get(r2Key);
          if (object === null) { return new Response('提取码无效或链接已过期。', { status: 404, headers: corsHeaders }); }
          const encryptedDataString = await object.text();
          return new Response(JSON.stringify({ success: true, encryptedData: encryptedDataString }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (e) {
          console.error(`[BACKEND LOG] CRITICAL ERROR in /extract: ${e.message}`, e.stack);
          return new Response(`An error occurred during extraction: ${e.message}`, { status: 500, headers: corsHeaders });
      }
  });
  
  // =================================================================================
  // 代理获取路由: /proxy-fetch
  // =================================================================================
  router.post(/^\/proxy-fetch$/, async ({ request }) => {
      try {
          const { url } = await request.json();
          if (!url || !url.startsWith('http')) {
              return new Response('A valid URL is required.', { status: 400, headers: corsHeaders });
          }
          const browserHeaders = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36','Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9','Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',};
          const response = await fetch(url, { headers: browserHeaders });
          if (!response.ok) {
              return new Response(`获取远程订阅失败 (状态: ${response.status})`, { status: response.status, headers: corsHeaders });
          }
          const content = await response.text();
          return new Response(content, { headers: { 'Content-Type': 'text/plain;charset=utf-8', ...corsHeaders } });
      } catch (e) {
          console.error('Proxy fetch error:', e);
          return new Response(`获取远程订阅时发生错误: ${e.message}`, { status: 500, headers: corsHeaders });
      }
  });
  
  // =================================================================================
  // 【新增】删除路由: /delete
  // =================================================================================
  router.post(/^\/delete$/, async ({ request, env }) => {
      try {
          const { extractionCode } = await request.json();
          if (!extractionCode) {
              return new Response("需要提供提取码。", { status: 400, headers: corsHeaders });
          }
  
          const r2Key = `e2ee/${extractionCode}`;
  
          // 先检查文件是否存在，以提供更友好的反馈
          const object = await env.SUB_STORE.head(r2Key);
          if (object === null) {
              return new Response("提取码无效或链接已被删除/已过期。", { status: 404, headers: corsHeaders });
          }
  
          // 删除文件
          await env.SUB_STORE.delete(r2Key);
  
          return new Response(JSON.stringify({ success: true, message: `提取码为 "${extractionCode.substring(0,8)}..." 的链接已成功删除。` }), {
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
  
      } catch (e) {
          console.error('Deletion error:', e);
          return new Response(`删除时发生错误: ${e.message}`, { status: 500, headers: corsHeaders });
      }
  });
  
  
  // =================================================================================
  // 暂存和临时链接路由
  // =================================================================================
  router.post(/^\/stage-link$/, async ({ request, env }) => {
      try {
          if (!env.TEMP_SUBS) { throw new Error("KV namespace 'TEMP_SUBS' is not configured on this worker."); }
          const { type, content } = await request.json();
          if (!type || !content) { return new Response("Type and content are required.", { status: 400, headers: corsHeaders }); }
          const tempId = crypto.randomUUID();
          await env.TEMP_SUBS.put(tempId, content, { expirationTtl: 60 });
          const urlBase = new URL(request.url).origin;
          const liveUrl = `${urlBase}/live/${tempId}`;
          return new Response(JSON.stringify({ success: true, url: liveUrl }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (e) {
          console.error('Staging error:', e);
          return new Response(`Error staging link: ${e.message}`, { status: 500, headers: corsHeaders });
      }
  });
  
  router.get(/^\/live\/(?<id>.+)$/, async ({ params, env }) => {
      const { id } = params;
      if (!env.TEMP_SUBS) { return new Response("Temporary storage is not configured.", { status: 500 }); }
      const content = await env.TEMP_SUBS.get(id, { type: "text" });
      if (content === null) { return new Response("Link expired or not found.", { status: 404 }); }
      return new Response(content, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  });
  
  
  // =================================================================================
  // 静态资源服务
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
  // Worker 入口点
  // =================================================================================
  export default {
      async fetch(request, env, ctx) {
          return router.handle(request, env, ctx);
      },
  };  

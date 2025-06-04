import { decode } from 'base64-js'
import { TextDecoder } from 'text-encoding'

// 前端HTML页面内容
const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <!-- 此处插入之前提供的完整HTML内容 -->
</head>
<body>
    <!-- 此处插入之前提供的完整HTML内容 -->
    <script>
        // 前端JavaScript逻辑（已更新实际请求处理）
        document.addEventListener('DOMContentLoaded', function() {
            // ... 之前的JavaScript代码 ...
            
            // 更新转换按钮点击事件
            convertBtn.addEventListener('click', async function() {
                const url = subscriptionUrl.value.trim();
                
                if (!url) {
                    showStatus('请输入有效的订阅链接', 'error');
                    return;
                }
                
                showStatus('正在处理您的订阅链接...', 'loading');
                
                try {
                    // 发送转换请求到Worker
                    const response = await fetch('/convert', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ url })
                    });
                    
                    if (!response.ok) {
                        throw new Error(`转换失败: ${response.status}`);
                    }
                    
                    const result = await response.json();
                    
                    // 显示结果
                    resultContent.textContent = result.config;
                    resultContainer.style.display = 'block';
                    downloadBtn.style.display = 'flex';
                    
                    showStatus('转换成功！', 'success');
                } catch (error) {
                    showStatus('转换失败: ' + error.message, 'error');
                }
            });
            
            // ... 其他事件监听器保持不变 ...
        });
    </script>
</body>
</html>`;

// 订阅转换处理
async function convertSubscription(url) {
    try {
        // 1. 获取订阅内容
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`订阅获取失败: ${response.status}`);
        }
        
        // 2. 解析订阅内容（这里简化处理，实际需要完整解析）
        const contentType = response.headers.get('content-type') || '';
        let content;
        
        if (contentType.includes('base64')) {
            const text = await response.text();
            const decoded = decode(text);
            content = new TextDecoder().decode(decoded);
        } else {
            content = await response.text();
        }
        
        // 3. 转换为Clash配置（简化版）
        return `# Clash 配置文件由订阅转换工具生成
# 原始订阅: ${url}
# 生成时间: ${new Date().toLocaleString()}

mixed-port: 7890
allow-lan: true
mode: rule
log-level: info
external-controller: 127.0.0.1:9090

proxies:
  - name: "转换节点"
    type: ss
    server: proxy.example.com
    port: 443
    cipher: aes-256-gcm
    password: "your-password"
    udp: true

proxy-groups:
  - name: "自动选择"
    type: url-test
    proxies: ["转换节点"]
    url: "http://www.gstatic.com/generate_204"
    interval: 300

rules:
  - DOMAIN-SUFFIX,google.com,自动选择
  - DOMAIN-SUFFIX,youtube.com,自动选择
  - GEOIP,CN,DIRECT
  - MATCH,自动选择

# 原始订阅内容（Base64编码）:
# ${btoa(content).substring(0, 200)}...`;
    } catch (error) {
        throw new Error(`转换失败: ${error.message}`);
    }
}

export default {
    async fetch(request) {
        const url = new URL(request.url);
        
        // 返回前端页面
        if (url.pathname === '/') {
            return new Response(HTML, {
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
        }
        
        // 处理转换请求
        if (url.pathname === '/convert') {
            try {
                const { url: subUrl } = await request.json();
                const config = await convertSubscription(subUrl);
                
                return new Response(JSON.stringify({ success: true, config }), {
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (error) {
                return new Response(JSON.stringify({ 
                    success: false, 
                    message: error.message 
                }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        }
        
        // 处理其他请求
        return new Response('Not found', { status: 404 });
    }
}

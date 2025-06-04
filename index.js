<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>订阅转换工具 - Clash配置生成器</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <script src="https://cdn.jsdelivr.net/npm/js-base64@3.7.5/base64.min.js"></script>
    <style>
        :root {
            --primary: #4a6cf7;
            --primary-dark: #3a56d7;
            --secondary: #6c757d;
            --success: #10b981;
            --dark: #1e293b;
            --light: #f8fafc;
            --card-bg: #ffffff;
            --card-shadow: rgba(0, 0, 0, 0.1);
            --border-radius: 16px;
            --transition: all 0.3s ease;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
        }

        body {
            background: linear-gradient(135deg, #0f172a, #1e293b);
            color: var(--light);
            min-height: 100vh;
            padding: 2rem 1rem;
            line-height: 1.6;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
        }

        header {
            text-align: center;
            margin-bottom: 2.5rem;
            padding: 0 1rem;
        }

        header h1 {
            font-size: 2.5rem;
            margin-bottom: 0.5rem;
            background: linear-gradient(to right, #4a6cf7, #10b981);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            font-weight: 800;
        }

        header p {
            color: #cbd5e1;
            font-size: 1.1rem;
            max-width: 700px;
            margin: 0 auto;
        }

        .logo {
            font-size: 3rem;
            margin-bottom: 1rem;
            color: var(--primary);
        }

        .card-grid {
            display: grid;
            grid-template-columns: 1fr;
            gap: 2rem;
        }

        @media (min-width: 768px) {
            .card-grid {
                grid-template-columns: 1fr 1fr;
            }
        }

        .card {
            background: var(--card-bg);
            border-radius: var(--border-radius);
            box-shadow: 0 10px 30px var(--card-shadow);
            overflow: hidden;
            transition: var(--transition);
        }

        .card:hover {
            transform: translateY(-5px);
            box-shadow: 0 15px 40px rgba(0, 0, 0, 0.15);
        }

        .card-header {
            background: linear-gradient(135deg, var(--primary), var(--primary-dark));
            color: white;
            padding: 1.5rem;
            font-size: 1.25rem;
            font-weight: 600;
            display: flex;
            align-items: center;
        }

        .card-header i {
            margin-right: 0.75rem;
            font-size: 1.5rem;
        }

        .card-body {
            padding: 2rem;
            color: var(--dark);
        }

        .form-group {
            margin-bottom: 1.5rem;
        }

        label {
            display: block;
            margin-bottom: 0.5rem;
            font-weight: 600;
            color: #334155;
        }

        .input-group {
            display: flex;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
        }

        .input-group input {
            flex: 1;
            padding: 0.9rem 1.2rem;
            border: none;
            font-size: 1rem;
            background: #f1f5f9;
            color: #334155;
        }

        .input-group input:focus {
            outline: none;
            background: #e2e8f0;
        }

        .btn {
            display: inline-block;
            padding: 0.9rem 1.8rem;
            border: none;
            border-radius: 8px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: var(--transition);
            text-align: center;
        }

        .btn-primary {
            background: var(--primary);
            color: white;
            width: 100%;
        }

        .btn-primary:hover {
            background: var(--primary-dark);
            transform: translateY(-2px);
        }

        .btn-download {
            background: var(--success);
            color: white;
            width: 100%;
            margin-top: 1rem;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
        }

        .btn-download:hover {
            background: #0da271;
            transform: translateY(-2px);
        }

        .result-container {
            display: none;
            margin-top: 1.5rem;
            border-radius: 8px;
            background: #f1f5f9;
            padding: 1.5rem;
            max-height: 300px;
            overflow-y: auto;
        }

        .result-title {
            font-weight: 600;
            margin-bottom: 0.75rem;
            color: #334155;
            display: flex;
            justify-content: space-between;
        }

        .result-content {
            font-family: monospace;
            font-size: 0.9rem;
            white-space: pre-wrap;
            word-break: break-all;
            color: #475569;
            line-height: 1.8;
        }

        .card-footer {
            padding: 1.5rem;
            background: #f8fafc;
            border-top: 1px solid #e2e8f0;
            color: #64748b;
            font-size: 0.9rem;
        }

        .features {
            padding: 0;
            margin: 0;
            list-style: none;
        }

        .features li {
            padding: 0.5rem 0;
            display: flex;
            align-items: flex-start;
        }

        .features li i {
            color: var(--success);
            margin-right: 0.75rem;
            margin-top: 0.25rem;
        }

        .status {
            display: flex;
            align-items: center;
            margin-top: 1rem;
            padding: 0.75rem;
            border-radius: 8px;
            background: #f1f5f9;
            color: #334155;
            display: none;
        }

        .status i {
            margin-right: 0.75rem;
            font-size: 1.2rem;
        }

        .spinner {
            animation: spin 1s linear infinite;
            margin-right: 0.75rem;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        footer {
            text-align: center;
            margin-top: 3rem;
            padding-top: 2rem;
            color: #94a3b8;
            font-size: 0.9rem;
            border-top: 1px solid #334155;
        }

        .step {
            display: flex;
            align-items: center;
            margin-bottom: 1.5rem;
            padding: 1rem;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 12px;
        }

        .step-number {
            background: var(--primary);
            color: white;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-right: 1rem;
            flex-shrink: 0;
        }

        .step-content h3 {
            margin-bottom: 0.25rem;
            color: white;
        }

        .step-content p {
            color: #cbd5e1;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <div class="logo">
                <i class="fas fa-exchange-alt"></i>
            </div>
            <h1>Clash订阅转换工具</h1>
            <p>轻松将您的通用订阅链接转换为Clash配置文件，支持SS、SSR、V2Ray、Trojan等多种协议</p>
        </header>

        <div class="step">
            <div class="step-number">1</div>
            <div class="step-content">
                <h3>获取通用订阅链接</h3>
                <p>从您的服务提供商处获取标准订阅链接（通常以ss://、vmess://、trojan://开头）</p>
            </div>
        </div>

        <div class="card-grid">
            <div class="card">
                <div class="card-header">
                    <i class="fas fa-link"></i>
                    订阅转换
                </div>
                <div class="card-body">
                    <div class="form-group">
                        <label for="subscriptionUrl">订阅链接：</label>
                        <div class="input-group">
                            <input type="url" id="subscriptionUrl" placeholder="https://example.com/subscribe" autocomplete="off">
                        </div>
                    </div>
                    
                    <button id="convertBtn" class="btn btn-primary">
                        <i class="fas fa-sync-alt"></i> 转换为Clash配置
                    </button>
                    
                    <div id="status" class="status">
                        <i class="fas fa-spinner spinner"></i>
                        <span>正在处理您的订阅链接...</span>
                    </div>
                    
                    <div id="resultContainer" class="result-container">
                        <div class="result-title">
                            <span>转换结果预览</span>
                            <button id="copyBtn" class="btn" style="padding: 0.25rem 0.75rem; font-size: 0.85rem; background: #e2e8f0;">
                                <i class="far fa-copy"></i> 复制
                            </button>
                        </div>
                        <div id="resultContent" class="result-content"></div>
                    </div>
                    
                    <button id="downloadBtn" class="btn btn-download">
                        <i class="fas fa-download"></i> 下载Clash配置文件
                    </button>
                </div>
                <div class="card-footer">
                    <p><i class="fas fa-info-circle"></i> 您的订阅链接仅用于转换处理，不会被存储或用于其他目的</p>
                </div>
            </div>
            
            <div class="card">
                <div class="card-header">
                    <i class="fas fa-star"></i>
                    功能特点
                </div>
                <div class="card-body">
                    <ul class="features">
                        <li>
                            <i class="fas fa-check-circle"></i>
                            <div>
                                <strong>多协议支持</strong>
                                <p>支持SS、SSR、V2Ray、Trojan等主流协议转换</p>
                            </div>
                        </li>
                        <li>
                            <i class="fas fa-check-circle"></i>
                            <div>
                                <strong>完全本地处理</strong>
                                <p>转换过程在您的浏览器中完成，保护隐私安全</p>
                            </div>
                        </li>
                        <li>
                            <i class="fas fa-check-circle"></i>
                            <div>
                                <strong>自动节点检测</strong>
                                <p>智能识别并处理订阅中的多个节点信息</p>
                            </div>
                        </li>
                        <li>
                            <i class="fas fa-check-circle"></i>
                            <div>
                                <strong>优化配置</strong>
                                <p>生成经过优化的Clash配置文件，提升使用体验</p>
                            </div>
                        </li>
                        <li>
                            <i class="fas fa-check-circle"></i>
                            <div>
                                <strong>一键下载</strong>
                                <p>转换后可直接下载配置文件，方便导入Clash客户端</p>
                            </div>
                        </li>
                    </ul>
                </div>
                <div class="card-footer">
                    <p><i class="fas fa-exclamation-triangle"></i> 请确保您使用的订阅服务符合当地法律法规</p>
                </div>
            </div>
        </div>

        <div class="step">
            <div class="step-number">2</div>
            <div class="step-content">
                <h3>导入Clash客户端</h3>
                <p>下载生成的YAML配置文件，导入到Clash for Windows、ClashX等客户端中使用</p>
            </div>
        </div>
        
        <footer>
            <p>© 2023 Clash订阅转换工具 | 基于Cloudflare Workers构建</p>
            <p>本工具仅用于技术交流，请遵守当地法律法规使用</p>
        </footer>
    </div>

    <script>
        document.addEventListener('DOMContentLoaded', function() {
            const convertBtn = document.getElementById('convertBtn');
            const downloadBtn = document.getElementById('downloadBtn');
            const copyBtn = document.getElementById('copyBtn');
            const subscriptionUrl = document.getElementById('subscriptionUrl');
            const resultContainer = document.getElementById('resultContainer');
            const resultContent = document.getElementById('resultContent');
            const status = document.getElementById('status');
            
            // 示例订阅链接（演示用）
            const sampleLinks = [
                'https://example.com/subscribe/ss',
                'https://sub.example.org/vmess',
                'https://myproxy.com/trojan-sub'
            ];
            
            // 随机选择一个示例链接
            subscriptionUrl.placeholder = sampleLinks[Math.floor(Math.random() * sampleLinks.length)];
            
            // 转换按钮点击事件
            convertBtn.addEventListener('click', async function() {
                const url = subscriptionUrl.value.trim();
                
                if (!url) {
                    showStatus('请输入有效的订阅链接', 'error');
                    return;
                }
                
                showStatus('正在处理您的订阅链接...', 'loading');
                
                try {
                    // 模拟处理延迟
                    await new Promise(resolve => setTimeout(resolve, 1500));
                    
                    // 这里是实际应用中调用Worker的代码
                    // const response = await fetch('/convert', {
                    //   method: 'POST',
                    //   headers: {
                    //     'Content-Type': 'application/json'
                    //   },
                    //   body: JSON.stringify({ url })
                    // });
                    // 
                    // const result = await response.json();
                    
                    // 演示用 - 生成模拟结果
                    const result = generateDemoResult(url);
                    
                    // 显示结果
                    resultContent.textContent = result.config;
                    resultContainer.style.display = 'block';
                    downloadBtn.style.display = 'flex';
                    
                    showStatus('转换成功！', 'success');
                } catch (error) {
                    showStatus('转换失败: ' + error.message, 'error');
                }
            });
            
            // 下载按钮点击事件
            downloadBtn.addEventListener('click', function() {
                const config = resultContent.textContent;
                if (!config) {
                    showStatus('没有可下载的配置', 'error');
                    return;
                }
                
                const blob = new Blob([config], { type: 'application/yaml' });
                const url = URL.createObjectURL(blob);
                
                const a = document.createElement('a');
                a.href = url;
                a.download = 'clash-config.yaml';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                showStatus('配置文件已下载', 'success');
            });
            
            // 复制按钮点击事件
            copyBtn.addEventListener('click', function() {
                const config = resultContent.textContent;
                if (!config) return;
                
                navigator.clipboard.writeText(config)
                    .then(() => {
                        const originalText = copyBtn.innerHTML;
                        copyBtn.innerHTML = '<i class="fas fa-check"></i> 已复制';
                        setTimeout(() => {
                            copyBtn.innerHTML = originalText;
                        }, 2000);
                    })
                    .catch(err => {
                        console.error('复制失败: ', err);
                    });
            });
            
            // 显示状态信息
            function showStatus(message, type) {
                status.style.display = 'flex';
                const icon = status.querySelector('i');
                
                icon.className = 'fas ';
                
                switch(type) {
                    case 'loading':
                        icon.classList.add('fa-spinner', 'spinner');
                        status.style.background = '#f1f5f9';
                        status.style.color = '#334155';
                        break;
                    case 'success':
                        icon.classList.add('fa-check-circle');
                        status.style.background = '#d1fae5';
                        status.style.color = '#065f46';
                        break;
                    case 'error':
                        icon.classList.add('fa-exclamation-circle');
                        status.style.background = '#fee2e2';
                        status.style.color = '#b91c1c';
                        break;
                }
                
                status.querySelector('span').textContent = message;
                
                if (type !== 'loading') {
                    setTimeout(() => {
                        status.style.display = 'none';
                    }, 3000);
                }
            }
            
            // 生成演示用的结果（实际应用中由Worker返回）
            function generateDemoResult(url) {
                const now = new Date();
                return {
                    config: `# Clash 配置文件由订阅转换工具生成
# 生成时间: ${now.toLocaleString()}
# 原始订阅: ${url}

mixed-port: 7890
allow-lan: true
mode: rule
log-level: info
external-controller: 127.0.0.1:9090

proxies:
  - name: "美国节点 01"
    type: ss
    server: us01.example.com
    port: 443
    cipher: aes-256-gcm
    password: "password123"
    udp: true
  
  - name: "日本节点 02"
    type: vmess
    server: jp02.example.com
    port: 443
    uuid: "a1b2c3d4-e5f6-7890-g1h2-i3j4k5l6m7n8"
    alterId: 0
    cipher: auto
    udp: true
    tls: true
    network: ws
    ws-path: "/path"
    ws-headers:
      Host: "example.com"
  
  - name: "香港节点 03"
    type: trojan
    server: hk03.example.com
    port: 443
    password: "trojan_password"
    udp: true
    sni: "example.com"

proxy-groups:
  - name: "自动选择"
    type: url-test
    proxies:
      - "美国节点 01"
      - "日本节点 02"
      - "香港节点 03"
    url: "http://www.gstatic.com/generate_204"
    interval: 300

  - name: "全球加速"
    type: select
    proxies:
      - "自动选择"
      - "美国节点 01"
      - "日本节点 02"
      - "香港节点 03"

rules:
  - DOMAIN-SUFFIX,google.com,全球加速
  - DOMAIN-SUFFIX,youtube.com,全球加速
  - DOMAIN-SUFFIX,twitter.com,全球加速
  - DOMAIN-SUFFIX,instagram.com,全球加速
  - DOMAIN-SUFFIX,github.com,全球加速
  - GEOIP,CN,DIRECT
  - MATCH,全球加速`
                };
            }
        });
    </script>
</body>
</html>

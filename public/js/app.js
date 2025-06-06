// DOM元素
const tabButtons = document.querySelectorAll('.tab-button');
const tabContents = document.querySelectorAll('.tab-content');
const nodeLinksTextarea = document.getElementById('node-links');
const remoteSubsTextarea = document.getElementById('remote-subscriptions');
const convertButton = document.getElementById('convert-button');
const convertButtonText = document.getElementById('convert-button-text');
const convertLoader = document.getElementById('convert-loader');
const resultsArea = document.getElementById('results-area');
const yamlOutputPre = document.getElementById('yaml-output');
const copyYamlButton = document.getElementById('copy-yaml-button');
const subscriptionLinkInput = document.getElementById('subscription-link');
const copyLinkButton = document.getElementById('copy-link-button');
const toastMessageDiv = document.getElementById('toast-message');
const statsArea = document.getElementById('stats-area');
const localCountSpan = document.getElementById('local-count');
const remoteCountSpan = document.getElementById('remote-count');
const totalCountSpan = document.getElementById('total-count');

// 标签切换
tabButtons.forEach(button => {
    button.addEventListener('click', () => {
        tabButtons.forEach(btn => btn.classList.remove('active'));
        tabContents.forEach(content => content.classList.remove('active'));
        
        button.classList.add('active');
        const tabId = button.getAttribute('data-tab');
        document.getElementById(tabId).classList.add('active');
    });
});

// 转换按钮点击事件
convertButton.addEventListener('click', async () => {
    const localLinks = nodeLinksTextarea.value.trim().split('\n').filter(link => link.trim());
    const remoteSubs = remoteSubsTextarea.value.trim().split('\n').filter(sub => sub.trim());
    
    if (localLinks.length === 0 && remoteSubs.length === 0) {
        showToast('请输入节点链接或远程订阅URL!', 'error');
        return;
    }

    // 显示加载状态
    convertButton.disabled = true;
    convertButtonText.textContent = '处理中...';
    convertLoader.style.display = 'block';
    resultsArea.classList.add('hidden');
    statsArea.classList.add('hidden');

    try {
        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                links: localLinks,
                remoteSubs: remoteSubs
            }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `请求失败: HTTP ${response.status}`);
        }

        const data = await response.json();
        if (data.yaml && data.subscriptionLink) {
            yamlOutputPre.textContent = data.yaml;
            subscriptionLinkInput.value = data.subscriptionLink;
            resultsArea.classList.remove('hidden');
            
            // 更新统计信息
            if (data.stats) {
                localCountSpan.textContent = data.stats.localProxies;
                remoteCountSpan.textContent = data.stats.remoteProxies;
                totalCountSpan.textContent = data.stats.totalProxies;
                statsArea.classList.remove('hidden');
            }
            
            showToast('转换成功!', 'success');
        } else {
            throw new Error('服务器返回的数据格式不正确');
        }
    } catch (error) {
        console.error('转换出错:', error);
        showToast(`转换出错: ${error.message}`, 'error', 5000);
    } finally {
        convertButton.disabled = false;
        convertButtonText.textContent = '生成配置和订阅';
        convertLoader.style.display = 'none';
    }
});

// 复制功能
copyYamlButton.addEventListener('click', () => {
    copyToClipboard(yamlOutputPre.textContent, 'YAML配置已复制!');
});

copyLinkButton.addEventListener('click', () => {
    copyToClipboard(subscriptionLinkInput.value, '订阅链接已复制!');
});

// 辅助函数
function showToast(message, type = 'success', duration = 3000) {
    toastMessageDiv.textContent = message;
    toastMessageDiv.className = `toast ${type} show`;
    
    setTimeout(() => {
        toastMessageDiv.className = `toast ${type}`;
    }, duration);
}

function copyToClipboard(text, successMessage) {
    if (!text) return;
    
    navigator.clipboard.writeText(text).then(() => {
        showToast(successMessage, 'success');
    }).catch(err => {
        console.error('复制失败:', err);
        showToast('复制失败!', 'error');
    });
}

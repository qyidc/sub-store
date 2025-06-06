// --- DOM Elements ---
const nodeLinksTextarea = document.getElementById('node-links');
const convertButton = document.getElementById('convert-button');
const convertButtonText = document.getElementById('convert-button-text');
const convertIcon = document.getElementById('convert-icon');
const convertLoader = document.getElementById('convert-loader');

const resultsArea = document.getElementById('results-area');
const yamlOutputPre = document.getElementById('yaml-output');
const copyYamlButton = document.getElementById('copy-yaml-button');
const subscriptionLinkInput = document.getElementById('subscription-link');
const copyLinkButton = document.getElementById('copy-link-button');
const toastMessageDiv = document.getElementById('toast-message');

// --- Toast Notification Function ---
function showToast(message, type = 'success', duration = 3000) {
    toastMessageDiv.textContent = message;
    toastMessageDiv.className = `toast ${type} show`; 
    setTimeout(() => {
        toastMessageDiv.className = `toast ${type}`; 
    }, duration);
}

// --- Event Listeners ---
convertButton.addEventListener('click', async () => {
    const linksRaw = nodeLinksTextarea.value.trim();
    if (!linksRaw) {
        showToast('请输入节点链接!', 'error');
        nodeLinksTextarea.focus();
        return;
    }

    const links = linksRaw.split('\n').map(link => link.trim()).filter(link => link);
    if (links.length === 0) {
        showToast('请输入有效的节点链接!', 'error');
        nodeLinksTextarea.focus();
        return;
    }

    convertButton.disabled = true;
    convertButtonText.textContent = '处理中...';
    convertIcon.classList.add('hidden');
    convertLoader.classList.remove('hidden');
    resultsArea.classList.add('hidden');

    try {
        const apiUrl = new URL('/api/generate', window.location.origin).toString();
        const response = await fetch(apiUrl, { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ links }),
        });

        if (!response.ok) {
            let errorPayload = { error: `转换失败 (HTTP ${response.status})`, details: '', stack: '' };
            let responseTextContent = '';
            try {
                responseTextContent = await response.text(); 
                try {
                    const jsonData = JSON.parse(responseTextContent);
                    if (jsonData && jsonData.error) errorPayload = jsonData; 
                    else {
                        errorPayload.error = `Worker返回了状态 ${response.status} 但非标准错误JSON`;
                        errorPayload.details = `收到JSON: ${responseTextContent.substring(0, 150)}...`;
                    }
                } catch (jsonParseError) {
                    console.warn(`Worker error response (status ${response.status}) was text, not JSON:`, responseTextContent.substring(0,300));
                    errorPayload.error = `转换失败 (HTTP ${response.status})`;
                    errorPayload.details = `Worker返回了文本响应: ${responseTextContent.substring(0, 200)}...`;
                }
            } catch (textReadError) {
                console.error(`无法读取Worker错误响应的文本内容 (status ${response.status}). Error:`, textReadError.message);
                errorPayload.error = `转换失败 (HTTP ${response.status})`;
                errorPayload.details = '无法读取Worker的错误响应内容。';
            }
            let errorMessageForToast = errorPayload.error;
            if (errorPayload.details) errorMessageForToast += ` (详情: ${errorPayload.details.substring(0,200)})`; 
            if (errorPayload.stack) console.error("Worker error stack (if provided):", errorPayload.stack);
            throw new Error(errorMessageForToast);
        }

        const data = await response.json(); 
        if (data.yaml && data.subscriptionLink) {
            yamlOutputPre.textContent = data.yaml;
            subscriptionLinkInput.value = data.subscriptionLink;
            resultsArea.classList.remove('hidden');
            showToast('转换成功!', 'success');
        } else {
            throw new Error(data.error || '从服务器返回的数据格式不正确');
        }
    } catch (error) { 
        console.error('Error during conversion process:', error.message);
        showToast(`转换出错: ${error.message}`, 'error', 7000); 
        resultsArea.classList.add('hidden');
    } finally {
        convertButton.disabled = false;
        convertButtonText.textContent = '生成配置和订阅';
        convertIcon.classList.remove('hidden');
        convertLoader.classList.add('hidden');
    }
});

copyYamlButton.addEventListener('click', () => copyToClipboard(yamlOutputPre.textContent, 'YAML 配置已复制!'));
copyLinkButton.addEventListener('click', () => copyToClipboard(subscriptionLinkInput.value, '订阅链接已复制!'));

function copyToClipboard(text, successMessage) {
    if (!text) return;
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed'; 
    document.body.appendChild(textArea);
    textArea.focus(); textArea.select();
    try { document.execCommand('copy'); showToast(successMessage, 'success'); } 
    catch (err) { showToast('复制失败!', 'error'); console.error('Fallback: Oops, unable to copy', err); }
    document.body.removeChild(textArea);
}
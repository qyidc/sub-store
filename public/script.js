document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const subInput = document.getElementById('sub-input');
    const convertBtn = document.getElementById('convert-btn');
    const clearBtn = document.getElementById('clear-btn');
    const resultArea = document.getElementById('result-area');
    
    const clashSubUrlEl = document.getElementById('clash-sub-url');
    const copyClashSubBtn = document.getElementById('copy-clash-sub-btn');

    const clashDownloadBtn = document.getElementById('clash-download-btn');
    const singboxDownloadBtn = document.getElementById('singbox-download-btn');
    
    const errorMessage = document.getElementById('error-message');
    const errorText = document.getElementById('error-text');
    const btnText = document.getElementById('btn-text');
    const loader = document.getElementById('loader');

    // --- Event Listeners ---

    convertBtn.addEventListener('click', async () => {
        const inputData = subInput.value.trim();
        if (!inputData) {
            showError('输入框不能为空。');
            return;
        }

        setLoading(true);
        hideError();
        resultArea.classList.add('hidden');

        try {
            const response = await fetch('/convert', {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
                body: inputData,
            });

            const responseText = await response.text();
            if (!response.ok) {
                throw new Error(responseText || `服务器错误: ${response.status}`);
            }

            const result = JSON.parse(responseText);

            if (result.success) {
                clashSubUrlEl.textContent = result.clashSubUrl;
                clashDownloadBtn.href = result.clashDownloadUrl;
                singboxDownloadBtn.href = result.singboxDownloadUrl;
                resultArea.classList.remove('hidden');
            } else {
                 throw new Error(result.message || '转换失败，但未提供明确原因。');
            }

        } catch (error) {
            console.error('Fetch error:', error);
            showError(error.message);
        } finally {
            setLoading(false);
        }
    });

    clearBtn.addEventListener('click', () => {
        subInput.value = '';
        resultArea.classList.add('hidden');
        hideError();
    });
    
    subInput.addEventListener('input', () => {
        hideError();
    });

    copyClashSubBtn.addEventListener('click', () => {
        const urlToCopy = clashSubUrlEl.textContent;
        if (navigator.clipboard) {
            navigator.clipboard.writeText(urlToCopy).then(() => {
                const originalText = copyClashSubBtn.textContent;
                copyClashSubBtn.textContent = '已复制!';
                setTimeout(() => { copyClashSubBtn.textContent = originalText; }, 2000);
            }).catch(err => {
                showError('复制失败: ' + err);
            });
        } else {
            // Fallback for older browsers
            const textArea = document.createElement("textarea");
            textArea.value = urlToCopy;
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            try {
                document.execCommand('copy');
                const originalText = copyClashSubBtn.textContent;
                copyClashSubBtn.textContent = '已复制!';
                setTimeout(() => { copyClashSubBtn.textContent = originalText; }, 2000);
            } catch (err) {
                showError('复制失败: ' + err);
            }
            document.body.removeChild(textArea);
        }
    });

    // --- Helper Functions ---

    function setLoading(isLoading) {
        if (isLoading) {
            convertBtn.disabled = true;
            convertBtn.classList.add('is-loading', 'cursor-not-allowed');
            loader.classList.remove('hidden');
            btnText.classList.add('hidden');
        } else {
            convertBtn.disabled = false;
            convertBtn.classList.remove('is-loading', 'cursor-not-allowed');
            loader.classList.add('hidden');
            btnText.classList.remove('hidden');
        }
    }

    function showError(message) {
        errorText.textContent = message;
        errorMessage.classList.remove('hidden');
    }

    function hideError() {
        errorMessage.classList.add('hidden');
    }
});

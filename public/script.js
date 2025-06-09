document.addEventListener('DOMContentLoaded', () => {
    // --- Part 1: Conversion Elements ---
    const subInput = document.getElementById('sub-input');
    const expirationSelect = document.getElementById('expiration-select');
    const passwordInput = document.getElementById('password-input');
    const convertBtn = document.getElementById('convert-btn');
    const convertResultArea = document.getElementById('convert-result-area');
    const clashIdDisplay = document.getElementById('clash-id-display');
    const singboxIdDisplay = document.getElementById('singbox-id-display');
    const passwordDisplay = document.getElementById('password-display');
    const convertBtnText = document.getElementById('btn-text');
    const convertLoader = document.getElementById('loader');

    // --- Part 2: Extraction Elements ---
    const extractIdInput = document.getElementById('extract-id-input');
    const extractPasswordInput = document.getElementById('extract-password-input');
    const extractBtn = document.getElementById('extract-btn');
    const extractResultArea = document.getElementById('extract-result-area');
    const finalUrlDisplay = document.getElementById('final-url-display');
    const extractBtnText = document.getElementById('extract-btn-text');
    const extractLoader = document.getElementById('extract-loader');

    // --- Universal Elements ---
    const errorMessage = document.getElementById('error-message');
    const errorText = document.getElementById('error-text');

    // --- Event Listeners ---

    // 1. Conversion Logic
    convertBtn.addEventListener('click', async () => {
        const inputData = subInput.value.trim();
        if (!inputData) {
            showError('订阅链接或分享链接不能为空。');
            return;
        }

        setLoading(convertBtn, convertLoader, convertBtnText, true);
        hideError();
        convertResultArea.classList.add('hidden');

        try {
            const requestBody = {
                subscription_data: inputData,
                password: passwordInput.value,
                expirationDays: expirationSelect.value,
            };

            const response = await fetch('/convert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            });

            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.message || `服务器错误: ${response.status}`);
            }

            if (result.success) {
                clashIdDisplay.textContent = result.clashId;
                singboxIdDisplay.textContent = result.singboxId;
                if(result.passwordProtected) {
                    passwordDisplay.textContent = `密码: ${passwordInput.value}`;
                } else {
                    passwordDisplay.textContent = '此链接未设置密码。';
                }
                convertResultArea.classList.remove('hidden');
            } else {
                 throw new Error(result.message || '转换失败，但未提供明确原因。');
            }
        } catch (error) {
            showError(error.message);
        } finally {
            setLoading(convertBtn, convertLoader, convertBtnText, false);
        }
    });

    // 2. Extraction Logic
    extractBtn.addEventListener('click', async() => {
        const fileId = extractIdInput.value.trim();
        const password = extractPasswordInput.value.trim();
        if (!fileId) {
            showError('分享ID不能为空。');
            return;
        }
        
        setLoading(extractBtn, extractLoader, extractBtnText, true);
        hideError();
        extractResultArea.classList.add('hidden');
        
        try {
            const response = await fetch('/extract', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileId, password }),
            });
            const result = await response.json();
             if (!response.ok) {
                throw new Error(result.message || `服务器错误: ${response.status}`);
            }
            if(result.success) {
                finalUrlDisplay.textContent = result.url;
                extractResultArea.classList.remove('hidden');
            } else {
                 throw new Error(result.message || '提取失败。');
            }
        } catch (error) {
            showError(error.message);
        } finally {
             setLoading(extractBtn, extractLoader, extractBtnText, false);
        }
    });


    // 3. Copy Button Logic (delegated)
    document.body.addEventListener('click', (event) => {
        const target = event.target;
        if (target.classList.contains('copy-btn')) {
            const elementToCopy = document.querySelector(target.dataset.clipboardTarget);
            if (elementToCopy && elementToCopy.textContent) {
                navigator.clipboard.writeText(elementToCopy.textContent).then(() => {
                    const originalText = target.textContent;
                    target.textContent = '已复制!';
                    target.classList.add('text-green-500');
                    setTimeout(() => {
                        target.textContent = originalText;
                        target.classList.remove('text-green-500');
                    }, 2000);
                }).catch(err => {
                    showError('复制失败: ' + err);
                });
            }
        }
    });

    // --- Helper Functions ---

    function setLoading(btn, loader, btnText, isLoading) {
        btn.disabled = isLoading;
        if (isLoading) {
            btn.classList.add('cursor-not-allowed');
            loader.classList.remove('hidden');
            btnText.classList.add('hidden');
        } else {
            btn.classList.remove('cursor-not-allowed');
            loader.classList.add('hidden');
            btnText.classList.remove('hidden');
        }
    }

    let errorTimeout;
    function showError(message) {
        clearTimeout(errorTimeout);
        errorText.textContent = message;
        errorMessage.classList.remove('hidden');
        errorMessage.classList.add('opacity-100');
        errorTimeout = setTimeout(() => {
            errorMessage.classList.add('hidden');
            errorMessage.classList.remove('opacity-100');
        }, 5000);
    }

    function hideError() {
        errorMessage.classList.add('hidden');
    }
});

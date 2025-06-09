document.addEventListener('DOMContentLoaded', () => {
    // --- Part 1: Conversion Elements ---
    const conversionForm = document.getElementById('conversion-form'); // 【升级】获取form元素
    const subInput = document.getElementById('sub-input');
    const expirationSelect = document.getElementById('expiration-select');
    const convertBtn = document.getElementById('convert-btn');
    const convertResultArea = document.getElementById('convert-result-area');
    const extractionCodeDisplay = document.getElementById('extraction-code-display');
    const convertBtnText = document.getElementById('btn-text');
    const convertLoader = document.getElementById('loader');

    // --- Part 2: Extraction Elements ---
    const extractCodeInput = document.getElementById('extract-code-input');
    const extractBtn = document.getElementById('extract-btn');
    const extractResultArea = document.getElementById('extract-result-area');
    const genericResultLink = document.getElementById('generic-result-link');
    const clashResultLink = document.getElementById('clash-result-link');
    const singboxResultLink = document.getElementById('singbox-result-link');
    const singboxResultDownload = document.getElementById('singbox-result-download');
    const extractBtnText = document.getElementById('extract-btn-text');
    const extractLoader = document.getElementById('extract-loader');

    // --- Universal Elements ---
    const errorMessage = document.getElementById('error-message');
    const errorText = document.getElementById('error-text');
    const turnstileWidget = document.querySelector('.cf-turnstile');

    // --- Event Listeners ---

    // 1. Conversion Logic - 【升级】监听表单的 'submit' 事件
    conversionForm.addEventListener('submit', async (event) => {
        event.preventDefault(); // 阻止浏览器默认的页面刷新行为

        // 【升级】使用 FormData API 来可靠地获取所有表单数据
        const formData = new FormData(conversionForm);
        const inputData = formData.get('subscription_data');
        const expirationDays = formData.get('expirationDays');
        const turnstileToken = formData.get('cf-turnstile-response');

        if (!inputData || inputData.trim() === '') {
            showError('订阅链接或分享链接不能为空。');
            return;
        }
        
        if (!turnstileToken) {
            showError('请先完成人机验证。如果看不到验证模块，请刷新页面。');
            // 注意：在实际情况中，由于表单提交，这个错误很难触发，
            // 因为Turnstile通常会阻止没有令牌的表单提交。但保留作为保险。
            return;
        }

        setLoading(convertBtn, convertLoader, convertBtnText, true);
        hideError();
        convertResultArea.classList.add('hidden');

        try {
            const requestBody = {
                subscription_data: inputData,
                expirationDays: expirationDays,
                turnstileToken: turnstileToken,
            };

            const response = await fetch('/convert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            });
            
            if (!response.ok) {
                const errText = await response.text();
                throw new Error(errText || `服务器错误: ${response.status}`);
            }

            const result = await response.json();

            if (result.success) {
                extractionCodeDisplay.textContent = result.extractionCode;
                convertResultArea.classList.remove('hidden');
            } else {
                 throw new Error(result.message || '转换失败，但未提供明确原因。');
            }
        } catch (error) {
            showError(error.message);
        } finally {
            setLoading(convertBtn, convertLoader, convertBtnText, false);
            // 无论成功或失败，都重置Turnstile小组件，以便用户可以再次提交
            if (typeof turnstile !== 'undefined' && turnstileWidget) {
                turnstile.reset(turnstileWidget);
            }
        }
    });

    // 2. Extraction Logic - (no change needed)
    extractBtn.addEventListener('click', async() => {
        const extractionCode = extractCodeInput.value.trim();
        if (!extractionCode) {
            showError('提取码不能为空。');
            return;
        }
        
        setLoading(extractBtn, extractLoader, extractBtnText, true);
        hideError();
        extractResultArea.classList.add('hidden');
        
        try {
            const response = await fetch('/extract', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ extractionCode }),
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(errText || `服务器错误: ${response.status}`);
            }

            const result = await response.json();
            
            if(result.success) {
                genericResultLink.textContent = result.genericSubUrl;
                genericResultLink.href = result.genericSubUrl;
                
                clashResultLink.textContent = result.clashUrl;
                clashResultLink.href = result.clashUrl;

                singboxResultLink.textContent = result.singboxUrl;
                singboxResultLink.href = result.singboxUrl;
                singboxResultDownload.href = result.singboxUrl;

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
            if (elementToCopy && (elementToCopy.textContent || elementToCopy.href)) {
                const textToCopy = elementToCopy.href || elementToCopy.textContent;
                navigator.clipboard.writeText(textToCopy).then(() => {
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
        errorText.textContent = String(message).replace(/<[^>]*>?/gm, '');
        errorMessage.classList.remove('hidden', 'opacity-0');
        errorMessage.classList.add('opacity-100');
        errorTimeout = setTimeout(() => {
            errorMessage.classList.add('opacity-0');
            setTimeout(() => errorMessage.classList.add('hidden'), 300);
        }, 5000);
    }

    function hideError() {
        errorMessage.classList.add('hidden', 'opacity-0');
    }
});

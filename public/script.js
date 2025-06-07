document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const subInput = document.getElementById('sub-input');
    const convertBtn = document.getElementById('convert-btn');
    const clearBtn = document.getElementById('clear-btn');
    const resultArea = document.getElementById('result-area');
    const clashDownloadBtn = document.getElementById('clash-download-btn');
    const singboxDownloadBtn = document.getElementById('singbox-download-btn');
    const errorMessage = document.getElementById('error-message');
    const errorText = document.getElementById('error-text');
    const btnText = document.getElementById('btn-text');
    const loader = document.getElementById('loader');

    // --- Event Listeners ---

    // Convert button click handler
    convertBtn.addEventListener('click', async () => {
        const inputData = subInput.value.trim();
        if (!inputData) {
            showError('输入框不能为空。');
            return;
        }

        // --- UI State: Loading ---
        setLoading(true);
        hideError();
        resultArea.classList.add('hidden');

        try {
            const response = await fetch('/convert', {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/plain;charset=UTF-8',
                },
                body: inputData,
            });

            if (!response.ok) {
                const errorMsg = await response.text();
                throw new Error(errorMsg || `服务器错误: ${response.status}`);
            }

            const result = await response.json();

            if (result.success) {
                // --- UI State: Success ---
                clashDownloadBtn.href = result.clashUrl;
                singboxDownloadBtn.href = result.singboxUrl;
                resultArea.classList.remove('hidden');
            } else {
                 throw new Error(result.message || '转换失败，但未提供明确原因。');
            }

        } catch (error) {
            // --- UI State: Error ---
            console.error('Fetch error:', error);
            showError(error.message);
        } finally {
            // --- UI State: Reset ---
            setLoading(false);
        }
    });

    // Clear button click handler
    clearBtn.addEventListener('click', () => {
        subInput.value = '';
        resultArea.classList.add('hidden');
        hideError();
    });
    
    // Hide error when user starts typing again
    subInput.addEventListener('input', () => {
        hideError();
    });


    // --- Helper Functions ---

    /**
     * Toggles the loading state of the convert button.
     * @param {boolean} isLoading - Whether to show the loading state.
     */
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

    /**
     * Displays an error message.
     * @param {string} message - The error message to display.
     */
    function showError(message) {
        errorText.textContent = message;
        errorMessage.classList.remove('hidden');
    }

    /**
     * Hides the error message box.
     */
    function hideError() {
        errorMessage.classList.add('hidden');
    }
});

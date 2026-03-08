/**
 * Agent Link - Join Page
 * Handles URL parsing, copy functionality, and UI interactions
 */

(function() {
    'use strict';

    // DOM Elements
    const copyBtn = document.getElementById('copyBtn');
    const toast = document.getElementById('toast');
    const commandEl = document.getElementById('command');
    const topicEl = document.getElementById('topic');
    const hostNameEl = document.querySelector('.host-name');

    // Configuration
    const CONFIG = {
        defaultHost: 'Kenny',
        defaultTopic: '飞书权限配置',
        defaultJoinCode: 'A3F9K2',
        toastDuration: 2000
    };

    /**
     * Parse URL to extract join code and query parameters
     * URL format: /j/{code}?host=Name&topic=Subject
     */
    function parseURL() {
        const path = window.location.pathname;
        const search = window.location.search;
        
        // Extract join code from path (e.g., /j/A3F9K2)
        const pathMatch = path.match(/\/j\/([A-Za-z0-9]+)/);
        const joinCode = pathMatch ? pathMatch[1] : CONFIG.defaultJoinCode;
        
        // Parse query parameters
        const params = new URLSearchParams(search);
        const host = params.get('host') || CONFIG.defaultHost;
        const topic = params.get('topic') || CONFIG.defaultTopic;
        
        return { joinCode, host, topic };
    }

    /**
     * Update page content based on URL parameters
     */
    function updatePageContent() {
        const { joinCode, host, topic } = parseURL();
        
        // Update command text
        const commandText = `/link join ${joinCode}`;
        if (commandEl) {
            commandEl.textContent = commandText;
        }
        
        // Update topic
        if (topicEl) {
            topicEl.textContent = topic;
        }
        
        // Update host name
        if (hostNameEl) {
            hostNameEl.textContent = host;
        }
        
        // Update page title
        document.title = `${host} 邀请你协作 - Agent Link`;
        
        // Store for copy function
        window.currentCommand = commandText;
    }

    /**
     * Copy text to clipboard
     * @param {string} text - Text to copy
     * @returns {Promise<boolean>} - Success status
     */
    async function copyToClipboard(text) {
        try {
            // Try modern Clipboard API first
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
                return true;
            }
            
            // Fallback for older browsers or non-secure contexts
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            
            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);
            
            return successful;
        } catch (err) {
            console.error('Copy failed:', err);
            return false;
        }
    }

    /**
     * Show toast notification
     * @param {string} message - Message to display
     */
    function showToast(message = '已复制到剪贴板') {
        if (!toast) return;
        
        const toastText = toast.querySelector('span');
        if (toastText) {
            toastText.textContent = message;
        }
        
        toast.classList.add('show');
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, CONFIG.toastDuration);
    }

    /**
     * Handle copy button click
     */
    async function handleCopy() {
        const textToCopy = window.currentCommand || commandEl?.textContent || '';
        
        if (!textToCopy) {
            showToast('复制失败，请重试');
            return;
        }
        
        const success = await copyToClipboard(textToCopy);
        
        if (success) {
            // Update button state
            copyBtn.classList.add('copied');
            const btnText = copyBtn.querySelector('.btn-text');
            const originalText = btnText?.textContent;
            
            if (btnText) {
                btnText.textContent = '已复制';
            }
            
            showToast();
            
            // Reset button after delay
            setTimeout(() => {
                copyBtn.classList.remove('copied');
                if (btnText && originalText) {
                    btnText.textContent = originalText;
                }
            }, CONFIG.toastDuration);
        } else {
            showToast('复制失败，请手动复制');
        }
    }

    /**
     * Generate QR code URL
     * Uses a free QR code API (can be replaced with local generation)
     */
    function generateQRCode() {
        const qrContainer = document.getElementById('qrCode');
        if (!qrContainer) return;
        
        const currentURL = window.location.href;
        
        // Option 1: Use QR Server API (free, no key required)
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(currentURL)}`;
        
        // Option 2: Use Google Chart API (deprecated but still works)
        // const qrUrl = `https://chart.googleapis.com/chart?cht=qr&chs=120x120&chl=${encodeURIComponent(currentURL)}`;
        
        // Create image element
        const img = document.createElement('img');
        img.src = qrUrl;
        img.alt = 'QR Code';
        img.width = 120;
        img.height = 120;
        img.style.display = 'block';
        img.style.borderRadius = '4px';
        
        // Clear container and add image
        qrContainer.innerHTML = '';
        qrContainer.appendChild(img);
        
        // Handle load error
        img.onerror = () => {
            // Keep the fallback SVG if image fails to load
            qrContainer.innerHTML = `
                <div class="qr-fallback">
                    <svg viewBox="0 0 100 100" class="qr-icon">
                        <rect x="10" y="10" width="25" height="25" fill="currentColor"/>
                        <rect x="65" y="10" width="25" height="25" fill="currentColor"/>
                        <rect x="10" y="65" width="25" height="25" fill="currentColor"/>
                        <rect x="20" y="20" width="5" height="5" fill="white"/>
                        <rect x="75" y="20" width="5" height="5" fill="white"/>
                        <rect x="20" y="75" width="5" height="5" fill="white"/>
                    </svg>
                </div>
            `;
        };
    }

    /**
     * Initialize the page
     */
    function init() {
        // Update content based on URL
        updatePageContent();
        
        // Attach copy button listener
        if (copyBtn) {
            copyBtn.addEventListener('click', handleCopy);
        }
        
        // Generate QR code
        generateQRCode();
        
        // Log for debugging
        console.log('Agent Link initialized:', {
            url: window.location.href,
            params: parseURL()
        });
    }

    // Run initialization when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose for testing/debugging
    window.AgentLink = {
        parseURL,
        copyToClipboard,
        updatePageContent
    };

})();

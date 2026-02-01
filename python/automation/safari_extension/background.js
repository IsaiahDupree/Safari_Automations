/**
 * TikTok Comment Automation - Background Script
 * 
 * Handles messages from Python native messaging host and forwards to content script.
 */

console.log('[TikTok Automation] Background script loaded');

// Listen for messages from content script or native host
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[TikTok Automation] Background received:', message);

    if (message.action === 'typeComment') {
        // Forward to active tab's content script
        browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
            if (tabs.length === 0) {
                sendResponse({ success: false, error: 'No active tab' });
                return;
            }

            browser.tabs.sendMessage(tabs[0].id, {
                type: 'TYPE_COMMENT',
                text: message.text
            }).then(response => {
                sendResponse(response);
            }).catch(error => {
                console.error('[TikTok Automation] Error sending message:', error);
                sendResponse({ success: false, error: error.message });
            });
        });

        return true; // Keep channel open for async response
    }

    if (message.action === 'clickPost') {
        browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
            if (tabs.length === 0) {
                sendResponse({ success: false, error: 'No active tab' });
                return;
            }

            browser.tabs.sendMessage(tabs[0].id, {
                type: 'CLICK_POST'
            }).then(response => {
                sendResponse(response);
            }).catch(error => {
                console.error('[TikTok Automation] Error sending message:', error);
                sendResponse({ success: false, error: error.message });
            });
        });

        return true;
    }

    if (message.action === 'checkStatus') {
        browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
            if (tabs.length === 0) {
                sendResponse({ success: false, error: 'No active tab' });
                return;
            }

            browser.tabs.sendMessage(tabs[0].id, {
                type: 'CHECK_STATUS'
            }).then(response => {
                sendResponse(response);
            }).catch(error => {
                console.error('[TikTok Automation] Error sending message:', error);
                sendResponse({ success: false, error: error.message });
            });
        });

        return true;
    }

    if (message.action === 'openComments') {
        browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
            if (tabs.length === 0) {
                sendResponse({ success: false, error: 'No active tab' });
                return;
            }

            browser.tabs.sendMessage(tabs[0].id, {
                type: 'OPEN_COMMENTS'
            }).then(response => {
                sendResponse(response);
            }).catch(error => {
                console.error('[TikTok Automation] Error sending message:', error);
                sendResponse({ success: false, error: error.message });
            });
        });

        return true;
    }

    if (message.action === 'focusInput') {
        browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
            if (tabs.length === 0) {
                sendResponse({ success: false, error: 'No active tab' });
                return;
            }

            browser.tabs.sendMessage(tabs[0].id, {
                type: 'FOCUS_INPUT'
            }).then(response => {
                sendResponse(response);
            }).catch(error => {
                console.error('[TikTok Automation] Error sending message:', error);
                sendResponse({ success: false, error: error.message });
            });
        });

        return true;
    }
});

// Listen for native messaging (if configured)
if (browser.runtime.onConnectNative) {
    browser.runtime.onConnectNative.addListener((port) => {
        console.log('[TikTok Automation] Native messaging connection established');
        
        port.onMessage.addListener((message) => {
            console.log('[TikTok Automation] Native message received:', message);
            
            // Forward to content script
            browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
                if (tabs.length === 0) {
                    port.postMessage({ success: false, error: 'No active tab' });
                    return;
                }

                browser.tabs.sendMessage(tabs[0].id, message).then(response => {
                    port.postMessage(response);
                }).catch(error => {
                    port.postMessage({ success: false, error: error.message });
                });
            });
        });
    });
}

console.log('[TikTok Automation] Background script ready');

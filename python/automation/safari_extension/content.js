/**
 * TikTok Comment Automation - Content Script
 * 
 * Runs in the TikTok page context with full access to DOM and Draft.js.
 * Uses beforeinput events to properly update Draft.js React state.
 * 
 * STABLE SELECTORS (from reference):
 * - Footer: [class*="DivCommentFooter"]
 * - Post button: [class*="DivPostButton"]
 * - Input: [contenteditable="true"]
 * - Comment text: [class*="DivCommentContentWrapper"] > span
 * - Main nav: [class*="DivMainNavContainer"]
 * - DM input: #main-content-messages [class*="DivMessageInputAndSendButton"]
 */

console.log('[TikTok Automation] Content script loaded');

// STABLE SELECTORS from user's reference file
const SELECTORS = {
    // Comment input area (find the footer first, then get contenteditable)
    commentFooter: '[class*="DivCommentFooter"]',
    postButton: '[class*="DivPostButton"]',

    // The actual input editor container from user's DevTools
    inputEditorContainer: '[class*="DivInputEditorContainer"]',

    // Multiple ways to find comment input - PRIORITY ORDER
    commentInputSelectors: [
        // NEW: User's exact selector - DivInputEditorContainer contenteditable
        '[class*="DivInputEditorContainer"] [contenteditable="true"]',
        '[class*="DivInputEditorContainer"] div[data-contents="true"]',
        '[class*="DivLayoutContainer"] [contenteditable="true"]',
        // data-e2e selectors
        '[data-e2e="comment-input"]',
        // Footer-based
        '[class*="DivCommentFooter"] [contenteditable="true"]',
        '[class*="DivCommentInputWrapper"] [contenteditable="true"]',
        // Generic fallbacks
        '[contenteditable="true"][data-lexical-editor="true"]',
        '#main-content-homepage_hot [contenteditable="true"]'
    ],

    // Comment icon (multiple layouts)
    commentIcon: 'button[data-e2e="comment-icon"], [data-e2e="browse-comment-icon"]',

    // Comment text elements
    commentText: '[data-e2e="comment-level-1"], [class*="DivCommentContentWrapper"] > span',

    // Navigation
    mainNav: '[class*="DivMainNavContainer"]',

    // DM input
    dmInputBar: '#main-content-messages [class*="DivMessageInputAndSendButton"]'
};

// Listen for messages from background script
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[TikTok Automation] Received message:', message);

    if (message.type === 'TYPE_COMMENT') {
        typeComment(message.text).then(result => {
            sendResponse(result);
        }).catch(error => {
            sendResponse({ success: false, error: error.message });
        });
        return true; // Keep channel open for async response
    }

    if (message.type === 'CLICK_POST') {
        const result = clickPostButton();
        sendResponse(result);
        return true;
    }

    if (message.type === 'CHECK_STATUS') {
        const result = checkStatus();
        sendResponse(result);
        return true;
    }

    if (message.type === 'OPEN_COMMENTS') {
        const result = openComments();
        sendResponse(result);
        return true;
    }

    if (message.type === 'FOCUS_INPUT') {
        const result = focusInput();
        sendResponse(result);
        return true;
    }
});

/**
 * Find comment input using multiple selector strategies
 * CRITICAL: The actual Draft.js editor has role="textbox", NOT the data-e2e="comment-input" wrapper
 */
function findCommentInput() {
    // BEST: Find via DivInputEditorContainer - the role="textbox" element is the REAL input
    const container = document.querySelector('[class*="DivInputEditorContainer"]');
    if (container) {
        // The actual editable element has role="textbox"
        const input = container.querySelector('[role="textbox"]') ||
            container.querySelector('[contenteditable="true"]');
        if (input) {
            console.log('[TikTok] Found input via DivInputEditorContainer, role:', input.getAttribute('role'));
            return input;
        }
    }

    // Fallback: Find element with role="textbox" in comment footer
    const footer = document.querySelector('[class*="DivCommentFooter"]');
    if (footer) {
        const input = footer.querySelector('[role="textbox"]') ||
            footer.querySelector('[contenteditable="true"]');
        if (input) {
            console.log('[TikTok] Found input via DivCommentFooter');
            return input;
        }
    }

    // Last resort: Any role="textbox" in comment area
    const mainContent = document.querySelector('#main-content-homepage_hot') || document;
    const textboxes = mainContent.querySelectorAll('[role="textbox"]');
    if (textboxes.length > 0) {
        // Get the last one (usually the comment input, not search)
        const input = textboxes[textboxes.length - 1];
        console.log('[TikTok] Found input via role=textbox fallback');
        return input;
    }

    console.log('[TikTok] No comment input found!');
    return null;
}

/**
 * Type comment into TikTok's Draft.js input using beforeinput events
 * This is the key to making Draft.js recognize the input
 */
async function typeComment(text) {
    try {
        // Use our new findCommentInput() which correctly finds role="textbox" element
        let input = findCommentInput();

        if (!input) {
            return { success: false, error: 'Comment input not found (no role=textbox element)' };
        }

        console.log('[TikTok] Found input, focusing...');

        // Focus the input (real browser focus!)
        input.focus();
        input.click();

        // Wait a moment for focus to settle
        await new Promise(resolve => setTimeout(resolve, 100));

        // Clear existing content first
        clearInput(input);

        // Type each character using beforeinput events
        // This is what Draft.js listens for to update React state
        for (let i = 0; i < text.length; i++) {
            const char = text[i];

            // Create beforeinput event - this is what Draft.js needs!
            const beforeInputEvent = new InputEvent('beforeinput', {
                inputType: 'insertText',
                data: char,
                bubbles: true,
                cancelable: true,
                composed: true
            });

            // Dispatch beforeinput (Draft.js listens for this)
            const notCancelled = input.dispatchEvent(beforeInputEvent);

            if (notCancelled) {
                // Insert the character into the DOM
                insertTextAtCursor(input, char);

                // Also dispatch input event
                const inputEvent = new InputEvent('input', {
                    inputType: 'insertText',
                    data: char,
                    bubbles: true,
                    cancelable: false,
                    composed: true
                });
                input.dispatchEvent(inputEvent);
            }

            // Small delay between characters to mimic real typing
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        // Wait a moment for React state to update
        await new Promise(resolve => setTimeout(resolve, 200));

        // Check if button is now active
        const button = document.querySelector('[class*="DivPostButton"]') ||
            document.querySelector('[data-e2e="comment-post"]');
        const buttonColor = button ? window.getComputedStyle(button).color : 'none';
        const isRed = buttonColor.includes('255, 87, 111') ||
            buttonColor.includes('rgb(255, 87, 111)') ||
            buttonColor === 'rgb(255, 87, 111)';

        const inputText = getInputText(input);

        return {
            success: true,
            text: inputText,
            buttonActive: isRed,
            buttonColor: buttonColor,
            textLength: inputText.length
        };

    } catch (error) {
        console.error('[TikTok Automation] Type comment error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Insert text at cursor position in contenteditable element
 */
function insertTextAtCursor(element, text) {
    const selection = window.getSelection();
    const range = selection.getRangeAt(0);

    // Delete any selected text
    range.deleteContents();

    // Insert text node
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);

    // Move cursor after inserted text
    range.setStartAfter(textNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
}

/**
 * Clear input content
 */
function clearInput(element) {
    element.textContent = '';
    element.innerHTML = '';

    // Move cursor to start
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
}

/**
 * Get text from input element
 */
function getInputText(element) {
    return element.textContent || element.innerText || '';
}

/**
 * Click the Post button
 */
function clickPostButton() {
    try {
        const button = document.querySelector('[class*="DivPostButton"]') ||
            document.querySelector('[data-e2e="comment-post"]');

        if (!button) {
            return { success: false, error: 'Post button not found' };
        }

        // Check if button is active (red)
        const buttonColor = window.getComputedStyle(button).color;
        const isRed = buttonColor.includes('255, 87, 111') ||
            buttonColor.includes('rgb(255, 87, 111)') ||
            buttonColor === 'rgb(255, 87, 111)';

        if (!isRed) {
            return {
                success: false,
                error: 'Post button not active',
                buttonColor: buttonColor
            };
        }

        button.click();

        return { success: true };

    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Open comments panel
 */
function openComments() {
    try {
        const commentIcon = document.querySelector('[data-e2e="comment-icon"]');

        if (!commentIcon) {
            return { success: false, error: 'Comment icon not found' };
        }

        commentIcon.click();

        return { success: true };

    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Focus the comment input
 */
function focusInput() {
    try {
        let input = document.querySelector('[data-e2e="comment-input"]') ||
            document.querySelector('[contenteditable="true"]');

        if (!input) {
            const allContentEditable = document.querySelectorAll('[contenteditable="true"]');
            for (const el of allContentEditable) {
                const parent = el.closest('[class*="DivCommentFooter"]');
                if (parent) {
                    input = el;
                    break;
                }
            }
        }

        if (!input) {
            return { success: false, error: 'Comment input not found' };
        }

        input.focus();
        input.click();

        return { success: true };

    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Check current status
 */
function checkStatus() {
    try {
        let input = document.querySelector('[data-e2e="comment-input"]') ||
            document.querySelector('[contenteditable="true"]');

        if (!input) {
            const allContentEditable = document.querySelectorAll('[contenteditable="true"]');
            for (const el of allContentEditable) {
                const parent = el.closest('[class*="DivCommentFooter"]');
                if (parent) {
                    input = el;
                    break;
                }
            }
        }

        const button = document.querySelector('[class*="DivPostButton"]') ||
            document.querySelector('[data-e2e="comment-post"]');

        const inputText = input ? getInputText(input) : '';
        const buttonColor = button ? window.getComputedStyle(button).color : 'none';
        const isRed = buttonColor.includes('255, 87, 111') ||
            buttonColor.includes('rgb(255, 87, 111)') ||
            buttonColor === 'rgb(255, 87, 111)';

        // Get first few comments
        const comments = Array.from(document.querySelectorAll('[data-e2e="comment-level-1"]'))
            .slice(0, 3)
            .map(c => c.textContent.substring(0, 40));

        return {
            success: true,
            hasInput: !!input,
            inputText: inputText.substring(0, 40),
            inputTextLength: inputText.length,
            buttonActive: isRed,
            buttonColor: buttonColor,
            comments: comments,
            url: window.location.href
        };

    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Expose global API for direct JavaScript injection from Python
window.tiktokAutomation = {
    typeComment: async (text) => {
        return await typeComment(text);
    },
    clickPost: () => {
        return clickPostButton();
    },
    checkStatus: () => {
        return checkStatus();
    },
    openComments: () => {
        return openComments();
    },
    focusInput: () => {
        return focusInput();
    }
};

// Notify that we're ready
console.log('[TikTok Automation] Content script ready');

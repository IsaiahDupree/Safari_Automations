/**
 * Popup script for TikTok Comment Automation extension
 */

document.addEventListener('DOMContentLoaded', () => {
    const statusDiv = document.getElementById('status');
    const checkBtn = document.getElementById('checkBtn');
    const testBtn = document.getElementById('testBtn');

    checkBtn.addEventListener('click', checkStatus);
    testBtn.addEventListener('click', testComment);

    // Check status on load
    checkStatus();

    async function checkStatus() {
        try {
            const tabs = await browser.tabs.query({ active: true, currentWindow: true });
            
            if (tabs.length === 0 || !tabs[0].url.includes('tiktok.com')) {
                statusDiv.textContent = '⚠️ Not on TikTok page';
                statusDiv.className = 'status inactive';
                return;
            }

            const response = await browser.tabs.sendMessage(tabs[0].id, {
                type: 'CHECK_STATUS'
            });

            if (response.success) {
                const status = `✅ Active | Input: ${response.inputTextLength} chars | Button: ${response.buttonActive ? 'RED' : 'Grey'}`;
                statusDiv.textContent = status;
                statusDiv.className = 'status active';
            } else {
                statusDiv.textContent = `❌ Error: ${response.error}`;
                statusDiv.className = 'status inactive';
            }
        } catch (error) {
            statusDiv.textContent = `❌ Error: ${error.message}`;
            statusDiv.className = 'status inactive';
        }
    }

    async function testComment() {
        testBtn.disabled = true;
        testBtn.textContent = 'Posting...';

        try {
            const tabs = await browser.tabs.query({ active: true, currentWindow: true });
            
            if (tabs.length === 0 || !tabs[0].url.includes('tiktok.com')) {
                alert('Please navigate to a TikTok video first');
                testBtn.disabled = false;
                testBtn.textContent = 'Test Comment';
                return;
            }

            // Open comments
            await browser.tabs.sendMessage(tabs[0].id, { type: 'OPEN_COMMENTS' });
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Type comment
            const result = await browser.tabs.sendMessage(tabs[0].id, {
                type: 'TYPE_COMMENT',
                text: 'Test comment from extension 🎉'
            });

            if (result.success && result.buttonActive) {
                // Click post
                await browser.tabs.sendMessage(tabs[0].id, { type: 'CLICK_POST' });
                alert('✅ Comment posted!');
            } else {
                alert(`⚠️ Could not post: ${result.error || 'Button not active'}`);
            }
        } catch (error) {
            alert(`❌ Error: ${error.message}`);
        } finally {
            testBtn.disabled = false;
            testBtn.textContent = 'Test Comment';
            checkStatus();
        }
    }
});

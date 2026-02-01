"""
Safari Web Extension Bridge for TikTok Comment Automation

This module provides a Python interface to communicate with the Safari Web Extension
that handles typing into TikTok's Draft.js comment field.

The extension runs in the TikTok page context and can properly dispatch
beforeinput events that Draft.js recognizes.
"""

import subprocess
import json
import asyncio
from typing import Dict, Optional
from loguru import logger


class SafariExtensionBridge:
    """Bridge to communicate with Safari Web Extension via JavaScript injection."""
    
    def __init__(self):
        self.extension_loaded = False
    
    def _run_applescript(self, script: str, timeout: int = 30) -> str:
        """Execute AppleScript and return output."""
        try:
            result = subprocess.run(
                ["osascript", "-e", script],
                capture_output=True,
                text=True,
                check=True,
                timeout=timeout
            )
            return result.stdout.strip()
        except subprocess.CalledProcessError as e:
            logger.error(f"AppleScript error: {e.stderr}")
            raise
        except subprocess.TimeoutExpired:
            logger.warning(f"AppleScript timeout after {timeout}s")
            raise
    
    def _inject_js(self, js_code: str) -> Optional[Dict]:
        """
        Inject JavaScript into Safari's current tab and return result.
        
        The JavaScript should call window.tiktokAutomation functions
        and return a JSON string.
        """
        # Escape the JavaScript for AppleScript
        escaped_js = js_code.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n')
        
        script = f'''
        tell application "Safari"
            tell front window
                tell current tab
                    set result to do JavaScript "{escaped_js}"
                    return result
                end tell
            end tell
        end tell
        '''
        
        try:
            result = self._run_applescript(script, timeout=10)
            
            # Try to parse as JSON
            try:
                return json.loads(result)
            except json.JSONDecodeError:
                # If not JSON, return as string
                return {"success": False, "error": result, "raw": result}
                
        except Exception as e:
            logger.error(f"JavaScript injection error: {e}")
            return {"success": False, "error": str(e)}
    
    def check_extension_loaded(self) -> bool:
        """Check if the extension is loaded in the current page."""
        js = '''
        (function() {
            if (typeof window.tiktokAutomation !== 'undefined') {
                return JSON.stringify({success: true, loaded: true});
            }
            return JSON.stringify({success: false, loaded: false, error: 'Extension not loaded'});
        })()
        '''
        
        result = self._inject_js(js)
        loaded = result.get('loaded', False) if result else False
        
        if loaded:
            self.extension_loaded = True
            logger.debug("✅ Safari extension is loaded")
        else:
            logger.warning("⚠️ Safari extension not detected - make sure it's installed and enabled")
        
        return loaded
    
    def type_comment(self, text: str) -> Dict:
        """
        Type a comment into TikTok's comment field using the extension.
        
        Args:
            text: Comment text to type
            
        Returns:
            Dict with success status, button state, etc.
        """
        if not self.check_extension_loaded():
            return {
                "success": False,
                "error": "Extension not loaded",
                "text": text
            }
        
        # Call the extension's typeComment function
        js = f'''
        (function() {{
            return window.tiktokAutomation.typeComment({json.dumps(text)})
                .then(result => JSON.stringify(result))
                .catch(error => JSON.stringify({{success: false, error: error.message}}));
        }})()
        '''
        
        # For async functions, we need to wait for the promise
        # Safari's do JavaScript doesn't handle promises well, so we'll use a different approach
        js_sync = f'''
        (async function() {{
            try {{
                const result = await window.tiktokAutomation.typeComment({json.dumps(text)});
                return JSON.stringify(result);
            }} catch (error) {{
                return JSON.stringify({{success: false, error: error.message}});
            }}
        }})()
        '''
        
        # Actually, Safari's do JavaScript doesn't support async/await well
        # Let's use a synchronous wrapper that waits
        js_wrapper = f'''
        (function() {{
            var done = false;
            var result = null;
            
            window.tiktokAutomation.typeComment({json.dumps(text)})
                .then(function(r) {{
                    result = r;
                    done = true;
                }})
                .catch(function(e) {{
                    result = {{success: false, error: e.message}};
                    done = true;
                }});
            
            // Wait up to 5 seconds
            var start = Date.now();
            while (!done && (Date.now() - start) < 5000) {{
                // Busy wait
            }}
            
            if (!done) {{
                return JSON.stringify({{success: false, error: 'Timeout waiting for typeComment'}});
            }}
            
            return JSON.stringify(result);
        }})()
        '''
        
        result = self._inject_js(js_wrapper)
        
        if result and result.get('success'):
            logger.info(f"✅ Typed comment: {text[:30]}... (length: {len(text)})")
            if result.get('buttonActive'):
                logger.info("✅ Post button is active (RED)")
            else:
                logger.warning("⚠️ Post button not active (Grey)")
        else:
            error = result.get('error', 'Unknown error') if result else 'No result'
            logger.error(f"❌ Failed to type comment: {error}")
        
        return result or {"success": False, "error": "No result", "text": text}
    
    def click_post(self) -> Dict:
        """Click the Post button."""
        if not self.check_extension_loaded():
            return {"success": False, "error": "Extension not loaded"}
        
        js = '''
        (function() {
            var result = window.tiktokAutomation.clickPost();
            return JSON.stringify(result);
        })()
        '''
        
        result = self._inject_js(js)
        
        if result and result.get('success'):
            logger.info("✅ Clicked Post button")
        else:
            error = result.get('error', 'Unknown error') if result else 'No result'
            logger.error(f"❌ Failed to click Post: {error}")
        
        return result or {"success": False, "error": "No result"}
    
    def open_comments(self) -> Dict:
        """Open the comments panel."""
        if not self.check_extension_loaded():
            return {"success": False, "error": "Extension not loaded"}
        
        js = '''
        (function() {
            var result = window.tiktokAutomation.openComments();
            return JSON.stringify(result);
        })()
        '''
        
        result = self._inject_js(js)
        return result or {"success": False, "error": "No result"}
    
    def focus_input(self) -> Dict:
        """Focus the comment input field."""
        if not self.check_extension_loaded():
            return {"success": False, "error": "Extension not loaded"}
        
        js = '''
        (function() {
            var result = window.tiktokAutomation.focusInput();
            return JSON.stringify(result);
        })()
        '''
        
        result = self._inject_js(js)
        return result or {"success": False, "error": "No result"}
    
    def check_status(self) -> Dict:
        """Check the current status of the comment input and button."""
        if not self.check_extension_loaded():
            return {"success": False, "error": "Extension not loaded"}
        
        js = '''
        (function() {
            var result = window.tiktokAutomation.checkStatus();
            return JSON.stringify(result);
        })()
        '''
        
        result = self._inject_js(js)
        return result or {"success": False, "error": "No result"}
    
    def post_comment(self, text: str, verify: bool = True) -> Dict:
        """
        Complete flow: open comments, type, and post.
        
        Args:
            text: Comment text
            verify: If True, verify comment was posted
            
        Returns:
            Dict with success status and details
        """
        result = {
            "success": False,
            "text": text,
            "steps": {}
        }
        
        # Step 1: Open comments
        logger.info("📝 Opening comments panel...")
        open_result = self.open_comments()
        result["steps"]["open_comments"] = open_result
        if not open_result.get("success"):
            result["error"] = "Could not open comments"
            return result
        
        # Wait for comments to open
        import time
        time.sleep(1)
        
        # Step 2: Focus input
        logger.info("🎯 Focusing comment input...")
        focus_result = self.focus_input()
        result["steps"]["focus_input"] = focus_result
        time.sleep(0.5)
        
        # Step 3: Type comment
        logger.info(f"⌨️ Typing comment: {text[:30]}...")
        type_result = self.type_comment(text)
        result["steps"]["type_comment"] = type_result
        
        if not type_result.get("success"):
            result["error"] = "Could not type comment"
            return result
        
        if not type_result.get("buttonActive"):
            result["error"] = "Post button not active after typing"
            result["buttonColor"] = type_result.get("buttonColor")
            return result
        
        # Step 4: Click Post
        logger.info("📤 Clicking Post button...")
        time.sleep(0.5)
        post_result = self.click_post()
        result["steps"]["click_post"] = post_result
        
        if not post_result.get("success"):
            result["error"] = "Could not click Post button"
            return result
        
        result["success"] = True
        logger.success(f"🎉 Comment posted successfully: {text[:30]}...")
        
        # Step 5: Verify (optional)
        if verify:
            time.sleep(2)
            status = self.check_status()
            result["verification"] = status
        
        return result


# Convenience function
def post_comment_via_extension(text: str, verify: bool = True) -> Dict:
    """
    Convenience function to post a comment using the Safari extension.
    
    Args:
        text: Comment text
        verify: If True, verify comment was posted
        
    Returns:
        Dict with success status and details
    """
    bridge = SafariExtensionBridge()
    return bridge.post_comment(text, verify)


if __name__ == "__main__":
    # Test the bridge
    bridge = SafariExtensionBridge()
    
    # Check if extension is loaded
    if bridge.check_extension_loaded():
        print("✅ Extension is loaded!")
        
        # Test status check
        status = bridge.check_status()
        print(f"Status: {json.dumps(status, indent=2)}")
    else:
        print("❌ Extension not loaded. Make sure:")
        print("  1. Extension is installed in Safari")
        print("  2. Extension is enabled")
        print("  3. You're on a TikTok page")


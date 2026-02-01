"""
Safari.app Controller using AppleScript
Controls the actual Safari.app browser (not Playwright's WebKit).
"""
import asyncio
import subprocess
import json
from pathlib import Path
from typing import Dict, List, Optional
from loguru import logger
from datetime import datetime


class SafariAppController:
    """Controls actual Safari.app using AppleScript."""
    
    def __init__(self):
        self.safari_path = "/Applications/Safari.app"
        self.recorded_actions: List[Dict] = []
        self.start_time: Optional[datetime] = None
    
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
            if "not allowed assistive access" in e.stderr.lower() or "not allowed automation" in e.stderr.lower():
                logger.error("⚠️  Safari automation requires permissions!")
                logger.info("Go to: System Settings > Privacy & Security > Automation")
                logger.info("Enable Terminal/iTerm to control Safari")
            raise
        except subprocess.TimeoutExpired:
            logger.warning(f"AppleScript timeout after {timeout}s - Safari may be slow to launch")
            raise
    
    async def find_tiktok_window(self, require_logged_in: bool = True) -> Optional[Dict]:
        """
        Find Safari window/tab with TikTok, optionally checking if logged in.
        
        Args:
            require_logged_in: If True, only return windows where user is logged in
            
        Returns:
            Dict with window_index, tab_index, url, is_logged_in, or None if not found
        """
        try:
            script = '''
            tell application "Safari"
                set windowList to every window
                repeat with w from 1 to count of windowList
                    set tabList to every tab of window w
                    repeat with t from 1 to count of tabList
                        set tabUrl to URL of tab t of window w
                        if tabUrl contains "tiktok.com" then
                            return {w, t, tabUrl}
                        end if
                    end repeat
                end repeat
                return "not_found"
            end tell
            '''
            
            result = self._run_applescript(script, timeout=10)
            
            if "not_found" in result or result == "":
                return None
            
            # Parse result: "{window_index, tab_index, url}"
            import re
            match = re.search(r'\{(\d+),\s*(\d+),\s*"([^"]+)"\}', result)
            if not match:
                return None
            
            window_idx = int(match.group(1))
            tab_idx = int(match.group(2))
            url = match.group(3)
            
            # Check if logged in
            is_logged_in = False
            if require_logged_in:
                # Switch to this tab and check login status
                check_script = f'''
                tell application "Safari"
                    set current tab of window {window_idx} to tab {tab_idx} of window {window_idx}
                    set index of window {window_idx} to 1
                    tell window {window_idx}
                        tell tab {tab_idx}
                            do JavaScript "
                                (function() {{
                                    var profileIcon = document.querySelector('[data-e2e=\\"profile-icon\\"]');
                                    var uploadIcon = document.querySelector('[data-e2e=\\"upload-icon\\"]');
                                    return (profileIcon || uploadIcon) ? 'logged_in' : 'not_logged_in';
                                }})();
                            "
                        end tell
                    end tell
                end tell
                '''
                try:
                    login_result = self._run_applescript(check_script, timeout=5)
                    is_logged_in = 'logged_in' in login_result.lower()
                except:
                    is_logged_in = False
            
            return {
                "window_index": window_idx,
                "tab_index": tab_idx,
                "url": url,
                "is_logged_in": is_logged_in
            }
            
        except Exception as e:
            logger.debug(f"Error finding TikTok window: {e}")
            return None
    
    async def activate_tiktok_window(self, require_logged_in: bool = True) -> bool:
        """
        Find and activate Safari window/tab with TikTok.
        
        Args:
            require_logged_in: If True, only activate if user is logged in
            
        Returns:
            True if found and activated, False otherwise
        """
        try:
            tiktok_info = await self.find_tiktok_window(require_logged_in=require_logged_in)
            
            if not tiktok_info:
                logger.warning("⚠️ No TikTok tab found in Safari")
                return False
            
            if require_logged_in and not tiktok_info.get("is_logged_in"):
                logger.warning("⚠️ Found TikTok tab but user is not logged in")
                return False
            
            # Activate the window and tab
            window_idx = tiktok_info["window_index"]
            tab_idx = tiktok_info["tab_index"]
            
            script = f'''
            tell application "Safari"
                activate
                set current tab of window {window_idx} to tab {tab_idx} of window {window_idx}
                set index of window {window_idx} to 1
            end tell
            '''
            
            self._run_applescript(script, timeout=10)
            await asyncio.sleep(1)  # Wait for activation
            
            logger.info(f"✅ Activated TikTok tab: {tiktok_info['url'][:50]}...")
            if tiktok_info.get("is_logged_in"):
                logger.info("✅ User is logged in")
            
            return True
            
        except Exception as e:
            logger.error(f"Error activating TikTok window: {e}")
            return False
    
    async def launch_safari(self, url: str = "https://www.tiktok.com/en/"):
        """Launch Safari.app with a specific URL."""
        logger.info("Launching Safari.app with your actual profile...")
        
        # First, try to find existing TikTok window
        logger.info("🔍 Looking for existing TikTok tab...")
        found = await self.activate_tiktok_window(require_logged_in=False)
        
        if found:
            logger.info("✅ Found existing TikTok tab, using it")
            await asyncio.sleep(2)
            return
        
        # If not found, open new tab
        logger.info("📝 No TikTok tab found, opening new one...")
        
        # First, try to just open Safari (simpler, faster)
        try:
            script1 = 'tell application "Safari" to activate'
            self._run_applescript(script1, timeout=15)
            await asyncio.sleep(2)  # Give Safari time to launch
        except Exception as e:
            logger.warning(f"Could not activate Safari: {e}")
            # Try opening Safari directly
            import subprocess
            subprocess.Popen(["/usr/bin/open", "-a", "Safari"])
            await asyncio.sleep(3)
        
        # Now set the URL
        try:
            script2 = f'''
            tell application "Safari"
                if (count of windows) = 0 then
                    make new document
                end if
                set URL of current tab of front window to "{url}"
            end tell
            '''
            self._run_applescript(script2, timeout=15)
            logger.success("✅ Safari.app opened")
            await asyncio.sleep(3)  # Wait for page to load
            
            # Install event listeners for capturing interactions
            await self._install_event_listeners()
        except Exception as e:
            logger.warning(f"Could not set URL via AppleScript: {e}")
            logger.info("Safari should be open - you can navigate to TikTok manually")
    
    async def _install_event_listeners(self):
        """Install JavaScript event listeners to capture user interactions."""
        try:
            # Wait a bit for page to be ready
            await asyncio.sleep(2)
            
            script = '''
            tell application "Safari"
                tell front window
                    tell current tab
                        do JavaScript "
                            (function() {
                                try {
                                    // Create storage for events
                                    if (!window._recorderEvents) {
                                        window._recorderEvents = [];
                                    }
                                    
                                    // Capture clicks
                                    document.addEventListener('click', function(e) {
                                        try {
                                            var target = e.target;
                                            var rect = target.getBoundingClientRect();
                                            window._recorderEvents.push({
                                                type: 'click',
                                                timestamp: Date.now(),
                                                target: {
                                                    tag: target.tagName,
                                                    id: target.id || '',
                                                    class: target.className || '',
                                                    text: (target.textContent || '').trim().substring(0, 100),
                                                    selector: target.id ? '#' + target.id : 
                                                             target.className ? '.' + target.className.split(' ')[0] : 
                                                             target.tagName.toLowerCase()
                                                },
                                                position: {
                                                    x: Math.round(rect.left + rect.width / 2),
                                                    y: Math.round(rect.top + rect.height / 2)
                                                },
                                                url: window.location.href
                                            });
                                        } catch(err) {
                                            console.error('Click capture error:', err);
                                        }
                                    }, true);
                                    
                                    // Capture input changes
                                    document.addEventListener('input', function(e) {
                                        try {
                                            var target = e.target;
                                            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
                                                window._recorderEvents.push({
                                                    type: 'input',
                                                    timestamp: Date.now(),
                                                    target: {
                                                        tag: target.tagName,
                                                        type: target.type || '',
                                                        name: target.name || '',
                                                        id: target.id || '',
                                                        placeholder: target.placeholder || ''
                                                    },
                                                    valueLength: target.value ? target.value.length : 0,
                                                    hasValue: !!target.value,
                                                    url: window.location.href
                                                });
                                            }
                                        } catch(err) {
                                            console.error('Input capture error:', err);
                                        }
                                    }, true);
                                    
                                    // Capture form submissions
                                    document.addEventListener('submit', function(e) {
                                        try {
                                            window._recorderEvents.push({
                                                type: 'form_submit',
                                                timestamp: Date.now(),
                                                formId: e.target.id || '',
                                                url: window.location.href
                                            });
                                        } catch(err) {
                                            console.error('Form submit capture error:', err);
                                        }
                                    }, true);
                                    
                                    // Capture key presses (Enter, Tab, etc.)
                                    document.addEventListener('keydown', function(e) {
                                        try {
                                            if (['Enter', 'Tab', 'Escape'].includes(e.key)) {
                                                window._recorderEvents.push({
                                                    type: 'keypress',
                                                    timestamp: Date.now(),
                                                    key: e.key,
                                                    target: {
                                                        tag: e.target.tagName,
                                                        id: e.target.id || '',
                                                        type: e.target.type || ''
                                                    },
                                                    url: window.location.href
                                                });
                                            }
                                        } catch(err) {
                                            console.error('Keypress capture error:', err);
                                        }
                                    }, true);
                                    
                                    // Monitor URL changes
                                    var lastUrl = window.location.href;
                                    setInterval(function() {
                                        try {
                                            if (window.location.href !== lastUrl) {
                                                window._recorderEvents.push({
                                                    type: 'url_change',
                                                    timestamp: Date.now(),
                                                    from: lastUrl,
                                                    to: window.location.href
                                                });
                                                lastUrl = window.location.href;
                                            }
                                        } catch(err) {
                                            console.error('URL change capture error:', err);
                                        }
                                    }, 500);
                                    
                                    return 'event_listeners_installed';
                                } catch(err) {
                                    return 'error: ' + err.toString();
                                }
                            })();
                        "
                    end tell
                end tell
            end tell
            '''
            result = self._run_applescript(script)
            if 'error' in result.lower():
                logger.warning(f"⚠️  Event listener installation returned: {result}")
            else:
                logger.info("✅ Event listeners installed in Safari")
            
            # Verify installation by checking if _recorderEvents exists
            await asyncio.sleep(1)
            verify_script = '''
            tell application "Safari"
                tell front window
                    tell current tab
                        do JavaScript "
                            (function() {
                                if (window._recorderEvents) {
                                    return 'verified: ' + (Array.isArray(window._recorderEvents) ? 'array_exists' : 'not_array');
                                }
                                return 'not_installed';
                            })();
                        "
                    end tell
                end tell
            end tell
            '''
            verify_result = self._run_applescript(verify_script)
            logger.debug(f"Event listener verification: {verify_result}")
            
            return True
        except Exception as e:
            logger.warning(f"Could not install event listeners: {e}")
            import traceback
            logger.debug(traceback.format_exc())
            return False
    
    async def get_captured_events(self) -> List[Dict]:
        """Get all events captured by JavaScript listeners."""
        try:
            script = '''
            tell application "Safari"
                tell front window
                    tell current tab
                        do JavaScript "
                            (function() {
                                if (window._recorderEvents && window._recorderEvents.length > 0) {
                                    var events = window._recorderEvents.slice();
                                    window._recorderEvents = []; // Clear after reading
                                    return JSON.stringify(events);
                                }
                                return JSON.stringify([]);
                            })();
                        "
                    end tell
                end tell
            end tell
            '''
            result = self._run_applescript(script)
            import json
            events = json.loads(result)
            return events
        except Exception as e:
            logger.debug(f"Error getting captured events: {e}")
            return []
    
    async def get_current_url(self) -> str:
        """Get the current URL from Safari."""
        try:
            script = '''
            tell application "Safari"
                return URL of current tab of front window
            end tell
            '''
            return self._run_applescript(script)
        except:
            return ""
    
    async def get_page_state(self) -> Dict:
        """Get comprehensive page state including DOM changes, inputs, etc."""
        try:
            script = '''
            tell application "Safari"
                tell front window
                    tell current tab
                        try
                            set pageURL to URL
                            set pageTitle to name
                            
                            set jsResult to do JavaScript "
                                (function() {
                                    try {
                                        var state = {
                                            url: window.location.href || '',
                                            title: document.title || '',
                                            hasLoginForm: !!document.querySelector('input[type=\\\"password\\\"], input[name*=\\\"password\\\" i], input[id*=\\\"password\\\" i]'),
                                            hasCodeInput: !!document.querySelector('input[type=\\\"text\\\"][placeholder*=\\\"code\\\" i], input[autocomplete=\\\"one-time-code\\\"]'),
                                            hasCaptcha: !!document.querySelector('.secsdk-captcha-wrapper, [class*=\\\"captcha\\\"]'),
                                            inputFields: Array.from(document.querySelectorAll('input[type=\\\"text\\\"], input[type=\\\"email\\\"], input[type=\\\"password\\\"], input[type=\\\"number\\\"]')).filter(function(input) {
                                                return input.offsetParent !== null;
                                            }).map(function(input) {
                                                return {
                                                    type: input.type || '',
                                                    name: input.name || '',
                                                    id: input.id || '',
                                                    placeholder: input.placeholder || '',
                                                    hasValue: !!input.value,
                                                    valueLength: input.value ? input.value.length : 0
                                                };
                                            }),
                                            buttons: Array.from(document.querySelectorAll('button, [role=\\\"button\\\"], input[type=\\\"submit\\\"]')).filter(function(btn) {
                                                return btn.offsetParent !== null;
                                            }).map(function(btn) {
                                                return {
                                                    text: (btn.textContent || btn.innerText || '').trim().substring(0, 50),
                                                    type: btn.type || 'button',
                                                    id: btn.id || '',
                                                    class: btn.className || ''
                                                };
                                            }),
                                            forms: document.forms ? document.forms.length : 0,
                                            links: document.links ? document.links.length : 0
                                        };
                                        return JSON.stringify(state);
                                    } catch(e) {
                                        return JSON.stringify({error: e.toString(), url: window.location.href || '', title: document.title || ''});
                                    }
                                })();
                            "
                            
                            return pageURL & \"|\" & pageTitle & \"|\" & jsResult
                        on error errMsg
                            return \"error|\" & errMsg
                        end try
                    end tell
                end tell
            end tell
            '''
            result = self._run_applescript(script)
            
            # Parse result (URL|Title|JSON)
            parts = result.split('|', 2)
            if len(parts) >= 3:
                url = parts[0] if parts[0] != 'error' else ''
                title = parts[1] if parts[1] else ''
                js_data = parts[2] if len(parts) > 2 else '{}'
                
                import json
                state = json.loads(js_data)
                
                # Override with AppleScript values if JS failed
                if not state.get('url'):
                    state['url'] = url
                if not state.get('title'):
                    state['title'] = title
                
                return state
            else:
                # Fallback: just get URL and title
                url = await self.get_current_url()
                return {
                    'url': url,
                    'title': '',
                    'inputFields': [],
                    'buttons': [],
                    'hasLoginForm': False,
                    'hasCodeInput': False,
                    'hasCaptcha': False
                }
        except Exception as e:
            logger.debug(f"Error getting page state: {e}")
            # Fallback to basic URL
            try:
                url = await self.get_current_url()
                return {'url': url, 'title': '', 'inputFields': [], 'buttons': []}
            except:
                return {}
    
    async def monitor_dom_changes(self, callback) -> None:
        """Monitor DOM changes and call callback with changes."""
        try:
            script = '''
            tell application "Safari"
                tell front window
                    tell current tab
                        do JavaScript "
                            (function() {
                                var observer = new MutationObserver(function(mutations) {
                                    var changes = [];
                                    mutations.forEach(function(mutation) {
                                        if (mutation.type === 'childList') {
                                            changes.push({
                                                type: 'element_added',
                                                target: mutation.target.tagName || 'unknown'
                                            });
                                        } else if (mutation.type === 'attributes') {
                                            changes.push({
                                                type: 'attribute_changed',
                                                attribute: mutation.attributeName,
                                                target: mutation.target.tagName || 'unknown'
                                            });
                                        }
                                    });
                                    return JSON.stringify(changes);
                                });
                                
                                observer.observe(document.body, {
                                    childList: true,
                                    subtree: true,
                                    attributes: true,
                                    attributeFilter: ['class', 'id', 'style']
                                });
                                
                                return 'observer_started';
                            })();
                        "
                    end tell
                end tell
            end tell
            '''
            self._run_applescript(script)
        except Exception as e:
            logger.debug(f"Error setting up DOM observer: {e}")
    
    async def wait_for_url_change(self, timeout: int = 60):
        """Wait for URL to change (indicates navigation)."""
        initial_url = await self.get_current_url()
        logger.info(f"Waiting for navigation from: {initial_url}")
        
        for _ in range(timeout):
            await asyncio.sleep(1)
            current_url = await self.get_current_url()
            if current_url != initial_url:
                logger.info(f"URL changed to: {current_url}")
                return current_url
        
        return None
    
    async def check_for_login_success(self) -> bool:
        """Check if login appears successful by checking URL or page content."""
        try:
            current_url = await self.get_current_url()
            
            # Check if we're on TikTok and not on login page
            if "tiktok.com" in current_url and "login" not in current_url.lower():
                # Try to check for profile indicators
                script = '''
                tell application "Safari"
                    tell front window
                        tell current tab
                            do JavaScript "document.querySelector('[data-e2e=\\'profile-icon\\'], [data-e2e=\\'upload-icon\\]') ? 'found' : 'not found'"
                        end tell
                    end tell
                end tell
                '''
                result = self._run_applescript(script)
                if "found" in result.lower():
                    return True
            
            return False
        except Exception as e:
            logger.debug(f"Error checking login status: {e}")
            return False
    
    async def detect_captcha(self) -> Optional[Dict]:
        """Detect if a captcha is present in Safari."""
        try:
            script = '''
            tell application "Safari"
                tell front window
                    tell current tab
                        do JavaScript "
                            (function() {
                                var selectors = [
                                    'iframe[id*=\"captcha\"]',
                                    'div[class*=\"captcha\"]',
                                    '.secsdk-captcha-wrapper',
                                    '#secsdk-captcha-drag-wrapper',
                                    'canvas[class*=\"captcha\"]'
                                ];
                                for (var i = 0; i < selectors.length; i++) {
                                    var el = document.querySelector(selectors[i]);
                                    if (el) {
                                        return JSON.stringify({
                                            found: true,
                                            selector: selectors[i],
                                            type: el.className.includes('slide') || el.className.includes('puzzle') ? 'slide' : 
                                                  el.className.includes('whirl') || el.className.includes('rotate') ? 'whirl' :
                                                  el.className.includes('3d') ? '3d' : 'unknown'
                                        });
                                    }
                                }
                                return JSON.stringify({found: false});
                            })();
                        "
                    end tell
                end tell
            end tell
            '''
            result = self._run_applescript(script)
            
            # Parse JSON result
            import json
            captcha_data = json.loads(result)
            
            if captcha_data.get("found"):
                logger.warning(f"⚠️  CAPTCHA DETECTED in Safari: {captcha_data.get('selector')}")
                return {
                    "detected": True,
                    "selector": captcha_data.get("selector"),
                    "type": captcha_data.get("type", "unknown")
                }
            
            return None
        except Exception as e:
            logger.debug(f"Error detecting captcha in Safari: {e}")
            return None
    
    async def get_captcha_image_urls(self) -> Dict[str, str]:
        """Extract captcha image URLs from Safari."""
        try:
            script = '''
            tell application "Safari"
                tell front window
                    tell current tab
                        do JavaScript "
                            (function() {
                                var images = {};
                                var captchaEl = document.querySelector('.secsdk-captcha-wrapper, [class*=\"captcha\"]');
                                if (captchaEl) {
                                    var imgs = captchaEl.querySelectorAll('img');
                                    if (imgs.length >= 1) {
                                        images.main = imgs[0].src;
                                        if (imgs.length >= 2) {
                                            images.secondary = imgs[1].src;
                                        }
                                    }
                                }
                                return JSON.stringify(images);
                            })();
                        "
                    end tell
                end tell
            end tell
            '''
            result = self._run_applescript(script)
            import json
            return json.loads(result)
        except Exception as e:
            logger.error(f"Error extracting captcha images: {e}")
            return {}
    
    async def apply_captcha_solution(self, solution: Dict, captcha_type: str):
        """Apply captcha solution to Safari."""
        try:
            if captcha_type in ["slide", "whirl"]:
                # Get the distance/angle from solution
                distance = solution.get('x') or solution.get('data', {}).get('x', 0)
                if captcha_type == "whirl":
                    angle = solution.get('angle') or solution.get('data', {}).get('angle', 0)
                    # Convert angle to distance (approximate)
                    distance = (angle / 360) * 300  # Assume 300px slider width
                
                # Drag the slider
                script = f'''
                tell application "Safari"
                    tell front window
                        tell current tab
                            do JavaScript "
                                (function() {{
                                    var slider = document.querySelector('.secsdk-captcha-drag-icon, [class*=\"drag-icon\"]');
                                    if (slider) {{
                                        var rect = slider.getBoundingClientRect();
                                        var startX = rect.left + rect.width / 2;
                                        var startY = rect.top + rect.height / 2;
                                        
                                        // Simulate mouse drag
                                        var event = new MouseEvent('mousedown', {{bubbles: true, cancelable: true}});
                                        slider.dispatchEvent(event);
                                        
                                        var moveEvent = new MouseEvent('mousemove', {{
                                            bubbles: true,
                                            cancelable: true,
                                            clientX: startX + {distance},
                                            clientY: startY
                                        }});
                                        document.dispatchEvent(moveEvent);
                                        
                                        setTimeout(function() {{
                                            var upEvent = new MouseEvent('mouseup', {{bubbles: true, cancelable: true}});
                                            document.dispatchEvent(upEvent);
                                        }}, 100);
                                        
                                        return 'dragged';
                                    }}
                                    return 'not found';
                                }})();
                            "
                        end tell
                    end tell
                end tell
                '''
                result = self._run_applescript(script)
                logger.info(f"Applied captcha solution: {result}")
            
            elif captcha_type == "3d":
                # Click on objects
                objects = solution.get('objects') or solution.get('data', {}).get('objects', [])
                for obj in objects:
                    x = obj.get('x', 0)
                    y = obj.get('y', 0)
                    script = f'''
                    tell application "Safari"
                        tell front window
                            tell current tab
                                do JavaScript "
                                    (function() {{
                                        var img = document.querySelector('.secsdk-captcha-wrapper img, [class*=\"captcha\"] img');
                                        if (img) {{
                                            var rect = img.getBoundingClientRect();
                                            var clickX = rect.left + {x};
                                            var clickY = rect.top + {y};
                                            var clickEvent = new MouseEvent('click', {{
                                                bubbles: true,
                                                cancelable: true,
                                                clientX: clickX,
                                                clientY: clickY
                                            }});
                                            img.dispatchEvent(clickEvent);
                                            return 'clicked';
                                        }}
                                        return 'not found';
                                    }})();
                                "
                            end tell
                        end tell
                    end tell
                    '''
                    self._run_applescript(script)
                    await asyncio.sleep(0.5)
                
        except Exception as e:
            logger.error(f"Error applying captcha solution: {e}")
    
    async def take_screenshot(self, filepath: Path):
        """Take a screenshot of Safari (requires additional setup)."""
        # Safari screenshots via AppleScript are limited
        # We'll use screencapture command instead
        try:
            subprocess.run(
                ["screencapture", "-l", str(filepath)],
                check=True,
                timeout=5
            )
            logger.info(f"Screenshot saved: {filepath}")
        except Exception as e:
            logger.warning(f"Could not take screenshot: {e}")
    
    async def enter_text_in_field(self, selector: str, text: str):
        """Enter text into a form field in Safari."""
        try:
            script = f'''
            tell application "Safari"
                tell front window
                    tell current tab
                        do JavaScript "
                            (function() {{
                                var field = document.querySelector('{selector}');
                                if (field) {{
                                    field.focus();
                                    field.value = '{text}';
                                    field.dispatchEvent(new Event('input', {{bubbles: true}}));
                                    field.dispatchEvent(new Event('change', {{bubbles: true}}));
                                    return 'entered';
                                }}
                                return 'not found';
                            }})();
                        "
                    end tell
                end tell
            end tell
            '''
            result = self._run_applescript(script)
            logger.info(f"Entered text in field: {result}")
            return "entered" in result.lower()
        except Exception as e:
            logger.error(f"Error entering text: {e}")
            return False
    
    async def find_verification_code_field(self) -> Optional[str]:
        """Find the verification code input field."""
        try:
            script = '''
            tell application "Safari"
                tell front window
                    tell current tab
                        do JavaScript "
                            (function() {{
                                var selectors = [
                                    'input[type=\"text\"][placeholder*=\"code\" i]',
                                    'input[type=\"text\"][placeholder*=\"verification\" i]',
                                    'input[type=\"number\"]',
                                    'input[name*=\"code\" i]',
                                    'input[id*=\"code\" i]',
                                    'input[class*=\"code\" i]',
                                    'input[autocomplete=\"one-time-code\"]'
                                ];
                                for (var i = 0; i < selectors.length; i++) {{
                                    var field = document.querySelector(selectors[i]);
                                    if (field && field.offsetParent !== null) {{
                                        return selectors[i];
                                    }}
                                }}
                                return null;
                            }})();
                        "
                    end tell
                end tell
            end tell
            '''
            result = self._run_applescript(script)
            if result and result != "null":
                return result.strip()
            return None
        except Exception as e:
            logger.debug(f"Error finding code field: {e}")
            return None
    
    async def enter_verification_code(self, code: str) -> bool:
        """Enter verification code into the code field."""
        field_selector = await self.find_verification_code_field()
        if not field_selector:
            logger.warning("Could not find verification code field")
            return False
        
        return await self.enter_text_in_field(field_selector, code)
    
    async def close_safari(self):
        """Close Safari (optional - user might want to keep it open)."""
        script = '''
        tell application "Safari"
            quit
        end tell
        '''
        try:
            self._run_applescript(script)
            logger.info("Safari closed")
        except Exception as e:
            logger.warning(f"Could not close Safari: {e}")


"""
Stable TikTok Selectors
Derived from analysis of TikTok's DOM structure.
Used for Safari/AppleScript automation via JavaScript injection.
"""

class TikTokSelectors:
    # Root containers
    APP_ROOT = "#app"
    FYP_ROOT = "#main-content-homepage_hot"
    MESSAGES_ROOT = "#main-content-messages"
    
    # Navigation
    # Target the "Main Nav" container in the sidebar
    NAV_CONTAINER_CLASS = "DivMainNavContainer"
    
    # Interaction Icons on FYP Video
    # Note: These often appear multiple times due to virtual scrolling.
    # Must use visibility check (getBoundingClientRect) to find the active one.
    COMMENT_ICON_ATTR = 'data-e2e="comment-icon"'
    LIKE_ICON_ATTR = 'data-e2e="like-icon"'
    SHARE_ICON_ATTR = 'data-e2e="share-icon"'
    
    # Comment Section (Right Sidebar/Drawer)
    # The container that holds the comment list and input footer
    COMMENT_SIDEBAR_WRAPPER_CLASS = "DivCommentSidebarTransitionWrapper"
    COMMENT_FOOTER_CLASS = "DivCommentFooter"
    POST_BUTTON_CLASS = "DivPostButton"
    
    # Input fields are often contenteditable divs
    COMMENT_INPUT_SELECTOR = '[contenteditable="true"]'
    
    # Messages / DMs
    CHAT_BOTTOM_BAR_CLASS = "DivChatBottom"
    MESSAGE_INPUT_CONTAINER_CLASS = "DivMessageInputAndSendButton"
    CHAT_MAIN_AREA_CLASS = "DivChatMain"
    
    # Helper methods to generate full JS query strings
    
    @staticmethod
    def get_comment_input_script():
        """JS to find the comment input field in the active drawer"""
        return f"""
        var footer = document.querySelector('[class*="{TikTokSelectors.COMMENT_FOOTER_CLASS}"]');
        if (footer) {{
            var input = footer.querySelector('{TikTokSelectors.COMMENT_INPUT_SELECTOR}');
            if (input) {{
                input.focus();
                'found';
            }} else {{
                'input_not_found';
            }}
        }} else {{
            'footer_not_found';
        }}
        """

    @staticmethod
    def get_visible_comment_icons_script():
        """JS to find visible comment icons"""
        return f"""
        var icons = document.querySelectorAll('[{TikTokSelectors.COMMENT_ICON_ATTR}]');
        var visible = null;
        for (var icon of icons) {{
            var rect = icon.getBoundingClientRect();
            if (rect.top > 0 && rect.top < window.innerHeight && rect.left > 0) {{
                visible = {{
                    x: rect.left + rect.width/2, 
                    y: rect.top + rect.height/2
                }};
                break;
            }}
        }}
        visible ? JSON.stringify(visible) : 'null';
        """

    @staticmethod
    def check_if_liked_script():
        """JS to check if the visible like icon is already active (red)"""
        return f"""
        var icons = document.querySelectorAll('[{TikTokSelectors.LIKE_ICON_ATTR}]');
        var isLiked = false;
        for (var icon of icons) {{
            var rect = icon.getBoundingClientRect();
            if (rect.top > 0 && rect.top < window.innerHeight && rect.left > 0) {{
                var svg = icon.querySelector('svg');
                if (svg) {{
                    var fill = window.getComputedStyle(svg).fill;
                    // Check for red color (rgb(255, 56, 92))
                    if (fill.includes('255, 56, 92')) {{
                        isLiked = true;
                    }}
                }}
                break;
            }}
        }}
        isLiked.toString();
        """

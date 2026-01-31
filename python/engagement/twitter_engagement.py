"""
Twitter/X Auto-Engagement Module

Automates engagement on Twitter/X posts with full context extraction:
- Navigate to For You feed
- Extract tweet content + replies
- Generate contextual AI comment
- Post reply with verification

Usage:
    from auto_engagement.twitter_engagement import TwitterEngagement
    
    twitter = TwitterEngagement()
    result = twitter.engage_with_post()
    print(f"Comment posted: {result.comment_posted}")
"""

import time
import json
from typing import Optional, List
from dataclasses import dataclass, field

from .safari_controller import SafariController
from .ai_comment_generator import AICommentGenerator


@dataclass
class TwitterEngagementResult:
    """Result of Twitter engagement."""
    success: bool
    username: str = ""
    post_url: str = ""
    post_content: str = ""
    replies_found: int = 0
    replies: List[str] = field(default_factory=list)
    liked: bool = False
    generated_comment: str = ""
    comment_posted: bool = False
    proof_screenshot: str = ""
    error: str = ""


class TwitterEngagement:
    """
    Twitter/X auto-engagement with full context extraction.
    
    Flow:
    1. Navigate to Twitter For You feed
    2. Find tweet with engagement
    3. Click into tweet to see replies
    4. Extract tweet + replies
    5. Generate contextual AI comment
    6. Post reply
    7. Capture proof screenshot
    """
    
    TWITTER_URL = "https://x.com/home"
    
    # JavaScript to find a tweet in the feed
    JS_FIND_TWEET = '''
    (function() {
        // Find tweets in the timeline - try multiple selectors
        var tweets = document.querySelectorAll('article[data-testid="tweet"]');
        if (!tweets.length) {
            tweets = document.querySelectorAll('article[role="article"]');
        }
        if (!tweets.length) {
            tweets = document.querySelectorAll('[data-testid="cellInnerDiv"] article');
        }
        
        for (var i = 0; i < Math.min(tweets.length, 15); i++) {
            var tweet = tweets[i];
            
            // Get username from multiple possible locations
            var username = '';
            var userLinks = tweet.querySelectorAll('a[href^="/"]');
            for (var j = 0; j < userLinks.length; j++) {
                var href = userLinks[j].getAttribute('href') || '';
                if (href.match(/^\\/[a-zA-Z0-9_]+$/) && !href.includes('/status/')) {
                    username = href.replace('/', '');
                    break;
                }
            }
            
            // Fallback: extract from any @username text
            if (!username) {
                var allText = tweet.innerText;
                var atMatch = allText.match(/@([a-zA-Z0-9_]{1,15})/);
                if (atMatch) username = atMatch[1];
            }
            
            // Get tweet text
            var tweetText = tweet.querySelector('[data-testid="tweetText"]');
            if (!tweetText) tweetText = tweet.querySelector('[lang]');
            var content = tweetText ? tweetText.innerText : '';
            
            // Get tweet link
            var timeLink = tweet.querySelector('a[href*="/status/"]');
            var tweetUrl = timeLink ? timeLink.href : '';
            
            // Skip if no content or too short (allow shorter tweets)
            if (username && content.length > 10 && tweetUrl) {
                return JSON.stringify({
                    username: username,
                    url: tweetUrl,
                    content: content.substring(0, 300),
                    index: i
                });
            }
        }
        return JSON.stringify({error: 'No suitable tweet found', debug: 'Found ' + tweets.length + ' articles'});
    })()
    '''
    
    # JavaScript to click into a tweet
    JS_CLICK_TWEET = '''
    (function() {
        var tweets = document.querySelectorAll('article[data-testid="tweet"]');
        var targetIndex = {index};
        if (tweets[targetIndex]) {
            // Click the tweet to open it
            var tweetText = tweets[targetIndex].querySelector('[data-testid="tweetText"]');
            if (tweetText) {
                tweetText.click();
                return 'clicked';
            }
            tweets[targetIndex].click();
            return 'clicked_article';
        }
        return 'not_found';
    })()
    '''
    
    # JavaScript to extract tweet and replies
    JS_EXTRACT_TWEET_DATA = '''
    (function() {
        var data = {
            mainTweet: '',
            username: '',
            engagement: '',
            replies: []
        };
        
        // Get main tweet (first article on the page in detail view)
        var articles = document.querySelectorAll('article[data-testid="tweet"]');
        if (articles.length > 0) {
            var mainArticle = articles[0];
            
            // Get username
            var userLink = mainArticle.querySelector('a[href^="/"][role="link"]');
            if (userLink) {
                var href = userLink.getAttribute('href');
                if (href && href.startsWith('/') && !href.includes('/status/')) {
                    data.username = href.replace('/', '');
                }
            }
            
            // Get tweet text
            var tweetText = mainArticle.querySelector('[data-testid="tweetText"]');
            data.mainTweet = tweetText ? tweetText.innerText : '';
            
            // Get engagement stats
            var statsGroup = mainArticle.querySelector('[role="group"]');
            if (statsGroup) {
                data.engagement = statsGroup.innerText.replace(/\\n/g, ' ');
            }
        }
        
        // Get replies (subsequent articles)
        for (var i = 1; i < Math.min(articles.length, 10); i++) {
            var reply = articles[i];
            var replyText = reply.querySelector('[data-testid="tweetText"]');
            var replyUser = reply.querySelector('a[href^="/"][role="link"]');
            
            if (replyText && replyUser) {
                var username = replyUser.getAttribute('href').replace('/', '');
                data.replies.push('@' + username + ': ' + replyText.innerText.substring(0, 150));
            }
        }
        
        return JSON.stringify(data);
    })()
    '''
    
    # JavaScript to like the tweet
    JS_LIKE_TWEET = '''
    (function() {
        var likeButton = document.querySelector('[data-testid="like"]');
        if (likeButton) {
            likeButton.click();
            return 'liked';
        }
        return 'not_found';
    })()
    '''
    
    # JavaScript to click reply button
    JS_CLICK_REPLY = '''
    (function() {
        var replyButton = document.querySelector('[data-testid="reply"]');
        if (replyButton) {
            replyButton.click();
            return 'clicked';
        }
        return 'not_found';
    })()
    '''
    
    # JavaScript to focus the reply input
    JS_FOCUS_INPUT = '''
    (function() {
        // Strategy 1: Find contenteditable in #layers modal
        var layers = document.querySelector('#layers');
        if (layers) {
            var editable = layers.querySelector('[contenteditable="true"]');
            if (editable && editable.offsetParent !== null) {
                editable.focus();
                editable.click();
                return 'focused_layers_editable';
            }
        }
        
        // Strategy 2: Find the reply composer by data-testid
        var composer = document.querySelector('[data-testid="tweetTextarea_0"]');
        if (composer) {
            var editable = composer.querySelector('[contenteditable="true"]') || composer;
            editable.focus();
            editable.click();
            return 'focused_textarea';
        }
        
        // Strategy 3: Look for contenteditable in modal dialog
        var modal = document.querySelector('[aria-modal="true"]');
        if (modal) {
            var editable = modal.querySelector('[contenteditable="true"]');
            if (editable) {
                editable.focus();
                editable.click();
                return 'focused_modal_editable';
            }
        }
        
        return 'not_found';
    })()
    '''
    
    # JavaScript to submit the reply
    JS_SUBMIT = '''
    (function() {
        // Strategy 1: Find Reply button in modal layers (user-provided selector)
        var layersBtn = document.querySelector('#layers button');
        if (layersBtn) {
            // Find the actual Reply button in the modal
            var btns = document.querySelectorAll('#layers button');
            for (var i = 0; i < btns.length; i++) {
                var btn = btns[i];
                var text = (btn.innerText || '').trim();
                if (text === 'Reply' && btn.offsetParent !== null) {
                    btn.click();
                    return 'clicked_layers_reply';
                }
            }
        }
        
        // Strategy 2: Find Reply button by data-testid
        var replyBtn = document.querySelector('[data-testid="tweetButton"]');
        if (replyBtn && replyBtn.offsetParent !== null) {
            replyBtn.click();
            return 'submitted_tweetButton';
        }
        
        // Strategy 3: Find inline reply button
        var inlineBtn = document.querySelector('[data-testid="tweetButtonInline"]');
        if (inlineBtn && inlineBtn.offsetParent !== null) {
            inlineBtn.click();
            return 'submitted_inline';
        }
        
        // Strategy 4: Find button with exact "Reply" text anywhere
        var buttons = document.querySelectorAll('button');
        for (var i = 0; i < buttons.length; i++) {
            var btn = buttons[i];
            var text = (btn.innerText || '').trim();
            if (text === 'Reply' && btn.offsetParent !== null) {
                var rect = btn.getBoundingClientRect();
                if (rect.width > 50) {
                    btn.click();
                    return 'clicked_reply_button';
                }
            }
        }
        
        return 'not_found';
    })()
    '''
    
    def __init__(self, openai_api_key: Optional[str] = None):
        """
        Initialize Twitter engagement.
        
        Args:
            openai_api_key: OpenAI API key for comment generation
        """
        self.safari = SafariController()
        self.ai = AICommentGenerator(api_key=openai_api_key)
    
    def engage_with_post(self) -> TwitterEngagementResult:
        """
        Run the full Twitter engagement flow.
        
        Returns:
            TwitterEngagementResult with details of engagement
        """
        timestamp = int(time.time())
        result = TwitterEngagementResult(success=False)
        
        # Step 1: Navigate to Twitter
        print("\n[1/8] Navigating to Twitter...")
        if not self.safari.navigate_to(self.TWITTER_URL):
            result.error = "Failed to navigate to Twitter"
            return result
        time.sleep(4)
        
        # Verify we're on Twitter
        current_url = self.safari.get_current_url()
        if 'x.com' not in current_url and 'twitter.com' not in current_url:
            result.error = f"Not on Twitter: {current_url}"
            return result
        print(f"   ✅ On Twitter")
        
        # Step 2: Find a tweet
        print("\n[2/8] Finding tweet in feed...")
        tweet_data = self.safari.execute_js(self.JS_FIND_TWEET)
        try:
            tweet_info = json.loads(tweet_data) if tweet_data else {}
        except:
            tweet_info = {}
        
        if 'error' in tweet_info or not tweet_info.get('username'):
            result.error = "Could not find suitable tweet"
            return result
        
        result.username = f"@{tweet_info.get('username', '')}"
        result.post_url = tweet_info.get('url', '')
        tweet_index = tweet_info.get('index', 0)
        print(f"   ✅ Found: {result.username}")
        print(f"   Content: {tweet_info.get('content', '')[:60]}...")
        
        # Step 3: Click into the tweet
        print("\n[3/8] Opening tweet...")
        click_js = self.JS_CLICK_TWEET.replace('{index}', str(tweet_index))
        click_result = self.safari.execute_js(click_js)
        print(f"   {click_result}")
        time.sleep(3)
        
        # Step 4: Extract tweet and replies
        print("\n[4/8] Extracting tweet and replies...")
        extract_data = self.safari.execute_js(self.JS_EXTRACT_TWEET_DATA)
        try:
            tweet_detail = json.loads(extract_data) if extract_data else {}
        except:
            tweet_detail = {}
        
        result.post_content = tweet_detail.get('mainTweet', '')[:500]
        result.replies = tweet_detail.get('replies', [])
        result.replies_found = len(result.replies)
        
        print(f"   ✅ Tweet: {result.post_content[:60]}...")
        print(f"   ✅ Engagement: {tweet_detail.get('engagement', 'N/A')}")
        print(f"   ✅ Replies: {result.replies_found}")
        if result.replies:
            for reply in result.replies[:3]:
                print(f"      - {reply[:50]}...")
        
        # Step 5: Like the tweet
        print("\n[5/8] Liking tweet...")
        like_result = self.safari.execute_js(self.JS_LIKE_TWEET)
        result.liked = like_result == 'liked'
        print(f"   {like_result}")
        time.sleep(1)
        
        # Step 6: Generate AI comment
        print("\n[6/8] Generating AI comment...")
        comment_result = self.ai.generate_comment(
            platform="twitter",
            post_content=result.post_content,
            existing_comments=result.replies,
            username=result.username,
            engagement=tweet_detail.get('engagement', '')
        )
        if not comment_result.success:
            result.error = f"AI generation failed: {comment_result.error}"
            return result
        
        result.generated_comment = comment_result.text
        print(f"   ✅ Generated: \"{result.generated_comment}\"")
        
        # Step 7: Post reply
        print("\n[7/8] Posting reply...")
        
        # Click reply button to open composer
        reply_click = self.safari.execute_js(self.JS_CLICK_REPLY)
        print(f"   Reply button: {reply_click}")
        time.sleep(2)
        
        # Focus input
        focus_result = self.safari.execute_js(self.JS_FOCUS_INPUT)
        if 'focused' not in focus_result:
            result.error = "Could not focus reply input"
            return result
        print(f"   Focus: {focus_result}")
        time.sleep(0.5)
        
        # Type comment
        self.safari.type_via_clipboard(result.generated_comment)
        print(f"   ✅ Typed")
        time.sleep(1)
        
        # Submit
        submit_result = self.safari.execute_js(self.JS_SUBMIT)
        result.comment_posted = 'clicked' in submit_result or 'submitted' in submit_result
        print(f"   Submit: {submit_result}")
        time.sleep(8)  # Wait for reply to post
        
        # Step 8: Capture proof
        print("\n[8/8] Capturing proof...")
        result.proof_screenshot = f"/tmp/twitter_proof_{timestamp}.png"
        self.safari.take_screenshot(result.proof_screenshot)
        print(f"   📸 {result.proof_screenshot}")
        
        result.success = True
        return result


def main():
    """Test Twitter engagement."""
    import os
    
    print("=" * 60)
    print("🐦 TWITTER/X ENGAGEMENT")
    print("=" * 60)
    
    api_key = os.environ.get('OPENAI_API_KEY')
    twitter = TwitterEngagement(openai_api_key=api_key)
    result = twitter.engage_with_post()
    
    print("\n" + "=" * 60)
    print("📊 RESULT")
    print("=" * 60)
    print(f"Success: {result.success}")
    print(f"Username: {result.username}")
    print(f"Tweet: {result.post_content[:50]}..." if result.post_content else "No tweet")
    print(f"Liked: {result.liked}")
    print(f"Replies found: {result.replies_found}")
    print(f"Comment: {result.generated_comment}")
    print(f"Posted: {result.comment_posted}")
    print(f"Proof: {result.proof_screenshot}")
    if result.error:
        print(f"Error: {result.error}")


if __name__ == "__main__":
    main()

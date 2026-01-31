"""
AI Comment Generator for Social Media Engagement

Uses OpenAI GPT-4o to generate contextual, authentic comments based on
post content, existing comments, and engagement metrics.

Usage:
    from auto_engagement.ai_comment_generator import AICommentGenerator
    
    generator = AICommentGenerator()
    comment = generator.generate_comment(
        platform='instagram',
        post_content='Amazing sunset photo!',
        existing_comments=['So beautiful!', 'Where is this?'],
        username='photographer123',
        engagement='1.2K likes'
    )
"""

import os
import base64
import requests
from typing import List, Optional
from dataclasses import dataclass, field


@dataclass
class PostContext:
    """Context data for generating a comment."""
    platform: str
    username: str = ""
    post_content: str = ""
    visual_summary: str = ""
    existing_comments: List[str] = field(default_factory=list)
    engagement: str = ""
    post_url: str = ""


@dataclass
class GeneratedComment:
    """Result of comment generation."""
    text: str
    success: bool
    error: str = ""


class AICommentGenerator:
    """
    AI-powered comment generator using OpenAI GPT-4o.
    
    Generates authentic, contextual comments that:
    - Reference specific content from the post
    - Add to the conversation naturally
    - Feel human and relatable
    - Use appropriate emojis for each platform
    """
    
    PLATFORM_VIBES = {
        'instagram': 'supportive and engaging',
        'threads': 'conversational and thoughtful',
        'tiktok': 'casual and fun',
        'twitter': 'witty and concise',
        'youtube': 'appreciative and engaging'
    }
    
    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize the comment generator.
        
        Args:
            api_key: OpenAI API key (defaults to OPENAI_API_KEY env var)
        """
        self.api_key = api_key or os.environ.get('OPENAI_API_KEY')
        if not self.api_key:
            raise ValueError("OpenAI API key required. Set OPENAI_API_KEY env var or pass api_key.")
    
    def generate_comment(
        self,
        platform: str,
        post_content: str,
        existing_comments: List[str] = None,
        username: str = "",
        engagement: str = "",
        max_length: int = 80
    ) -> GeneratedComment:
        """
        Generate a contextual comment for a social media post.
        
        Args:
            platform: Social platform (instagram, threads, tiktok, etc.)
            post_content: Main post content/caption/description
            existing_comments: List of existing comments on the post
            username: Creator's username
            engagement: Engagement stats string (e.g., "1.2K likes, 50 comments")
            max_length: Maximum comment length in characters
            
        Returns:
            GeneratedComment with text and success status
        """
        try:
            comments_text = "\n".join(existing_comments[:5]) if existing_comments else "No comments yet"
            platform_vibe = self.PLATFORM_VIBES.get(platform.lower(), 'engaging')
            
            prompt = f"""You are commenting on a {platform} post. Generate a SHORT, authentic comment (max {max_length} chars) with 1-2 emojis.

POST BY @{username}:
{post_content[:400]}

{f'ENGAGEMENT: {engagement}' if engagement else ''}

WHAT OTHERS ARE SAYING:
{comments_text}

Generate a thoughtful comment that:
- References specific content from the post when possible
- Adds to the conversation naturally (not just "great post!")
- Feels authentic and human
- Uses appropriate emojis for {platform}
- Matches the platform vibe: {platform_vibe}

Output ONLY the comment text:"""

            headers = {
                'Authorization': f'Bearer {self.api_key}',
                'Content-Type': 'application/json'
            }
            
            payload = {
                'model': 'gpt-4o',
                'messages': [{'role': 'user', 'content': prompt}],
                'max_tokens': 60,
                'temperature': 0.85
            }
            
            response = requests.post(
                'https://api.openai.com/v1/chat/completions',
                headers=headers,
                json=payload,
                timeout=20
            )
            
            if response.status_code == 200:
                text = response.json()['choices'][0]['message']['content'].strip().strip('"')
                return GeneratedComment(text=text, success=True)
            else:
                return GeneratedComment(
                    text="",
                    success=False,
                    error=f"API error: {response.status_code}"
                )
                
        except Exception as e:
            return GeneratedComment(text="", success=False, error=str(e))
    
    def analyze_image(self, image_path: str, prompt: str = None) -> str:
        """
        Analyze an image using OpenAI Vision.
        
        Args:
            image_path: Path to image file
            prompt: Analysis prompt (defaults to content description)
            
        Returns:
            Analysis text or empty string on failure
        """
        if not os.path.exists(image_path):
            return ""
        
        try:
            with open(image_path, 'rb') as f:
                image_data = base64.b64encode(f.read()).decode('utf-8')
            
            analysis_prompt = prompt or "Describe this social media post in one sentence - what's shown and the vibe."
            
            headers = {
                'Authorization': f'Bearer {self.api_key}',
                'Content-Type': 'application/json'
            }
            
            payload = {
                'model': 'gpt-4o',
                'messages': [{
                    'role': 'user',
                    'content': [
                        {'type': 'text', 'text': analysis_prompt},
                        {'type': 'image_url', 'image_url': {'url': f'data:image/png;base64,{image_data}'}}
                    ]
                }],
                'max_tokens': 150
            }
            
            response = requests.post(
                'https://api.openai.com/v1/chat/completions',
                headers=headers,
                json=payload,
                timeout=30
            )
            
            if response.status_code == 200:
                return response.json()['choices'][0]['message']['content']
                
        except Exception as e:
            print(f"Vision API error: {e}")
        
        return ""
    
    def generate_from_context(self, context: PostContext) -> GeneratedComment:
        """
        Generate comment from a PostContext object.
        
        Args:
            context: PostContext with all available data
            
        Returns:
            GeneratedComment result
        """
        content = context.post_content or context.visual_summary or ""
        return self.generate_comment(
            platform=context.platform,
            post_content=content,
            existing_comments=context.existing_comments,
            username=context.username,
            engagement=context.engagement
        )

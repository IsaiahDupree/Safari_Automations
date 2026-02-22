/**
 * AI Comment Generator for Threads
 * 
 * Based on python/utils/ai_comment_generator.py
 * 
 * Analyzes post content, images, and existing comments
 * to generate contextual, engaging AI-powered comments.
 */

// PostContext from python/utils/ai_comment_generator.py
export interface PostContext {
  platform: string;
  username: string;
  postContent: string;
  visualSummary?: string;  // Description of images/videos
  existingComments: string[];
  engagement?: string;  // e.g., "1.2K likes, 50 comments"
  postUrl?: string;
  likeCount?: string;
  replyCount?: string;
}

export interface PostAnalysis {
  mainPost: string;
  username: string;
  replies: string[];
  hasImage: boolean;
  hasVideo: boolean;
  sentiment: 'positive' | 'negative' | 'neutral' | 'question';
  topics: string[];
  tone: string;
  engagement?: string;
  isInappropriate?: boolean;
  skipReason?: string;
}

// Content filter for inappropriate/thirst trap posts
const INAPPROPRIATE_KEYWORDS = [
  // Suggestive/thirst trap indicators
  'onlyfans', 'of link', 'link in bio', 'dm for more', 'dm me',
  'swipe up', 'exclusive content', 'subscribe', 'spicy', 'uncensored',
  'nsfw', '18+', 'adults only', 'mature content',
  // Body-focused thirst trap phrases
  'rate me', 'am i pretty', 'am i hot', 'do you like', 'what would you do',
  'smash or pass', 'would you date', 'sliding into', 'hit me up',
  // Spam/scam indicators
  'crypto', 'nft drop', 'free money', 'giveaway', 'dm to win',
  'make money fast', 'passive income', 'get rich',
];

const INAPPROPRIATE_EMOJIS = [
  '🍑', '🍆', '🥵', '💦', '🔞', '👅', '💋', '🤤',
];

export function isInappropriateContent(text: string): { inappropriate: boolean; reason?: string } {
  const lowerText = text.toLowerCase();
  
  // Check keywords
  for (const keyword of INAPPROPRIATE_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      return { inappropriate: true, reason: `Contains "${keyword}"` };
    }
  }
  
  // Check emojis (multiple suggestive emojis = likely thirst trap)
  let emojiCount = 0;
  for (const emoji of INAPPROPRIATE_EMOJIS) {
    if (text.includes(emoji)) {
      emojiCount++;
    }
  }
  if (emojiCount >= 2) {
    return { inappropriate: true, reason: 'Multiple suggestive emojis detected' };
  }
  
  // Check for minimal text with just emojis (common thirst trap pattern)
  const textWithoutEmojis = text.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim();
  if (textWithoutEmojis.length < 10 && text.length > 5) {
    // Very short text with emojis - check if it's just attention seeking
    const attentionPhrases = ['hey', 'hi', 'hello', 'look', 'check', 'new', 'just'];
    if (attentionPhrases.some(p => lowerText.includes(p)) && text.includes('📸')) {
      return { inappropriate: true, reason: 'Minimal text with photo indicator' };
    }
  }
  
  return { inappropriate: false };
}

export interface GeneratedComment {
  text: string;
  success: boolean;
  error?: string;
}

export interface AICommentConfig {
  provider: 'openai' | 'anthropic' | 'local';
  apiKey?: string;
  model?: string;
  maxLength?: number;
  temperature?: number;
  style?: 'engaging' | 'supportive' | 'insightful' | 'curious' | 'relatable';
}

// Platform vibes from python/utils/ai_comment_generator.py
const PLATFORM_VIBES: Record<string, string> = {
  instagram: 'supportive and engaging',
  threads: 'conversational and thoughtful',
  tiktok: 'casual and fun',
  twitter: 'witty and concise',
  youtube: 'appreciative and engaging',
};

const DEFAULT_CONFIG: AICommentConfig = {
  provider: 'openai',
  model: 'gpt-4o',
  maxLength: 80,
  temperature: 0.85,
  style: 'engaging',
};

export class ThreadsAICommentGenerator {
  private config: AICommentConfig;

  constructor(config: Partial<AICommentConfig> = {}) {
    // Load API key from environment if not provided
    const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    this.config = { 
      ...DEFAULT_CONFIG, 
      ...config,
      apiKey,
      provider: apiKey ? 'openai' : 'local',
    };
    
    if (apiKey) {
      console.log('[AI] ✅ OpenAI API key loaded - using GPT-4o');
    } else {
      console.log('[AI] ⚠️ No API key - using local templates');
    }
  }

  /**
   * Analyze post content to extract context
   */
  analyzePost(context: { mainPost: string; username: string; replies: string[] }): PostAnalysis {
    const { mainPost, username, replies } = context;
    
    // Detect sentiment
    const positiveWords = ['love', 'amazing', 'great', 'awesome', 'beautiful', 'happy', '😍', '🔥', '✨', '💯'];
    const negativeWords = ['hate', 'bad', 'terrible', 'sad', 'awful', 'annoying', '😢', '😡'];
    const questionWords = ['?', 'why', 'how', 'what', 'when', 'who', 'does', 'can'];
    
    const lowerPost = mainPost.toLowerCase();
    let sentiment: PostAnalysis['sentiment'] = 'neutral';
    
    if (questionWords.some(w => lowerPost.includes(w))) {
      sentiment = 'question';
    } else if (positiveWords.some(w => lowerPost.includes(w))) {
      sentiment = 'positive';
    } else if (negativeWords.some(w => lowerPost.includes(w))) {
      sentiment = 'negative';
    }
    
    // Detect topics from keywords
    const topicKeywords: Record<string, string[]> = {
      tech: ['code', 'software', 'ai', 'app', 'developer', 'programming', 'tech'],
      art: ['art', 'design', 'creative', 'draw', 'paint', 'artist', 'visual'],
      fitness: ['gym', 'workout', 'fitness', 'health', 'exercise', 'lift'],
      business: ['business', 'entrepreneur', 'startup', 'money', 'invest'],
      lifestyle: ['life', 'living', 'daily', 'routine', 'vibe', 'mood'],
      motivation: ['motivation', 'inspire', 'dream', 'goal', 'success', 'mindset'],
      food: ['food', 'eat', 'cook', 'recipe', 'restaurant', 'delicious'],
      travel: ['travel', 'trip', 'vacation', 'explore', 'adventure'],
      humor: ['lol', 'funny', 'joke', 'haha', '😂', '🤣', 'meme'],
    };
    
    const topics: string[] = [];
    for (const [topic, keywords] of Object.entries(topicKeywords)) {
      if (keywords.some(kw => lowerPost.includes(kw))) {
        topics.push(topic);
      }
    }
    
    // Detect media type from context
    const hasImage = lowerPost.includes('view') || lowerPost.includes('image') || lowerPost.includes('photo');
    const hasVideo = lowerPost.includes('video') || lowerPost.includes('watch');
    
    // Detect tone
    const tones = {
      casual: ['lol', 'lmao', 'gonna', 'wanna', 'ya', 'yall'],
      professional: ['therefore', 'however', 'regarding', 'professional'],
      emotional: ['!', '❤️', '💔', 'feel', 'feeling', 'love', 'hate'],
    };
    
    let tone = 'neutral';
    for (const [t, words] of Object.entries(tones)) {
      if (words.some(w => lowerPost.includes(w))) {
        tone = t;
        break;
      }
    }
    
    // Check for inappropriate content (thirst traps, spam, etc.)
    const contentCheck = isInappropriateContent(mainPost);
    
    return {
      mainPost,
      username,
      replies,
      hasImage,
      hasVideo,
      sentiment,
      topics: topics.length > 0 ? topics : ['general'],
      tone,
      isInappropriate: contentCheck.inappropriate,
      skipReason: contentCheck.reason,
    };
  }

  /**
   * Generate an AI-powered comment based on post analysis
   * Based on python/utils/ai_comment_generator.py generate_comment()
   */
  async generateComment(analysis: PostAnalysis): Promise<string> {
    if (this.config.provider === 'local' || !this.config.apiKey) {
      return this.generateLocalComment(analysis);
    }
    
    // Use OpenAI or Anthropic for AI generation
    const prompt = this.buildPrompt(analysis);
    
    if (this.config.provider === 'openai') {
      return this.generateWithOpenAI(prompt);
    } else if (this.config.provider === 'anthropic') {
      return this.generateWithAnthropic(prompt);
    }
    
    // Fallback to local
    return this.generateLocalComment(analysis);
  }

  /**
   * Generate comment from full PostContext (like Python's generate_from_context)
   */
  async generateFromContext(context: PostContext): Promise<GeneratedComment> {
    try {
      const analysis = this.analyzePost({
        mainPost: context.postContent || context.visualSummary || '',
        username: context.username,
        replies: context.existingComments,
      });
      
      // Add engagement info
      if (context.engagement) {
        analysis.engagement = context.engagement;
      }
      
      const text = await this.generateComment(analysis);
      return { text, success: true };
    } catch (error) {
      return { text: '', success: false, error: String(error) };
    }
  }

  /**
   * Build prompt matching python/utils/ai_comment_generator.py
   */
  private buildPrompt(analysis: PostAnalysis): string {
    const { mainPost, username, replies, sentiment, topics, tone, engagement } = analysis;
    const platformVibe = PLATFORM_VIBES.threads;
    const commentsText = replies.length > 0 
      ? replies.slice(0, 5).map(r => r.substring(0, 100)).join('\n')
      : 'No comments yet';
    
    // Prompt structure from Python script
    const prompt = `You are commenting on a Threads post. Generate a SHORT, authentic comment (max ${this.config.maxLength} chars) with 1-2 emojis.

POST BY @${username}:
${mainPost.substring(0, 400)}

${engagement ? `ENGAGEMENT: ${engagement}` : ''}

WHAT OTHERS ARE SAYING:
${commentsText}

ANALYSIS:
- Sentiment: ${sentiment}
- Topics: ${topics.join(', ')}
- Tone: ${tone}

Generate a thoughtful comment that:
- References specific content from the post when possible
- Adds to the conversation naturally (not just "great post!")
- Feels authentic and human
- Uses appropriate emojis for Threads
- Matches the platform vibe: ${platformVibe}
${sentiment === 'question' ? '- Consider answering or engaging with the question' : ''}

Output ONLY the comment text:`;

    return prompt;
  }

  private async generateWithOpenAI(prompt: string): Promise<string> {
    const fallback = { mainPost: '', username: '', replies: [], hasImage: false, hasVideo: false, sentiment: 'neutral' as const, topics: ['general'], tone: 'neutral' };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            {
              role: 'system',
              content: 'You are a social media engagement expert. Generate authentic, contextual comments that sound natural. Never be generic or spammy.',
            },
            { role: 'user', content: prompt },
          ],
          max_tokens: 100,
          temperature: this.config.temperature,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        console.error('OpenAI error, falling back to local');
        return this.generateLocalComment(fallback);
      }

      const data = await response.json() as { choices?: { message?: { content?: string } }[] };
      return data.choices?.[0]?.message?.content?.trim() || this.generateLocalComment(fallback);
    } catch (error) {
      clearTimeout(timeout);
      console.error('OpenAI request failed:', error instanceof Error ? error.message : error);
      return this.generateLocalComment(fallback);
    }
  }

  private async generateWithAnthropic(prompt: string): Promise<string> {
    const fallback = { mainPost: '', username: '', replies: [], hasImage: false, hasVideo: false, sentiment: 'neutral' as const, topics: ['general'], tone: 'neutral' };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.config.model ?? 'claude-3-haiku-20240307',
          max_tokens: 100,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        console.error('Anthropic error, falling back to local');
        return this.generateLocalComment(fallback);
      }

      const data = await response.json() as { content?: { text?: string }[] };
      return data.content?.[0]?.text?.trim() || this.generateLocalComment(fallback);
    } catch (error) {
      clearTimeout(timeout);
      console.error('Anthropic request failed:', error instanceof Error ? error.message : error);
      return this.generateLocalComment(fallback);
    }
  }

  /**
   * Generate comment locally based on analysis (no API needed)
   */
  private generateLocalComment(analysis: PostAnalysis): string {
    const { sentiment, topics, tone } = analysis;
    
    // Topic-specific templates
    const topicTemplates: Record<string, string[]> = {
      tech: [
        "This is exactly the kind of innovation we need 🔥",
        "The tech behind this is impressive! Building something similar?",
        "This changes the game for developers 💻",
        "Would love to see more breakdowns like this ⚡",
      ],
      art: [
        "The creativity here is unmatched ✨",
        "Your artistic vision is incredible 🎨",
        "This is the kind of art that stops you scrolling",
        "The detail in this is amazing 👏",
      ],
      fitness: [
        "This is the motivation I needed today 💪",
        "Consistency really is everything 🏋️",
        "Adding this to my routine immediately",
        "The discipline here is inspiring 🔥",
      ],
      business: [
        "This perspective on growth is spot on 📈",
        "More founders need to hear this 💯",
        "The business insight here is valuable",
        "This is the kind of strategic thinking that wins",
      ],
      motivation: [
        "Needed to hear this today 🙌",
        "This hit different. Saving this one ⭐",
        "The mindset shift this creates is powerful",
        "Printing this and putting it on my wall 📌",
      ],
      humor: [
        "I literally cannot stop laughing at this 😂",
        "Why is this so accurate though 💀",
        "I feel personally called out 😅",
        "This just made my whole day 🤣",
      ],
      lifestyle: [
        "This is the vibe we're all chasing ✨",
        "Living life right! This is goals 🙌",
        "The energy in this is immaculate",
        "This is what it's all about 💯",
      ],
      general: [
        "This really resonates with me ✨",
        "Appreciate you sharing this perspective 🙌",
        "More of this content please! 🔥",
        "This is what my feed needed today 💯",
      ],
    };
    
    // Sentiment-based adjustments
    const sentimentPrefixes: Record<string, string[]> = {
      question: [
        "Great question! ",
        "I think about this too - ",
        "My take: ",
      ],
      positive: [
        "",
        "Yes! ",
        "100%! ",
      ],
      negative: [
        "I feel this. ",
        "Been there. ",
        "This is real. ",
      ],
      neutral: [
        "",
        "Interesting - ",
        "",
      ],
    };
    
    // Select templates based on first topic
    const topic = topics[0] || 'general';
    const templates = topicTemplates[topic] || topicTemplates.general;
    const template = templates[Math.floor(Math.random() * templates.length)];
    
    // Add sentiment prefix sometimes
    const prefixes = sentimentPrefixes[sentiment] || sentimentPrefixes.neutral;
    const prefix = Math.random() > 0.7 ? prefixes[Math.floor(Math.random() * prefixes.length)] : '';
    
    return prefix + template;
  }
}

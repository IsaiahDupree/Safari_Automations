/**
 * Shared AI Utilities
 * 
 * Central AI module for all Safari Automation services.
 * Provides OpenAI integration for comments, DMs, Sora scripts, etc.
 */

import 'dotenv/config';

export interface AIConfig {
  provider: 'openai' | 'anthropic' | 'local';
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

const DEFAULT_CONFIG: AIConfig = {
  provider: 'openai',
  model: 'gpt-4o',
  maxTokens: 150,
  temperature: 0.85,
};

/**
 * Shared AI Client
 * Auto-loads OPENAI_API_KEY from environment
 */
export class AIClient {
  private config: AIConfig;

  constructor(config: Partial<AIConfig> = {}) {
    const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      apiKey,
      provider: apiKey ? 'openai' : 'local',
    };

    if (apiKey) {
      console.log('[AI] ✅ OpenAI API key loaded');
    } else {
      console.log('[AI] ⚠️ No API key - AI features limited');
    }
  }

  /**
   * Generate a comment for social media
   */
  async generateComment(context: {
    platform: 'instagram' | 'threads' | 'tiktok' | 'twitter';
    postContent: string;
    authorUsername: string;
    existingComments?: string[];
    keyword?: string;
  }): Promise<string> {
    const platformVibes: Record<string, string> = {
      instagram: 'supportive and engaging',
      threads: 'conversational and thoughtful',
      tiktok: 'casual and fun with trending phrases',
      twitter: 'witty and concise',
    };

    const prompt = `Generate a SHORT, authentic comment (max 100 chars) for this ${context.platform} post.

POST BY @${context.authorUsername}:
${context.postContent.substring(0, 300)}

${context.keyword ? `KEYWORD CONTEXT: ${context.keyword}` : ''}

${context.existingComments?.length ? `EXISTING COMMENTS:\n${context.existingComments.slice(0, 3).join('\n')}` : ''}

PLATFORM VIBE: ${platformVibes[context.platform]}

Generate a comment that:
- References specific content from the post
- Adds to the conversation naturally
- Uses 1-2 appropriate emojis
- Sounds human and authentic

Output ONLY the comment text:`;

    return this.generate(prompt);
  }

  /**
   * Generate a DM message
   */
  async generateDM(context: {
    platform: 'instagram' | 'tiktok' | 'twitter';
    recipientUsername: string;
    recipientBio?: string;
    purpose: 'outreach' | 'reply' | 'followup';
    previousMessages?: string[];
    topic?: string;
  }): Promise<string> {
    const prompt = `Generate a SHORT, personalized DM (max 150 chars) for ${context.platform}.

TO: @${context.recipientUsername}
${context.recipientBio ? `BIO: ${context.recipientBio}` : ''}
PURPOSE: ${context.purpose}
${context.topic ? `TOPIC: ${context.topic}` : ''}

${context.previousMessages?.length ? `CONVERSATION:\n${context.previousMessages.slice(-3).join('\n')}` : ''}

Generate a message that:
- Feels personal and authentic
- References their content or bio if available
- Has a clear purpose without being salesy
- Sounds natural, not robotic

Output ONLY the message text:`;

    return this.generate(prompt);
  }

  /**
   * Generate Sora video prompts
   */
  async generateSoraPrompt(context: {
    character: string;
    theme: string;
    style?: string;
    previousPrompts?: string[];
  }): Promise<string> {
    const prompt = `Generate a cinematic Sora video prompt featuring ${context.character}.

THEME: ${context.theme}
${context.style ? `STYLE: ${context.style}` : 'STYLE: Cinematic, dramatic, high quality'}

${context.previousPrompts?.length ? `PREVIOUS PROMPTS (avoid repeating):\n${context.previousPrompts.slice(-2).join('\n')}` : ''}

Generate a detailed, visual prompt that:
- Features ${context.character} as the main character
- Is highly cinematic and visually stunning
- Describes specific actions, lighting, and atmosphere
- Is suitable for AI video generation
- Is 2-3 sentences max

Output ONLY the prompt text:`;

    return this.generate(prompt);
  }

  /**
   * Generate trilogy of connected Sora prompts
   */
  async generateSoraTrilogy(context: {
    character: string;
    theme: string;
    style?: string;
  }): Promise<{ chapter1: string; chapter2: string; chapter3: string }> {
    const prompt = `Generate a 3-part video trilogy featuring ${context.character}.

THEME: ${context.theme}
${context.style ? `STYLE: ${context.style}` : 'STYLE: Cinematic, dramatic'}

Create 3 connected prompts that tell a story:
- Chapter 1: Setup/Introduction
- Chapter 2: Rising action/Climax
- Chapter 3: Resolution/Epic finale

Each prompt should be 2-3 sentences, highly visual, and feature ${context.character}.

Output in this exact format:
CHAPTER 1: [prompt]
CHAPTER 2: [prompt]
CHAPTER 3: [prompt]`;

    const result = await this.generate(prompt);
    
    // Parse the trilogy
    const lines = result.split('\n').filter(l => l.trim());
    const chapter1 = lines.find(l => l.includes('CHAPTER 1'))?.replace('CHAPTER 1:', '').trim() || '';
    const chapter2 = lines.find(l => l.includes('CHAPTER 2'))?.replace('CHAPTER 2:', '').trim() || '';
    const chapter3 = lines.find(l => l.includes('CHAPTER 3'))?.replace('CHAPTER 3:', '').trim() || '';

    return { chapter1, chapter2, chapter3 };
  }

  /**
   * Analyze content for sentiment and topics
   */
  async analyzeContent(content: string): Promise<{
    sentiment: 'positive' | 'negative' | 'neutral' | 'question';
    topics: string[];
    isAppropriate: boolean;
    summary: string;
  }> {
    const prompt = `Analyze this social media content:

"${content.substring(0, 500)}"

Provide analysis in this exact JSON format:
{
  "sentiment": "positive|negative|neutral|question",
  "topics": ["topic1", "topic2"],
  "isAppropriate": true|false,
  "summary": "One sentence summary"
}`;

    const result = await this.generate(prompt);
    
    try {
      return JSON.parse(result);
    } catch {
      return {
        sentiment: 'neutral',
        topics: ['general'],
        isAppropriate: true,
        summary: content.substring(0, 50),
      };
    }
  }

  /**
   * Core generation method
   */
  private async generate(prompt: string): Promise<string> {
    if (!this.config.apiKey) {
      return this.generateLocal(prompt);
    }

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
              content: 'You are a social media expert. Generate authentic, engaging content. Be concise and specific.',
            },
            { role: 'user', content: prompt },
          ],
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
        }),
      });

      if (!response.ok) {
        console.error('[AI] OpenAI error, falling back to local');
        return this.generateLocal(prompt);
      }

      const data = await response.json() as { choices?: { message?: { content?: string } }[] };
      return data.choices?.[0]?.message?.content?.trim() || this.generateLocal(prompt);
    } catch (error) {
      console.error('[AI] Error:', error);
      return this.generateLocal(prompt);
    }
  }

  /**
   * Local fallback generation
   */
  private generateLocal(prompt: string): string {
    const templates = [
      "This is exactly what I needed to see today! 🔥",
      "Love the energy here! Keep it up 💯",
      "This really resonates with me ✨",
      "Appreciate you sharing this perspective 🙌",
      "More of this content please! 👏",
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  /**
   * Check if AI is available
   */
  isAIEnabled(): boolean {
    return !!this.config.apiKey;
  }
}

// Singleton instance
let aiClient: AIClient | null = null;

export function getAIClient(): AIClient {
  if (!aiClient) {
    aiClient = new AIClient();
  }
  return aiClient;
}

// Export convenience functions
export async function generateComment(context: Parameters<AIClient['generateComment']>[0]): Promise<string> {
  return getAIClient().generateComment(context);
}

export async function generateDM(context: Parameters<AIClient['generateDM']>[0]): Promise<string> {
  return getAIClient().generateDM(context);
}

export async function generateSoraPrompt(context: Parameters<AIClient['generateSoraPrompt']>[0]): Promise<string> {
  return getAIClient().generateSoraPrompt(context);
}

export async function generateSoraTrilogy(context: Parameters<AIClient['generateSoraTrilogy']>[0]): Promise<ReturnType<AIClient['generateSoraTrilogy']>> {
  return getAIClient().generateSoraTrilogy(context);
}

export async function analyzeContent(content: string): Promise<ReturnType<AIClient['analyzeContent']>> {
  return getAIClient().analyzeContent(content);
}

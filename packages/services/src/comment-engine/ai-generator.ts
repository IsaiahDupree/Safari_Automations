/**
 * AI Comment Generator
 * 
 * Generates contextual, engaging comments using AI.
 * Integrates with OpenAI or other LLM providers.
 */

import type { CommentGenerationContext, CommentStyle } from './types';

export interface AIGeneratorConfig {
  provider: 'openai' | 'anthropic' | 'local';
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

const STYLE_PROMPTS: Record<CommentStyle, string> = {
  engaging: 'Ask a thoughtful question or start a conversation related to the content.',
  supportive: 'Write an encouraging, positive comment that shows genuine appreciation.',
  insightful: 'Add value by sharing a relevant perspective or insight.',
  humorous: 'Write a light, witty comment (keep it tasteful and relevant).',
  curious: 'Express genuine curiosity about something specific in the content.',
  relatable: 'Share a brief, relatable experience or agree with the sentiment.',
};

const PLATFORM_GUIDELINES: Record<string, string> = {
  twitter: 'Keep it concise (under 280 chars). Twitter users appreciate wit and brevity.',
  tiktok: 'Be casual and use popular phrases. Emojis are common. Reference the video content.',
  instagram: 'Be warm and personal. Emojis are welcome. Compliments on visuals work well.',
  threads: 'Similar to Twitter but slightly more conversational. Good for adding thoughts.',
};

export class AICommentGenerator {
  private config: AIGeneratorConfig;

  constructor(config: AIGeneratorConfig) {
    this.config = {
      provider: config.provider,
      apiKey: config.apiKey,
      model: config.model ?? 'gpt-4o-mini',
      maxTokens: config.maxTokens ?? 100,
      temperature: config.temperature ?? 0.8,
    };
  }

  /**
   * Generate a comment for a post
   */
  async generate(context: CommentGenerationContext): Promise<string> {
    const prompt = this.buildPrompt(context);

    switch (this.config.provider) {
      case 'openai':
        return this.generateWithOpenAI(prompt);
      case 'anthropic':
        return this.generateWithAnthropic(prompt);
      case 'local':
        return this.generateLocal(context);
      default:
        throw new Error(`Unknown provider: ${this.config.provider}`);
    }
  }

  /**
   * Build the prompt for comment generation
   */
  private buildPrompt(context: CommentGenerationContext): string {
    const { target, style, maxLength, tone, accountPersona } = context;
    
    let prompt = `Generate a ${style} comment for this ${target.platform} post.\n\n`;
    
    // Add platform guidelines
    prompt += `Platform: ${target.platform}\n`;
    prompt += `Guidelines: ${PLATFORM_GUIDELINES[target.platform] ?? ''}\n\n`;
    
    // Add post context
    prompt += `Post by @${target.authorUsername}:\n`;
    if (target.caption) {
      prompt += `Caption: "${target.caption.substring(0, 500)}"\n`;
    }
    if (target.hashtags?.length) {
      prompt += `Hashtags: ${target.hashtags.join(' ')}\n`;
    }
    if (target.mediaType) {
      prompt += `Media type: ${target.mediaType}\n`;
    }
    
    prompt += '\n';
    
    // Add style instruction
    prompt += `Style instruction: ${STYLE_PROMPTS[style]}\n`;
    
    // Add persona if provided
    if (accountPersona) {
      prompt += `\nWrite as ${accountPersona.name}, a ${accountPersona.niche} account with a ${accountPersona.voice} voice.\n`;
    }
    
    // Add constraints
    prompt += `\nConstraints:\n`;
    prompt += `- Maximum ${maxLength} characters\n`;
    prompt += `- Tone: ${tone ?? 'friendly'}\n`;
    prompt += `- ${context.includeEmoji ? 'Include 1-2 relevant emojis' : 'No emojis'}\n`;
    prompt += `- Do NOT use generic phrases like "Great post!" or "Love this!"\n`;
    prompt += `- Be specific to the content\n`;
    prompt += `- Sound natural and human\n`;
    
    // Avoid previous comments
    if (context.previousComments?.length) {
      prompt += `\nDo NOT write anything similar to these previous comments:\n`;
      for (const prev of context.previousComments.slice(-5)) {
        prompt += `- "${prev}"\n`;
      }
    }
    
    // Avoid phrases
    if (context.avoidPhrases?.length) {
      prompt += `\nAvoid these phrases: ${context.avoidPhrases.join(', ')}\n`;
    }
    
    prompt += `\nWrite only the comment text, nothing else:`;
    
    return prompt;
  }

  /**
   * Generate using OpenAI API
   */
  private async generateWithOpenAI(prompt: string): Promise<string> {
    if (!this.config.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

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
              content: 'You are a social media engagement expert. Generate authentic, engaging comments that sound natural and human. Never be generic or spammy.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI API error: ${error}`);
      }

      const data = await response.json() as { choices?: { message?: { content?: string } }[] };
      const comment = data.choices?.[0]?.message?.content?.trim();
      
      if (!comment) {
        throw new Error('No comment generated from OpenAI');
      }

      return comment;
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }

  /**
   * Generate using Anthropic API
   */
  private async generateWithAnthropic(prompt: string): Promise<string> {
    if (!this.config.apiKey) {
      throw new Error('Anthropic API key not configured');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.config.model ?? 'claude-3-haiku-20240307',
          max_tokens: this.config.maxTokens,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Anthropic API error: ${error}`);
      }

      const data = await response.json() as { content?: { text?: string }[] };
      const comment = data.content?.[0]?.text?.trim();
      
      if (!comment) {
        throw new Error('No comment generated from Anthropic');
      }

      return comment;
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }

  /**
   * Generate locally (fallback/testing)
   */
  private generateLocal(context: CommentGenerationContext): string {
    const templates: Record<CommentStyle, string[]> = {
      engaging: [
        'What inspired this? Would love to know more! 🙌',
        'This is interesting - have you tried {variation}?',
        'Curious what your thoughts are on {topic}?',
      ],
      supportive: [
        'This is exactly what I needed to see today ✨',
        'Keep creating content like this! 🔥',
        'Your perspective on this is refreshing 💯',
      ],
      insightful: [
        'Great point - I\'d also add that {insight}',
        'This connects well with {related_topic}',
        'Interesting take - worth considering {angle}',
      ],
      humorous: [
        'My brain after seeing this: 🤯',
        'Why is this so accurate though 😂',
        'I feel personally called out by this lol',
      ],
      curious: [
        'How did you come up with this approach?',
        'Would love to hear more about your process here',
        'What made you decide to go this direction?',
      ],
      relatable: [
        'This resonates so much with me',
        'Literally same experience here',
        'Finally someone said it 🙌',
      ],
    };

    const styleTemplates = templates[context.style] ?? templates.engaging;
    const template = styleTemplates[Math.floor(Math.random() * styleTemplates.length)];
    
    return template;
  }

  /**
   * Validate a generated comment
   */
  validateComment(comment: string, maxLength: number): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    if (comment.length > maxLength) {
      issues.push(`Comment exceeds max length (${comment.length}/${maxLength})`);
    }

    if (comment.length < 10) {
      issues.push('Comment is too short');
    }

    // Check for spam patterns
    const spamPatterns = [
      /follow me/i,
      /check my profile/i,
      /link in bio/i,
      /dm me/i,
      /nice pic/i,
      /great post/i,
      /love this/i,
    ];

    for (const pattern of spamPatterns) {
      if (pattern.test(comment)) {
        issues.push(`Contains spam pattern: ${pattern.source}`);
      }
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }
}

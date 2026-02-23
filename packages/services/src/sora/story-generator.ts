/**
 * Universal Sora Story Generator
 * Prompt-agnostic system for generating any type of video story
 */

import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';

export interface VideoPrompt {
  part: number;
  title: string;
  stage?: string;
  prompt: string;
}

export interface Character {
  name: string;
  description: string;
}

export interface StoryConfig {
  id?: number;
  title: string;
  theme: string;
  format: 'trilogy' | '6-part' | 'custom';
  totalParts: number;
  character: string;
  secondaryCharacter?: Character;
  storyStructure?: string;
  videos: VideoPrompt[];
}

export interface GenerationConfig {
  outputDir: string;
  startFromMovie?: number;
  startFromPart?: number;
  waitBetweenParts?: number;
  waitBetweenMovies?: number;
}

export interface StoryTemplate {
  name: string;
  description: string;
  format: 'trilogy' | '6-part' | 'custom';
  stages: { title: string; stage: string; guidance: string }[];
}

export const STORY_TEMPLATES: Record<string, StoryTemplate> = {
  'heros-journey': {
    name: "Hero's Journey",
    description: "Campbell's monomyth - transformation through adventure",
    format: '6-part',
    stages: [
      { title: 'The Call', stage: 'Ordinary World + Call to Adventure', guidance: 'Show the hero in their normal life, then receiving a call to action' },
      { title: 'The Threshold', stage: 'Crossing Threshold + Meeting Mentor', guidance: 'Hero commits to the journey, encounters a guide or wisdom' },
      { title: 'The Trials', stage: 'Tests, Allies, Enemies', guidance: 'Hero faces challenges, makes friends and foes' },
      { title: 'The Ordeal', stage: 'Approach to Cave + The Ordeal', guidance: 'Hero confronts their greatest fear, experiences symbolic death' },
      { title: 'The Reward', stage: 'Reward + Road Back', guidance: 'Hero gains the prize, begins return journey' },
      { title: 'The Return', stage: 'Resurrection + Return with Elixir', guidance: 'Final battle, hero returns transformed' }
    ]
  },
  'love-story': {
    name: 'Love Story',
    description: 'Romantic journey with emotional depth',
    format: 'trilogy',
    stages: [
      { title: 'The Meeting', stage: 'First Encounter', guidance: 'Two people meet, initial spark or tension' },
      { title: 'The Challenge', stage: 'Obstacles & Growth', guidance: 'Relationship faces challenges, characters grow' },
      { title: 'The Union', stage: 'Resolution', guidance: 'Love conquers, characters choose each other' }
    ]
  },
  'action-trilogy': {
    name: 'Action Trilogy',
    description: 'High-octane action sequence',
    format: 'trilogy',
    stages: [
      { title: 'The Setup', stage: 'Introduction', guidance: 'Establish the hero, the stakes, the mission' },
      { title: 'The Escalation', stage: 'Rising Action', guidance: 'Action intensifies, obstacles multiply' },
      { title: 'The Climax', stage: 'Resolution', guidance: 'Ultimate confrontation, victory achieved' }
    ]
  },
  'transformation': {
    name: 'Transformation Arc',
    description: 'Character undergoes profound change',
    format: 'trilogy',
    stages: [
      { title: 'Before', stage: 'The Old Self', guidance: 'Show the character before their transformation' },
      { title: 'The Crucible', stage: 'The Change', guidance: 'The event or process that transforms them' },
      { title: 'After', stage: 'The New Self', guidance: 'The transformed character in their new reality' }
    ]
  },
  'epic-saga': {
    name: 'Epic Saga',
    description: 'Grand scale adventure',
    format: '6-part',
    stages: [
      { title: 'The Beginning', stage: 'Origins', guidance: 'Establish the world and the hero' },
      { title: 'The Journey', stage: 'Departure', guidance: 'Hero sets out on their quest' },
      { title: 'The Allies', stage: 'Fellowship', guidance: 'Gathering companions, facing early trials' },
      { title: 'The Darkness', stage: 'Descent', guidance: 'Facing the darkest moment, all seems lost' },
      { title: 'The Rising', stage: 'Ascent', guidance: 'Finding new strength, turning the tide' },
      { title: 'The Victory', stage: 'Triumph', guidance: 'Final battle, achieving the goal' }
    ]
  }
};

export class SoraStoryGenerator {
  private openai: OpenAI | null = null;

  constructor() {
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
  }

  /**
   * Generate prompts from a theme using AI
   */
  async generatePromptsFromTheme(config: {
    theme: string;
    character: string;
    secondaryCharacter?: Character;
    template: string;
    style?: string;
    additionalContext?: string;
  }): Promise<VideoPrompt[]> {
    if (!this.openai) {
      throw new Error('OpenAI API key required for AI prompt generation. Set OPENAI_API_KEY.');
    }

    const template = STORY_TEMPLATES[config.template];
    if (!template) {
      throw new Error(`Unknown template: ${config.template}. Available: ${Object.keys(STORY_TEMPLATES).join(', ')}`);
    }

    const systemPrompt = `You are a cinematic video prompt writer for Sora AI video generation. 
Create vivid, visual prompts that describe scenes in detail. Each prompt should:
- Be 2-4 sentences, highly visual and cinematic
- Include the main character by name: ${config.character}
${config.secondaryCharacter ? `- Include consistent secondary character: ${config.secondaryCharacter.name} - ${config.secondaryCharacter.description}` : ''}
- Describe actions, lighting, atmosphere, camera angles
- Show emotion through visual details, not just words
${config.style ? `- Style: ${config.style}` : ''}
${config.additionalContext ? `- Additional context: ${config.additionalContext}` : ''}

Output ONLY a JSON array of objects with: part (number), title (string), stage (string), prompt (string)`;

    const userPrompt = `Create ${template.stages.length} video prompts for a "${config.theme}" story using the "${template.name}" structure.

Stages:
${template.stages.map((s, i) => `${i + 1}. ${s.title} (${s.stage}): ${s.guidance}`).join('\n')}

Make the prompts cinematic, emotional, and visually striking. Each prompt should be a complete scene.`;

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.8,
    }, {
      timeout: 30000, // 30s timeout to prevent indefinite blocking
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('No response from OpenAI');

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(`OpenAI returned invalid JSON: ${content.substring(0, 200)}`);
    }
    return parsed.prompts || parsed.videos || parsed;
  }

  /**
   * Generate multiple stories from a batch of themes
   */
  async generateBatchStories(config: {
    themes: { title: string; theme: string; secondaryCharacter?: Character }[];
    character: string;
    template: string;
    style?: string;
  }): Promise<StoryConfig[]> {
    const stories: StoryConfig[] = [];
    const template = STORY_TEMPLATES[config.template];

    for (let i = 0; i < config.themes.length; i++) {
      const t = config.themes[i];
      console.log(`\n🎬 Generating prompts for: ${t.title}...`);
      
      const videos = await this.generatePromptsFromTheme({
        theme: t.theme,
        character: config.character,
        secondaryCharacter: t.secondaryCharacter,
        template: config.template,
        style: config.style
      });

      stories.push({
        id: i + 1,
        title: t.title,
        theme: t.theme,
        format: template.format,
        totalParts: template.stages.length,
        character: config.character,
        secondaryCharacter: t.secondaryCharacter,
        storyStructure: config.template,
        videos
      });
    }

    return stories;
  }

  /**
   * Run video generation for stories
   */
  async runGeneration(stories: StoryConfig[], config: GenerationConfig): Promise<{
    completed: number;
    failed: number;
    results: { story: string; part: number; success: boolean; path?: string; error?: string }[];
  }> {
    const { SoraFullAutomation } = await import('./sora-full-automation');
    
    const results: { story: string; part: number; success: boolean; path?: string; error?: string }[] = [];
    let completed = 0;
    let failed = 0;

    const startMovie = config.startFromMovie || 1;
    const startPart = config.startFromPart || 1;
    const waitParts = config.waitBetweenParts || 15000;
    const waitMovies = config.waitBetweenMovies || 30000;

    for (const story of stories) {
      if ((story.id || 0) < startMovie) continue;

      const storyDir = path.join(config.outputDir, story.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
      if (!fs.existsSync(storyDir)) {
        fs.mkdirSync(storyDir, { recursive: true });
      }

      console.log(`\n${'═'.repeat(70)}`);
      console.log(`🎬 ${story.title}`);
      console.log(`   Theme: ${story.theme}`);
      console.log('═'.repeat(70));

      const sora = new SoraFullAutomation();
      for (const video of story.videos) {
        if ((story.id || 0) === startMovie && video.part < startPart) continue;

        console.log(`\n📽️  Part ${video.part}: ${video.title}`);
        console.log(`   Stage: ${video.stage || 'N/A'}`);
        console.log(`   Prompt: ${video.prompt.slice(0, 80)}...`);

        try {
          const result = await sora.fullRun(video.prompt);

          if (result.download?.success && result.download.filePath) {
            const destPath = path.join(storyDir, `part-${video.part}-${video.title.toLowerCase().replace(/\s+/g, '-')}.mp4`);
            fs.copyFileSync(result.download.filePath, destPath);
            console.log(`   ✅ Generated: ${destPath}`);
            results.push({ story: story.title, part: video.part, success: true, path: destPath });
            completed++;
          } else {
            const error = result.download?.error || result.poll?.error || 'Unknown error';
            console.log(`   ❌ Failed: ${error}`);
            results.push({ story: story.title, part: video.part, success: false, error });
            failed++;
          }
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : 'Unknown error';
          console.log(`   ❌ Error: ${errMsg}`);
          results.push({ story: story.title, part: video.part, success: false, error: errMsg });
          failed++;
        }

        if (video.part < story.totalParts) {
          await new Promise(r => setTimeout(r, waitParts));
        }
      }

      if ((story.id || 0) < stories.length) {
        await new Promise(r => setTimeout(r, waitMovies));
      }
    }

    return { completed, failed, results };
  }

  /**
   * Save story config to JSON file
   */
  saveStoryConfig(stories: StoryConfig[], outputPath: string, metadata?: Record<string, unknown>): void {
    const data = {
      generatedAt: new Date().toISOString(),
      ...metadata,
      totalMovies: stories.length,
      totalVideos: stories.reduce((sum, s) => sum + s.videos.length, 0),
      stories
    };
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
    console.log(`\n📁 Saved config: ${outputPath}`);
  }

  /**
   * Load story config from JSON file
   */
  loadStoryConfig(inputPath: string): StoryConfig[] {
    const data = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
    return data.stories || data.movies || data.trilogies || [];
  }

  /**
   * List available templates
   */
  listTemplates(): void {
    console.log('\n📚 Available Story Templates:\n');
    for (const [key, template] of Object.entries(STORY_TEMPLATES)) {
      console.log(`  ${key}`);
      console.log(`    Name: ${template.name}`);
      console.log(`    Format: ${template.format} (${template.stages.length} parts)`);
      console.log(`    Description: ${template.description}`);
      console.log(`    Stages: ${template.stages.map(s => s.title).join(' → ')}`);
      console.log();
    }
  }
}

export default SoraStoryGenerator;

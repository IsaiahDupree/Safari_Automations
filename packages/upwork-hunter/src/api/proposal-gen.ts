import { getAnthropicClient, isAnthropicConfigured } from '../lib/anthropic.js';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase.js';
import type { UpworkJob, UpworkProposal, OfferType } from '../types/index.js';

const SYSTEM_PROMPT = `You are Isaiah Dupree, an AI automation consultant helping software founders ($500K-$5M ARR) build custom AI workflows. Your offers:
- AI Automation Audit+Build ($2,500): 2-week engagement, deliver N8n/custom automation
- Social Growth System ($500/mo): automated prospect discovery + DM outreach using Safari automation

Write a compelling Upwork proposal that:
1. Opens with a specific insight about their problem (not "I saw your post...")
2. Shows relevant experience (Instagram automation, CRM sync, Claude API integration)
3. Proposes a concrete solution with 3 bullet points
4. Ends with a specific question about their timeline/stack
Keep it under 300 words. No fluff. No "I'm perfect for this" phrases.`;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).length;
}

export async function generateProposal(job: UpworkJob, offerType: OfferType = 'audit_build'): Promise<string> {
  if (!isAnthropicConfigured()) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }

  const client = getAnthropicClient();
  const offerLabel = offerType === 'audit_build'
    ? 'AI Automation Audit+Build ($2,500)'
    : 'Social Growth System ($500/mo)';

  const userMessage = `Job title: ${job.title}\nJob description: ${job.description}\nBudget: ${job.budget || 'Not specified'}\nRelevant offer: ${offerLabel}`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { type: 'text'; text: string }).text)
    .join('');

  const words = wordCount(text);
  console.log(`[proposal-gen] Generated proposal for "${job.title}" (${words} words)`);

  return text;
}

export async function generateAndStoreProposal(
  job: UpworkJob,
  offerType: OfferType = 'audit_build'
): Promise<UpworkProposal> {
  const proposalText = await generateProposal(job, offerType);

  const proposal: UpworkProposal = {
    job_id: job.job_id,
    job_title: job.title,
    job_url: job.url,
    job_description: job.description,
    budget: job.budget,
    score: job.score,
    proposal_text: proposalText,
    status: 'pending',
    offer_type: offerType,
  };

  if (isSupabaseConfigured()) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('upwork_proposals')
      .upsert(
        {
          ...proposal,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'job_id' }
      )
      .select()
      .single();

    if (error) {
      console.error('[proposal-gen] Failed to store proposal:', error.message);
    } else if (data) {
      console.log(`[proposal-gen] Stored proposal for job_id=${job.job_id}`);
      return data as UpworkProposal;
    }
  }

  return proposal;
}

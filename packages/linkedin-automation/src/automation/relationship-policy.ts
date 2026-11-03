import type { ConnectionStatus } from './types.js';

/** A messaging affordance is not evidence of an accepted connection. */
export interface RelationshipEvidence {
  requestedProfileUrl: string;
  currentProfileUrl?: string;
  canonicalProfileUrl?: string;
  degreeText?: string;
  pending?: boolean;
  following?: boolean;
  canMessage?: boolean;
  canConnect?: boolean;
}

export function canonicalLinkedInProfileUrl(input: string): string | null {
  try {
    const value = /^[\w%.-]+\/?$/.test(input)
      ? `https://www.linkedin.com/in/${input}` : input;
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !['linkedin.com', 'www.linkedin.com'].includes(url.hostname)) return null;
    const match = url.pathname.match(/^\/in\/([^/]+)\/?$/);
    if (!match) return null;
    const slug = decodeURIComponent(match[1]).toLowerCase();
    if (!slug || /[/\\?#\s]/.test(slug)) return null;
    return `https://www.linkedin.com/in/${encodeURIComponent(slug)}/`;
  } catch {
    return null;
  }
}

export function classifyRelationship(evidence: RelationshipEvidence): ConnectionStatus {
  const result: ConnectionStatus = {
    profileUrl: evidence.requestedProfileUrl,
    status: 'not_connected', canMessage: false, canConnect: false,
  };
  const requested = canonicalLinkedInProfileUrl(evidence.requestedProfileUrl);
  if (!requested || canonicalLinkedInProfileUrl(evidence.currentProfileUrl || '') !== requested
    || canonicalLinkedInProfileUrl(evidence.canonicalProfileUrl || '') !== requested) return result;

  result.canMessage = evidence.canMessage === true;
  result.canConnect = evidence.canConnect === true;
  const degree = evidence.degreeText?.trim().match(/^(?:[•·]\s*)?(1st|2nd|3rd)(?:\+)?(?:\s+degree connection)?(?:\s*[•·])?$/i)?.[1]?.toLowerCase();
  if (evidence.pending === true) result.status = 'pending_sent';
  else if (degree === '1st' && !result.canConnect) result.status = 'connected';
  else if (evidence.following === true) result.status = 'following';
  return result;
}

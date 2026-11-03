import { describe, expect, it } from 'vitest';
import { canonicalLinkedInProfileUrl, classifyRelationship } from '../../packages/linkedin-automation/src/automation/relationship-policy.js';

const profile = 'https://www.linkedin.com/in/profile-under-review/';
const evidence = { requestedProfileUrl: profile, currentProfileUrl: profile, canonicalProfileUrl: profile };

describe('LinkedIn accepted-connection evidence', () => {
  it.each(['2nd', '3rd', '', undefined])('does not accept a Message button with degree %s', degreeText => {
    expect(classifyRelationship({ ...evidence, degreeText, canMessage: true }).status).toBe('not_connected');
  });

  it('requires an explicit first degree and gives Pending precedence over Message', () => {
    expect(classifyRelationship({ ...evidence, degreeText: '1st', canMessage: true }).status).toBe('connected');
    expect(classifyRelationship({ ...evidence, degreeText: '1st', canMessage: true, pending: true }).status).toBe('pending_sent');
    expect(classifyRelationship({ ...evidence, degreeText: '1st', canConnect: true }).status).toBe('not_connected');
  });

  it.each([
    { currentProfileUrl: 'https://www.linkedin.com/login/' },
    { currentProfileUrl: 'https://www.linkedin.com/in/someone-else/' },
    { canonicalProfileUrl: 'https://www.linkedin.com/in/someone-else/' },
    { canonicalProfileUrl: '' },
  ])('fails closed on redirects, stale profile metadata and missing canonical evidence: %j', override => {
    expect(classifyRelationship({ ...evidence, ...override, degreeText: '1st', canMessage: true }))
      .toMatchObject({ status: 'not_connected', canMessage: false });
  });

  it('does not interpret a headline mentioning first class as connection degree', () => {
    expect(classifyRelationship({ ...evidence, degreeText: '1st class aerospace engineer' }).status).toBe('not_connected');
  });

  it('normalizes a tracked profile URL while rejecting foreign origins and encoded paths', () => {
    expect(canonicalLinkedInProfileUrl('https://linkedin.com/in/Profile-Under-Review?trk=search')).toBe(profile);
    expect(canonicalLinkedInProfileUrl('https://linkedin.com.evil.test/in/profile-under-review/')).toBeNull();
    expect(canonicalLinkedInProfileUrl('https://www.linkedin.com/in/one%2Ftwo/')).toBeNull();
    expect(canonicalLinkedInProfileUrl('http://www.linkedin.com/in/profile-under-review/')).toBeNull();
  });
});

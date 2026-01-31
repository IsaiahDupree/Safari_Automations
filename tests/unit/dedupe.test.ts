import { describe, it, expect } from 'vitest';

interface ActionRecord {
  accountId: string;
  platform: string;
  postId: string;
  actionType: string;
  timestamp: Date;
}

function generateDedupeKey(record: ActionRecord): string {
  return `${record.accountId}:${record.platform}:${record.postId}:${record.actionType}`;
}

function isDuplicate(
  newAction: ActionRecord,
  existingActions: ActionRecord[]
): boolean {
  const newKey = generateDedupeKey(newAction);
  return existingActions.some((action) => generateDedupeKey(action) === newKey);
}

describe('Deduplication Logic', () => {
  describe('generateDedupeKey', () => {
    it('should generate consistent keys', () => {
      const record: ActionRecord = {
        accountId: 'acc-123',
        platform: 'instagram',
        postId: 'post-456',
        actionType: 'like',
        timestamp: new Date(),
      };

      const key1 = generateDedupeKey(record);
      const key2 = generateDedupeKey(record);

      expect(key1).toBe(key2);
      expect(key1).toBe('acc-123:instagram:post-456:like');
    });

    it('should generate different keys for different actions', () => {
      const like: ActionRecord = {
        accountId: 'acc-123',
        platform: 'instagram',
        postId: 'post-456',
        actionType: 'like',
        timestamp: new Date(),
      };

      const comment: ActionRecord = {
        ...like,
        actionType: 'comment',
      };

      expect(generateDedupeKey(like)).not.toBe(generateDedupeKey(comment));
    });

    it('should generate different keys for different posts', () => {
      const post1: ActionRecord = {
        accountId: 'acc-123',
        platform: 'instagram',
        postId: 'post-456',
        actionType: 'like',
        timestamp: new Date(),
      };

      const post2: ActionRecord = {
        ...post1,
        postId: 'post-789',
      };

      expect(generateDedupeKey(post1)).not.toBe(generateDedupeKey(post2));
    });
  });

  describe('isDuplicate', () => {
    it('should detect duplicate actions', () => {
      const existing: ActionRecord[] = [
        {
          accountId: 'acc-123',
          platform: 'instagram',
          postId: 'post-456',
          actionType: 'like',
          timestamp: new Date('2024-01-01'),
        },
      ];

      const newAction: ActionRecord = {
        accountId: 'acc-123',
        platform: 'instagram',
        postId: 'post-456',
        actionType: 'like',
        timestamp: new Date('2024-01-02'),
      };

      expect(isDuplicate(newAction, existing)).toBe(true);
    });

    it('should allow same action on different posts', () => {
      const existing: ActionRecord[] = [
        {
          accountId: 'acc-123',
          platform: 'instagram',
          postId: 'post-456',
          actionType: 'like',
          timestamp: new Date(),
        },
      ];

      const newAction: ActionRecord = {
        accountId: 'acc-123',
        platform: 'instagram',
        postId: 'post-789',
        actionType: 'like',
        timestamp: new Date(),
      };

      expect(isDuplicate(newAction, existing)).toBe(false);
    });

    it('should allow different action types on same post', () => {
      const existing: ActionRecord[] = [
        {
          accountId: 'acc-123',
          platform: 'instagram',
          postId: 'post-456',
          actionType: 'like',
          timestamp: new Date(),
        },
      ];

      const newAction: ActionRecord = {
        accountId: 'acc-123',
        platform: 'instagram',
        postId: 'post-456',
        actionType: 'comment',
        timestamp: new Date(),
      };

      expect(isDuplicate(newAction, existing)).toBe(false);
    });
  });
});

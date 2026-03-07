/**
 * Instagram Follower Extraction Operations
 * PAP-002: Extract followers from a creator's profile
 */

import { execSafari } from './safari-driver.js';

export interface FollowerProfile {
  handle: string;
  displayName: string;
  bio?: string;
  followerCount?: number;
  followingCount?: number;
  isVerified?: boolean;
  profilePicUrl?: string;
}

export interface ExtractFollowersResult {
  success: boolean;
  followers: FollowerProfile[];
  count: number;
  error?: string;
  handle?: string;
}

/**
 * Extract followers from a user's profile
 */
export async function extractFollowers(
  handle: string,
  limit: number = 200
): Promise<ExtractFollowersResult> {
  try {
    // Navigate to profile
    const profileUrl = `https://www.instagram.com/${handle}/`;

    const navResult = await execSafari(
      `
      tell application "Safari"
        tell front window
          set current tab's URL to "${profileUrl}"
          delay 3
          return URL of current tab
        end tell
      end tell
      `,
      30000
    );

    if (!navResult.includes('instagram.com')) {
      return {
        success: false,
        followers: [],
        count: 0,
        error: 'Failed to navigate to profile',
      };
    }

    // Wait for page load and click followers link
    const clickResult = await execSafari(
      `
      tell application "Safari"
        tell front window
          -- Wait for profile page to load
          delay 2

          -- Click followers link (using AppleScript to find and click)
          do JavaScript "
            (function() {
              // Find followers link by href pattern
              const followersLink = document.querySelector('a[href*=\\"/followers/\\"]');
              if (followersLink) {
                followersLink.click();
                return 'clicked';
              }
              return 'not_found';
            })()
          " in current tab
        end tell
      end tell
      `,
      10000
    );

    if (clickResult !== 'clicked') {
      return {
        success: false,
        followers: [],
        count: 0,
        error: 'Could not find or click followers link',
      };
    }

    // Wait for followers modal to appear
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Extract followers with scrolling
    const extractScript = `
      (async function() {
        const limit = ${limit};
        const followers = [];
        const seen = new Set();

        // Find the followers dialog/modal
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) {
          return { error: 'Followers dialog not found' };
        }

        // Find scrollable container
        const scrollContainer = dialog.querySelector('div[style*="overflow"]') || dialog;

        let scrollAttempts = 0;
        const maxScrollAttempts = 50;

        while (followers.length < limit && scrollAttempts < maxScrollAttempts) {
          // Extract visible follower items
          const items = dialog.querySelectorAll('div[role="button"]');

          for (const item of items) {
            if (followers.length >= limit) break;

            try {
              // Extract handle (username)
              const usernameEl = item.querySelector('a[role="link"]');
              const handle = usernameEl ? usernameEl.href.split('/')[3] : null;

              if (!handle || seen.has(handle)) continue;
              seen.add(handle);

              // Extract display name
              const displayNameEl = item.querySelector('span');
              const displayName = displayNameEl ? displayNameEl.textContent.trim() : handle;

              // Check for verified badge
              const isVerified = item.querySelector('svg[aria-label*="Verified"]') !== null;

              // Extract bio snippet (second line of text)
              const textElements = item.querySelectorAll('span');
              let bio = '';
              if (textElements.length > 1) {
                bio = textElements[1].textContent.trim();
              }

              // Extract follower/following counts if visible
              const statsText = item.textContent;
              let followerCount = undefined;
              let followingCount = undefined;

              const followerMatch = statsText.match(/(\\d+\\.?\\d*[KM]?) followers/i);
              if (followerMatch) {
                followerCount = parseCountString(followerMatch[1]);
              }

              followers.push({
                handle,
                displayName,
                bio: bio || undefined,
                followerCount,
                followingCount,
                isVerified,
              });
            } catch (e) {
              // Skip this item if extraction fails
              continue;
            }
          }

          // Scroll down
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
          await new Promise(r => setTimeout(r, 500));
          scrollAttempts++;

          // Check if we've reached the end
          if (scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 10) {
            // Try one more scroll
            await new Promise(r => setTimeout(r, 1000));
            if (scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 10) {
              break; // Reached the end
            }
          }
        }

        // Helper to parse count strings like "1.2K" or "5M"
        function parseCountString(str) {
          const multipliers = { K: 1000, M: 1000000 };
          const match = str.match(/^(\\d+\\.?\\d*)([KM])?$/i);
          if (!match) return undefined;
          const num = parseFloat(match[1]);
          const mult = match[2] ? multipliers[match[2].toUpperCase()] : 1;
          return Math.round(num * mult);
        }

        return { followers, count: followers.length };
      })()
    `;

    const result = await execSafari(
      `
      tell application "Safari"
        tell front window
          do JavaScript "${extractScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}" in current tab
        end tell
      end tell
      `,
      60000
    );

    const parsed = JSON.parse(result);

    if (parsed.error) {
      return {
        success: false,
        followers: [],
        count: 0,
        error: parsed.error,
        handle,
      };
    }

    return {
      success: true,
      followers: parsed.followers,
      count: parsed.followers.length,
      handle,
    };
  } catch (error: any) {
    return {
      success: false,
      followers: [],
      count: 0,
      error: error.message || 'Unknown error',
      handle,
    };
  }
}

/**
 * Extract followers from multiple handles (batch operation)
 */
export async function extractFollowersBatch(
  handles: string[],
  limitPerHandle: number = 200
): Promise<Map<string, ExtractFollowersResult>> {
  const results = new Map<string, ExtractFollowersResult>();

  for (const handle of handles) {
    const result = await extractFollowers(handle, limitPerHandle);
    results.set(handle, result);

    // Rate limiting: wait between extractions
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  return results;
}

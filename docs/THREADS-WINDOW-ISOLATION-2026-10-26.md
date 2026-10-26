# Threads research window isolation — October 26, 2026

The background Threads researcher navigated Safari’s current front window and evaluated JavaScript in the front document. During a TubeLab JetKVM acceptance run, it redirected newly prepared research windows to Threads. The TubeLab origin checks rejected these changed targets before sending input.

ThreadsResearcher now creates one background research window per instance and retains its persistent Safari window ID. Navigation and page reads address that exact window and its one tab. The current URL must remain on Threads; a closed window, changed origin, or changed tab inventory fails without adopting the foreground document. Other browser sessions can continue. No machine-wide or browser-wide admission lock was introduced.

Validation: the market-research TypeScript check and build pass. A real Safari regression using an independent loopback HTTP document passed four scenarios: navigation after z-order changes, reads from the same research window, rejection of a foreign origin, and a closed-target failure that preserves the independent document. Run it with `npx tsx packages/threads-comments/src/__tests__/threads-target-isolation.live.ts`.

The active market-research job was preserved. The source/build verification does not establish that its already-loaded class changed. Runtime staging and activation, with source/hash binding and a fresh TubeLab check, are recorded separately outside Git under the owner’s current video-test workstream. No video generation or public publication was authorized by this repair.

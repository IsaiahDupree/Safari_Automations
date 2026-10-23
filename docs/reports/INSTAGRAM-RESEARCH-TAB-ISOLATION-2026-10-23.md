# Instagram research tab isolation

The running market researcher repeatedly navigated unrelated front Safari tabs,
interrupting owner-requested X/Instagram acceptance. InstagramResearcher now
requires `SAFARI_INSTAGRAM_RESEARCH_WINDOW_ID` and optional
`SAFARI_INSTAGRAM_RESEARCH_TAB_INDEX` (default 1). Both must be positive safe
integers. Every read/navigation uses that exact target; navigation and current
tab origin must be Instagram. Missing/closed/reassigned targets fail closed.
There is no front-window fallback. Navigation uses execFile arguments rather
than shell-interpolated URL text.

Validation: TypeScript compilation passed. The real Safari integration script
`packages/instagram-comments/tests/research-window-isolation.ts` passed with the
observed dedicated window 299. It also checks missing target refusal before
browser execution. No mocked provider was used.

Deployment remains pending: port 3106 has an active in-memory multi-platform
research job. Restarting it now could lose that job. After it is idle, rebuild
the deployed market-research runtime, configure a fresh dedicated Instagram
window ID in its launchd environment, restart and repeat the real read test.
Window 299 is historical, not a durable configuration promise. Do not mark the
running service fixed merely because this source change passed tests.

This change covers InstagramResearcher only; other platform researchers need
separate isolation audits.

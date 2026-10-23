# TikTok research authentication recovery

October 22, 2026: the market-research worker repeatedly searched fashion,
#fashion and fashion reaction while TikTok was signed out. Its collector treated
the login wall as zero cards, scrolled five times and advanced to the next query,
overwriting interactive sign-in. This was not evidence of a rejected password.

TikTokResearcher now checks for a login/password/verification wall before search,
after navigation and before every extraction. It throws TIKTOK_AUTH_REQUIRED,
ending the platform run instead of recording a successful empty result. An
unverified/changed origin during extraction throws TIKTOK_SESSION_UNVERIFIED.
No credential is embedded in the researcher.

Complete the actual account sign-in using
`/Users/isaiahdupree/Documents/Software/jetkvm-agent/docs/ACCOUNT-ACCESS.md`.
Then start a new research job explicitly. Do not replay a lost in-memory job or
mistake old intermediate zero-result files for a successful collection.

The offending all-platform job job_1792714028144_g83926 was interrupted for
login recovery. Existing intermediate files remain in runtime data. The runtime
was restarted with the compiled fix and /health verified; no replacement bulk
research job was launched. Live verification-wall detection was tested before
login, then the signed-in state and search results were verified after Gmail MFA.

Research also binds to the unique existing TikTok tab by stable Safari window ID,
so another app/window becoming frontmost no longer redirects it. Multiple TikTok
tabs are reported as ambiguous; it never guesses an account/profile.

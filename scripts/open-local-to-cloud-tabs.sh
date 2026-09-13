#!/bin/zsh -l
# Compatibility launcher for the retired "Local to Cloud" Safari profile.
# No window is reserved and no cross-process claim is created. Missing platform
# tabs are opened in Safari's current front window, and services are asked to
# resolve their own independent targets.

set -u

declare -a PLATFORM_TABS=(
  "instagram.com|https://www.instagram.com/direct/inbox/"
  "x.com|https://x.com/messages"
  "tiktok.com|https://www.tiktok.com/"
  "threads.com|https://www.threads.com/"
  "facebook.com|https://www.facebook.com/"
  "medium.com|https://medium.com/"
  "upwork.com|https://www.upwork.com/"
  "sora|https://sora.com/"
)

declare -a ENSURE_SERVICES=(
  "3100:instagram-dm"
  "3003:twitter-dm"
  "3102:tiktok-dm"
  "3004:threads-comments"
  "3005:instagram-comments"
  "3006:tiktok-comments"
  "3007:twitter-comments"
  "3008:facebook-comments"
  "3104:upwork-automation"
)

log() { echo "[$(date +%H:%M:%S)] $*"; }

/usr/bin/open -a Safari
sleep 1
/usr/bin/osascript -e 'tell application "Safari" to if (count of windows) is 0 then make new document with properties {URL:"about:blank"}' >/dev/null

if [[ "${1:-}" != "--claim" && "${1:-}" != "--ensure" ]]; then
  for entry in "${PLATFORM_TABS[@]}"; do
    pattern="${entry%%|*}"
    url="${entry##*|}"
    exists=$(/usr/bin/osascript <<ASEOF 2>/dev/null
tell application "Safari"
  repeat with w from 1 to count of windows
    repeat with t from 1 to count of tabs of window w
      try
        if (URL of tab t of window w) contains "${pattern}" then return "yes"
      end try
    end repeat
  end repeat
  return "no"
end tell
ASEOF
)
    if [[ "$exists" == "yes" ]]; then
      log "  FOUND   ${pattern}"
    else
      log "  OPEN    ${url}"
      /usr/bin/osascript <<ASEOF >/dev/null 2>&1
tell application "Safari"
  tell front window to make new tab with properties {URL:"${url}"}
end tell
ASEOF
    fi
  done
fi

log "Resolving independent service targets..."
for svc in "${ENSURE_SERVICES[@]}"; do
  port="${svc%%:*}"
  label="${svc##*:}"
  if /usr/bin/curl -s --max-time 6 -X POST "http://localhost:${port}/api/session/ensure" >/dev/null 2>&1; then
    log "  :${port} ${label} — ready"
  else
    log "  :${port} ${label} — unavailable"
  fi
done

log "Done. Safari admission is open; no shared claim or designated window was created."

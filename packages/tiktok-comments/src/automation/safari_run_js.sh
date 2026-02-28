#!/bin/bash
# Usage: safari_run_js.sh <path-to-js-file>
# Executes JavaScript in Safari's front document via osascript heredoc.
# This preserves «class utf8» encoding which gets corrupted through Node's child_process.
JS_FILE="$1"
osascript <<APPLESCRIPT
set jsCode to read POSIX file "$JS_FILE" as «class utf8»
tell application "Safari" to do JavaScript jsCode in front document
APPLESCRIPT

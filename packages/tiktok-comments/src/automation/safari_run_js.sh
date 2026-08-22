#!/bin/bash
# Legacy front-document execution is intentionally disabled. Use the TikTok
# service driver after it has acquired a Window 2 TabCoordinator claim.
echo "safari_run_js.sh disabled: use the lane-aware TikTok service" >&2
exit 73

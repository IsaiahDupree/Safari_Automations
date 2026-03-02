# Safari Automation E2E Test Suite

Comprehensive end-to-end validation of Safari automation services via direct HTTP API calls.

## Quick Start

```bash
# Make sure all services are running
./scripts/start-services.sh

# Run the test suite
python3 scripts/tests/safari_e2e_runner.py
```

## Test Results

**Current Status:** 27/103 features passing (26.2%)

### Breakdown by Category

| Category | Pass Rate | Status |
|----------|-----------|--------|
| Health Checks | 10/10 (100%) | ✅ All services operational |
| Market Research | 10/16 (62.5%) | ✅ Core features working |
| Reporting | 6/8 (75%) | ✅ Results tracking functional |
| LinkedIn | 1/4 (25%) | ⚠️ Blocked by active hours |
| Error Handling | 1/4 (25%) | ⚠️ Partial coverage |
| Session Management | 0/9 (0%) | ❌ Requires Safari automation |
| Instagram Operations | 0/8 (0%) | ❌ Requires Safari automation |
| Twitter Operations | 0/8 (0%) | ❌ Requires Safari automation |
| TikTok Operations | 0/8 (0%) | ❌ Requires Safari automation |
| Threads Operations | 0/4 (0%) | ❌ Requires real URLs |
| Safari Inspector | 0/11 (0%) | ❌ Not implemented (mcp7) |
| Integration Tests | 0/6 (0%) | ❌ Requires full automation |
| Rate Limits | 0/4 (0%) | ❌ Requires active hours |
| Advanced JS | 0/3 (0%) | ❌ Requires Safari automation |

## Files

- `safari_e2e_runner.py` - Main test runner script
- `safari_e2e_results.json` - Detailed test results in JSON format
- `SAFARI_E2E_SUMMARY.md` - Comprehensive analysis and recommendations

## What Works

✅ **All Services Healthy**
- Instagram DM (ports 3001, 3100)
- Twitter DM (port 3003)
- TikTok DM (port 3102)
- LinkedIn (port 3105)
- Instagram Comments (port 3005)
- Twitter Comments (port 3007)
- TikTok Comments (port 3006)
- Threads Comments (port 3004)
- Market Research (port 3106)

✅ **Market Research API**
- Instagram keyword search + post extraction
- Twitter keyword search + post extraction
- Threads keyword search + post extraction
- Instagram competitor research (async jobs)

✅ **Error Handling**
- Invalid platform detection
- Proper error message formatting

✅ **Results & Reporting**
- JSON results generation
- Feature list auto-update
- Comprehensive test reporting

## What's Blocked

### 🔐 Safari Browser Automation (46 features)
**Requirements:**
- Safari browser running with logged-in tabs
- Instagram authentication for session management
- Session endpoints (only available on Instagram port 3100)

**Affected Categories:**
- Session Management (9 features)
- Instagram Operations (8 features)
- Twitter Operations (8 features)
- TikTok Operations (8 features)
- Integration Tests (6 features)
- Advanced JS Execution (3 features)
- Threads Operations (4 features - partially)

### ⏰ Active Hours Restriction (11 features)
**Requirement:** Tests must run between 9:00-21:00

**Affected Categories:**
- LinkedIn DM tests (3 features)
- Instagram DM tests (included in Safari automation)
- Twitter DM tests (included in Safari automation)
- TikTok DM tests (included in Safari automation)
- Rate Limit tests (4 features)

### 🚧 Safari Inspector Not Implemented (11 features)
**Requirement:** Build mcp7 Safari Inspector MCP server

**Missing Capabilities:**
- Session management (start/stop/list)
- Page navigation
- Screenshot capture
- JavaScript execution
- Console log access
- Network log access

## Running Tests During Active Hours

To test DM sending features, run between 9:00-21:00:

```bash
# Check if within active hours
python3 -c "from datetime import datetime; h=datetime.now().hour; print('Active' if 9<=h<21 else 'Inactive')"

# Run tests
python3 scripts/tests/safari_e2e_runner.py
```

## Safari Automation Setup

To test Safari automation features:

1. **Open Safari with logged-in tabs:**
   ```bash
   open -a Safari
   # Navigate to and log in to:
   # - instagram.com
   # - twitter.com
   # - tiktok.com
   ```

2. **Configure Instagram authentication:**
   ```bash
   # Add auth token to environment or service config
   export INSTAGRAM_AUTH_TOKEN="your-token-here"
   ```

3. **Run tests:**
   ```bash
   python3 scripts/tests/safari_e2e_runner.py
   ```

## Implementing Safari Inspector (mcp7)

The Safari Inspector MCP server would provide advanced debugging capabilities. Reference implementation in `packages/safari-mcp/src/index.ts` (currently only implements mcp6 features).

**Required Tools:**
- `mcp7_safari_start_session` - Start a new inspector session
- `mcp7_safari_list_sessions` - List active sessions
- `mcp7_safari_navigate` - Navigate to a URL
- `mcp7_safari_get_page_info` - Get current page title and URL
- `mcp7_safari_take_screenshot` - Capture page screenshot
- `mcp7_safari_execute_script` - Run JavaScript
- `mcp7_safari_inspect_element` - Inspect element by selector
- `mcp7_safari_get_console_logs` - Get console output
- `mcp7_safari_get_network_logs` - Get network activity
- `mcp7_safari_clear_console_logs` - Clear console
- `mcp7_safari_close_session` - Close inspector session

## Test Development

### Adding New Tests

```python
def test_new_feature(param: str) -> Tuple[bool, Optional[str], Optional[Dict]]:
    """Test description. Returns (success, error, response_data)."""
    result, error = http_call(f"http://localhost:PORT/endpoint", method="POST", data={...})

    if error:
        return False, error, None

    # Validate response
    if not result.get("expected_field"):
        return False, "Missing expected field", None

    return True, None, result

# Add to run_all_tests():
passed, error, data = test_new_feature("test_param")
results.append({"id": "T-SAFARI-E2E-XXX", "name": "Test name", "passed": passed, "error": error})
print(f"  {'✅' if passed else '❌'} Test name")
```

### Test Categories

1. **Health Checks** - Verify service availability
2. **Session Management** - Safari tab tracking and locking
3. **Platform Operations** - DM sending, commenting, inbox navigation
4. **Market Research** - Keyword search and competitor analysis
5. **Safari Inspector** - Advanced debugging and inspection
6. **Integration** - Multi-step workflows
7. **Rate Limits** - Rate limit enforcement and reporting
8. **Error Handling** - Error detection and reporting
9. **Advanced** - JavaScript execution and custom automation
10. **Reporting** - Test results and feature tracking

## CI/CD Integration

```bash
#!/bin/bash
# Run tests and exit with appropriate code
python3 scripts/tests/safari_e2e_runner.py

# Check results
if [ $? -ne 0 ]; then
  echo "Tests failed"
  exit 1
fi

# Parse pass rate
PASS_RATE=$(cat scripts/tests/safari_e2e_results.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['summary']['passed']/d['summary']['total']*100)")

echo "Pass rate: ${PASS_RATE}%"
```

## Troubleshooting

### Services Not Running

```bash
# Restart all services
./scripts/start-services.sh --restart

# Check health
curl http://localhost:3106/health
```

### Authentication Errors (Instagram)

Port 3100 requires authentication. Either:
1. Use port 3001 instead (no auth required)
2. Add authentication to test runner
3. Configure service to allow unauthenticated session endpoints

### Timeout Errors (TikTok)

TikTok Safari automation can take >60 seconds. Increase timeout:

```python
# In test_market_research()
result, error = http_call(..., timeout=120)  # Increase to 120s
```

### Missing topCreators (Competitor Research)

Competitor research jobs may take >2 minutes. Increase poll timeout:

```python
# In test_competitor_research()
max_wait = 180  # Increase to 3 minutes
```

## Next Steps

1. **Run during active hours** - Test DM sending features (9:00-21:00)
2. **Implement Safari Inspector** - Build mcp7 server for debugging
3. **Add Safari automation setup** - Document browser + auth configuration
4. **Expand error tests** - Add remaining error validation
5. **Create test fixtures** - Set up test URLs and accounts

## Contributing

When adding new features to Safari automation services:

1. Add corresponding test to `safari_e2e_runner.py`
2. Update feature list in harness
3. Run tests and verify pass
4. Update documentation

## License

Part of Safari Automation project.

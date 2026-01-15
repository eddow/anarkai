#!/usr/bin/env bash

# OWNk Projects Test Watcher
# Runs tests in watch mode for all ownk projects and sends desktop notification on failure

OWNK_DIR="${HOME}/dev/ownk"
ANARKAI_DIR="${HOME}/dev/anarkai"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to send desktop notification
send_notification() {
    local title="$1"
    local message="$2"
    local urgency="${3:-normal}"
    
    # Try notify-send (Linux)
    if command -v notify-send &> /dev/null; then
        notify-send -u "$urgency" "$title" "$message"
    # Fallback to wall if no GUI notification available
    elif command -v wall &> /dev/null; then
        echo "$title: $message" | wall
    fi
}

# Function to run tests for a project
run_tests() {
    local project_name="$1"
    local project_path="$2"
    local test_cmd="${3:-npm test}"
    
    echo -e "${YELLOW}Testing ${project_name}...${NC}"
    
    if cd "$project_path" && eval "$test_cmd" > /tmp/ownk-test-${project_name}.log 2>&1; then
        echo -e "${GREEN}✓ ${project_name} tests passed${NC}"
        return 0
    else
        echo -e "${RED}✗ ${project_name} tests FAILED${NC}"
        echo "  See /tmp/ownk-test-${project_name}.log for details"
        send_notification "🔴 Test Failure: ${project_name}" "Tests failed! Check logs for details." "critical"
        return 1
    fi
}

# Function to run all tests once
run_all_tests() {
    local failed=0
    
    echo "================================"
    echo "Running OWNk Project Tests"
    echo "$(date)"
    echo "================================"
    
    # pounce-ts (Playwright)
    run_tests "pounce-ts" "${OWNK_DIR}/pounce-ts" "npm test" || ((failed++))
    
    # pounce-ui (Jest)
    run_tests "pounce-ui" "${OWNK_DIR}/pounce-ui" "npm test" || ((failed++))
    
    # browser-pounce (Playwright)
    run_tests "browser-pounce" "${ANARKAI_DIR}/apps/browser-pounce" "npx playwright test" || ((failed++))
    
    echo ""
    if [ $failed -gt 0 ]; then
        echo -e "${RED}${failed} project(s) have failing tests${NC}"
        return 1
    else
        echo -e "${GREEN}All tests passing!${NC}"
        return 0
    fi
}

# Watch mode - uses inotifywait to watch for file changes
watch_mode() {
    echo "Starting OWNk test watcher..."
    echo "Watching: pounce-ts, pounce-ui, browser-pounce"
    echo "Press Ctrl+C to stop"
    echo ""
    
    # Initial run
    run_all_tests
    
    # Watch for changes
    while true; do
        # Wait for file changes in any of the source directories
        inotifywait -q -r -e modify,create,delete \
            "${OWNK_DIR}/pounce-ts/src" \
            "${OWNK_DIR}/pounce-ui/src" \
            "${ANARKAI_DIR}/apps/browser-pounce/src" \
            2>/dev/null
        
        echo ""
        echo "Changes detected, re-running tests..."
        run_all_tests
    done
}

# Parse arguments
case "${1:-}" in
    --watch|-w)
        if ! command -v inotifywait &> /dev/null; then
            echo "Error: inotifywait not found. Install inotify-tools:"
            echo "  sudo apt install inotify-tools"
            exit 1
        fi
        watch_mode
        ;;
    --once|-o)
        run_all_tests
        ;;
    *)
        echo "OWNk Test Watcher"
        echo ""
        echo "Usage: $0 [options]"
        echo ""
        echo "Options:"
        echo "  --watch, -w    Watch for file changes and run tests automatically"
        echo "  --once, -o     Run all tests once and exit"
        echo ""
        echo "Without arguments, runs in watch mode."
        echo ""
        
        # Default to watch mode
        if command -v inotifywait &> /dev/null; then
            watch_mode
        else
            echo "Note: inotifywait not available, running tests once."
            run_all_tests
        fi
        ;;
esac

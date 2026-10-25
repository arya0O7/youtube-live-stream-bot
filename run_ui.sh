#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo "========================================================"
echo "  🔥 LAUNCHING PHOENIX YOUTUBE BOT — WEB CONTROL PANEL"
echo "  🌐 URL: http://localhost:5050"
echo "========================================================"

# Free port 5050 and clean up stale drivers
lsof -ti:5050 | xargs kill -9 2>/dev/null || true
pkill -f chromedriver 2>/dev/null || true

exec ./venv/bin/python3 bot_server.py "$@"

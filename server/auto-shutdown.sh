#!/bin/bash
# Auto-shutdown livestream services at 19:00 daily

echo "[auto-shutdown] $(date '+%Y-%m-%d %H:%M:%S') Starting..."

curl -s -X POST http://localhost:3001/api/fb/stop 2>/dev/null
curl -s -X POST http://localhost:3001/api/live-session/end 2>/dev/null

# Kill all services
lsof -ti:3001 | xargs kill 2>/dev/null
lsof -ti:5173 | xargs kill 2>/dev/null
pkill -f "fb-crawler.js" 2>/dev/null

echo "[auto-shutdown] Done."

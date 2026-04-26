#!/bin/bash
# Health check - restart services if down

BACKEND=$(curl -s http://localhost:3001/health 2>/dev/null | grep -q "ok" && echo "OK" || echo "FAIL")

if [ "$BACKEND" != "OK" ]; then
  echo "[$(date)] Backend down, restarting..."
  cd /Users/baoduong2/.openclaw/workspace
  bash server/start-live.sh
fi

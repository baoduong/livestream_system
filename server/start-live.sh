#!/bin/bash
# Start all livestream services + notify Discord
# Usage: bash /Users/baoduong2/.openclaw/workspace/server/start-live.sh

WORKSPACE="/Users/baoduong2/.openclaw/workspace"
LOG_FILE="$WORKSPACE/data/start-live.log"
DISCORD_CHANNEL="1492732763609235479"

echo "WORKSPACE: $WORKSPACE"

if [ -f "$WORKSPACE/.env" ]; then
  export $(echo $(cat "$WORKSPACE/.env" | sed 's/#.*//g' | xargs))
fi

echo "Check DISCORD_TOKEN: $DISCORD_TOKEN" | tee -a "$LOG_FILE"
DISCORD_TOKEN="$DISCORD_TOKEN"

send_discord() {
  curl -s -X POST "https://discord.com/api/v10/channels/$DISCORD_CHANNEL/messages" \
    -H "Authorization: Bot $DISCORD_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$1" > /dev/null 2>&1
}
send_text() { send_discord "{\"content\":\"$1\"}"; }

echo "[start-live] $(date '+%Y-%m-%d %H:%M:%S') Starting..." | tee "$LOG_FILE"
send_text "⏳ Đang khởi động dịch vụ..."

# 1. Kill existing services
echo "[start-live] Killing existing services..." | tee -a "$LOG_FILE"
lsof -ti:3001 | xargs kill -9 2>/dev/null
lsof -ti:5173 | xargs kill -9 2>/dev/null
# Kill crawler if running
pkill -f "fb-crawler.js" 2>/dev/null
sleep 1

# 2. Start backend
echo "[start-live] Starting backend..." | tee -a "$LOG_FILE"
cd "$WORKSPACE"
nohup node server/index.js >> "$WORKSPACE/data/backend.log" 2>&1 &
BACKEND_PID=$!

# 3. Wait for backend ready
for i in $(seq 1 15); do
  if curl -s http://localhost:3001/health > /dev/null 2>&1; then
    echo "[start-live] Backend ready!" | tee -a "$LOG_FILE"
    break
  fi
  sleep 1
done

if ! curl -s http://localhost:3001/health > /dev/null 2>&1; then
  echo "[start-live] ERROR: Backend failed" | tee -a "$LOG_FILE"
  send_text "❌ Backend khởi động thất bại!"
  exit 1
fi

# 4. Create session with live video
# Wait for FB poller to find live video
sleep 5
LIVE_INFO=$(curl -s http://localhost:3001/api/fb/status 2>/dev/null)
VIDEO_ID=$(echo "$LIVE_INFO" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('videoId',''))" 2>/dev/null)

# Get permalink URL (real video URL, different from Graph API ID)
TOKEN=$(grep FB_PAGE_TOKEN $WORKSPACE/.env | cut -d= -f2)
PERMALINK_URL=""
if [ -n "$VIDEO_ID" ] && [ -n "$TOKEN" ]; then
  PERMALINK_URL=$(curl -s "https://graph.facebook.com/v21.0/$VIDEO_ID?fields=permalink_url&access_token=$TOKEN" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('permalink_url',''))" 2>/dev/null)
  echo "[start-live] Video ID: $VIDEO_ID | Permalink: $PERMALINK_URL" | tee -a "$LOG_FILE"
fi

if [ -n "$VIDEO_ID" ]; then
  curl -s -X POST http://localhost:3001/api/live-session/start -H 'Content-Type: application/json' -d "{\"fb_video_id\":\"$VIDEO_ID\"}" > /dev/null
else
  curl -s -X POST http://localhost:3001/api/live-session/start -H 'Content-Type: application/json' -d '{}' > /dev/null
fi

# 5. Start UI
cd "$WORKSPACE"
nohup npx vite --host 0.0.0.0 --port 5173 >> "$WORKSPACE/data/ui.log" 2>&1 &
UI_PID=$!

for i in $(seq 1 10); do
  if curl -s http://localhost:5173 > /dev/null 2>&1; then break; fi
  sleep 1
done

# 6. Start crawler with Business Suite Comments Dashboard
echo "[start-live] Starting crawler..." | tee -a "$LOG_FILE"
cd "$WORKSPACE"
if [ -n "$PERMALINK_URL" ]; then
  # Extract video ID from permalink (e.g. /xxx/videos/958824710072519 → 958824710072519)
  REAL_VIDEO_ID=$(echo "$PERMALINK_URL" | grep -o '[0-9]\{6,\}$')
  if [ -n "$REAL_VIDEO_ID" ]; then
    CRAWLER_URL="https://business.facebook.com/live/producer/dashboard/${REAL_VIDEO_ID}/COMMENTS/"
  else
    CRAWLER_URL="https://www.facebook.com${PERMALINK_URL}"
  fi
  echo "[start-live] Crawler URL: $CRAWLER_URL" | tee -a "$LOG_FILE"
  nohup node server/fb-crawler.js "$CRAWLER_URL" >> "$WORKSPACE/data/crawler.log" 2>&1 &
elif [ -n "$VIDEO_ID" ]; then
  CRAWLER_URL="https://www.facebook.com/${FB_PAGE_ID:-107811450656942}/videos/$VIDEO_ID"
  nohup node server/fb-crawler.js "$CRAWLER_URL" >> "$WORKSPACE/data/crawler.log" 2>&1 &
else
  nohup node server/fb-crawler.js >> "$WORKSPACE/data/crawler.log" 2>&1 &
fi
CRAWLER_PID=$!
echo "[start-live] Crawler PID: $CRAWLER_PID" | tee -a "$LOG_FILE"

echo "[start-live] ✅ All services started!" | tee -a "$LOG_FILE"

# 7. Detect LAN IP
LAN_IP=$(ifconfig | grep 'inet ' | grep -v 127.0.0.1 | grep '192.168' | awk '{print $2}' | head -1)
if [ -z "$LAN_IP" ]; then LAN_IP="localhost"; fi
echo "[start-live] LAN IP: $LAN_IP" | tee -a "$LOG_FILE"

send_text "** Khởi động dịch vụ hoàn tất **"

send_text "-------------------------------------------"

send_text "# Má bấm vào đây để mở bảng xem Bình Luận"

# 8. Send Discord notification
send_discord "{
  \"content\": \"\",
  \"components\": [{
    \"type\": 1,
    \"components\": [{
      \"type\": 2,
      \"style\": 5,
      \"label\": \"# Mở bảng điều khiển\",
      \"url\": \"http://${LAN_IP}:5173\"
    }]
  }],
  \"embeds\": [{
    \"title\": \"🚀 Bắt đầu live\",
    \"description\": \"Nhấn nút bên dưới để mở bảng điều khiển livestream trên điện thoại.\",
    \"color\": 3066993
  }]
}"

echo "[start-live] Discord notified" | tee -a "$LOG_FILE"
echo "[start-live] Backend=$BACKEND_PID | UI=$UI_PID | Crawler=$CRAWLER_PID" | tee -a "$LOG_FILE"

# 9. Start health monitor (background)
# nohup node server/health-monitor.js >> "$WORKSPACE/data/health-monitor.log" 2>&1 &
echo "[start-live] Health monitor started"

send_text "-------------------------------------------"

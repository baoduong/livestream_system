# Plan B: Avatar Crawler — Thiết kế dự phòng

## Bối cảnh
- FB Graph API không trả `from.id` / avatar cho live video comments (privacy policy)
- Token app public hiện tại sẽ hết hạn trong ~2 tháng
- Cần cơ chế lấy avatar user từ Facebook profile page

## Giải pháp: Lightpanda headless browser crawl

### Tool: Lightpanda
- Repo: https://github.com/lightpanda-io/browser
- Headless browser siêu nhẹ (~50MB RAM vs Puppeteer ~300MB)
- Hỗ trợ JavaScript rendering
- Giao tiếp qua CDP (Chrome DevTools Protocol)

### Flow tổng quan

```
Comment vào (FB API)
  │
  ├─ Có avatar_url trong DB? → Dùng cache ✅
  │
  └─ Chưa có?
       │
       ├─ Có facebook_url? → Queue crawl
       │     │
       │     └─ Lightpanda mở profile page
       │           │
       │           ├─ Parse avatar từ DOM
       │           ├─ Lưu avatar_url vào DB (customers table)
       │           └─ Update UI qua SSE
       │
       └─ Không có facebook_url? → Dùng initials placeholder
```

### Cấu trúc files

```
server/
  avatar-crawler.js       # Main crawler module
  avatar-queue.js         # Queue manager (rate limit, retry)
  lightpanda-client.js    # CDP connection to Lightpanda
```

### 1. avatar-crawler.js

```javascript
// Crawl FB profile page để lấy avatar URL
// Input: facebook_url (e.g. "https://facebook.com/5125269640854514")
// Output: avatar_url (direct image URL)

import { LightpandaClient } from './lightpanda-client.js'

const CRAWL_TIMEOUT = 10000  // 10s max per profile
const MIN_DELAY = 3000       // 3s between requests (anti-bot)

export async function crawlAvatar(facebookUrl) {
  const browser = new LightpandaClient()
  
  try {
    await browser.connect()
    await browser.navigate(facebookUrl)
    await browser.waitFor('img[data-imgperflogname="profileCoverPhoto"]', CRAWL_TIMEOUT)
    
    // Strategy 1: Profile photo element
    const avatar = await browser.evaluate(`
      // Try multiple selectors (FB changes DOM frequently)
      const selectors = [
        'img[data-imgperflogname="profileCoverPhoto"]',
        'image[preserveAspectRatio]',           // SVG avatar
        '[aria-label="profile picture"] img',
        '.profilePicThumb img',                 // Classic layout
      ]
      for (const sel of selectors) {
        const el = document.querySelector(sel)
        if (el?.src || el?.href?.baseVal) {
          return el.src || el.href.baseVal
        }
      }
      return null
    `)
    
    return avatar
  } finally {
    await browser.disconnect()
  }
}
```

### 2. avatar-queue.js

```javascript
// Queue system: tránh crawl quá nhiều cùng lúc
// Rate limit: max 1 request / 3s
// Retry: max 2 lần

const queue = []
let processing = false

export function enqueueAvatarCrawl(customerId, facebookUrl) {
  // Skip if already in queue
  if (queue.find(q => q.customerId === customerId)) return
  
  queue.push({ customerId, facebookUrl, retries: 0 })
  processQueue()
}

async function processQueue() {
  if (processing || queue.length === 0) return
  processing = true
  
  const item = queue.shift()
  try {
    const avatarUrl = await crawlAvatar(item.facebookUrl)
    if (avatarUrl) {
      // Save to DB
      db.prepare('UPDATE customers SET avatar_url = ? WHERE id = ?')
        .run(avatarUrl, item.customerId)
      
      // Notify UI via SSE
      broadcast('avatar-update', { customerId: item.customerId, avatarUrl })
      
      console.log(`[avatar] #${item.customerId} → ${avatarUrl.slice(0, 50)}...`)
    }
  } catch (err) {
    console.error(`[avatar] Error #${item.customerId}: ${err.message}`)
    if (item.retries < 2) {
      item.retries++
      queue.push(item) // retry
    }
  }
  
  // Rate limit: wait 3s
  await new Promise(r => setTimeout(r, 3000))
  processing = false
  processQueue()
}
```

### 3. Integration vào index.js

```javascript
// Trong addCommentToFeed():
if (customerId && !existingCustomer.avatar_url && facebookUrl) {
  enqueueAvatarCrawl(customerId, facebookUrl)
}

// SSE event mới cho UI:
// event: avatar-update
// data: { customerId, avatarUrl }
```

### 4. UI update (App.jsx)

```javascript
// Listen for avatar updates
es.addEventListener('avatar-update', (e) => {
  const { customerId, avatarUrl } = JSON.parse(e.data)
  setItems(prev => prev.map(c =>
    c.customerId === customerId ? { ...c, avatarUrl } : c
  ))
})
```

### 5. Lightpanda setup

```bash
# Install Lightpanda
curl -L https://github.com/lightpanda-io/browser/releases/latest/download/lightpanda-macos -o /usr/local/bin/lightpanda
chmod +x /usr/local/bin/lightpanda

# Start Lightpanda daemon
lightpanda --headless --remote-debugging-port=9222
```

## Database changes

Không cần — `customers.avatar_url` đã có.

## Rủi ro & Mitigation

| Rủi ro | Mitigation |
|--------|-----------|
| FB block IP | Rate limit 1 req/3s, chỉ crawl khi chưa có avatar |
| FB đổi DOM | Multiple CSS selectors, fallback |
| Lightpanda crash | Try-catch, queue retry (max 2) |
| Slow (10s/profile) | Background queue, không block UI |
| Account bị ban | Không cần login — profile public |

## Metrics dự kiến

- Phiên live đầu tiên: ~50-100 users cần crawl → ~5-10 phút
- Phiên live tiếp theo: ~5-10 users mới → ~30s
- Sau 10 phiên: hầu hết khách đã có avatar → gần như không crawl

## Kết quả test thực tế (2026-04-18)

### Test 1: Lightpanda `fetch` mode
- Command: `lightpanda fetch --dump html <fb_video_url>`
- ✅ HTML trả về OK
- ❌ Comments KHÔNG có trong DOM — FB dùng React client-side rendering
- ❌ Không execute JavaScript → không render comments
- **Kết luận: fetch mode không khả thi**

### Test 2: Lightpanda crawl profile page
- Command: `lightpanda fetch --dump html <fb_profile_url>`
- ✅ HTML trả về
- ❌ FB redirect về login page — profile không public nếu không login
- **Kết luận: cần login cookie → phức tạp + rủi ro**

### Test 3: FB Graph API v16-v25
- Tất cả versions: `from.id` luôn = Page ID (không phải User ID)
- Page Token (app development mode): không trả user identity
- Page Token (app public/published): có thể trả user identity
- User Access Token: Missing Permissions cho live video comments
- **Kết luận: FB API policy restriction, không phải version issue**

## Kế hoạch tiếp theo

### Phase 1: Hiện tại (token app public còn ~2 tháng)
- Dùng token cũ (app public) — lấy được user info
- Nếu `from` field có user ID → lưu DB + fetch avatar
- Nếu không có → dùng initials placeholder

### Phase 2: Khi token die (~tháng 6/2026)
- Option A: **Lightpanda `serve` mode + CDP** (chưa test)
  - Start Lightpanda daemon: `lightpanda serve --remote-debugging-port=9222`
  - Connect qua CDP WebSocket
  - Navigate tới live video page
  - Execute JS, chờ comments render
  - Parse DOM lấy tên + avatar
  - **Cần test thêm: FB có block headless không?**
  
- Option B: **Puppeteer/Playwright** (nặng hơn, chắc chắn hơn)
  - ~300MB RAM
  - Có thể inject FB login cookie
  - Đã proven hoạt động với FB
  - **Backup nếu Lightpanda không đủ**

- Option C: **Chấp nhận không có avatar**
  - Dedup bằng tên
  - Initials placeholder
  - UI vẫn functional
  - **Zero risk, zero maintenance**

### TODO khi cần implement
- [ ] Test Lightpanda `serve` mode với CDP
- [ ] Test inject FB cookie vào headless browser
- [ ] Test FB anti-bot detection với headless
- [ ] Benchmark: crawl 50 profiles liên tục → có bị block?
- [ ] So sánh Lightpanda vs Puppeteer performance

## Khi nào kích hoạt

1. Token app public die (FB gỡ app)
2. FB API không trả `from` field cho live comments
3. Cần avatar cho khách mới

## Implementation checklist

- [ ] Install Lightpanda trên server
- [ ] Viết lightpanda-client.js (CDP connection)
- [ ] Viết avatar-crawler.js (parse FB profile)
- [ ] Viết avatar-queue.js (rate limit + retry)
- [ ] Integrate vào index.js (addCommentToFeed)
- [ ] UI: listen SSE avatar-update event
- [ ] Test với 10 profiles thật
- [ ] Test rate limit (50 profiles liên tục)
- [ ] Monitor: log crawl success/fail rate

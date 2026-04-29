# Long-Term Memory

## Thông tin dự án (2026-04-28)
- Ứng dụng livestream bán vải Facebook, phục vụ cho người nhà (cá nhân)
- Facebook App "QuanLyDH" (ID: 1285244549093076) — **vĩnh viễn ở Development mode**, không bao giờ chuyển Live
- Vì dev mode nên Graph API thiếu field `from` → **phải dùng crawler** (Playwright + cookies) để lấy comments
- Page: "Vải cân giá rẻ Thanh Thanh" (ID: 107811450656942)
- Đã có **long-lived Page Token vĩnh viễn** (app QuanLyDH, secret: 9cff759db91949f8cd8c5368a6936058)
- Crawler v5: dùng **persistent browser profile** (`data/browser-profile/`) — đăng nhập FB 1 lần, session lưu vĩnh viễn trên disk
- Không cần cookies trong .env nữa (FB_COOKIE_C_USER, FB_COOKIE_XS)
- Lần đầu chạy crawler: mở browser → đăng nhập thủ công → profile tự lưu
- Các lần sau: auto-login, kể cả restart/tắt máy
- Cần URL dạng `business.facebook.com/live/producer/dashboard/{VIDEO_ID}/COMMENTS/` (không dùng facebook.com/videos/)
- Webhook: đã subscribe `feed` + `live_videos`, nhưng Development mode giới hạn field `from`
- Đã tích hợp **faster-whisper** (model medium) để transcribe voice messages
- Stack: Node.js backend (port 3001) + React/Vite UI (port 5173) + SQLite + Tailscale Funnel cho webhook


## Promoted From Short-Term Memory (2026-04-23)

<!-- openclaw-memory-promotion:memory:memory/2026-04-16.md:318:318 -->
- - Candidate: User: [Thu 2026-04-16 22:33 GMT+7] Write a dream diary entry from these memory fragments: - Reflections: No strong patterns surfaced. - Possible Lasting Truths: No strong candidate truths surfaced. - Reflections: No strong patterns surfaced. - Possible Lasting Truths: No strong c [score=0.901 recalls=0 avg=0.620 source=memory/2026-04-16.md:48-48]

## Promoted From Short-Term Memory (2026-04-24)

<!-- openclaw-memory-promotion:memory:memory/2026-04-18.md:328:328 -->
- - Candidate: User: [Sat 2026-04-18 04:03 GMT+7] Write a dream diary entry from these memory fragments: - Reflections: No strong patterns surfaced. - Possible Lasting Truths: No strong candidate truths surfaced. - Reflections: No strong patterns surfaced. - Possible Lasting Truths: No strong c [score=0.896 recalls=0 avg=0.620 source=memory/2026-04-18.md:213-213]
<!-- openclaw-memory-promotion:memory:memory/2026-04-17.md:348:348 -->
- - Candidate: User: [Fri 2026-04-17 20:03 GMT+7] Write a dream diary entry from these memory fragments: - Reflections: No strong patterns surfaced. - Possible Lasting Truths: No strong candidate truths surfaced. - Reflections: No strong patterns surfaced. - Possible Lasting Truths: No strong c [score=0.885 recalls=0 avg=0.620 source=memory/2026-04-17.md:318-318]

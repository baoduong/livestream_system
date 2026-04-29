// Facebook Live Comment Dịch vụ đọc comment v5 — Persistent Profile
// Uses persistent browser profile — login once, never expire
//
// Usage: node server/fb-Dịch vụ đọc comment.js [video-url]
// First run: opens FB login page → login manually → profile saved
// Next runs: auto-logged in from saved profile

import { chromium } from "playwright";
import { config } from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, "../.env") });

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001";
const FB_PAGE_ID = process.env.FB_PAGE_ID || "107811450656942";
const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN || "";
const PROFILE_DIR = path.join(__dirname, "..", "data", "browser-profile");

const DISCORD_CHANNEL = "1492732763609235479";
const DISCORD_TOKEN = process.env.DISCORD_TOKEN || "";

console.log("DISCORD_TOKEN", DISCORD_TOKEN);
console.log("DISCORD_CHANNEL", DISCORD_CHANNEL)

async function sendDiscordMessage(message) {
  if (!DISCORD_TOKEN) return;
  try {
    await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${DISCORD_TOKEN}`,
      },
      body: JSON.stringify({ content: message }),
    });
  } catch (err) {
    console.error(err);
  }
}

await sendDiscordMessage("**Dịch vụ đọc comment đang khởi động...**");

// Ensure profile dir exists
if (!fs.existsSync(PROFILE_DIR)) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function decodeUnicode(str) {
  return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, code) =>
    String.fromCharCode(parseInt(code, 16)),
  );
}
function gaussRand(mean, stddev) {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(mean * 0.3, Math.round(mean + z * stddev));
}

// ─── Extract comments from GraphQL response ─────────────────────────────────
function extractComments(text) {
  const comments = [];
  const chunks = text.split("TopLevelCommentsEdge");

  for (const chunk of chunks) {
    const authorMatch = chunk.match(
      /"author":\{"__typename":"User","id":"(\d{5,})","name":"([^"]+)"/,
    );
    if (!authorMatch) continue;

    const bodyMatch = chunk.match(/"body":\{"text":"([^"]{0,500})"/);
    const commentText = bodyMatch ? decodeUnicode(bodyMatch[1]) : "";
    const name = decodeUnicode(authorMatch[2]);
    const userId = authorMatch[1];

    // Skip page's own comments
    if (userId === "107811450656942" || userId === "100055680767712") continue;

    const timeMatch = chunk.match(/"created_time":(\d+)/);
    const createdTime = timeMatch ? parseInt(timeMatch[1]) : null;

    const commentIdMatch = chunk.match(/comment_id=(\d+)/);
    const fbCommentId = commentIdMatch ? commentIdMatch[1] : null;

    const picMatch = chunk.match(/"profile_picture_depth_0":\{"uri":"([^"]+)"/);
    const avatarUrl = picMatch ? picMatch[1].replace(/\\/g, "") : null;

    comments.push({
      fbCommentId,
      userId,
      name,
      text: commentText,
      createdTime,
      avatarUrl,
    });
  }

  return comments;
}

// ─── Push comment to backend ─────────────────────────────────────────────────
const seenCommentIds = new Set();

async function pushComment(comment) {
  // Always update avatar if available (URLs expire)
  if (comment.avatarUrl && comment.userId) {
    fetch(`${BACKEND_URL}/api/comments/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: comment.name,
        commentText: "__avatar_update__",
        avatarUrl: comment.avatarUrl,
        facebookUserId: comment.userId,
        platform: "system",
      }),
    }).catch(() => {});
  }

  const key = comment.fbCommentId || `${comment.name}:${comment.text}`;
  if (seenCommentIds.has(key)) return false;
  seenCommentIds.add(key);

  try {
    const res = await fetch(`${BACKEND_URL}/api/comments/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: comment.name,
        commentText: comment.text,
        facebookUserId: comment.userId,
        facebookUrl: `https://facebook.com/${comment.userId}`,
        avatarUrl: comment.avatarUrl || null,
        platform: "facebook",
        createdAt: comment.createdTime
          ? new Date(comment.createdTime * 1000).toISOString()
          : undefined,
      }),
    });
    if (!res.ok) return false;
    console.log(`[comment] ${comment.name}: ${comment.text.slice(0, 50)}`);
    return true;
  } catch (err) {
    console.error(`[push] Error: ${err.message}`);
    return false;
  }
}

// ─── Find live video URL → Business Suite Live Producer ─────────────────────
async function findLiveVideoUrl(page) {
  if (process.argv[2]) return process.argv[2];

  if (FB_PAGE_TOKEN) {
    try {
      const liveRes = await fetch(
        `https://graph.facebook.com/${FB_PAGE_ID}/live_videos?fields=id,status&limit=5&access_token=${FB_PAGE_TOKEN}`,
      );
      const liveData = await liveRes.json();
      const livePost = liveData.data?.find((v) => v.status === "LIVE");

      if (!livePost) {
        console.log("[Dịch vụ đọc comment] No active live video found — exiting");
        await sendDiscordMessage(
          "⚠️Dịch vụ đọc comment: Không tìm thấy live video nào đang LIVE.",
        );
        await simulateHuman(page);
        await sleep(3000);
        /* try {
          await fetch('http://localhost:18789/api/message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'send', channel: 'discord', channelId: '1492732763609235479',
              message: '⚠️ Dịch vụ đọc comment: Không tìm thấy live video nào đang LIVE.'
            })
          })
        } catch {
        } */
        process.exit(1);
      }

      const videoRes = await fetch(
        `https://graph.facebook.com/${livePost.id}?fields=video&access_token=${FB_PAGE_TOKEN}`,
      );
      const videoData = await videoRes.json();
      const videoId = videoData.video?.id;

      if (videoId) {
        const url = `https://business.facebook.com/live/producer/dashboard/${videoId}/COMMENTS/`;
        await sendDiscordMessage( `[Dịch vụ đọc comment] Auto-detected live: post=${livePost.id} video=${videoId}`,);
        return url;
      }

      console.log("[Dịch vụ đọc comment] No active live video found");
    } catch (err) {
      console.log(`[Dịch vụ đọc comment] Error finding live: ${err.message}`);
    }
  }

  console.log("[Dịch vụ đọc comment] No live video URL available — exiting");
  process.exit(1);
}

// ─── Human-like mouse movement (Bézier curve) ───────────────────────────────
async function humanMove(page, toX, toY) {
  const from = await page.evaluate(() => ({
    x: window._mouseX || 640,
    y: window._mouseY || 450,
  }));
  const steps = rand(8, 15);
  const cpX = (from.x + toX) / 2 + rand(-100, 100);
  const cpY = (from.y + toY) / 2 + rand(-50, 50);

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = (1 - t) ** 2 * from.x + 2 * (1 - t) * t * cpX + t ** 2 * toX;
    const y = (1 - t) ** 2 * from.y + 2 * (1 - t) * t * cpY + t ** 2 * toY;
    await page.mouse.move(x, y);
    await sleep(rand(5, 25));
  }
  await page.evaluate(
    ({ x, y }) => {
      window._mouseX = x;
      window._mouseY = y;
    },
    { x: toX, y: toY },
  );
}

// ─── Human-like click ────────────────────────────────────────────────────────
async function humanClick(page, selector, timeout = 3000) {
  const el = await page.waitForSelector(selector, { timeout });
  if (!el) return false;
  const box = await el.boundingBox();
  if (!box) return false;
  const x =
    box.x + rand(Math.floor(box.width * 0.2), Math.floor(box.width * 0.8));
  const y =
    box.y + rand(Math.floor(box.height * 0.2), Math.floor(box.height * 0.8));
  await humanMove(page, x, y);
  await sleep(rand(50, 200));
  await page.mouse.down();
  await sleep(rand(40, 120));
  await page.mouse.up();
  return true;
}

// ─── Realistic user behavior ─────────────────────────────────────────────────
async function simulateHuman(page) {
  const action = rand(1, 12);
  try {
    switch (action) {
      case 1:
        console.log("[simulate] Scrolling...");
        await page.mouse.wheel(0, rand(30, 120));
        break;
      case 2:
        console.log("[simulate] Scrolling back...");
        await page.mouse.wheel(0, -rand(10, 50));
        break;
      case 3:
        console.log("[simulate] Moving mouse...");
        await humanMove(page, rand(200, 900), rand(100, 700));
        break;
      case 4:
        console.log("[simulate] Moving mouse again...");
        await humanMove(page, rand(300, 700), rand(300, 600));
        await sleep(rand(500, 2000));
        break;
      case 5:
        for (let i = 0; i < rand(2, 4); i++) {
          console.log("[simulate] Fidgeting mouse...");
          await page.mouse.move(640 + rand(-15, 15), 400 + rand(-10, 10));
          await sleep(rand(100, 400));
        }
        break;
      case 6:
        console.log("[simulate] Idle...");
        await sleep(rand(1000, 4000));
        break;
      case 7:
        console.log("[simulate] Moving mouse more...");
        await humanMove(page, rand(900, 1100), rand(40, 120));
        await sleep(rand(300, 800));
        break;
      case 8:
        console.log("[simulate] Scrolling more...");
        await page.mouse.wheel(0, rand(40, 80));
        await sleep(rand(200, 600));
        await page.mouse.wheel(0, rand(10, 30));
        break;
      default:
        console.log("[simulate] Just chilling...");
        await sleep(rand(300, 1500));
        break;
    }
  } catch {}
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log("[Dịch vụ đọc comment] FB Live Crawler v5 — Persistent Profile");
  console.log(`[Dịch vụ đọc comment] Profile: ${PROFILE_DIR}`);

  // ─── Launch with persistent profile ────────────────────────────────────
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-infobars",
      "--window-size=1440,900",
      "--disable-backgrounding-occluded-windows",
    ],
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    hasTouch: false,
    colorScheme: "light",
    permissions: ["notifications"],
    geolocation: { latitude: 10.8231, longitude: 106.6297 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    extraHTTPHeaders: {
      "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
      "sec-ch-ua":
        '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
    },
  });

  const page = context.pages()[0] || (await context.newPage());

  // ─── Anti-detection scripts ────────────────────────────────────────────
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    window.chrome = {
      runtime: {
        onConnect: { addListener: () => {} },
        onMessage: { addListener: () => {} },
      },
      loadTimes: () => ({
        commitLoadTime: Date.now() / 1000,
        connectionInfo: "h2",
        finishDocumentLoadTime: Date.now() / 1000 + 0.5,
        finishLoadTime: Date.now() / 1000 + 1,
        firstPaintAfterLoadTime: 0,
        firstPaintTime: Date.now() / 1000 + 0.3,
        navigationType: "Other",
        npnNegotiatedProtocol: "h2",
        requestTime: Date.now() / 1000 - 0.5,
        startLoadTime: Date.now() / 1000 - 0.3,
        wasAlternateProtocolAvailable: false,
        wasFetchedViaSpdy: true,
        wasNpnNegotiated: true,
      }),
      csi: () => ({
        pageT: Date.now(),
        startE: Date.now(),
        onloadT: Date.now(),
      }),
    };
    Object.defineProperty(navigator, "plugins", {
      get: () => {
        const arr = [
          {
            name: "Chrome PDF Plugin",
            filename: "internal-pdf-viewer",
            description: "Portable Document Format",
          },
          {
            name: "Chrome PDF Viewer",
            filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai",
            description: "",
          },
          {
            name: "Native Client",
            filename: "internal-nacl-plugin",
            description: "",
          },
        ];
        arr.refresh = () => {};
        return arr;
      },
    });
    Object.defineProperty(navigator, "languages", {
      get: () => ["vi-VN", "vi", "en-US", "en"],
    });
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 10 });
    Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
    Object.defineProperty(screen, "colorDepth", { get: () => 30 });
    const getParam = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (param) {
      if (param === 37445) return "Apple";
      if (param === 37446) return "Apple M1 Pro";
      return getParam.call(this, param);
    };
    Object.defineProperty(Notification, "permission", { get: () => "default" });
    window._mouseX = 640;
    window._mouseY = 450;
    document.addEventListener("mousemove", (e) => {
      window._mouseX = e.clientX;
      window._mouseY = e.clientY;
    });
  });

  // ─── Block heavy media ────────────────────────────────────────────────
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (
      url.includes(".mp4") ||
      url.includes(".m3u8") ||
      url.includes("/live_manifest") ||
      url.includes("/dash_manifest") ||
      (url.includes(".ts") && url.includes("fbcdn"))
    )
      return route.abort();
    return route.continue();
  });

  // ─── GraphQL interceptor ───────────────────────────────────────────────
  let totalComments = 0;
  let totalPushed = 0;

  page.on("response", async (response) => {
    try {
      const url = response.url();
      const ct = response.headers()["content-type"] || "";
      if (!ct.includes("json") && !ct.includes("text")) return;
      const text = await response.text();
      if (text.length > 50000) {
        console.log(`[response] ${url.slice(0, 80)} | size=${text.length}`);
      }
      if (!text.includes('"author"') || text.length < 1000) return;

      const comments = extractComments(text);
      comments.sort((a, b) => (a.createdTime || 0) - (b.createdTime || 0));

      for (const c of comments) {
        totalComments++;
        if (await pushComment(c)) totalPushed++;
      }
    } catch {}
  });

  // ─── Navigate & check login ────────────────────────────────────────────
  console.log("[Dịch vụ đọc comment] Checking login state...");
  await page.goto("https://www.facebook.com", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await sleep(rand(2000, 4000));

  const url = page.url();
  const title = await page.title();
  console.log(`[Dịch vụ đọc comment] After FB.com: url=${url} title=${title}`);

  if (url.includes("login") || title.toLowerCase().includes("log in")) {
    console.log(
      "[Dịch vụ đọc comment] ⚠️ NOT LOGGED IN — please login manually in the browser window",
    );
    console.log(
      "[Dịch vụ đọc comment] Waiting for login... (navigate to facebook.com after login)",
    );

    // Notify Discord
    try {
      await fetch("http://localhost:18789/api/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          channel: "discord",
          channelId: "1492732763609235479",
          message:
            "⚠️ **Dịch vụ đọc comment: Cần đăng nhập Facebook**\nMở browser trên máy chạy crawler và đăng nhập. Session sẽ được lưu vĩnh viễn.",
        }),
      });
    } catch {}

    // Wait for login — check every 5s if URL changed from login page
    while (true) {
      await sleep(5000);
      const currentUrl = page.url();
      if (!currentUrl.includes("login") && !currentUrl.includes("checkpoint")) {
        console.log("[Dịch vụ đọc comment] ✅ Login detected! Profile saved.");
        break;
      }
      console.log("[Dịch vụ đọc comment] Still waiting for login...");
    }

    await sleep(3000);
  }

  console.log("[Dịch vụ đọc comment] ✅ Logged in!");
  await simulateHuman(page);

  // ─── Switch to Page account ─────────────────────────────────────────────
  console.log("[Dịch vụ đọc comment] Switching to Page account...");
  try {
    // Navigate to Business Suite to ensure Page context
    await page.goto(
      `https://business.facebook.com/latest/home?asset_id=${FB_PAGE_ID}`,
      {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      },
    );
    await sleep(rand(3000, 5000));

    const bsUrl = page.url();
    console.log(`[Dịch vụ đọc comment] Business Suite URL: ${bsUrl}`);

    // Check if we're on Business Suite (not redirected to login)
    if (bsUrl.includes("business.facebook.com")) {
      console.log("[Dịch vụ đọc comment] ✅ Switched to Page context via Business Suite");
    } else {
      console.log(
        "[Dịch vụ đọc comment] ⚠️ Could not access Business Suite, continuing anyway...",
      );
    }
  } catch (err) {
    console.log(`[Dịch vụ đọc comment] ⚠️ Business Suite switch failed: ${err.message}`);
  }
  await simulateHuman(page);

  // ─── Navigate to live video ────────────────────────────────────────────
  const videoUrl = await findLiveVideoUrl(page);
  console.log(`[Dịch vụ đọc comment] Opening: ${videoUrl}`);

  await page.goto(videoUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(rand(3000, 6000));

  const afterUrl = page.url();
  console.log(`[Dịch vụ đọc comment] After nav: ${afterUrl}`);

  // Click comments tab
  try {
    await humanClick(page, "text=Bình luận", 5000);
    console.log("[Dịch vụ đọc comment] Clicked Bình luận");
    await sleep(rand(1000, 2000));
  } catch {}

  // Debug page state
  await sleep(3000);
  const pageState = await page.evaluate(() => {
    const btns = Array.from(
      document.querySelectorAll('[role="button"], button, div'),
    )
      .filter((el) => el.textContent.trim())
      .slice(0, 20)
      .map(
        (el) =>
          `${el.tagName}[aria-label="${el.getAttribute("aria-label")}" role="${el.getAttribute("role")}"] "${el.textContent.trim().slice(0, 30)}"`,
      );
    return {
      url: window.location.href,
      title: document.title,
      elements: btns,
      commentsCount: document.querySelectorAll(
        '[data-pagelet*="Comment"], [aria-label*="comment" i]',
      ).length,
    };
  });
  console.log(`[Dịch vụ đọc comment] Page state:`, JSON.stringify(pageState, null, 2));

  console.log("[Dịch vụ đọc comment] Watching for comments...");

  // ─── Main loop ─────────────────────────────────────────────────────────
  let tick = 0;
  let refreshing = false;

  async function refreshComments() {
    if (refreshing) return;
    refreshing = true;
    try {
      const btn = await page.$('div[aria-label="Làm mới"]');
      if (btn) {
        await humanClick(page, 'div[aria-label="Làm mới"]', 3000);
      } else {
        // Only log every 10 ticks to reduce noise
        if (tick % 10 === 0) console.log("[refresh] Làm mới NOT FOUND");
        const fallback = await page.$(
          '[aria-label*="refresh" i], [aria-label*="reload" i]',
        );
        if (fallback) await humanClick(page, fallback, 3000);
      }
    } catch (err) {
      console.error(`[refresh] Error: ${err.message}`);
    }
    refreshing = false;
  }

  async function loop() {
    console.log("[loop] Started");
    while (true) {
      try {
        tick++;
        if (tick % 10 === 0) console.log(`[loop] tick=${tick}`);

        await refreshComments();

        if (rand(1, 3) === 1) await simulateHuman(page);

        if (tick % 30 === 0) {
          console.log(
            `[Dịch vụ đọc comment] Stats: ${totalComments} seen, ${totalPushed} pushed, ${seenCommentIds.size} unique`,
          );
        }

        const delay =
          rand(1, 20) === 1 ? rand(5000, 10000) : gaussRand(2500, 400);
        await sleep(delay);
      } catch (err) {
        console.error(`[loop] Error: ${err.message} at tick ${tick}`);
        await sleep(3000);
      }
    }
  }

  console.log("[Dịch vụ đọc comment] About to start loop...");
  loop().catch((err) => {
    console.error("[loop] Fatal:", err.message);
    process.exit(1);
  });

  // ─── Graceful shutdown ─────────────────────────────────────────────────
  const shutdown = async () => {
    console.log(`[Dịch vụ đọc comment] Shutdown: ${totalPushed} comments pushed`);
    try {
      await context.close();
    } catch {}
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[Dịch vụ đọc comment] Fatal:", err.message);
  process.exit(1);
});

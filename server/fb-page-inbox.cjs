#!/usr/bin/env node
/**
 * Facebook Page Inbox Listener
 * Poll for new messages from Fanpage inbox
 * Usage: node fb-page-inbox.js [interval_seconds] [pageId]
 * 
 * Example:
 *   node fb-page-inbox.js 30 123456789
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const COOKIE_FILE = path.join(__dirname, '../data/fb-cookies.json');
const INBOX_FILE = path.join(__dirname, '../data/fb-page-inbox.json');
const POLL_INTERVAL = (parseInt(process.argv[2]) || 30) * 1000;
const PAGE_ID = process.argv[3] || null;

let lastUnreadCount = 0;

async function loadCookies(context) {
  if (fs.existsSync(COOKIE_FILE)) {
    const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
    await context.addCookies(cookies);
    return true;
  }
  return false;
}

async function checkPageInbox(pageId) {
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  
  await loadCookies(context);
  
  try {
    // Go to page inbox
    const url = pageId 
      ? `https://www.facebook.com/${pageId}/inbox/`
      : `https://www.facebook.com/inbox/`;
    
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    
    // Check if logged in
    if (page.url().includes('login')) {
      console.log('[!] Please login first: node fb-messenger.js login');
      await browser.close();
      return;
    }
    
    // Get conversations
    const messages = await page.evaluate(() => {
      const results = [];
      const items = document.querySelectorAll('[role="listitem"]');
      
      items.forEach(item => {
        const nameEl = item.querySelector('[data-hovercard*="user"]') || item.querySelector('span[dir="ltr"]');
        const previewEl = item.querySelector('[data-sly*="message"] span') || item.querySelector('span[style*="color"]');
        const timeEl = item.querySelector('[data-sly*="time"] span') || item.querySelector('span[data-text="true"]');
        
        if (nameEl) {
          results.push({
            name: nameEl.textContent?.trim() || 'Unknown',
            preview: previewEl?.textContent?.trim() || '',
            time: timeEl?.textContent?.trim() || '',
          });
        }
      });
      
      return results.slice(0, 20);
    });
    
    fs.writeFileSync(INBOX_FILE, JSON.stringify(messages, null, 2));
    
    console.log(`[${new Date().toISOString()}] ${messages.length} conversations`);
    
  } catch (e) {
    console.error('[Error]', e.message);
  }
  
  await browser.close();
}

// Main
console.log(`📱 Facebook Page Inbox Listener`);
console.log(`Poll interval: ${POLL_INTERVAL/1000}s`);
console.log(`Output: ${INBOX_FILE}`);
console.log('\nUsage:');
console.log('  node fb-page-inbox.js 30 123456789');
console.log('  (Replace 123456789 with your fanpage ID)\n');

// Initial check
checkPageInbox(PAGE_ID);

const interval = setInterval(() => checkPageInbox(PAGE_ID), POLL_INTERVAL);

process.on('SIGINT', () => {
  console.log('\n[Stopping...]');
  clearInterval(interval);
  process.exit(0);
});

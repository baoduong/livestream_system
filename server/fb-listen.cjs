#!/usr/bin/env node
/**
 * Facebook Messenger Listener
 * Poll for new messages and save to file
 * Usage: node fb-listen.js [interval_seconds]
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const COOKIE_FILE = path.join(__dirname, '../data/fb-cookies.json');
const INBOX_FILE = path.join(__dirname, '../data/fb-inbox.json');
const POLL_INTERVAL = (parseInt(process.argv[2]) || 30) * 1000; // default 30s

let lastMessageCount = 0;

async function loadCookies(context) {
  if (fs.existsSync(COOKIE_FILE)) {
    const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
    await context.addCookies(cookies);
    return true;
  }
  return false;
}

async function checkInbox() {
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  
  await loadCookies(context);
  
  try {
    await page.goto('https://www.messenger.com/t/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    
    // Get conversations
    const messages = await page.evaluate(() => {
      const items = document.querySelectorAll('[role="listitem"]');
      const results = [];
      
      items.forEach(item => {
        const nameEl = item.querySelector('span[dir="ltr"]') || item.querySelector('span');
        const previewEl = item.querySelector('span[style*="color"]') || item.querySelector('[role="presentation"] span');
        const timeEl = item.querySelector('span[data-text="true"][dir="auto"]');
        const unreadEl = item.querySelector('[aria-label*="unread"]');
        
        if (nameEl) {
          results.push({
            name: nameEl.textContent?.trim() || 'Unknown',
            preview: previewEl?.textContent?.trim() || '',
            time: timeEl?.textContent?.trim() || '',
            unread: !!unreadEl
          });
        }
      });
      
      return results.slice(0, 20);
    });
    
    // Save to file
    fs.writeFileSync(INBOX_FILE, JSON.stringify(messages, null, 2));
    
    // Check for new messages
    const newCount = messages.filter(m => m.unread).length;
    if (newCount !== lastMessageCount && lastMessageCount > 0) {
      console.log(`[${new Date().toISOString()}] 🔔 ${newCount - lastMessageCount} new unread message(s)!`);
      console.log('Unread conversations:', messages.filter(m => m.unread).map(m => m.name).join(', '));
    }
    lastMessageCount = newCount;
    
    console.log(`[${new Date().toISOString()}] Checked: ${messages.length} conversations, ${newCount} unread`);
    
  } catch (e) {
    console.error('[Error]', e.message);
  }
  
  await browser.close();
}

// Main
console.log(`📱 Facebook Messenger Listener`);
console.log(`Poll interval: ${POLL_INTERVAL/1000}s`);
console.log(`Output: ${INBOX_FILE}`);
console.log('Press Ctrl+C to stop\n');

// Initial check
checkInbox();

// Poll loop
const interval = setInterval(checkInbox, POLL_INTERVAL);

process.on('SIGINT', () => {
  console.log('\n[Stopping...]');
  clearInterval(interval);
  process.exit(0);
});

#!/usr/bin/env node
/**
 * Facebook Messenger via Playwright
 * Usage: node fb-messenger.js <command> [options]
 * 
 * Commands:
 *   login           - Login to Facebook (opens browser, you login manually)
 *   send <userId> <message> - Send message to user
 *   inbox           - List recent conversations
 * 
 * First run: node fb-messenger.js login
 * Then you can send messages
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const COOKIE_FILE = path.join(__dirname, '../data/fb-cookies.json');

async function saveCookies(context) {
  const cookies = await context.cookies();
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
  console.log('[✓] Cookies saved to', COOKIE_FILE);
}

async function loadCookies(context) {
  if (fs.existsSync(COOKIE_FILE)) {
    const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
    await context.addCookies(cookies);
    console.log('[✓] Cookies loaded');
    return true;
  }
  return false;
}

async function login() {
  const browser = await chromium.launch({ 
    headless: false,
    args: ['--start-maximized']
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  
  console.log('[FB] Opening Messenger...');
  await page.goto('https://www.messenger.com/', { waitUntil: 'networkidle' });
  
  // Wait for login or check if logged in
  await page.waitForTimeout(3000);
  
  if (page.url().includes('login')) {
    console.log('[FB] Please login manually...');
    await page.waitForURL('**/t/**', { timeout: 120000 });
    console.log('[FB] Logged in!');
  }
  
  await saveCookies(context);
  await browser.close();
  console.log('[✓] Done! You can now send messages.');
}

async function sendMessage(userId, message) {
  const browser = await chromium.launch({ 
    headless: false,
    args: ['--start-maximized']
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  
  // Load cookies
  await loadCookies(context);
  
  console.log(`[FB] Opening conversation with ${userId}...`);
  
  // Try to open conversation directly
  // Note: userId format depends on Facebook (username or userID)
  const url = userId.includes('http') ? userId : `https://www.messenger.com/t/${userId}`;
  await page.goto(url, { waitUntil: 'networkidle' });
  
  // Wait for chat to load
  await page.waitForTimeout(2000);
  
  // Find message input
  const inputSelector = '[contenteditable="true"][role="textbox"]';
  
  try {
    await page.waitForSelector(inputSelector, { timeout: 10000 });
    
    // Type message
    await page.click(inputSelector);
    await page.keyboard.type(message, { delay: 50 });
    
    // Send (press Enter)
    await page.keyboard.press('Enter');
    
    console.log(`[✓] Message sent: ${message}`);
  } catch (e) {
    console.error('[✗] Could not send message. Page may not be fully loaded.');
    console.log('[URL]:', page.url());
  }
  
  await browser.close();
}

async function listInbox() {
  const browser = await chromium.launch({ 
    headless: false,
    args: ['--start-maximized']
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  
  await loadCookies(context);
  
  console.log('[FB] Opening inbox...');
  await page.goto('https://www.messenger.com/t/', { waitUntil: 'networkidle' });
  
  // Wait for conversations to load
  await page.waitForTimeout(3000);
  
  // Get conversation list
  const conversations = await page.evaluate(() => {
    const items = document.querySelectorAll('[role="listitem"] a[href*="/t/"]');
    return Array.from(items).slice(0, 10).map(a => ({
      name: a.querySelector('span')?.textContent || 'Unknown',
      url: a.href
    }));
  });
  
  console.log('\n[Recent Conversations]');
  conversations.forEach((c, i) => {
    console.log(`${i + 1}. ${c.name} - ${c.url}`);
  });
  
  await browser.close();
}

// Main
const cmd = process.argv[2];
const arg1 = process.argv[3];
const arg2 = process.argv[4];

switch (cmd) {
  case 'login':
    login();
    break;
  case 'send':
    if (!arg1 || !arg2) {
      console.log('Usage: node fb-messenger.js send <userId> <message>');
      process.exit(1);
    }
    sendMessage(arg1, arg2);
    break;
  case 'inbox':
    listInbox();
    break;
  default:
    console.log(`
📱 Facebook Messenger via Playwright

Usage: node fb-messenger.js <command> [options]

Commands:
  login              - Login to Facebook (first time only)
  send <userId> <msg> - Send message to user
  inbox              - List recent conversations

Examples:
  node fb-messenger.js login
  node fb-messenger.js send 100000123456789 "Xin chào!"
  node fb-messenger.js inbox
`);
}

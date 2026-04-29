import { chromium } from "playwright";

const ctx = chromium.launchPersistentContext('data/browser-profile', {
  headless: false,
  viewport: {
    width: 1440,
    height: 890
  }
});

console.log('Browser Openned!!')

await new Promise(()=>{})

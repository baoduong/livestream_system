// Post to Facebook Page via Graph API
// Usage:
//   node server/fb-post.js "Nội dung bài viết"
//   node server/fb-post.js --file post.txt
//   node server/fb-post.js --message "text" --link "https://..."

import { config } from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, "../.env") });

const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN;
const FB_PAGE_ID = process.env.FB_PAGE_ID || "107811450656942";

if (!FB_PAGE_TOKEN) {
  console.error("❌ Missing FB_PAGE_TOKEN in .env");
  process.exit(1);
}

const args = process.argv.slice(2);
const getArg = (name) => {
  console.log("name:", name);
  const idx = args.indexOf(name);
  if (
    name === "--file" ||
    name === "-f" ||
    name === "--image" ||
    name === "-i"
  ) {
    return (idx >= 0 && args.slice(idx + 1)) || [];
  }
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
};

let message = getArg("--message") || getArg("-m");
const link = getArg("--link") || getArg("-l");
const filePaths = getArg("--file") || getArg("-f");
const base64Images = getArg("--image") || getArg("-i");

// Read from file
/* if (filePaths) {
  for (const filePath of filePaths) {
    const fullPath = path.resolve(filePath);
    if (!fs.existsSync(fullPath)) {
      console.error("❌ File not found:", fullPath);
      process.exit(1);
    }
    message += fs.readFileSync(fullPath, "utf8").trim();
  }
} */

// Fallback: first non-flag argument
if (!message) {
  message = args.filter((a) => !a.startsWith("-")).join(" ");
}

if (!message) {
  console.log(`
📝 Facebook Page Post

Usage:
  node server/fb-post.js "Nội dung bài viết"
  node server/fb-post.js --message "text" --link "https://..."
  node server/fb-post.js --file post.txt

Options:
  --message, -m    Post message text
  --link, -l       Attach a link
  --file, -f       Read message from file
`);
  process.exit(0);
}

async function uploadImage(blobImage, fileName) {
  const formData = new FormData();
  formData.append("source", (blobImage, { type: "image/jpeg" }), imageName);
  formData.append("caption", fileName);
  formData.append("published", false);
  formData.append("access_token", FB_PAGE_TOKEN);

  const resp = await fetch(
    `https://graph.facebook.com/v22.0/${FB_PAGE_ID}/photos`,
    {
      method: "POST",
      body: formData,
    },
  );
  return resp.json();
}

async function postToPage() {
  const body = { message };
  const attached_media = [];
  if (link) body.link = link;

  console.log(`📝 Posting to Page ${FB_PAGE_ID}...`);
  console.log(
    `   Message: ${message.slice(0, 100)}${message.length > 100 ? "..." : ""}`,
  );

  if (link) console.log(`   Link: ${link}`);

  if (filePaths) {
    console.log("filePaths", Array.isArray(filePaths));

    try {
      for (const imagePath of filePaths) {
        const imageData = fs.readFileSync(imagePath);
        const blobImage = new Blob([imageData]);
        const res = await uploadImage(blobImage);
        attached_media.push({ media_fbid: res.id });
      }
    } catch (err) {
      console.log("There is error during upload image");
      console.error(err);
    }
  }

  if (attached_media.length > 0) {
    body.attached_media = attached_media;
  }

  const __body = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${FB_PAGE_ID}/feed?access_token=${FB_PAGE_TOKEN}`,
    __body,
  );

  const data = await res.json();

  if (data.error) {
    console.error(`❌ Error: ${data.error.message}`);
    console.error(`   Code: ${data.error.code}, Type: ${data.error.type}`);
    process.exit(1);
  }

  console.log(`✅ Posted! ID: ${data.id}`);
  console.log(`   URL: https://facebook.com/${data.id}`);
  return data;
}

postToPage().catch((err) => {
  console.error("❌ Fatal:", err.message);
  process.exit(1);
});

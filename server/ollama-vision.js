// Ollama Vision API wrapper
// Usage: node server/ollama-vision.js "Describe this image" image.jpg
import ollama  from "ollama";
import { argv } from "process";

// const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
// const MODEL = process.env.OLLAMA_VISION_MODEL || "gemma4:31b-cloud";
const MODEL = "gemma4:31b-cloud"

const prompt = argv[2] || "Mô tả chi tiết ảnh.";
const imagePath = argv[3];

if (!imagePath) {
  console.error('Usage: node ollama-vision.js "<prompt>" <image-path>');
  process.exit(1);
}

const payload = {
  model: MODEL,
  messages: [
    {
      role: "user",
      content: prompt,
    },
  ],
  stream: false,
  images: [imagePath],
  options: {
    temperature: 0,
  },
};

const result = await ollama.chat(payload);

console.log(result.message?.content || result.error || JSON.stringify(result));

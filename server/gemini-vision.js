// Gemini Vision API - Simple wrapper
import { readFileSync } from 'fs'

const GOOGLE_API_KEY = 'AIzaSyBfP1RE4ZW7If1slOLY-fdRsAPFZnJVPqA'
const IMAGE_PATH = process.argv[2] || '/Users/baoduong2/.openclaw/media/inbound/f1691201-c296-46b2-9b7a-6759850ce2cb.png'
const PROMPT = process.argv[3] || 'Mô tả chi tiết ảnh này: loại vải gì, màu sắc, hoa văn, kích thước'

const imageBase64 = readFileSync(IMAGE_PATH).toString('base64')

const payload = {
  contents: [{
    parts: [
      { text: PROMPT },
      { inlineData: { mimeType: 'image/png', data: imageBase64 } }
    ]
  }],
  generationConfig: { temperature: 0.7 }
}

const response = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_API_KEY}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }
)

const result = await response.json()
if (result.error) {
  console.error('ERROR:', result.error.message)
  process.exit(1)
}

console.log(result.candidates?.[0]?.content?.parts?.[0]?.text || JSON.stringify(result))
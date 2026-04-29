#!/usr/bin/env python3
"""
Faster-Whisper transcription server.
Usage:
  # CLI mode:
  python3 whisper-server.py /path/to/audio.ogg
  
  # HTTP server mode:
  python3 whisper-server.py --serve [--port 5555]
  POST /transcribe  body: {"file": "/path/to/audio.ogg"} or multipart file upload
"""

import sys
import os
import json
import argparse
from faster_whisper import WhisperModel

# Global model (loaded once)
_model = None

def get_model():
    global _model
    if _model is None:
        print("[whisper] Loading medium model...", file=sys.stderr)
        _model = WhisperModel("medium", device="cpu", compute_type="int8")
        print("[whisper] Model loaded.", file=sys.stderr)
    return _model

def transcribe(file_path):
    """Transcribe audio file, return text."""
    if not os.path.exists(file_path):
        return {"error": f"File not found: {file_path}"}
    
    model = get_model()
    segments, info = model.transcribe(file_path, language="vi", beam_size=5, vad_filter=True)
    
    text_parts = []
    for segment in segments:
        text_parts.append(segment.text.strip())
    
    full_text = " ".join(text_parts).strip()
    
    return {
        "text": full_text,
        "language": info.language,
        "language_probability": round(info.language_probability, 3),
        "duration": round(info.duration, 2),
    }

def run_server(port=5555):
    """Run HTTP transcription server."""
    from http.server import HTTPServer, BaseHTTPRequestHandler
    import tempfile
    
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/health":
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"status": "ok", "model": "medium"}).encode())
            else:
                self.send_response(404)
                self.end_headers()
        
        def do_POST(self):
            if self.path != "/transcribe":
                self.send_response(404)
                self.end_headers()
                return
            
            content_type = self.headers.get("Content-Type", "")
            content_length = int(self.headers.get("Content-Length", 0))
            
            if "application/json" in content_type:
                body = json.loads(self.rfile.read(content_length))
                file_path = body.get("file", "")
                result = transcribe(file_path)
            elif "multipart/form-data" in content_type:
                # Simple multipart handling
                import cgi
                form = cgi.FieldStorage(
                    fp=self.rfile,
                    headers=self.headers,
                    environ={"REQUEST_METHOD": "POST", "CONTENT_TYPE": content_type}
                )
                file_item = form["file"]
                with tempfile.NamedTemporaryFile(suffix=".ogg", delete=False) as tmp:
                    tmp.write(file_item.file.read())
                    tmp_path = tmp.name
                result = transcribe(tmp_path)
                os.unlink(tmp_path)
            else:
                result = {"error": "Unsupported Content-Type"}
            
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(result, ensure_ascii=False).encode())
        
        def log_message(self, format, *args):
            print(f"[whisper-server] {args[0]}", file=sys.stderr)
    
    server = HTTPServer(("127.0.0.1", port), Handler)
    print(f"[whisper] Server running on http://127.0.0.1:{port}", file=sys.stderr)
    print(f"[whisper] Endpoints: GET /health, POST /transcribe", file=sys.stderr)
    
    # Pre-load model
    get_model()
    
    server.serve_forever()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Faster-Whisper transcription")
    parser.add_argument("file", nargs="?", help="Audio file to transcribe")
    parser.add_argument("--serve", action="store_true", help="Run as HTTP server")
    parser.add_argument("--port", type=int, default=5555, help="Server port (default: 5555)")
    args = parser.parse_args()
    
    if args.serve:
        run_server(args.port)
    elif args.file:
        result = transcribe(args.file)
        print(json.dumps(result, ensure_ascii=False))
    else:
        parser.print_help()

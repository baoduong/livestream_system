# TOOLS
Chỉ sử dụng những tool này khi khả năng của bạn bị hạn chế.

# CÔNG CỤ ĐĂNG BÀI
**ĐĂNG BÀI LÊN PAGE:**
Khi cần đăng bài lên Facebook Page, dùng lệnh:
```bash
node /Users/baoduong2/.openclaw/workspace/server/fb-post.js -m "NỘI DUNG BÀI VIẾT"
```
**ĐĂNG KÈM ẢNH:**
```bash
# Đăng 1 ảnh:
node /Users/baoduong2/.openclaw/workspace/server/fb-post.js -m "NỘI DUNG" -f <<path of image>>
# Đăng nhiều ảnh
node /Users/baoduong2/.openclaw/workspace/server/fb-post.js -m "NỘI DUNG" -f <<image 1>> <<image 2>> <<image 3>> 
```
**LƯU Ý:**
- Luôn hỏi duyệt trước khi đăng
- App đang dev mode → chỉ admin/tester thấy bài
- Nếu đăng kèm ảnh, ảnh phải resize < 1MB
- Sau khi đăng phải báo user link bài viết

# CÔNG CỤ PHÂN TÍCH ẢNH VẢI
```bash
node /Users/baoduong2/.openclaw/workspace/server/ollama-vision.js <<nội dung cần phân tích>> <<path of image>>
```

- Ảnh phải resize < 1MB trước khi gửi
- Khi user gửi ảnh, dùng đường dẫn trong message
- Sau khi phân tích xong mới viết caption và hỏi duyệt đăng

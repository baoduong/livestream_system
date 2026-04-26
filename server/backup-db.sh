#!/bin/bash
# Backup SQLite database daily
# Giữ 7 bản backup gần nhất

WORKSPACE="/Users/baoduong2/.openclaw/workspace"
DB_FILE="$WORKSPACE/data/livestream.db"
BACKUP_DIR="$WORKSPACE/data/backups"
DATE=$(date '+%Y-%m-%d')

mkdir -p "$BACKUP_DIR"

# SQLite safe backup (không lock DB)
sqlite3 "$DB_FILE" ".backup '$BACKUP_DIR/livestream-$DATE.db'"

echo "[backup] $(date '+%H:%M:%S') → $BACKUP_DIR/livestream-$DATE.db"

# Xóa backup cũ hơn 7 ngày
find "$BACKUP_DIR" -name "livestream-*.db" -mtime +7 -delete

echo "[backup] Done. Kept last 7 days."

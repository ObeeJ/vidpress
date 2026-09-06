#!/bin/bash
# vidpress cleanup — delete output files older than 24h
# Add to crontab: 0 * * * * /home/obeej/projects/vidpress/cleanup.sh >> /tmp/vidpress-cleanup.log 2>&1

STORAGE="${VIDPRESS_STORAGE:-/tmp/vidpress_output}"
DB="${VIDPRESS_DB:-/tmp/vidpress.db}"

echo "[$(date)] Starting cleanup..."

# Delete files older than 24h
find "$STORAGE" -type f -mmin +1440 -delete
echo "[$(date)] Deleted old output files"

# Mark stale jobs as failed in DB (processing > 2h = stuck)
python3 - <<'EOF'
import sqlite3, time
conn = sqlite3.connect("$DB")
stale = int(time.time()) - 7200
conn.execute("UPDATE jobs SET status='failed' WHERE status='processing' AND created_at < ?", (stale,))
conn.commit()
print(f"Marked stale jobs as failed")
conn.close()
EOF

# Delete /tmp ingest files older than 2h
find /tmp -name "vidpress_*" -type f -mmin +120 -delete
echo "[$(date)] Cleanup done"

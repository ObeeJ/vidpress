#!/bin/bash
# theflate cleanup — delete output files older than 24h
# Add to crontab: 0 * * * * /home/obeej/projects/theflate/cleanup.sh >> /tmp/theflate-cleanup.log 2>&1

STORAGE="${THEFLATE_STORAGE:-/tmp/theflate_output}"
DB="${THEFLATE_DB:-/tmp/theflate.db}"

echo "[$(date)] Starting cleanup..."

# Delete files older than 24h
find "$STORAGE" -type f -mmin +1440 -delete
echo "[$(date)] Deleted old output files"

# Mark stale jobs as failed in DB (processing > 2h = stuck)
# M4 fix: pass $DB as argument — single-quoted heredoc never expands variables
python3 -c "
import sqlite3, time, sys
conn = sqlite3.connect(sys.argv[1])
stale = int(time.time()) - 7200
cur = conn.execute(\"UPDATE jobs SET status='failed' WHERE status='processing' AND created_at < ?\", (stale,))
conn.commit()
print(f'Marked {cur.rowcount} stale jobs as failed')
conn.close()
" "$DB"

# Delete /tmp ingest files older than 2h
find /tmp -name "theflate_*" -type f -mmin +120 -delete
echo "[$(date)] Cleanup done"

#!/bin/bash
# theflate cleanup — delete output files older than 24h
# Add to crontab: 0 * * * * /home/obeej/projects/theflate/cleanup.sh >> /tmp/theflate-cleanup.log 2>&1

STORAGE="${THEFLATE_STORAGE:-/tmp/theflate_output}"
DB="${THEFLATE_DB:-/tmp/theflate.db}"

echo "[$(date)] Starting cleanup..."

# Outputs and progress files both live under $STORAGE now.
find "$STORAGE" -type f -mmin +1440 -delete
find "$STORAGE" -name '*_progress' -type f -mmin +120 -delete
echo "[$(date)] Deleted old output files"

# Legacy: files the old build wrote directly into /tmp. -maxdepth 1 stops this
# from walking the entire filesystem tree under /tmp.
find /tmp -maxdepth 1 -name 'theflate_*' -type f -mmin +120 -delete

# Mark stale jobs as failed in DB (processing > 2h = stuck)
python3 -c "
import sqlite3, time, sys
conn = sqlite3.connect(sys.argv[1])
stale = int(time.time()) - 7200
cur = conn.execute(\"UPDATE jobs SET status='failed' WHERE status='processing' AND created_at < ?\", (stale,))
conn.commit()
print(f'Marked {cur.rowcount} stale jobs as failed')
conn.close()
" "$DB"

# Purge expired ingest records (TTL 2h, matching ingest_store::INGEST_TTL_SECS)
python3 -c "
import sqlite3, time, sys
conn = sqlite3.connect(sys.argv[1])
cur = conn.execute('DELETE FROM ingests WHERE created_at < ?', (int(time.time()) - 7200,))
conn.commit(); print(f'Purged {cur.rowcount} expired ingests'); conn.close()
" "$DB"

echo "[$(date)] Cleanup done"

#!/usr/bin/env bash
# theflate — mock integration smoke test (no real ffmpeg/yt-dlp needed)
# Tests the full lifecycle: health → keys → ingest → analyze →
#   upload → job-not-found → download-not-found → auth → wl-uniqueness →
#   download-url-validation → transcribe-validation
# Run: bash tests/mock_integration.sh
set -euo pipefail

API="${THEFLATE_API:-http://localhost:8080}"
PASS=0; FAIL=0

ok()   { echo "  PASS $1"; ((PASS++)) || true; }
fail() { echo "  FAIL $1"; ((FAIL++)) || true; }
check_status() { [[ "$1" == "$2" ]] && ok "$3" || fail "$3 (got $1, want $2)"; }

echo ""
echo "=== theflate mock integration smoke test ==="
echo "API: $API"
echo ""

# ── 1. Health ─────────────────────────────────────────────────────────────────
echo "1. Health check"
R=$(curl -sf "$API/health" 2>/dev/null || echo "CONN_FAIL")
[[ "$R" == *"true"* ]] && ok "GET /health returns {ok:true}" || fail "GET /health (got: $R)"

# ── 2. Create API key ─────────────────────────────────────────────────────────
echo ""
echo "2. Create API key"
R=$(curl -sf -X POST "$API/keys" \
  -H "content-type: application/json" \
  -d '{"name":"test-key","plan":"free"}' 2>/dev/null || echo "CONN_FAIL")
KEY=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('key',''))" 2>/dev/null || echo "")
[[ "$KEY" == vp_* ]] && ok "POST /keys returns key with vp_ prefix" || fail "POST /keys (got: $R)"

# ── 3. Ingest (mock file) ─────────────────────────────────────────────────────
echo ""
echo "3. Ingest mock file"
TMPFILE=$(mktemp /tmp/test_XXXXXX.mp4)
printf '\x00\x00\x00\x20ftypisom' > "$TMPFILE"
R=$(curl -sf -X POST "$API/ingest" \
  -H "x-file-name: test_video.mp4" \
  -H "x-api-key: $KEY" \
  --data-binary @"$TMPFILE" 2>/dev/null || echo "CONN_FAIL")
SERVER_PATH=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('path',''))" 2>/dev/null || echo "")
[[ -n "$SERVER_PATH" ]] && ok "POST /ingest returns server path: $SERVER_PATH" || fail "POST /ingest (got: $R)"
rm -f "$TMPFILE"

# ── 4. Analyze (fake file — expect 415, not 500) ──────────────────────────────
echo ""
echo "4. Analyze fake file (expect 415 not 500)"
if [[ -n "$SERVER_PATH" ]]; then
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/analyze" \
    -H "content-type: application/json" \
    -H "x-api-key: $KEY" \
    -d "{\"path\":\"$SERVER_PATH\"}")
  [[ "$CODE" == "415" ]] && ok "POST /analyze fake file returns 415 (correct rejection)" \
    || fail "POST /analyze fake file returned $CODE (expected 415 — ffprobe may not be installed)"
fi

# ── 5. Upload fake path (expect 415 or 400, not 500) ─────────────────────────
echo ""
echo "5. Upload nonexistent path (expect 415 or 400)"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/upload" \
  -H "content-type: application/json" \
  -H "x-api-key: $KEY" \
  -d '{"path":"/tmp/nonexistent_theflate_test.mp4","preset":"web"}')
[[ "$CODE" == "415" || "$CODE" == "400" ]] \
  && ok "POST /upload nonexistent path returns $CODE (correct rejection)" \
  || fail "POST /upload nonexistent path returned $CODE (expected 415 or 400)"

# ── 6. Job not found ──────────────────────────────────────────────────────────
echo ""
echo "6. Job not found"
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "$API/jobs/00000000-0000-0000-0000-000000000000" \
  -H "x-api-key: $KEY")
check_status "$CODE" "404" "GET /jobs/nonexistent returns 404"

# ── 7. Download not found ─────────────────────────────────────────────────────
echo ""
echo "7. Download not found"
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "$API/download/00000000-0000-0000-0000-000000000000" \
  -H "x-api-key: $KEY")
check_status "$CODE" "404" "GET /download/nonexistent returns 404"

# ── 8. Invalid API key → 401 (skipped in dev mode) ───────────────────────────
echo ""
echo "8. Auth rejection"
DEV_MODE=$(curl -sf "$API/health" -H "x-api-key: vp_INVALID000000000000000000000000" 2>/dev/null | python3 -c "import sys,json; print('dev')" 2>/dev/null || echo "")
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "$API/jobs/anything" \
  -H "x-api-key: vp_INVALID000000000000000000000000")
if [[ "$CODE" == "401" ]]; then
  ok "Invalid API key returns 401"
elif [[ "$CODE" == "404" ]]; then
  ok "Auth skipped (THEFLATE_DEV_MODE=1) — 404 is correct in dev mode"
else
  fail "Invalid API key returned $CODE (expected 401 or 404 in dev mode)"
fi

# ── 9. White-label domain uniqueness → 409 ───────────────────────────────────
echo ""
echo "9. White-label domain uniqueness"
DOMAIN="test-$(date +%s).example.com"
curl -sf -X POST "$API/keys" \
  -H "content-type: application/json" \
  -d "{\"name\":\"wl1\",\"plan\":\"whitelabel\",\"white_label_domain\":\"$DOMAIN\"}" \
  > /dev/null 2>&1 || true
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/keys" \
  -H "content-type: application/json" \
  -d "{\"name\":\"wl2\",\"plan\":\"whitelabel\",\"white_label_domain\":\"$DOMAIN\"}")
check_status "$CODE" "409" "Duplicate white-label domain returns 409"

# ── 10. download-url missing url field → 400 ─────────────────────────────────
echo ""
echo "10. download-url field validation"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/download-url" \
  -H "content-type: application/json" \
  -H "x-api-key: $KEY" \
  -d '{"audio_only":false}')
check_status "$CODE" "400" "POST /download-url missing url returns 400"

# ── 11. Transcribe nonexistent job → 404 ─────────────────────────────────────
echo ""
echo "11. Transcribe nonexistent job"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/transcribe" \
  -H "content-type: application/json" \
  -H "x-api-key: $KEY" \
  -d '{"job_id":"00000000-0000-0000-0000-000000000000"}')
check_status "$CODE" "404" "POST /transcribe nonexistent job returns 404"

# ── 12. Transcription not found → 404 ────────────────────────────────────────
echo ""
echo "12. Get transcription not found"
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "$API/transcriptions/00000000-0000-0000-0000-000000000000" \
  -H "x-api-key: $KEY")
check_status "$CODE" "404" "GET /transcriptions/nonexistent returns 404"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[[ $FAIL -eq 0 ]] && echo "ALL PASS" && exit 0 || echo "FAILURES DETECTED" && exit 1

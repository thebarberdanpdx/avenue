#!/usr/bin/env bash
# Uptime probe for the Vero watchdog (see .github/workflows/uptime-check.yml).
# Checks one URL, retrying a few times so a single transient blip never cries wolf.
# Exit 0 = healthy. Exit 1 fails the workflow → GitHub emails the repo owner.
set -u
URL="$1"; EXPECT="$2"; LABEL="$3"
CODE="000"
for i in 1 2 3; do
  CODE=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 25 "$URL" 2>/dev/null)
  CODE="${CODE:-000}"
  if [ "$CODE" = "$EXPECT" ]; then echo "OK: $LABEL responded $CODE"; exit 0; fi
  echo "attempt $i/3: $LABEL responded $CODE (expected $EXPECT) — retrying…"
  [ "$i" -lt 3 ] && sleep 15
done
echo "::error::$LABEL is DOWN — last response $CODE, expected $EXPECT. Vero may be unreachable to clients right now."
exit 1

#!/bin/bash
set -e
for tid in "$@"; do
  ISSUE_ID=$(curl -sS https://api.linear.app/graphql -H "Authorization: $LINEAR_API_KEY" -H "Content-Type: application/json" -d "{\"query\":\"{issue(id:\\\"$tid\\\"){id}}\"}" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>process.stdout.write(JSON.parse(d).data?.issue?.id||""))')
  if [ -z "$ISSUE_ID" ]; then
    echo "$tid: not found"
    continue
  fi
  sed "s/ID_PLACEHOLDER/$ISSUE_ID/" .linear/update.json > /tmp/upd.json
  RESULT=$(curl -sS https://api.linear.app/graphql -H "Authorization: $LINEAR_API_KEY" -H "Content-Type: application/json" --data @/tmp/upd.json)
  echo "$tid: $RESULT" | head -c 200
  echo
done

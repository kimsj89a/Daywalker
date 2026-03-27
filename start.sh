#!/bin/sh
# Volume이 비어있으면 seed 데이터 복사
if [ ! -f /app/data/projects.json ]; then
  echo "Seeding projects.json from backup..."
  cp /app/seed/projects.json /app/data/projects.json
fi
exec node server.js

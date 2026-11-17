#!/bin/sh
set -eu
cd "$(dirname "$0")"
port=${HELMET_PORT:-8765}
host=${HELMET_HOST:-127.0.0.1}
case "$host" in 0.0.0.0) host=127.0.0.1 ;; esac
url="http://$host:$port/"
ready() {
    curl -fsS --max-time 2 "$url" 2>/dev/null | grep -Fq '园区骑行治理'
}
if ready; then
    open "$url"
    exit 0
fi
launcher_pid=$$
(
    for attempt in $(seq 1 20); do
        kill -0 "$launcher_pid" 2>/dev/null || exit 0
        if ready; then open "$url"; exit 0; fi
        sleep 1
    done
) &
exec ./scripts/start.sh

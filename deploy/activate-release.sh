#!/usr/bin/env bash
set -euo pipefail
release=${1:?Pass an absolute release directory}
case "$release" in /opt/classroom-mic/releases/*) ;; *) exit 2 ;; esac
test -f "$release/server/index.mjs"
test -f "$release/dist/index.html"
previous=$(readlink -f /opt/classroom-mic/current 2>/dev/null || true)
sudo systemd-analyze verify "$release/deploy/classroom-mic.service"
if ! sudo test -e /etc/classroom-mic.env; then
  sudo install -m 600 /dev/null /etc/classroom-mic.env
  sudo tee /etc/classroom-mic.env > /dev/null <<'ENV'
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
PUBLIC_URL=https://classroom-mic.beringtech.com
TRUST_PROXY=1
MAX_ROOMS=100
MAX_STUDENTS=300
ENV
fi
sudo install -m 644 "$release/deploy/classroom-mic.service" /etc/systemd/system/classroom-mic.service
sudo systemctl daemon-reload
rollback() {
  sudo systemctl stop classroom-mic || true
  if test -n "$previous" && test -f "$previous/server/index.mjs"; then
    ln -sfn "$previous" /opt/classroom-mic/current
    sudo systemctl start classroom-mic
  else
    sudo systemctl disable classroom-mic || true
    sudo systemctl enable --now classroom-mic-placeholder
  fi
}
trap rollback ERR
ln -sfn "$release" /opt/classroom-mic/current.next
mv -Tf /opt/classroom-mic/current.next /opt/classroom-mic/current
sudo systemctl disable --now classroom-mic-placeholder
sudo systemctl enable classroom-mic
sudo systemctl restart classroom-mic
healthy=0
for attempt in {1..40}; do
  if curl -fsS --max-time 2 http://127.0.0.1:3000/healthz > /dev/null; then healthy=1; break; fi
  sleep .25
done
test "$healthy" = 1
curl -fsS --max-time 5 --resolve classroom-mic.beringtech.com:443:127.0.0.1 https://classroom-mic.beringtech.com/healthz
sudo systemctl is-active classroom-mic caddy
sudo systemctl is-enabled classroom-mic
trap - ERR

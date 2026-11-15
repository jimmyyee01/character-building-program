#!/bin/bash
# Deploys the Character Building Program to this VPS.
#   bash deploy-vps.sh /tmp/cbp-deploy.zip
# Node.js runs on port 3000 behind its own systemd service; existing services
# (nginx on 80/443, raw-switch, onomondo on 8080) are left untouched.
set -e

APP_DIR=/var/www/character-building-program
ZIP="${1:-/tmp/cbp-deploy.zip}"
PORT="${2:-3000}"

echo "==> Node.js"
if ! command -v node >/dev/null 2>&1; then
  echo "   not installed - adding Node 20 from NodeSource"
  curl -fsSL https://deb.nodesource.com/setup_20.x -o /tmp/nodesource.sh || true
  if [ -s /tmp/nodesource.sh ]; then
    bash /tmp/nodesource.sh >/dev/null 2>&1 || true
    apt-get install -y nodejs >/dev/null 2>&1 || true
  fi
fi
if ! command -v node >/dev/null 2>&1; then
  echo "   NodeSource failed - using the official Node 20 tarball"
  curl -fsSL https://nodejs.org/dist/v20.18.1/node-v20.18.1-linux-x64.tar.xz -o /tmp/node.tar.xz
  mkdir -p /opt/node20
  tar -xJf /tmp/node.tar.xz -C /opt/node20 --strip-components=1
  ln -sf /opt/node20/bin/node /usr/local/bin/node
  ln -sf /opt/node20/bin/npm /usr/local/bin/npm
  ln -sf /opt/node20/bin/npx /usr/local/bin/npx
fi
NODE_BIN=$(command -v node)
echo "   node: $NODE_BIN"
$NODE_BIN -v
npm -v

echo "==> Extracting the application into $APP_DIR"
mkdir -p "$APP_DIR"
# a live learner database and uploaded media survive a redeploy
if [ -d "$APP_DIR/data" ]; then rm -rf /tmp/cbp-data-backup; cp -a "$APP_DIR/data" /tmp/cbp-data-backup; fi
if [ -d "$APP_DIR/uploads" ]; then rm -rf /tmp/cbp-uploads-backup; cp -a "$APP_DIR/uploads" /tmp/cbp-uploads-backup; fi
find "$APP_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
unzip -q -o "$ZIP" -d "$APP_DIR"
if [ -d /tmp/cbp-data-backup ]; then mv /tmp/cbp-data-backup "$APP_DIR/data"; fi
if [ -d /tmp/cbp-uploads-backup ]; then mv /tmp/cbp-uploads-backup "$APP_DIR/uploads"; fi
mkdir -p "$APP_DIR/data" "$APP_DIR/uploads"
chmod -R 755 "$APP_DIR"

echo "==> Dependencies"
cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund 2>&1 | tail -3

echo "==> systemd service (port $PORT)"
cat > /etc/systemd/system/character-building.service <<'SVC'
[Unit]
Description=Character Building Program (Node.js)
After=network.target

[Service]
Type=simple
WorkingDirectory=/var/www/character-building-program
Environment=NODE_ENV=production
Environment=PORT=PORT_PLACEHOLDER
ExecStart=NODE_PLACEHOLDER server/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SVC
sed -i "s|NODE_PLACEHOLDER|$NODE_BIN|" /etc/systemd/system/character-building.service
sed -i "s|PORT_PLACEHOLDER|$PORT|" /etc/systemd/system/character-building.service

systemctl daemon-reload
systemctl enable character-building.service >/dev/null 2>&1
systemctl restart character-building.service
sleep 4
systemctl status character-building.service --no-pager | head -12 || true

echo "==> Firewall"
if command -v ufw >/dev/null 2>&1; then ufw allow "$PORT"/tcp >/dev/null 2>&1 || true; fi
if command -v firewall-cmd >/dev/null 2>&1; then firewall-cmd --add-port="$PORT"/tcp --permanent >/dev/null 2>&1 || true; firewall-cmd --reload >/dev/null 2>&1 || true; fi

echo "==> Verifying"
curl -s -o /dev/null -w "health HTTP %{http_code}\n" "http://127.0.0.1:$PORT/api/health" || echo CURL_FAILED
curl -s "http://127.0.0.1:$PORT/api/health" | head -c 400; echo
echo "==> Done. Open http://<server-ip>:$PORT/"

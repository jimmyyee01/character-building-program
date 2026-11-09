#!/bin/bash
set -e

REMOTEDIR="/var/www/raw-switch-iot"

echo "==> Creating folder and extracting..."
mkdir -p "$REMOTEDIR"
cd "$REMOTEDIR"
rm -rf *
unzip -o /tmp/raw-switch-iot.zip
rm /tmp/raw-switch-iot.zip
chmod -R 755 "$REMOTEDIR"
ls -la

echo "==> Installing systemd service..."
cat > /etc/systemd/system/raw-switch.service <<'SVC'
[Unit]
Description=RAW-Switch IoT Connectivity Platform
After=network.target

[Service]
Type=simple
WorkingDirectory=/var/www/raw-switch-iot
ExecStart=/usr/bin/python3 -m http.server 80 --bind 0.0.0.0 --directory /var/www/raw-switch-iot
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SVC

systemctl daemon-reload
systemctl enable raw-switch.service
systemctl restart raw-switch.service
systemctl status raw-switch.service --no-pager | head -15

if command -v ufw >/dev/null 2>&1; then ufw allow 80/tcp || true; fi
if command -v firewall-cmd >/dev/null 2>&1; then firewall-cmd --add-port=80/tcp --permanent || true; firewall-cmd --reload || true; fi

echo "Service installed and running"

echo "==> Verifying..."
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/ || echo CURL_FAILED
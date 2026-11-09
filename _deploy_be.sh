#!/bin/bash
set -e
systemctl restart sim-aggregator
sleep 4
systemctl is-active sim-aggregator
echo "--- catalog ---"
curl -s http://127.0.0.1:8000/sims/catalog | head -c 200
echo
echo "--- summary ---"
curl -s http://127.0.0.1:8000/sims/summary
echo
echo "--- errors ---"
journalctl -u sim-aggregator -n 12 --no-pager | tail -12
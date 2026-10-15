#!/usr/bin/env bash
# Restart whatever backend is answering this deployment.
#
#   bash tools/restart-backend.sh            # shows the plan, changes nothing
#   sudo bash tools/restart-backend.sh --yes # does it, then verifies
#
# It finds the process serving THIS folder (Node under pm2/systemd/started by
# hand, or a `php -S` dev server) by looking at /proc; if there is none, it looks
# for PHP-FPM and apache2/httpd/nginx instead. Then it restarts just that, and
# asks /api/health what build is answering.
set -u

APPLY=0
for a in "$@"; do [ "$a" = "--yes" ] && APPLY=1; done
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

say() { printf '%s\n' "$*"; }
act() {                       # act "command" — runs it only with --yes
  if [ "$APPLY" = 1 ]; then say "  + $*"; sh -c "$*" || say "  (!) that failed: $*"
  else say "  would: $*"; fi
}

say '== restart-backend ========================================='
say "folder : $ROOT"
say "commit : $(git -C "$ROOT" log --oneline -1 2>/dev/null || echo '(not a git checkout)')"
[ "$APPLY" = 1 ] || say 'mode   : dry run — add --yes to actually restart'
say ''

acted=0
if [ -d /proc ]; then
  for pid in $(ps -eo pid=,args= 2>/dev/null | grep -E 'node|php -S' | grep -v grep \
               | grep -v 'restart-backend' | awk '{print $1}'); do
    args="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null)"
    case "$args" in *server/server.js*|*'php -S'*) ;; *) continue ;; esac
    cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || true)"
    case "$args" in *"$ROOT"*) ;; *) [ "$cwd" = "$ROOT" ] || continue ;; esac

    ppid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"
    pcmd="$(ps -o args= -p "${ppid:-0}" 2>/dev/null || true)"
    say "backend process: pid $pid"
    say "  cmd : ${args:-?}"
    say "  cwd : ${cwd:-?}"

    case "$pcmd" in
      *[Pp][Mm]2*)
        say "  owner: PM2"
        act "pm2 restart $pid" ;;
      *)
        unit="$(systemctl status "$pid" 2>/dev/null | head -1 | awk '{print $2}' || true)"
        case "${unit:-}" in
          *.service)
            say "  owner: systemd unit $unit"
            act "systemctl restart $unit" ;;
          *)
            say "  owner: started by hand"
            act "kill $pid"
            act "cd '$ROOT' && nohup $args >> /tmp/backend-$pid.log 2>&1 &" ;;
        esac ;;
    esac
    acted=1
    break
  done
fi

if [ "$acted" = 0 ]; then
  say 'no Node or `php -S` process is serving this folder — looking at the web server instead.'
  web_unit="$(systemctl list-units --type=service --no-legend 2>/dev/null \
              | grep -Eo '(apache2|httpd)\.service' | head -1)"
  fpm_unit="$(systemctl list-units --type=service --no-legend 2>/dev/null \
              | grep -Eo 'php[0-9.]+-fpm\.service' | head -1)"
  if [ -n "$web_unit" ]; then
    say "PHP runs inside $web_unit (this repo's .htaccess setup)."
    act "systemctl restart $web_unit"
    acted=1
  fi
  if [ -n "$fpm_unit" ]; then
    say "PHP-FPM is installed as $fpm_unit."
    act "systemctl restart $fpm_unit"
    acted=1
  fi
  if systemctl list-units --type=service --no-legend 2>/dev/null | grep -q 'nginx\.service'; then
    act 'systemctl reload nginx'
  fi
  if [ "$acted" = 0 ]; then
    say "nothing matched — run tools/which-backend.sh and restart what it names"
    say "(Plesk: Tools & Settings > Services Management; Caddy: systemctl restart caddy)"
  fi
fi

say ''
say '== what answers now ========================================'
if [ "$APPLY" = 1 ]; then
  sleep 2
  for u in http://127.0.0.1/api/health http://127.0.0.1/build.json \
           http://127.0.0.1:8080/api/health http://127.0.0.1:3000/api/health; do
    printf '%-32s %s\n' "$u" "$(curl -s -m 3 "$u" 2>/dev/null | head -c 120)"
  done
else
  say 'after restarting, this script (with --yes) asks:'
  say '  /api/health   -> build + features (want admin.analytics, super.analytics, routes 68)'
  say '  /build.json   -> must show the same build'
fi
say ''
say 'From outside, confirm:  curl -s https://your-site/api/health'

#!/usr/bin/env bash
# Which backend is answering this deployment — and how do I restart it?
#
# Read-only, safe to run anywhere. On the server, in the folder the domain serves:
#
#     bash tools/which-backend.sh
#
# It prints: what this folder is (commit + build marker + /api/health route),
# the listening ports, the PHP/Node processes, the installed web/PHP services,
# what the local API answers, and the restart command for what it found.
set -u

say() { printf '%s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

say '== this folder ============================================='
say "cwd        : $(pwd)"
if have git; then say "commit     : $(git log --oneline -1 2>/dev/null || echo '(not a git checkout)')"; fi
if [ -f public/build.json ]; then
  say "build.json : $(tr -d '\r' < public/build.json | tr '\n' ' ' | cut -c1-150)"
else
  say "build.json : (!) missing -> this folder is older than the build, or not the folder served"
fi
if [ -f php/api.php ]; then
  if grep -q 'api/health' php/api.php; then
    say "php route  : php/api.php HAS /api/health (new build)"
  else
    say "php route  : (!) php/api.php has NO /api/health -> this folder is older than the build"
  fi
else
  say "php route  : (no php/api.php here -> this folder is not the PHP deployment)"
fi

say ''
say '== listening ports (80/443/8080/3000/8000) ================='
ports="$( (have ss && ss -ltnp) || (have netstat && netstat -ltnp) || true )"
if [ -n "$ports" ]; then
  printf '%s\n' "$ports" | grep -E ':(80|443|8080|3000|8000|8001)[[:space:]]' || say '(nothing listening on those ports)'
else
  say '(neither ss nor netstat available)'
fi

say ''
say '== backend processes ======================================'
if have ps; then
  ps -eo pid=,user=,args= 2>/dev/null | grep -Ei 'php|node|httpd|apache|nginx|caddy|pm2' | grep -v 'which-backend' || say '(none found)'
else
  say '(no ps)'
fi

say ''
say '== web / PHP / Node services =============================='
if have systemctl; then
  systemctl list-units --type=service --no-legend 2>/dev/null | grep -Ei 'php|apache|httpd|nginx|caddy|node|pm2|sw-cp|sw-engine|psa' || say '(no web/PHP/Node services installed)'
else
  say '(no systemctl)'
fi

say ''
say '== php ===================================================='
if have php; then
  php -v 2>/dev/null | head -1
  fpm="$(php -r 'echo "php".PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION."-fpm";' 2>/dev/null)"
  say "fpm name   : ${fpm:-unknown} (only exists if PHP-FPM is installed — see the list above)"
else
  say '(php is not on PATH)'
fi

say ''
say '== what the local API answers ============================='
if have curl; then
  for u in http://127.0.0.1/api/health http://127.0.0.1:8080/api/health http://127.0.0.1:3000/api/health; do
    printf '%-32s %s\n' "$u" "$(curl -s -m 3 "$u" 2>/dev/null | head -c 170)"
  done
  for u in http://127.0.0.1/build.json http://127.0.0.1:8080/build.json; do
    printf '%-32s %s\n' "$u" "$(curl -s -m 3 "$u" 2>/dev/null | head -c 90)"
  done
else
  say '(no curl)'
fi

say ''
say '== restart the backend ===================================='
fpm_unit="$(systemctl list-units --type=service --no-legend 2>/dev/null | grep -Eo 'php[0-9.]+-fpm\.service' | head -1)"
if have ps && ps -eo args= 2>/dev/null | grep -q '[p]hp -S'; then
  pids="$(ps -eo pid=,args= 2>/dev/null | grep '[p]hp -S' | awk '{print $1}' | tr '\n' ' ')"
  say "A PHP built-in dev server (php -S) is answering, pid: $pids"
  say "  Restart it:  kill $pids"
  say "  then start the same command again, e.g."
  say "    php -S 127.0.0.1:8080 tools/php-router.php"
elif [ -n "$fpm_unit" ]; then
  say "PHP-FPM is installed as $fpm_unit (php runs in FastCGI, e.g. behind nginx)"
  say "  sudo systemctl restart $fpm_unit"
  say "  sudo systemctl restart nginx      # only if nginx is in front (see the ports list)"
elif have systemctl && systemctl list-units --type=service --no-legend 2>/dev/null | grep -qE '(apache2|httpd)\.service'; then
  say "PHP runs inside the web server. Restart it (whichever name the list above shows):"
  say "  sudo systemctl restart apache2      # or: sudo systemctl restart httpd"
elif have ps && ps -eo args= 2>/dev/null | grep -qE '[n]ode (server|[^ ]*)server'; then
  say "The Node backend is answering. Restart that process:"
  say "  pm2 restart <app>   |   systemctl restart <your-service>   |   npm start"
else
  say "Nothing obvious matched. Take the name from the lists above and restart that:"
  say "  apache2 / httpd | phpX.Y-fpm (+ nginx) | nginx | caddy | sw-cp-server (Plesk)"
  say "  or the node process (pm2 restart <app> / systemctl restart <service>)"
  say "For Plesk: Plesk > Tools & Settings > Services Management > restart the web server."
fi
say ''
say "Reminder: PHP keeps compiled files in OPcache, and Node builds its route"
say "table at boot — the pull alone never changes what a running process serves."

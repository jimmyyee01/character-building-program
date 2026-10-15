<?php
/* =====================================================================
   cache-clear.php — make freshly pulled PHP files take effect WITHOUT
   finding and restarting the web server.

   Why it exists: PHP keeps compiled files in OPcache. On hosts that run with
   opcache.validate_timestamps=0, a `git pull` changes the files on disk while
   the OLD compiled code keeps answering — /api/health stays "unknown" and the
   console shows "this page is newer than the server that answered it".
   Restarting PHP-FPM/Apache clears that, but the service name differs per host
   (apache2, httpd, php8.3-fpm, ...) and guessing it wastes time.

   This file is new after a pull, so OPcache compiles it on its first request
   and it can then flush the whole cache; the next /api/ request recompiles the
   new api.php. Nothing here touches data — it only drops compiled bytecode.

   Use once: open /cache-clear.php in a browser, or:
       curl -s https://your-site/cache-clear.php
   Then open /api/health — it should report the build from public/build.json.
   Safe to leave in place; delete the file if you would rather not keep it.
   ===================================================================== */
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$onDisk = null;
$marker = __DIR__ . '/build.json';
if (is_file($marker)) {
    $j = json_decode((string) file_get_contents($marker), true);
    if (is_array($j) && !empty($j['build'])) { $onDisk = (string) $j['build']; }
}

$hasOpcache = function_exists('opcache_reset');
$didReset = false;
if ($hasOpcache) { $didReset = (bool) opcache_reset(); }
if (function_exists('clearstatcache')) { clearstatcache(true); }

$note = $didReset
    ? 'OPcache cleared — now open /api/health; it should report build ' . ($onDisk ?: '?') . '.'
    : 'OPcache is not clearing here (not installed, or disabled for this SAPI), so this trick '
        . 'cannot help: restart the process answering /api/ instead (Node process, or the web server).';

echo json_encode([
    'ok' => true,
    'did_reset' => $didReset,
    'opcache' => [
        'extension' => $hasOpcache ? 'loaded' : 'not installed',
        'enable' => ini_get('opcache.enable'),
        'validate_timestamps' => ini_get('opcache.validate_timestamps'),
        'revalidate_freq' => ini_get('opcache.revalidate_freq'),
    ],
    'php' => PHP_VERSION,
    'sapi' => PHP_SAPI,
    'build_on_disk' => $onDisk,
    'note' => $note,
    'next' => '/api/health',
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

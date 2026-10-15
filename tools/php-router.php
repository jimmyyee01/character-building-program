<?php
/* Router for PHP's built-in server, so the PHP build can be run without Apache
   (the project .htaccess is not read by `php -S`).

   Usage from the project root:
       php -S 127.0.0.1:8080 -t . tools/php-router.php
*/
$root = dirname(__DIR__);
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

/* /api/... -> php/api.php?r=/... */
if (strpos($uri, '/api/') === 0) {
    $_GET['r'] = substr($uri, 4);
    require $root . '/php/api.php';
    return true;
}

/* /cache-clear -> the OPcache flush helper (Apache does this via .htaccess) */
if (preg_match('#^/cache-clear(\.php)?/?$#', $uri)) {
    require $root . '/public/cache-clear.php';
    return true;
}

/* static assets live in public/ */
if (preg_match('#^/(css|js)/(.+)$#', $uri, $m)) {
    $f = $root . '/public/' . $m[1] . '/' . $m[2];
    if (is_file($f)) {
        $ext = pathinfo($f, PATHINFO_EXTENSION);
        $mime = ['css' => 'text/css', 'js' => 'text/javascript', 'map' => 'application/json'][$ext]
            ?? 'application/octet-stream';
        header('Content-Type: ' . $mime . '; charset=utf-8');
        readfile($f);
        return true;
    }
}

/* pretty pages */
$path = trim($uri, '/');
$pages = ['' => 'index.html', 'super' => 'super.html', 'admin' => 'admin.html', 'app' => 'app.html'];
if (isset($pages[$path])) {
    header('Content-Type: text/html; charset=utf-8');
    readfile($root . '/public/' . $pages[$path]);
    return true;
}
if (preg_match('#^t/[A-Za-z0-9-]+$#', $path)) {
    header('Content-Type: text/html; charset=utf-8');
    readfile($root . '/public/login.html');
    return true;
}
if ($uri === '/favicon.ico') { http_response_code(204); return true; }

/* anything else that lives in public/ — Apache serves that folder as the document
   root in production, so the dev server must do the same (uploads, extra pages) */
$mimes = ['html' => 'text/html', 'css' => 'text/css', 'js' => 'text/javascript',
    'json' => 'application/json', 'png' => 'image/png', 'jpg' => 'image/jpeg',
    'jpeg' => 'image/jpeg', 'gif' => 'image/gif', 'svg' => 'image/svg+xml',
    'ico' => 'image/x-icon', 'webp' => 'image/webp', 'pdf' => 'application/pdf',
    'txt' => 'text/plain', 'mp4' => 'video/mp4', 'webm' => 'video/webm',
    'woff' => 'font/woff', 'woff2' => 'font/woff2', 'csv' => 'text/csv'];
$candidate = $root . '/public' . $uri;
if (is_file($candidate)) {
    $ext = strtolower(pathinfo($candidate, PATHINFO_EXTENSION));
    if ($ext === 'php') { require $candidate; return true; }   // Apache executes PHP here too
    header('Content-Type: ' . ($mimes[$ext] ?? 'application/octet-stream'));
    header('Content-Length: ' . filesize($candidate));
    readfile($candidate);
    return true;
}

/* uploads and anything else that really exists */
if (is_file($root . $uri)) { return false; }

http_response_code(404);
header('Content-Type: application/json');
echo json_encode(['ok' => false, 'error' => 'Unknown endpoint: ' . $uri]);
return true;

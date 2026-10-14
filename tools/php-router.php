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

/* uploads and anything else that really exists */
if (is_file($root . $uri)) { return false; }

http_response_code(404);
header('Content-Type: application/json');
echo json_encode(['ok' => false, 'error' => 'Unknown endpoint: ' . $uri]);
return true;

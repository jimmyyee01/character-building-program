<?php
/* =====================================================================
   api.php — central JSON API dispatcher (PHP + MySQL backend).
   Reaches this file via .htaccess:  /api/<path> -> php/api.php?r=/<path>
   Response shape matches the original backend: {ok:true, ...payload}
   or {ok:false, error} with the appropriate HTTP status.
   ===================================================================== */
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/engine.php';
require_once __DIR__ . '/routes_public.php';
require_once __DIR__ . '/routes_flow.php';
require_once __DIR__ . '/routes_admin.php';

$PARTICIPANTS = ['student', 'teacher', 'member', 'supervisor'];
$ADMINS = ['super', 'tenant_admin'];

/* Which build is actually running? Bump this on every release — /api/health
   reports it, so a server that was not updated is easy to spot. */
define('APP_BUILD', '2026-10-15-analytics');
define('APP_FEATURES', 'health,super.analytics,admin.analytics,reports.students,keywords,'
    . 'reader.book,library.lock,certificates,chapter.pages,exports');

/* Public: which backend and which build is answering. */
function r_health($user, $body, $params, $token, $query): array {
    global $routes;
    $features = array_map('trim', explode(',', APP_FEATURES));
    return ['ok' => true, 'backend' => 'php', 'build' => APP_BUILD,
        'features' => $features, 'routes' => count($routes),
        'php' => PHP_VERSION, 'database' => DB_NAME, 'time' => now_dt(),
        'analytics' => in_array('super.analytics', $features, true)];
}

function send_json(int $code, array $obj): void {
    http_response_code($code);
    echo json_encode($obj, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/* ------------------------------------------------------------ routes -- */
$routes = [];
function route(string $method, string $pattern, string $fn): void {
    global $routes;
    $routes[] = [$method, '#^' . $pattern . '$#', $fn];
}

/* Public + auth */
route('GET',  '/api/health', 'r_health');
route('GET',  '/api/public/portals', 'r_public_portals');
route('GET',  '/api/public/tenant/([a-z0-9-]+)', 'r_public_tenant');
route('POST', '/api/auth/register', 'r_auth_register');
route('POST', '/api/auth/login', 'r_auth_login');
route('POST', '/api/auth/super-login', 'r_auth_superlogin');
route('POST', '/api/auth/logout', 'r_auth_logout');
route('GET',  '/api/me', 'r_me');

/* Participant experience */
route('GET',  '/api/flow', 'r_flow');
route('POST', '/api/flow/letter-feedback', 'r_flow_letter_feedback');
route('POST', '/api/flow/optional-video-seen', 'r_flow_optional_seen');
route('GET',  '/api/modules', 'r_modules');
route('GET',  '/api/module/([a-zA-Z0-9_-]+)', 'r_module_one');
route('GET',  '/api/book/([a-zA-Z0-9_-]+)', 'r_book_one');
route('GET',  '/api/chapter/([a-zA-Z0-9_-]+)/objectives', 'r_chapter_objectives');
route('POST', '/api/submissions', 'r_submissions');
route('POST', '/api/certificates/issue', 'r_cert_issue');
route('GET',  '/api/certificates', 'r_certificates');
route('GET',  '/api/certificate/([a-zA-Z0-9_-]+)', 'r_certificate_one');
route('GET',  '/api/videos', 'r_videos');
route('POST', '/api/videos/([a-zA-Z0-9_-]+)/watched', 'r_video_watched');
route('GET',  '/api/thoughts', 'r_thoughts_get');
route('POST', '/api/thoughts', 'r_thoughts_post');
route('GET',  '/api/final', 'r_final');
route('GET',  '/api/dashboard', 'r_dashboard');
route('GET',  '/api/library', 'r_library_get');

/* Content management (super + tenant admin) */
route('POST',   '/api/library', 'r_library_create');
route('PUT',    '/api/library/([a-zA-Z0-9_-]+)', 'r_library_update');
route('DELETE', '/api/library/([a-zA-Z0-9_-]+)', 'r_library_delete');
route('GET',    '/api/books', 'r_books_list');
route('POST',   '/api/books', 'r_books_create');
route('PUT',    '/api/books/([a-zA-Z0-9_-]+)', 'r_books_update');
route('DELETE', '/api/books/([a-zA-Z0-9_-]+)', 'r_books_delete');
route('POST',   '/api/books/([a-zA-Z0-9_-]+)/chapters', 'r_chapters_create');
route('PUT',    '/api/chapters/([a-zA-Z0-9_-]+)', 'r_chapters_update');
route('DELETE', '/api/chapters/([a-zA-Z0-9_-]+)', 'r_chapters_delete');
route('POST',   '/api/chapters/([a-zA-Z0-9_-]+)/objectives', 'r_objectives_create');
route('DELETE', '/api/objectives/([a-zA-Z0-9_-]+)', 'r_objectives_delete');

/* User management */
route('GET',    '/api/users', 'r_users_list');
route('POST',   '/api/users', 'r_users_create');
route('POST',   '/api/users/bulk', 'r_users_bulk');
route('PUT',    '/api/users/([a-zA-Z0-9_-]+)', 'r_users_update');
route('DELETE', '/api/users/([a-zA-Z0-9_-]+)', 'r_users_delete');
route('PUT',    '/api/admin/branding', 'r_admin_branding');
route('GET',    '/api/admin/overview', 'r_admin_overview');
route('GET',    '/api/admin/submissions', 'r_admin_submissions');
route('GET',    '/api/admin/certificates', 'r_admin_certificates');
route('GET',    '/api/reports/students', 'r_reports_students');
route('GET',    '/api/super/analytics', 'r_super_analytics');
route('GET',    '/api/admin/analytics', 'r_admin_analytics');

/* Super admin */
route('GET',    '/api/super/overview', 'r_super_overview');
route('GET',    '/api/super/portals', 'r_super_portals');
route('POST',   '/api/super/portals', 'r_super_portal_create');
route('PUT',    '/api/super/portals/([a-zA-Z0-9_-]+)', 'r_super_portal_update');
route('DELETE', '/api/super/portals/([a-zA-Z0-9_-]+)', 'r_super_portal_delete');
route('GET',    '/api/super/tenants', 'r_super_tenants');
route('POST',   '/api/super/tenants', 'r_super_tenant_create');
route('PUT',    '/api/super/tenants/([a-zA-Z0-9_-]+)', 'r_super_tenant_update');
route('DELETE', '/api/super/tenants/([a-zA-Z0-9_-]+)', 'r_super_tenant_delete');
route('GET',    '/api/super/modules', 'r_super_modules');
route('POST',   '/api/super/modules', 'r_super_module_create');
route('PUT',    '/api/super/modules/([a-zA-Z0-9_-]+)', 'r_super_module_update');
route('DELETE', '/api/super/modules/([a-zA-Z0-9_-]+)', 'r_super_module_delete');
route('GET',    '/api/super/settings', 'r_super_settings_get');
route('PUT',    '/api/super/settings', 'r_super_settings');
route('GET',    '/api/super/submissions', 'r_super_submissions');
route('GET',    '/api/super/users', 'r_super_users');
route('POST',   '/api/super/users', 'r_super_users_create');

/* ---------------------------------------------------------- dispatch -- */
try {
    $r = $_GET['r'] ?? '/';
    $path = '/api' . (str_starts_with($r, '/') ? $r : '/' . $r);
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    $raw = file_get_contents('php://input');
    $body = ($raw !== '' && $raw !== false) ? json_decode($raw, true) : null;
    if (!is_array($body)) $body = [];

    $user = current_user();
    $token = token_from_request();
    $query = $_GET;
    unset($query['r']);

    foreach ($routes as [$rm, $re, $fn]) {
        if ($rm !== $method) continue;
        if (!preg_match($re, $path, $m)) continue;
        // Satisfy both conventions used across route files:
        // numeric $params[0] AND named $params['id'].
        $params = array_slice($m, 1);
        if (isset($params[0]) && !isset($params['id'])) $params['id'] = $params[0];
        try {
            $out = $fn($user, $body, $params, $token, $query);
        } catch (TypeError $e) {
            /* Handlers are declared with a typed array $user; a request without a
               session must answer 401 (like the Node backend), not 500. */
            if ($user === null && strpos($e->getMessage(), 'Argument #1') !== false) {
                send_json(401, ['ok' => false, 'error' => 'Sign in required']);
            }
            throw $e;
        }
        if (!is_array($out)) $out = [];
        send_json(200, array_merge(['ok' => true], $out));
    }
    send_json(404, ['ok' => false, 'error' => 'Unknown endpoint: ' . $method . ' ' . $path]);
} catch (ApiError $e) {
    send_json($e->status, ['ok' => false, 'error' => $e->getMessage()]);
} catch (Throwable $e) {
    error_log('[cbp-api] ' . $e->getMessage());
    send_json(500, ['ok' => false, 'error' => 'Server error']);
}


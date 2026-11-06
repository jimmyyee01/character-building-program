<?php
/* =====================================================================
   Character Building Program — PHP + MySQL backend
   php/config.php : connection, auth, sessions, shared helpers.
   1) Edit DB_HOST/DB_NAME/DB_USER/DB_PASS below.
   2) Import database.sql, then open install.php once in the browser.
   ===================================================================== */
declare(strict_types=1);

define('DB_HOST', 'localhost');
define('DB_NAME', 'character_db');
define('DB_USER', 'root');
define('DB_PASS', '');

define('SESSION_DAYS', 7);
define('UPLOAD_DIR', dirname(__DIR__) . '/uploads');

class ApiError extends Exception {
    public int $status;
    public function __construct(string $message, int $status = 400) {
        parent::__construct($message);
        $this->status = $status;
    }
}
function need($cond, string $message, int $status = 400): void {
    if (!$cond) throw new ApiError($message, $status);
}

function db(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $pdo = new PDO(
            'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
            DB_USER, DB_PASS,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
             PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
        );
    }
    return $pdo;
}

function uid(string $prefix): string {
    return $prefix . '_' . bin2hex(random_bytes(7));
}
function now_dt(): string { return date('Y-m-d H:i:s'); }

/* MySQL DATETIME -> ISO-8601 expected by the frontend. */
function iso($dt): ?string {
    if (!$dt) return null;
    $t = strtotime((string)$dt);
    return $t === false ? null : date('Y-m-d\TH:i:s', $t);
}
function jdec($s, $fallback = []) {
    if ($s === null || $s === '') return $fallback;
    $v = json_decode((string)$s, true);
    return $v === null ? $fallback : $v;
}
function jenc($v): string {
    return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

/* ------------------------------------------------------------ passwords - */
function hash_pw(string $pw): string {
    return password_hash($pw, PASSWORD_BCRYPT);
}
function verify_pw(string $pw, ?string $hash): bool {
    if (!$hash) return false;
    return password_verify($pw, $hash);
}

/* ------------------------------------------------------------- sessions - */
function token_from_request(): ?string {
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (is_string($h) && str_starts_with($h, 'Bearer ')) return trim(substr($h, 7));
    // some Apache setups hide the header; check the redirect variant too
    $h2 = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (is_string($h2) && str_starts_with($h2, 'Bearer ')) return trim(substr($h2, 7));
    return isset($_COOKIE['cbp_token']) && $_COOKIE['cbp_token'] !== ''
        ? (string)$_COOKIE['cbp_token'] : null;
}
function create_session(array $user): string {
    $token = bin2hex(random_bytes(24));
    $pdo = db();
    $pdo->prepare('DELETE FROM sessions WHERE expires_at < NOW()')->execute();
    /* a single sign-in per browser is not enough for a learner: the app also has
       to prove it is still on screen (see current_user below) */
    $locks = has_column('sessions', 'live_at');
    $sql = 'INSERT INTO sessions (token, user_id, created_at, expires_at'
        . ($locks ? ', live_at' : '') . ') VALUES (?,?,?,?' . ($locks ? ',?' : '') . ')';
    $args = [$token, $user['id'], now_dt(), date('Y-m-d H:i:s', time() + SESSION_DAYS * 86400)];
    if ($locks) $args[] = now_dt();
    $pdo->prepare($sql)->execute($args);
    setcookie('cbp_token', $token, time() + SESSION_DAYS * 86400, '/', '', false, true);
    return $token;
}
function destroy_session(): void {
    $t = token_from_request();
    if ($t) db()->prepare('DELETE FROM sessions WHERE token=?')->execute([$t]);
    setcookie('cbp_token', '', time() - 3600, '/', '', false, true);
}
/* The learner's page says "still here" every few seconds. A session that goes
   quiet for STUDENT_IDLE_SECONDS is over — the window was minimised, closed or
   left for another program or tab — so the learner must sign in again. Staff
   accounts are never affected: they keep the ordinary session. Mirrors
   currentUser()/beatSession() in server/auth.js. */
const STUDENT_IDLE_SECONDS = 45;
const LEAVE_LOCK_ROLES = ['student'];
function beat_session(?string $token = null): void {
    if (!has_column('sessions', 'live_at')) return;
    $token = $token ?? token_from_request();
    if (!$token) return;
    db()->prepare('UPDATE sessions SET live_at=NOW() WHERE token=?')->execute([$token]);
}
function student_leave_locked(?array $user): bool {
    return $user !== null && in_array((string)($user['role'] ?? ''), LEAVE_LOCK_ROLES, true);
}

/* ---------------------------------------------------------- current user - */
function current_user(): ?array {
    $token = token_from_request();
    if (!$token) return null;
    $pdo = db();
    $locks = has_column('sessions', 'live_at');
    $sql = 'SELECT u.*' . ($locks ? ', s.live_at AS session_live_at' : '') .
        ' FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires_at > NOW() LIMIT 1';
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$token]);
    $user = $stmt->fetch();
    if (!$user || (int)($user['suspended'] ?? 0) === 1) return null;
    if ($locks) {
        $last = $user['session_live_at'] ? (int)strtotime((string)$user['session_live_at']) : 0;
        unset($user['session_live_at']);
        if (student_leave_locked($user) && $last && time() - $last > STUDENT_IDLE_SECONDS) {
            $pdo->prepare('DELETE FROM sessions WHERE token=?')->execute([$token]);
            return null;
        }
        if (student_leave_locked($user)) beat_session($token);
    }
    return normalize_user($user);
}
function require_role(?array $user, array $roles): array {
    need($user, 'Sign in required', 401);
    need(in_array($user['role'], $roles, true), 'Not permitted for this account', 403);
    return $user;
}
function public_user(array $u): array {
    return [
        'id' => $u['id'], 'tenantId' => $u['tenant_id'], 'role' => $u['role'],
        'fullName' => $u['full_name'], 'email' => $u['email'],
        'studentNumber' => $u['student_number'], 'className' => $u['class_name'],
        'photo' => $u['photo'], 'supervisorId' => $u['supervisor_id'],
        'supervisorWaitlisted' => (bool)($u['supervisor_waitlisted'] ?? false),
        'supervisorCode' => $u['supervisor_code'],
        'letterFeedbackAt' => iso($u['letter_feedback_at'] ?? null),
        'optionalVideoSeen' => (bool)($u['optional_video_seen'] ?? false),
        'suspended' => (bool)($u['suspended'] ?? false),
        'createdAt' => iso($u['created_at'] ?? null),
    ];
}
function normalize_user(array $u): array {
    $u['tenant_id'] = $u['tenant_id'] ?? null;
    $u['supervisor_id'] = $u['supervisor_id'] ?? null;
    $u['supervisor_waitlisted'] = (int)($u['supervisor_waitlisted'] ?? 0);
    $u['supervisor_code'] = $u['supervisor_code'] ?? null;
    $u['email'] = $u['email'] ?? null;
    $u['student_number'] = $u['student_number'] ?? null;
    $u['class_name'] = $u['class_name'] ?? null;
    $u['photo'] = $u['photo'] ?? null;
    $u['letter_feedback_at'] = $u['letter_feedback_at'] ?? null;
    $u['optional_video_seen'] = (int)($u['optional_video_seen'] ?? 0);
    $u['watched_videos'] = jdec($u['watched_videos_json'] ?? null, []);
    $u['assessment_pre'] = jdec($u['assessment_pre_json'] ?? null, null);
    $u['assessment_post'] = jdec($u['assessment_post_json'] ?? null, null);
    return $u;
}
function save_watched(array $user, array $watched): void {
    db()->prepare('UPDATE users SET watched_videos_json=? WHERE id=?')
        ->execute([jenc(array_values(array_unique($watched))), $user['id']]);
}
function get_tenant(?string $tenantId): ?array {
    if (!$tenantId) return null;
    $stmt = db()->prepare('SELECT * FROM tenants WHERE id=? LIMIT 1');
    $stmt->execute([$tenantId]);
    $t = $stmt->fetch();
    return $t ?: null;
}
function get_settings(): array {
    $s = db()->query('SELECT * FROM settings WHERE id=1 LIMIT 1')->fetch();
    if (!$s) { $s = ['program_name' => 'Character Building Program', 'program_logo' => null,
        'letter_id' => null, 'letter_video_id' => null]; }
    return $s;
}
function tenant_branding(?array $tenant): array {
    $s = get_settings();
    return [
        'tenantName' => $tenant ? $tenant['name'] : $s['program_name'],
        'tenantLogo' => $tenant ? $tenant['logo'] : null,
        'programLogo' => ($tenant && $tenant['program_logo']) ? $tenant['program_logo'] : $s['program_logo'],
        'themeColor' => ($tenant && !empty($tenant['theme_color'])) ? $tenant['theme_color'] : null,
        'programName' => $s['program_name'],
    ];
}

/* ------------------------------------------------------------- portals -- */
function md_of(string $s): int {
    $p = explode('-', $s);
    return ((int)($p[0] ?? 0)) * 100 + ((int)($p[1] ?? 0));
}
function portal_active(?array $portal, ?int $now = null): bool {
    if (!$portal || (int)($portal['enabled'] ?? 0) !== 1) return false;
    if (($portal['schedule_mode'] ?? '') === 'always') return true;
    if (($portal['schedule_mode'] ?? '') !== 'windows') return false;
    $windows = jdec($portal['windows_json'] ?? null, []);
    if (!is_array($windows) || !count($windows)) return false;
    $t = $now ?? time();
    $cur = ((int)date('n', $t)) * 100 + ((int)date('j', $t));
    foreach ($windows as $w) {
        $from = md_of((string)($w['from'] ?? ''));
        $to = md_of((string)($w['to'] ?? ''));
        if (!$from || !$to) continue;
        if ($from === $to) { if ($cur === $from) return true; }
        elseif ($from < $to) { if ($cur >= $from && $cur <= $to) return true; }
        else { if ($cur >= $from || $cur <= $to) return true; }
    }
    return false;
}
function portal_public(array $p): array {
    return [
        'id' => $p['id'], 'key' => $p['key'], 'name' => $p['name'], 'type' => $p['type'],
        'scheduleMode' => $p['schedule_mode'], 'windows' => jdec($p['windows_json'] ?? null, []),
        'enabled' => (int)$p['enabled'] !== 0, 'description' => $p['description'],
        'active' => portal_active($p),
    ];
}
function normalize_windows($windows): array {
    $out = [];
    if (!is_array($windows)) return $out;
    foreach ($windows as $w) {
        if (is_array($w) && preg_match('/^\d{2}-\d{2}$/', (string)($w['from'] ?? '')) &&
            preg_match('/^\d{2}-\d{2}$/', (string)($w['to'] ?? ''))) {
            $out[] = ['from' => $w['from'], 'to' => $w['to']];
        }
    }
    return $out;
}
function slugify($s): string {
    $s = strtolower(trim((string)($s ?? '')));
    $s = preg_replace('/[^a-z0-9]+/', '-', $s);
    return substr(trim($s, '-'), 0, 60);
}

/* --------------------------------------------------------------- upload - */
function save_upload($file): ?string {
    $saved = save_upload_meta($file);
    return $saved ? $saved['url'] : null;
}
/* Same upload, plus the stored size so the admin screens can show how big a
   video or audio file is without downloading it. */
function save_upload_meta($file): ?array {
    if (!is_array($file) || empty($file['base64']) || empty($file['name'])) return null;
    $clean = preg_replace('/[^a-zA-Z0-9._-]/', '_', (string)$file['name']);
    $clean = substr($clean, -80);
    $name = uid('upl') . '-' . $clean;
    if (!is_dir(UPLOAD_DIR)) mkdir(UPLOAD_DIR, 0775, true);
    $bytes = base64_decode((string)$file['base64']);
    file_put_contents(UPLOAD_DIR . '/' . $name, $bytes);
    $size = isset($file['size']) && (int)$file['size'] > 0 ? (int)$file['size'] : strlen($bytes);
    return ['url' => '/uploads/' . $name, 'size' => $size];
}

/* ---------------------------------------------- attached video or audio --- */
/* A letter or a book may carry one optional video or audio. The kind is read
   from the file name so the learner's player knows <video> from <audio>. */
function media_kind_from_name($name): string {
    $ext = strtolower((string)pathinfo((string)$name, PATHINFO_EXTENSION));
    $audio = ['mp3','m4a','aac','wav','flac','ogg','oga','opus','weba','amr','mid','midi','aif','aiff','wma'];
    return in_array($ext, $audio, true) ? 'audio' : 'video';
}
/* The attached media a form may send (an already-uploaded link or a cleared one).
   Files travel through save_upload_meta first, so only the URL lands here. */
function media_fields_from(array $body): array {
    $out = [];
    if (!array_key_exists('mediaUrl', $body) && !array_key_exists('media_url', $body)) return $out;
    $url = $body['mediaUrl'] ?? $body['media_url'] ?? null;
    $url = $url ? (string)$url : null;
    $out['media_url'] = $url;
    $out['media_name'] = $url ? ($body['mediaName'] ?? $body['media_name'] ?? null) : null;
    $out['media_size'] = $url ? (int)($body['mediaSize'] ?? $body['media_size'] ?? 0) ?: null : null;
    $out['media_kind'] = $url ? (($body['mediaKind'] ?? $body['media_kind'] ?? '') === 'audio' ? 'audio' : 'video') : null;
    return $out;
}
/* The media a learner may play, or null when nothing is attached. */
function media_out(?array $row): ?array {
    if (!$row || empty($row['media_url'])) return null;
    return ['url' => $row['media_url'],
        'kind' => ($row['media_kind'] ?? '') === 'audio' ? 'audio' : 'video',
        'name' => $row['media_name'] ?? null, 'size' => isset($row['media_size']) ? (int)$row['media_size'] : null];
}
/* The same clip as FLAT fields, which is how the Node backend keeps it on the
   record itself (mediaFieldsFrom in server/api.js). The API tests read these, so
   a PHP row must carry them too — nested `media` alone is not parity. */
function media_flat(?array $row): array {
    $url = $row['media_url'] ?? null;
    return [
        'mediaUrl' => $url ?: null,
        'mediaName' => $url ? ($row['media_name'] ?? null) : null,
        'mediaSize' => ($url && isset($row['media_size']) && $row['media_size'] !== null)
            ? (int)$row['media_size'] : null,
        'mediaKind' => $url ? (($row['media_kind'] ?? '') === 'audio' ? 'audio' : 'video') : null,
    ];
}

/* ------------------------------------------------------------ rich text -- */
/* Letters are written in a small editor on the admin pages. Only this allow-list
   of formatting tags survives a save — the same rule the Node backend and the
   browser run, so nothing else can ride along into a learner's screen. */
function sanitize_rich_html($html): string {
    $out = (string)($html ?? '');
    $out = preg_replace('/<!--.*?-->/s', '', $out);
    foreach (['script', 'style', 'iframe', 'object', 'embed', 'template', 'svg', 'math'] as $tag) {
        $out = preg_replace('/<' . $tag . '[^>]*>.*?<\/' . $tag . '\s*>/is', '', $out);
        $out = preg_replace('/<\/?' . $tag . '[^>]*>/i', '', $out);
    }
    $allowed = ['p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike',
        'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote'];
    /* block tags that may keep a safe text alignment */
    $alignable = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'li', 'blockquote'];
    /* every attribute goes, except a safe text alignment on a block tag */
    $out = preg_replace_callback('/<([a-z][a-z0-9]*)\b([^>]*)>/i', function ($m) use ($allowed, $alignable) {
        $tag = strtolower($m[1]);
        if (!in_array($tag, $allowed, true)) return '';
        $attrs = $m[2] ?? '';
        if (preg_match('/text-align\s*:\s*(left|center|right|justify)/i', $attrs, $a)
            && in_array($tag, $alignable, true)) {
            return '<' . $tag . ' style="text-align:' . strtolower($a[1]) . '">';
        }
        return '<' . $tag . '>';
    }, $out);
    $out = preg_replace_callback('/<\s*\/\s*([a-z][a-z0-9]*)\s*>/i', function ($m) use ($allowed) {
        $tag = strtolower($m[1]);
        return in_array($tag, $allowed, true) ? '</' . $tag . '>' : '';
    }, $out);
    /* a stray angle bracket could open a new tag later — write it out safely */
    $out = str_replace('<', '&lt;', $out);
    return preg_replace('/&lt;(\/?(?:p|div|br|b|strong|i|em|u|s|strike|h1|h2|h3|h4|ul|ol|li|blockquote)(?=[\s\/>]))/i', '<$1', $out);
}


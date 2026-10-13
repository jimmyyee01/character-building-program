<?php
declare(strict_types=1);
/* routes_public.php — public portals, tenant info, auth, me. */

function r_public_portals($user, $body, $params, $token, $query): array {
    $s = get_settings();
    $portals = db()->query('SELECT * FROM portals')->fetchAll();
    $tenants = db()->query('SELECT * FROM tenants')->fetchAll();
    $byPortal = [];
    foreach ($tenants as $t) {
        $pid = (string)($t['portal_id'] ?? '');
        if ($pid === '') continue;
        $byPortal[$pid][] = $t;
    }
    $rank = ['schools' => 0, 'organization' => 1, 'family' => 2, 'married' => 3, 'custom' => 4];
    usort($portals, function ($a, $b) use ($rank) {
        $ta = strtolower((string)($a['type'] ?? 'custom'));
        $tb = strtolower((string)($b['type'] ?? 'custom'));
        $ra = $rank[$ta] ?? 5;
        $rb = $rank[$tb] ?? 5;
        if ($ra !== $rb) return $ra <=> $rb;
        return strcmp((string)($a['name'] ?? ''), (string)($b['name'] ?? ''));
    });
    $out = [];
    foreach ($portals as $p) {
        $pp = portal_public($p);
        $list = $byPortal[(string)$p['id']] ?? [];
        usort($list, fn($a, $b) => strcmp((string)($a['name'] ?? ''), (string)($b['name'] ?? '')));
        $pp['tenants'] = array_map(fn($t) => [
            'slug' => $t['slug'], 'name' => $t['name'], 'logo' => $t['logo'],
        ], $list);
        $out[] = $pp;
    }
    return [
        'programName' => $s['program_name'] ?? 'Character Building Program',
        'programLogo' => $s['program_logo'] ?? null,
        'superLoginUrl' => '/super',
        'portals' => $out,
    ];
}

function r_public_tenant($user, $body, $params, $token, $query): array {
    $slug = trim((string)($params[0] ?? ''));
    need($slug !== '', 'Tenant required', 400);
    $st = db()->prepare('SELECT * FROM tenants WHERE slug=? LIMIT 1');
    $st->execute([$slug]);
    $t = $st->fetch();
    need($t, 'Tenant not found', 404);
    $st = db()->prepare('SELECT * FROM portals WHERE id=? LIMIT 1');
    $st->execute([$t['portal_id']]);
    $p = $st->fetch();
    need($p, 'Tenant not found', 404);
    return [
        'tenant' => ['slug' => $t['slug'], 'name' => $t['name'], 'logo' => $t['logo']],
        'portal' => [
            'name' => $p['name'], 'type' => $p['type'],
            'active' => portal_active($p),
            'scheduleMode' => $p['schedule_mode'],
            'windows' => jdec($p['windows_json'] ?? null, []),
        ],
        'branding' => tenant_branding($t),
    ];
}

/* Self-registration is disabled: only admins (and supervisors for members)
   create accounts through POST /api/users (or /api/users/bulk). */
function r_auth_register($user, $body, $params, $token, $query): array {
    need(false, 'Self-registration is disabled. Ask your administrator to add you to the system.', 403);
    return [];
}

function r_auth_login($user, $body, $params, $token, $query): array {
    $body = is_array($body) ? $body : [];
    $slug = trim((string)($body['slug'] ?? ''));
    $identifier = trim((string)($body['identifier'] ?? ''));
    $pw = (string)($body['password'] ?? '');
    need($slug !== '', 'Tenant required', 400);
    need($identifier !== '', 'Identifier required', 400);
    need($pw !== '', 'Password required', 400);
    $st = db()->prepare('SELECT * FROM tenants WHERE slug=? LIMIT 1');
    $st->execute([$slug]);
    $t = $st->fetch();
    need($t, 'Tenant not found', 404);
    $st = db()->prepare('SELECT * FROM portals WHERE id=? LIMIT 1');
    $st->execute([$t['portal_id']]);
    $p = $st->fetch();
    need($p, 'Tenant not found', 404);
    $st = db()->prepare("SELECT * FROM users WHERE tenant_id=? AND (LOWER(username)=LOWER(?) OR LOWER(email)=LOWER(?) OR LOWER(student_number)=LOWER(?)) LIMIT 1");
    $st->execute([$t['id'], $identifier, $identifier, $identifier]);
    $row = $st->fetch();
    need($row && verify_pw($pw, $row['password_hash'] ?? null), 'Invalid credentials', 401);
    need((int)($row['suspended'] ?? 0) !== 1, 'Account suspended', 403);
    $closed = !portal_active($p);
    need(!$closed || ($row['role'] ?? '') === 'tenant_admin', 'Portal closed', 403);
    $row = normalize_user($row);
    $tok = create_session($row);
    return ['token' => $tok, 'user' => public_user($row), 'portalClosed' => $closed];
}

function r_auth_superlogin($user, $body, $params, $token, $query): array {
    $body = is_array($body) ? $body : [];
    $username = trim((string)($body['username'] ?? ''));
    $pw = (string)($body['password'] ?? '');
    need($username !== '', 'Username required', 400);
    need($pw !== '', 'Password required', 400);
    $s = get_settings();
    $okUser = isset($s['super_username']) && hash_equals((string)$s['super_username'], $username);
    $okPw = verify_pw($pw, $s['super_hash'] ?? null);
    need($okUser && $okPw, 'Invalid credentials', 401);
    $st = db()->prepare("SELECT * FROM users WHERE role='super' LIMIT 1");
    $st->execute();
    $row = $st->fetch();
    if (!$row) {
        $id = uid('usr');
        $ins = db()->prepare('INSERT INTO users (id, tenant_id, role, supervisor_id, supervisor_code, username, full_name, email, student_number, class_name, photo, salt, password_hash, letter_feedback_at, optional_video_seen, watched_videos_json, suspended, created_at) VALUES (?,?,?,NULL,NULL,?,?,NULL,NULL,NULL,NULL,?,?,?,1,NULL,0,?)');
        $ins->execute([$id, null, 'super', $username, 'Super Admin', '', '', now_dt(), now_dt()]);
        $st = db()->prepare('SELECT * FROM users WHERE id=? LIMIT 1');
        $st->execute([$id]);
        $row = $st->fetch();
    }
    $row = normalize_user($row);
    $tok = create_session($row);
    return ['token' => $tok, 'user' => public_user($row)];
}

function r_auth_logout($user, $body, $params, $token, $query): array {
    destroy_session();
    return [];
}

function r_me($user, $body, $params, $token, $query): array {
    need($user, 'Sign in required', 401);
    $st = db()->prepare('SELECT * FROM users WHERE id=? LIMIT 1');
    $st->execute([$user['id']]);
    $fresh = $st->fetch();
    need($fresh, 'Sign in required', 401);
    $fresh = normalize_user($fresh);
    $tenant = get_tenant($fresh['tenant_id'] ?? null);
    $portalRow = null;
    if ($tenant) {
        $st = db()->prepare('SELECT * FROM portals WHERE id=? LIMIT 1');
        $st->execute([$tenant['portal_id']]);
        $portalRow = $st->fetch() ?: null;
    }
    $s = get_settings();
    $lib = get_library($s['letter_id'] ?? null);
    $vid = get_library($s['letter_video_id'] ?? null);
    return [
        'user' => public_user($fresh),
        'branding' => tenant_branding($tenant),
        'portal' => $portalRow ? [
            'name' => $portalRow['name'],
            'active' => portal_active($portalRow),
            'scheduleMode' => $portalRow['schedule_mode'],
            'windows' => jdec($portalRow['windows_json'] ?? null, []),
        ] : null,
        'letter' => [
            'title' => $lib['title'] ?? '',
            'text' => $lib['text'] ?? '',
            'done' => (bool)($fresh['letter_feedback_at'] ?? null),
            'feedbackAt' => iso($fresh['letter_feedback_at'] ?? null),
        ],
        'letterVideo' => $vid ? ['id' => $vid['id'], 'title' => $vid['title'], 'url' => $vid['url']] : null,
        'optionalVideoSeen' => (bool)($fresh['optional_video_seen'] ?? false),
    ];
}

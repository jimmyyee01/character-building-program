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

/* Small, public ranking for an account's login page. It is rebuilt on every
   request, so a newly scored activity can change the order immediately. Only
   profile photos that are already small enough for a login page are exposed;
   everything else falls back to the learner's initials in the browser. */
function public_login_photo($value): ?string {
    $s = trim((string)($value ?? ''));
    if ($s === '' || strlen($s) > 220000) return null;
    return preg_match('#^(https?://|/|data:image/(?:png|jpe?g|webp|gif);base64,)#i', $s) ? $s : null;
}
function public_login_display_name(?string $fullName): string {
    $parts = preg_split('/\s+/', trim((string)$fullName), -1, PREG_SPLIT_NO_EMPTY) ?: [];
    if (!$parts) return 'Learner';
    if (count($parts) === 1) return $parts[0];
    $last = (string)end($parts);
    $initial = function_exists('mb_substr') ? mb_substr($last, 0, 1, 'UTF-8') : substr($last, 0, 1);
    return $parts[0] . ' ' . strtoupper($initial) . '.';
}
function public_login_top_performers(string $tenantId, int $limit): array {
    $limit = max(1, min(10, $limit));
    $moduleIds = array_values(array_map(fn($m) => (string)$m['id'], all_modules()));
    $st = db()->prepare("SELECT id,full_name,class_name,student_number,role,photo FROM users
        WHERE tenant_id=? AND role IN ('student','member') AND suspended=0");
    $st->execute([$tenantId]);
    $learners = $st->fetchAll();

    /* "Completed all modules" means a module certificate for every current
       module. If a new module is added later, the learner can appear again. */
    if ($moduleIds && $learners) {
        $userPh = implode(',', array_fill(0, count($learners), '?'));
        $modulePh = implode(',', array_fill(0, count($moduleIds), '?'));
        $st = db()->prepare("SELECT user_id,module_id FROM certificates
            WHERE type='module' AND user_id IN ($userPh) AND module_id IN ($modulePh)");
        $st->execute(array_merge(array_column($learners, 'id'), $moduleIds));
        $completed = [];
        foreach ($st->fetchAll() as $certificate) {
            $completed[$certificate['user_id']][$certificate['module_id']] = true;
        }
        $learners = array_values(array_filter($learners,
            fn($learner) => count($completed[$learner['id']] ?? []) < count($moduleIds)));
    }

    $scores = [];
    $work = [];
    if ($moduleIds && $learners) {
        $userPh = implode(',', array_fill(0, count($learners), '?'));
        $modulePh = implode(',', array_fill(0, count($moduleIds), '?'));
        $st = db()->prepare("SELECT user_id,type,score,total,`text`,keyword_score,
            keywords_used,keywords_total,keywords_covered_json,keywords_missing_json,
            chapter_id,book_id,module_id
            FROM submissions WHERE flagged=0 AND user_id IN ($userPh) AND module_id IN ($modulePh)");
        $st->execute(array_merge(array_column($learners, 'id'), $moduleIds));
        foreach ($st->fetchAll() as $submission) {
            $studentId = (string)$submission['user_id'];
            $percent = null;
            if ($submission['type'] === 'objectives' && (int)$submission['total'] > 0) {
                $total = (int)$submission['total'];
                $earned = max(0, min($total, (int)$submission['score']));
                $percent = $earned * 100 / $total;
            } elseif (in_array($submission['type'],
                ['chapter_summary', 'letter_summary', 'book_summary'], true)) {
                $assessment = submission_assessment($submission);
                if ($assessment && ($assessment['keywordScore'] ?? null) !== null) {
                    $percent = max(0, min(100, (int)$assessment['keywordScore']));
                }
            }
            if ($percent === null) continue;
            if (!isset($scores[$studentId])) $scores[$studentId] = ['sum' => 0, 'count' => 0];
            $scores[$studentId]['sum'] += $percent;
            $scores[$studentId]['count']++;
        }

        /* work handed in, scored or not — a learner answering a chapter whose key
           words are not set yet still deserves their place on the list */
        $st = db()->prepare("SELECT user_id FROM submissions
            WHERE flagged=0 AND user_id IN ($userPh) AND module_id IN ($modulePh)");
        $st->execute(array_merge(array_column($learners, 'id'), $moduleIds));
        foreach ($st->fetchAll() as $row) {
            $studentId = (string)$row['user_id'];
            $work[$studentId] = ($work[$studentId] ?? 0) + 1;
        }
    }

    $ranked = [];
    foreach ($learners as $learner) {
        $marks = $scores[$learner['id']] ?? ['sum' => 0, 'count' => 0];
        $statuses = module_statuses(['id' => $learner['id'], 'tenant_id' => $tenantId,
            'role' => $learner['role'], 'full_name' => $learner['full_name'],
            'class_name' => $learner['class_name'], 'student_number' => $learner['student_number']]);
        $percents = array_map(fn($m) => (int)$m['progress']['percent'], $statuses);
        $coverage = $percents ? (int)round(array_sum($percents) / count($percents)) : 0;
        /* Marks and coverage weigh the same, so a learner who has covered the
           programme is listed even before their written work carries a score —
           their marks simply show as a dash. */
        if (!$marks['count'] && $coverage <= 0 && !($work[$learner['id']] ?? 0)) continue;
        $scored = $marks['count'] ? (int)round($marks['sum'] / $marks['count']) : null;
        $ranked[] = [
            'name' => $learner['full_name'],
            'displayName' => public_login_display_name($learner['full_name']),
            'className' => $learner['class_name'] ?: null,
            'photo' => public_login_photo($learner['photo'] ?? null),
            'marks' => $scored, 'coverage' => $coverage,
            'score' => $scored === null ? $coverage : (int)round(($scored + $coverage) / 2),
            'activityCount' => $marks['count'], 'work' => (int)($work[$learner['id']] ?? 0),
        ];
    }
    usort($ranked, function ($a, $b) {
        if ($b['score'] !== $a['score']) return $b['score'] <=> $a['score'];
        $am = $a['marks'] === null ? -1 : $a['marks'];
        $bm = $b['marks'] === null ? -1 : $b['marks'];
        if ($bm !== $am) return $bm <=> $am;
        if ($b['coverage'] !== $a['coverage']) return $b['coverage'] <=> $a['coverage'];
        if ($b['activityCount'] !== $a['activityCount']) return $b['activityCount'] <=> $a['activityCount'];
        return strcasecmp((string)$a['name'], (string)$b['name']);
    });
    $ranked = array_slice($ranked, 0, $limit);
    foreach ($ranked as $index => &$row) $row['rank'] = $index + 1;
    unset($row);
    return $ranked;
}

function r_public_top_performers($user, $body, $params, $token, $query): array {
    /* The ranking follows the latest scored work, so never let a browser or a
       proxy serve yesterday's order. */
    header('Cache-Control: no-store, max-age=0');
    $slug = trim((string)($query['slug'] ?? ''));
    need($slug !== '', 'Account required', 400);
    $st = db()->prepare('SELECT * FROM tenants WHERE slug=? LIMIT 1');
    $st->execute([$slug]);
    $tenant = $st->fetch();
    need($tenant, 'Portal not found', 404);
    $limit = (int)($query['limit'] ?? 10);
    return [
        'ok' => true,
        'tenant' => ['slug' => $tenant['slug'], 'name' => $tenant['name']],
        'basis' => 'Average of scored objective answers and written-answer key-word coverage.',
        'performers' => public_login_top_performers((string)$tenant['id'], $limit),
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

/* The learner's page says "I am still here" every few seconds. A session that
   stops beating is ended, so the sign-in dies with the window instead of
   surviving on the machine. Staff pages never call it (and never need to). */
function r_auth_beat($user, $body, $params, $token, $query): array {
    need($user, 'Sign in required', 401);
    beat_session($token);
    return ['leaveLocked' => student_leave_locked($user), 'idleMs' => STUDENT_IDLE_SECONDS * 1000];
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
    /* the account's own Letter of Christ first, then the program-wide one — but a
       pointer can go stale, so fall back to the newest readable letter rather than
       showing "not configured yet" */
    $lib = resolve_letter_for($tenant);
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
            'id' => $lib['id'] ?? null,
            'title' => $lib['title'] ?? '',
            'text' => $lib['text'] ?? '',
            'media' => media_out($lib),
            'done' => (bool)($fresh['letter_feedback_at'] ?? null),
            'feedbackAt' => iso($fresh['letter_feedback_at'] ?? null),
        ],
        'letterVideo' => $vid ? ['id' => $vid['id'], 'title' => $vid['title'], 'url' => $vid['url']] : null,
        'optionalVideoSeen' => (bool)($fresh['optional_video_seen'] ?? false),
    ];
}

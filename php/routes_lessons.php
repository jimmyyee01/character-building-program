<?php
/* routes_lessons.php â€” live video classes (PHP + MySQL backend).
   Mirrors server/live.js exactly:
     - a class is started now or scheduled for later;
     - the creator's reach decides who is told: super -> everybody (or one
       account when chosen), tenant_admin -> their whole account, supervisor ->
       only the learners they supervise;
     - every invited person receives an alert carrying the join link
       (/live?code=CODE), and that link is the way into the room;
     - the host's browser turns what is said into captions, the room polls for
       them, and the transcript stays after the class ends.

   Creators: super, tenant_admin, supervisor. Learners only ever receive the
   alert and the room it opens. */

const LIVE_CAPTION_CAP = 4000;
const LIVE_PRESENCE_STALE = 600;      /* seconds a seat survives without a beat */
const LIVE_PRESENCE_LIVE = 90;        /* "in the room" = heard from this recently */
const LIVE_DEFAULT_DOMAIN = 'meet.jit.si';
const LIVE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LIVE_LIST_MAX = 200;

/* ---------------------------------------------------------------- tables --- */
function live_lessons_table_ready(): void {
    static $ready = false;
    if ($ready) return;
    $pdo = db();
    $pdo->exec("CREATE TABLE IF NOT EXISTS live_lessons (
        id VARCHAR(64) PRIMARY KEY,
        code VARCHAR(12) NOT NULL DEFAULT '',
        scope VARCHAR(20) NOT NULL DEFAULT 'account',
        tenant_id VARCHAR(64) NULL,
        title VARCHAR(255) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
        scheduled_at DATETIME NULL,
        started_at DATETIME NULL,
        ended_at DATETIME NULL,
        creator_id VARCHAR(64) NOT NULL,
        creator_name VARCHAR(160) NULL,
        creator_role VARCHAR(30) NULL,
        recipient_ids_json LONGTEXT NOT NULL,
        join_url VARCHAR(1000) NULL,
        room VARCHAR(64) NULL,
        caption_seq INT NOT NULL DEFAULT 0,
        caption_count INT NOT NULL DEFAULT 0,
        scheduled_alert_sent TINYINT(1) NOT NULL DEFAULT 0,
        start_alert_sent TINYINT(1) NOT NULL DEFAULT 0,
        notified TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_live_lessons_code (code),
        INDEX idx_live_lessons_tenant (tenant_id),
        INDEX idx_live_lessons_creator (creator_id),
        INDEX idx_live_lessons_status (status),
        INDEX idx_live_lessons_scheduled (scheduled_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    /* An install from the first version of this screen only has the meeting
       link. The room, the code and the live state arrive as extra columns, so
       nothing written before is lost. */
    $wanted = [
        'code' => "VARCHAR(12) NOT NULL DEFAULT ''",
        'scope' => "VARCHAR(20) NOT NULL DEFAULT 'account'",
        'status' => "VARCHAR(20) NOT NULL DEFAULT 'scheduled'",
        'started_at' => 'DATETIME NULL',
        'ended_at' => 'DATETIME NULL',
        'creator_name' => 'VARCHAR(160) NULL',
        'creator_role' => 'VARCHAR(30) NULL',
        'room' => 'VARCHAR(64) NULL',
        'caption_seq' => 'INT NOT NULL DEFAULT 0',
        'caption_count' => 'INT NOT NULL DEFAULT 0',
        'scheduled_alert_sent' => 'TINYINT(1) NOT NULL DEFAULT 0',
        'start_alert_sent' => 'TINYINT(1) NOT NULL DEFAULT 0',
    ];
    foreach ($wanted as $column => $spec) {
        if (!has_column('live_lessons', $column)) {
            $pdo->exec("ALTER TABLE `live_lessons` ADD COLUMN `{$column}` {$spec}");
        }
    }
    $pdo->exec("CREATE TABLE IF NOT EXISTS live_captions (
        id VARCHAR(64) PRIMARY KEY,
        lesson_id VARCHAR(64) NOT NULL,
        seq INT NOT NULL,
        at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        speaker_id VARCHAR(64) NULL,
        speaker_name VARCHAR(160) NULL,
        text TEXT NOT NULL,
        INDEX idx_live_captions_lesson (lesson_id, seq)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS live_presence (
        id VARCHAR(130) PRIMARY KEY,
        lesson_id VARCHAR(64) NOT NULL,
        user_id VARCHAR(64) NOT NULL,
        name VARCHAR(160) NULL,
        role VARCHAR(30) NULL,
        joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_live_presence_lesson (lesson_id, last_seen_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    /* The alert that carries a live class must also carry its code, otherwise
       the alerts panel cannot open the room it announces. */
    if (!has_column('notifications', 'live_code')) {
        $pdo->exec('ALTER TABLE `notifications` ADD COLUMN `live_code` VARCHAR(12) NULL');
    }
    if (!has_column('notifications', 'live_url')) {
        $pdo->exec('ALTER TABLE `notifications` ADD COLUMN `live_url` VARCHAR(300) NULL');
    }
    /* a class written by the first version has no code and no room yet */
    $old = $pdo->query("SELECT id FROM live_lessons WHERE code='' OR code IS NULL")->fetchAll(PDO::FETCH_COLUMN);
    foreach ($old as $id) {
        $pdo->prepare('UPDATE live_lessons SET code=?, room=COALESCE(room, ?) WHERE id=?')
            ->execute([live_unique_code(), live_room_name(), $id]);
    }
    $ready = true;
}

/* --------------------------------------------------------------- helpers --- */
function live_new_code(): string {
    $bytes = random_bytes(6);
    $out = '';
    $last = strlen(LIVE_CODE_ALPHABET) - 1;
    for ($i = 0; $i < 6; $i++) $out .= LIVE_CODE_ALPHABET[ord($bytes[$i]) % ($last + 1)];
    return $out;
}
function live_unique_code(): string {
    $pdo = db();
    $st = $pdo->prepare('SELECT COUNT(*) FROM live_lessons WHERE code=?');
    for ($try = 0; $try < 40; $try++) {
        $code = live_new_code();
        $st->execute([$code]);
        if ((int)$st->fetchColumn() === 0) return $code;
    }
    return strtoupper(substr(bin2hex(random_bytes(5)), 0, 8));
}
/* The room name is NOT the join code: a code is read aloud in class, the room
   name must be impossible to guess your way into. */
function live_room_name(): string {
    return 'cbp-' . bin2hex(random_bytes(8));
}

/* Where the video lives. Default is the public Jitsi Meet; a school that runs
   its own Jitsi server only has to type its domain in Settings. 'off' turns the
   built-in room off (a class is then its meeting link and its transcript). */
function live_video_domain(): ?string {
    $settings = get_settings();
    $raw = strtolower(trim((string)($settings['video_domain'] ?? '')));
    if ($raw === 'off' || $raw === 'none' || $raw === '0') return null;
    $host = preg_replace('#^https?://#', '', $raw) ?? '';
    $host = preg_replace('#/.*$#', '', $host) ?? '';
    $host = preg_replace('/\s+/', '', $host) ?? '';
    return preg_match('/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/', $host) === 1 ? $host : LIVE_DEFAULT_DOMAIN;
}
function live_video_base(?array $row): ?string {
    $domain = live_video_domain();
    $room = (string)($row['room'] ?? '');
    if ($domain === null || $room === '') return null;
    return 'https://' . $domain . '/' . $room;
}

/* Is this request already secure? A browser gives a camera and a microphone only
   to an https address, and the room page has to know whether such an address
   exists before it promises video (a link opened over plain http is exactly the
   case where the video server says "WebRTC is not available"). */
function live_secure(): bool {
    $https = strtolower((string)($_SERVER['HTTPS'] ?? ''));
    if ($https !== '' && $https !== 'off' && $https !== '0') return true;
    if (strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https') return true;
    return (string)($_SERVER['SERVER_PORT'] ?? '') === '443';
}

function live_room_path(array $row): string {
    return '/live?code=' . rawurlencode((string)($row['code'] ?? ''));
}
/* The room routes match /api/live-class/<code>: the dispatcher offers the
   captured segment both by number and as 'id', so either one is the code. */
function live_param(array $params): string {
    return (string)($params['code'] ?? ($params['id'] ?? ($params[0] ?? '')));
}
function live_who(?array $user): string {
    foreach (['full_name', 'email', 'username'] as $key) {
        if (!empty($user[$key])) return (string)$user[$key];
    }
    return 'Host';
}
/* 12 Nov 2026 at 14:30, spelled out for an alert. */
function live_when_text($dt): string {
    $ts = $dt ? strtotime((string)$dt) : false;
    if ($ts === false) return 'soon';
    return date('d M Y', $ts) . ' at ' . date('H:i', $ts);
}

function live_find($value): ?array {
    $key = trim((string)$value);
    if ($key === '') return null;
    live_lessons_table_ready();
    $pdo = db();
    $st = $pdo->prepare('SELECT * FROM live_lessons WHERE id=? LIMIT 1');
    $st->execute([$key]);
    $row = $st->fetch();
    if ($row) return $row;
    $st = $pdo->prepare('SELECT * FROM live_lessons WHERE code=? LIMIT 1');
    $st->execute([strtoupper($key)]);
    $row = $st->fetch();
    return $row ?: null;
}
function live_recipients(array $row): array {
    return array_map('strval', jdec($row['recipient_ids_json'] ?? null, []));
}
function live_is_host(?array $user, ?array $row): bool {
    if (!$user || !$row) return false;
    if ((string)$row['creator_id'] === (string)$user['id']) return true;
    return ($user['role'] ?? '') === 'super';
}
function live_is_invited(?array $user, ?array $row): bool {
    if (!$user || !$row) return false;
    if (($row['scope'] ?? 'account') === 'all') return true;   /* the whole system */
    return in_array((string)$user['id'], live_recipients($row), true);
}
function live_can_watch(?array $user, ?array $row): bool {
    return live_is_host($user, $row) || live_is_invited($user, $row);
}

/* ---------------------------------------------------------------- shape --- */
function live_public(array $row, ?array $user): array {
    return [
        'id' => (string)$row['id'],
        'code' => (string)($row['code'] ?? ''),
        'title' => (string)$row['title'],
        'scope' => (string)($row['scope'] ?? 'account'),
        'status' => (string)($row['status'] ?? 'scheduled'),
        'scheduledAt' => iso($row['scheduled_at'] ?? null),
        'startedAt' => iso($row['started_at'] ?? null),
        'endedAt' => iso($row['ended_at'] ?? null),
        'creatorId' => (string)$row['creator_id'],
        'creatorName' => (string)($row['creator_name'] ?? ''),
        'creatorRole' => $row['creator_role'] ?? null,
        'tenantId' => $row['tenant_id'] === null ? null : (string)$row['tenant_id'],
        'recipients' => count(live_recipients($row)),
        'joinUrl' => ($row['join_url'] ?? '') === '' ? null : (string)$row['join_url'],
        'roomPath' => live_room_path($row),
        'videoBase' => live_video_base($row),
        /* true when this deployment answers on https: the only address a
           browser will hand a camera to */
        'secure' => live_secure(),
        'securePort' => null,
        'captions' => (int)($row['caption_count'] ?? 0),
        'canHost' => live_is_host($user, $row),
        'canJoin' => live_can_watch($user, $row),
        'createdAt' => iso($row['created_at'] ?? null),
    ];
}

/* A class, if this person may see it at all: a wrong code must not even say
   whether it exists. */
function live_readable(?array $user, $value): array {
    need($user, 'Sign in required', 401);
    $row = live_find($value);
    need($row !== null, 'Live class not found', 404);
    need(live_can_watch($user, $row), 'This class is not for your account', 403);
    return $row;
}
function live_editable(?array $user, $value): array {
    need($user, 'Sign in required', 401);
    $row = live_find($value);
    need($row !== null, 'Live class not found', 404);
    need(live_is_host($user, $row), 'Only the host can change this class', 403);
    return $row;
}

/* ------------------------------------------------------------- audience --- */
/* Who is told about this class. The role decides the reach: a supervisor can
   never widen it to a whole account, an account admin can never leave it. */
function live_audience(array $user, array $body): array {
    $pdo = db();
    $role = (string)($user['role'] ?? '');
    $ids = function (string $sql, array $args): array {
        $st = db()->prepare($sql);
        $st->execute($args);
        return array_values(array_unique(array_map('strval', $st->fetchAll(PDO::FETCH_COLUMN))));
    };
    if ($role === 'supervisor') {
        return [
            'scope' => 'supervised', 'tenantId' => $user['tenant_id'] ?? null,
            'recipientIds' => $ids('SELECT id FROM users WHERE suspended=0 AND id<>? AND supervisor_id=?',
                [$user['id'], $user['id']]),
        ];
    }
    if ($role === 'tenant_admin') {
        return [
            'scope' => 'account', 'tenantId' => $user['tenant_id'] ?? null,
            'recipientIds' => $ids('SELECT id FROM users WHERE suspended=0 AND id<>? AND tenant_id=?',
                [$user['id'], $user['tenant_id'] ?? null]),
        ];
    }
    /* super: one account on request, otherwise every user of the system */
    $target = trim((string)($body['tenantId'] ?? ($body['accountId'] ?? '')));
    if ($target !== '' && $target !== 'all') {
        $st = $pdo->prepare('SELECT * FROM tenants WHERE id=? LIMIT 1');
        $st->execute([$target]);
        $tenant = $st->fetch();
        need($tenant !== false && $tenant !== null, 'Account not found', 404);
        return [
            'scope' => 'account', 'tenantId' => (string)$tenant['id'],
            'recipientIds' => $ids('SELECT id FROM users WHERE suspended=0 AND id<>? AND tenant_id=?',
                [$user['id'], $tenant['id']]),
        ];
    }
    return [
        'scope' => 'all', 'tenantId' => null,
        'recipientIds' => $ids('SELECT id FROM users WHERE suspended=0 AND id<>?', [$user['id']]),
    ];
}

/* --------------------------------------------------------------- alerts --- */
/* One alert per invited person. It carries the join code, so the message in the
   alerts panel is itself the way in. */
function live_notify(array $row, string $kind): int {
    $pdo = db();
    $path = live_room_path($row);
    $title = ($kind === 'scheduled' ? 'Live class scheduled: ' : 'Live class starting: ')
        . (string)$row['title'];
    $body = $kind === 'scheduled'
        ? live_when_text($row['scheduled_at'] ?? null) . ' â€” join here: ' . $path
        : 'Join now: ' . $path;
    $columns = ['id', 'user_id', 'type', 'title', 'body', 'conversation_id', 'created_at'];
    $hasCode = has_column('notifications', 'live_code');
    $hasUrl = has_column('notifications', 'live_url');
    if ($hasCode) $columns[] = 'live_code';
    if ($hasUrl) $columns[] = 'live_url';
    $st = $pdo->prepare('INSERT INTO notifications (' . implode(',', $columns) . ') VALUES ('
        . implode(',', array_fill(0, count($columns), '?')) . ')');
    $sent = 0;
    foreach (live_recipients($row) as $userId) {
        $args = [uid('ntf'), $userId, 'live_class', $title, $body, null, now_dt()];
        if ($hasCode) $args[] = (string)$row['code'];
        if ($hasUrl) $args[] = $path;
        $st->execute($args);
        $sent++;
    }
    return $sent;
}

/* A class that has reached its time becomes live and alerts everybody once. */
function live_go_live(array &$row): void {
    $row['status'] = 'live';
    if (empty($row['started_at'])) $row['started_at'] = now_dt();
    if (!(int)($row['start_alert_sent'] ?? 0)) {
        live_notify($row, 'now');
        $row['start_alert_sent'] = 1;
        $row['notified'] = 1;
    }
}
/* Called on every read of the class list, of a room and of the alerts, so a
   scheduled class opens itself on time. */
function live_due_tick(): void {
    if (!has_table('live_lessons')) return;
    live_lessons_table_ready();
    $pdo = db();
    $rows = $pdo->query("SELECT * FROM live_lessons WHERE status='scheduled'")->fetchAll();
    foreach ($rows as $row) {
        $at = strtotime((string)($row['scheduled_at'] ?? ''));
        if ($at === false || $at > time()) continue;
        live_go_live($row);
        $pdo->prepare('UPDATE live_lessons SET status=?, started_at=?, start_alert_sent=?, notified=? WHERE id=?')
            ->execute([$row['status'], $row['started_at'], (int)$row['start_alert_sent'],
                (int)$row['notified'], $row['id']]);
    }
}

/* --------------------------------------------------------------- create --- */
function r_live_lessons_create($user, $body, $params, $token, $query) {
    $user = require_role($user, ['super', 'tenant_admin', 'supervisor']);
    live_lessons_table_ready();
    $body = is_array($body) ? $body : [];

    $title = trim((string)($body['title'] ?? ''));
    need($title !== '', 'Title required');
    need(mb_strlen($title) <= 200, 'Title is too long');

    /* A meeting link is optional now (the room is built in) but still welcome for
       a host who prefers Zoom or Google Meet. */
    $external = '';
    foreach (['joinUrl', 'link', 'zoomUrl', 'meetingUrl'] as $key) {
        if (trim((string)($body[$key] ?? '')) !== '') { $external = trim((string)$body[$key]); break; }
    }
    if ($external !== '') {
        need(preg_match('#^https?://\S+$#i', $external) === 1,
            'Meeting link must start with http:// or https://');
        need(strlen($external) <= 1000, 'Meeting link is too long');
    }

    /* "Start now" is the default: no date means the class begins immediately. */
    $rawWhen = trim((string)($body['scheduledAt'] ?? ''));
    $startNow = ($body['startNow'] ?? null) === true || ($body['startNow'] ?? '') === 'true' || $rawWhen === '';
    $scheduledAt = now_dt();
    if (!$startNow) {
        $ts = strtotime($rawWhen);
        need($ts !== false, 'Invalid lesson date and time');
        $scheduledAt = date('Y-m-d H:i:s', $ts);
    }

    $reach = live_audience($user, $body);
    $row = [
        'id' => uid('lesson'),
        'code' => live_unique_code(),
        'scope' => $reach['scope'],
        'tenant_id' => $reach['tenantId'],
        'title' => $title,
        'status' => 'scheduled',
        'scheduled_at' => $scheduledAt,
        'started_at' => null,
        'ended_at' => null,
        'creator_id' => (string)$user['id'],
        'creator_name' => live_who($user),
        'creator_role' => (string)($user['role'] ?? ''),
        'recipient_ids_json' => jenc($reach['recipientIds']),
        'join_url' => $external,
        'room' => live_room_name(),
        'caption_seq' => 0,
        'caption_count' => 0,
        'scheduled_alert_sent' => 0,
        'start_alert_sent' => 0,
        'notified' => 0,
        'created_at' => now_dt(),
    ];
    if ($startNow) {
        $row['status'] = 'live';
        $row['started_at'] = now_dt();
        $row['start_alert_sent'] = 1;
        $row['notified'] = 1;
    } else {
        $row['scheduled_alert_sent'] = 1;
    }
    $columnNames = array_keys($row);
    db()->prepare('INSERT INTO live_lessons (`' . implode('`,`', $columnNames) . '`) VALUES ('
        . implode(',', array_fill(0, count($columnNames), '?')) . ')')
        ->execute(array_values($row));

    /* the alert is what carries the link to everybody the class reaches */
    live_notify($row, $startNow ? 'now' : 'scheduled');

    return [
        'ok' => true,
        'lesson' => live_public($row, $user),
        'invited' => count($reach['recipientIds']),
        'logEntry' => [
            'action' => $startNow ? 'started' : 'scheduled',
            'entity' => 'live-class', 'entityId' => $row['id'], 'label' => $title,
        ],
    ];
}

/* ----------------------------------------------------------------- list --- */
function r_live_lessons_list($user, $body, $params, $token, $query) {
    $user = require_role($user, ['super', 'tenant_admin', 'supervisor', 'student', 'member', 'teacher']);
    live_due_tick();
    $pdo = db();
    $role = (string)($user['role'] ?? '');
    if ($role === 'super') {
        $rows = $pdo->query('SELECT * FROM live_lessons LIMIT 1000')->fetchAll();
    } elseif ($role === 'tenant_admin') {
        $st = $pdo->prepare("SELECT * FROM live_lessons WHERE scope='all' OR tenant_id=? LIMIT 1000");
        $st->execute([$user['tenant_id'] ?? null]);
        $rows = $st->fetchAll();
    } else {
        $rows = $pdo->query('SELECT * FROM live_lessons LIMIT 1000')->fetchAll();
        $rows = array_values(array_filter($rows, function ($row) use ($user) {
            return (string)$row['creator_id'] === (string)$user['id'] || live_can_watch($user, $row);
        }));
    }
    /* live first, then what is still coming, then the past */
    $rank = ['live' => 0, 'scheduled' => 1, 'ended' => 2, 'cancelled' => 3];
    usort($rows, function ($a, $b) use ($rank) {
        $ra = $rank[(string)($a['status'] ?? 'scheduled')] ?? 1;
        $rb = $rank[(string)($b['status'] ?? 'scheduled')] ?? 1;
        if ($ra !== $rb) return $ra <=> $rb;
        return strcmp((string)($a['scheduled_at'] ?? ''), (string)($b['scheduled_at'] ?? ''));
    });
    $live = array_filter($rows, function ($row) { return ($row['status'] ?? '') === 'live'; });
    return [
        'ok' => true,
        'lessons' => array_map(function ($row) use ($user) { return live_public($row, $user); },
            array_slice($rows, 0, LIVE_LIST_MAX)),
        'live' => count($live),
        'total' => count($rows),
    ];
}

/* --------------------------------------------------------- start / end ---- */
function r_live_lessons_start($user, $body, $params, $token, $query) {
    $row = live_editable($user, $params['id'] ?? '');
    need(!in_array((string)($row['status'] ?? ''), ['ended', 'cancelled'], true),
        'This class has already finished');
    live_go_live($row);
    db()->prepare('UPDATE live_lessons SET status=?, started_at=?, start_alert_sent=?, notified=? WHERE id=?')
        ->execute([$row['status'], $row['started_at'], (int)$row['start_alert_sent'],
            (int)$row['notified'], $row['id']]);
    $row = live_find((string)$row['id']) ?? $row;
    return [
        'ok' => true,
        'lesson' => live_public($row, $user),
        'logEntry' => ['action' => 'started', 'entity' => 'live-class',
            'entityId' => (string)$row['id'], 'label' => (string)$row['title']],
    ];
}
function live_close_class($user, $params, string $status, string $word) {
    $row = live_editable($user, $params['id'] ?? '');
    if ($status === 'ended') {
        need(in_array((string)($row['status'] ?? ''), ['live', 'scheduled'], true),
            'This class is already over');
    } else {
        need((string)($row['status'] ?? '') !== 'ended', 'This class has already ended');
    }
    db()->prepare('UPDATE live_lessons SET status=?, ended_at=? WHERE id=?')
        ->execute([$status, now_dt(), $row['id']]);
    /* nobody keeps a seat in a room that is closed */
    db()->prepare('DELETE FROM live_presence WHERE lesson_id=?')->execute([$row['id']]);
    $row = live_find((string)$row['id']) ?? $row;
    return [
        'ok' => true,
        'lesson' => live_public($row, $user),
        'logEntry' => ['action' => $word, 'entity' => 'live-class',
            'entityId' => (string)$row['id'], 'label' => (string)$row['title']],
    ];
}
function r_live_lessons_end($user, $body, $params, $token, $query) {
    return live_close_class($user, $params, 'ended', 'ended');
}
function r_live_lessons_cancel($user, $body, $params, $token, $query) {
    return live_close_class($user, $params, 'cancelled', 'cancelled');
}

/* ------------------------------------------------------------- the room --- */
function live_roster(array $row): array {
    $since = date('Y-m-d H:i:s', time() - LIVE_PRESENCE_LIVE);
    $st = db()->prepare('SELECT * FROM live_presence WHERE lesson_id=? AND last_seen_at>=? ORDER BY joined_at ASC, user_id ASC');
    $st->execute([$row['id'], $since]);
    $out = [];
    foreach ($st->fetchAll() as $seat) {
        $out[] = [
            'userId' => (string)$seat['user_id'], 'name' => (string)($seat['name'] ?? ''),
            'role' => $seat['role'] ?? null,
            'host' => (string)$seat['user_id'] === (string)$row['creator_id'],
        ];
    }
    return $out;
}
function r_live_room($user, $body, $params, $token, $query) {
    live_due_tick();
    $row = live_readable($user, live_param($params));
    return [
        'ok' => true,
        'lesson' => live_public($row, $user),
        'me' => ['id' => (string)$user['id'], 'name' => live_who($user),
            'role' => (string)($user['role'] ?? ''), 'host' => live_is_host($user, $row)],
        'roster' => live_roster($row),
        'captions' => live_caption_lines($row, 0, 60),
        'seq' => (int)($row['caption_seq'] ?? 0),
    ];
}
/* A heartbeat that doubles as "I am in the room": presence is what fills the
   participant list, and it fades on its own when a browser disappears. */
function r_live_join($user, $body, $params, $token, $query) {
    live_due_tick();
    $row = live_readable($user, live_param($params));
    need((string)($row['status'] ?? '') !== 'cancelled', 'This class was cancelled');
    $pdo = db();
    $now = now_dt();
    $seatId = substr((string)$row['id'] . ':' . (string)$user['id'], 0, 130);
    $st = $pdo->prepare('SELECT id FROM live_presence WHERE id=? LIMIT 1');
    $st->execute([$seatId]);
    if ($st->fetchColumn()) {
        $pdo->prepare('UPDATE live_presence SET last_seen_at=?, name=?, role=? WHERE id=?')
            ->execute([$now, live_who($user), (string)($user['role'] ?? ''), $seatId]);
    } else {
        $pdo->prepare('INSERT INTO live_presence (id, lesson_id, user_id, name, role, joined_at, last_seen_at)
            VALUES (?,?,?,?,?,?,?)')
            ->execute([$seatId, $row['id'], (string)$user['id'], live_who($user),
                (string)($user['role'] ?? ''), $now, $now]);
    }
    /* tidy: nobody keeps a seat for ever */
    $pdo->prepare('DELETE FROM live_presence WHERE last_seen_at < ?')
        ->execute([date('Y-m-d H:i:s', time() - LIVE_PRESENCE_STALE)]);
    return [
        'ok' => true,
        'status' => (string)($row['status'] ?? 'scheduled'),
        'seq' => (int)($row['caption_seq'] ?? 0),
        'roster' => live_roster($row),
    ];
}

/* -------------------------------------------------------------- captions --- */
/* What is being said, in order. seq only grows, so a viewer asks for
   "everything after 40" and never misses or repeats a line. */
function live_caption_lines(array $row, $after, int $limit): array {
    $from = max(0, (int)$after);
    $max = max(1, min(400, $limit));
    $st = db()->prepare('SELECT * FROM live_captions WHERE lesson_id=? AND seq>? ORDER BY seq ASC LIMIT ' . $max);
    $st->execute([$row['id'], $from]);
    $out = [];
    foreach ($st->fetchAll() as $line) {
        $out[] = ['seq' => (int)$line['seq'], 'at' => iso($line['at']),
            'speaker' => (string)($line['speaker_name'] ?? ''), 'text' => (string)$line['text']];
    }
    return $out;
}
function r_live_captions($user, $body, $params, $token, $query) {
    $row = live_readable($user, live_param($params));
    return [
        'ok' => true,
        'status' => (string)($row['status'] ?? 'scheduled'),
        'seq' => (int)($row['caption_seq'] ?? 0),
        'lines' => live_caption_lines($row, $query['after'] ?? 0, 300),
    ];
}
/* Only the host's browser speaks into the transcript: the words come from the
   room it is running (the microphone being used for the class). */
function r_live_captions_add($user, $body, $params, $token, $query) {
    $row = live_editable($user, live_param($params));
    need((string)($row['status'] ?? '') === 'live', 'The class is not live', 409);
    $body = is_array($body) ? $body : [];
    $incoming = (isset($body['lines']) && is_array($body['lines'])) ? $body['lines'] : [$body];
    need(count($incoming) > 0, 'Nothing to save');
    need(count($incoming) <= 60, 'Too many lines at once');

    $pdo = db();
    $seq = (int)($row['caption_seq'] ?? 0);
    $count = (int)($row['caption_count'] ?? 0);
    $saved = 0;
    $insert = $pdo->prepare('INSERT INTO live_captions (id, lesson_id, seq, at, speaker_id, speaker_name, text)
        VALUES (?,?,?,?,?,?,?)');
    foreach ($incoming as $entry) {
        $text = trim(preg_replace('/\s+/u', ' ', (string)(is_array($entry)
            ? ($entry['text'] ?? ($entry['body'] ?? '')) : $entry)) ?? '');
        if ($text === '') continue;
        $text = mb_substr($text, 0, 500, 'UTF-8');
        $seq++;
        $insert->execute([uid('cap'), $row['id'], $seq, now_dt(), (string)$user['id'],
            live_who($user), $text]);
        $count++;
        $saved++;
    }
    need($saved > 0, 'Nothing to save');

    /* the oldest lines fall away, so a very long class cannot grow without end */
    $st = $pdo->prepare('SELECT COUNT(*) FROM live_captions WHERE lesson_id=?');
    $st->execute([$row['id']]);
    $total = (int)$st->fetchColumn();
    if ($total > LIVE_CAPTION_CAP) {
        $excess = $total - LIVE_CAPTION_CAP;
        $old = $pdo->prepare('SELECT id FROM live_captions WHERE lesson_id=? ORDER BY seq ASC LIMIT ' . $excess);
        $old->execute([$row['id']]);
        $del = $pdo->prepare('DELETE FROM live_captions WHERE id=?');
        foreach ($old->fetchAll(PDO::FETCH_COLUMN) as $id) $del->execute([$id]);
        $count = min($count, LIVE_CAPTION_CAP);
    }
    $pdo->prepare('UPDATE live_lessons SET caption_seq=?, caption_count=? WHERE id=?')
        ->execute([$seq, $count, $row['id']]);
    return ['ok' => true, 'seq' => $seq, 'saved' => $saved];
}

/* The whole transcript: for the host while the class runs, and for everybody
   who was invited once it is over. */
function r_live_lessons_transcript($user, $body, $params, $token, $query) {
    $row = live_readable($user, $params['id'] ?? '');
    $lines = live_caption_lines($row, 0, 4000);
    $parts = [];
    foreach ($lines as $line) {
        $ts = strtotime((string)$line['at']);
        $parts[] = '[' . ($ts === false ? '' : date('H:i:s', $ts)) . '] '
            . $line['speaker'] . ': ' . $line['text'];
    }
    $text = implode("\n", $parts);
    return [
        'ok' => true,
        'lesson' => live_public($row, $user),
        'lines' => $lines,
        'text' => $text,
        'words' => $text === '' ? 0 : count(preg_split('/\s+/', $text, -1, PREG_SPLIT_NO_EMPTY)),
    ];
}

<?php
/* routes_lessons.php — live video lesson endpoints (Node-compatible).
   Creators: super (everyone), tenant_admin (their account), supervisor
   (their assigned learners). Learners only receive lessons addressed to them. */

function live_lessons_table_ready(): void {
    static $ready = false;
    if ($ready) return;
    db()->exec('CREATE TABLE IF NOT EXISTS live_lessons (
        id VARCHAR(64) PRIMARY KEY,
        tenant_id VARCHAR(64) NULL,
        title VARCHAR(255) NOT NULL,
        scheduled_at DATETIME NOT NULL,
        creator_id VARCHAR(64) NOT NULL,
        recipient_ids_json LONGTEXT NOT NULL,
        join_url VARCHAR(1000) NOT NULL,
        notified TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_live_lessons_tenant (tenant_id),
        INDEX idx_live_lessons_creator (creator_id),
        INDEX idx_live_lessons_scheduled (scheduled_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    $ready = true;
}

function live_lesson_public(array $row): array {
    return [
        'id' => (string)$row['id'],
        'title' => (string)$row['title'],
        'scheduledAt' => iso($row['scheduled_at'] ?? null),
        'creatorId' => (string)$row['creator_id'],
        'tenantId' => $row['tenant_id'] === null ? null : (string)$row['tenant_id'],
        'recipientIds' => jdec($row['recipient_ids_json'] ?? null, []),
        'room' => null,
        'joinUrl' => (string)$row['join_url'],
        'notified' => (bool)($row['notified'] ?? false),
        'createdAt' => iso($row['created_at'] ?? null),
    ];
}

function live_lesson_join_url($value): string {
    $url = trim((string)$value);
    return preg_match('#^https?://\S+$#i', $url) ? $url : '';
}

function r_live_lessons_list($user, $body, $params, $token, $query) {
    $user = require_role($user, ['super', 'tenant_admin', 'supervisor', 'student', 'member', 'teacher']);
    live_lessons_table_ready();
    $pdo = db();
    $role = (string)($user['role'] ?? '');

    if ($role === 'super') {
        $stmt = $pdo->query('SELECT * FROM live_lessons ORDER BY scheduled_at ASC, created_at ASC LIMIT 200');
        $rows = $stmt->fetchAll();
    } else {
        $stmt = $pdo->prepare('SELECT * FROM live_lessons WHERE tenant_id=? ORDER BY scheduled_at ASC, created_at ASC LIMIT 200');
        $stmt->execute([$user['tenant_id'] ?? null]);
        $rows = $stmt->fetchAll();
        if ($role === 'supervisor') {
            $rows = array_values(array_filter($rows, function ($row) use ($user) {
                return (string)$row['creator_id'] === (string)$user['id'] ||
                    in_array((string)$user['id'], array_map('strval', jdec($row['recipient_ids_json'] ?? null, [])), true);
            }));
        } elseif ($role !== 'tenant_admin') {
            $rows = array_values(array_filter($rows, function ($row) use ($user) {
                return in_array((string)$user['id'], array_map('strval', jdec($row['recipient_ids_json'] ?? null, [])), true);
            }));
        }
    }

    return ['ok' => true, 'lessons' => array_map('live_lesson_public', $rows)];
}

function r_live_lessons_create($user, $body, $params, $token, $query) {
    $user = require_role($user, ['super', 'tenant_admin', 'supervisor']);
    live_lessons_table_ready();

    $title = trim((string)($body['title'] ?? ''));
    need($title !== '', 'Title required');

    $rawWhen = trim((string)($body['scheduledAt'] ?? ''));
    $when = $rawWhen === '' ? time() : strtotime($rawWhen);
    need($when !== false, 'Invalid lesson date and time');
    $scheduledAt = date('Y-m-d H:i:s', $when);

    $providedLink = '';
    foreach (['joinUrl', 'link', 'zoomUrl', 'meetingUrl'] as $key) {
        if (trim((string)($body[$key] ?? '')) !== '') { $providedLink = $body[$key]; break; }
    }
    $joinUrl = live_lesson_join_url($providedLink);
    need($joinUrl !== '', 'Meeting link must start with http:// or https://');
    need(strlen($joinUrl) <= 1000, 'Meeting link is too long');

    $pdo = db();
    $role = (string)($user['role'] ?? '');
    if ($role === 'super') {
        $stmt = $pdo->prepare('SELECT id FROM users WHERE id <> ?');
        $stmt->execute([$user['id']]);
    } elseif ($role === 'tenant_admin') {
        $stmt = $pdo->prepare('SELECT id FROM users WHERE tenant_id=? AND id <> ?');
        $stmt->execute([$user['tenant_id'] ?? null, $user['id']]);
    } else {
        $stmt = $pdo->prepare('SELECT id FROM users WHERE supervisor_id=?');
        $stmt->execute([$user['id']]);
    }
    $recipients = array_values(array_unique(array_map('strval', $stmt->fetchAll(PDO::FETCH_COLUMN))));

    $id = uid('lesson');
    $notified = $when <= time();
    $tenantId = $user['tenant_id'] ?? null;

    $pdo->beginTransaction();
    try {
        $insert = $pdo->prepare('INSERT INTO live_lessons
            (id, tenant_id, title, scheduled_at, creator_id, recipient_ids_json, join_url, notified)
            VALUES (?,?,?,?,?,?,?,?)');
        $insert->execute([$id, $tenantId, $title, $scheduledAt, $user['id'], jenc($recipients), $joinUrl, $notified ? 1 : 0]);

        if ($notified) {
            $notify = $pdo->prepare('INSERT INTO notifications
                (id, user_id, type, title, body, conversation_id, created_at)
                VALUES (?,?,?,?,?,?,?)');
            foreach ($recipients as $recipientId) {
                $notify->execute([uid('ntf'), $recipientId, 'live_lesson',
                    'Live lesson starting: ' . $title, 'Join now: ' . $joinUrl, null, now_dt()]);
            }
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    $stmt = $pdo->prepare('SELECT * FROM live_lessons WHERE id=? LIMIT 1');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    need($row, 'Lesson could not be read back', 500);
    return ['ok' => true, 'lesson' => live_lesson_public($row)];
}

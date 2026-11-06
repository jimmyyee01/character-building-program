<?php
declare(strict_types=1);
/* audit.php — the system log and the Trash (PHP + MySQL backend).
   ------------------------------------------------------------------
   Mirrors server/audit.js exactly:
     - every change is written to `activity_log` with the person, their role,
       their account, the item and the time;
     - a deletion copies the record (and what hangs off it) into `trash`
       before the row goes, so an admin can put it back or delete it for good.
   Both tables are created by database.sql / migrate.php. */

const LOG_KEEP = 20000;
const TRASH_KEEP = 5000;

/* Collections (as the Node backend names them) that may be put back.
   'assessment' is not a table: a category or question travels in the payload
   and is re-inserted into the definition by routes_audit.php. */
const TRASH_COLLECTIONS = ['portals', 'tenants', 'users', 'modules', 'library',
    'books', 'chapters', 'objectives', 'chapter_reads', 'submissions',
    'certificates', 'thoughts', 'assessment'];
/* the ones that really are tables */
const TRASH_TABLES = ['portals', 'tenants', 'users', 'modules', 'library',
    'books', 'chapters', 'objectives', 'chapter_reads', 'submissions',
    'certificates', 'thoughts'];

function clip_text($value, int $max): string {
    $text = trim(preg_replace('/\s+/u', ' ', (string)($value ?? '')) ?? '');
    return mb_strlen($text, 'UTF-8') > $max
        ? mb_substr($text, 0, $max - 3, 'UTF-8') . '...' : $text;
}
function actor_name(?array $user): string {
    if (!$user) return 'Unknown';
    foreach (['full_name', 'email', 'student_number', 'username', 'role'] as $key) {
        if (!empty($user[$key])) return clip_text($user[$key], 80);
    }
    return 'Unknown';
}
function tenant_name_of(?string $id): ?string {
    if (!$id) return null;
    $st = db()->prepare('SELECT name FROM tenants WHERE id=? LIMIT 1');
    $st->execute([$id]);
    $name = $st->fetchColumn();
    return $name === false ? null : (string)$name;
}
function client_ip(): ?string {
    $forwarded = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
    $first = $forwarded !== '' ? trim(explode(',', (string)$forwarded)[0]) : '';
    $ip = $first !== '' ? $first : (string)($_SERVER['REMOTE_ADDR'] ?? '');
    return $ip === '' ? null : clip_text($ip, 60);
}

/* --------------------------------------------------------------- shapes --- */
/* Which kind of thing a route touches, and where a readable name lives. The
   specific routes come first: /api/books/1/chapters makes a CHAPTER. */
function shape_of(string $path, array $body): array {
    $text = function (array $keys) use ($body): string {
        foreach ($keys as $key) {
            if (!empty($body[$key]) && is_scalar($body[$key])) return (string)$body[$key];
        }
        return '';
    };
    $shapes = [
        ['#^/api/upload$#', 'file', $text(['file'])],
        ['#^/api/auth/(login|super-login)$#', 'session', $text(['identifier', 'username'])],
        ['#^/api/auth/logout$#', 'session', ''],
        ['#^/api/auth/register$#', 'session', $text(['email', 'identifier'])],
        ['#^/api/tenant/settings$#', 'settings', 'Account letter'],
        ['#^/api/flow/letter-feedback$#', 'letter', 'Answer to the letter'],
        ['#^/api/flow/optional-video-seen$#', 'video', 'Optional video'],
        ['#^/api/assessment/(pre|post)$#', 'assessment', $text(['kind', 'type']) ?: 'Self-assessment'],
        ['#^/api/super/assessment/categories/[^/]+/statements$#', 'assessment-statement', $text(['text'])],
        ['#^/api/super/assessment/categories#', 'assessment-category', $text(['title'])],
        ['#^/api/super/assessment/statements#', 'assessment-statement', $text(['text'])],
        ['#^/api/super/assessment$#', 'assessment', 'Self-assessment'],
        ['#^/api/chapter/[^/]+/read$#', 'reading', 'Chapter pages'],
        ['#^/api/reading/open$#', 'reading', $text(['title', 'kind'])],
        ['#^/api/submissions$#', 'submission', $text(['type'])],
        ['#^/api/certificates/issue$#', 'certificate', 'Certificate'],
        ['#^/api/videos/[^/]+/watched$#', 'video', 'Library video'],
        ['#^/api/thoughts$#', 'thought', $text(['text'])],
        ['#^/api/super/portals#', 'portal', $text(['name'])],
        ['#^/api/super/tenants#', 'tenant', $text(['name'])],
        ['#^/api/super/modules#', 'module', $text(['title'])],
        ['#^/api/super/settings$#', 'settings', 'Global settings'],
        ['#^/api/super/video-alerts$#', 'video-alert', 'Video alert points'],
        ['#^/api/super/trash#', 'trash', ''],
        ['#^/api/super/users#', 'user', $text(['fullName', 'full_name'])],
        ['#^/api/books/[^/]+/chapters$#', 'chapter', $text(['title'])],
        ['#^/api/books#', 'book', $text(['title'])],
        ['#^/api/chapters/[^/]+/objectives$#', 'objective', $text(['question'])],
        ['#^/api/chapters#', 'chapter', $text(['title'])],
        ['#^/api/objectives#', 'objective', $text(['question'])],
        ['#^/api/library#', 'library', $text(['title'])],
        ['#^/api/(super/)?users#', 'user', $text(['fullName', 'full_name'])],
        ['#^/api/admin/branding$#', 'branding', 'Logo'],
        ['#^/api/messages#', 'message', $text(['body', 'text'])],
        ['#^/api/notifications#', 'notification', 'Notification'],
        ['#^/api/live-lessons$#', 'live-lesson', $text(['title'])],
    ];
    foreach ($shapes as [$re, $entity, $label]) {
        if (preg_match($re, $path)) return ['entity' => $entity, 'label' => clip_text($label, 160)];
    }
    return ['entity' => 'record', 'label' => ''];
}


/* ----------------------------------------------------------- the log ------ */
function record_activity(array $row): void {
    if (!has_table('activity_log')) return;
    db()->prepare('INSERT INTO activity_log
        (id, at, action, entity, entity_id, label, detail, user_id, user_name, role, tenant_id, tenant_name, ip)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')->execute([
        uid('log'),
        $row['at'] ?? now_dt(),
        clip_text($row['action'] ?? 'updated', 30),
        clip_text($row['entity'] ?? 'record', 40),
        isset($row['entity_id']) && $row['entity_id'] !== '' ? clip_text($row['entity_id'], 64) : null,
        clip_text($row['label'] ?? '', 255),
        clip_text($row['detail'] ?? '', 500),
        $row['user_id'] ?? null,
        $row['user_name'] ?? null,
        $row['role'] ?? null,
        $row['tenant_id'] ?? null,
        $row['tenant_name'] ?? null,
        $row['ip'] ?? null,
    ]);
    /* the log is a window on the past, not a second database: keep it bounded */
    $count = (int)db()->query('SELECT COUNT(*) FROM activity_log')->fetchColumn();
    if ($count > LOG_KEEP) {
        db()->exec('DELETE FROM activity_log ORDER BY at ASC, id ASC LIMIT ' . ($count - LOG_KEEP));
    }
}

/* A creation has no id in the URL, so it is read from what the handler returns. */
function created_id($out): ?string {
    if (!is_array($out)) return null;
    if (!empty($out['id'])) return (string)$out['id'];
    $likely = ['item', 'book', 'chapter', 'objective', 'user', 'module', 'portal', 'tenant',
        'lesson', 'submission', 'certificate', 'record', 'category', 'statement'];
    foreach ($likely as $key) {
        if (isset($out[$key]) && is_array($out[$key]) && !empty($out[$key]['id'])) return (string)$out[$key]['id'];
    }
    foreach ($out as $key => $value) {
        if ($key === 'logEntry' || $key === 'deleted') continue;
        if (is_array($value) && !array_is_list($value) && !empty($value['id'])) return (string)$value['id'];
    }
    return null;
}

function field_names(array $body): string {
    $skip = ['password', 'newPassword', 'base64', 'file', 'photo', 'logo', 'programLogo'];
    $keys = array_values(array_filter(array_keys($body), fn($k) => !in_array($k, $skip, true)));
    if (!count($keys)) return '';
    return implode(', ', array_slice($keys, 0, 8)) . (count($keys) > 8 ? ' and more' : '');
}

/* Called by the dispatcher once for every request that changed something. */
function log_mutation(?array $user, string $method, string $path, array $body, $out): void {
    if (!has_table('activity_log')) return;
    if (in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)) return;
    if ($path === '/api/auth/beat' || $path === '/api/health') return;
    $own = (is_array($out) && isset($out['logEntry']) && is_array($out['logEntry'])) ? $out['logEntry'] : [];
    $gone = (is_array($out) && isset($out['deleted']) && is_array($out['deleted'])) ? $out['deleted'] : [];
    $shape = shape_of($path, $body);
    $actor = $user;
    if (!empty($own['actorId'])) {
        $st = db()->prepare('SELECT * FROM users WHERE id=? LIMIT 1');
        $st->execute([(string)$own['actorId']]);
        $found = $st->fetch();
        if ($found) $actor = normalize_user($found);
    }
    $action = $own['action'] ?? ($method === 'DELETE' ? 'deleted' : ($method === 'PUT' ? 'updated' : 'created'));
    $entity = $own['entity'] ?? ($gone['entity'] ?? $shape['entity']);
    $label = $own['label'] ?? ($gone['label'] ?? $shape['label']);
    if ($label === null || $label === '') $label = actor_name($actor);
    $detail = (string)($own['detail'] ?? '');
    if ($detail === '' && $method === 'PUT') {
        $names = field_names($body);
        if ($names !== '') $detail = 'Changed: ' . $names;
    }
    record_activity([
        'action' => $action,
        'entity' => $entity,
        'entity_id' => $own['entityId'] ?? ($gone['id'] ?? created_id($out)),
        'label' => $label,
        'detail' => $detail,
        'user_id' => $actor['id'] ?? null,
        'user_name' => $actor ? actor_name($actor) : null,
        'role' => $actor['role'] ?? null,
        'tenant_id' => $actor['tenant_id'] ?? ($own['tenantId'] ?? null),
        'tenant_name' => tenant_name_of($actor['tenant_id'] ?? null),
        'ip' => client_ip(),
    ]);
}

function activity_row(array $r): array {
    return [
        'id' => $r['id'], 'at' => iso($r['at']),
        'action' => $r['action'], 'entity' => $r['entity'],
        'entityId' => $r['entity_id'], 'label' => $r['label'], 'detail' => $r['detail'],
        'userId' => $r['user_id'], 'userName' => $r['user_name'], 'role' => $r['role'],
        'tenantId' => $r['tenant_id'], 'tenantName' => $r['tenant_name'], 'ip' => $r['ip'],
    ];
}

/* Newest first, with the total and per-action counts for the whole result. */
function activity_list(array $filters): array {
    $where = [];
    $args = [];
    foreach (['action', 'entity', 'role'] as $key) {
        if (!empty($filters[$key])) { $where[] = '`' . $key . '`=?'; $args[] = $filters[$key]; }
    }
    if (!empty($filters['tenantId'])) { $where[] = 'tenant_id=?'; $args[] = $filters['tenantId']; }
    if (!empty($filters['userId'])) { $where[] = 'user_id=?'; $args[] = $filters['userId']; }
    if (!empty($filters['from'])) {
        $where[] = 'at >= ?';
        $args[] = date('Y-m-d H:i:s', (int)strtotime((string)$filters['from']));
    }
    if (!empty($filters['to'])) {
        $to = (string)$filters['to'];
        $end = preg_match('/^\d{4}-\d{2}-\d{2}$/', $to) ? (int)strtotime($to) + 86399 : (int)strtotime($to);
        $where[] = 'at <= ?';
        $args[] = date('Y-m-d H:i:s', $end);
    }
    if (!empty($filters['q'])) {
        $where[] = '(user_name LIKE ? OR role LIKE ? OR action LIKE ? OR entity LIKE ? OR label LIKE ?'
            . ' OR detail LIKE ? OR tenant_name LIKE ? OR ip LIKE ?)';
        $like = '%' . $filters['q'] . '%';
        for ($i = 0; $i < 8; $i++) $args[] = $like;
    }
    $clause = count($where) ? ' WHERE ' . implode(' AND ', $where) : '';
    $counts = [];
    $st = db()->prepare('SELECT action, COUNT(*) AS n FROM activity_log' . $clause . ' GROUP BY action');
    $st->execute($args);
    foreach ($st->fetchAll() as $row) $counts[$row['action']] = (int)$row['n'];
    $limit = min(max((int)($filters['limit'] ?? 0) ?: 200, 1), 1000);
    $offset = max((int)($filters['offset'] ?? 0), 0);
    $st = db()->prepare('SELECT * FROM activity_log' . $clause
        . ' ORDER BY at DESC, id DESC LIMIT ' . $limit . ' OFFSET ' . $offset);
    $st->execute($args);
    return ['entries' => array_map('activity_row', $st->fetchAll()),
        'total' => array_sum($counts), 'counts' => $counts,
        'limit' => $limit, 'offset' => $offset];
}

/* --------------------------------------------------------- the trash ----- */
/* `$records` is a list of ['collection'=>table, 'doc'=>row]: the item itself
   first, then whatever belonged to it. Rows are copied, so a later change to a
   live record cannot rewrite the past. */
function trash_put(?array $user, string $entity, string $label, array $records): ?array {
    if (!has_table('trash')) return null;
    $clean = [];
    foreach ($records as $record) {
        if (!is_array($record) || empty($record['doc']) || empty($record['collection'])) continue;
        $table = (string)$record['collection'];
        if (!in_array($table, TRASH_COLLECTIONS, true)) continue;
        $clean[] = [
            'collection' => $table,
            'doc' => $record['doc'],
            'kind' => $record['kind'] ?? null,
            'categoryId' => $record['categoryId'] ?? null,
            'index' => isset($record['index']) ? (int)$record['index'] : null,
        ];
    }
    if (!count($clean)) return null;
    $main = $clean[0]['doc'];
    $id = uid('trs');
    $row = [
        'id' => $id,
        'entity' => clip_text($entity, 40),
        'entity_id' => (string)($main['id'] ?? ''),
        'label' => clip_text($label !== '' ? $label : ($main['title'] ?? ($main['name'] ?? ($main['full_name'] ?? ''))), 255),
        'by_id' => $user['id'] ?? null,
        'by_name' => actor_name($user),
        'by_role' => $user['role'] ?? null,
        'tenant_id' => $user['tenant_id'] ?? null,
        'tenant_name' => tenant_name_of($user['tenant_id'] ?? null),
    ];
    db()->prepare('INSERT INTO trash
        (id, at, entity, entity_id, label, by_id, by_name, by_role, tenant_id, tenant_name, payload_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)')->execute([
        $row['id'], now_dt(), $row['entity'], $row['entity_id'], $row['label'],
        $row['by_id'], $row['by_name'], $row['by_role'], $row['tenant_id'], $row['tenant_name'],
        jenc($clean),
    ]);
    $count = (int)db()->query('SELECT COUNT(*) FROM trash')->fetchColumn();
    if ($count > TRASH_KEEP) {
        db()->exec('DELETE FROM trash ORDER BY at ASC, id ASC LIMIT ' . ($count - TRASH_KEEP));
    }
    $row['records'] = $clean;
    return $row;
}

function trash_get(string $id): ?array {
    if (!has_table('trash')) return null;
    $st = db()->prepare('SELECT * FROM trash WHERE id=? LIMIT 1');
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) return null;
    $row['records'] = jdec($row['payload_json'] ?? null, []);
    return $row;
}

function trash_row(array $r): array {
    return [
        'id' => $r['id'], 'at' => iso($r['at']), 'entity' => $r['entity'],
        'entityId' => $r['entity_id'], 'label' => $r['label'],
        'byId' => $r['by_id'], 'byName' => $r['by_name'], 'byRole' => $r['by_role'],
        'tenantId' => $r['tenant_id'], 'tenantName' => $r['tenant_name'],
        'size' => count(jdec($r['payload_json'] ?? null, [])),
        'restoredAt' => iso($r['restored_at'] ?? null),
    ];
}

/* The list says who deleted what and when - never the payloads themselves. */
function trash_list(array $filters): array {
    if (!has_table('trash')) return ['items' => [], 'total' => 0, 'counts' => [], 'limit' => 300, 'offset' => 0];
    $where = [];
    $args = [];
    if (!empty($filters['entity'])) { $where[] = 'entity=?'; $args[] = $filters['entity']; }
    if (!empty($filters['q'])) {
        $where[] = '(label LIKE ? OR entity LIKE ? OR by_name LIKE ? OR by_role LIKE ? OR tenant_name LIKE ? OR entity_id LIKE ?)';
        $like = '%' . $filters['q'] . '%';
        for ($i = 0; $i < 6; $i++) $args[] = $like;
    }
    $clause = count($where) ? ' WHERE ' . implode(' AND ', $where) : '';
    $counts = [];
    $st = db()->prepare('SELECT entity, COUNT(*) AS n FROM trash' . $clause . ' GROUP BY entity');
    $st->execute($args);
    foreach ($st->fetchAll() as $row) $counts[$row['entity']] = (int)$row['n'];
    $limit = min(max((int)($filters['limit'] ?? 0) ?: 300, 1), 1000);
    $offset = max((int)($filters['offset'] ?? 0), 0);
    $st = db()->prepare('SELECT * FROM trash' . $clause
        . ' ORDER BY at DESC, id DESC LIMIT ' . $limit . ' OFFSET ' . $offset);
    $st->execute($args);
    return ['items' => array_map('trash_row', $st->fetchAll()),
        'total' => array_sum($counts), 'counts' => $counts,
        'limit' => $limit, 'offset' => $offset];
}



/* A row goes back into its table exactly as it was read out of it. Only known
   tables and real columns are written, so this can never be pointed elsewhere. */
function insert_doc(string $table, array $row): void {
    if (!in_array($table, TRASH_TABLES, true)) need(false, 'That record cannot be put back', 409);
    $columns = [];
    $values = [];
    foreach ($row as $column => $value) {
        if (!has_column($table, (string)$column)) continue;
        $columns[] = '`' . $column . '`';
        $values[] = $value;
    }
    if (!count($columns)) need(false, 'That record cannot be put back', 409);
    $sql = 'INSERT INTO `' . $table . '` (' . implode(',', $columns) . ') VALUES ('
        . implode(',', array_fill(0, count($columns), '?')) . ')';
    db()->prepare($sql)->execute($values);
}

function row_exists(string $table, string $id): bool {
    if (!in_array($table, TRASH_TABLES, true) || !has_table($table)) return false;
    $st = db()->prepare('SELECT COUNT(*) FROM `' . $table . '` WHERE id=?');
    $st->execute([$id]);
    return (int)$st->fetchColumn() > 0;
}

/* Putting something back must not create a second copy of a unique name, and it
   must not leave an orphan behind. The parents that come back in the same
   restore are not obstacles. */
function trash_guard(string $table, array $doc, array $batch): void {
    $has = function (string $name, ?string $id) use ($batch): bool {
        if (!$id) return false;
        return in_array($id, $batch, true) || row_exists($name, $id);
    };
    $id = (string)($doc['id'] ?? '');
    if ($id !== '' && row_exists($table, $id)) need(false, 'That item is already back in the system', 409);
    if ($table === 'portals') {
        $st = db()->prepare('SELECT COUNT(*) FROM portals WHERE `key`=?');
        $st->execute([$doc['key'] ?? '']);
        need((int)$st->fetchColumn() === 0, 'Another portal already uses that key - rename it first', 409);
    } elseif ($table === 'tenants') {
        $st = db()->prepare('SELECT COUNT(*) FROM tenants WHERE slug=?');
        $st->execute([$doc['slug'] ?? '']);
        need((int)$st->fetchColumn() === 0, 'Another account already uses that address - rename it first', 409);
        need($has('portals', $doc['portal_id'] ?? null), 'Put the portal back first', 409);
    } elseif ($table === 'users') {
        need($has('tenants', $doc['tenant_id'] ?? null), 'Put the account back first', 409);
        $st = db()->prepare('SELECT COUNT(*) FROM users WHERE tenant_id=? AND (email=? OR student_number=?)');
        $st->execute([$doc['tenant_id'] ?? '', $doc['email'] ?? '', $doc['student_number'] ?? '']);
        need((int)$st->fetchColumn() === 0, 'Someone with that email or number is already in the account', 409);
    } elseif ($table === 'books') {
        if (!empty($doc['module_id'])) need($has('modules', (string)$doc['module_id']), 'Put the module back first', 409);
    } elseif ($table === 'chapters') {
        need($has('books', $doc['book_id'] ?? null), 'Put the book back first', 409);
    } elseif ($table === 'objectives') {
        need($has('chapters', $doc['chapter_id'] ?? null), 'Put the chapter back first', 409);
    }
}

/* Everything that came out together goes back together. */
function trash_restore(array $entry, ?array $user): int {
    $records = $entry['records'] ?? [];
    need(count($records) > 0, 'That entry has nothing to put back', 409);
    $batch = [];
    foreach ($records as $record) {
        if (!empty($record['doc']['id'])) $batch[] = (string)$record['doc']['id'];
    }
    foreach ($records as $record) trash_guard((string)$record['collection'], (array)($record['doc'] ?? []), $batch);
    $restored = 0;
    db()->beginTransaction();
    try {
        foreach ($records as $record) {
            if (empty($record['doc']['id'])) continue;
            if (!in_array((string)$record['collection'], TRASH_TABLES, true)) continue;
            insert_doc((string)$record['collection'], (array)$record['doc']);
            $restored++;
        }
        db()->prepare('UPDATE trash SET restored_at=?, restored_by=? WHERE id=?')
            ->execute([now_dt(), $user['id'] ?? null, $entry['id']]);
        db()->commit();
    } catch (Throwable $e) {
        if (db()->inTransaction()) db()->rollBack();
        throw $e;
    }
    return $restored;
}

function trash_purge(string $id): ?array {
    $entry = trash_get($id);
    if (!$entry) return null;
    db()->prepare('DELETE FROM trash WHERE id=?')->execute([$id]);
    return $entry;
}

function trash_clear(): int {
    if (!has_table('trash')) return 0;
    return (int)db()->exec('DELETE FROM trash');
}

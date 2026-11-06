<?php
declare(strict_types=1);
/* routes_audit.php — the super admin's two windows on the past:
   the System log (who did what, and when) and the Trash (what was deleted,
   waiting to be put back or deleted for good). Mirrors the same routes in
   server/api.js so both backends answer identically. */

function r_super_log(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super']);
    $trim = fn(string $key): string => trim((string)($query[$key] ?? ''));
    if (!has_table('activity_log')) {
        return ['entries' => [], 'total' => 0, 'counts' => [], 'limit' => 200, 'offset' => 0,
            'people' => [], 'kept' => LOG_KEEP];
    }
    $page = activity_list([
        'q' => $trim('q'), 'action' => $trim('action'), 'entity' => $trim('entity'),
        'role' => $trim('role'), 'tenantId' => $trim('tenantId'), 'userId' => $trim('userId'),
        'from' => $trim('from'), 'to' => $trim('to'),
        'limit' => $query['limit'] ?? null, 'offset' => $query['offset'] ?? null,
    ]);
    /* the people who appear in the log, for the "who" filter */
    $people = [];
    $st = db()->query('SELECT user_name, role FROM activity_log WHERE user_name IS NOT NULL'
        . ' GROUP BY user_name, role ORDER BY user_name ASC LIMIT 300');
    foreach ($st->fetchAll() as $row) $people[] = ['name' => $row['user_name'], 'role' => $row['role']];
    return [
        'entries' => $page['entries'], 'total' => $page['total'], 'counts' => $page['counts'],
        'limit' => $page['limit'], 'offset' => $page['offset'],
        'people' => $people, 'kept' => LOG_KEEP,
    ];
}

function r_super_trash(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super']);
    $page = trash_list([
        'q' => trim((string)($query['q'] ?? '')),
        'entity' => trim((string)($query['entity'] ?? '')),
        'limit' => $query['limit'] ?? null, 'offset' => $query['offset'] ?? null,
    ]);
    return [
        'items' => $page['items'], 'total' => $page['total'], 'counts' => $page['counts'],
        'limit' => $page['limit'], 'offset' => $page['offset'], 'kept' => TRASH_KEEP,
    ];
}

/* A category or question was lifted out of the self-assessment: it goes back
   into the same place in that definition. */
function restore_assessment_entry(array $entry): int {
    $record = $entry['records'][0] ?? [];
    $node = (array)($record['doc'] ?? []);
    $def = assessment_def();
    if (($record['kind'] ?? '') === 'category') {
        need(assessment_category_index($def, (string)($node['id'] ?? '')) === null,
            'That category is already back', 409);
        $at = isset($record['index']) && $record['index'] !== null
            ? min((int)$record['index'], count($def['categories']))
            : count($def['categories']);
        array_splice($def['categories'], $at, 0, [$node]);
    } else {
        $index = assessment_category_index($def, (string)($record['categoryId'] ?? ''));
        need($index !== null, 'Put the category this question belonged to back first', 409);
        foreach ($def['categories'][$index]['statements'] as $statement) {
            need(($statement['id'] ?? '') !== ($node['id'] ?? ''), 'That question is already back', 409);
        }
        $count = count($def['categories'][$index]['statements']);
        $at = isset($record['index']) && $record['index'] !== null
            ? min((int)$record['index'], $count) : $count;
        array_splice($def['categories'][$index]['statements'], $at, 0, [$node]);
    }
    assessment_save($def);
    return 1;
}

function r_super_trash_restore(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super']);
    $entry = trash_get((string)($params[0] ?? ''));
    need($entry !== null, 'That item is no longer in the trash', 404);
    need(empty($entry['restored_at']), 'That item has already been put back', 409);
    $entity = (string)$entry['entity'];
    $restored = ($entity === 'assessment-category' || $entity === 'assessment-statement')
        ? restore_assessment_entry($entry)
        : trash_restore($entry, $user);
    return ['restored' => $restored, 'logEntry' => [
        'action' => 'restored', 'entity' => $entity,
        'entityId' => $entry['entity_id'], 'label' => (string)$entry['label'],
        'detail' => 'Back from the Trash',
    ]];
}

function r_super_trash_purge(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super']);
    $entry = trash_purge((string)($params[0] ?? ''));
    need($entry !== null, 'That item is no longer in the trash', 404);
    return ['logEntry' => ['action' => 'purged', 'entity' => (string)$entry['entity'],
        'entityId' => $entry['entity_id'], 'label' => (string)$entry['label'],
        'detail' => 'Deleted for good']];
}

function r_super_trash_clear(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super']);
    $count = trash_clear();
    return ['purged' => $count, 'logEntry' => ['action' => 'emptied', 'entity' => 'trash',
        'label' => $count . ' item(s)', 'detail' => 'The Trash was emptied']];
}

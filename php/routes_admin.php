<?php
declare(strict_types=1);
/* routes_admin.php — super-admin + tenant-admin/supervisor endpoints.
   Handlers: ($user,$body,$params,$token,$query) => payload array. */
$SUPER = ['super'];
$ADMINS = ['super','tenant_admin'];
function can_edit(array $user, ?string $rowScope): bool {
    if (($user['role'] ?? '') === 'super') return true;
    return $rowScope !== null && $rowScope === ($user['tenant_id'] ?? null);
}
function lib_row(array $r): array {
    return ['id'=>$r['id'],'type'=>$r['type'],'title'=>$r['title'],'scope'=>$r['scope'],
        'text'=>$r['text'],'url'=>$r['url'],'fileName'=>$r['file_name'],
        'createdAt'=>iso($r['created_at'] ?? null)];
}
function book_row(array $r): array {
    return ['id'=>$r['id'],'moduleId'=>$r['module_id'],'scope'=>$r['scope'],
        'order'=>(int)$r['order'],'title'=>$r['title'],
        'libraryId'=>$r['library_id'],'letterId'=>$r['letter_id'],
        'createdAt'=>iso($r['created_at'] ?? null)];
}
function chap_row(array $r): array {
    $own = clean_keywords(jdec($r['keywords_json'] ?? null, []));
    $row = ['id'=>$r['id'],'bookId'=>$r['book_id'],'scope'=>$r['scope'],
        'order'=>(int)$r['order'],'title'=>$r['title'],'content'=>$r['content'],
        'pageStart'=>$r['page_start'],'pageEnd'=>$r['page_end'],
        'keywords'=>$own,'suggestedKeywords'=>suggest_keywords($r['content'] ?? '', 8),
        'keywordsSource'=>$own ? 'set' : 'auto',
        'createdAt'=>iso($r['created_at'] ?? null)];
    return $row;
}
function obj_row(array $r): array {
    return ['id'=>$r['id'],'chapterId'=>$r['chapter_id'],'scope'=>$r['scope'],
        'order'=>(int)$r['order'],'question'=>$r['question'],
        'options'=>jdec($r['options_json'] ?? null,[]),
        'answerIndex'=>(int)($r['answer_index'] ?? 0),
        'createdAt'=>iso($r['created_at'] ?? null)];
}
function tenant_row(array $r): array {
    return ['id'=>$r['id'],'portalId'=>$r['portal_id'],'type'=>$r['type'],
        'slug'=>$r['slug'],'name'=>$r['name'],'logo'=>$r['logo'],
        'programLogo'=>$r['program_logo'],'themeColor'=>($r['theme_color'] ?? null),'createdAt'=>iso($r['created_at'] ?? null)];
}
function admin_submissions(array $user, array $query): array {
    $role = $user['role'] ?? '';
    $where = []; $args = [];
    if ($role === 'tenant_admin') { $where[] = 's.tenant_id=?'; $args[] = $user['tenant_id']; }
    elseif ($role === 'supervisor') {
        $st = db()->prepare('SELECT id FROM users WHERE supervisor_id=?');
        $st->execute([$user['id']]); $ids = $st->fetchAll(PDO::FETCH_COLUMN);
        if (!count($ids)) return [];
        $ph = implode(',', array_fill(0, count($ids), '?'));
        $where[] = "s.user_id IN ($ph)"; $args = array_merge($args, $ids);
    }
    $flagged = $query['flagged'] ?? null;
    if ($flagged === 1 || $flagged === '1' || $flagged === true || $flagged === 'true') { $where[] = 's.flagged=1'; }
    $type = trim((string)($query['type'] ?? ''));
    if ($type !== '') { $where[] = 's.type=?'; $args[] = $type; }
    $sql = 'SELECT s.*,u.full_name AS un,u.role AS urole,c.title AS ct,b.title AS bt FROM submissions s LEFT JOIN users u ON u.id=s.user_id LEFT JOIN chapters c ON c.id=s.chapter_id LEFT JOIN books b ON b.id=s.book_id';
    if (count($where)) $sql .= ' WHERE ' . implode(' AND ', $where);
    $sql .= ' ORDER BY s.created_at DESC LIMIT 400';
    $st = db()->prepare($sql); $st->execute($args);
    $out = [];
    foreach ($st->fetchAll() as $r) {
        $out[] = ['id'=>$r['id'],'type'=>$r['type'],'createdAt'=>iso($r['created_at'] ?? null),
            'text'=>$r['text'],'color'=>$r['color'],'label'=>$r['label'],
            'score'=>$r['score']!==null?(int)$r['score']:null,
            'total'=>$r['total']!==null?(int)$r['total']:null,
            'flagged'=>(bool)($r['flagged'] ?? false),'similarity'=>(int)($r['similarity'] ?? 0),
            'matchedWith'=>copy_match($r), 'matchedName'=>copy_match($r)['name'] ?? null,
        'userName'=>$r['un'],'userRole'=>$r['urole'],'chapter'=>$r['ct'],'book'=>$r['bt'],
            'tenantId'=>$r['tenant_id'],'userId'=>$r['user_id'],
            'chapterId'=>$r['chapter_id'],'bookId'=>$r['book_id'],'moduleId'=>$r['module_id']];
    }
    return $out;
}
function admin_user_map(array $u, array $supNames): array {
    $p = public_user(normalize_user($u));
    $p['supervisorName'] = ($u['supervisor_id'] ?? null) && isset($supNames[$u['supervisor_id']]) ? $supNames[$u['supervisor_id']] : null;
    $role = $u['role'] ?? '';
    if (in_array($role, ['member','student','teacher'], true)) {
        try { $perf = performance(normalize_user($u)); $p['progress'] = $perf['overall']; }
        catch (Throwable $e) { $p['progress'] = 0; }
    } else { $p['progress'] = null; }
    return $p;
}
function sup_names_for(array $users): array {
    $ids = array_values(array_unique(array_filter(array_map(fn($u)=>$u['supervisor_id'] ?? null, $users))));
    if (!count($ids)) return [];
    $ph = implode(',', array_fill(0, count($ids), '?'));
    $st = db()->prepare("SELECT id,full_name FROM users WHERE id IN ($ph)");
    $st->execute($ids); $m = [];
    foreach ($st->fetchAll() as $r) $m[$r['id']] = $r['full_name'];
    return $m;
}
function scoped_user_rows(array $user, array $query): array {
    $role = $user['role'] ?? '';
    if ($role === 'super') {
        $tid = trim((string)($query['tenantId'] ?? ''));
        if ($tid !== '') { $st = db()->prepare('SELECT * FROM users WHERE tenant_id=? ORDER BY created_at DESC'); $st->execute([$tid]); }
        else { $st = db()->query('SELECT * FROM users ORDER BY created_at DESC'); }
        return $st->fetchAll();
    } elseif ($role === 'tenant_admin') {
        $st = db()->prepare('SELECT * FROM users WHERE tenant_id=? ORDER BY created_at DESC');
        $st->execute([$user['tenant_id']]); return $st->fetchAll();
    } else {
        $st = db()->prepare('SELECT * FROM users WHERE supervisor_id=? ORDER BY created_at DESC');
        $st->execute([$user['id']]); return $st->fetchAll();
    }
}
function r_super_overview(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super']);
    $pdo = db();
    $c = function(string $t, string $w='', array $a=[]) use ($pdo): int {
        $st = $pdo->prepare("SELECT COUNT(*) FROM $t" . ($w ? " WHERE $w" : ''));
        $st->execute($a); return (int)$st->fetchColumn();
    };
    $counts = ['portals'=>$c('portals'),'tenants'=>$c('tenants'),'users'=>$c('users'),
        'submissions'=>$c('submissions'),'certificates'=>$c('certificates'),
        'flagged'=>$c('submissions','flagged=1'),'modules'=>$c('modules'),'library'=>$c('library')];
    $per = [];
    $portalRows = [];
    foreach ($pdo->query('SELECT * FROM portals')->fetchAll() as $p) { $portalRows[$p['id']] = $p; }
    foreach ($pdo->query('SELECT * FROM tenants ORDER BY created_at DESC')->fetchAll() as $t) {
        $st = $pdo->prepare('SELECT COUNT(*) FROM users WHERE tenant_id=?'); $st->execute([$t['id']]); $uc = (int)$st->fetchColumn();
        $st = $pdo->prepare('SELECT COUNT(*) FROM submissions WHERE tenant_id=?'); $st->execute([$t['id']]); $sc = (int)$st->fetchColumn();
        $st = $pdo->prepare('SELECT COUNT(*) FROM certificates WHERE tenant_id=?'); $st->execute([$t['id']]); $cc = (int)$st->fetchColumn();
        $st = $pdo->prepare('SELECT COUNT(*) FROM submissions WHERE tenant_id=? AND flagged=1'); $st->execute([$t['id']]); $fc = (int)$st->fetchColumn();
        /* `active` is the portal's own state, which the dashboard's status column shows */
        $per[] = ['id'=>$t['id'],'name'=>$t['name'],'slug'=>$t['slug'],'type'=>$t['type'],
            'portalId'=>$t['portal_id'],'users'=>$uc,'submissions'=>$sc,'certificates'=>$cc,'flagged'=>$fc,
            'active'=>portal_active($portalRows[$t['portal_id']] ?? null)];
    }
    return ['counts'=>$counts,'tenants'=>$per];
}
function r_super_portals(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super']);
    $out = [];
    foreach (db()->query('SELECT * FROM portals ORDER BY created_at DESC')->fetchAll() as $p) {
        $st = db()->prepare('SELECT COUNT(*) FROM tenants WHERE portal_id=?'); $st->execute([$p['id']]);
        $pp = portal_public($p); $pp['tenantCount'] = (int)$st->fetchColumn(); $out[] = $pp;
    }
    return ['portals' => $out];
}
function r_super_portal_create(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super']);
    $name = trim((string)($body['name'] ?? '')); need($name !== '', 'name required');
    $key = slugify($body['key'] ?? $body['slug'] ?? $name); need($key !== '', 'key required');
    $st = db()->prepare('SELECT COUNT(*) FROM portals WHERE `key`=?'); $st->execute([$key]);
    need((int)$st->fetchColumn() === 0, 'Portal key already exists', 409);
    $row = ['id'=>uid('por'),'key'=>$key,'name'=>$name,'type'=>$body['type'] ?? 'custom',
        'schedule_mode'=>$body['scheduleMode'] ?? $body['schedule_mode'] ?? 'windows',
        'windows_json'=>jenc(normalize_windows($body['windows'] ?? $body['windowsJson'] ?? [])),
        'enabled'=>isset($body['enabled']) ? ((int)(bool)$body['enabled']) : 1,
        'description'=>$body['description'] ?? null,'created_at'=>now_dt()];
    db()->prepare('INSERT INTO portals (id,`key`,name,type,schedule_mode,windows_json,enabled,description,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
        ->execute(array_values($row));
    $st = db()->prepare('SELECT * FROM portals WHERE id=?'); $st->execute([$row['id']]);
    return portal_public($st->fetch());
}
function r_super_portal_update(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super']);
    $id = $params['id'] ?? $body['id'] ?? null; need($id, 'id required');
    $st = db()->prepare('SELECT * FROM portals WHERE id=? LIMIT 1'); $st->execute([$id]);
    $p = $st->fetch(); need($p, 'Portal not found', 404);
    $set = []; $args = [];
    if (isset($body['name'])) { $set[] = 'name=?'; $args[] = $body['name']; }
    if (isset($body['key'])) {
        $k = slugify($body['key']); need($k !== '', 'key invalid');
        $st = db()->prepare('SELECT COUNT(*) FROM portals WHERE `key`=? AND id<>?'); $st->execute([$k, $id]);
        need((int)$st->fetchColumn() === 0, 'Portal key already exists', 409);
        $set[] = '`key`=?'; $args[] = $k;
    }
    if (isset($body['type'])) { $set[] = 'type=?'; $args[] = $body['type']; }
    $sm = $body['scheduleMode'] ?? $body['schedule_mode'] ?? null;
    if ($sm !== null) { $set[] = 'schedule_mode=?'; $args[] = $sm; }
    if (array_key_exists('windows', $body) || array_key_exists('windowsJson', $body)) {
        $set[] = 'windows_json=?'; $args[] = jenc(normalize_windows($body['windows'] ?? $body['windowsJson'] ?? []));
    }
    if (array_key_exists('enabled', $body)) { $set[] = 'enabled=?'; $args[] = (int)(bool)$body['enabled']; }
    if (array_key_exists('description', $body)) { $set[] = 'description=?'; $args[] = $body['description']; }
    if (count($set)) { $args[] = $id; db()->prepare('UPDATE portals SET ' . implode(',', $set) . ' WHERE id=?')->execute($args); }
    $st = db()->prepare('SELECT * FROM portals WHERE id=?'); $st->execute([$id]);
    return portal_public($st->fetch());
}
function r_super_portal_delete(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super']);
    $id = $params['id'] ?? $body['id'] ?? null; need($id, 'id required');
    $st = db()->prepare('SELECT COUNT(*) FROM tenants WHERE portal_id=?'); $st->execute([$id]);
    need((int)$st->fetchColumn() === 0, 'Cannot delete portal with tenants', 409);
    db()->prepare('DELETE FROM portals WHERE id=?')->execute([$id]);
    return ['deleted' => true];
}
function r_super_tenants(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super']);
    $out = [];
    $prows = db()->query('SELECT * FROM portals')->fetchAll();
    $pmap = []; foreach ($prows as $p) $pmap[$p['id']] = $p;
    foreach (db()->query('SELECT * FROM tenants ORDER BY created_at DESC')->fetchAll() as $t) {
        $st = db()->prepare('SELECT * FROM users WHERE tenant_id=? AND role=? ORDER BY created_at ASC LIMIT 1');
        $st->execute([$t['id'], 'tenant_admin']); $adm = $st->fetch();
        $st = db()->prepare('SELECT COUNT(*) FROM users WHERE tenant_id=?'); $st->execute([$t['id']]);
        $tr = tenant_row($t);
        $tr['portalName'] = isset($pmap[$t['portal_id']]) ? $pmap[$t['portal_id']]['name'] : null;
        $tr['admin'] = $adm ? public_user(normalize_user($adm)) : null;
        $tr['userCount'] = (int)$st->fetchColumn();
        $tr['active'] = portal_active($pmap[$t['portal_id']] ?? null);
        $out[] = $tr;
    }
    return ['tenants' => $out];
}
function r_super_tenant_create(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super']);
    $portalId = $body['portalId'] ?? $body['portal_id'] ?? null; need($portalId, 'portalId required');
    $st = db()->prepare('SELECT * FROM portals WHERE id=?'); $st->execute([$portalId]); $por = $st->fetch();
    need($por, 'Portal not found', 404);
    $name = trim((string)($body['name'] ?? '')); need($name !== '', 'name required');
    $slug = slugify($body['slug'] ?? $name); need($slug !== '', 'slug required');
    $st = db()->prepare('SELECT COUNT(*) FROM tenants WHERE slug=?'); $st->execute([$slug]);
    need((int)$st->fetchColumn() === 0, 'Tenant slug already exists', 409);
    $adm = $body['admin'] ?? []; $fn = trim((string)($adm['fullName'] ?? $adm['full_name'] ?? ''));
    $em = trim((string)($adm['email'] ?? '')); $pw = (string)($adm['password'] ?? '');
    need($fn !== '' && $em !== '' && $pw !== '', 'admin fullName/email/password required');
    $tid = uid('ten');
    db()->prepare('INSERT INTO tenants (id,portal_id,type,slug,name,logo,program_logo,created_at) VALUES (?,?,?,?,?,?,?,?)')
        ->execute([$tid, $portalId, $por['type'], $slug, $name, $body['logo'] ?? null, $body['programLogo'] ?? $body['program_logo'] ?? null, now_dt()]);
    $aid = uid('usr');
    db()->prepare('INSERT INTO users (id,tenant_id,role,full_name,email,password_hash,letter_feedback_at,optional_video_seen,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
        ->execute([$aid, $tid, 'tenant_admin', $fn, $em, hash_pw($pw), now_dt(), 1, now_dt()]);
    $st = db()->prepare('SELECT * FROM tenants WHERE id=?'); $st->execute([$tid]); $trow = $st->fetch();
    $st = db()->prepare('SELECT * FROM users WHERE id=?'); $st->execute([$aid]); $arow = $st->fetch();
    return ['tenant'=>tenant_row($trow),'admin'=>public_user(normalize_user($arow)),'loginUrl'=>'/t/' . $slug];
}
function r_super_tenant_update(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super']);
    $id = $params['id'] ?? $body['id'] ?? null; need($id, 'id required');
    $st = db()->prepare('SELECT * FROM tenants WHERE id=?'); $st->execute([$id]); $t = $st->fetch();
    need($t, 'Tenant not found', 404);
    $set = []; $args = [];
    if (isset($body['name'])) { $set[] = 'name=?'; $args[] = $body['name']; }
    if (array_key_exists('logo', $body)) { $set[] = 'logo=?'; $args[] = $body['logo']; }
    $pl = $body['programLogo'] ?? $body['program_logo'] ?? null;
    if (array_key_exists('programLogo', $body) || array_key_exists('program_logo', $body)) { $set[] = 'program_logo=?'; $args[] = $pl; }
    if (array_key_exists('themeColor', $body) || array_key_exists('theme_color', $body)) {
        $c = $body['themeColor'] ?? $body['theme_color'] ?? null;
        $c = (is_string($c) && preg_match('/^#[0-9a-fA-F]{6}$/', trim($c))) ? strtolower(trim($c)) : null;
        $set[] = 'theme_color=?'; $args[] = $c;
    }
    if (count($set)) { $args[] = $id; db()->prepare('UPDATE tenants SET ' . implode(',', $set) . ' WHERE id=?')->execute($args); }
    $st = db()->prepare('SELECT * FROM tenants WHERE id=?'); $st->execute([$id]);
    return tenant_row($st->fetch());
}
function r_super_tenant_delete(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super']);
    $id = $params['id'] ?? $body['id'] ?? null; need($id, 'id required');
    $st = db()->prepare('SELECT id FROM users WHERE tenant_id=?'); $st->execute([$id]);
    $uids = $st->fetchAll(PDO::FETCH_COLUMN);
    if (count($uids)) {
        $ph = implode(',', array_fill(0, count($uids), '?'));
        db()->prepare("DELETE FROM submissions WHERE user_id IN ($ph)")->execute($uids);
        db()->prepare("DELETE FROM certificates WHERE user_id IN ($ph)")->execute($uids);
        db()->prepare("DELETE FROM thoughts WHERE user_id IN ($ph)")->execute($uids);
        db()->prepare("DELETE FROM sessions WHERE user_id IN ($ph)")->execute($uids);
        db()->prepare("DELETE FROM users WHERE id IN ($ph)")->execute($uids);
    }
    db()->prepare('DELETE FROM tenants WHERE id=?')->execute([$id]);
    return ['deleted' => true];
}
function r_super_modules(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super']);
    $out = [];
    foreach (db()->query('SELECT * FROM modules ORDER BY `order` ASC')->fetchAll() as $m) {
        $st = db()->prepare('SELECT COUNT(*) FROM books WHERE module_id=?'); $st->execute([$m['id']]);
        $n = n_module($m); $n['bookCount'] = (int)$st->fetchColumn(); $out[] = $n;
    }
    return ['modules' => $out];
}
function r_super_module_create(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super']);
    $title = trim((string)($body['title'] ?? '')); need($title !== '', 'title required');
    $mode = $body['mode'] ?? 'objectives';
    $key = slugify($body['key'] ?? $title); $key = str_replace('-', '_', $key);
    $st = db()->query('SELECT COUNT(*) FROM modules'); $st->execute(); $cnt = (int)$st->fetchColumn();
    $row = ['id'=>uid('mod'),'key'=>$key,'order'=>$body['order'] ?? ($cnt + 1),'title'=>$title,
        'mode'=>$mode,'certificate_name'=>strtoupper($body['certificateName'] ?? $body['certificate_name'] ?? $title),
        'default_books'=>(int)($body['defaultBooks'] ?? $body['default_books'] ?? 3),
        'letter_after_book'=>isset($body['letterAfterBook']) ? (int)(bool)$body['letterAfterBook'] : ($mode === 'objectives' ? 0 : 1),
        'summary_prompts_json'=>jenc($body['summaryPrompts'] ?? $body['summary_prompts'] ?? ($mode === 'objectives' ? ['What did you learn?','How will you apply it?','Write your reflection.'] : [])),
        'completion_video_id'=>$body['completionVideoId'] ?? $body['completion_video_id'] ?? null,
        'created_at'=>now_dt()];
    db()->prepare('INSERT INTO modules (id,`key`,`order`,title,mode,certificate_name,default_books,letter_after_book,summary_prompts_json,completion_video_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        ->execute(array_values($row));
    $st = db()->prepare('SELECT * FROM modules WHERE id=?'); $st->execute([$row['id']]);
    return n_module($st->fetch());
}
function r_super_module_update(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super']);
    $id = $params['id'] ?? $body['id'] ?? null; need($id, 'id required');
    $st = db()->prepare('SELECT * FROM modules WHERE id=?'); $st->execute([$id]); need($st->fetch(), 'Module not found', 404);
    $map = ['title'=>'title','mode'=>'mode','order'=>'`order`','key'=>'`key`',
        'certificateName'=>'certificate_name','certificate_name'=>'certificate_name',
        'defaultBooks'=>'default_books','default_books'=>'default_books',
        'letterAfterBook'=>'letter_after_book','letter_after_book'=>'letter_after_book',
        'completionVideoId'=>'completion_video_id','completion_video_id'=>'completion_video_id',
        'summaryPrompts'=>'summary_prompts_json','summary_prompts'=>'summary_prompts_json'];
    $set = []; $args = [];
    foreach ($map as $k => $col) {
        if (array_key_exists($k, $body)) {
            $v = $body[$k];
            if ($col === 'summary_prompts_json') $v = jenc($v ?? []);
            if ($col === 'letter_after_book') $v = (int)(bool)$v;
            $set[] = "$col=?"; $args[] = $v;
        }
    }
    if (count($set)) { $args[] = $id; db()->prepare('UPDATE modules SET ' . implode(',', $set) . ' WHERE id=?')->execute($args); }
    $st = db()->prepare('SELECT * FROM modules WHERE id=?'); $st->execute([$id]);
    return n_module($st->fetch());
}
function r_super_module_delete(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super']);
    $id = $params['id'] ?? $body['id'] ?? null; need($id, 'id required');
    $st = db()->prepare('SELECT COUNT(*) FROM books WHERE module_id=?'); $st->execute([$id]);
    need((int)$st->fetchColumn() === 0, 'Cannot delete module with books', 409);
    db()->prepare('DELETE FROM modules WHERE id=?')->execute([$id]);
    return ['deleted' => true];
}
function r_super_settings_get(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super']);
    $s = get_settings();
    return ['settings' => [
        'programName' => $s['program_name'] ?? 'Character Building Program',
        'programLogo' => $s['program_logo'] ?? null,
        'letterId' => $s['letter_id'] ?? null,
        'letterVideoId' => $s['letter_video_id'] ?? null,
    ]];
}
function r_super_settings(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super']);
    $set = []; $args = [];
    if (array_key_exists('programName', $body)) { $set[] = 'program_name=?'; $args[] = $body['programName']; }
    if (array_key_exists('programLogo', $body)) { $set[] = 'program_logo=?'; $args[] = $body['programLogo']; }
    if (array_key_exists('letterId', $body)) { $set[] = 'letter_id=?'; $args[] = $body['letterId']; }
    if (array_key_exists('letterVideoId', $body)) { $set[] = 'letter_video_id=?'; $args[] = $body['letterVideoId']; }
    if (array_key_exists('username', $body) && $body['username'] !== null && $body['username'] !== '') {
        $set[] = 'super_username=?'; $args[] = $body['username'];
    }
    if (!empty($body['password'])) {
        $h = hash_pw((string)$body['password']);
        $set[] = 'super_hash=?'; $args[] = $h;
    }
    if (count($set)) db()->prepare('UPDATE settings SET ' . implode(',', $set) . ' WHERE id=1')->execute($args);
    if (!empty($body['password'])) {
        $h2 = hash_pw((string)$body['password']);
        db()->prepare("UPDATE users SET password_hash=? WHERE role='super'")->execute([$h2]);
    }
    if (isset($body['username']) && $body['username'] !== '') {
        db()->prepare("UPDATE users SET username=? WHERE role='super'")->execute([$body['username']]);
    }
    return get_settings();
}
function r_super_submissions(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super']);
    return ['submissions' => admin_submissions($user, $query)];
}
function r_super_users(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super']);
    $rows = scoped_user_rows($user, $query);
    $names = sup_names_for($rows);
    return ['users' => array_map(fn($u)=>admin_user_map($u, $names), $rows)];
}
/* Super admin creates a user inside any tenant (same rules as POST /api/users). */
function r_super_users_create(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super']);
    $row = build_user_record($user, $body);
    $names = sup_names_for([$row]);
    return ['user' => admin_user_map($row, $names)];
}
/* ------------------------------------------- super analytics -------------- */
/* The same picture as the Node build: impact per portal, account, module, book,
   chapter and individual, with the weekly activity behind it. */
function a_weeks(int $weeks): array {
    $out = []; $now = time();
    for ($i = $weeks - 1; $i >= 0; $i--) {
        $end = $now - $i * 7 * 86400;
        $out[] = ['start' => $end - 7 * 86400, 'end' => $end, 'label' => $i === 0 ? 'now' : '-' . $i . 'w',
            'submissions' => 0, 'certificates' => 0, 'newUsers' => 0, 'active' => []];
    }
    return $out;
}
function a_bucket(array $buckets, ?string $ts): int {
    $t = $ts ? strtotime($ts) : 0;
    if (!$t) return -1;
    foreach ($buckets as $i => $b) {
        if ($t > $b['start'] && $t <= $b['end']) return $i;
    }
    return -1;
}
function a_pct(int $part, int $whole): int { return $whole ? (int)round(100 * $part / $whole) : 0; }
function a_mean(array $nums): ?int {
    $nums = array_values(array_filter($nums, fn($n) => $n !== null && $n !== ''));
    return $nums ? (int)round(array_sum($nums) / count($nums)) : null;
}
function a_round2(float $n): float { return round($n, 2); }
/* The other person's work a flagged submission matched (>= 75% overlap). */
function copy_match(?array $sub): ?array {
    if (!$sub || empty($sub['flagged']) || empty($sub['text'])) return null;
    $words = array_unique(normalize_words((string)$sub['text']));
    $pdo = db();
    $sql = 'SELECT s.*, u.full_name, u.class_name, u.student_number FROM submissions s
            JOIN users u ON u.id = s.user_id
            WHERE s.user_id <> ? AND s.`text` IS NOT NULL AND s.type = ?';
    $args = [$sub['user_id'], $sub['type']];
    foreach (['chapter_id', 'book_id', 'module_id', 'index'] as $col) {
        if (($sub[$col] ?? null) === null) $sql .= " AND s.`$col` IS NULL";
        else { $sql .= " AND s.`$col` = ?"; $args[] = $sub[$col]; }
    }
    $st = $pdo->prepare($sql);
    $st->execute($args);
    $best = null;
    foreach ($st->fetchAll() as $row) {
        $sim = (int)round(100 * jaccard($words, array_unique(normalize_words((string)$row['text']))));
        if ($sim >= 75 && (!$best || $sim > $best['similarity'])) {
            $best = ['submissionId' => $row['id'], 'userId' => $row['user_id'],
                'name' => $row['full_name'], 'className' => $row['class_name'],
                'studentNumber' => $row['student_number'], 'similarity' => $sim,
                'createdAt' => iso($row['created_at'])];
        }
    }
    return $best;
}

function analytics_payload(array $scope): array {
    $pdo = db();
    $weeks = max(4, min(52, (int)($scope['weeks'] ?? 12)));
    $fPortal = $scope['portalId'] ?? null;
    $fTenant = $scope['tenantId'] ?? null;
    $fModule = $scope['moduleId'] ?? null;
    $onlyUserIds = $scope['userIds'] ?? null;
    $inOnly = fn($uid) => $onlyUserIds === null || in_array($uid, $onlyUserIds, true);

    $portals = $scope['portals'] ?? $pdo->query('SELECT * FROM portals ORDER BY name')->fetchAll();
    $portalById = [];
    foreach ($pdo->query('SELECT * FROM portals')->fetchAll() as $p) $portalById[$p['id']] = $p;
    $tenants = $scope['tenants'] ?? $pdo->query('SELECT * FROM tenants ORDER BY name')->fetchAll();
    if (!isset($scope['tenants'])) {
        $tenants = array_values(array_filter($tenants, fn($t) =>
            (!$fPortal || $t['portal_id'] === $fPortal) && (!$fTenant || $t['id'] === $fTenant)));
    }
    if ($fPortal && !isset($scope['portals'])) {
        $portals = array_values(array_filter($portals, fn($p) => $p['id'] === $fPortal));
    }
    $tIds = array_map(fn($t) => $t['id'], $tenants);
    $inT = fn($id) => in_array($id, $tIds, true);
    $modules = all_modules();
    if ($fModule) $modules = array_values(array_filter($modules, fn($m) => $m['id'] === $fModule));
    $mIds = array_map(fn($m) => $m['id'], $modules);
    $inM = fn($id) => in_array($id, $mIds, true);

    global $PARTICIPANTS;
    $allUsers = $pdo->query('SELECT * FROM users')->fetchAll();
    $participants = array_values(array_filter($allUsers, fn($u) => in_array($u['role'], $PARTICIPANTS, true) && $inT($u['tenant_id']) && $inOnly($u['id'])));
    $staff = array_values(array_filter($allUsers, fn($u) => in_array($u['role'], ['super','tenant_admin','supervisor'], true) && $inT($u['tenant_id'])));

    $allSubs = $pdo->query('SELECT * FROM submissions ORDER BY created_at ASC')->fetchAll();
    $subs = array_values(array_filter($allSubs, fn($s) => $inT($s['tenant_id']) && (!$fModule || $inM($s['module_id'])) && $inOnly($s['user_id'])));
    $allCerts = $pdo->query('SELECT * FROM certificates')->fetchAll();
    $certs = array_values(array_filter($allCerts, fn($c) => $inT($c['tenant_id']) && (!$fModule || $inM($c['module_id'])) && $inOnly($c['user_id'])));

    /* per learner: progress, completion, activity */
    $subsByUser = []; $certsByUser = [];
    foreach ($subs as $s) $subsByUser[$s['user_id']][] = $s;
    foreach ($certs as $c) $certsByUser[$c['user_id']][] = $c;
    $perf = [];
    foreach ($participants as $u) {
        $st = array_values(array_filter(module_statuses(['id' => $u['id'], 'tenant_id' => $u['tenant_id'], 'role' => $u['role'],
            'full_name' => $u['full_name'], 'class_name' => $u['class_name'], 'student_number' => $u['student_number']]),
            fn($m) => !$fModule || $inM($m['id'])));
        $done = count(array_filter($st, fn($m) => $m['status'] === 'completed'));
        $perf[$u['id']] = ['statuses' => $st, 'completed' => $done, 'modules' => count($st),
            'progress' => a_mean(array_map(fn($m) => (int)$m['progress']['percent'], $st))];
    }

    $flaggedCount = count(array_filter($subs, fn($s) => !empty($s['flagged'])));
    $typedScores = [];
    foreach ($subs as $s) { $a = submission_assessment($s); if ($a && $a['keywordScore'] !== null) $typedScores[] = $a['keywordScore']; }
    $objRates = [];
    foreach ($subs as $s) {
        if (($s['type'] ?? '') === 'objectives' && (int)($s['total'] ?? 0) > 0) {
            $objRates[] = (int)round(100 * (int)$s['score'] / (int)$s['total']);
        }
    }
    $recentCut = time() - 14 * 86400;
    $involved = array_values(array_filter($participants, fn($u) => !empty($subsByUser[$u['id']])));
    $finished = [];
    foreach ($participants as $u) {
        $p = $perf[$u['id']];
        if ($p['modules'] > 0 && $p['completed'] === $p['modules']) $finished[] = $u['id'];
    }
    $activeRecently = array_values(array_filter($participants, function ($u) use ($subsByUser, $recentCut) {
        foreach ($subsByUser[$u['id']] ?? [] as $s) if (strtotime((string)$s['created_at']) > $recentCut) return true;
        return false;
    }));

    /* weekly activity */
    $buckets = a_weeks($weeks);
    foreach ($subs as $s) {
        $i = a_bucket($buckets, $s['created_at'] ?? null);
        if ($i === -1) continue;
        $buckets[$i]['submissions']++;
        if (!in_array($s['user_id'], $buckets[$i]['active'], true)) $buckets[$i]['active'][] = $s['user_id'];
    }
    foreach ($certs as $c) {
        $i = a_bucket($buckets, $c['issued_at'] ?? null);
        if ($i !== -1) $buckets[$i]['certificates']++;
    }
    foreach ($participants as $u) {
        $i = a_bucket($buckets, $u['created_at'] ?? null);
        if ($i !== -1) $buckets[$i]['newUsers']++;
    }
    $nPart = count($participants);
    $impact = [
        'participants' => $nPart, 'staff' => count($staff),
        'involved' => count($involved), 'involvementRate' => a_pct(count($involved), $nPart),
        'finished' => count($finished), 'completionRate' => a_pct(count($finished), $nPart),
        'certificates' => count($certs),
        'certificatesPerLearner' => $nPart ? a_round2(count($certs) / $nPart) : 0,
        'avgProgress' => a_mean(array_map(fn($p) => $p['progress'], $perf)),
        'keywordCoverage' => a_mean($typedScores),
        'objectiveAccuracy' => a_mean($objRates),
        'integrity' => a_pct(count($subs) - $flaggedCount, count($subs)),
        'flaggedRate' => a_pct($flaggedCount, count($subs)),
        'activeShare' => a_pct(count($activeRecently), $nPart),
        'submissionsPerLearner' => $nPart ? a_round2(count($subs) / $nPart) : 0,
        'chaptersDone' => count(array_filter($subs, fn($s) => ($s['type'] ?? '') === 'chapter_summary')),
        'objectivesAnswered' => count($objRates)
    ];

    /* ---- per portal ---------------------------------------------------- */
    $portalStats = [];
    foreach ($portals as $p) {
        $pIds = array_map(fn($t) => $t['id'], array_filter($tenants, fn($t) => $t['portal_id'] === $p['id']));
        $ps = array_values(array_filter($participants, fn($u) => in_array($u['tenant_id'], $pIds, true)));
        $psubs = array_values(array_filter($subs, fn($s) => in_array($s['tenant_id'], $pIds, true)));
        $pcerts = array_values(array_filter($certs, fn($c) => in_array($c['tenant_id'], $pIds, true)));
        $pfin = 0;
        foreach ($ps as $u) { $q = $perf[$u['id']]; if ($q['modules'] > 0 && $q['completed'] === $q['modules']) $pfin++; }
        $pflag = count(array_filter($psubs, fn($s) => !empty($s['flagged'])));
        $pkw = []; $pobj = [];
        foreach ($psubs as $s) {
            $a = submission_assessment($s);
            if ($a && $a['keywordScore'] !== null) $pkw[] = $a['keywordScore'];
            if (($s['type'] ?? '') === 'objectives' && (int)($s['total'] ?? 0) > 0) $pobj[] = (int)round(100 * (int)$s['score'] / (int)$s['total']);
        }
        $pInvolved = count(array_filter($ps, fn($u) => !empty($subsByUser[$u['id']])));
        $portalStats[] = ['id' => $p['id'], 'key' => $p['key'], 'name' => $p['name'], 'type' => $p['type'],
            'enabled' => (bool)($p['enabled'] ?? true), 'accounts' => count($pIds), 'participants' => count($ps),
            'involved' => $pInvolved, 'submissions' => count($psubs), 'certificates' => count($pcerts),
            'flagged' => $pflag, 'flaggedRate' => a_pct($pflag, count($psubs)),
            'avgProgress' => a_mean(array_map(fn($u) => $perf[$u['id']]['progress'], $ps)),
            'completionRate' => a_pct($pfin, count($ps)), 'finished' => $pfin,
            'keywordCoverage' => a_mean($pkw), 'objectiveAccuracy' => a_mean($pobj),
            'perLearner' => count($ps) ? a_round2(count($psubs) / count($ps)) : 0];
    }

    /* ---- per account --------------------------------------------------- */
    $accountsOut = [];
    foreach ($tenants as $t) {
        $us = array_values(array_filter($participants, fn($u) => $u['tenant_id'] === $t['id']));
        $asubs = array_values(array_filter($subs, fn($s) => $s['tenant_id'] === $t['id']));
        $acerts = array_values(array_filter($certs, fn($c) => $c['tenant_id'] === $t['id']));
        $afin = 0;
        foreach ($us as $u) { $q = $perf[$u['id']]; if ($q['modules'] > 0 && $q['completed'] === $q['modules']) $afin++; }
        $aflag = count(array_filter($asubs, fn($s) => !empty($s['flagged'])));
        $byType = [];
        foreach ($asubs as $s) $byType[$s['type']] = ($byType[$s['type']] ?? 0) + 1;
        $akw = []; $aobj = []; $last = null;
        foreach ($asubs as $s) {
            $a = submission_assessment($s);
            if ($a && $a['keywordScore'] !== null) $akw[] = $a['keywordScore'];
            if (($s['type'] ?? '') === 'objectives' && (int)($s['total'] ?? 0) > 0) $aobj[] = (int)round(100 * (int)$s['score'] / (int)$s['total']);
            if ($last === null || strtotime((string)$s['created_at']) > strtotime($last)) $last = $s['created_at'];
        }
        $modRows = [];
        foreach ($modules as $m) {
            $ms = array_values(array_filter($asubs, fn($s) => $s['module_id'] === $m['id']));
            $mdone = 0;
            foreach ($us as $u) {
                foreach ($perf[$u['id']]['statuses'] as $st) {
                    if ($st['id'] === $m['id'] && $st['status'] === 'completed') $mdone++;
                }
            }
            $mstart = count(array_filter($us, fn($u) => count(array_filter($ms, fn($s) => $s['user_id'] === $u['id'])) > 0));
            $modRows[] = ['id' => $m['id'], 'title' => $m['title'], 'mode' => $m['mode'],
                'submissions' => count($ms), 'started' => $mstart, 'completed' => $mdone,
                'completionRate' => a_pct($mdone, count($us))];
        }
        $accountsOut[] = ['id' => $t['id'], 'name' => $t['name'], 'slug' => $t['slug'], 'type' => $t['type'],
            'portalId' => $t['portal_id'], 'portalName' => $portalById[$t['portal_id']]['name'] ?? null,
            'active' => (bool)($t['active'] ?? true),
            'staff' => count(array_filter($staff, fn($u) => $u['tenant_id'] === $t['id'])),
            'participants' => count($us),
            'involved' => count(array_filter($us, fn($u) => !empty($subsByUser[$u['id']]))),
            'submissions' => count($asubs), 'byType' => (object)$byType, 'certificates' => count($acerts),
            'flagged' => $aflag, 'flaggedRate' => a_pct($aflag, count($asubs)),
            'avgProgress' => a_mean(array_map(fn($u) => $perf[$u['id']]['progress'], $us)),
            'completionRate' => a_pct($afin, count($us)), 'finished' => $afin,
            'keywordCoverage' => a_mean($akw), 'objectiveAccuracy' => a_mean($aobj),
            'lastActivity' => iso($last),
            'chaptersDone' => count(array_filter($asubs, fn($s) => ($s['type'] ?? '') === 'chapter_summary')),
            'objectivesAnswered' => count(array_filter($asubs, fn($s) => ($s['type'] ?? '') === 'objectives')),
            'modules' => $modRows];
    }

    /* ---- per module / book / chapter (finest grain) -------------------- */
    $moduleStats = [];
    foreach ($modules as $m) {
        $msubs = array_values(array_filter($subs, fn($s) => $s['module_id'] === $m['id']));
        $bStmt = $pdo->prepare('SELECT * FROM books WHERE module_id=? ORDER BY `order` ASC, id ASC');
        $bStmt->execute([$m['id']]);
        $booksOut = [];
        foreach ($bStmt->fetchAll() as $brow) {
            $b = n_book($brow);
            $chOut = [];
            foreach (chapters_of($b['id'], null) as $c) {
                $csubs = array_values(array_filter($msubs, fn($s) => $s['chapter_id'] === $c['id']));
                $ckw = []; $cobj = [];
                foreach ($csubs as $s) {
                    $a = submission_assessment($s);
                    if ($a && $a['keywordScore'] !== null) $ckw[] = $a['keywordScore'];
                    if (($s['type'] ?? '') === 'objectives' && (int)($s['total'] ?? 0) > 0) $cobj[] = (int)round(100 * (int)$s['score'] / (int)$s['total']);
                }
                $chOut[] = ['id' => $c['id'], 'title' => $c['title'],
                    'pageStart' => $c['pageStart'], 'pageEnd' => $c['pageEnd'],
                    'submissions' => count($csubs),
                    'learners' => count(array_unique(array_map(fn($s) => $s['user_id'], $csubs))),
                    'completed' => count(array_unique(array_map(fn($s) => $s['user_id'],
                        array_filter($csubs, fn($s) => ($s['type'] ?? '') === 'chapter_summary')))),
                    'keywordCoverage' => a_mean($ckw),
                    'objectivesAnswered' => count($cobj), 'accuracy' => a_mean($cobj),
                    'flagged' => count(array_filter($csubs, fn($s) => !empty($s['flagged'])))];
            }
            $booksOut[] = ['id' => $b['id'], 'title' => $b['title'], 'order' => $b['order'] ?? null,
                'scope' => $b['scope'] ?? 'global',
                'submissions' => count(array_filter($msubs, fn($s) => $s['book_id'] === $b['id'])),
                'chapters' => $chOut];
        }
        $mdone = 0; $mstart = 0; $mprog = [];
        foreach ($participants as $u) {
            $st = null;
            foreach ($perf[$u['id']]['statuses'] as $s2) if ($s2['id'] === $m['id']) { $st = $s2; break; }
            $mprog[] = $st ? (int)$st['progress']['percent'] : 0;
            if ($st && $st['status'] === 'completed') $mdone++;
            if (count(array_filter($msubs, fn($x) => $x['user_id'] === $u['id'])) > 0) $mstart++;
        }
        $mkw = []; $mobj = [];
        foreach ($msubs as $s) {
            $a = submission_assessment($s);
            if ($a && $a['keywordScore'] !== null) $mkw[] = $a['keywordScore'];
            if (($s['type'] ?? '') === 'objectives' && (int)($s['total'] ?? 0) > 0) $mobj[] = (int)round(100 * (int)$s['score'] / (int)$s['total']);
        }
        $moduleStats[] = ['id' => $m['id'], 'order' => $m['order'], 'title' => $m['title'], 'mode' => $m['mode'],
            'certificateName' => $m['certificateName'], 'participants' => count($participants),
            'started' => $mstart, 'completed' => $mdone,
            'startedRate' => a_pct($mstart, count($participants)),
            'completionRate' => a_pct($mdone, count($participants)),
            'avgProgress' => a_mean($mprog) ?? 0,
            'submissions' => count($msubs),
            'flagged' => count(array_filter($msubs, fn($s) => !empty($s['flagged']))),
            'keywordCoverage' => a_mean($mkw), 'objectiveAccuracy' => a_mean($mobj),
            'books' => $booksOut];
    }

    /* ---- individuals --------------------------------------------------- */
    $learnerRows = [];
    foreach ($participants as $u) {
        $mine = $subsByUser[$u['id']] ?? [];
        $p = $perf[$u['id']];
        $kw = []; $obj = []; $last = null;
        foreach ($mine as $s) {
            $a = submission_assessment($s);
            if ($a && $a['keywordScore'] !== null) $kw[] = $a['keywordScore'];
            if (($s['type'] ?? '') === 'objectives' && (int)($s['total'] ?? 0) > 0) $obj[] = (int)round(100 * (int)$s['score'] / (int)$s['total']);
            if ($last === null || strtotime((string)$s['created_at']) > strtotime($last)) $last = $s['created_at'];
        }
        $t = null;
        foreach ($tenants as $tt) if ($tt['id'] === $u['tenant_id']) { $t = $tt; break; }
        $activeMod = null;
        foreach ($p['statuses'] as $st) if ($st['status'] === 'active') { $activeMod = $st; break; }
        $learnerRows[] = ['id' => $u['id'], 'name' => $u['full_name'], 'role' => $u['role'],
            'className' => $u['class_name'], 'studentNumber' => $u['student_number'],
            'account' => $t['name'] ?? null, 'accountId' => $u['tenant_id'],
            'portal' => $t ? ($portalById[$t['portal_id']]['name'] ?? null) : null,
            'progress' => $p['progress'] ?? 0, 'modulesCompleted' => $p['completed'], 'moduleCount' => $p['modules'],
            'finished' => $p['modules'] > 0 && $p['completed'] === $p['modules'],
            'level' => $activeMod ? $activeMod['title']
                : (($p['modules'] > 0 && $p['completed'] === $p['modules']) ? 'All modules completed' : '—'),
            'submissions' => count($mine), 'certificates' => count($certsByUser[$u['id']] ?? []),
            'flagged' => count(array_filter($mine, fn($s) => !empty($s['flagged']))),
            'keywordCoverage' => a_mean($kw), 'objectiveAccuracy' => a_mean($obj),
            'lastActiveAt' => iso($last)];
    }
    usort($learnerRows, function ($a, $b) {
        if ($b['progress'] !== $a['progress']) return $b['progress'] - $a['progress'];
        if ($b['submissions'] !== $a['submissions']) return $b['submissions'] - $a['submissions'];
        return strcmp((string)$a['name'], (string)$b['name']);
    });

    $activity = [];
    foreach ($buckets as $b) {
        $activity[] = ['label' => $b['label'], 'submissions' => $b['submissions'],
            'certificates' => $b['certificates'], 'newUsers' => $b['newUsers'],
            'activeLearners' => count($b['active'])];
    }

    /* every copy flag, and the person the work matched */
    $flaggedOut = [];
    foreach (array_slice(array_values(array_filter($subs, fn($s) => !empty($s['flagged']))), 0, 200) as $s) {
        $m = copy_match($s);
        $who = null;
        foreach ($allUsers as $u2) if ($u2['id'] === $s['user_id']) { $who = $u2; break; }
        $row = describe_sub(n_sub($s));
        $row['userId'] = $s['user_id'];
        $row['userName'] = $who['full_name'] ?? null;
        $row['className'] = $who['class_name'] ?? null;
        $row['matchedWith'] = $m;
        $row['matchedName'] = $m['name'] ?? null;
        $flaggedOut[] = $row;
    }

    $bookCount = 0; $chapterCount = 0; $objCount = 0;
    foreach ($modules as $m) {
        $bs = $pdo->prepare('SELECT id FROM books WHERE module_id=?'); $bs->execute([$m['id']]);
        $bids = array_map(fn($r) => $r['id'], $bs->fetchAll());
        $bookCount += count($bids);
        foreach ($bids as $bid) {
            $cs = $pdo->prepare('SELECT id FROM chapters WHERE book_id=?'); $cs->execute([$bid]);
            foreach ($cs->fetchAll() as $c) {
                $chapterCount++;
                $os = $pdo->prepare('SELECT COUNT(*) FROM objectives WHERE chapter_id=?'); $os->execute([$c['id']]);
                $objCount += (int)$os->fetchColumn();
            }
        }
    }

    return [
        'ok' => true,
        'generatedAt' => iso(now_dt()),
        'scope' => ['portalId' => $fPortal, 'tenantId' => $fTenant, 'moduleId' => $fModule, 'weeks' => $weeks],
        'filters' => [
            'portals' => array_map(fn($p) => ['id' => $p['id'], 'name' => $p['name'], 'key' => $p['key']], $portals),
            'tenants' => array_map(fn($t) => ['id' => $t['id'], 'name' => $t['name'], 'portalId' => $t['portal_id']], $tenants),
            'modules' => array_map(fn($m) => ['id' => $m['id'], 'title' => $m['title'], 'mode' => $m['mode']], all_modules()),
        ],
        'totals' => ['portals' => count($portals), 'accounts' => count($tenants),
            'participants' => count($participants), 'staff' => count($staff),
            'submissions' => count($subs), 'certificates' => count($certs), 'flagged' => $flaggedCount,
            'modules' => count($modules), 'books' => $bookCount, 'chapters' => $chapterCount, 'objectives' => $objCount],
        'impact' => $impact,
        'portals' => $portalStats,
        'accounts' => $accountsOut,
        'modules' => $moduleStats,
        'learners' => array_slice($learnerRows, 0, 300),
        'learnersTotal' => count($learnerRows),
        'activity' => $activity,
        'flagged' => $flaggedOut,
    ];
}

/* ---- the two routes that use the payload ------------------------------- */
function r_super_analytics(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super']);
    return analytics_payload(['weeks' => (int)($query['weeks'] ?? 12),
        'portalId' => $query['portalId'] ?? null,
        'tenantId' => $query['tenantId'] ?? null,
        'moduleId' => $query['moduleId'] ?? null]);
}
/* The same analysis for one account — never anything outside it. A supervisor
   only ever sees the members they look after. */
function r_admin_analytics(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super', 'tenant_admin', 'supervisor']);
    $pdo = db();
    $st = $pdo->prepare('SELECT * FROM tenants WHERE id=?'); $st->execute([$user['tenant_id']]);
    $myTenants = $st->fetchAll();
    $ps = $pdo->prepare('SELECT * FROM portals WHERE id IN (SELECT portal_id FROM tenants WHERE id=?)');
    $ps->execute([$user['tenant_id']]);
    $myPortals = $ps->fetchAll();
    $scope = ['weeks' => (int)($query['weeks'] ?? 12),
        'moduleId' => $query['moduleId'] ?? null,
        'tenants' => $myTenants, 'portals' => $myPortals];
    if ($user['role'] === 'supervisor') {
        /* only the members this supervisor looks after (staff are not learners) */
        $ms = $pdo->prepare('SELECT id FROM users WHERE supervisor_id=?'); $ms->execute([$user['id']]);
        $scope['userIds'] = array_map(fn($r) => $r['id'], $ms->fetchAll());
    } else {
        $scope['tenantId'] = $user['tenant_id'];
    }
    $d = analytics_payload($scope);
    $d['viewer'] = ['role' => $user['role'], 'tenantId' => $user['tenant_id'],
        'tenantName' => $myTenants[0]['name'] ?? null,
        'portalName' => $myPortals[0]['name'] ?? null];
    return $d;
}

/* Progress report: how each learner uses the system, their level, ranked by
   how much of the programme they have covered (super/tenant admin/supervisor). */
function r_reports_students(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super','tenant_admin','supervisor']);
    $rows = scoped_user_rows($user, $query);
    $pdo = db();
    $participantIds = array_values(array_map(fn($u) => $u['id'],
        array_filter($rows, fn($u) => in_array($u['role'], ['student','teacher','member'], true))));
    $activityYears = [];
    if (count($participantIds)) {
        $ph = implode(',', array_fill(0, count($participantIds), '?'));
        $st = $pdo->prepare("SELECT created_at FROM submissions WHERE user_id IN ($ph) AND module_id IS NOT NULL");
        $st->execute($participantIds);
        foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $createdAt) {
            $year = substr((string)$createdAt, 0, 4);
            if (preg_match('/^\d{4}$/', $year)) $activityYears[$year] = true;
        }
        $st = $pdo->prepare("SELECT issued_at FROM certificates WHERE user_id IN ($ph) AND type='module'");
        $st->execute($participantIds);
        foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $issuedAt) {
            $year = substr((string)$issuedAt, 0, 4);
            if (preg_match('/^\d{4}$/', $year)) $activityYears[$year] = true;
        }
    }
    $activityYears = array_keys($activityYears);
    rsort($activityYears, SORT_STRING);
    $students = [];
    foreach ($rows as $u) {
        if (!in_array($u['role'], ['student','teacher','member'], true)) continue;
        $perf = performance($u);
        $st = $pdo->prepare('SELECT COUNT(*) FROM submissions WHERE user_id=?'); $st->execute([$u['id']]);
        $subs = (int)$st->fetchColumn();
        $st = $pdo->prepare('SELECT MAX(created_at) FROM submissions WHERE user_id=?'); $st->execute([$u['id']]);
        $last = $st->fetchColumn() ?: null;
        $st = $pdo->prepare('SELECT * FROM submissions WHERE user_id=? ORDER BY created_at DESC LIMIT 6');
        $st->execute([$u['id']]);
        $recent = [];
        foreach ($st->fetchAll() as $row) {
            $d = describe_sub(n_sub($row));
            $a = submission_assessment($row);
            $recent[] = ['type'=>$d['type'] ?? 'summary', 'createdAt'=>$d['createdAt'] ?? null,
                'text'=>mb_substr((string)($d['text'] ?? ''), 0, 240), 'score'=>$d['score'] ?? null,
                'total'=>$d['total'] ?? null, 'flagged'=>(bool)($d['flagged'] ?? false),
                'similarity'=>$d['similarity'] ?? 0, 'label'=>$d['label'] ?? null,
                'keywordScore'=>$a['keywordScore'] ?? null, 'keywordsUsed'=>$a['keywordsUsed'] ?? null,
                'keywordsTotal'=>$a['keywordsTotal'] ?? null, 'keywordsMissing'=>$a['keywordsMissing'] ?? [],
                'chapter'=>$d['chapter'] ?? null, 'book'=>$d['book'] ?? null];
        }
        $mods = $perf['modules'];
        $completed = 0; $active = null; $activeIdx = 0;
        foreach ($mods as $i => $m) {
            if (($m['status'] ?? '') === 'active') { $active = $m; $activeIdx = $i + 1; }
            if (($m['status'] ?? '') === 'completed') $completed++;
        }
        if ($active) { $level = ['index'=>$activeIdx, 'title'=>$active['title'], 'percent'=>(int)$active['percent'], 'state'=>'In progress']; }
        elseif (count($mods) && $completed === count($mods)) { $level = ['index'=>count($mods), 'title'=>'All modules completed', 'percent'=>100, 'state'=>'Completed']; }
        elseif (count($mods)) { $level = ['index'=>1, 'title'=>$mods[0]['title'], 'percent'=>(int)$mods[0]['percent'], 'state'=>'Not started']; }
        else { $level = ['index'=>0, 'title'=>'—', 'percent'=>0, 'state'=>'Not started']; }
        $sup = null;
        if (!empty($u['supervisor_id'])) {
            $s2 = $pdo->prepare('SELECT full_name FROM users WHERE id=? LIMIT 1'); $s2->execute([$u['supervisor_id']]);
            $sup = $s2->fetchColumn() ?: null;
        }
        $tn = null;
        if (!empty($u['tenant_id'])) { $t = get_tenant($u['tenant_id']); $tn = $t ? $t['name'] : null; }
        /* how well this learner uses the chapter key words in typed answers */
        $ks = $pdo->prepare('SELECT * FROM submissions WHERE user_id=? AND `text` IS NOT NULL');
        $ks->execute([$u['id']]);
        $scores = [];
        foreach ($ks->fetchAll() as $sr) {
            $a = submission_assessment($sr);
            if ($a && $a['keywordScore'] !== null) $scores[] = $a['keywordScore'];
        }
        $students[] = ['id'=>$u['id'], 'fullName'=>$u['full_name'], 'email'=>$u['email'],
            'studentNumber'=>$u['student_number'], 'className'=>$u['class_name'], 'role'=>$u['role'],
            'suspended'=>(bool)$u['suspended'], 'tenantId'=>$u['tenant_id'], 'tenantName'=>$tn,
            'supervisorName'=>$sup, 'submissions'=>$subs, 'lastActiveAt'=>iso($last),
            'certificates'=>(int)$perf['certificates'], 'flagged'=>(int)$perf['flagged'],
            'progress'=>(int)$perf['overall'], 'modulesCompleted'=>$completed, 'moduleCount'=>count($mods),
            'keywordScore'=>$scores ? (int)round(array_sum($scores) / count($scores)) : null,
            'typedAnswers'=>count($scores),
            'level'=>$level,
            'modules'=>array_map(fn($m)=>['id'=>$m['id'], 'title'=>$m['title'],
                'percent'=>(int)$m['percent'], 'status'=>$m['status']], $mods),
            'recent'=>$recent];
    }
    usort($students, function ($a, $b) {
        if ($b['progress'] !== $a['progress']) return $b['progress'] - $a['progress'];
        if ($b['modulesCompleted'] !== $a['modulesCompleted']) return $b['modulesCompleted'] - $a['modulesCompleted'];
        if ($b['submissions'] !== $a['submissions']) return $b['submissions'] - $a['submissions'];
        return strcmp((string)$a['fullName'], (string)$b['fullName']);
    });
    $n = count($students);
    return ['students'=>$students, 'count'=>$n, 'activityYears'=>$activityYears,
        'average'=>$n ? (int)round(array_sum(array_map(fn($s)=>$s['progress'], $students)) / $n) : 0,
        'finished'=>count(array_filter($students, fn($s)=>$s['moduleCount'] > 0 && $s['modulesCompleted'] === $s['moduleCount'])),
        'started'=>count(array_filter($students, fn($s)=>$s['submissions'] > 0)),
        'notStarted'=>count(array_filter($students, fn($s)=>$s['submissions'] === 0))];
}
function r_reports_module_performers(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super','tenant_admin','supervisor']);
    $moduleId = trim((string)($query['moduleId'] ?? ''));
    $allCompleted = ($query['scope'] ?? '') === 'all-completed';
    $from = trim((string)($query['from'] ?? ''));
    $to = trim((string)($query['to'] ?? ''));
    need($allCompleted || $moduleId !== '', 'Choose a module or all-modules view');
    $moduleRow = null;
    if (!$allCompleted) {
        $st = db()->prepare('SELECT * FROM modules WHERE id=? LIMIT 1');
        $st->execute([$moduleId]);
        $moduleRow = $st->fetch();
        need((bool)$moduleRow, 'Module not found', 404);
    }
    need((bool)preg_match('/^\d{4}-\d{2}-\d{2}$/', $from) &&
        (bool)preg_match('/^\d{4}-\d{2}-\d{2}$/', $to), 'Choose a valid start and end date');
    $fromDate = DateTimeImmutable::createFromFormat('!Y-m-d', $from);
    $toDate = DateTimeImmutable::createFromFormat('!Y-m-d', $to);
    need($fromDate && $fromDate->format('Y-m-d') === $from &&
        $toDate && $toDate->format('Y-m-d') === $to, 'Choose valid calendar dates');
    need($from <= $to, 'The start date must be before or equal to the end date');
    need(substr($from, 0, 4) === substr($to, 0, 4), 'Choose a period within one calendar year');

    $moduleIds = $allCompleted
        ? array_column(all_modules(), 'id')
        : [$moduleId];
    need(count($moduleIds) > 0, 'There are no modules to rank');
    $rows = array_values(array_filter(scoped_user_rows($user, []),
        fn($u) => in_array($u['role'], ['student','teacher','member'], true)));
    $eligible = [];
    $ranked = [];
    if (count($rows)) {
        $ids = array_values(array_map(fn($u) => $u['id'], $rows));
        if ($allCompleted) {
            $userPh = implode(',', array_fill(0, count($ids), '?'));
            $modulePh = implode(',', array_fill(0, count($moduleIds), '?'));
            $st = db()->prepare("SELECT user_id,module_id FROM certificates
                WHERE type='module' AND issued_at < DATE_ADD(?, INTERVAL 1 DAY)
                AND user_id IN ($userPh) AND module_id IN ($modulePh)");
            $st->execute(array_merge([$to], $ids, $moduleIds));
            $completed = [];
            foreach ($st->fetchAll() as $certificate) {
                $completed[$certificate['user_id']][$certificate['module_id']] = true;
            }
            foreach ($rows as $student) {
                if (count($completed[$student['id']] ?? []) === count($moduleIds)) $eligible[] = $student;
            }
        } else {
            $eligible = $rows;
        }
        $ids = array_values(array_map(fn($u) => $u['id'], $eligible));
        if (count($ids)) {
            $userPh = implode(',', array_fill(0, count($ids), '?'));
            $modulePh = implode(',', array_fill(0, count($moduleIds), '?'));
            $st = db()->prepare("SELECT *
                FROM submissions WHERE DATE(created_at) BETWEEN ? AND ?
                AND user_id IN ($userPh) AND module_id IN ($modulePh)");
            $st->execute(array_merge([$from, $to], $ids, $moduleIds));
            $scores = [];
            foreach ($st->fetchAll() as $submission) {
                $studentId = $submission['user_id'];
                if (!isset($scores[$studentId])) {
                    $scores[$studentId] = ['activityMarks'=>0, 'activityCount'=>0,
                        'objectiveScore'=>0, 'objectiveTotal'=>0];
                }
                if ($submission['type'] === 'objectives' && (int)$submission['total'] > 0) {
                    $total = (int)$submission['total'];
                    $earned = max(0, min($total, (int)$submission['score']));
                    $scores[$studentId]['activityMarks'] += $earned * 100 / $total;
                    $scores[$studentId]['activityCount']++;
                    $scores[$studentId]['objectiveScore'] += $earned;
                    $scores[$studentId]['objectiveTotal'] += $total;
                } elseif (in_array($submission['type'], ['chapter_summary','letter_summary','book_summary'], true)) {
                    $assessment = submission_assessment($submission);
                    if ($assessment && $assessment['keywordScore'] !== null) {
                        $scores[$studentId]['activityMarks'] += max(0, min(100, (int)$assessment['keywordScore']));
                        $scores[$studentId]['activityCount']++;
                    }
                }
            }
            foreach ($eligible as $student) {
                $marks = $scores[$student['id']] ?? [
                    'activityMarks'=>0, 'activityCount'=>0, 'objectiveScore'=>0, 'objectiveTotal'=>0];
                $eligibleRow = [
                    'id'=>$student['id'], 'fullName'=>$student['full_name'],
                    'studentNumber'=>$student['student_number'], 'className'=>$student['class_name'],
                    'combinedPercent'=>$marks['activityCount']
                        ? (int)round($marks['activityMarks'] / $marks['activityCount']) : null,
                    'activityCount'=>$marks['activityCount'],
                    'objectiveScore'=>$marks['objectiveScore'],
                    'objectiveTotal'=>$marks['objectiveTotal'],
                    'objectivePercent'=>$marks['objectiveTotal']
                        ? (int)round(100 * $marks['objectiveScore'] / $marks['objectiveTotal']) : null];
                if ($eligibleRow['combinedPercent'] !== null || $eligibleRow['objectivePercent'] !== null) {
                    $ranked[] = $eligibleRow;
                }
            }
        }
    }
    $topTen = function(string $metric) use ($ranked): array {
        $rows = array_values(array_filter($ranked, fn($student) => $student[$metric] !== null));
        usort($rows, function ($a, $b) use ($metric) {
            if ($a[$metric] !== $b[$metric]) return $b[$metric] <=> $a[$metric];
            if ($a['objectivePercent'] !== $b['objectivePercent']) {
                return ($b['objectivePercent'] ?? -1) <=> ($a['objectivePercent'] ?? -1);
            }
            return strcmp((string)$a['fullName'], (string)$b['fullName']);
        });
        return array_slice($rows, 0, 10);
    };
    $module = $moduleRow ? n_module($moduleRow) : null;
    return ['scope'=>$allCompleted ? 'all-completed' : 'module',
        'module'=>$module ? ['id'=>$module['id'], 'title'=>$module['title']] : null,
        'moduleCount'=>count($moduleIds), 'from'=>$from, 'to'=>$to,
        'completedBy'=>$allCompleted ? $to : null,
        'rankings'=>['combined'=>$topTen('combinedPercent'), 'objectives'=>$topTen('objectivePercent')]];
}
function r_admin_overview(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super','tenant_admin','supervisor']);
    if ($user['role'] === 'super') return r_super_overview($user, $body, $params, $token, $query);
    $tenant = get_tenant($user['tenant_id']);
    $por = null;
    if ($tenant) { $st = db()->prepare('SELECT * FROM portals WHERE id=?'); $st->execute([$tenant['portal_id']]); $por = $st->fetch() ?: null; }
    $pdo = db(); $tid = $user['tenant_id'];
    $c = function(string $sql, array $a=[]) use ($pdo): int {
        $st = $pdo->prepare($sql); $st->execute($a); return (int)$st->fetchColumn();
    };
    $counts = ['users'=>$c('SELECT COUNT(*) FROM users WHERE tenant_id=?', [$tid]),
        'supervisors'=>$c("SELECT COUNT(*) FROM users WHERE tenant_id=? AND role='supervisor'", [$tid]),
        'submissions'=>$c('SELECT COUNT(*) FROM submissions WHERE tenant_id=?', [$tid]),
        'flagged'=>$c('SELECT COUNT(*) FROM submissions WHERE tenant_id=? AND flagged=1', [$tid]),
        'certificates'=>$c('SELECT COUNT(*) FROM certificates WHERE tenant_id=?', [$tid])];
    $sups = [];
    if ($user['role'] === 'tenant_admin') {
        $st = $pdo->prepare("SELECT * FROM users WHERE tenant_id=? AND role='supervisor' ORDER BY created_at DESC");
        $st->execute([$tid]);
        foreach ($st->fetchAll() as $s) {
            $st2 = $pdo->prepare('SELECT COUNT(*) FROM users WHERE supervisor_id=?'); $st2->execute([$s['id']]);
            $sups[] = ['id'=>$s['id'],'fullName'=>$s['full_name'],'email'=>$s['email'],
                'code'=>$s['supervisor_code'],'users'=>(int)$st2->fetchColumn(),'limit'=>100];
        }
    }
    /* the quota the console shows: an object for supervisors (max/used), nothing
       for a tenant admin — same shape the Node build and /users return */
    $used = 0;
    if ($user['role'] === 'supervisor') {
        $st = $pdo->prepare('SELECT COUNT(*) FROM users WHERE supervisor_id=?'); $st->execute([$user['id']]);
        $used = (int)$st->fetchColumn();
    }
    return ['branding'=>tenant_branding($tenant),'portal'=>$por ? portal_public($por) : null,
        'counts'=>$counts,'supervisors'=>$sups,
        'limit' => $user['role'] === 'supervisor' ? ['max'=>100,'used'=>$used] : null];
}
function r_users_list(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super','tenant_admin','supervisor']);
    $rows = scoped_user_rows($user, $query);
    $names = sup_names_for($rows);
    $out = array_map(fn($u)=>admin_user_map($u, $names), $rows);
    if ($user['role'] === 'supervisor') {
        return ['users'=>$out,'limit'=>['max'=>100,'used'=>count($rows)]];
    }
    return ['users' => $out, 'limit' => null];
}
function build_user_record(array $acting, array $body): array {
    $role = $acting['role'];
    $tenantId = $body['tenantId'] ?? $body['tenant_id'] ?? null;
    if ($role === 'super') { need($tenantId, 'tenantId required'); }
    else { $tenantId = $acting['tenant_id']; }
    $st = db()->prepare('SELECT * FROM tenants WHERE id=?'); $st->execute([$tenantId]); $ten = $st->fetch();
    need($ten, 'Tenant not found', 404);
    $reqRole = $body['role'] ?? 'member';
    if ($role === 'supervisor') $reqRole = 'member';
    need($reqRole !== 'super', 'Cannot create super', 403);
    $isSchool = ($ten['type'] ?? '') === 'school' || ($ten['type'] ?? '') === 'schools';
    $isOrg = ($ten['type'] ?? '') === 'organization';
    if ($role !== 'super' && $role !== 'tenant_admin') {
        need(in_array($reqRole, ['member'], true), 'Not permitted', 403);
    } else {
        /* Organization portal: the admin only adds supervisors; supervisors then
           add their own users (max 100 each). Super admin bypasses this. */
        $allowed = $isSchool ? ['student','teacher','supervisor']
            : ($isOrg && $role !== 'super' ? ['supervisor'] : ['member','supervisor']);
        if ($role !== 'supervisor') $allowed[] = 'tenant_admin';
        need(in_array($reqRole, $allowed, true), 'Role not allowed for this portal', 403);
    }
    $fn = trim((string)($body['fullName'] ?? $body['full_name'] ?? '')); need($fn !== '', 'fullName required');
    $email = trim((string)($body['email'] ?? '')); $sn = trim((string)($body['studentNumber'] ?? $body['student_number'] ?? ''));
    if ($reqRole === 'student') need($sn !== '', 'studentNumber required');
    if (in_array($reqRole, ['teacher','tenant_admin','supervisor'], true)) need($email !== '', 'email required');
    if ($email !== '') {
        $st = db()->prepare('SELECT COUNT(*) FROM users WHERE email=? AND tenant_id=?'); $st->execute([$email, $tenantId]);
        need((int)$st->fetchColumn() === 0, 'Email already exists', 409);
    }
    if ($sn !== '') {
        $st = db()->prepare('SELECT COUNT(*) FROM users WHERE student_number=? AND tenant_id=?'); $st->execute([$sn, $tenantId]);
        need((int)$st->fetchColumn() === 0, 'Student number already exists', 409);
    }
    $supId = $body['supervisorId'] ?? $body['supervisor_id'] ?? null;
    if ($role === 'supervisor') {
        $st = db()->prepare('SELECT COUNT(*) FROM users WHERE supervisor_id=?'); $st->execute([$acting['id']]);
        need((int)$st->fetchColumn() < 100, 'Supervisor limit reached', 409);
        $supId = $acting['id'];
    }
    $pw = (string)($body['password'] ?? ''); need($pw !== '', 'password required');
    $code = null;
    if ($reqRole === 'supervisor') { $code = 'SUP-' . rand(1000, 9999); $supId = null; }
    $id = uid('usr');
    db()->prepare('INSERT INTO users (id,tenant_id,role,supervisor_id,supervisor_code,full_name,email,student_number,class_name,photo,password_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
        ->execute([$id, $tenantId, $reqRole, $supId, $code, $fn, $email ?: null, $sn ?: null,
            $body['className'] ?? $body['class_name'] ?? null, $body['photo'] ?? null, hash_pw($pw), now_dt()]);
    $st = db()->prepare('SELECT * FROM users WHERE id=?'); $st->execute([$id]);
    return $st->fetch();
}

function r_users_create(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super','tenant_admin','supervisor']);
    $row = build_user_record($user, $body);
    $names = sup_names_for([$row]);
    return ['user' => admin_user_map($row, $names)];
}

/* Bulk insert: same validation as single create, per-row results (partial
   success allowed). Schools portal -> bulk students; organization -> bulk users. */
function r_users_bulk(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super','tenant_admin','supervisor']);
    $rows = $body['users'] ?? null;
    need(is_array($rows) && count($rows), 'No rows supplied');
    need(count($rows) <= 500, 'Maximum 500 users per bulk insert');
    $created = []; $errors = [];
    foreach ($rows as $i => $row) {
        try {
            $rec = build_user_record($user, is_array($row) ? $row : []);
            $names = sup_names_for([$rec]);
            $created[] = admin_user_map($rec, $names);
        } catch (ApiError $e) {
            $errors[] = ['index' => $i + 1,
                'name' => is_array($row) ? (string)($row['fullName'] ?? $row['full_name'] ?? '') : '',
                'error' => $e->getMessage()];
        } catch (Throwable $e) {
            $errors[] = ['index' => $i + 1,
                'name' => is_array($row) ? (string)($row['fullName'] ?? $row['full_name'] ?? '') : '',
                'error' => 'Failed'];
        }
    }
    return ['total' => count($rows), 'created' => $created, 'errors' => $errors];
}
function user_can_manage(array $user, array $row): bool {
    if ($user['role'] === 'super') return true;
    if ($user['role'] === 'tenant_admin') return ($row['tenant_id'] ?? null) === $user['tenant_id'];
    return ($row['supervisor_id'] ?? null) === $user['id'];
}
function r_users_update(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super','tenant_admin','supervisor']);
    $id = $params['id'] ?? $body['id'] ?? null; need($id, 'id required');
    $st = db()->prepare('SELECT * FROM users WHERE id=?'); $st->execute([$id]); $row = $st->fetch();
    need($row, 'User not found', 404);
    if (($row['role'] ?? '') === 'super') { require_role($user, ['super']); }
    need(user_can_manage($user, $row), 'Not permitted', 403);
    $set = []; $args = [];
    if (isset($body['fullName']) || isset($body['full_name'])) { $set[] = 'full_name=?'; $args[] = $body['fullName'] ?? $body['full_name']; }
    if (array_key_exists('className', $body) || array_key_exists('class_name', $body)) { $set[] = 'class_name=?'; $args[] = $body['className'] ?? $body['class_name']; }
    if (array_key_exists('email', $body)) { $set[] = 'email=?'; $args[] = $body['email'] ?: null; }
    if (array_key_exists('studentNumber', $body) || array_key_exists('student_number', $body)) { $set[] = 'student_number=?'; $args[] = $body['studentNumber'] ?? $body['student_number']; }
    if (array_key_exists('photo', $body)) { $set[] = 'photo=?'; $args[] = $body['photo']; }
    if (!empty($body['password'])) { $set[] = 'password_hash=?'; $args[] = hash_pw((string)$body['password']); }
    if (isset($body['supervisorId']) || isset($body['supervisor_id'])) { $set[] = 'supervisor_id=?'; $args[] = $body['supervisorId'] ?? $body['supervisor_id']; }
    $nr = $body['role'] ?? $body['newRole'] ?? null;
    if ($nr !== null) {
        need(in_array($user['role'], ['super','tenant_admin'], true), 'Not permitted', 403);
        need($nr !== 'super', 'Cannot assign super', 403);
        $set[] = 'role=?'; $args[] = $nr;
    }
    $susp = $body['suspended'] ?? null;
    if ($susp !== null) {
        need($user['role'] !== 'supervisor', 'Not permitted', 403);
        $set[] = 'suspended=?'; $args[] = (int)(bool)$susp;
    }
    if (count($set)) { $args[] = $id; db()->prepare('UPDATE users SET ' . implode(',', $set) . ' WHERE id=?')->execute($args); }
    $st = db()->prepare('SELECT * FROM users WHERE id=?'); $st->execute([$id]);
    $r2 = $st->fetch(); return admin_user_map($r2, sup_names_for([$r2]));
}
function r_users_delete(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super','tenant_admin','supervisor']);
    $id = $params['id'] ?? $body['id'] ?? null; need($id, 'id required');
    need($id !== $user['id'], 'Cannot delete self', 400);
    $st = db()->prepare('SELECT * FROM users WHERE id=?'); $st->execute([$id]); $row = $st->fetch();
    need($row, 'User not found', 404);
    need(($row['role'] ?? '') !== 'super', 'Cannot delete super', 403);
    need(user_can_manage($user, $row), 'Not permitted', 403);
    db()->prepare('UPDATE users SET supervisor_id=NULL WHERE supervisor_id=?')->execute([$id]);
    db()->prepare('DELETE FROM users WHERE id=?')->execute([$id]);
    return ['deleted' => true];
}
function r_admin_branding(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super','tenant_admin']);
    $tid = $user['role'] === 'super' ? ($body['tenantId'] ?? $body['tenant_id'] ?? null) : $user['tenant_id'];
    need($tid, 'tenantId required');
    $st = db()->prepare('SELECT * FROM tenants WHERE id=?'); $st->execute([$tid]); $t = $st->fetch();
    need($t, 'Tenant not found', 404);
    $set = []; $args = [];
    if (array_key_exists('logo', $body)) { $set[] = 'logo=?'; $args[] = $body['logo']; }
    /* the programme logo belongs to the super admin only */
    if ($user['role'] === 'super') {
        $pl = $body['programLogo'] ?? $body['program_logo'] ?? null;
        if (array_key_exists('programLogo', $body) || array_key_exists('program_logo', $body)) { $set[] = 'program_logo=?'; $args[] = $pl; }
    }
    if (array_key_exists('themeColor', $body) || array_key_exists('theme_color', $body)) {
        $c = $body['themeColor'] ?? $body['theme_color'] ?? null;
        $c = (is_string($c) && preg_match('/^#[0-9a-fA-F]{6}$/', trim($c))) ? strtolower(trim($c)) : null;
        $set[] = 'theme_color=?'; $args[] = $c;
    }
    if (isset($body['name'])) { need($user['role'] === 'super', 'Not permitted', 403); $set[] = 'name=?'; $args[] = $body['name']; }
    if (count($set)) {
        $args[] = $tid;
        try {
            db()->prepare('UPDATE tenants SET ' . implode(',', $set) . ' WHERE id=?')->execute($args);
        } catch (PDOException $e) {
            /* older installs: create the account-colour column on first use, then retry */
            db()->exec('ALTER TABLE tenants ADD COLUMN theme_color VARCHAR(20) NULL');
            db()->prepare('UPDATE tenants SET ' . implode(',', $set) . ' WHERE id=?')->execute($args);
        }
    }
    $st = db()->prepare('SELECT * FROM tenants WHERE id=?'); $st->execute([$tid]);
    return tenant_row($st->fetch());
}
function r_admin_submissions(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super','tenant_admin','supervisor']);
    return ['submissions' => admin_submissions($user, $query)];
}
function r_admin_certificates(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super','tenant_admin','supervisor']);
    $role = $user['role'];
    if ($role === 'super') {
        $st = db()->query('SELECT * FROM certificates ORDER BY issued_at DESC LIMIT 400');
        $st->execute(); $rows = $st->fetchAll();
    } elseif ($role === 'tenant_admin') {
        $st = db()->prepare('SELECT * FROM certificates WHERE tenant_id=? ORDER BY issued_at DESC LIMIT 400');
        $st->execute([$user['tenant_id']]); $rows = $st->fetchAll();
    } else {
        $st = db()->prepare('SELECT id FROM users WHERE supervisor_id=?'); $st->execute([$user['id']]);
        $ids = $st->fetchAll(PDO::FETCH_COLUMN);
        if (!count($ids)) return ['certificates' => []];
        $ph = implode(',', array_fill(0, count($ids), '?'));
        $st = db()->prepare("SELECT * FROM certificates WHERE user_id IN ($ph) ORDER BY issued_at DESC LIMIT 400");
        $st->execute($ids); $rows = $st->fetchAll();
    }
    return ['certificates' => array_map('n_cert', $rows)];
}
function r_books_list(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super','tenant_admin']);
    $mid = trim((string)($query['moduleId'] ?? ''));
    $sql = 'SELECT * FROM books'; $args = []; $w = [];
    if ($mid !== '') { $w[] = 'module_id=?'; $args[] = $mid; }
    if ($user['role'] !== 'super') { $w[] = "(scope='global' OR scope=?)"; $args[] = $user['tenant_id']; }
    if (count($w)) $sql .= ' WHERE ' . implode(' AND ', $w);
    $sql .= ' ORDER BY `order` ASC, id ASC';
    $st = db()->prepare($sql); $st->execute($args);
    $out = [];
    foreach ($st->fetchAll() as $b) {
        $br = book_row($b); $br['canEdit'] = can_edit($user, $b['scope']);
        $csql = 'SELECT * FROM chapters WHERE book_id=?'; $cargs = [$b['id']];
        if ($user['role'] !== 'super') { $csql .= " AND (scope='global' OR scope=?)"; $cargs[] = $user['tenant_id']; }
        $csql .= ' ORDER BY `order` ASC, id ASC';
        $cst = db()->prepare($csql); $cst->execute($cargs);
        $chs = [];
        foreach ($cst->fetchAll() as $c) {
            $cr = chap_row($c); $cr['canEdit'] = can_edit($user, $c['scope']);
            $ost = db()->prepare('SELECT * FROM objectives WHERE chapter_id=? ORDER BY `order` ASC, id ASC');
            $ost->execute([$c['id']]); $objs = [];
            foreach ($ost->fetchAll() as $o) {
                if ($user['role'] !== 'super' && $o['scope'] !== 'global' && $o['scope'] !== $user['tenant_id']) continue;
                $orr = obj_row($o); $orr['canEdit'] = can_edit($user, $o['scope']); $objs[] = $orr;
            }
            $cr['objectives'] = $objs; $chs[] = $cr;
        }
        $br['chapters'] = $chs; $out[] = $br;
    }
    return ['books' => $out];
}
function r_books_create(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super','tenant_admin']);
    $title = trim((string)($body['title'] ?? '')); need($title !== '', 'title required');
    $mid = $body['moduleId'] ?? $body['module_id'] ?? null; need($mid, 'moduleId required');
    $st = db()->prepare('SELECT * FROM modules WHERE id=?'); $st->execute([$mid]); need($st->fetch(), 'Module not found', 404);
    $scope = $user['role'] === 'super' ? ($body['scope'] ?? 'global') : $user['tenant_id'];
    $st = db()->prepare('SELECT COUNT(*) FROM books WHERE module_id=?'); $st->execute([$mid]);
    $ord = $body['order'] ?? ((int)$st->fetchColumn() + 1);
    $id = uid('bok');
    db()->prepare('INSERT INTO books (id,module_id,scope,`order`,title,library_id,letter_id,created_at) VALUES (?,?,?,?,?,?,?,?)')
        ->execute([$id, $mid, $scope, $ord, $title, $body['libraryId'] ?? $body['library_id'] ?? null, $body['letterId'] ?? $body['letter_id'] ?? null, now_dt()]);
    $st = db()->prepare('SELECT * FROM books WHERE id=?'); $st->execute([$id]);
    $br = book_row($st->fetch()); $br['canEdit'] = true; $br['chapters'] = []; return $br;
}
function r_books_update(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super','tenant_admin']);
    $id = $params['id'] ?? $body['id'] ?? null; need($id, 'id required');
    $st = db()->prepare('SELECT * FROM books WHERE id=?'); $st->execute([$id]); $b = $st->fetch();
    need($b, 'Book not found', 404); need(can_edit($user, $b['scope']), 'Not permitted', 403);
    $set = []; $args = [];
    if (isset($body['title'])) { $set[] = 'title=?'; $args[] = $body['title']; }
    if (isset($body['order'])) { $set[] = '`order`=?'; $args[] = (int)$body['order']; }
    if (isset($body['moduleId']) || isset($body['module_id'])) { $set[] = 'module_id=?'; $args[] = $body['moduleId'] ?? $body['module_id']; }
    if (array_key_exists('libraryId', $body) || array_key_exists('library_id', $body)) { $set[] = 'library_id=?'; $args[] = $body['libraryId'] ?? $body['library_id']; }
    if (array_key_exists('letterId', $body) || array_key_exists('letter_id', $body)) { $set[] = 'letter_id=?'; $args[] = $body['letterId'] ?? $body['letter_id']; }
    if (count($set)) { $args[] = $id; db()->prepare('UPDATE books SET ' . implode(',', $set) . ' WHERE id=?')->execute($args); }
    $st = db()->prepare('SELECT * FROM books WHERE id=?'); $st->execute([$id]);
    $br = book_row($st->fetch()); $br['canEdit'] = true; return $br;
}
function r_books_delete(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super','tenant_admin']);
    $id = $params['id'] ?? $body['id'] ?? null; need($id, 'id required');
    $st = db()->prepare('SELECT * FROM books WHERE id=?'); $st->execute([$id]); $b = $st->fetch();
    need($b, 'Book not found', 404); need(can_edit($user, $b['scope']), 'Not permitted', 403);
    $st = db()->prepare('SELECT id FROM chapters WHERE book_id=?'); $st->execute([$id]);
    $cids = $st->fetchAll(PDO::FETCH_COLUMN);
    if (count($cids)) {
        $ph = implode(',', array_fill(0, count($cids), '?'));
        db()->prepare("DELETE FROM objectives WHERE chapter_id IN ($ph)")->execute($cids);
        db()->prepare('DELETE FROM chapters WHERE book_id=?')->execute([$id]);
    }
    db()->prepare('DELETE FROM books WHERE id=?')->execute([$id]);
    return ['deleted' => true];
}
function r_chapters_create(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super','tenant_admin']);
    $bookId = $params['id'] ?? $params['bookId'] ?? $body['bookId'] ?? $body['book_id'] ?? $body['book_id'] ?? null;
    if (!$bookId) $bookId = $params['bookId'] ?? null;
    need($bookId, 'book id required');
    $st = db()->prepare('SELECT * FROM books WHERE id=?'); $st->execute([$bookId]); $b = $st->fetch();
    need($b, 'Book not found', 404);
    need($user['role'] === 'super' || $b['scope'] === 'global' || $b['scope'] === $user['tenant_id'], 'Not permitted', 403);
    $title = trim((string)($body['title'] ?? '')); need($title !== '', 'title required');
    $scope = $user['role'] === 'super' ? ($body['scope'] ?? $b['scope']) : $user['tenant_id'];
    if ($user['role'] !== 'super' && $b['scope'] === 'global') $scope = $user['tenant_id'];
    if ($user['role'] === 'super' && !isset($body['scope'])) $scope = $b['scope'];
    $st = db()->prepare('SELECT COUNT(*) FROM chapters WHERE book_id=?'); $st->execute([$bookId]);
    $ord = $body['order'] ?? ((int)$st->fetchColumn() + 1);
    $id = uid('chp');
    if (has_column('chapters', 'keywords_json')) {
        db()->prepare('INSERT INTO chapters (id,book_id,scope,`order`,title,content,page_start,page_end,keywords_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
            ->execute([$id, $bookId, $scope, $ord, $title, $body['content'] ?? null,
                $body['pageStart'] ?? $body['page_start'] ?? null,
                $body['pageEnd'] ?? $body['page_end'] ?? null,
                jenc(clean_keywords($body['keywords'] ?? [])), now_dt()]);
    } else {
        db()->prepare('INSERT INTO chapters (id,book_id,scope,`order`,title,content,page_start,page_end,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
            ->execute([$id, $bookId, $scope, $ord, $title, $body['content'] ?? null,
                $body['pageStart'] ?? $body['page_start'] ?? null,
                $body['pageEnd'] ?? $body['page_end'] ?? null, now_dt()]);
    }
    $st = db()->prepare('SELECT * FROM chapters WHERE id=?'); $st->execute([$id]);
    $cr = chap_row($st->fetch()); $cr['canEdit'] = true; return $cr;
}
function r_chapters_update(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super','tenant_admin']);
    $id = $params['id'] ?? $body['id'] ?? null; need($id, 'id required');
    $st = db()->prepare('SELECT * FROM chapters WHERE id=?'); $st->execute([$id]); $c = $st->fetch();
    need($c, 'Chapter not found', 404); need(can_edit($user, $c['scope']), 'Not permitted', 403);
    $set = []; $args = [];
    if (isset($body['title'])) { $set[] = 'title=?'; $args[] = $body['title']; }
    if (array_key_exists('content', $body)) { $set[] = 'content=?'; $args[] = $body['content']; }
    if (array_key_exists('pageStart', $body) || array_key_exists('page_start', $body)) { $set[] = 'page_start=?'; $args[] = $body['pageStart'] ?? $body['page_start']; }
    if (array_key_exists('pageEnd', $body) || array_key_exists('page_end', $body)) { $set[] = 'page_end=?'; $args[] = $body['pageEnd'] ?? $body['page_end']; }
    if (array_key_exists('keywords', $body) && has_column('chapters', 'keywords_json')) {
        $set[] = 'keywords_json=?'; $args[] = jenc(clean_keywords($body['keywords']));
    }
    if (isset($body['order'])) { $set[] = '`order`=?'; $args[] = (int)$body['order']; }
    if (count($set)) { $args[] = $id; db()->prepare('UPDATE chapters SET ' . implode(',', $set) . ' WHERE id=?')->execute($args); }
    $st = db()->prepare('SELECT * FROM chapters WHERE id=?'); $st->execute([$id]);
    $cr = chap_row($st->fetch()); $cr['canEdit'] = true; return $cr;
}
function r_chapters_delete(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super','tenant_admin']);
    $id = $params['id'] ?? $body['id'] ?? null; need($id, 'id required');
    $st = db()->prepare('SELECT * FROM chapters WHERE id=?'); $st->execute([$id]); $c = $st->fetch();
    need($c, 'Chapter not found', 404); need(can_edit($user, $c['scope']), 'Not permitted', 403);
    db()->prepare('DELETE FROM objectives WHERE chapter_id=?')->execute([$id]);
    db()->prepare('DELETE FROM chapters WHERE id=?')->execute([$id]);
    return ['deleted' => true];
}
function r_objectives_create(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super','tenant_admin']);
    $chId = $params['id'] ?? $params['chapterId'] ?? $body['chapterId'] ?? $body['chapter_id'] ?? null;
    need($chId, 'chapter id required');
    $st = db()->prepare('SELECT * FROM chapters WHERE id=?'); $st->execute([$chId]); $ch = $st->fetch();
    need($ch, 'Chapter not found', 404);
    need($user['role'] === 'super' || $ch['scope'] === 'global' || $ch['scope'] === $user['tenant_id'], 'Not permitted', 403);
    $q = trim((string)($body['question'] ?? '')); need($q !== '', 'question required');
    $opts = $body['options'] ?? []; need(is_array($opts), 'options required');
    $opts = array_values(array_filter(array_map(fn($o)=>trim((string)$o), $opts), fn($o)=>$o !== ''));
    need(count($opts) >= 2, 'at least 2 options required');
    $ai = (int)($body['answerIndex'] ?? $body['answer_index'] ?? 0);
    need($ai >= 0 && $ai < count($opts), 'answerIndex invalid');
    $scope = $user['role'] === 'super' ? ($body['scope'] ?? $ch['scope']) : $user['tenant_id'];
    $st = db()->prepare('SELECT COUNT(*) FROM objectives WHERE chapter_id=?'); $st->execute([$chId]);
    $ord = $body['order'] ?? ((int)$st->fetchColumn() + 1);
    $id = uid('obj');
    db()->prepare('INSERT INTO objectives (id,chapter_id,scope,`order`,question,options_json,answer_index,created_at) VALUES (?,?,?,?,?,?,?,?)')
        ->execute([$id, $chId, $scope, $ord, $q, jenc($opts), $ai, now_dt()]);
    $st = db()->prepare('SELECT * FROM objectives WHERE id=?'); $st->execute([$id]);
    $orr = obj_row($st->fetch()); $orr['canEdit'] = true; return $orr;
}
function r_objectives_delete(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super','tenant_admin']);
    $id = $params['id'] ?? $body['id'] ?? null; need($id, 'id required');
    $st = db()->prepare('SELECT * FROM objectives WHERE id=?'); $st->execute([$id]); $o = $st->fetch();
    need($o, 'Objective not found', 404); need(can_edit($user, $o['scope']), 'Not permitted', 403);
    db()->prepare('DELETE FROM objectives WHERE id=?')->execute([$id]);
    return ['deleted' => true];
}
function r_library_create(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super','tenant_admin']);
    $title = trim((string)($body['title'] ?? '')); need($title !== '', 'title required');
    $type = $body['type'] ?? 'book';
    $scope = $user['role'] === 'super' ? ($body['scope'] ?? 'global') : $user['tenant_id'];
    $url = $body['url'] ?? null; $fname = null; $text = $body['text'] ?? null;
    if (isset($body['file']) && is_array($body['file'])) {
        $u = save_upload($body['file']);
        if ($u) { $url = $u; $fname = $body['file']['name'] ?? null; }
    }
    $id = uid('lib');
    db()->prepare('INSERT INTO library (id,type,title,scope,`text`,url,file_name,created_at) VALUES (?,?,?,?,?,?,?,?)')
        ->execute([$id, $type, $title, $scope, $text, $url, $fname, now_dt()]);
    $st = db()->prepare('SELECT * FROM library WHERE id=?'); $st->execute([$id]);
    $lr = lib_row($st->fetch()); $lr['canEdit'] = true;
    return ['item' => $lr] + $lr;
}
function r_library_update(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super','tenant_admin']);
    $id = $params['id'] ?? $body['id'] ?? null; need($id, 'id required');
    $st = db()->prepare('SELECT * FROM library WHERE id=?'); $st->execute([$id]); $r = $st->fetch();
    need($r, 'Library item not found', 404); need(can_edit($user, $r['scope']), 'Not permitted', 403);
    $set = []; $args = [];
    if (isset($body['title'])) { $set[] = 'title=?'; $args[] = $body['title']; }
    if (array_key_exists('text', $body)) { $set[] = '`text`=?'; $args[] = $body['text']; }
    if (array_key_exists('url', $body)) { $set[] = 'url=?'; $args[] = $body['url']; }
    if (isset($body['type'])) { $set[] = 'type=?'; $args[] = $body['type']; }
    if (isset($body['file']) && is_array($body['file'])) {
        $u = save_upload($body['file']);
        if ($u) { $set[] = 'url=?'; $args[] = $u; $set[] = 'file_name=?'; $args[] = $body['file']['name'] ?? null; }
    }
    if (isset($body['scope'])) {
        need($user['role'] === 'super', 'Not permitted', 403);
        $set[] = 'scope=?'; $args[] = $body['scope'];
    }
    if (count($set)) { $args[] = $id; db()->prepare('UPDATE library SET ' . implode(',', $set) . ' WHERE id=?')->execute($args); }
    $st = db()->prepare('SELECT * FROM library WHERE id=?'); $st->execute([$id]);
    $lr = lib_row($st->fetch()); $lr['canEdit'] = true; return $lr;
}
function r_library_delete(array $user, array $body, array $params, ?string $token, array $query): array {
    require_role($user, ['super','tenant_admin']);
    $id = $params['id'] ?? $body['id'] ?? null; need($id, 'id required');
    $st = db()->prepare('SELECT * FROM library WHERE id=?'); $st->execute([$id]); $r = $st->fetch();
    need($r, 'Library item not found', 404); need(can_edit($user, $r['scope']), 'Not permitted', 403);
    db()->prepare('DELETE FROM library WHERE id=?')->execute([$id]);
    return ['deleted' => true];
}

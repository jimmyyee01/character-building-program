<?php
declare(strict_types=1);
/* routes_flow.php — participant-experience endpoints for php/api.php dispatcher. */
$PARTICIPANTS = ['student','teacher','member','supervisor'];
$ADMINS = ['super','tenant_admin'];

function r_flow($user, $body, $params, $token, $query) {
  global $PARTICIPANTS, $ADMINS;
  require_role($user, array_merge($PARTICIPANTS, $ADMINS));
  return flow_for($user);
}
function r_flow_letter_feedback($user, $body, $params, $token, $query) {
  global $PARTICIPANTS;
  require_role($user, $PARTICIPANTS);
  $fb = trim((string)($body['feedback'] ?? ''));
  need(mb_strlen($fb) >= 20, 'Feedback must be at least 20 characters', 400);
  $st = db()->prepare('SELECT letter_feedback_at FROM users WHERE id=? LIMIT 1');
  $st->execute([$user['id']]);
  $row = $st->fetch();
  need(!($row && $row['letter_feedback_at']), 'Feedback already given', 400);
  db()->prepare('UPDATE users SET letter_feedback_at=NOW(), letter_feedback=? WHERE id=?')->execute([$fb, $user['id']]);
  $now = now_dt();
  return ['feedbackAt' => iso($now)];
}
function r_flow_optional_seen($user, $body, $params, $token, $query) {
  global $PARTICIPANTS;
  require_role($user, $PARTICIPANTS);
  db()->prepare('UPDATE users SET optional_video_seen=1 WHERE id=?')->execute([$user['id']]);
  return [];
}
function r_modules($user, $body, $params, $token, $query) {
  global $PARTICIPANTS, $ADMINS;
  require_role($user, array_merge($PARTICIPANTS, $ADMINS));
  $flow = flow_for($user);
  return ['modules' => module_statuses($user), 'performance' => performance($user), 'allDone' => $flow['allDone']];
}
function r_module_one($user, $body, $params, $token, $query) {
  global $PARTICIPANTS;
  require_role($user, $PARTICIPANTS);
  $id = $params[0] ?? null;
  need($id, 'Module id required', 400);
  $st = db()->prepare('SELECT * FROM modules WHERE id=? LIMIT 1');
  $st->execute([$id]);
  $m = $st->fetch();
  need($m, 'Module not found', 404);
  $found = null;
  foreach (module_statuses($user) as $s) if ($s['id'] === $m['id']) { $found = $s; break; }
  need($found, 'Module not found', 404);
  return ['status' => $found['status'], 'progress' => $found['progress']];
}
function r_book_one($user, $body, $params, $token, $query) {
  global $PARTICIPANTS;
  require_role($user, $PARTICIPANTS);
  $id = $params[0] ?? null;
  need($id, 'Book id required', 400);
  $st = db()->prepare('SELECT * FROM books WHERE id=? LIMIT 1');
  $st->execute([$id]);
  $brow = $st->fetch();
  need($brow, 'Book not found', 404);
  $okScope = ($brow['scope'] === 'global' || $brow['scope'] === $user['tenant_id']);
  need($okScope, 'Not permitted for this book', 403);
  $st = db()->prepare('SELECT * FROM modules WHERE id=? LIMIT 1');
  $st->execute([$brow['module_id']]);
  $mrow = $st->fetch();
  need($mrow, 'Module not found', 404);
  $module = n_module($mrow);
  $book = n_book($brow);
  $modStatus = null;
  foreach (module_statuses($user) as $s) if ($s['id'] === $module['id']) { $modStatus = $s['status']; break; }
  $prog = book_progress($user, $module, $book);
  $pdf = null; $pdfTitle = null;
  if (!empty($brow['library_id'])) {
    $lib = get_library($brow['library_id']);
    if ($lib && ($lib['type'] === 'book')) { $pdf = $lib['url']; $pdfTitle = $lib['title']; }
  }
  $bookOut = array_merge($book, ['pdf' => $pdf, 'pdfTitle' => $pdfTitle]);
  return ['moduleStatus' => $modStatus, 'pdfUnlocked' => all_modules_complete($user),
    'module' => ['id' => $module['id'], 'mode' => $module['mode'], 'title' => $module['title']],
    'book' => $bookOut, 'chapters' => $prog['chapters'], 'stage' => $prog['stage'],
    'summaries' => $prog['summaries'], 'letter' => $prog['letter'], 'letterSubmission' => $prog['letterSubmission']];
}
function r_chapter_objectives($user, $body, $params, $token, $query) {
  global $PARTICIPANTS;
  require_role($user, $PARTICIPANTS);
  $id = $params[0] ?? null;
  need($id, 'Chapter id required', 400);
  $st = db()->prepare('SELECT * FROM chapters WHERE id=? LIMIT 1');
  $st->execute([$id]);
  $ch = $st->fetch();
  need($ch, 'Chapter not found', 404);
  need(($ch['scope'] === 'global' || $ch['scope'] === $user['tenant_id']), 'Not permitted for this chapter', 403);
  $st = db()->prepare('SELECT * FROM books WHERE id=? LIMIT 1');
  $st->execute([$ch['book_id']]);
  $brow = $st->fetch();
  need($brow, 'Book not found', 404);
  need(($brow['scope'] === 'global' || $brow['scope'] === $user['tenant_id']), 'Not permitted for this book', 403);
  $objs = objectives_of($ch['id'], $user['tenant_id']);
  $sub = find_sub($user['id'], 'objectives', ['chapter_id' => $ch['id']]);
  if ($sub) {
    $ans = $sub['answers'] ?? [];
    $byId = [];
    if (is_array($ans)) foreach ($ans as $a) if (is_array($a) && isset($a['objectiveId'])) $byId[$a['objectiveId']] = $a;
    $out = [];
    foreach ($objs as $o) {
      $a = $byId[$o['id']] ?? null;
      $out[] = ['id' => $o['id'], 'question' => $o['question'], 'options' => $o['options'],
        'yourChoice' => $a !== null ? ($a['choice'] ?? null) : null,
        'correct' => $a !== null ? (bool)($a['correct'] ?? false) : false,
        'answerIndex' => $o['answerIndex']];
    }
    return ['submitted' => true, 'submission' => sub_meta($sub), 'objectives' => $out];
  }
  $shuffled = shuffled_for_login($user, $token, $objs);
  $out = [];
  foreach ($shuffled as $o) {
    $out[] = ['id' => $o['id'], 'question' => $o['question'],
      'options' => shuffle_with_seed(is_array($o['options']) ? $o['options'] : [], $o['id'] . '.' . ($token ?? ''))];
  }
  return ['submitted' => false, 'objectives' => $out];
}
function r_submissions($user, $body, $params, $token, $query) {
  global $PARTICIPANTS;
  require_role($user, $PARTICIPANTS);
  $type = (string)($body['type'] ?? '');
  need(in_array($type, ['chapter_summary','objectives','letter_summary','book_summary','best_book','general_summary'], true), 'Invalid type', 400);
  $pdo = db();
  $warn = null; $newRow = null;
  if ($type === 'chapter_summary' || $type === 'objectives') {
    $chapterId = (string)($body['chapterId'] ?? $body['chapter_id'] ?? '');
    need($chapterId, 'chapterId required', 400);
    $st = $pdo->prepare('SELECT * FROM chapters WHERE id=? LIMIT 1'); $st->execute([$chapterId]);
    $ch = $st->fetch(); need($ch, 'Chapter not found', 404);
    need(($ch['scope'] === 'global' || $ch['scope'] === $user['tenant_id']), 'Not permitted', 403);
    $st = $pdo->prepare('SELECT * FROM books WHERE id=? LIMIT 1'); $st->execute([$ch['book_id']]);
    $brow = $st->fetch(); need($brow, 'Book not found', 404);
    need(($brow['scope'] === 'global' || $brow['scope'] === $user['tenant_id']), 'Not permitted', 403);
    $st = $pdo->prepare('SELECT * FROM modules WHERE id=? LIMIT 1'); $st->execute([$brow['module_id']]);
    $mrow = $st->fetch(); need($mrow, 'Module not found', 404);
    $module = n_module($mrow); $book = n_book($brow);
    if ($type === 'chapter_summary') need($module['mode'] === 'summary', 'Not a summary module', 400);
    else need($module['mode'] === 'objectives', 'Not an objectives module', 400);
    $mst = null;
    foreach (module_statuses($user) as $s) if ($s['id'] === $module['id']) { $mst = $s; break; }
    need($mst && $mst['status'] === 'active', 'Module is not active', 403);
    $prog = book_progress($user, $module, $book);
    $cur = null;
    foreach ($prog['chapters'] as $c) if ($c['id'] === $ch['id']) { $cur = $c; break; }
    need($cur, 'Chapter not found', 404);
    need(!$cur['submission'], 'Already submitted', 400);
    need($cur['status'] === 'active', 'Submit previous chapters first', 403);
    $ex = find_sub($user['id'], $type, ['chapter_id' => $ch['id']]);
    need(!$ex, 'Already submitted', 400);
    if ($type === 'chapter_summary') {
      $text = trim((string)($body['text'] ?? ''));
      need(mb_strlen($text) >= 30, 'Summary must be at least 30 characters', 400);
      $cp = assess_copy($user, $type, ['chapter_id' => $ch['id']], $text);
      $newRow = ['id' => uid('sub'), 'user_id' => $user['id'], 'tenant_id' => $user['tenant_id'],
        'type' => $type, 'chapter_id' => $ch['id'], 'book_id' => $brow['id'], 'module_id' => $module['id'],
        'index' => null, 'text' => $text, 'answers_json' => null, 'score' => null, 'total' => null,
        'color' => null, 'label' => null, 'similarity' => $cp['similarity'], 'flagged' => $cp['flagged'] ? 1 : 0,
        'created_at' => now_dt()];
    } else {
      $objs = objectives_of($ch['id'], $user['tenant_id']);
      need(count($objs) > 0, 'No objectives for this chapter', 400);
      $rawAns = $body['answers'] ?? null;
      $map = [];
      if (is_array($rawAns)) {
        $isList = array_key_exists(0, $rawAns);
        if ($isList) { foreach ($rawAns as $a) if (is_array($a) && isset($a['objectiveId'])) $map[$a['objectiveId']] = $a['choice'] ?? null; }
        else $map = $rawAns;
      }
      $detail = []; $score = 0;
      foreach ($objs as $o) {
        need(array_key_exists($o['id'], $map), 'All questions must be answered', 400);
        $choice = (int)$map[$o['id']];
        need($choice >= 0 && $choice < count($o['options']), 'Invalid choice', 400);
        $correct = ($choice === (int)$o['answerIndex']);
        if ($correct) $score++;
        $detail[] = ['objectiveId' => $o['id'], 'choice' => $choice, 'correct' => $correct];
      }
      $cp = assess_copy($user, $type, [], null);
      $newRow = ['id' => uid('sub'), 'user_id' => $user['id'], 'tenant_id' => $user['tenant_id'],
        'type' => $type, 'chapter_id' => $ch['id'], 'book_id' => $brow['id'], 'module_id' => $module['id'],
        'index' => null, 'text' => null, 'answers_json' => jenc($detail), 'score' => $score, 'total' => count($objs),
        'color' => null, 'label' => null, 'similarity' => $cp['similarity'], 'flagged' => $cp['flagged'] ? 1 : 0,
        'created_at' => now_dt()];
    }
  } elseif ($type === 'letter_summary') {
    $bookId = (string)($body['bookId'] ?? $body['book_id'] ?? '');
    need($bookId, 'bookId required', 400);
    $st = $pdo->prepare('SELECT * FROM books WHERE id=? LIMIT 1'); $st->execute([$bookId]);
    $brow = $st->fetch(); need($brow, 'Book not found', 404);
    need(($brow['scope'] === 'global' || $brow['scope'] === $user['tenant_id']), 'Not permitted', 403);
    $st = $pdo->prepare('SELECT * FROM modules WHERE id=? LIMIT 1'); $st->execute([$brow['module_id']]);
    $mrow = $st->fetch(); need($mrow, 'Module not found', 404);
    $module = n_module($mrow); $book = n_book($brow);
    $prog = book_progress($user, $module, $book);
    need($prog['stage'] === 'letter', 'Letter is not available yet', 403);
    need(!find_sub($user['id'], 'letter_summary', ['book_id' => $bookId]), 'Already submitted', 400);
    $text = trim((string)($body['text'] ?? ''));
    need(mb_strlen($text) >= 30, 'Summary must be at least 30 characters', 400);
    $cp = assess_copy($user, $type, ['book_id' => $bookId], $text);
    $newRow = ['id' => uid('sub'), 'user_id' => $user['id'], 'tenant_id' => $user['tenant_id'],
      'type' => $type, 'chapter_id' => null, 'book_id' => $bookId, 'module_id' => $module['id'],
      'index' => null, 'text' => $text, 'answers_json' => null, 'score' => null, 'total' => null,
      'color' => null, 'label' => null, 'similarity' => $cp['similarity'], 'flagged' => $cp['flagged'] ? 1 : 0,
      'created_at' => now_dt()];
  } elseif ($type === 'book_summary') {
    $bookId = (string)($body['bookId'] ?? $body['book_id'] ?? '');
    $idx = (int)($body['index'] ?? 0);
    need($bookId && $idx >= 1, 'bookId and index required', 400);
    $st = $pdo->prepare('SELECT * FROM books WHERE id=? LIMIT 1'); $st->execute([$bookId]);
    $brow = $st->fetch(); need($brow, 'Book not found', 404);
    need(($brow['scope'] === 'global' || $brow['scope'] === $user['tenant_id']), 'Not permitted', 403);
    $st = $pdo->prepare('SELECT * FROM modules WHERE id=? LIMIT 1'); $st->execute([$brow['module_id']]);
    $mrow = $st->fetch(); need($mrow, 'Module not found', 404);
    $module = n_module($mrow); $book = n_book($brow);
    $prog = book_progress($user, $module, $book);
    need($prog['stage'] === 'summaries', 'Summaries are not available yet', 403);
    $activeIdx = null; $prompt = null;
    foreach ($prog['summaries'] as $sm) if (($sm['status'] ?? '') === 'active') { $activeIdx = (int)$sm['index']; $prompt = $sm; break; }
    need($activeIdx !== null && $idx === $activeIdx, 'This summary is not active', 403);
    need(!find_sub($user['id'], 'book_summary', ['book_id' => $bookId, 'index' => $idx]), 'Already submitted', 400);
    $text = trim((string)($body['text'] ?? ''));
    need(mb_strlen($text) >= 30, 'Summary must be at least 30 characters', 400);
    $cp = assess_copy($user, $type, ['book_id' => $bookId, 'index' => $idx], $text);
    $newRow = ['id' => uid('sub'), 'user_id' => $user['id'], 'tenant_id' => $user['tenant_id'],
      'type' => $type, 'chapter_id' => null, 'book_id' => $bookId, 'module_id' => $module['id'],
      'index' => $idx, 'text' => $text, 'answers_json' => null, 'score' => null, 'total' => null,
      'color' => $prompt['color'] ?? null, 'label' => $prompt['label'] ?? null,
      'similarity' => $cp['similarity'], 'flagged' => $cp['flagged'] ? 1 : 0, 'created_at' => now_dt()];
  } elseif ($type === 'best_book') {
    $moduleId = (string)($body['moduleId'] ?? $body['module_id'] ?? '');
    $bookId = (string)($body['bookId'] ?? $body['book_id'] ?? '');
    need($moduleId && $bookId, 'moduleId and bookId required', 400);
    $st = $pdo->prepare('SELECT * FROM modules WHERE id=? LIMIT 1'); $st->execute([$moduleId]);
    $mrow = $st->fetch(); need($mrow, 'Module not found', 404);
    $module = n_module($mrow);
    $mp = module_progress($user, $module);
    need(($mp['stage'] ?? '') === 'best_book', 'Best book pick is not available yet', 403);
    need(!find_sub($user['id'], 'best_book', ['module_id' => $moduleId]), 'Already submitted', 400);
    $st = $pdo->prepare('SELECT * FROM books WHERE id=? AND module_id=? LIMIT 1'); $st->execute([$bookId, $moduleId]);
    $brow = $st->fetch(); need($brow, 'Book not found', 404);
    need(($brow['scope'] === 'global' || $brow['scope'] === $user['tenant_id']), 'Not permitted', 403);
    $bp = book_progress($user, $module, n_book($brow));
    need(!empty($bp['complete']), 'Book is not complete yet', 403);
    $txt = isset($body['text']) && trim((string)$body['text']) !== '' ? trim((string)$body['text']) : null;
    $cp = assess_copy($user, $type, ['module_id' => $moduleId], $txt);
    $newRow = ['id' => uid('sub'), 'user_id' => $user['id'], 'tenant_id' => $user['tenant_id'],
      'type' => $type, 'chapter_id' => null, 'book_id' => $bookId, 'module_id' => $moduleId,
      'index' => null, 'text' => $txt, 'answers_json' => null, 'score' => null, 'total' => null,
      'color' => null, 'label' => null, 'similarity' => $cp['similarity'], 'flagged' => $cp['flagged'] ? 1 : 0,
      'created_at' => now_dt()];
  } else {
    $flow = flow_for($user);
    need(!empty($flow['allDone']), 'Complete all modules first', 403);
    need(!find_sub($user['id'], 'general_summary', []), 'Already submitted', 400);
    $text = trim((string)($body['text'] ?? ''));
    need(mb_strlen($text) >= 30, 'Summary must be at least 30 characters', 400);
    $cp = assess_copy($user, $type, [], $text);
    $newRow = ['id' => uid('sub'), 'user_id' => $user['id'], 'tenant_id' => $user['tenant_id'],
      'type' => $type, 'chapter_id' => null, 'book_id' => null, 'module_id' => null,
      'index' => null, 'text' => $text, 'answers_json' => null, 'score' => null, 'total' => null,
      'color' => null, 'label' => null, 'similarity' => $cp['similarity'], 'flagged' => $cp['flagged'] ? 1 : 0,
      'created_at' => now_dt()];
  }
  $pdo->prepare('INSERT INTO submissions (id,user_id,tenant_id,type,chapter_id,book_id,module_id,`index`,`text`,answers_json,score,total,color,label,similarity,flagged,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')->execute(
    [$newRow['id'],$newRow['user_id'],$newRow['tenant_id'],$newRow['type'],$newRow['chapter_id'],$newRow['book_id'],$newRow['module_id'],$newRow['index'],$newRow['text'],$newRow['answers_json'],$newRow['score'],$newRow['total'],$newRow['color'],$newRow['label'],$newRow['similarity'],$newRow['flagged'],$newRow['created_at']]);
  /* typed answers are assessed against the chapter's key words */
  $kw = submission_assessment($newRow);
  if ($kw && has_column('submissions', 'keyword_score')) {
    $pdo->prepare('UPDATE submissions SET keyword_score=?, keywords_used=?, keywords_total=?, keywords_covered_json=?, keywords_missing_json=? WHERE id=?')
      ->execute([$kw['keywordScore'], $kw['keywordsUsed'], $kw['keywordsTotal'],
        jenc($kw['keywordsCovered']), jenc($kw['keywordsMissing']), $newRow['id']]);
  }
  create_submission_notification($user, $newRow);
  if (!empty($newRow['flagged'])) $warn = 'Your submission was flagged for similarity review.';
  return ['submission' => sub_meta(n_sub($newRow)), 'assessment' => $kw, 'warning' => $warn];
}
function flow_ensure_general($user) {
  $pdo = db();
  $flow = flow_for($user);
  if (empty($flow['allDone'])) return null;
  $transcript = array_map(function ($m) {
    return ['moduleId' => $m['id'], 'moduleTitle' => $m['title'], 'status' => $m['status'],
      'performance' => (int)($m['progress']['percent'] ?? 0),
      'objectiveScore' => isset($m['progress']['objectiveScore']) ? (int)$m['progress']['objectiveScore'] : null];
  }, module_statuses($user));
  $st = $pdo->prepare("SELECT * FROM certificates WHERE user_id=? AND type='general' LIMIT 1");
  $st->execute([$user['id']]);
  $ex = $st->fetch();
  if ($ex) {
    if (empty($ex['transcript_json']) && has_column('certificates', 'transcript_json')) {
      $json = jenc($transcript);
      $pdo->prepare('UPDATE certificates SET transcript_json=? WHERE id=?')->execute([$json, $ex['id']]);
      $ex['transcript_json'] = $json;
    }
    create_completion_notification($user);
    return n_cert($ex);
  }
  $titles = [];
  foreach (all_modules() as $m) foreach (visible_books($user['tenant_id'], $m['id']) as $b) $titles[] = $b['title'];
  $perf = performance($user);
  $tenant = get_tenant($user['tenant_id']);
  $row = ['id' => uid('cert'), 'type' => 'general', 'code' => 'GEN-' . strtoupper(bin2hex(random_bytes(4))),
    'user_id' => $user['id'], 'tenant_id' => $user['tenant_id'], 'module_id' => null,
    'title' => 'GENERAL CERTIFICATE — CHARACTER BUILDING PROGRAM', 'books_json' => jenc(array_values($titles)),
    'transcript_json' => jenc($transcript),
    'best_book_id' => null, 'best_book' => null, 'performance' => (int)($perf['overall'] ?? 0),
    'objective_score' => null, 'user_name' => $user['full_name'], 'tenant_name' => $tenant ? $tenant['name'] : null,
    'issued_at' => now_dt()];
  $pdo->prepare('INSERT INTO certificates (id,type,code,user_id,tenant_id,module_id,title,books_json,transcript_json,best_book_id,best_book,performance,objective_score,user_name,tenant_name,issued_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')->execute(
    [$row['id'],$row['type'],$row['code'],$row['user_id'],$row['tenant_id'],$row['module_id'],$row['title'],$row['books_json'],$row['transcript_json'],$row['best_book_id'],$row['best_book'],$row['performance'],$row['objective_score'],$row['user_name'],$row['tenant_name'],$row['issued_at']]);
  create_completion_notification($user);
  return n_cert($row);
}
function r_cert_issue($user, $body, $params, $token, $query) {
  global $PARTICIPANTS;
  require_role($user, $PARTICIPANTS);
  $moduleId = (string)($body['moduleId'] ?? $body['module_id'] ?? '');
  need($moduleId, 'moduleId required', 400);
  $pdo = db();
  $st = $pdo->prepare('SELECT * FROM modules WHERE id=? LIMIT 1'); $st->execute([$moduleId]);
  $mrow = $st->fetch(); need($mrow, 'Module not found', 404);
  $module = n_module($mrow);
  $mp = module_progress($user, $module);
  need(($mp['stage'] ?? '') === 'video', 'Certificate is not available yet', 403);
  $watched = is_array($user['watched_videos'] ?? null) ? $user['watched_videos'] : jdec($user['watched_videos_json'] ?? null, []);
  if (!empty($module['completionVideoId'])) {
    $lib = get_library($module['completionVideoId']);
    need($lib && ($lib['type'] ?? '') === 'video', 'Completion video not found', 404);
    if (!in_array($lib['id'], $watched, true)) { $watched[] = $lib['id']; save_watched($user, $watched); }
  }
  $st = $pdo->prepare('SELECT * FROM certificates WHERE user_id=? AND module_id=? LIMIT 1');
  $st->execute([$user['id'], $moduleId]);
  $ex = $st->fetch();
  if ($ex) { $cert = n_cert($ex); }
  else {
    $best = find_sub($user['id'], 'best_book', ['module_id' => $moduleId]);
    $bbId = $best ? $best['bookId'] : null; $bbTitle = null;
    if ($bbId) {
      $s2 = $pdo->prepare('SELECT title FROM books WHERE id=? LIMIT 1'); $s2->execute([$bbId]);
      $bbTitle = $s2->fetchColumn() ?: null;
    }
    $titles = [];
    foreach (visible_books($user['tenant_id'], $moduleId) as $b) $titles[] = $b['title'];
    $tenant = get_tenant($user['tenant_id']);
    $row = ['id' => uid('cert'), 'type' => 'module',
      'code' => strtoupper((string)$mrow['key']) . '-' . strtoupper(bin2hex(random_bytes(3))),
      'user_id' => $user['id'], 'tenant_id' => $user['tenant_id'], 'module_id' => $moduleId,
      'title' => $module['certificateName'], 'books_json' => jenc(array_values($titles)),
      'best_book_id' => $bbId, 'best_book' => $bbTitle,
      'performance' => (int)($mp['percent'] ?? 0), 'objective_score' => isset($mp['objectiveScore']) ? $mp['objectiveScore'] : null,
      'user_name' => $user['full_name'], 'tenant_name' => $tenant ? $tenant['name'] : null, 'issued_at' => now_dt()];
    $pdo->prepare('INSERT INTO certificates (id,type,code,user_id,tenant_id,module_id,title,books_json,best_book_id,best_book,performance,objective_score,user_name,tenant_name,issued_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')->execute(
      [$row['id'],$row['type'],$row['code'],$row['user_id'],$row['tenant_id'],$row['module_id'],$row['title'],$row['books_json'],$row['best_book_id'],$row['best_book'],$row['performance'],$row['objective_score'],$row['user_name'],$row['tenant_name'],$row['issued_at']]);
    $cert = n_cert($row);
  }
  $gen = flow_ensure_general($user);
  return ['certificate' => $cert, 'generalCertificate' => $gen];
}
function r_certificates($user, $body, $params, $token, $query) {
  global $PARTICIPANTS, $ADMINS;
  require_role($user, array_merge($PARTICIPANTS, $ADMINS));
  flow_ensure_general($user);
  $st = db()->prepare('SELECT * FROM certificates WHERE user_id=? ORDER BY issued_at ASC, id ASC');
  $st->execute([$user['id']]);
  return ['certificates' => array_map('n_cert', $st->fetchAll())];
}
function r_certificate_one($user, $body, $params, $token, $query) {
  global $PARTICIPANTS, $ADMINS;
  require_role($user, array_merge($PARTICIPANTS, $ADMINS));
  $id = $params[0] ?? null;
  need($id, 'Certificate id required', 400);
  $st = db()->prepare('SELECT * FROM certificates WHERE id=? LIMIT 1'); $st->execute([$id]);
  $c = $st->fetch(); need($c, 'Certificate not found', 404);
  $can = ($c['user_id'] === $user['id']) || ($user['role'] === 'super') ||
    ($user['role'] === 'tenant_admin' && $c['tenant_id'] !== null && $c['tenant_id'] === $user['tenant_id']);
  need($can, 'Not permitted', 403);
  $s = get_settings();
  $t = get_tenant($c['tenant_id']);
  $logo = ($t && !empty($t['program_logo'])) ? $t['program_logo'] : ($s['program_logo'] ?? null);
  return ['certificate' => n_cert($c),
    'branding' => ['programName' => $s['program_name'] ?? 'Character Building Program', 'programLogo' => $logo]];
}
function ensure_general($user) { return flow_ensure_general($user); }
function r_videos($user, $body, $params, $token, $query) {
  global $PARTICIPANTS, $ADMINS;
  require_role($user, array_merge($PARTICIPANTS, $ADMINS));
  $pdo = db();
  $st = $pdo->prepare("SELECT * FROM library WHERE type='video' AND (scope='global' OR scope=?) ORDER BY created_at ASC, id ASC");
  $st->execute([$user['tenant_id']]);
  $watched = is_array($user['watched_videos'] ?? null) ? $user['watched_videos'] : jdec($user['watched_videos_json'] ?? null, []);
  $out = [];
  foreach ($st->fetchAll() as $r) $out[] = ['id' => $r['id'], 'title' => $r['title'], 'url' => $r['url'], 'watched' => in_array($r['id'], $watched, true)];
  return ['videos' => $out];
}
function r_video_watched($user, $body, $params, $token, $query) {
  global $PARTICIPANTS;
  require_role($user, $PARTICIPANTS);
  $id = $params[0] ?? null;
  need($id, 'Video id required', 400);
  $watched = is_array($user['watched_videos'] ?? null) ? $user['watched_videos'] : jdec($user['watched_videos_json'] ?? null, []);
  if (!in_array($id, $watched, true)) { $watched[] = $id; save_watched($user, $watched); }
  return [];
}
function r_thoughts_get($user, $body, $params, $token, $query) {
  global $PARTICIPANTS;
  require_role($user, $PARTICIPANTS);
  $st = db()->prepare('SELECT * FROM thoughts WHERE user_id=? ORDER BY created_at DESC, id DESC');
  $st->execute([$user['id']]);
  $out = [];
  foreach ($st->fetchAll() as $r) $out[] = ['id' => $r['id'], 'text' => $r['text'], 'createdAt' => iso($r['created_at'])];
  return ['thoughts' => $out];
}
function r_thoughts_post($user, $body, $params, $token, $query) {
  global $PARTICIPANTS;
  require_role($user, $PARTICIPANTS);
  $text = trim((string)($body['text'] ?? ''));
  need(mb_strlen($text) >= 3, 'Thought must be at least 3 characters', 400);
  $row = ['id' => uid('th'), 'user_id' => $user['id'], 'tenant_id' => $user['tenant_id'], 'text' => $text, 'created_at' => now_dt()];
  db()->prepare('INSERT INTO thoughts (id,user_id,tenant_id,`text`,created_at) VALUES (?,?,?,?,?)')->execute(
    [$row['id'],$row['user_id'],$row['tenant_id'],$row['text'],$row['created_at']]);
  return ['thought' => ['id' => $row['id'], 'text' => $row['text'], 'createdAt' => iso($row['created_at'])]];
}
function flow_lib_row($r, $user) {
  $row = ['id' => $r['id'], 'type' => $r['type'], 'title' => $r['title'], 'scope' => $r['scope'],
    'text' => $r['text'], 'url' => $r['url'], 'fileName' => $r['file_name'], 'createdAt' => iso($r['created_at'])];
  if ($user && in_array($user['role'], ['super','tenant_admin'], true)) {
    $row['canEdit'] = ($user['role'] === 'super') ? true : (($r['scope'] ?? '') === ($user['tenant_id'] ?? ''));
  }
  return $row;
}
function r_library_get($user, $body, $params, $token, $query) {
  need($user, 'Sign in required', 401);
  $pdo = db();
  $st = $pdo->prepare("SELECT * FROM library WHERE scope='global' OR scope=? ORDER BY created_at ASC, id ASC");
  $st->execute([$user['tenant_id']]);
  $rows = $st->fetchAll();
  $out = [];
  $isAdmin = in_array($user['role'], ['super','tenant_admin'], true);
  $allDone = $isAdmin ? true : all_modules_complete($user);
  foreach ($rows as $r) {
    $row = lib_row($r);
    if ($isAdmin) {
      $row['canEdit'] = ($user['role'] === 'super') ? true : (($r['scope'] ?? '') === ($user['tenant_id'] ?? ''));
    }
    /* learners may not open the books before they finish every module */
    if (!$isAdmin && ($r['type'] ?? '') === 'book' && !empty($r['url']) && !$allDone) {
      $row['url'] = null;
      $row['locked'] = true;
      $row['lockedReason'] = 'Finish every module to open the books.';
    }
    $out[] = $row;
  }
  return ['library' => $out];
}
function describe_sub($s) {
  static $chCache = [], $bkCache = [], $mdCache = [];
  $pdo = db();
  $chT = null; $bkT = null; $mdT = null;
  if (!empty($s['chapterId'])) {
    if (!array_key_exists($s['chapterId'], $chCache)) {
      $st = $pdo->prepare('SELECT title FROM chapters WHERE id=? LIMIT 1'); $st->execute([$s['chapterId']]);
      $chCache[$s['chapterId']] = $st->fetchColumn() ?: null;
    }
    $chT = $chCache[$s['chapterId']];
  }
  if (!empty($s['bookId'])) {
    if (!array_key_exists($s['bookId'], $bkCache)) {
      $st = $pdo->prepare('SELECT title FROM books WHERE id=? LIMIT 1'); $st->execute([$s['bookId']]);
      $bkCache[$s['bookId']] = $st->fetchColumn() ?: null;
    }
    $bkT = $bkCache[$s['bookId']];
  }
  if (!empty($s['moduleId'])) {
    if (!array_key_exists($s['moduleId'], $mdCache)) {
      $st = $pdo->prepare('SELECT title FROM modules WHERE id=? LIMIT 1'); $st->execute([$s['moduleId']]);
      $mdCache[$s['moduleId']] = $st->fetchColumn() ?: null;
    }
    $mdT = $mdCache[$s['moduleId']];
  }
  return ['id' => $s['id'], 'type' => $s['type'], 'text' => $s['text'], 'createdAt' => $s['createdAt'],
    'color' => $s['color'], 'label' => $s['label'], 'score' => $s['score'], 'total' => $s['total'],
    'flagged' => $s['flagged'], 'similarity' => $s['similarity'], 'chapter' => $chT, 'book' => $bkT,
    'module' => $mdT, 'index' => $s['index'],
    'keywordScore' => $s['keywordScore'] ?? null, 'keywordsUsed' => $s['keywordsUsed'] ?? null,
    'keywordsTotal' => $s['keywordsTotal'] ?? null, 'keywordsMissing' => $s['keywordsMissing'] ?? []];
}
function r_final($user, $body, $params, $token, $query) {
  global $PARTICIPANTS;
  require_role($user, $PARTICIPANTS);
  $flow = flow_for($user);
  need(!empty($flow['allDone']), 'Complete all modules first', 403);
  flow_ensure_general($user);
  $pdo = db();
  $st = $pdo->prepare('SELECT * FROM submissions WHERE user_id=? ORDER BY created_at ASC, id ASC');
  $st->execute([$user['id']]);
  $all = array_map('n_sub', $st->fetchAll());
  $groups = ['chapterSummaries' => [], 'letterSummaries' => [], 'bookSummaries' => [],
    'objectiveSubmissions' => [], 'bestPicks' => [], 'generalSummaries' => []];
  foreach ($all as $s) {
    $d = describe_sub($s);
    if ($s['type'] === 'chapter_summary') $groups['chapterSummaries'][] = $d;
    elseif ($s['type'] === 'letter_summary') $groups['letterSummaries'][] = $d;
    elseif ($s['type'] === 'book_summary') $groups['bookSummaries'][] = $d;
    elseif ($s['type'] === 'objectives') $groups['objectiveSubmissions'][] = $d;
    elseif ($s['type'] === 'best_book') $groups['bestPicks'][] = $d;
    elseif ($s['type'] === 'general_summary') $groups['generalSummaries'][] = $d;
  }
  $bookQuestions = [];
  foreach ($all as $s) {
    if ($s['type'] !== 'objectives') continue;
    $d = describe_sub($s);
    $omap = [];
    if (!empty($s['chapterId'])) {
      $st2 = $pdo->prepare('SELECT * FROM objectives WHERE chapter_id=? ORDER BY `order` ASC, id ASC');
      $st2->execute([$s['chapterId']]);
      foreach ($st2->fetchAll() as $orow) { $no = n_objective($orow); $omap[$no['id']] = $no; }
    }
    $qs = [];
    foreach ((is_array($s['answers']) ? $s['answers'] : []) as $a) {
      $oid = $a['objectiveId'] ?? null;
      $o = ($oid && isset($omap[$oid])) ? $omap[$oid] : null;
      $qs[] = ['objectiveId' => $oid, 'question' => $o ? $o['question'] : null,
        'options' => $o ? $o['options'] : [], 'choice' => $a['choice'] ?? null,
        'correct' => !empty($a['correct']), 'answerIndex' => $o ? $o['answerIndex'] : null];
    }
    $bookQuestions[] = ['submissionId' => $s['id'], 'chapterId' => $s['chapterId'],
      'chapter' => $d['chapter'], 'book' => $d['book'], 'score' => $s['score'], 'total' => $s['total'],
      'answers' => $qs];
  }
  $st = $pdo->prepare('SELECT * FROM thoughts WHERE user_id=? ORDER BY created_at DESC, id DESC');
  $st->execute([$user['id']]);
  $thoughts = [];
  foreach ($st->fetchAll() as $r) $thoughts[] = ['id' => $r['id'], 'text' => $r['text'], 'createdAt' => iso($r['created_at'])];
  $st = $pdo->prepare("SELECT * FROM library WHERE scope='global' OR scope=? ORDER BY created_at ASC, id ASC");
  $st->execute([$user['tenant_id']]);
  $libRows = $st->fetchAll();
  $refIds = [];
  foreach (visible_books($user['tenant_id']) as $vb) if (!empty($vb['libraryId'])) $refIds[$vb['libraryId']] = true;
  $books = []; $letters = []; $otherBooks = []; $videos = [];
  $watched = is_array($user['watched_videos'] ?? null) ? $user['watched_videos'] : jdec($user['watched_videos_json'] ?? null, []);
  foreach ($libRows as $r) {
    $lr = lib_row($r);
    if (($r['type'] ?? '') === 'book') { $books[] = $lr; if (!isset($refIds[$r['id']])) $otherBooks[] = $lr; }
    elseif (($r['type'] ?? '') === 'letter') $letters[] = $lr;
    elseif (($r['type'] ?? '') === 'video') { $lr['watched'] = in_array($r['id'], $watched, true); $videos[] = $lr; }
  }
  $st = $pdo->prepare('SELECT * FROM certificates WHERE user_id=? ORDER BY issued_at ASC, id ASC');
  $st->execute([$user['id']]);
  $certs = array_map('n_cert', $st->fetchAll());
  return ['summaries' => $groups, 'bookQuestions' => $bookQuestions, 'thoughts' => $thoughts,
    'library' => ['books' => $books, 'letters' => $letters, 'otherBooks' => $otherBooks, 'videos' => $videos],
    'certificates' => $certs, 'performance' => performance($user)];
}
function r_dashboard($user, $body, $params, $token, $query) {
  global $PARTICIPANTS;
  require_role($user, $PARTICIPANTS);
  $pdo = db();
  $st = $pdo->prepare('SELECT * FROM submissions WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT 12');
  $st->execute([$user['id']]);
  $recent = [];
  foreach (array_map('n_sub', $st->fetchAll()) as $s) $recent[] = describe_sub($s);
  $st = $pdo->prepare('SELECT COUNT(*) FROM certificates WHERE user_id=?'); $st->execute([$user['id']]);
  $nc = (int)$st->fetchColumn();
  $st = $pdo->prepare('SELECT COUNT(*) FROM thoughts WHERE user_id=?'); $st->execute([$user['id']]);
  $nt = (int)$st->fetchColumn();
  return ['performance' => performance($user), 'recent' => $recent, 'certificates' => $nc, 'thoughts' => $nt];
}

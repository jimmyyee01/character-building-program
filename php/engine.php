<?php
/* =====================================================================
   engine.php — progress/gating engine + copy detection + scoring.
   Mirrors the reference behaviour: sequential chapters, books, modules,
   letter/summary stages, objectives shuffle, Jaccard copy assessment.
   ===================================================================== */
declare(strict_types=1);

/* ------------------------------------------------------------ fetchers - */
function ordered(array $rows): array {
    usort($rows, fn($a, $b) => ((int)($a['order'] ?? 0)) <=> ((int)($b['order'] ?? 0)));
    return $rows;
}
function n_book(array $r): array {
    return ['id' => $r['id'], 'moduleId' => $r['module_id'], 'scope' => $r['scope'],
        'order' => (int)$r['order'], 'title' => $r['title'],
        'libraryId' => $r['library_id'], 'letterId' => $r['letter_id'],
        'createdAt' => iso($r['created_at'] ?? null)];
}
function n_chapter(array $r): array {
    $own = clean_keywords(jdec($r['keywords_json'] ?? null, []));
    return ['id' => $r['id'], 'bookId' => $r['book_id'], 'scope' => $r['scope'],
        'order' => (int)$r['order'], 'title' => $r['title'], 'content' => $r['content'],
        'pageStart' => $r['page_start'], 'pageEnd' => $r['page_end'],
        'keywords' => $own, 'suggestedKeywords' => suggest_keywords($r['content'] ?? '', 8),
        'keywordsSource' => $own ? 'set' : 'auto',
        'createdAt' => iso($r['created_at'] ?? null)];
}
function n_objective(array $r): array {
    return ['id' => $r['id'], 'chapterId' => $r['chapter_id'], 'scope' => $r['scope'],
        'order' => (int)$r['order'], 'question' => $r['question'],
        'options' => jdec($r['options_json'] ?? null, []),
        'answerIndex' => (int)($r['answer_index'] ?? 0),
        'createdAt' => iso($r['created_at'] ?? null)];
}
function n_module(array $r): array {
    return ['id' => $r['id'], 'key' => $r['key'], 'order' => (int)$r['order'],
        'title' => $r['title'], 'mode' => $r['mode'],
        'certificateName' => $r['certificate_name'],
        'defaultBooks' => (int)($r['default_books'] ?? 3),
        'letterAfterBook' => (bool)($r['letter_after_book'] ?? false),
        'summaryPrompts' => jdec($r['summary_prompts_json'] ?? null, []),
        'completionVideoId' => $r['completion_video_id'],
        'createdAt' => iso($r['created_at'] ?? null)];
}
function n_library(array $r): array {
    return ['id' => $r['id'], 'type' => $r['type'], 'title' => $r['title'],
        'scope' => $r['scope'], 'text' => $r['text'], 'url' => $r['url'],
        'fileName' => $r['file_name'], 'createdAt' => iso($r['created_at'] ?? null)];
}
function n_sub(array $r): array {
    $kw = submission_assessment($r);
    return ['id' => $r['id'], 'userId' => $r['user_id'], 'tenantId' => $r['tenant_id'],
        'type' => $r['type'], 'chapterId' => $r['chapter_id'], 'bookId' => $r['book_id'],
        'moduleId' => $r['module_id'], 'index' => $r['index'] !== null ? (int)$r['index'] : null,
        'text' => $r['text'], 'answers' => jdec($r['answers_json'] ?? null, []),
        'score' => $r['score'] !== null ? (int)$r['score'] : null,
        'total' => $r['total'] !== null ? (int)$r['total'] : null,
        'color' => $r['color'], 'label' => $r['label'],
        'similarity' => (int)($r['similarity'] ?? 0), 'flagged' => (bool)($r['flagged'] ?? false),
        'keywordScore' => $kw['keywordScore'] ?? null,
        'keywordsUsed' => $kw['keywordsUsed'] ?? null,
        'keywordsTotal' => $kw['keywordsTotal'] ?? null,
        'keywordsMissing' => $kw['keywordsMissing'] ?? [],
        'createdAt' => iso($r['created_at'] ?? null)];
}
function n_cert(array $r): array {
    return ['id' => $r['id'], 'type' => $r['type'], 'code' => $r['code'],
        'userId' => $r['user_id'], 'tenantId' => $r['tenant_id'], 'moduleId' => $r['module_id'],
        'title' => $r['title'], 'books' => jdec($r['books_json'] ?? null, []),
        'transcript' => jdec($r['transcript_json'] ?? null, []),
        'bestBookId' => $r['best_book_id'], 'bestBook' => $r['best_book'],
        'performance' => (int)($r['performance'] ?? 0),
        'objectiveScore' => $r['objective_score'] !== null ? (int)$r['objective_score'] : null,
        'userName' => $r['user_name'], 'tenantName' => $r['tenant_name'],
        'issuedAt' => iso($r['issued_at'] ?? null)];
}
function all_modules(): array {
    $rows = db()->query('SELECT * FROM modules ORDER BY `order` ASC, id ASC')->fetchAll();
    return array_map('n_module', $rows);
}
function visible_books(?string $tenantId, ?string $moduleId = null): array {
    $sql = 'SELECT * FROM books WHERE (scope=\'global\' OR scope=?)';
    $args = [$tenantId];
    if ($moduleId) { $sql .= ' AND module_id=?'; $args[] = $moduleId; }
    $sql .= ' ORDER BY `order` ASC, id ASC';
    $stmt = db()->prepare($sql);
    $stmt->execute($args);
    return ordered(array_map('n_book', $stmt->fetchAll()));
}
function chapters_of(string $bookId, ?string $tenantId): array {
    $stmt = db()->prepare('SELECT * FROM chapters WHERE book_id=? AND (scope=\'global\' OR scope=?) ORDER BY `order` ASC, id ASC');
    $stmt->execute([$bookId, $tenantId]);
    return ordered(array_map('n_chapter', $stmt->fetchAll()));
}
function objectives_of(string $chapterId, ?string $tenantId): array {
    $stmt = db()->prepare('SELECT * FROM objectives WHERE chapter_id=? AND (scope=\'global\' OR scope=?) ORDER BY `order` ASC, id ASC');
    $stmt->execute([$chapterId, $tenantId]);
    return ordered(array_map('n_objective', $stmt->fetchAll()));
}
function find_sub(string $userId, string $type, array $match): ?array {
    $sql = 'SELECT * FROM submissions WHERE user_id=? AND type=?';
    $args = [$userId, $type];
    foreach ($match as $k => $v) {
        $col = $k === 'index' ? '`index`' : $k;
        if ($v === null) $sql .= " AND {$col} IS NULL";
        else { $sql .= " AND {$col}=?"; $args[] = $v; }
    }
    $sql .= ' ORDER BY created_at ASC LIMIT 1';
    $stmt = db()->prepare($sql);
    $stmt->execute($args);
    $r = $stmt->fetch();
    return $r ? n_sub($r) : null;
}
function user_submissions(string $userId, ?string $type = null): array {
    $sql = 'SELECT * FROM submissions WHERE user_id=?';
    $args = [$userId];
    if ($type) { $sql .= ' AND type=?'; $args[] = $type; }
    $stmt = db()->prepare($sql);
    $stmt->execute($args);
    return array_map('n_sub', $stmt->fetchAll());
}

/* -------------------------------------------------------------- gating - */
function sub_meta(?array $s): ?array {
    if (!$s) return null;
    return ['id' => $s['id'], 'createdAt' => $s['createdAt'], 'score' => $s['score'],
        'flagged' => $s['flagged'], 'similarity' => $s['similarity'],
        'color' => $s['color'], 'text' => $s['text'],
        'bookId' => $s['bookId'], 'chapterId' => $s['chapterId'],
        'moduleId' => $s['moduleId'], 'index' => $s['index'],
        'keywordScore' => $s['keywordScore'] ?? null,
        'keywordsUsed' => $s['keywordsUsed'] ?? null,
        'keywordsTotal' => $s['keywordsTotal'] ?? null,
        'keywordsMissing' => $s['keywordsMissing'] ?? []];
}
function get_library(?string $id): ?array {
    if (!$id) return null;
    $stmt = db()->prepare('SELECT * FROM library WHERE id=? LIMIT 1');
    $stmt->execute([$id]);
    $r = $stmt->fetch();
    return $r ? n_library($r) : null;
}
function book_progress(array $user, array $module, array $book): array {
    $tenantId = $user['tenant_id'];
    $chapters = chapters_of($book['id'], $tenantId);
    $prevDone = true; $states = [];
    foreach ($chapters as $ch) {
        $type = $module['mode'] === 'summary' ? 'chapter_summary' : 'objectives';
        $sub = find_sub($user['id'], $type, ['chapter_id' => $ch['id']]);
        $unlocked = $prevDone;
        $kwList = chapter_keywords($ch);
        $states[] = ['id' => $ch['id'], 'title' => $ch['title'], 'content' => $ch['content'],
            'pageStart' => $ch['pageStart'], 'pageEnd' => $ch['pageEnd'], 'order' => $ch['order'],
            'keywords' => $kwList['list'], 'keywordsSource' => $kwList['source'],
            'objectiveCount' => count(objectives_of($ch['id'], $tenantId)),
            'submission' => sub_meta($sub),
            'status' => $sub ? 'done' : ($unlocked ? 'active' : 'locked')];
        $prevDone = (bool)$sub;
    }
    $allDone = count($chapters) > 0 &&
        count(array_filter($states, fn($s) => $s['submission'])) === count($states);
    $stage = 'chapters'; $summaries = []; $letter = null; $letterSubmission = null;
    if ($allDone) {
        if ($module['mode'] === 'summary') {
            $lsub = find_sub($user['id'], 'letter_summary', ['book_id' => $book['id']]);
            $letterSubmission = sub_meta($lsub);
            $lib = $book['letterId'] ? get_library($book['letterId']) : null;
            $letter = $lib ? ['id' => $lib['id'], 'title' => $lib['title'], 'text' => $lib['text']] : null;
            $stage = !$letter ? 'complete' : ($lsub ? 'complete' : 'letter');
        } else {
            $prompts = $module['summaryPrompts'] ?? [];
            if (!count($prompts)) $stage = 'complete';
            else {
                $next = -1;
                foreach ($prompts as $i => $p) {
                    $sub = find_sub($user['id'], 'book_summary',
                        ['book_id' => $book['id'], 'index' => $i + 1]);
                    if (!$sub && $next === -1) $next = $i;
                    $summaries[] = ['index' => $i + 1,
                        'label' => $p['label'] ?? ('Summary ' . ($i + 1)),
                        'color' => $p['color'] ?? '#3498db',
                        'submission' => sub_meta($sub),
                        'status' => $sub ? 'done' : ($i === $next ? 'active' : 'locked')];
                }
                $stage = $next === -1 ? 'complete' : 'summaries';
            }
        }
    }
    return ['book' => $book, 'chapters' => $states, 'stage' => $stage,
        'summaries' => $summaries, 'letter' => $letter,
        'letterSubmission' => $letterSubmission, 'complete' => $stage === 'complete'];
}

function module_progress(array $user, array $module): array {
    $books = visible_books($user['tenant_id'], $module['id']);
    $states = array_map(fn($b) => book_progress($user, $module, $b), $books);
    $allBooks = count($books) > 0 &&
        count(array_filter($states, fn($s) => $s['complete'])) === count($states);
    $stmt = db()->prepare('SELECT * FROM certificates WHERE user_id=? AND module_id=? LIMIT 1');
    $stmt->execute([$user['id'], $module['id']]);
    $cr = $stmt->fetch();
    $cert = $cr ? n_cert($cr) : null;
    $bestPick = find_sub($user['id'], 'best_book', ['module_id' => $module['id']]);
    $stage = 'work';
    if ($cert) $stage = 'certified';
    elseif ($bestPick) $stage = 'video';
    elseif ($allBooks) $stage = 'best_book';

    $total = 2; $done = 0;
    foreach ($states as $s) {
        foreach ($s['chapters'] as $c) { $total++; if ($c['submission']) $done++; }
        if ($module['mode'] === 'summary') { $total++; if ($s['letterSubmission']) $done++; }
        else { foreach ($s['summaries'] as $x) { $total++; if ($x['submission']) $done++; } }
    }
    if ($bestPick) $done++;
    if ($cert) $done++;

    $objScore = 0; $objTotal = 0;
    $chapterIds = [];
    foreach ($states as $s) foreach ($s['chapters'] as $c) $chapterIds[] = $c['id'];
    if (count($chapterIds)) {
        $ph = implode(',', array_fill(0, count($chapterIds), '?'));
        $stmt = db()->prepare("SELECT score,total FROM submissions WHERE user_id=? AND type='objectives' AND chapter_id IN ($ph)");
        $stmt->execute(array_merge([$user['id']], $chapterIds));
        foreach ($stmt->fetchAll() as $row) {
            $objScore += (int)($row['score'] ?? 0);
            $objTotal += (int)($row['total'] ?? 0);
        }
    }
    return ['module' => ['id' => $module['id'], 'order' => $module['order'],
            'title' => $module['title'], 'mode' => $module['mode'],
            'certificateName' => $module['certificateName'],
            'summaryPrompts' => $module['summaryPrompts'],
            'completionVideoId' => $module['completionVideoId']],
        'books' => $states, 'stage' => $stage,
        'bestPick' => sub_meta($bestPick), 'certificate' => $cert,
        'percent' => $total ? (int)round(100 * $done / $total) : 0,
        'objectiveScore' => $objTotal ? (int)round(100 * $objScore / $objTotal) : null];
}
/* Has this learner finished every module? (books unlock only then.) */
function all_modules_complete(array $user): bool {
    $st = module_statuses($user);
    if (!$st) return false;
    foreach ($st as $s) { if ($s['status'] !== 'completed') return false; }
    return true;
}
function module_statuses(array $user): array {
    $prevOk = true; $out = [];
    foreach (all_modules() as $m) {
        $p = module_progress($user, $m);
        $status = $p['stage'] === 'certified' ? 'completed'
                : ($prevOk ? 'active' : 'locked');
        if ($p['stage'] !== 'certified') $prevOk = false;
        $out[] = ['id' => $m['id'], 'order' => $m['order'], 'title' => $m['title'],
            'mode' => $m['mode'], 'certificateName' => $m['certificateName'],
            'completionVideoId' => $m['completionVideoId'],
            'status' => $status, 'progress' => $p];
    }
    return $out;
}

/* True when a table already has a column — lets optional new columns (see
   php/migrate.php) be used without breaking an older database. */
function has_column(string $table, string $column): bool {
    static $cache = [];
    $key = $table . '.' . $column;
    if (array_key_exists($key, $cache)) return $cache[$key];
    try {
        $st = db()->prepare('SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?');
        $st->execute([$table, $column]);
        $cache[$key] = ((int)$st->fetchColumn()) > 0;
    } catch (Throwable $e) {
        $cache[$key] = false;
    }
    return $cache[$key];
}

/* ------------------------------------------ key words (typed answers) ----- */
/* Module 1 is MODE: SUMMARY, so chapters are answered by typing. Each chapter
   carries key words from its own text; an admin can curate them, otherwise they
   are derived automatically, and typed answers are scored against them. */
function keyword_stopwords(): array {
    static $set = null;
    if ($set === null) {
        $set = array_flip(preg_split('/\s+/', 'the and for are but not you all any can had her was one our out day get has him his how man new now old see two way who boy did its let put say she too use that this these those from with have your will they them their there here when where which while what why how about into over after before under above again further once during shall should would could must might been being does doing done having para como que los las del una por con mas pero sus esta este esto son sin sobre entre cuando donde porque tambien solo cada otro otra todos todas'));
    }
    return $set;
}
function suggest_keywords(?string $text, int $max = 8): array {
    $counts = [];
    foreach (normalize_words($text ?? '') as $w) {
        if (strlen($w) < 4 || isset(keyword_stopwords()[$w])) continue;
        $counts[$w] = ($counts[$w] ?? 0) + 1;
    }
    $keys = array_keys($counts);
    usort($keys, function ($a, $b) use ($counts) {
        if ($counts[$b] !== $counts[$a]) return $counts[$b] - $counts[$a];
        if (strlen($b) !== strlen($a)) return strlen($b) - strlen($a);
        return strcmp($a, $b);
    });
    return array_slice($keys, 0, $max);
}
function clean_keywords($input): array {
    $list = [];
    if (is_array($input)) $list = $input;
    elseif (is_string($input)) $list = preg_split('/[,;\n\r]+/', $input);
    $seen = []; $out = [];
    foreach ($list as $k) {
        $v = strtolower((string)$k);
        $v = str_replace(["'", '’'], '', $v);
        $v = preg_replace('/[^a-z0-9\s-]/', ' ', $v);
        $v = trim(preg_replace('/\s+/', ' ', $v));
        if ($v === '' || strlen($v) < 3 || strlen($v) > 40 || isset($seen[$v])) continue;
        $seen[$v] = true;
        $out[] = $v;
    }
    return array_slice($out, 0, 20);
}
function chapter_keywords(?array $ch): array {
    $own = clean_keywords($ch['keywords'] ?? []);
    if ($own) return ['list' => $own, 'source' => 'set'];
    $auto = suggest_keywords($ch['content'] ?? '', 8);
    return ['list' => $auto, 'source' => $auto ? 'auto' : 'none'];
}
function match_keyword(string $token, string $key): bool {
    if ($token === '' || $key === '') return false;
    if ($token === $key) return true;
    if (strlen($token) >= 5 && strlen($key) >= 5 &&
        (strpos($token, $key) === 0 || strpos($key, $token) === 0)) return true;
    if (strlen($token) >= 5 && strlen($key) >= 5 && strpos($token, $key) !== false) return true;
    return false;
}
function keyword_assessment(?string $text, array $keywords): array {
    $list = array_values(array_filter($keywords, fn($k) => (string)$k !== ''));
    $words = normalize_words($text ?? '');
    $flat = ' ' . trim(preg_replace('/\s+/', ' ', preg_replace('/[^a-z0-9\s-]/', ' ', strtolower((string)$text)))) . ' ';
    $covered = []; $missing = [];
    foreach ($list as $k) {
        $parts = array_values(array_filter(explode(' ', (string)$k)));
        if (count($parts) > 1) $hit = strpos($flat, ' ' . $k . ' ') !== false;
        else $hit = count(array_filter($words, fn($w) => match_keyword($w, $parts[0]))) > 0;
        if ($hit) $covered[] = $k; else $missing[] = $k;
    }
    return ['keywordsTotal' => count($list), 'keywordsUsed' => count($covered),
        'keywordScore' => $list ? (int)round(100 * count($covered) / count($list)) : null,
        'keywordsCovered' => $covered, 'keywordsMissing' => array_slice($missing, 0, 8)];
}

/* key words a submission is assessed against (cached per request) */
function submission_keywords(array $sub): array {
    static $cache = [];
    $chapterId = $sub['chapter_id'] ?? null;
    $bookId = $sub['book_id'] ?? null;
    if ($chapterId !== null) {
        if (!isset($cache['ch:' . $chapterId])) {
            $st = db()->prepare('SELECT * FROM chapters WHERE id=? LIMIT 1');
            $st->execute([$chapterId]);
            $row = $st->fetch();
            $cache['ch:' . $chapterId] = $row ? chapter_keywords(n_chapter($row))['list'] : [];
        }
        return $cache['ch:' . $chapterId];
    }
    if ($bookId !== null) {
        if (!isset($cache['bk:' . $bookId])) {
            $st = db()->prepare('SELECT content FROM chapters WHERE book_id=?');
            $st->execute([$bookId]);
            $cache['bk:' . $bookId] = suggest_keywords(implode(' ', array_map(fn($r) => (string)$r['content'], $st->fetchAll())), 10);
        }
        return $cache['bk:' . $bookId];
    }
    if (!isset($cache['all'])) {
        $st = db()->query('SELECT content FROM chapters');
        $cache['all'] = suggest_keywords(implode(' ', array_map(fn($r) => (string)$r['content'], $st->fetchAll())), 12);
    }
    return $cache['all'];
}
/* assessment of a stored submission: saved scores when present, else computed */
function submission_assessment(array $sub): ?array {
    if (empty($sub['text'])) return null;
    if (isset($sub['keyword_score']) && $sub['keyword_score'] !== null) {
        return ['keywordsTotal' => (int)($sub['keywords_total'] ?? 0),
            'keywordsUsed' => (int)($sub['keywords_used'] ?? 0),
            'keywordScore' => (int)$sub['keyword_score'],
            'keywordsCovered' => jdec($sub['keywords_covered_json'] ?? null, []),
            'keywordsMissing' => jdec($sub['keywords_missing_json'] ?? null, [])];
    }
    $list = submission_keywords($sub);
    if (!$list) return null;
    return keyword_assessment((string)$sub['text'], $list);
}

/* --------------------------------------- copy detection + performance -- */
function normalize_words(?string $text): array {
    $t = strtolower((string)($text ?? ''));
    $t = preg_replace('/[^a-z0-9\s]/', ' ', $t);
    $words = preg_split('/\s+/', $t);
    return array_values(array_filter($words, fn($w) => strlen($w) > 2));
}
function jaccard(array $a, array $b): float {
    $setB = array_flip($b);
    $inter = 0;
    foreach (array_unique($a) as $w) if (isset($setB[$w])) $inter++;
    $uni = count(array_unique($a)) + count(array_unique($b)) - $inter;
    return $uni ? $inter / $uni : 0.0;
}
function assess_copy(array $user, string $type, array $match, ?string $text): array {
    $words = array_unique(normalize_words($text ?? ''));
    if (count($words) < 10) return ['similarity' => 0, 'flagged' => false];
    $sql = 'SELECT `text` FROM submissions WHERE type=? AND user_id<>? AND `text` IS NOT NULL';
    $args = [$type, $user['id']];
    $colMap = ['chapter_id' => 'chapter_id', 'chapterId' => 'chapter_id',
        'book_id' => 'book_id', 'bookId' => 'book_id',
        'module_id' => 'module_id', 'moduleId' => 'module_id',
        'index' => '`index`'];
    foreach ($match as $k => $v) {
        $col = $colMap[$k] ?? null;
        if ($col) {
            if ($v === null) $sql .= " AND {$col} IS NULL";
            else { $sql .= " AND {$col}=?"; $args[] = $v; }
        }
    }
    $stmt = db()->prepare($sql);
    $stmt->execute($args);
    $best = 0.0;
    foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $other) {
        $sim = jaccard($words, normalize_words($other));
        if ($sim > $best) $best = $sim;
    }
    return ['similarity' => (int)round($best * 100), 'flagged' => $best >= 0.75];
}
function performance(array $user): array {
    $statuses = module_statuses($user);
    $overall = count($statuses)
        ? (int)round(array_sum(array_map(fn($m) => $m['progress']['percent'], $statuses)) / count($statuses)) : 0;
    $stmt = db()->prepare('SELECT COUNT(*) FROM submissions WHERE user_id=? AND flagged=1');
    $stmt->execute([$user['id']]);
    $flagged = (int)$stmt->fetchColumn();
    $stmt = db()->prepare('SELECT COUNT(*) FROM certificates WHERE user_id=?');
    $stmt->execute([$user['id']]);
    $certs = (int)$stmt->fetchColumn();
    return ['overall' => $overall, 'flagged' => $flagged, 'certificates' => $certs,
        'modules' => array_map(fn($s) => ['id' => $s['id'], 'title' => $s['title'],
            'status' => $s['status'], 'percent' => $s['progress']['percent'],
            'objectiveScore' => $s['progress']['objectiveScore']], $statuses)];
}
function flow_for(array $user): array {
    $tenant = get_tenant($user['tenant_id']);
    $portal = null;
    if ($tenant) {
        $stmt = db()->prepare('SELECT * FROM portals WHERE id=? LIMIT 1');
        $stmt->execute([$tenant['portal_id']]);
        $portal = $stmt->fetch() ?: null;
    }
    $modules = module_statuses($user);
    $current = null;
    foreach ($modules as $m) if ($m['status'] === 'active') { $current = $m; break; }
    $allDone = count($modules) > 0 && count(array_filter($modules, fn($m) => $m['status'] === 'completed')) === count($modules);
    return ['showLetter' => !$user['letter_feedback_at'],
        'letterDone' => (bool)$user['letter_feedback_at'],
        'optionalVideoSeen' => (bool)$user['optional_video_seen'],
        'portalClosed' => $portal ? !portal_active($portal) : false,
        'currentModuleId' => $current ? $current['id'] : null,
        'allDone' => $allDone,
        'performance' => performance($user),
        'modules' => array_map(fn($m) => ['id' => $m['id'], 'order' => $m['order'],
            'title' => $m['title'], 'mode' => $m['mode'],
            'certificateName' => $m['certificateName'], 'status' => $m['status'],
            'percent' => $m['progress']['percent'], 'stage' => $m['progress']['stage']], $modules)];
}
/* ============================================ self-assessment (pre/post) === */
/* One shared definition (assessment.json at the repo root) serves BOTH
   backends, so the categories, statements and 1-5 scale can never drift apart.
   Cached per request-process like other static programme content. */
function assessment_def(): array {
    static $def = null;
    if ($def === null) {
        $raw = @file_get_contents(__DIR__ . '/../assessment.json');
        $def = $raw ? json_decode($raw, true) : ['scale' => [], 'categories' => []];
        if (!is_array($def)) $def = ['scale' => [], 'categories' => []];
    }
    return $def;
}
function assessment_statement_ids(array $def): array {
    $ids = [];
    foreach (($def['categories'] ?? []) as $c)
        foreach (($c['statements'] ?? []) as $s) $ids[] = (string)$s['id'];
    return $ids;
}
/* Every statement must be rated with an integer 1-5 — anything else is
   rejected before it can be stored, so a total always means something. */
function assessment_answers($body, array $def): array {
    $raw = is_array($body['answers'] ?? null) ? $body['answers'] : [];
    $answers = [];
    foreach (assessment_statement_ids($def) as $id) {
        $v = is_numeric($raw[$id] ?? null) ? $raw[$id] : null;
        need($v !== null && (string)(int)$v === (string)(float)$v
            && (int)$v >= 1 && (int)$v <= 5, 'Please rate every statement from 1 to 5', 400);
        $answers[$id] = (int)$v;
    }
    return $answers;
}
function assessment_totals(array $answers, array $def): array {
    $total = 0; $byCategory = [];
    foreach (($def['categories'] ?? []) as $c) {
        $cat = 0;
        foreach (($c['statements'] ?? []) as $s) $cat += (int)($answers[$s['id']] ?? 0);
        $byCategory[(string)$c['id']] = ['total' => $cat, 'max' => count($c['statements'] ?? []) * 5];
        $total += $cat;
    }
    return ['total' => $total, 'max' => count(assessment_statement_ids($def)) * 5,
        'byCategory' => $byCategory];
}
/* Deterministic shuffle, seeded per user+session+day (shuffles each login). */
function shuffle_with_seed(array $arr, string $seed): array {
    $h = 2166136261;
    $len = strlen($seed);
    for ($i = 0; $i < $len; $i++) {
        $h ^= ord($seed[$i]);
        $h = ($h * 16777619) & 0xFFFFFFFF;
    }
    $out = array_values($arr);
    for ($i = count($out) - 1; $i > 0; $i--) {
        $h = ((($h ^ ($h >> 15)) & 0xFFFFFFFF) * 2246822507) & 0xFFFFFFFF;
        $h = ((($h ^ ($h >> 13)) & 0xFFFFFFFF) * 3266489909) & 0xFFFFFFFF;
        $j = $h % ($i + 1);
        $t = $out[$i]; $out[$i] = $out[$j]; $out[$j] = $t;
    }
    return $out;
}
function shuffled_for_login(array $user, ?string $token, array $list): array {
    return shuffle_with_seed($list, $user['id'] . '|' . ($token ?? '') . '|' . date('Y-m-d'));
}



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
        'letter' => normalize_module_letter_input(jdec($r['letter_json'] ?? null, null)),
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
/* A chapter of an objectives module may carry ANY number of questions — the
   school/organization administrator and the super admin keep adding them. Each
   learner is served only THREE of them, and the three are drawn afresh on every
   LOGIN: the draw is seeded by the account id plus the session token, so a logout
   and login hands the student a different three (and a different option order),
   while the same login sees the same three back on a reload. Two students never
   get the same three in the same order, so nothing can be copied. The submission
   is marked against the draw of the login that sends it, so nothing outside the
   three that were actually served is ever marked. Mirrors
   learnerObjectives() in server/api.js. */
const OBJECTIVE_PICK = 3;
function objectives_for_learner(array $user, string $chapterId, ?string $tenantId, ?string $token = null): array {
    $all = objectives_of($chapterId, $tenantId);
    if (!$all) return $all;
    $draw = shuffle_with_seed($all, $user['id'] . '|' . $chapterId . '|objectives|' . ($token ?? ''));
    return array_slice($draw, 0, OBJECTIVE_PICK);
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
        'total' => isset($s['total']) ? (int)$s['total'] : null,
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
/* ---------------------------------------------- chapter reading gate ----- */
/* A chapter's work may only be answered once its OWN pages have been read to
   the LAST page. This mirrors readingRangeOf()/requireChapterRead() in the Node
   build, so both backends answer the same way. The mark is kept in
   chapter_reads, so a reload (or a direct API call) cannot skip the reading,
   and it is never taken away — a learner may always go back and re-read.
   The gate only applies where there is something to read: a chapter needs its
   own page range AND its book needs a PDF. */
function chapter_page_range(?array $chapter): ?array {
    $from = (int)($chapter['pageStart'] ?? 0);
    $to = (int)($chapter['pageEnd'] ?? 0);
    return ($from > 0 && $to >= $from) ? ['from' => $from, 'to' => $to] : null;
}
function chapter_read_store(): bool {
    /* before migrate.php there is nowhere to keep a reading mark, so no gate */
    return has_table('chapter_reads');
}
function chapter_reading_range(?array $book, ?array $chapter): ?array {
    if (!chapter_read_store()) return null;
    $pages = chapter_page_range($chapter);
    if (!$pages) return null;
    $lib = ($book && !empty($book['libraryId'])) ? get_library((string)$book['libraryId']) : null;
    $url = ($lib && ($lib['type'] ?? '') === 'book') ? trim((string)($lib['url'] ?? '')) : '';
    return $url !== '' ? $pages : null;
}
function find_chapter_read(string $userId, string $chapterId): ?array {
    if (!chapter_read_store()) return null;
    $st = db()->prepare('SELECT * FROM chapter_reads WHERE user_id=? AND chapter_id=? LIMIT 1');
    $st->execute([$userId, $chapterId]);
    $r = $st->fetch();
    return $r ?: null;
}
function chapter_read_done(string $userId, string $chapterId): bool {
    $row = find_chapter_read($userId, $chapterId);
    return $row !== null && !empty($row['completed_at']);
}
function require_chapter_read(array $user, array $book, array $chapter): void {
    $range = chapter_reading_range($book, $chapter);
    if (!$range) return;
    need(chapter_read_done($user['id'], $chapter['id']),
        'Read "' . ($chapter['title'] ?: 'this chapter') . '" to its last page (page ' .
        $range['to'] . ') before answering. Open the chapter pages and turn to page ' . $range['to'] . '.', 403);
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
        /* the answer area opens only at the chapter's last page (see the reading
           gate above); a chapter with no pages of its own is always answerable */
        $range = chapter_reading_range($book, $ch);
        $readRow = $range ? find_chapter_read($user['id'], $ch['id']) : null;
        $readDone = $readRow !== null && !empty($readRow['completed_at']);
        /* the whole bank the administrators wrote, and how many of it is asked */
        $objPool = count(objectives_of($ch['id'], $tenantId));
        $states[] = ['id' => $ch['id'], 'title' => $ch['title'], 'content' => $ch['content'],
            'pageStart' => $ch['pageStart'], 'pageEnd' => $ch['pageEnd'], 'order' => $ch['order'],
            'keywords' => $kwList['list'], 'keywordsSource' => $kwList['source'],
            'objectiveCount' => $objPool,
            'objectivePick' => min(OBJECTIVE_PICK, $objPool),
            'requiresReading' => (bool)$range, 'read' => !$range || $readDone,
            'readAt' => $readDone ? iso($readRow['completed_at']) : null,
            'lastPage' => ($readRow && $readRow['last_page'] !== null) ? (int)$readRow['last_page'] : null,
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
            $letter = $lib ? ['id' => $lib['id'], 'title' => $lib['title'], 'text' => $lib['text'], 'media' => media_out($lib)] : null;
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
    /* the letter this module closes with (only when the admin turned it on and
       wrote at least one question) */
    $letterMeta = module_letter_meta($module);
    $letterOn = $letterMeta['enabled'] && $letterMeta['pool'] > 0;
    $letterSub = $letterOn ? find_sub($user['id'], 'module_letter', ['module_id' => $module['id']]) : null;
    /* THE ORDER OF THESE FOUR TESTS IS THE RULE: the letter the admin switched on
       outranks a best-book pick that was made before it was switched on, so a
       learner cannot reach the video, the certificate — or the next module —
       with the letter still unanswered. A certificate already issued is history
       and is never taken back. */
    $stage = 'work';
    if ($cert) $stage = 'certified';
    elseif ($allBooks && $letterOn && !$letterSub) $stage = 'letter';
    elseif ($bestPick) $stage = 'video';
    elseif ($allBooks) $stage = 'best_book';

    $total = 2; $done = 0;
    if ($letterOn) $total++;
    foreach ($states as $s) {
        foreach ($s['chapters'] as $c) { $total++; if ($c['submission']) $done++; }
        if ($module['mode'] === 'summary') { $total++; if ($s['letterSubmission']) $done++; }
        else { foreach ($s['summaries'] as $x) { $total++; if ($x['submission']) $done++; } }
    }
    if ($letterSub) $done++;
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
        /* the closing letter: on/off, how many questions, the learner's result
           and where they go once it is answered */
        'letter' => $letterOn ? ['meta' => $letterMeta, 'open' => !$letterSub,
            'next' => module_letter_next($user, $module),
            'submission' => sub_meta($letterSub)] : null,
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

/* A read-only build can meet a database that has not been migrated yet (the
   reading tables arrive with migrate.php), so ask before querying them. */
function has_table(string $table): bool {
    static $cache = [];
    if (array_key_exists($table, $cache)) return $cache[$table];
    try {
        $st = db()->prepare('SELECT COUNT(*) FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?');
        $st->execute([$table]);
        $cache[$table] = ((int)$st->fetchColumn()) > 0;
    } catch (Throwable $e) {
        $cache[$table] = false;
    }
    return $cache[$table];
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
    /* a letter answered in typed words is measured against the module's own
       chapters, the same reading the questions were written from */
    $moduleId = $sub['module_id'] ?? null;
    if ($moduleId !== null) {
        if (!isset($cache['md:' . $moduleId])) {
            $st = db()->prepare('SELECT c.content FROM chapters c JOIN books b ON b.id=c.book_id WHERE b.module_id=?');
            $st->execute([$moduleId]);
            $cache['md:' . $moduleId] = suggest_keywords(implode(' ', array_map(fn($r) => (string)$r['content'], $st->fetchAll())), 10);
        }
        return $cache['md:' . $moduleId];
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
/* The definition is seeded from assessment.json on first use, then owned by
   settings.assessment_json so the super admin can add, edit and delete
   categories and objective questions after deployment. */
function assessment_default_scale(): array {
    return [
        ['value' => 1, 'label' => 'Strongly Disagree'], ['value' => 2, 'label' => 'Disagree'],
        ['value' => 3, 'label' => 'Neutral'], ['value' => 4, 'label' => 'Agree'],
        ['value' => 5, 'label' => 'Strongly Agree'],
    ];
}
function assessment_default_def(): array {
    $raw = @file_get_contents(__DIR__ . '/../assessment.json');
    $def = $raw ? json_decode($raw, true) : null;
    return assessment_normalize(is_array($def) ? $def : []);
}
function assessment_normalize($def): array {
    $def = is_array($def) ? $def : [];
    $scale = (isset($def['scale']) && is_array($def['scale']) && count($def['scale']))
        ? $def['scale'] : assessment_default_scale();
    $categories = [];
    foreach (($def['categories'] ?? []) as $ci => $c) {
        if (!is_array($c) || empty($c['id']) || empty($c['title'])) continue;
        $statements = [];
        foreach (($c['statements'] ?? []) as $si => $s) {
            if (!is_array($s) || empty($s['id']) || empty($s['text'])) continue;
            $statements[] = [
                'id' => (string)$s['id'],
                'text' => trim((string)$s['text']),
                'order' => isset($s['order']) && is_numeric($s['order']) ? (int)$s['order'] : $si + 1,
            ];
        }
        $categories[] = [
            'id' => (string)$c['id'],
            'title' => trim((string)$c['title']),
            'order' => isset($c['order']) && is_numeric($c['order']) ? (int)$c['order'] : $ci + 1,
            'statements' => $statements,
        ];
    }
    return ['scale' => $scale, 'note' => (string)($def['note'] ?? ''), 'categories' => $categories];
}
function assessment_def(): array {
    static $def = null;
    if ($def !== null) return $def;
    $stored = null;
    if (has_column('settings', 'assessment_json')) {
        $settings = get_settings();
        $stored = jdec($settings['assessment_json'] ?? null, null);
    }
    if (!is_array($stored) || empty($stored['categories'])) {
        $stored = assessment_default_def();
        if (has_column('settings', 'assessment_json')) {
            try {
                db()->prepare('UPDATE settings SET assessment_json=? WHERE id=1')
                    ->execute([jenc($stored)]);
            } catch (Throwable $e) { /* read-only fallback until migration runs */ }
        }
    }
    $def = assessment_normalize($stored);
    return $def;
}
function assessment_save(array $def): array {
    $def = assessment_normalize($def);
    need(has_column('settings', 'assessment_json'),
        'Run migrate.php first: settings.assessment_json is missing', 500);
    db()->prepare('UPDATE settings SET assessment_json=? WHERE id=1')
        ->execute([jenc($def)]);
    return $def;
}
/* Empty categories are still being set up; participants and reports only see
   categories that already carry at least one objective question. */
function assessment_active_def(array $def): array {
    $def = assessment_normalize($def);
    $def['categories'] = array_values(array_filter($def['categories'],
        fn($c) => count($c['statements'] ?? []) > 0));
    return $def;
}
function assessment_statement_ids(array $def): array {
    $ids = [];
    foreach (($def['categories'] ?? []) as $c)
        foreach (($c['statements'] ?? []) as $s) $ids[] = (string)$s['id'];
    return $ids;
}
function assessment_statement_count(array $def): int {
    $n = 0;
    foreach (($def['categories'] ?? []) as $c) $n += count($c['statements'] ?? []);
    return $n;
}
function assessment_category_index(array $def, string $id): ?int {
    foreach (($def['categories'] ?? []) as $i => $c) if ((string)$c['id'] === $id) return $i;
    return null;
}
function assessment_statement_find(array $def, string $id): ?array {
    foreach (($def['categories'] ?? []) as $ci => $c) {
        foreach (($c['statements'] ?? []) as $si => $s) {
            if ((string)$s['id'] === $id) return ['categoryIndex' => $ci, 'statementIndex' => $si];
        }
    }
    return null;
}
function assessment_category_id(array $def, string $title): string {
    $base = slugify($title) ?: 'category';
    $used = [];
    foreach (($def['categories'] ?? []) as $c) $used[(string)$c['id']] = true;
    $id = $base; $n = 2;
    while (isset($used[$id])) $id = $base . '-' . $n++;
    return $id;
}
function assessment_statement_id(array $category): string {
    $used = [];
    foreach (($category['statements'] ?? []) as $s) $used[(string)$s['id']] = true;
    /* never reuse a deleted question's id: historical pre/post answers are keyed
       by it, and a new question must not inherit somebody else's ratings */
    do {
        $id = $category['id'] . '-' . bin2hex(random_bytes(3));
    } while (isset($used[$id]));
    return $id;
}
/* Every statement must be rated with an integer 1-5 — anything else is
   rejected before it can be stored, so a total always means something. */
function assessment_answers($body, array $def): array {
    $raw = is_array($body['answers'] ?? null) ? $body['answers'] : [];
    $ids = assessment_statement_ids($def);
    need(count($ids) > 0, 'The self-assessment has no objective questions yet', 400);
    $answers = [];
    foreach ($ids as $id) {
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
/* Compact pre/post summary used by both progress reports and the popup. */
function assessment_report(array $user, array $def): array {
    $def = assessment_active_def($def);
    $one = function ($record) use ($def) {
        if (!is_array($record) || !is_array($record['answers'] ?? null)) return null;
        $t = assessment_totals($record['answers'], $def);
        $categories = [];
        foreach ($def['categories'] as $c) {
            $v = $t['byCategory'][(string)$c['id']] ?? ['total' => 0, 'max' => 0];
            $categories[] = ['id' => $c['id'], 'title' => $c['title'],
                'total' => $v['total'], 'max' => $v['max'],
                'percent' => $v['max'] ? (int)round($v['total'] / $v['max'] * 100) : 0];
        }
        return ['at' => $record['at'] ?? null, 'total' => $t['total'], 'max' => $t['max'],
            'percent' => $t['max'] ? (int)round($t['total'] / $t['max'] * 100) : 0,
            'categories' => $categories];
    };
    $pre = $one($user['assessment_pre'] ?? null);
    $post = $one($user['assessment_post'] ?? null);
    return ['pre' => $pre, 'post' => $post,
        'growth' => ($pre && $post) ? $post['total'] - $pre['total'] : null];
}
function assessment_public_def(array $def): array {
    $def = assessment_normalize($def);
    $categories = [];
    foreach ($def['categories'] as $c) {
        $categories[] = ['id' => $c['id'], 'title' => $c['title'], 'order' => $c['order'],
            'max' => count($c['statements']) * 5, 'statements' => array_map(
                fn($s) => ['id' => $s['id'], 'text' => $s['text'], 'order' => $s['order']],
                $c['statements'])];
    }
    $count = assessment_statement_count($def);
    return ['scale' => $def['scale'], 'note' => $def['note'], 'categories' => $categories,
        'statementCount' => $count, 'max' => $count * 5];
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

/* ======================================= the letter after a module ======= */
/* The super admin writes a pool of up to ten questions for the letter that
   closes a module. Each learner answers only TWO of them: the pair is drawn
   from the pool with the learner's own account as the seed, so every student
   sees a different two, in a different order, while the same student always
   sees the same two. While the questions are live the letter itself is veiled
   (blurred) so an answer is written from what was read, never copied. */
const LETTER_POOL_MAX = 10;
const LETTER_PICK = 2;

/* One authored question: a prompt plus (for objective mode) up to six options
   and the index of the right one. Mirrors normalizeLetterQuestions() in
   server/api.js so both backends read the same stored shape. */
function normalize_letter_questions($list): array {
    if (!is_array($list)) return [];
    $out = [];
    foreach (array_values($list) as $i => $q) {
        $src = is_array($q) ? $q : ['question' => (string)$q];
        $question = trim((string)($src['question'] ?? $src['text'] ?? ''));
        if ($question === '') continue;
        $options = [];
        if (isset($src['options']) && is_array($src['options'])) {
            foreach ($src['options'] as $o) {
                $text = is_array($o) ? trim((string)($o['text'] ?? '')) : trim((string)($o ?? ''));
                if ($text !== '') $options[] = $text;
                if (count($options) >= 6) break;
            }
        }
        $answerIndex = $src['answerIndex'] ?? $src['answer_index'] ?? null;
        $answerIndex = is_numeric($answerIndex) ? (int)$answerIndex : 0;
        if ($answerIndex < 0 || ($options && $answerIndex >= count($options))) $answerIndex = 0;
        $id = trim((string)($src['id'] ?? ''));
        $out[] = ['id' => $id !== '' ? $id : ('q' . ($i + 1)), 'question' => $question,
            'options' => $options, 'answerIndex' => $options ? $answerIndex : null];
        if (count($out) >= LETTER_POOL_MAX) break;
    }
    return $out;
}
/* Where a learner goes once the letter is answered: if a best book was already
   picked (before the admin switched the letter on) the certificate is next,
   otherwise the best-book pick is. */
function module_letter_next(array $user, array $module): string {
    return find_sub($user['id'], 'best_book', ['module_id' => $module['id']])
        ? 'video' : 'best_book';
}
/* The authored pool of one module (empty when nothing has been written yet). */
function letter_questions(array $module): array {
    $letter = $module['letter'] ?? null;
    return normalize_letter_questions(is_array($letter) ? ($letter['questions'] ?? null) : null);
}
/* What the admin screen and the learner screen need to know about the letter. */
function module_letter_meta(array $module): array {
    $src = (isset($module['letter']) && is_array($module['letter'])) ? $module['letter'] : [];
    $list = letter_questions($module);
    $enabled = array_key_exists('enabled', $src) ? (bool)$src['enabled'] : count($list) > 0;
    return ['enabled' => $enabled,
        'letterId' => $src['letterId'] ?? null,
        'mode' => ($src['mode'] ?? '') === 'summary' ? 'summary' : 'objectives',
        'pool' => count($list),
        'pick' => $list ? min(LETTER_PICK, count($list)) : 0];
}
/* The letter the module's questions belong to: the module's own pick first,
   then the programme's Letter from Christ, so a module can reuse it. */
function module_letter_doc(array $module): ?array {
    $meta = module_letter_meta($module);
    $lib = $meta['letterId'] ? get_library($meta['letterId']) : null;
    if (!$lib) {
        $settings = get_settings();
        $lib = get_library($settings['letter_id'] ?? null);
    }
    if (!$lib) return null;
    return ['id' => $lib['id'], 'title' => $lib['title'], 'text' => $lib['text'],
        'media' => media_out($lib)];
}
/* What the super admin may save for a module's letter (switch, library letter,
   answering style, pool). Blank rows are dropped and the pool is capped at ten. */
function normalize_module_letter_input($src): array {
    $obj = is_array($src) ? $src : [];
    $list = normalize_letter_questions($obj['questions'] ?? null);
    return ['enabled' => array_key_exists('enabled', $obj) ? (bool)$obj['enabled'] : count($list) > 0,
        'letterId' => !empty($obj['letterId']) ? (string)$obj['letterId']
            : (!empty($obj['letter_id']) ? (string)$obj['letter_id'] : null),
        'mode' => ($obj['mode'] ?? '') === 'summary' ? 'summary' : 'objectives',
        'questions' => $list];
}
/* The TWO questions this learner has to answer, in their own stable order.
   Options are shuffled per login; the submission maps the chosen text back to
   the authored index, exactly like chapter objectives. */
function module_letter_for(array $user, array $module, ?string $token): ?array {
    $meta = module_letter_meta($module);
    if (!$meta['enabled'] || !$meta['pool']) return null;
    $all = letter_questions($module);
    $order = shuffle_with_seed($all, $user['id'] . '|' . $module['id'] . '|letter');
    $chosen = array_slice($order, 0, $meta['pick']);
    $questions = [];
    foreach ($chosen as $q) {
        $questions[] = ['id' => $q['id'], 'question' => $q['question'],
            'options' => $q['options'] ? shuffle_with_seed($q['options'], $q['id'] . ($token ?? '')) : []];
    }
    return ['mode' => $meta['mode'], 'letter' => module_letter_doc($module),
        'counts' => ['pool' => $meta['pool'], 'pick' => $meta['pick']],
        'questions' => $questions];
}



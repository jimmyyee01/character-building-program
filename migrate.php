<?php
/* migrate.php — adds the columns newer versions expect to an EXISTING database.
   Safe to rerun: adds only missing columns and preserves existing records. Run
   it once after pulling an update:

       php migrate.php

   (A freshly installed database already has these columns — see database.sql.)
*/
require __DIR__ . '/php/config.php';
require __DIR__ . '/php/engine.php';

header('Content-Type: text/plain; charset=utf-8');
echo "Character Building Program — database migration\n\n";

$wanted = [
    'chapters' => [
        'keywords_json' => 'LONGTEXT NULL',
    ],
    'modules' => [
        /* the letter that closes the module: switch, library letter, answering
           style and the pool of up to ten questions (two are issued per learner) */
        'letter_json' => 'LONGTEXT NULL',
    ],
    'conversation_messages' => [
        /* PDF/text/Word/audio/video files attached to a message */
        'attachments_json' => 'LONGTEXT NULL',
    ],
    'users' => [
        'supervisor_waitlisted' => 'TINYINT(1) NOT NULL DEFAULT 0',
        'assessment_pre_json' => 'LONGTEXT NULL',
        'assessment_post_json' => 'LONGTEXT NULL',
    ],
    'submissions' => [
        'keyword_score' => 'INT NULL',
        'keywords_used' => 'INT NULL',
        'keywords_total' => 'INT NULL',
        'keywords_covered_json' => 'LONGTEXT NULL',
        'keywords_missing_json' => 'LONGTEXT NULL',
    ],
    'certificates' => [
        'transcript_json' => 'LONGTEXT NULL',
    ],
    'settings' => [
        'assessment_json' => 'LONGTEXT NULL',
    ],
    'notifications' => [
        /* a video alert carries the library video the learner may play */
        'library_id' => 'VARCHAR(64) NULL',
        'video_url' => 'VARCHAR(1000) NULL',
    ],
    'video_alerts' => [
        /* whether the super admin chose the video for that point ('super') or it
           was drawn automatically ('auto') */
        'chosen_by' => 'VARCHAR(10) NULL',
    ],
    'library' => [
        /* how big an uploaded video/audio/file is, shown while it uploads */
        'file_size' => 'BIGINT NULL',
        /* an optional video or audio attached to a letter */
        'media_url' => 'VARCHAR(1000) NULL',
        'media_name' => 'VARCHAR(255) NULL',
        'media_size' => 'BIGINT NULL',
        'media_kind' => 'VARCHAR(10) NULL',
    ],
    'books' => [
        /* an optional video or audio attached to a book */
        'media_url' => 'VARCHAR(1000) NULL',
        'media_name' => 'VARCHAR(255) NULL',
        'media_size' => 'BIGINT NULL',
        'media_kind' => 'VARCHAR(10) NULL',
    ],
    'tenants' => [
        /* an account's own Letter of Christ (falls back to the program letter) */
        'letter_id' => 'VARCHAR(64) NULL',
    ],
    'sessions' => [
        /* when the learner's page last said it was still on screen: a student
           sign-in ends when the app is minimised, closed or left */
        'live_at' => 'DATETIME NULL',
    ],
];

$done = 0; $skipped = 0;
try {
    $communicationTables = [
        'CREATE TABLE IF NOT EXISTS conversations (
            id VARCHAR(64) PRIMARY KEY,
            tenant_id VARCHAR(64) NOT NULL,
            participant_key CHAR(64) NOT NULL,
            participant_ids_json LONGTEXT NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_conversations_participant (tenant_id, participant_key), INDEX (updated_at)
        ) ENGINE=InnoDB',
        'CREATE TABLE IF NOT EXISTS conversation_messages (
            id VARCHAR(64) PRIMARY KEY,
            conversation_id VARCHAR(64) NOT NULL,
            sender_id VARCHAR(64) NOT NULL,
            body TEXT NOT NULL,
            attachments_json LONGTEXT NULL,
            read_at DATETIME NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX (conversation_id, created_at), INDEX (conversation_id, read_at)
        ) ENGINE=InnoDB',
        'CREATE TABLE IF NOT EXISTS notifications (
            id VARCHAR(64) PRIMARY KEY,
            user_id VARCHAR(64) NOT NULL,
            type VARCHAR(30) NOT NULL,
            title VARCHAR(255) NOT NULL,
            body TEXT NOT NULL,
            conversation_id VARCHAR(64) NULL,
            student_id VARCHAR(64) NULL,
            submission_id VARCHAR(64) NULL,
            read_at DATETIME NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX (user_id, created_at), INDEX (user_id, read_at), INDEX (conversation_id)
        ) ENGINE=InnoDB',
        'CREATE TABLE IF NOT EXISTS live_lessons (
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
        ) ENGINE=InnoDB',
        'CREATE TABLE IF NOT EXISTS book_opens (
            id VARCHAR(64) PRIMARY KEY,
            tenant_id VARCHAR(64) NOT NULL,
            user_id VARCHAR(64) NOT NULL,
            kind VARCHAR(20) NOT NULL DEFAULT \'module\',
            book_id VARCHAR(64) NULL,
            library_id VARCHAR(64) NULL,
            title VARCHAR(255) NOT NULL,
            opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX (tenant_id, opened_at), INDEX (user_id, opened_at),
            INDEX (book_id), INDEX (library_id)
        ) ENGINE=InnoDB',
        /* How far a learner has read a chapter: the answer area of a chapter
           opens only at its last page (chapter.reading-gate). */
        'CREATE TABLE IF NOT EXISTS chapter_reads (
            id VARCHAR(64) PRIMARY KEY,
            tenant_id VARCHAR(64) NOT NULL,
            user_id VARCHAR(64) NOT NULL,
            chapter_id VARCHAR(64) NOT NULL,
            book_id VARCHAR(64) NULL,
            last_page INT NOT NULL DEFAULT 0,
            page_end INT NOT NULL DEFAULT 0,
            completed_at DATETIME NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_chapter_reads (user_id, chapter_id),
            INDEX (tenant_id), INDEX (book_id)
        ) ENGINE=InnoDB',
        'CREATE TABLE IF NOT EXISTS video_alerts (
            id VARCHAR(64) PRIMARY KEY,
            tenant_id VARCHAR(64) NOT NULL,
            user_id VARCHAR(64) NOT NULL,
            library_id VARCHAR(64) NOT NULL,
            title VARCHAR(255) NOT NULL,
            video_url VARCHAR(1000) NULL,
            milestone VARCHAR(64) NOT NULL,
            chapters_completed INT NOT NULL DEFAULT 0,
            chosen_by VARCHAR(10) NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_video_alert_milestone (user_id, milestone),
            INDEX (user_id, created_at), INDEX (library_id)
        ) ENGINE=InnoDB',
        /* The video each point unlocks, chosen by the super admin: point 1 is
           unlocked by the third finished chapter, point 2 by the sixth … */
        'CREATE TABLE IF NOT EXISTS video_alert_plan (
            chapters INT PRIMARY KEY,
            library_id VARCHAR(64) NOT NULL,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_by VARCHAR(64) NULL
        ) ENGINE=InnoDB',
        /* What everybody did, and when: the super admin's "System log". */
        'CREATE TABLE IF NOT EXISTS activity_log (
            id VARCHAR(64) PRIMARY KEY,
            at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            action VARCHAR(30) NOT NULL,
            entity VARCHAR(40) NOT NULL,
            entity_id VARCHAR(64) NULL,
            label VARCHAR(255) NULL,
            detail VARCHAR(500) NULL,
            user_id VARCHAR(64) NULL,
            user_name VARCHAR(255) NULL,
            role VARCHAR(30) NULL,
            tenant_id VARCHAR(64) NULL,
            tenant_name VARCHAR(255) NULL,
            ip VARCHAR(60) NULL,
            INDEX idx_activity_at (at), INDEX idx_activity_user (user_id),
            INDEX idx_activity_action (action), INDEX idx_activity_tenant (tenant_id)
        ) ENGINE=InnoDB',
        /* Nothing is gone by default: a deletion is kept here until an admin
           restores it or deletes it for good. */
        'CREATE TABLE IF NOT EXISTS trash (
            id VARCHAR(64) PRIMARY KEY,
            at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            entity VARCHAR(40) NOT NULL,
            entity_id VARCHAR(64) NULL,
            label VARCHAR(255) NULL,
            by_id VARCHAR(64) NULL,
            by_name VARCHAR(255) NULL,
            by_role VARCHAR(30) NULL,
            tenant_id VARCHAR(64) NULL,
            tenant_name VARCHAR(255) NULL,
            payload_json LONGTEXT NOT NULL,
            restored_at DATETIME NULL,
            restored_by VARCHAR(64) NULL,
            INDEX idx_trash_at (at), INDEX idx_trash_entity (entity)
        ) ENGINE=InnoDB',
    ];
    foreach ($communicationTables as $ddl) db()->exec($ddl);
    echo "ok       messaging, notification and live lesson tables ready\n";
    foreach ($wanted as $table => $columns) {
        foreach ($columns as $column => $type) {
            if (has_column($table, $column)) {
                echo "ok       {$table}.{$column} already present\n";
                $skipped++;
                continue;
            }
            db()->exec("ALTER TABLE `{$table}` ADD COLUMN `{$column}` {$type}");
            echo "added    {$table}.{$column} {$type}\n";
            $done++;
        }
    }
    $waitlisted = db()->exec("UPDATE users SET supervisor_waitlisted=1
        WHERE supervisor_id IS NULL AND role IN ('student','member')");
    echo "marked   {$waitlisted} unassigned learner(s) for supervisor assignment\n";
    echo "\nDone. {$done} column(s) added, {$skipped} already present.\n";
    echo "Key words assess typed answers (MODULE 1 = MODE: SUMMARY):\n";
    echo "- a chapter's key words come from its own text unless an admin sets them\n";
    echo "- existing typed answers are scored automatically when read, and new ones\n";
    echo "  are stored with their score.\n";
} catch (Throwable $e) {
    http_response_code(500);
    echo "\nMigration failed: " . $e->getMessage() . "\n";
}

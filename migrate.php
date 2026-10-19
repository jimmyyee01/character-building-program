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
    ];
    foreach ($communicationTables as $ddl) db()->exec($ddl);
    echo "ok       messaging and notification tables ready\n";
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

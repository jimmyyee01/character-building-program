<?php
/* migrate.php — adds the columns newer versions expect to an EXISTING database.
   Safe to run as many times as you like: it only adds what is missing and never
   touches existing data. Run it once after pulling an update:

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
    echo "\nDone. {$done} column(s) added, {$skipped} already present.\n";
    echo "Key words assess typed answers (MODULE 1 = MODE: SUMMARY):\n";
    echo "- a chapter's key words come from its own text unless an admin sets them\n";
    echo "- existing typed answers are scored automatically when read, and new ones\n";
    echo "  are stored with their score.\n";
} catch (Throwable $e) {
    http_response_code(500);
    echo "\nMigration failed: " . $e->getMessage() . "\n";
}

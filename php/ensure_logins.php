<?php
/* =====================================================================
   ensure_logins.php — safe top-up of the ready-to-use logins.
   Creates, only when missing, one admin login per portal plus the super
   admin, so every portal always has a usable login. Idempotent: running
   it again changes nothing it already created.

   Usage (command line only):
       php ensure_logins.php
   ===================================================================== */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Run this file from the command line:  php ensure_logins.php\n";
    exit;
}

require_once __DIR__ . '/config.php';

/* portal key, tenant id, portal type, tenant slug, tenant name,
   admin full name, login (email), password */
$LOGINS = [
    ['prt_schools', 'ten_greenfield', 'schools', 'greenfield-academy', 'Greenfield Academy',
        'Greenfield Admin', 'admin@greenfield.edu', 'Admin@123'],
    ['prt_org', 'ten_horizon', 'organization', 'horizon-alliance', 'Horizon Alliance',
        'Horizon Admin', 'admin@horizon.org', 'Admin@123'],
    ['prt_family', 'ten_beloved', 'family', 'beloved-family', 'Beloved Family',
        'Family Admin', 'admin@family.example', 'Admin@123'],
    ['prt_married', 'ten_covenant', 'married', 'covenant-couples', 'Covenant Couples',
        'Married Admin', 'admin@married.example', 'Admin@123'],
];

$made = 0; $kept = 0;

/* ------------------------------------------------------------ super admin */
$s = db()->query('SELECT * FROM settings WHERE id=1 LIMIT 1')->fetch();
if (!$s) {
    db()->prepare('INSERT INTO settings (id,program_name,super_username,super_salt,super_hash) VALUES (1,?,?,?,?)')
        ->execute(['Character Building Program', 'superadmin', '', hash_pw('SuperAdmin@123')]);
    echo "created  : super admin  ->  superadmin / SuperAdmin@123\n";
    $made++;
} elseif (empty($s['super_hash'])) {
    db()->prepare('UPDATE settings SET super_username=?, super_hash=? WHERE id=1')
        ->execute(['superadmin', hash_pw('SuperAdmin@123')]);
    echo "restored : super admin  ->  superadmin / SuperAdmin@123\n";
    $made++;
} else {
    echo "kept     : super admin  ->  " . $s['super_username'] . " (password unchanged)\n";
    $kept++;
}

/* ------------------------------------------------- one admin per portal -- */
foreach ($LOGINS as $l) {
    list($portalId, $tenantId, $type, $slug, $name, $full, $email, $pw) = $l;

    $st = db()->prepare('SELECT id FROM tenants WHERE id=? LIMIT 1');
    $st->execute([$tenantId]);
    if (!$st->fetchColumn()) {
        $st = db()->prepare('SELECT id FROM portals WHERE `key`=? LIMIT 1');
        $st->execute([$type]);
        $pid = $st->fetchColumn() ?: $portalId;
        db()->prepare('INSERT INTO tenants (id,portal_id,type,slug,name,created_at) VALUES (?,?,?,?,?,?)')
            ->execute([$tenantId, $pid, $type, $slug, $name, now_dt()]);
        echo "created  : account      ->  " . $name . ' (/t/' . $slug . ")\n";
        $made++;
    }

    $st = db()->prepare('SELECT id FROM users WHERE tenant_id=? AND email=? LIMIT 1');
    $st->execute([$tenantId, $email]);
    if ($st->fetchColumn()) {
        echo "kept     : " . str_pad($type, 12) . ' ->  ' . $email . " (already exists)\n";
        $kept++;
        continue;
    }
    db()->prepare('INSERT INTO users (id,tenant_id,role,full_name,email,password_hash,created_at) VALUES (?,?,?,?,?,?,?)')
        ->execute([uid('usr'), $tenantId, 'tenant_admin', $full, $email, hash_pw($pw), now_dt()]);
    echo "created  : " . str_pad($type, 12) . ' ->  ' . $email . ' / ' . $pw . "\n";
    $made++;
}

echo "\n" . $made . " created, " . $kept . " already in place.\n";
echo "Portal admin logins open at /t/<slug>; the super admin console is /super.\n";

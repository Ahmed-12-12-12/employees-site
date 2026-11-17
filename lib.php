<?php
/* مكتبة مشتركة — اتصال قاعدة البيانات والجداول والدوال العامة */
if (!defined('APP')) { http_response_code(403); exit; }

function cfg($k = null) {
    static $c = null;
    if ($c === null) {
        $f = __DIR__ . '/config.php';
        if (!is_file($f)) return null;
        $c = require $f;
        date_default_timezone_set(isset($c['timezone']) ? $c['timezone'] : 'Asia/Riyadh');
    }
    return $k === null ? $c : (isset($c[$k]) ? $c[$k] : null);
}

function db() {
    static $pdo = null;
    if ($pdo) return $pdo;
    $pdo = new PDO(cfg('db_dsn'), cfg('db_user'), cfg('db_pass'), [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    if (driver() === 'sqlite') $pdo->exec('PRAGMA foreign_keys=ON');
    return $pdo;
}
function driver() { return strpos(cfg('db_dsn'), 'sqlite:') === 0 ? 'sqlite' : 'mysql'; }

function q($sql, $p = []) { $s = db()->prepare($sql); $s->execute($p); return $s; }
function rows($sql, $p = []) { return q($sql, $p)->fetchAll(); }
function row($sql, $p = []) { $r = q($sql, $p)->fetch(); return $r === false ? null : $r; }
function val($sql, $p = []) { $v = q($sql, $p)->fetchColumn(); return $v === false ? null : $v; }
function now() { return date('Y-m-d H:i:s'); }
function rnd($bytes = 16) { return bin2hex(random_bytes($bytes)); }

function schema() {
    $my = driver() === 'mysql';
    $pk = $my ? 'INT AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    $end = $my ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci' : '';
    $big = $my ? 'LONGTEXT' : 'TEXT';
    return [
"CREATE TABLE IF NOT EXISTS admins (id $pk, username VARCHAR(60) NOT NULL UNIQUE, pass_hash VARCHAR(255) NOT NULL, created_at DATETIME)$end",
"CREATE TABLE IF NOT EXISTS shifts (id $pk, name VARCHAR(100) NOT NULL, start_time VARCHAR(5) NOT NULL, end_time VARCHAR(5) NOT NULL, grace INT NOT NULL DEFAULT 10, off_days VARCHAR(20) NOT NULL DEFAULT '5')$end",
"CREATE TABLE IF NOT EXISTS sites (id $pk, name VARCHAR(150) NOT NULL, lat DOUBLE NULL, lng DOUBLE NULL, radius INT NOT NULL DEFAULT 50, allow_qr TINYINT NOT NULL DEFAULT 1, allow_gps TINYINT NOT NULL DEFAULT 1, secret VARCHAR(64) NOT NULL, kiosk_key VARCHAR(64) NOT NULL)$end",
"CREATE TABLE IF NOT EXISTS employees (id $pk, ord INT NOT NULL DEFAULT 0, name VARCHAR(200) NOT NULL, dob VARCHAR(10), dob_h VARCHAR(12), nid VARCHAR(20), id_exp VARCHAR(10), job VARCHAR(150), card VARCHAR(40), card_exp VARCHAR(10), join_date VARCHAR(10), phone VARCHAR(30), email VARCHAR(150), shift_id INT NULL, device_hash VARCHAR(64) NULL, device_at DATETIME NULL, act_code VARCHAR(10) NULL, act_fail INT NOT NULL DEFAULT 0, created_at DATETIME)$end",
"CREATE TABLE IF NOT EXISTS emp_sites (emp_id INT NOT NULL, site_id INT NOT NULL, PRIMARY KEY (emp_id, site_id))$end",
"CREATE TABLE IF NOT EXISTS photos (nid VARCHAR(20) NOT NULL PRIMARY KEY, data $big NOT NULL)$end",
"CREATE TABLE IF NOT EXISTS attendance (id $pk, emp_id INT NOT NULL, work_date VARCHAR(10) NOT NULL, in_time DATETIME NOT NULL, out_time DATETIME NULL, in_site INT NULL, out_site INT NULL, in_method VARCHAR(10), out_method VARCHAR(10), in_lat DOUBLE NULL, in_lng DOUBLE NULL, in_acc DOUBLE NULL, out_lat DOUBLE NULL, out_lng DOUBLE NULL, out_acc DOUBLE NULL, note TEXT, edited_by VARCHAR(60) NULL)$end",
"CREATE INDEX " . ($my ? '' : 'IF NOT EXISTS ') . "att_emp_date ON attendance (emp_id, work_date)",
    ];
}

/* QR token: يتغير كل 30 ثانية */
const QR_STEP = 30;
function qr_token($site, $win) { return substr(hash_hmac('sha256', $win . '|' . $site['id'], $site['secret']), 0, 16); }
function qr_valid($site, $tok) {
    $w = intdiv(time(), QR_STEP);
    foreach ([$w, $w - 1] as $x) if (hash_equals(qr_token($site, $x), (string)$tok)) return true; // صالح حتى 60 ثانية
    return false;
}
function dist_m($lat1, $lng1, $lat2, $lng2) {
    $R = 6371000; $p1 = deg2rad($lat1); $p2 = deg2rad($lat2);
    $dp = deg2rad($lat2 - $lat1); $dl = deg2rad($lng2 - $lng1);
    $a = sin($dp / 2) ** 2 + cos($p1) * cos($p2) * sin($dl / 2) ** 2;
    return 2 * $R * atan2(sqrt($a), sqrt(1 - $a));
}

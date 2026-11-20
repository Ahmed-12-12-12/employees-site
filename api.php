<?php
/* واجهة برمجية واحدة: api.php?a=ACTION  (POST JSON) */
define('APP', 1);
ini_set('display_errors', '0'); // التحذيرات تذهب للسجل ولا تفسد ردود JSON
require __DIR__ . '/lib.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function out($d) { echo json_encode($d, JSON_UNESCAPED_UNICODE); exit; }
function fail($msg, $code = 400) { http_response_code($code); out(['error' => $msg]); }

if (!cfg()) fail('النظام غير مُثبَّت. افتح install.php أولًا.', 503);
if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('POST only', 405);
if (!isset($_SERVER['HTTP_X_REQ'])) fail('bad request', 400); // يمنع الطلبات من مواقع أخرى

$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');
session_name('empsess');
session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'httponly' => true, 'secure' => $https, 'samesite' => 'Lax']);
session_start();

$a = isset($_GET['a']) ? $_GET['a'] : '';
$in = json_decode(file_get_contents('php://input'), true);
if (!is_array($in)) $in = [];
function p($k, $d = null) { global $in; return array_key_exists($k, $in) ? $in[$k] : $d; }
function s($k) { $v = p($k, ''); return is_scalar($v) ? trim((string)$v) : ''; }
function nul($v) { return ($v === '' || $v === null) ? null : $v; }
function isDate($v) { return is_string($v) && preg_match('/^\d{4}-\d\d-\d\d$/', $v); }

/* ---------- المستخدم الحالي والصلاحيات ---------- */
function me() {
    static $u = false;
    if ($u !== false) return $u;
    if (empty($_SESSION['uid']) && !empty($_SESSION['admin'])) $_SESSION['uid'] = val('SELECT id FROM admins WHERE username=?', [$_SESSION['admin']]); // جلسات قديمة
    if (empty($_SESSION['uid'])) return $u = null;
    $r = row('SELECT * FROM admins WHERE id=?', [(int)$_SESSION['uid']]);
    if (!$r || !(int)$r['active']) { $_SESSION = []; return $u = null; }
    $r['permset'] = $r['role'] === 'admin' ? array_keys(PERMS) : array_values(array_intersect(json_decode($r['perms'] ?: '[]', true) ?: [], array_keys(PERMS)));
    return $u = $r;
}
function need($perm = null) {
    $u = me(); if (!$u) fail('يجب تسجيل الدخول', 401);
    if ($perm === 'admin') { if ($u['role'] !== 'admin') fail('هذه العملية للمدير فقط', 403); }
    elseif ($perm) foreach ((array)$perm as $x) if (!in_array($x, $u['permset'], true)) fail('ليست لديك صلاحية لهذه العملية', 403);
    return $u['username'];
}
function needAny($perms) { $u = me(); if (!$u) fail('يجب تسجيل الدخول', 401); if (!array_intersect($perms, $u['permset'])) fail('ليست لديك صلاحية لهذه العملية', 403); return $u['username']; }
function logx($action, $detail = '') { $u = me(); q('INSERT INTO logs (at, user, action, detail) VALUES (?,?,?,?)', [now(), $u ? $u['username'] : null, $action, mb_substr((string)$detail, 0, 500)]); }
function empName($id) { return (string)val('SELECT name FROM employees WHERE id=?', [(int)$id]); }
function userOut($u) { return ['id' => (int)$u['id'], 'user' => $u['username'], 'name' => $u['full_name'] ?: $u['username'], 'role' => $u['role'], 'perms' => $u['permset']]; }

/* حذف نهائي لعنصر من السلة */
function purge($type, $id) {
    if ($type === 'emp') {
        $nid = val('SELECT nid FROM employees WHERE id=? AND deleted_at IS NOT NULL', [$id]);
        if ($nid === null && !val('SELECT COUNT(*) FROM employees WHERE id=? AND deleted_at IS NOT NULL', [$id])) return;
        q('DELETE FROM emp_sites WHERE emp_id=?', [$id]); q('DELETE FROM attendance WHERE emp_id=?', [$id]);
        if ($nid) { q('DELETE FROM photos WHERE nid=?', [$nid]); q('DELETE FROM files WHERE nid=?', [$nid]); }
        q('DELETE FROM employees WHERE id=?', [$id]);
    } elseif ($type === 'att') q('DELETE FROM attendance WHERE id=? AND deleted_at IS NOT NULL', [$id]);
    elseif ($type === 'site') { if (q('DELETE FROM sites WHERE id=? AND deleted_at IS NOT NULL', [$id])->rowCount()) q('DELETE FROM emp_sites WHERE site_id=?', [$id]); }
    elseif ($type === 'shift') { if (q('DELETE FROM shifts WHERE id=? AND deleted_at IS NOT NULL', [$id])->rowCount()) q('UPDATE employees SET shift_id=NULL WHERE shift_id=?', [$id]); }
    elseif ($type === 'file') q('DELETE FROM files WHERE id=? AND deleted_at IS NOT NULL', [$id]);
}
function trashTitle($t, $id) {
    if ($t === 'emp') return 'موظف: ' . val('SELECT name FROM employees WHERE id=?', [$id]);
    if ($t === 'att') { $r = row('SELECT a.in_time, e.name FROM attendance a LEFT JOIN employees e ON e.id=a.emp_id WHERE a.id=?', [$id]); return $r ? 'حضور: ' . $r['name'] . ' — ' . $r['in_time'] : 'حضور'; }
    if ($t === 'site') return 'موقع: ' . val('SELECT name FROM sites WHERE id=?', [$id]);
    if ($t === 'shift') return 'وردية: ' . val('SELECT name FROM shifts WHERE id=?', [$id]);
    return 'ملف: ' . val('SELECT name FROM files WHERE id=?', [$id]);
}
const TRASH_T = ['emp' => 'employees', 'att' => 'attendance', 'site' => 'sites', 'shift' => 'shifts', 'file' => 'files'];

const EMP_F = ['name', 'dob', 'dob_h', 'nid', 'id_exp', 'job', 'card', 'card_exp', 'join_date', 'phone', 'email'];
function eligibleVal($v) { if ($v === null || $v === '' ) return null; return (int)!!$v; }

try {
migrate();
switch ($a) {

/* ================= الدخول والمستخدمون ================= */
case 'login':
    $u = row('SELECT * FROM admins WHERE username=?', [s('u')]);
    if (!$u || !password_verify(s('p'), $u['pass_hash'])) { usleep(700000); fail('اسم المستخدم أو كلمة المرور غير صحيحة', 401); }
    if (!(int)$u['active']) fail('هذا الحساب موقوف. تواصل مع المدير.', 403);
    session_regenerate_id(true);
    $_SESSION = ['uid' => (int)$u['id']];
    q('UPDATE admins SET last_login=? WHERE id=?', [now(), $u['id']]);
    logx('دخول');
    out(['ok' => 1, 'me' => userOut(me())]);
case 'logout': $_SESSION = []; session_destroy(); out(['ok' => 1]);
case 'me': $u = me(); out(['me' => $u ? userOut($u) : null, 'perms_def' => PERMS]);
case 'admin_pass':
    need(); $u = me();
    if (!password_verify(s('old'), $u['pass_hash'])) fail('كلمة المرور الحالية غير صحيحة');
    if (mb_strlen(s('new')) < 8) fail('كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف');
    q('UPDATE admins SET pass_hash=? WHERE id=?', [password_hash(s('new'), PASSWORD_DEFAULT), $u['id']]);
    logx('تغيير كلمة المرور');
    out(['ok' => 1]);
case 'users_list':
    need('admin');
    $U = rows('SELECT id, username, full_name, role, perms, active, last_login, created_at FROM admins ORDER BY id');
    foreach ($U as &$x) { $x['perms'] = json_decode($x['perms'] ?: '[]', true) ?: []; $x['active'] = (int)$x['active']; }
    out(['users' => $U, 'perms_def' => PERMS]);
case 'user_save':
    need('admin'); $id = (int)p('id', 0); $me = me();
    $user = s('username'); $role = s('role') === 'admin' ? 'admin' : 'user';
    $perms = array_values(array_intersect((array)p('perms', []), array_keys(PERMS)));
    $active = p('active', 1) ? 1 : 0; $pass = (string)p('password', '');
    if (!preg_match('/^[A-Za-z0-9_.\-]{3,40}$/', $user)) fail('اسم المستخدم: 3 أحرف إنجليزية أو أرقام على الأقل، بدون مسافات');
    if (val('SELECT COUNT(*) FROM admins WHERE username=? AND id<>?', [$user, $id])) fail('اسم المستخدم مستخدم من قبل');
    if ((!$id || $pass !== '') && mb_strlen($pass) < 8) fail('كلمة المرور 8 أحرف على الأقل');
    if ($id === (int)$me['id'] && ($role !== 'admin' || !$active)) fail('لا يمكنك إلغاء صلاحية المدير أو إيقاف حسابك أنت');
    if ($id) {
        q('UPDATE admins SET username=?, full_name=?, role=?, perms=?, active=? WHERE id=?', [$user, s('full_name'), $role, json_encode($perms), $active, $id]);
        if ($pass !== '') q('UPDATE admins SET pass_hash=? WHERE id=?', [password_hash($pass, PASSWORD_DEFAULT), $id]);
        logx('تعديل مستخدم', $user . ' — ' . ($role === 'admin' ? 'مدير' : count($perms) . ' صلاحيات') . ($active ? '' : ' — موقوف'));
    } else {
        q('INSERT INTO admins (username, pass_hash, created_at, role, perms, full_name, active) VALUES (?,?,?,?,?,?,?)', [$user, password_hash($pass, PASSWORD_DEFAULT), now(), $role, json_encode($perms), s('full_name'), $active]);
        logx('إضافة مستخدم', $user);
    }
    out(['ok' => 1]);
case 'user_delete':
    need('admin'); $id = (int)p('id');
    if ($id === (int)me()['id']) fail('لا يمكنك حذف حسابك');
    $u = row('SELECT * FROM admins WHERE id=?', [$id]); if (!$u) fail('المستخدم غير موجود');
    if ($u['role'] === 'admin' && (int)val("SELECT COUNT(*) FROM admins WHERE role='admin' AND active=1 AND id<>?", [$id]) < 1) fail('يجب أن يبقى مدير واحد على الأقل');
    q('DELETE FROM admins WHERE id=?', [$id]); logx('حذف مستخدم', $u['username']);
    out(['ok' => 1]);
case 'logs_list':
    need('admin');
    $from = isDate(s('from')) ? s('from') : date('Y-m-d', strtotime('-30 days')); $to = isDate(s('to')) ? s('to') : date('Y-m-d');
    out(['rows' => rows('SELECT * FROM logs WHERE at BETWEEN ? AND ? ORDER BY id DESC LIMIT 2000', [$from . ' 00:00:00', $to . ' 23:59:59'])]);

/* ================= الموظفون ================= */
case 'emps_list':
    needAny(['emps_view', 'att_view', 'att_edit', 'setup']);
    $E = rows('SELECT id, ord, name, dob, dob_h, nid, id_exp, job, card, card_exp, join_date, phone, email, eligible, shift_id, act_code, device_at, left_at, left_reason, CASE WHEN device_hash IS NULL THEN 0 ELSE 1 END AS bound FROM employees WHERE deleted_at IS NULL ORDER BY ord, id');
    $ph = array_flip(array_map('strval', array_column(rows('SELECT nid FROM photos'), 'nid')));
    $fc = []; foreach (rows('SELECT nid, kind, COUNT(*) c FROM files WHERE deleted_at IS NULL GROUP BY nid, kind') as $r) $fc[$r['nid']][$r['kind']] = (int)$r['c'];
    $es = [];
    foreach (rows('SELECT emp_id, site_id FROM emp_sites') as $r) $es[$r['emp_id']][] = (int)$r['site_id'];
    foreach ($E as &$e) {
        $e['photo'] = isset($ph[(string)$e['nid']]) ? 1 : 0;
        $e['files'] = isset($fc[(string)$e['nid']]) ? $fc[(string)$e['nid']] : new stdClass();
        $e['sites'] = isset($es[$e['id']]) ? $es[$e['id']] : [];
    }
    out(['emps' => $E]);
case 'emp_save':
    need('emps_edit');
    $v = []; foreach (EMP_F as $k) $v[$k] = nul(s($k));
    if (!$v['name']) fail('الاسم مطلوب');
    $v['eligible'] = eligibleVal(p('eligible'));
    $v['shift_id'] = nul(p('shift_id')) === null ? null : (int)p('shift_id');
    if ($v['nid'] && val('SELECT COUNT(*) FROM employees WHERE nid=? AND id<>? AND deleted_at IS NULL', [$v['nid'], (int)p('id', 0)])) fail('رقم الهوية مسجّل لموظف آخر');
    db()->beginTransaction();
    if ($id = (int)p('id', 0)) {
        $old = val('SELECT nid FROM employees WHERE id=?', [$id]);
        q('UPDATE employees SET ' . implode(',', array_map(function ($k) { return "$k=?"; }, array_keys($v))) . ' WHERE id=?', array_merge(array_values($v), [$id]));
        if ($old && $v['nid'] && $old !== $v['nid']) { q('UPDATE photos SET nid=? WHERE nid=?', [$v['nid'], $old]); q('UPDATE files SET nid=? WHERE nid=?', [$v['nid'], $old]); }
        logx('تعديل موظف', $v['name']);
    } else {
        $v['ord'] = (int)val('SELECT COALESCE(MIN(ord),0) FROM employees') - 1; // يظهر أول القائمة
        $v['created_at'] = now();
        q('INSERT INTO employees (' . implode(',', array_keys($v)) . ') VALUES (' . rtrim(str_repeat('?,', count($v)), ',') . ')', array_values($v));
        $id = (int)db()->lastInsertId();
        logx('إضافة موظف', $v['name']);
    }
    if (is_array(p('sites'))) {
        q('DELETE FROM emp_sites WHERE emp_id=?', [$id]);
        foreach (array_unique(array_map('intval', p('sites'))) as $sid) q('INSERT INTO emp_sites (emp_id, site_id) VALUES (?,?)', [$id, $sid]);
    }
    db()->commit();
    out(['ok' => 1, 'id' => $id]);
case 'emp_leave': // نقل إلى الموظفين السابقين
    need('emps_remove'); $id = (int)p('id');
    q('UPDATE employees SET left_at=?, left_reason=?, device_hash=NULL, act_code=NULL WHERE id=? AND deleted_at IS NULL', [now(), s('reason'), $id]);
    logx('نقل إلى السابقين', empName($id) . (s('reason') ? ' — ' . s('reason') : ''));
    out(['ok' => 1]);
case 'emp_return':
    need('emps_remove'); $id = (int)p('id');
    q('UPDATE employees SET left_at=NULL, left_reason=NULL WHERE id=?', [$id]);
    logx('إعادة موظف', empName($id));
    out(['ok' => 1]);
case 'emp_trash': // من السابقين إلى سلة المحذوفات
    $me = need(['emps_remove', 'trash']); $id = (int)p('id');
    if (!val('SELECT COUNT(*) FROM employees WHERE id=? AND left_at IS NOT NULL', [$id])) fail('انقل الموظف إلى السابقين أولًا');
    q('UPDATE employees SET deleted_at=?, deleted_by=? WHERE id=?', [now(), $me, $id]);
    logx('نقل موظف إلى السلة', empName($id));
    out(['ok' => 1]);
case 'emps_import':
    need(['emps_edit', 'import']); $list = p('list', []); if (!is_array($list)) fail('بيانات غير صالحة');
    $add = 0; $upd = 0;
    db()->beginTransaction();
    foreach ($list as $i => $e) {
        $v = []; foreach (EMP_F as $k) $v[$k] = nul(isset($e[$k]) ? trim((string)$e[$k]) : '');
        if (!$v['name']) continue;
        if (array_key_exists('eligible', $e)) $v['eligible'] = eligibleVal($e['eligible']);
        $id = $v['nid'] ? val('SELECT id FROM employees WHERE nid=? AND deleted_at IS NULL', [$v['nid']]) : val('SELECT id FROM employees WHERE name=? AND nid IS NULL AND deleted_at IS NULL', [$v['name']]);
        if ($id) { q('UPDATE employees SET ' . implode(',', array_map(function ($k) { return "$k=?"; }, array_keys($v))) . ', ord=? WHERE id=?', array_merge(array_values($v), [$i, $id])); $upd++; }
        else { $v['ord'] = $i; $v['created_at'] = now(); q('INSERT INTO employees (' . implode(',', array_keys($v)) . ') VALUES (' . rtrim(str_repeat('?,', count($v)), ',') . ')', array_values($v)); $add++; }
    }
    db()->commit();
    logx('استيراد موظفين', "أضيف $add وحُدّث $upd");
    out(['ok' => 1, 'added' => $add, 'updated' => $upd]);
case 'emp_code': // رمز تفعيل جوال جديد (يلغي الجوال المربوط)
    need('setup'); $code = (string)random_int(100000, 999999); $id = (int)p('id');
    q('UPDATE employees SET act_code=?, act_fail=0, device_hash=NULL, device_at=NULL WHERE id=? AND left_at IS NULL', [$code, $id]);
    logx('رمز تفعيل جوال', empName($id));
    out(['ok' => 1, 'code' => $code]);

/* ----- صورة الهوية + المستندات ----- */
case 'photo_get': need('docs'); out(['data' => val('SELECT data FROM photos WHERE nid=?', [s('nid')])]);
case 'photo_put':
    need('docs'); $d = s('data');
    if (!s('nid') || strpos($d, 'data:image/') !== 0 || strlen($d) > 8000000) fail('صورة غير صالحة');
    q('DELETE FROM photos WHERE nid=?', [s('nid')]); q('INSERT INTO photos (nid, data) VALUES (?,?)', [s('nid'), $d]);
    logx('رفع صورة هوية', s('nid'));
    out(['ok' => 1]);
case 'photo_del': // تنتقل إلى السلة كملف من نوع id
    $me = need('docs'); $d = val('SELECT data FROM photos WHERE nid=?', [s('nid')]);
    if ($d) { q('INSERT INTO files (nid, kind, name, mime, data, created_at, created_by, deleted_at, deleted_by) VALUES (?,?,?,?,?,?,?,?,?)', [s('nid'), 'id', 'صورة الهوية', substr($d, 5, strpos($d, ';') - 5), $d, now(), $me, now(), $me]); q('DELETE FROM photos WHERE nid=?', [s('nid')]); }
    logx('نقل صورة هوية إلى السلة', s('nid')); out(['ok' => 1]);
case 'file_list': need('docs'); out(['files' => rows('SELECT id, kind, name, mime, created_at, created_by FROM files WHERE nid=? AND deleted_at IS NULL ORDER BY id DESC', [s('nid')])]);
case 'file_get': need('docs'); $f = row('SELECT id, name, mime, data FROM files WHERE id=? AND deleted_at IS NULL', [(int)p('id')]); if (!$f) fail('الملف غير موجود'); out($f);
case 'file_put':
    $me = need('docs'); $d = s('data'); $kind = s('kind');
    if (!in_array($kind, ['personal', 'doc', 'meeting'], true)) fail('نوع غير صالح');
    if (!s('nid')) fail('أدخل رقم هوية الموظف أولًا');
    if (!preg_match('#^data:(image/(png|jpe?g|webp|gif)|application/pdf);base64,#', $d) || strlen($d) > 12000000) fail('الملف يجب أن يكون صورة أو PDF وحجمه أقل من 8 ميجابايت');
    if ($kind === 'personal') q('UPDATE files SET deleted_at=?, deleted_by=? WHERE nid=? AND kind=? AND deleted_at IS NULL', [now(), $me, s('nid'), 'personal']);
    q('INSERT INTO files (nid, kind, name, mime, data, created_at, created_by) VALUES (?,?,?,?,?,?,?)', [s('nid'), $kind, mb_substr(s('name'), 0, 200), substr($d, 5, strpos($d, ';') - 5), $d, now(), $me]);
    logx('رفع مستند', s('nid') . ' — ' . s('name'));
    out(['ok' => 1]);
case 'file_del':
    $me = need('docs'); $id = (int)p('id');
    q('UPDATE files SET deleted_at=?, deleted_by=? WHERE id=?', [now(), $me, $id]);
    logx('نقل مستند إلى السلة', (string)val('SELECT name FROM files WHERE id=?', [$id]));
    out(['ok' => 1]);

/* ----- المواقع ----- */
case 'sites_list': needAny(['setup', 'att_view', 'att_edit', 'emps_edit']); out(['sites' => rows('SELECT id, name, lat, lng, radius, allow_qr, allow_gps, kiosk_key FROM sites WHERE deleted_at IS NULL ORDER BY id')]);
case 'site_save':
    need('setup');
    if (!s('name')) fail('اسم الموقع مطلوب');
    $v = [s('name'), nul(s('lat')) === null ? null : (float)s('lat'), nul(s('lng')) === null ? null : (float)s('lng'), max(1, (int)p('radius', 50)), p('allow_qr') ? 1 : 0, p('allow_gps') ? 1 : 0];
    if ($v[5] && ($v[1] === null || $v[2] === null)) fail('حدد إحداثيات الموقع لتفعيل التسجيل بالموقع الجغرافي');
    if ($id = (int)p('id', 0)) q('UPDATE sites SET name=?, lat=?, lng=?, radius=?, allow_qr=?, allow_gps=? WHERE id=?', array_merge($v, [$id]));
    else q('INSERT INTO sites (name, lat, lng, radius, allow_qr, allow_gps, secret, kiosk_key) VALUES (?,?,?,?,?,?,?,?)', array_merge($v, [rnd(32), rnd(16)]));
    logx($id ? 'تعديل موقع' : 'إضافة موقع', s('name'));
    out(['ok' => 1]);
case 'site_delete':
    $me = need('setup'); $id = (int)p('id');
    q('UPDATE sites SET deleted_at=?, deleted_by=? WHERE id=?', [now(), $me, $id]);
    logx('نقل موقع إلى السلة', (string)val('SELECT name FROM sites WHERE id=?', [$id]));
    out(['ok' => 1]);
case 'site_rekey': // تغيير رابط شاشة الباركود (عند تسريبه)
    need('setup'); q('UPDATE sites SET kiosk_key=?, secret=? WHERE id=?', [rnd(16), rnd(32), (int)p('id')]); logx('تغيير رابط شاشة', (string)val('SELECT name FROM sites WHERE id=?', [(int)p('id')])); out(['ok' => 1]);
case 'sites_import':
    need(['setup', 'import']); $list = p('list', []); if (!is_array($list)) fail('بيانات غير صالحة');
    $add = 0; $upd = 0; $err = [];
    db()->beginTransaction();
    foreach ($list as $i => $x) {
        $name = trim((string)($x['name'] ?? '')); if ($name === '') continue;
        $lat = is_numeric($x['lat'] ?? null) ? (float)$x['lat'] : null; $lng = is_numeric($x['lng'] ?? null) ? (float)$x['lng'] : null;
        $gps = !empty($x['gps']) && $lat !== null && $lng !== null ? 1 : 0;
        $v = [$name, $lat, $lng, max(1, (int)($x['radius'] ?? 50) ?: 50), !empty($x['qr']) ? 1 : 0, $gps];
        if (!empty($x['gps']) && !$gps) $err[] = ['row' => $i + 2, 'msg' => "«{$name}»: لا توجد إحداثيات، فلم يُفعَّل التسجيل بالموقع"];
        if ($id = val('SELECT id FROM sites WHERE name=? AND deleted_at IS NULL', [$name])) { q('UPDATE sites SET name=?, lat=?, lng=?, radius=?, allow_qr=?, allow_gps=? WHERE id=?', array_merge($v, [$id])); $upd++; }
        else { q('INSERT INTO sites (name, lat, lng, radius, allow_qr, allow_gps, secret, kiosk_key) VALUES (?,?,?,?,?,?,?,?)', array_merge($v, [rnd(32), rnd(16)])); $add++; }
    }
    db()->commit(); logx('استيراد مواقع', "أضيف $add وحُدّث $upd");
    out(['ok' => 1, 'added' => $add, 'updated' => $upd, 'errors' => $err]);

/* ----- الورديات ----- */
case 'shifts_list': needAny(['setup', 'att_view', 'att_edit', 'emps_view', 'emps_edit']); out(['shifts' => rows('SELECT id, name, start_time, end_time, grace, off_days FROM shifts WHERE deleted_at IS NULL ORDER BY id')]);
case 'shift_save':
    need('setup');
    $re = '/^([01]\d|2[0-3]):[0-5]\d$/';
    if (!s('name') || !preg_match($re, s('start_time')) || !preg_match($re, s('end_time'))) fail('أدخل اسم الوردية ووقت البداية والنهاية');
    $off = implode(',', array_filter(array_map('intval', (array)p('off_days', [])), function ($d) { return $d >= 0 && $d <= 6; }));
    $v = [s('name'), s('start_time'), s('end_time'), max(0, (int)p('grace', 10)), $off];
    if ($id = (int)p('id', 0)) q('UPDATE shifts SET name=?, start_time=?, end_time=?, grace=?, off_days=? WHERE id=?', array_merge($v, [$id]));
    else q('INSERT INTO shifts (name, start_time, end_time, grace, off_days) VALUES (?,?,?,?,?)', $v);
    logx($id ? 'تعديل وردية' : 'إضافة وردية', s('name'));
    out(['ok' => 1]);
case 'shift_delete':
    $me = need('setup'); $id = (int)p('id');
    q('UPDATE shifts SET deleted_at=?, deleted_by=? WHERE id=?', [now(), $me, $id]);
    logx('نقل وردية إلى السلة', (string)val('SELECT name FROM shifts WHERE id=?', [$id]));
    out(['ok' => 1]);
case 'shifts_import':
    need(['setup', 'import']); $list = p('list', []); if (!is_array($list)) fail('بيانات غير صالحة');
    $re = '/^([01]\d|2[0-3]):[0-5]\d$/'; $add = 0; $upd = 0; $err = [];
    db()->beginTransaction();
    foreach ($list as $i => $x) {
        $name = trim((string)($x['name'] ?? '')); if ($name === '') continue;
        $st = (string)($x['start'] ?? ''); $en = (string)($x['end'] ?? '');
        if (!preg_match($re, $st) || !preg_match($re, $en)) { $err[] = ['row' => $i + 2, 'msg' => "«{$name}»: وقت البداية أو النهاية غير صحيح"]; continue; }
        $off = implode(',', array_unique(array_filter(array_map('intval', (array)($x['off'] ?? [])), function ($d) { return $d >= 0 && $d <= 6; })));
        $v = [$name, $st, $en, max(0, (int)($x['grace'] ?? 10)), $off];
        if ($id = val('SELECT id FROM shifts WHERE name=? AND deleted_at IS NULL', [$name])) { q('UPDATE shifts SET name=?, start_time=?, end_time=?, grace=?, off_days=? WHERE id=?', array_merge($v, [$id])); $upd++; }
        else { q('INSERT INTO shifts (name, start_time, end_time, grace, off_days) VALUES (?,?,?,?,?)', $v); $add++; }
    }
    db()->commit(); logx('استيراد ورديات', "أضيف $add وحُدّث $upd");
    out(['ok' => 1, 'added' => $add, 'updated' => $upd, 'errors' => $err]);

/* ----- الحضور ----- */
case 'att_list':
    needAny(['att_view', 'att_edit']);
    $from = isDate(s('from')) ? s('from') : date('Y-m-d');
    $to = isDate(s('to')) ? s('to') : $from;
    out(['rows' => rows('SELECT a.*, e.name, e.nid, e.shift_id, si.name AS in_site_name, so.name AS out_site_name FROM attendance a JOIN employees e ON e.id=a.emp_id LEFT JOIN sites si ON si.id=a.in_site LEFT JOIN sites so ON so.id=a.out_site WHERE a.deleted_at IS NULL AND e.deleted_at IS NULL AND a.work_date BETWEEN ? AND ? ORDER BY a.in_time DESC', [$from, $to])]);
case 'att_save': // إضافة/تعديل يدوي
    $me = need('att_edit');
    $re = '/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(:\d\d)?$/';
    $it = str_replace('T', ' ', s('in_time')); $ot = str_replace('T', ' ', s('out_time'));
    if (!preg_match($re, $it)) fail('وقت الحضور مطلوب');
    if ($ot !== '' && !preg_match($re, $ot)) fail('وقت الانصراف غير صحيح');
    if (strlen($it) === 16) $it .= ':00'; if (strlen($ot) === 16) $ot .= ':00';
    if ($ot !== '' && $ot <= $it) fail('وقت الانصراف يجب أن يكون بعد الحضور');
    $wd = substr($it, 0, 10);
    if ($id = (int)p('id', 0)) q("UPDATE attendance SET in_time=?, out_time=?, work_date=?, note=?, edited_by=?, out_method=CASE WHEN ? IS NULL THEN NULL WHEN out_method IS NULL THEN 'manual' ELSE out_method END WHERE id=?", [$it, nul($ot), $wd, s('note'), $me, nul($ot), $id]);
    else q("INSERT INTO attendance (emp_id, work_date, in_time, out_time, in_method, out_method, note, edited_by) VALUES (?,?,?,?, 'manual', ?, ?, ?)", [(int)p('emp_id'), $wd, $it, nul($ot), $ot === '' ? null : 'manual', s('note'), $me]);
    logx($id ? 'تعديل حضور' : 'تسجيل حضور يدوي', empName($id ? val('SELECT emp_id FROM attendance WHERE id=?', [$id]) : p('emp_id')) . ' — ' . $it);
    out(['ok' => 1]);
case 'att_delete':
    $me = need('att_edit'); $id = (int)p('id');
    q('UPDATE attendance SET deleted_at=?, deleted_by=? WHERE id=?', [now(), $me, $id]);
    $r = row('SELECT emp_id, in_time FROM attendance WHERE id=?', [$id]);
    logx('نقل سجل حضور إلى السلة', $r ? empName($r['emp_id']) . ' — ' . $r['in_time'] : '');
    out(['ok' => 1]);
case 'att_import':
    $me = need(['att_edit', 'import']); $list = p('list', []); if (!is_array($list)) fail('بيانات غير صالحة');
    $tm = '/^([01]?\d|2[0-3]):[0-5]\d$/'; $add = 0; $skip = 0; $err = [];
    $ids = []; foreach (rows('SELECT id, nid FROM employees WHERE deleted_at IS NULL AND nid IS NOT NULL') as $r) $ids[$r['nid']] = (int)$r['id'];
    db()->beginTransaction();
    foreach ($list as $i => $x) {
        $row = $i + 2; $nid = trim((string)($x['nid'] ?? '')); $d = (string)($x['date'] ?? ''); $ti = (string)($x['in'] ?? ''); $to = (string)($x['out'] ?? '');
        if ($nid === '' && $d === '' && $ti === '') continue;
        if (!isset($ids[$nid])) { $err[] = ['row' => $row, 'msg' => "رقم الهوية $nid غير موجود"]; continue; }
        if (!isDate($d)) { $err[] = ['row' => $row, 'msg' => 'التاريخ غير صحيح']; continue; }
        if (!preg_match($tm, $ti)) { $err[] = ['row' => $row, 'msg' => 'وقت الحضور غير صحيح']; continue; }
        if ($to !== '' && !preg_match($tm, $to)) { $err[] = ['row' => $row, 'msg' => 'وقت الانصراف غير صحيح']; continue; }
        $it = $d . ' ' . str_pad($ti, 5, '0', STR_PAD_LEFT) . ':00';
        $ot = $to === '' ? null : $d . ' ' . str_pad($to, 5, '0', STR_PAD_LEFT) . ':00';
        if ($ot !== null && $ot <= $it) $ot = date('Y-m-d H:i:s', strtotime($ot . ' +1 day')); // وردية ليلية
        if (val('SELECT COUNT(*) FROM attendance WHERE emp_id=? AND in_time=? AND deleted_at IS NULL', [$ids[$nid], $it])) { $skip++; continue; }
        q("INSERT INTO attendance (emp_id, work_date, in_time, out_time, in_method, out_method, note, edited_by) VALUES (?,?,?,?, 'import', ?, ?, ?)", [$ids[$nid], $d, $it, $ot, $ot ? 'import' : null, mb_substr((string)($x['note'] ?? ''), 0, 255), $me]);
        $add++;
    }
    db()->commit();
    logx('استيراد حضور', "أضيف {$add}، مكرر {$skip}، أخطاء " . count($err));
    out(['ok' => 1, 'added' => $add, 'skipped' => $skip, 'errors' => array_slice($err, 0, 100)]);

case 'report':
    needAny(['att_view', 'att_edit']);
    $m = preg_match('/^\d{4}-\d\d$/', s('month')) ? s('month') : date('Y-m');
    $first = $m . '-01'; $last = date('Y-m-t', strtotime($first)); $today = date('Y-m-d');
    $end = $last < $today ? $last : $today;
    $shifts = []; foreach (rows('SELECT * FROM shifts WHERE deleted_at IS NULL') as $sh) $shifts[$sh['id']] = $sh;
    $att = [];
    foreach (rows('SELECT * FROM attendance WHERE deleted_at IS NULL AND work_date BETWEEN ? AND ? ORDER BY in_time', [$first, $last]) as $r) $att[$r['emp_id']][$r['work_date']][] = $r;
    $res = [];
    foreach (rows('SELECT id, name, nid, job, shift_id, join_date, left_at FROM employees WHERE deleted_at IS NULL AND (left_at IS NULL OR left_at >= ?) ORDER BY ord, id', [$first]) as $e) {
        $sh = isset($shifts[$e['shift_id']]) ? $shifts[$e['shift_id']] : null;
        $off = $sh ? array_map('intval', array_filter(explode(',', $sh['off_days']), 'strlen')) : [];
        $leftD = $e['left_at'] ? substr($e['left_at'], 0, 10) : null;
        $t = ['present' => 0, 'absent' => $sh ? 0 : null, 'late' => 0, 'early' => 0, 'over' => 0, 'mins' => 0, 'open' => 0, 'days' => []];
        for ($d = $first; $d <= $end; $d = date('Y-m-d', strtotime($d . ' +1 day'))) {
            $recs = isset($att[$e['id']][$d]) ? $att[$e['id']][$d] : [];
            $isOff = $sh && in_array((int)date('w', strtotime($d)), $off, true);
            if (!$recs) {
                if ($sh && !$isOff && $d < $today && (!$e['join_date'] || $d >= $e['join_date']) && (!$leftD || $d < $leftD)) { $t['absent']++; $t['days'][$d] = 'A'; }
                continue;
            }
            $t['present']++; $t['days'][$d] = 'P';
            $in = strtotime($recs[0]['in_time']); $outs = array_filter(array_column($recs, 'out_time'));
            $out = $outs ? strtotime(max($outs)) : null;
            foreach ($recs as $r) { if ($r['out_time']) $t['mins'] += (strtotime($r['out_time']) - strtotime($r['in_time'])) / 60; else $t['open']++; }
            if ($sh) {
                $s0 = strtotime("$d {$sh['start_time']}"); $e0 = strtotime("$d {$sh['end_time']}");
                if ($e0 <= $s0) $e0 += 86400; // وردية ليلية
                if ($isOff) { if ($out) $t['over'] += ($out - $in) / 60; continue; }
                if ($in > $s0 + $sh['grace'] * 60) $t['late'] += ($in - $s0) / 60;
                if ($out && $out < $e0) $t['early'] += ($e0 - $out) / 60;
                if ($out && $out > $e0) $t['over'] += ($out - $e0) / 60;
            }
        }
        foreach (['late', 'early', 'over', 'mins'] as $k) $t[$k] = (int)round($t[$k]);
        $res[] = array_merge($e, $t, ['shift' => $sh ? $sh['name'] : null]);
    }
    out(['month' => $m, 'from' => $first, 'to' => $last, 'rows' => $res]);

/* ================= سلة المحذوفات ================= */
case 'trash_list':
    need('trash'); $L = [];
    foreach (rows('SELECT id, name, nid, left_reason, deleted_at, deleted_by FROM employees WHERE deleted_at IS NOT NULL') as $r) $L[] = ['type' => 'emp', 'id' => (int)$r['id'], 'title' => $r['name'], 'sub' => trim(($r['nid'] ?: '') . ($r['left_reason'] ? ' — ' . $r['left_reason'] : '')), 'at' => $r['deleted_at'], 'by' => $r['deleted_by']];
    foreach (rows('SELECT a.id, a.in_time, a.out_time, a.deleted_at, a.deleted_by, e.name FROM attendance a LEFT JOIN employees e ON e.id=a.emp_id WHERE a.deleted_at IS NOT NULL') as $r) $L[] = ['type' => 'att', 'id' => (int)$r['id'], 'title' => $r['name'] ?: '—', 'sub' => $r['in_time'] . ($r['out_time'] ? ' ← ' . substr($r['out_time'], 11, 5) : ''), 'at' => $r['deleted_at'], 'by' => $r['deleted_by']];
    foreach (rows('SELECT id, name, deleted_at, deleted_by FROM sites WHERE deleted_at IS NOT NULL') as $r) $L[] = ['type' => 'site', 'id' => (int)$r['id'], 'title' => $r['name'], 'sub' => '', 'at' => $r['deleted_at'], 'by' => $r['deleted_by']];
    foreach (rows('SELECT id, name, start_time, end_time, deleted_at, deleted_by FROM shifts WHERE deleted_at IS NOT NULL') as $r) $L[] = ['type' => 'shift', 'id' => (int)$r['id'], 'title' => $r['name'], 'sub' => $r['start_time'] . ' – ' . $r['end_time'], 'at' => $r['deleted_at'], 'by' => $r['deleted_by']];
    foreach (rows('SELECT f.id, f.name, f.kind, f.nid, f.deleted_at, f.deleted_by, e.name AS ename FROM files f LEFT JOIN employees e ON e.nid=f.nid WHERE f.deleted_at IS NOT NULL') as $r) $L[] = ['type' => 'file', 'id' => (int)$r['id'], 'title' => $r['name'] ?: 'ملف', 'sub' => ($r['ename'] ?: $r['nid']), 'at' => $r['deleted_at'], 'by' => $r['deleted_by']];
    usort($L, function ($x, $y) { return strcmp($y['at'], $x['at']); });
    out(['rows' => $L]);
case 'trash_restore':
    need('trash'); $t = s('type'); $id = (int)p('id');
    if (!array_key_exists($t, TRASH_T)) fail('نوع غير صالح');
    $title = trashTitle($t, $id);
    $f = $t === 'file' ? row('SELECT nid, kind, data FROM files WHERE id=?', [$id]) : null;
    if ($f && $f['kind'] === 'id') { q('DELETE FROM photos WHERE nid=?', [$f['nid']]); q('INSERT INTO photos (nid, data) VALUES (?,?)', [$f['nid'], $f['data']]); q('DELETE FROM files WHERE id=?', [$id]); }
    else q('UPDATE ' . TRASH_T[$t] . ' SET deleted_at=NULL, deleted_by=NULL WHERE id=?', [$id]);
    logx('استرجاع من السلة', $title);
    out(['ok' => 1]);
case 'trash_purge':
    need('admin'); $t = s('type'); $id = (int)p('id');
    if (!array_key_exists($t, TRASH_T)) fail('نوع غير صالح');
    $title = trashTitle($t, $id);
    db()->beginTransaction(); purge($t, $id); db()->commit();
    logx('حذف نهائي', $title);
    out(['ok' => 1]);
case 'trash_empty':
    need('admin'); $n = 0;
    db()->beginTransaction();
    foreach (TRASH_T as $t => $tbl) foreach (array_column(rows("SELECT id FROM $tbl WHERE deleted_at IS NOT NULL"), 'id') as $id) { purge($t, (int)$id); $n++; }
    db()->commit();
    logx('إفراغ السلة', "$n عنصر");
    out(['ok' => 1, 'n' => $n]);

/* ================= شاشة الباركود ================= */
case 'kiosk_token':
    $site = row('SELECT * FROM sites WHERE id=? AND deleted_at IS NULL', [(int)p('site')]);
    if (!$site || !hash_equals($site['kiosk_key'], s('k'))) fail('رابط الشاشة غير صالح', 403);
    if (!$site['allow_qr']) fail('التسجيل بالباركود غير مفعّل لهذا الموقع', 403);
    $w = intdiv(time(), QR_STEP);
    out(['site' => $site['name'], 'site_id' => (int)$site['id'], 'token' => qr_token($site, $w), 'left' => QR_STEP - time() % QR_STEP, 'now' => now()]);

/* ================= جوال الموظف ================= */
case 'emp_activate':
    $e = row('SELECT * FROM employees WHERE nid=? AND left_at IS NULL AND deleted_at IS NULL', [s('nid')]);
    if (!$e || !$e['act_code']) { usleep(800000); fail('لا يوجد رمز تفعيل لهذا الرقم. اطلب رمزًا من الإدارة.'); }
    if ($e['act_fail'] >= 5) fail('تم إيقاف التفعيل بعد محاولات خاطئة. اطلب رمزًا جديدًا من الإدارة.');
    if (!hash_equals($e['act_code'], s('code'))) { q('UPDATE employees SET act_fail=act_fail+1 WHERE id=?', [$e['id']]); usleep(800000); fail('رمز التفعيل غير صحيح'); }
    $key = rnd(32);
    q('UPDATE employees SET device_hash=?, device_at=?, act_code=NULL, act_fail=0 WHERE id=?', [hash('sha256', $key), now(), $e['id']]);
    out(['ok' => 1, 'key' => $key, 'name' => $e['name']]);

case 'emp_status':
case 'emp_punch':
    $e = row('SELECT * FROM employees WHERE device_hash=? AND left_at IS NULL AND deleted_at IS NULL', [hash('sha256', s('key'))]);
    if (!$e) fail('هذا الجوال غير مربوط بأي موظف. فعّله برمز من الإدارة.', 403);
    $allowed = array_map('intval', array_column(rows('SELECT site_id FROM emp_sites WHERE emp_id=?', [$e['id']]), 'site_id'));
    $sites = rows('SELECT * FROM sites WHERE deleted_at IS NULL');
    if ($allowed) $sites = array_values(array_filter($sites, function ($x) use ($allowed) { return in_array((int)$x['id'], $allowed, true); }));
    $open = row('SELECT * FROM attendance WHERE emp_id=? AND out_time IS NULL AND deleted_at IS NULL AND in_time>=? ORDER BY in_time DESC', [$e['id'], date('Y-m-d H:i:s', time() - 20 * 3600)]);
    if ($a === 'emp_status') {
        $sh = $e['shift_id'] ? row('SELECT name, start_time, end_time FROM shifts WHERE id=? AND deleted_at IS NULL', [$e['shift_id']]) : null;
        $today = rows('SELECT in_time, out_time FROM attendance WHERE emp_id=? AND work_date=? AND deleted_at IS NULL ORDER BY in_time', [$e['id'], date('Y-m-d')]);
        out(['name' => $e['name'], 'shift' => $sh, 'open' => $open ? $open['in_time'] : null, 'today' => $today,
             'gps' => count(array_filter($sites, function ($x) { return $x['allow_gps'] && $x['lat'] !== null; })) > 0,
             'qr' => count(array_filter($sites, function ($x) { return $x['allow_qr']; })) > 0, 'now' => now()]);
    }
    // ---- تسجيل ----
    $last = val('SELECT MAX(t) FROM (SELECT in_time AS t FROM attendance WHERE emp_id=? AND deleted_at IS NULL UNION ALL SELECT out_time FROM attendance WHERE emp_id=? AND deleted_at IS NULL) x', [$e['id'], $e['id']]);
    if ($last && time() - strtotime($last) < 120) fail('تم تسجيلك قبل أقل من دقيقتين.');
    $lat = is_numeric(p('lat')) ? (float)p('lat') : null; $lng = is_numeric(p('lng')) ? (float)p('lng') : null; $acc = is_numeric(p('acc')) ? (float)p('acc') : null;
    $site = null; $method = null;
    if (s('token') !== '') {
        foreach ($sites as $x) if ((int)$x['id'] === (int)p('site') && $x['allow_qr']) $site = $x;
        if (!$site) fail('هذا الباركود لموقع غير مسموح لك.');
        if (!qr_valid($site, s('token'))) fail('انتهت صلاحية الباركود. امسح الباركود الظاهر على الشاشة الآن.');
        $method = 'qr';
    } else {
        if ($lat === null || $lng === null) fail('لم يتم تحديد موقعك. فعّل خدمة الموقع وأعد المحاولة.');
        if ($acc !== null && $acc > 100) fail('دقة الموقع ضعيفة (' . round($acc) . ' م). اقترب من مكان مفتوح وأعد المحاولة.');
        $best = null; $bd = INF;
        foreach ($sites as $x) if ($x['allow_gps'] && $x['lat'] !== null) { $d = dist_m($lat, $lng, (float)$x['lat'], (float)$x['lng']); if ($d < $bd) { $bd = $d; $best = $x; } }
        if (!$best) fail('لا يوجد موقع مفعّل للتسجيل بالموقع الجغرافي.');
        $tol = (int)$best['radius'] + min($acc === null ? 0 : $acc, 25); // هامش لدقة GPS حتى 25 متر
        if ($bd > $tol) fail('أنت خارج نطاق «' . $best['name'] . '» — المسافة ' . round($bd) . ' م والمسموح ' . $best['radius'] . ' م.');
        $site = $best; $method = 'gps';
    }
    if ($open) {
        q('UPDATE attendance SET out_time=?, out_site=?, out_method=?, out_lat=?, out_lng=?, out_acc=? WHERE id=?', [now(), $site['id'], $method, $lat, $lng, $acc, $open['id']]);
        out(['ok' => 1, 'type' => 'out', 'time' => now(), 'site' => $site['name']]);
    }
    q('INSERT INTO attendance (emp_id, work_date, in_time, in_site, in_method, in_lat, in_lng, in_acc) VALUES (?,?,?,?,?,?,?,?)', [$e['id'], date('Y-m-d'), now(), $site['id'], $method, $lat, $lng, $acc]);
    out(['ok' => 1, 'type' => 'in', 'time' => now(), 'site' => $site['name']]);

default: fail('unknown action', 404);
}
} catch (Throwable $ex) {
    if (db()->inTransaction()) db()->rollBack();
    error_log($ex);
    fail('خطأ في الخادم. حاول مرة أخرى، وإن تكرر أبلغ المدير.', 500);
}

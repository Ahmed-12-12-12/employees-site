<?php
/* واجهة برمجية واحدة: api.php?a=ACTION  (POST JSON) */
define('APP', 1);
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
function admin() { if (empty($_SESSION['admin'])) fail('يجب تسجيل الدخول', 401); return $_SESSION['admin']; }

try {
switch ($a) {

/* ================= المدير ================= */
case 'login':
    $u = row('SELECT * FROM admins WHERE username=?', [s('u')]);
    if (!$u || !password_verify(s('p'), $u['pass_hash'])) { usleep(700000); fail('اسم المستخدم أو كلمة المرور غير صحيحة', 401); }
    session_regenerate_id(true);
    $_SESSION['admin'] = $u['username'];
    out(['ok' => 1, 'user' => $u['username']]);
case 'logout': $_SESSION = []; session_destroy(); out(['ok' => 1]);
case 'me': out(['user' => empty($_SESSION['admin']) ? null : $_SESSION['admin']]);
case 'admin_pass':
    $me = admin(); $u = row('SELECT * FROM admins WHERE username=?', [$me]);
    if (!password_verify(s('old'), $u['pass_hash'])) fail('كلمة المرور الحالية غير صحيحة');
    if (mb_strlen(s('new')) < 8) fail('كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف');
    q('UPDATE admins SET pass_hash=? WHERE id=?', [password_hash(s('new'), PASSWORD_DEFAULT), $u['id']]);
    out(['ok' => 1]);
case 'admin_add':
    admin();
    if (mb_strlen(s('u')) < 3 || mb_strlen(s('p')) < 8) fail('اسم المستخدم 3 أحرف على الأقل وكلمة المرور 8 على الأقل');
    if (val('SELECT COUNT(*) FROM admins WHERE username=?', [s('u')])) fail('اسم المستخدم موجود');
    q('INSERT INTO admins (username, pass_hash, created_at) VALUES (?,?,?)', [s('u'), password_hash(s('p'), PASSWORD_DEFAULT), now()]);
    out(['ok' => 1]);

/* ----- الموظفون ----- */
case 'emps_list':
    admin();
    $E = rows('SELECT id, ord, name, dob, dob_h, nid, id_exp, job, card, card_exp, join_date, phone, email, shift_id, act_code, device_at, CASE WHEN device_hash IS NULL THEN 0 ELSE 1 END AS bound FROM employees ORDER BY ord, id');
    $ph = array_flip(array_map('strval', array_column(rows('SELECT nid FROM photos'), 'nid')));
    $es = [];
    foreach (rows('SELECT emp_id, site_id FROM emp_sites') as $r) $es[$r['emp_id']][] = (int)$r['site_id'];
    foreach ($E as &$e) { $e['photo'] = isset($ph[(string)$e['nid']]) ? 1 : 0; $e['sites'] = isset($es[$e['id']]) ? $es[$e['id']] : []; }
    out(['emps' => $E]);
case 'emp_save':
    admin();
    $f = ['name', 'dob', 'dob_h', 'nid', 'id_exp', 'job', 'card', 'card_exp', 'join_date', 'phone', 'email'];
    $v = []; foreach ($f as $k) $v[$k] = nul(s($k));
    if (!$v['name']) fail('الاسم مطلوب');
    $v['shift_id'] = nul(p('shift_id')) === null ? null : (int)p('shift_id');
    if ($v['nid'] && val('SELECT COUNT(*) FROM employees WHERE nid=? AND id<>?', [$v['nid'], (int)p('id', 0)])) fail('رقم الهوية مسجّل لموظف آخر');
    db()->beginTransaction();
    if ($id = (int)p('id', 0)) {
        $old = val('SELECT nid FROM employees WHERE id=?', [$id]);
        q('UPDATE employees SET ' . implode(',', array_map(function ($k) { return "$k=?"; }, array_keys($v))) . ' WHERE id=?', array_merge(array_values($v), [$id]));
        if ($old && $v['nid'] && $old !== $v['nid']) q('UPDATE photos SET nid=? WHERE nid=?', [$v['nid'], $old]);
    } else {
        $v['ord'] = (int)val('SELECT COALESCE(MIN(ord),0) FROM employees') - 1;
        $v['created_at'] = now();
        q('INSERT INTO employees (' . implode(',', array_keys($v)) . ') VALUES (' . rtrim(str_repeat('?,', count($v)), ',') . ')', array_values($v));
        $id = (int)db()->lastInsertId();
    }
    if (is_array(p('sites'))) {
        q('DELETE FROM emp_sites WHERE emp_id=?', [$id]);
        foreach (array_unique(array_map('intval', p('sites'))) as $sid) q('INSERT INTO emp_sites (emp_id, site_id) VALUES (?,?)', [$id, $sid]);
    }
    db()->commit();
    out(['ok' => 1, 'id' => $id]);
case 'emp_delete':
    admin(); $id = (int)p('id');
    db()->beginTransaction();
    q('DELETE FROM emp_sites WHERE emp_id=?', [$id]);
    q('DELETE FROM attendance WHERE emp_id=?', [$id]);
    q('DELETE FROM employees WHERE id=?', [$id]);
    db()->commit();
    out(['ok' => 1]);
case 'emps_import':
    admin(); $list = p('list', []); if (!is_array($list)) fail('بيانات غير صالحة');
    $f = ['name', 'dob', 'dob_h', 'nid', 'id_exp', 'job', 'card', 'card_exp', 'join_date', 'phone', 'email'];
    $add = 0; $upd = 0; $ord = count($list);
    db()->beginTransaction();
    foreach ($list as $i => $e) {
        $v = []; foreach ($f as $k) $v[$k] = nul(isset($e[$k]) ? trim((string)$e[$k]) : '');
        if (!$v['name']) continue;
        $id = $v['nid'] ? val('SELECT id FROM employees WHERE nid=?', [$v['nid']]) : val('SELECT id FROM employees WHERE name=? AND nid IS NULL', [$v['name']]);
        if ($id) { q('UPDATE employees SET ' . implode(',', array_map(function ($k) { return "$k=?"; }, $f)) . ', ord=? WHERE id=?', array_merge(array_values($v), [$i, $id])); $upd++; }
        else { $v['ord'] = $i; $v['created_at'] = now(); q('INSERT INTO employees (' . implode(',', array_keys($v)) . ') VALUES (' . rtrim(str_repeat('?,', count($v)), ',') . ')', array_values($v)); $add++; }
    }
    db()->commit();
    out(['ok' => 1, 'added' => $add, 'updated' => $upd]);
case 'emp_code': // رمز تفعيل جوال جديد (يلغي الجوال المربوط)
    admin(); $code = (string)random_int(100000, 999999);
    q('UPDATE employees SET act_code=?, act_fail=0, device_hash=NULL, device_at=NULL WHERE id=?', [$code, (int)p('id')]);
    out(['ok' => 1, 'code' => $code]);

/* ----- صور الهوية ----- */
case 'photo_get': admin(); out(['data' => val('SELECT data FROM photos WHERE nid=?', [s('nid')])]);
case 'photo_put':
    admin(); $d = s('data');
    if (!s('nid') || strpos($d, 'data:image/') !== 0 || strlen($d) > 8000000) fail('صورة غير صالحة');
    q('DELETE FROM photos WHERE nid=?', [s('nid')]); q('INSERT INTO photos (nid, data) VALUES (?,?)', [s('nid'), $d]);
    out(['ok' => 1]);
case 'photo_del': admin(); q('DELETE FROM photos WHERE nid=?', [s('nid')]); out(['ok' => 1]);

/* ----- المواقع ----- */
case 'sites_list': admin(); out(['sites' => rows('SELECT id, name, lat, lng, radius, allow_qr, allow_gps, kiosk_key FROM sites ORDER BY id')]);
case 'site_save':
    admin();
    if (!s('name')) fail('اسم الموقع مطلوب');
    $v = [s('name'), nul(s('lat')) === null ? null : (float)s('lat'), nul(s('lng')) === null ? null : (float)s('lng'), max(1, (int)p('radius', 50)), p('allow_qr') ? 1 : 0, p('allow_gps') ? 1 : 0];
    if ($v[5] && ($v[1] === null || $v[2] === null)) fail('حدد إحداثيات الموقع لتفعيل التسجيل بالموقع الجغرافي');
    if ($id = (int)p('id', 0)) q('UPDATE sites SET name=?, lat=?, lng=?, radius=?, allow_qr=?, allow_gps=? WHERE id=?', array_merge($v, [$id]));
    else q('INSERT INTO sites (name, lat, lng, radius, allow_qr, allow_gps, secret, kiosk_key) VALUES (?,?,?,?,?,?,?,?)', array_merge($v, [rnd(32), rnd(16)]));
    out(['ok' => 1]);
case 'site_delete':
    admin(); $id = (int)p('id');
    q('DELETE FROM emp_sites WHERE site_id=?', [$id]); q('DELETE FROM sites WHERE id=?', [$id]);
    out(['ok' => 1]);
case 'site_rekey': // تغيير رابط شاشة الباركود (عند تسريبه)
    admin(); q('UPDATE sites SET kiosk_key=?, secret=? WHERE id=?', [rnd(16), rnd(32), (int)p('id')]); out(['ok' => 1]);

/* ----- الورديات ----- */
case 'shifts_list': admin(); out(['shifts' => rows('SELECT * FROM shifts ORDER BY id')]);
case 'shift_save':
    admin();
    $re = '/^([01]\d|2[0-3]):[0-5]\d$/';
    if (!s('name') || !preg_match($re, s('start_time')) || !preg_match($re, s('end_time'))) fail('أدخل اسم الوردية ووقت البداية والنهاية');
    $off = implode(',', array_filter(array_map('intval', (array)p('off_days', [])), function ($d) { return $d >= 0 && $d <= 6; }));
    $v = [s('name'), s('start_time'), s('end_time'), max(0, (int)p('grace', 10)), $off];
    if ($id = (int)p('id', 0)) q('UPDATE shifts SET name=?, start_time=?, end_time=?, grace=?, off_days=? WHERE id=?', array_merge($v, [$id]));
    else q('INSERT INTO shifts (name, start_time, end_time, grace, off_days) VALUES (?,?,?,?,?)', $v);
    out(['ok' => 1]);
case 'shift_delete': admin(); $id = (int)p('id'); q('UPDATE employees SET shift_id=NULL WHERE shift_id=?', [$id]); q('DELETE FROM shifts WHERE id=?', [$id]); out(['ok' => 1]);

/* ----- الحضور ----- */
case 'att_list':
    admin();
    $from = preg_match('/^\d{4}-\d\d-\d\d$/', s('from')) ? s('from') : date('Y-m-d');
    $to = preg_match('/^\d{4}-\d\d-\d\d$/', s('to')) ? s('to') : $from;
    out(['rows' => rows('SELECT a.*, e.name, e.nid, e.shift_id, si.name AS in_site_name, so.name AS out_site_name FROM attendance a JOIN employees e ON e.id=a.emp_id LEFT JOIN sites si ON si.id=a.in_site LEFT JOIN sites so ON so.id=a.out_site WHERE a.work_date BETWEEN ? AND ? ORDER BY a.in_time DESC', [$from, $to])]);
case 'att_save': // إضافة/تعديل يدوي من المدير
    $me = admin();
    $re = '/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(:\d\d)?$/';
    $it = str_replace('T', ' ', s('in_time')); $ot = str_replace('T', ' ', s('out_time'));
    if (!preg_match($re, $it)) fail('وقت الحضور مطلوب');
    if ($ot !== '' && !preg_match($re, $ot)) fail('وقت الانصراف غير صحيح');
    if (strlen($it) === 16) $it .= ':00'; if (strlen($ot) === 16) $ot .= ':00';
    if ($ot !== '' && $ot <= $it) fail('وقت الانصراف يجب أن يكون بعد الحضور');
    $wd = substr($it, 0, 10);
    if ($id = (int)p('id', 0)) q("UPDATE attendance SET in_time=?, out_time=?, work_date=?, note=?, edited_by=?, out_method=CASE WHEN ? IS NULL THEN NULL WHEN out_method IS NULL THEN 'manual' ELSE out_method END WHERE id=?", [$it, nul($ot), $wd, s('note'), $me, nul($ot), $id]);
    else q("INSERT INTO attendance (emp_id, work_date, in_time, out_time, in_method, out_method, note, edited_by) VALUES (?,?,?,?, 'manual', ?, ?, ?)", [(int)p('emp_id'), $wd, $it, nul($ot), $ot === '' ? null : 'manual', s('note'), $me]);
    out(['ok' => 1]);
case 'att_delete': admin(); q('DELETE FROM attendance WHERE id=?', [(int)p('id')]); out(['ok' => 1]);

case 'report':
    admin();
    $m = preg_match('/^\d{4}-\d\d$/', s('month')) ? s('month') : date('Y-m');
    $first = $m . '-01'; $last = date('Y-m-t', strtotime($first)); $today = date('Y-m-d');
    $end = $last < $today ? $last : $today;
    $shifts = []; foreach (rows('SELECT * FROM shifts') as $sh) $shifts[$sh['id']] = $sh;
    $att = [];
    foreach (rows('SELECT * FROM attendance WHERE work_date BETWEEN ? AND ? ORDER BY in_time', [$first, $last]) as $r) $att[$r['emp_id']][$r['work_date']][] = $r;
    $res = [];
    foreach (rows('SELECT id, name, nid, job, shift_id, join_date FROM employees ORDER BY ord, id') as $e) {
        $sh = isset($shifts[$e['shift_id']]) ? $shifts[$e['shift_id']] : null;
        $off = $sh ? array_map('intval', array_filter(explode(',', $sh['off_days']), 'strlen')) : [];
        $t = ['present' => 0, 'absent' => $sh ? 0 : null, 'late' => 0, 'early' => 0, 'over' => 0, 'mins' => 0, 'open' => 0, 'days' => []];
        for ($d = $first; $d <= $end; $d = date('Y-m-d', strtotime($d . ' +1 day'))) {
            $recs = isset($att[$e['id']][$d]) ? $att[$e['id']][$d] : [];
            $isOff = $sh && in_array((int)date('w', strtotime($d)), $off, true);
            if (!$recs) {
                if ($sh && !$isOff && $d < $today && (!$e['join_date'] || $d >= $e['join_date'])) { $t['absent']++; $t['days'][$d] = 'A'; }
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

/* ================= شاشة الباركود ================= */
case 'kiosk_token':
    $site = row('SELECT * FROM sites WHERE id=?', [(int)p('site')]);
    if (!$site || !hash_equals($site['kiosk_key'], s('k'))) fail('رابط الشاشة غير صالح', 403);
    if (!$site['allow_qr']) fail('التسجيل بالباركود غير مفعّل لهذا الموقع', 403);
    $w = intdiv(time(), QR_STEP);
    out(['site' => $site['name'], 'site_id' => (int)$site['id'], 'token' => qr_token($site, $w), 'left' => QR_STEP - time() % QR_STEP, 'now' => now()]);

/* ================= جوال الموظف ================= */
case 'emp_activate':
    $e = row('SELECT * FROM employees WHERE nid=?', [s('nid')]);
    if (!$e || !$e['act_code']) { usleep(800000); fail('لا يوجد رمز تفعيل لهذا الرقم. اطلب رمزًا من الإدارة.'); }
    if ($e['act_fail'] >= 5) fail('تم إيقاف التفعيل بعد محاولات خاطئة. اطلب رمزًا جديدًا من الإدارة.');
    if (!hash_equals($e['act_code'], s('code'))) { q('UPDATE employees SET act_fail=act_fail+1 WHERE id=?', [$e['id']]); usleep(800000); fail('رمز التفعيل غير صحيح'); }
    $key = rnd(32);
    q('UPDATE employees SET device_hash=?, device_at=?, act_code=NULL, act_fail=0 WHERE id=?', [hash('sha256', $key), now(), $e['id']]);
    out(['ok' => 1, 'key' => $key, 'name' => $e['name']]);

case 'emp_status':
case 'emp_punch':
    $e = row('SELECT * FROM employees WHERE device_hash=?', [hash('sha256', s('key'))]);
    if (!$e) fail('هذا الجوال غير مربوط بأي موظف. فعّله برمز من الإدارة.', 403);
    $allowed = array_map('intval', array_column(rows('SELECT site_id FROM emp_sites WHERE emp_id=?', [$e['id']]), 'site_id'));
    $sites = rows('SELECT * FROM sites');
    if ($allowed) $sites = array_values(array_filter($sites, function ($x) use ($allowed) { return in_array((int)$x['id'], $allowed, true); }));
    $open = row('SELECT * FROM attendance WHERE emp_id=? AND out_time IS NULL AND in_time>=? ORDER BY in_time DESC', [$e['id'], date('Y-m-d H:i:s', time() - 20 * 3600)]);
    if ($a === 'emp_status') {
        $sh = $e['shift_id'] ? row('SELECT name, start_time, end_time FROM shifts WHERE id=?', [$e['shift_id']]) : null;
        $today = rows('SELECT in_time, out_time FROM attendance WHERE emp_id=? AND work_date=? ORDER BY in_time', [$e['id'], date('Y-m-d')]);
        out(['name' => $e['name'], 'shift' => $sh, 'open' => $open ? $open['in_time'] : null, 'today' => $today,
             'gps' => count(array_filter($sites, function ($x) { return $x['allow_gps'] && $x['lat'] !== null; })) > 0,
             'qr' => count(array_filter($sites, function ($x) { return $x['allow_qr']; })) > 0, 'now' => now()]);
    }
    // ---- تسجيل ----
    $last = val('SELECT MAX(t) FROM (SELECT in_time AS t FROM attendance WHERE emp_id=? UNION ALL SELECT out_time FROM attendance WHERE emp_id=?) x', [$e['id'], $e['id']]);
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
    fail('خطأ في الخادم: ' . $ex->getMessage(), 500);
}

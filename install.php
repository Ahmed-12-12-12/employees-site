<?php
/* صفحة التثبيت — تُستخدم مرة واحدة ثم احذفها من الاستضافة */
define('APP', 1);
require __DIR__ . '/lib.php';
header('Content-Type: text/html; charset=utf-8');
$msg = ''; $ok = false; $done = false;
$h = function ($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); };

if (cfg()) {
    try { $done = (int)val('SELECT COUNT(*) FROM admins') > 0; } catch (Throwable $e) { $done = false; }
}

if (!$done && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $host = trim($_POST['host'] ?? 'localhost'); $name = trim($_POST['db'] ?? ''); $user = trim($_POST['user'] ?? ''); $pass = $_POST['pass'] ?? '';
    $au = trim($_POST['au'] ?? ''); $ap = $_POST['ap'] ?? '';
    try {
        if (mb_strlen($au) < 3 || mb_strlen($ap) < 8) throw new Exception('اسم المدير 3 أحرف على الأقل وكلمة المرور 8 أحرف على الأقل.');
        if (!cfg()) {
            if ($name === '' || $user === '') throw new Exception('أدخل بيانات قاعدة البيانات.');
            $dsn = "mysql:host=$host;dbname=$name;charset=utf8mb4";
            new PDO($dsn, $user, $pass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]); // اختبار الاتصال
            $conf = "<?php\nreturn " . var_export(['db_dsn' => $dsn, 'db_user' => $user, 'db_pass' => $pass, 'timezone' => 'Asia/Riyadh'], true) . ";\n";
            if (@file_put_contents(__DIR__ . '/config.php', $conf) === false) throw new Exception('تعذّر إنشاء config.php. أنشئه يدويًا من config.sample.php ثم أعد فتح هذه الصفحة.');
        }
        foreach (schema() as $sql) db()->exec($sql);
        migrate();
        q("INSERT INTO admins (username, pass_hash, created_at, role, full_name) VALUES (?,?,?,'admin','المدير')", [$au, password_hash($ap, PASSWORD_DEFAULT), now()]);
        $ok = true; $done = true;
    } catch (Throwable $e) { $msg = $e->getMessage(); }
}
?><!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>تثبيت النظام</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;800&display=swap" rel="stylesheet">
<style>
body{margin:0;background:#f6f5f2;font-family:Cairo,Tahoma,sans-serif;color:#000;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
.c{background:#fff;border-radius:16px;padding:28px;width:min(460px,100%);box-shadow:0 4px 20px rgba(0,0,0,.08);border-top:5px solid #f5ad1b}
h1{font-size:22px;margin:0 0 4px}label{display:block;font-size:13px;color:#5f5c55;margin:12px 0 4px;font-weight:700}
input{width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid #e7e4dc;border-radius:10px;font:inherit}
button,a.b{display:block;width:100%;margin-top:18px;background:#f5ad1b;border:0;border-radius:10px;padding:11px;font:inherit;font-weight:800;cursor:pointer;color:#000;text-align:center;text-decoration:none}
.e{background:#fde3e1;color:#a3231a;padding:10px;border-radius:10px;margin-top:12px}.s{background:#e1f4e8;color:#17633a;padding:12px;border-radius:10px}
h2{font-size:15px;margin:22px 0 0;border-bottom:1px solid #eee;padding-bottom:4px}
</style></head><body><div class="c">
<img src="assets/logo.webp" alt="" style="height:90px;display:block;margin:0 auto 8px">
<h1>تثبيت منظومة الموظفين</h1>
<?php if ($done): ?>
  <p class="s"><?= $ok ? 'تم التثبيت بنجاح ✓' : 'النظام مُثبَّت مسبقًا.' ?></p>
  <p><b>مهم:</b> احذف ملف <code>install.php</code> من الاستضافة الآن.</p>
  <a class="b" href="./">الدخول إلى لوحة الإدارة</a>
<?php else: ?>
  <?php if ($msg): ?><div class="e"><?= $h($msg) ?></div><?php endif; ?>
  <form method="post">
  <?php if (!cfg()): ?>
    <h2>قاعدة البيانات (من cPanel ← MySQL Databases)</h2>
    <label>الخادم</label><input name="host" value="<?= $h($_POST['host'] ?? 'localhost') ?>" dir="ltr">
    <label>اسم قاعدة البيانات</label><input name="db" value="<?= $h($_POST['db'] ?? '') ?>" dir="ltr" required>
    <label>اسم مستخدم قاعدة البيانات</label><input name="user" value="<?= $h($_POST['user'] ?? '') ?>" dir="ltr" required>
    <label>كلمة مرور قاعدة البيانات</label><input name="pass" type="password" dir="ltr">
  <?php endif; ?>
    <h2>حساب مدير النظام</h2>
    <label>اسم المستخدم</label><input name="au" value="<?= $h($_POST['au'] ?? 'admin') ?>" dir="ltr" required>
    <label>كلمة المرور (8 أحرف على الأقل)</label><input name="ap" type="password" dir="ltr" required minlength="8">
    <button>تثبيت</button>
  </form>
<?php endif; ?>
</div></body></html>

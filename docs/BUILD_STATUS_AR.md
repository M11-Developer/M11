# حالة البناء — ميكا ١١

> ملف صريح يوضّح ما يعمل وما لا يعمل في مساري البناء، حتى لا يضيع الوقت لاحقًا.

## ✅ المسار العامل: نسخة الويب المغلّفة (بلا Godot)

**الملف:** `.github/workflows/android-webview.yml`
**التشغيل:** تلقائيًا بوسم `web-*` أو يدويًا من تبويب Actions.
**النتيجة:** نجح فعليًا، وأنتج:
- `app-debug.apk` — ٢٩ ميجابايت
- `app-release.apk` — ٢٩ ميجابايت
**الإصدار:** <https://github.com/M11-Developer/M11/releases/tag/web-v1.0>

**كيف يعمل:** ينسخ مجلد `web/` (اللعبة كاملة: ١٩ خريطة، ٢٨ سلاحًا، ١٩ وضعًا،
محاكاة بوتات) إلى `assets/` داخل تطبيق أندرويد صغير، ويعرضها في `WebView`
عبر نطاق محلي وهمي `https://m11.local/`. لا يحتاج إنترنت، ولا خادمًا، ولا Godot.
الكود: `webview-apk/app/src/main/java/com/m11/localwar/MainActivity.java`.

**ما تم التحقق منه على الحزمة نفسها:**
- ٥٤١ ملف أصل داخل الحزمة.
- لا أذونات موقع ولا تتبّع ولا معرّف إعلانات.
- لا أصول خام (`assets/raw/`, `assets/processed/`) داخل الحزمة.

## ⚠️ المسار الثاني: نسخة Godot الأصلية

**الملف:** `.github/workflows/android.yml`
**الحالة الحالية:** البناء يصل إلى خطوة التصدير ثم يفشل.

ما أُصلح فيه فعليًا (أخطاء حقيقية كانت تمنع التحميل أصلًا):
1. `@rpc("authority","unreliable",0)` ← الوسيط الثالث يجب أن يكون نصًّا:
   `@rpc("authority", "call_remote", "unreliable", 0)`.
2. `RenderingDevice.SAMPLES_DISABLED` غير موجود في Godot 4.3 ←
   `RenderingServer.VIEWPORT_MSAA_DISABLED`.
3. ثلاث شاشات (`boot_ui`, `hud`, `menu`) كانت ترث `CanvasLayer` وتستدعي `draw_*`
   وهذا غير ممكن ← صارت ترث `Control` داخل طبقة CanvasLayer.
4. دورة اعتماد بين `GameWorld` و`Actor`/`Projectile` تمنع تحليل GDScript ←
   كُسرت بملف ثوابت مستقل `src/core/tiles.gd` والتخلّي عن التصريح بالنوع.
5. `export_presets.cfg` كان ناقص مفاتيح إلزامية (Godot يقرأ `include_filter` بلا قيمة
   افتراضية) ← مولّد كامل `tools/gen_export_presets.py`.
6. قيود Godot على المسار بلا Gradle (`min_sdk`/`target_sdk`/ضغط المكتبات يجب أن تكون
   فارغة/مطفأة) ← المولّد يضبطها حسب المسار.

**ما تبقّى:** رسالة Godot «Cannot export project ... due to configuration errors»
تظهر بدون أي سطر سبب، وهذا يحدث في Godot 4.3 عندما تكون المسارات (Java/Android SDK)
غير مهيأة في إعدادات المحرّر داخل الحاوية. الإصلاح الجاري: كتابة
`editor_settings-4.3.tres` في `$HOME` قبل التصدير + تثبيت `build-tools;34.0.0`.

**قرار عملي:** لا نُعلّق الإصدار على هذا المسار — النسخة المغلّفة تعطي نفس اللعبة
بنفس المحتوى وقابلة للتنزيل الآن. التفاصيل في `DECISIONS.md` القرار ٢٤.

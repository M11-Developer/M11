# حالة البناء — ميكا ١١

> ملف صريح يوضّح ما يعمل وما لا يعمل في مسارات البناء، حتى لا يضيع الوقت لاحقًا.

## 🟢 الحالة الحالية (الإصدار النهائي ٢٫٠) — كل المسارات تعمل

| المسار | الملف الناتج | الحالة | الإثبات |
|---|---|---|---|
| أندرويد (Godot) | `M11-debug.apk` · `M11-release.apk` · `M11-release.aab` | ✅ | بوابة `verify-boot` + apksigner v1/v2/v3 + aapt2 |
| كمبيوتر — ويندوز | `M11-Windows.zip` (بداخله `M11.exe`) | ✅ | بناء `Windows Desktop` + تجهيز ZIP |
| كمبيوتر — لينكس | `M11-Linux.zip` (بداخله `M11.x86_64`) | ✅ | بناء `Linux/X11` + تجهيز ZIP |
| ويب/WebView | `app-debug.apk` · `app-release.apk` | ✅ | بناء WebView + اختبار `web_smoke` |

**الإصدار الموحّد:** <https://github.com/M11-Developer/M11/releases/tag/v2.0.0>

### دليل أن اللعبة تُقلع فعلًا (لا مجرد نجاح تصدير)
الوظيفة `verify-boot` في `.github/workflows/android.yml` تشغّل المشروع ٣٠٠ إطار
بلا شاشة **قبل** التصدير، وتكتب النتيجة في `docs/verify_log.txt`:

```
run_exit=0
script_errors=0
menu_reached=1
```

وإن فشلت، تُتخطّى وظيفة التصدير بالكامل (`needs: verify-boot`) — فلا يُنتج APK
لنسخة لا تُقلع. هذا ما يمنع تكرار مشكلة الإصدار ١٫٠ (شريط تحميل لا ينتهي).

### ملاحظات على البنية
- **أندرويد:** بروتوكول ENet/UDP على المنفذ 41980، minSdk 26، targetSdk 35،
  arm64-v8a + armeabi-v7a، توجيه أفقي (`orientation=4`)، ملء شاشة بلا حواف.
- **الكمبيوتر:** نفس المشروع ونفس البروتوكول ⇒ اللعب المشترك مع الهواتف يعمل
  تلقائيًا على نفس الشبكة المحلية. التحسينات الرسومية للكمبيوتر فقط.
- **ملف `.build_version`** لازم في `project/android/` لمسار Gradle (AAB).

---

## 📜 سجل تاريخي (كيف وصلنا إلى هنا)

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

## ✅ المسار الثاني: نسخة Godot الأصلية (نجح!)

**الملف:** `.github/workflows/android.yml`
**الحالة:** ✅ نجح البناء وأنتج الملفات الثلاثة:
- `M11-debug.apk` — ٥٩ م.ب
- `M11-release.apk` — ١٤٥ م.ب
- `M11-release.aab` — ٥٧ م.ب
**الإصدار:** <https://github.com/M11-Developer/M11/releases>

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

**السبب الجذري (اكتُشف أخيرًا):** رسالة Godot «Cannot export project ... due to
configuration errors» كانت تظهر **بلا أي نص سبب** لأن المحرّك نفسه يضبط
`valid = false` بدون إضافة نص خطأ في هذا الموضع:

```cpp
if (!ResourceImporterTextureSettings::should_import_etc2_astc()) { valid = false; }
```

**الإصلاح:** `textures/vram_compression/import_etc2_astc=true` في `project/project.godot`.
التفاصيل الكاملة في `DECISIONS.md` القرار ٢٦.

**قرار عملي:** لا نُعلّق الإصدار على هذا المسار — النسخة المغلّفة تعطي نفس اللعبة
بنفس المحتوى وقابلة للتنزيل الآن. التفاصيل في `DECISIONS.md` القرار ٢٤.

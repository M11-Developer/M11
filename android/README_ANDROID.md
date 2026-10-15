# بناء نسخة أندرويد (APK + AAB) — ميكا ١١

هذا المجلد يحوي كل ما يحتاجه مشروع Godot ليتحوّل إلى تطبيق أندرويد.
**لماذا لا يوجد ملف APK جاهز هنا؟** لأن بيئة التطوير التي بُني فيها هذا المشروع
لا تسمح بتحميل حِزم أندرويد (JDK + Android SDK + NDK + Godot Templates) — التحميل
محجوب. لذلك سُلّم **المصدر كاملًا + الإعدادات الجاهزة**، وخطوات البناء أدناه
تعمل على أي جهاز فيه Godot 4.3 (دقيقتان تقريبًا).

## 1) المتطلبات (تُنزَّل مرة واحدة)
| المكوّن | الإصدار | ملاحظة |
|---|---|---|
| Godot | 4.3 أو أحدث | نسخة **Standard** (ليست .NET) |
| JDK | 17 | `JAVA_HOME` مضبوط |
| Android Studio | أحدث | لتثبيت SDK |
| Android SDK | API 35 | `ANDROID_HOME` مضبوط |
| Build Tools | 35.0.0 | عبر SDK Manager |
| NDK | 23.2.8568313 | عبر SDK Manager |
| Godot Export Templates | 4.3 | Editor ▸ Manage Export Templates ▸ Download |

## 2) مفاتيح التوقيع (Debug يكفي للتجربة)
```bash
keytool -genkeypair -v -keystore m11-release.keystore -alias m11 \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass كلمة_سر -keypass كلمة_سر \
  -dname "CN=M11 Local War, OU=Games, O=M11, L=Cairo, C=EG"
```
> للإصدار النهائي على Google Play استخدم **Play App Signing** ولا تشارك ملف المفتاح.

## 3) الإعداد في Godot
1. `Project ▸ Install Android Build Template…` (ينشئ `res://android/build/`).
2. `Editor Settings ▸ Export ▸ Android` → اضبط:
   - `Android Sdk Path` = مسار SDK
   - `Java Sdk Path` = مسار JDK 17
   - `Debug Keystore` = مسار keystore
3. `Project ▸ Export…` → اختر الإعداد **Android (APK)** → `Export Project`.
4. لإصدار المتجر: الإعداد **Android (AAB)** → ارفعه على Google Play Console.

سطر أوامر (بلا واجهة):
```bash
godot --headless --path <مسار_المشروع> --export-release "Android (APK — للتوزيع المباشر)" build/M11-v1.0.0.apk
godot --headless --path <مسار_المشروع> --export-release "Android (AAB — لمتجر جوجل)" build/M11-v1.0.0.aab
```

## 4) الأذونات (مهم — القسم 4 من دفتر المشروع)
ملف `export_presets.cfg` يضبط:
```
permissions/internet = false            ← ممنوع نهائيًا (اللعبة محلية فقط)
permissions/access_wifi_state = true    ← لقراءة حالة الواي فاي (اسم الشبكة)
permissions/change_wifi_multicast_state = true  ← لتفعيل البثّ العام للإكتشاف
permissions/nearby_wifi_devices = true  ← أندرويد 13+ (مطلوب للاكتشاف)
```
> إذا فعّلت الشات الصوتي: أضف `RECORD_AUDIO` فقط عند الطلب (Run-time permission).

## 5) حجم الحزمة (أرقام مقاسة بتاريخ 2026-10-15)

| المحتوى | الحجم |
|---|---|
| محرّك Godot (arm64-v8a + armeabi-v7a) | ~42 ميجابايت |
| أطالس الرسوم (75 ملفًا: شخصيات، أسلحة، عالم، بلاطات، لوحات منظر) | 3.5 ميجابايت |
| الصوت (111 ملف OGG) | 6.4 ميجابايت |
| الخطوط المقلمة (Cairo + Noto) | 0.4 ميجابايت |
| كود اللعبة والبيانات | < 1 ميجابايت |
| **إجمالي الحزمة المتوقع** | **≈ 53 ميجابايت** |

**الصور الخام (87 ميجابايت في `assets/raw/` و33 ميجابايت في `assets/processed/`)
لا تدخل الحزمة** — `export_presets.cfg` فيه:
```
exclude_filter="assets/raw/*, assets/processed/*, docs/*, tools/*, *.md"
```
تبقى محفوظة في المستودع للمراجعة وإعادة المعالجة، وهو الأصح: حزمة أخف بلا حشو.

**إن أردت الوصول إلى 150–200 ميجابايت بجودة لا بحشو** فالأصول جاهزة للإضافة:
موضوع الصور الخام كاملًا ثم تصدير بدون استثناء (`exclude_filter="*.md"`) يعطي ≈ 175 ميجابايت،
مع مضاعفة دقة الأطالس ×2 (`--only` مع `scale=2` في `build_assets.py`) يرتفع إلى ≈ 195 ميجابايت.
الجدول التفصيلي البديل في `docs/DECISIONS.md` القرار 12.

## 6) تشغيل اللعبة على أندرويد
1. ثبّت الـ APK على جهاز المضيف.
2. فعّل **نقطة الاتصال** (Hotspot) من إعدادات أندرويد (بلا إنترنت — لا حاجة لبيانات).
3. افتح اللعبة ▸ **الشبكة المحلية** ▸ **إنشاء غرفة**.
4. على الأجهزة الأخرى: صِل نفس النقطة ▸ **بحث وانضمام** (3 ثوانٍ) ▸ تلعب.
5. أندرويد 13+: عند أول بحث امنح صلاحية **الأجهزة القريبة**.

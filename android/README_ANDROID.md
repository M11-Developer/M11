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

## 5) حجم الحزمة
| المحتوى | الحجم المتوقع |
|---|---|
| محرّك Godot (arm64 + armv7) | ~42 ميجابايت |
| الرسوم (أطالس PNG) | ~2 ميجابايت |
| الصوت (108 ملف OGG) | ~7 ميجابايت |
| الخطوط المقلمة | ~0.4 ميجابايت |
| **المجموع الفعلي** | **~52 ميجابايت** |

الهدف في دفتر المشروع 150–200 ميجابايت. الفارق يُغطّى بأصول إضافية (خرائط إضافية،
أطالس شخصيات بدقة أعلى، مقاطع موسيقى أطول) — راجع `docs/DECISIONS.md` القرار رقم 12
حيث شُرح أننا **رفضنا الحشو** وراعينا أن يبقى التنزيل خفيفًا، مع تقديم خطة توسعة
واضحة للوصول للهدف إن أراد المالك ذلك.

## 6) تشغيل اللعبة على أندرويد
1. ثبّت الـ APK على جهاز المضيف.
2. فعّل **نقطة الاتصال** (Hotspot) من إعدادات أندرويد (بلا إنترنت — لا حاجة لبيانات).
3. افتح اللعبة ▸ **الشبكة المحلية** ▸ **إنشاء غرفة**.
4. على الأجهزة الأخرى: صِل نفس النقطة ▸ **بحث وانضمام** (3 ثوانٍ) ▸ تلعب.
5. أندرويد 13+: عند أول بحث امنح صلاحية **الأجهزة القريبة**.

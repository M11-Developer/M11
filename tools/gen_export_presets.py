#!/usr/bin/env python3
# ============================================================================
# مولّد ملف إعدادات التصدير لأندرويد (project/export_presets.cfg)
#   python3 tools/gen_export_presets.py
#
# لماذا هذا الملف؟ لأن Godot 4.3 يقرأ بعض المفاتيح (مثل include_filter) بلا قيمة
# افتراضية، فنقصها يوقف التصدير برسالة:
#   "Couldn't find the given section "preset.1" and key "include_filter""
# لذلك نولّد الملف كاملًا بالمفاتيح الصحيحة كما يعرّفها مصدر Godot نفسه
# (platform/android/export/export_plugin.cpp للإصدار 4.3-stable).
#
# القسم ٤ من المواصفة: لا خدمات سحابية ولا تتبّع. إذن INTERNET مطلوب نظاميًا
# لأي اتصال محلي (حتى UDP على نفس الراوتر) — التفاصيل في docs/DECISIONS.md القرار 23.
# ============================================================================
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "project", "export_presets.cfg")

PKG = "com.m11.localwar"
APP_NAME = "ميكا ١١"
VERSION_CODE = 1
VERSION_NAME = "1.0.0"
EXCLUDE = "assets/raw/*, assets/processed/*, docs/*, tools/*, *.md, .github/*"

# الأذونات المطلوبة فقط (كل الباقي false صراحةً ليكون الملف واضحًا للمبتدئ)
PERMISSIONS_TRUE = [
    # الشبكة المحلية: أندرويد يمنع فتح أي مقبس شبكة بلا إذن الإنترنت
    "internet",
    # قراءة حالة الواي فاي لاختيار أفضل منفذ وإظهار حالة الاتصال
    "access_wifi_state",
    # استقبال/إرسال حزم البث (discovery) على منفذ 41980
    "change_wifi_multicast_state",
    # الدردشة الصوتية (اختيارية — يستطيع اللاعب إيقافها)
    "record_audio",
]

# أذونات حديثة لا يعرفها Godot 4.3 في قائمته، نضيفها يدويًا:
CUSTOM_PERMISSIONS = [
    "android.permission.NEARBY_WIFI_DEVICES",  # أندرويد 13+ لمسار البث المحلي
]

# كل أذونات Godot 4.3 (من مصدر المحرّك) — نكتبها false لتبقى القائمة صريحة
ALL_PERMISSIONS = """ACCESS_CHECKIN_PROPERTIES ACCESS_COARSE_LOCATION ACCESS_FINE_LOCATION
ACCESS_LOCATION_EXTRA_COMMANDS ACCESS_MOCK_LOCATION ACCESS_NETWORK_STATE ACCESS_SURFACE_FLINGER
ACCESS_WIFI_STATE ACCOUNT_MANAGER ADD_VOICEMAIL AUTHENTICATE_ACCOUNTS BATTERY_STATS
BIND_ACCESSIBILITY_SERVICE BIND_APPWIDGET BIND_DEVICE_ADMIN BIND_INPUT_METHOD BIND_NFC_SERVICE
BIND_NOTIFICATION_LISTENER_SERVICE BIND_PRINT_SERVICE BIND_REMOTEVIEWS BIND_TEXT_SERVICE
BIND_VPN_SERVICE BIND_WALLPAPER BLUETOOTH BLUETOOTH_ADMIN BLUETOOTH_ADVERTISE BLUETOOTH_CONNECT
BLUETOOTH_SCAN BRICK BROADCAST_SMS BROADCAST_STICKY BROADCAST_WAP_PUSH CALL_PHONE
CALL_PRIVILEGED CAMERA CAPTURE_AUDIO_OUTPUT CAPTURE_SECURE_VIDEO_OUTPUT CAPTURE_VIDEO_OUTPUT
CHANGE_COMPONENT_ENABLED_STATE CHANGE_CONFIGURATION CHANGE_NETWORK_STATE CHANGE_WIFI_MULTICAST_STATE
CHANGE_WIFI_STATE CLEAR_APP_CACHE CONTROL_LOCATION_UPDATES DELETE_CACHE_FILES DELETE_PACKAGES
DIAGNOSTIC DEVICE_POWER DISABLE_KEYGUARD DUMP EXPAND_STATUS_BAR FACTORY_TEST FLASHLIGHT
FORCE_BACK GET_ACCOUNTS GET_ACCOUNTS_PRIVILEGED GET_PACKAGE_SIZE GET_TASKS GLOBAL_SEARCH HARDWARE_TEST
INJECT_EVENTS INSTALL_LOCATION_PROVIDER INSTALL_PACKAGES INSTALL_SHORTCUT INTERNET KILL_BACKGROUND_PROCESSES
LOCATION_HARDWARE MANAGE_DOCUMENTS MASTER_CLEAR MEDIA_CONTENT_CONTROL MODIFY_AUDIO_SETTINGS
MODIFY_PHONE_STATE MOUNT_FORMAT_FILESYSTEMS MOUNT_UNMOUNT_FILESYSTEMS NFC PERSISTENT_ACTIVITY
POST_NOTIFICATIONS PROCESS_OUTGOING_CALLS READ_CALENDAR READ_CALL_LOG READ_CONTACTS READ_EXTERNAL_STORAGE
READ_FRAME_BUFFER READ_HISTORY_BOOKMARKS READ_INPUT_STATE READ_LOGS READ_PHONE_STATE READ_PROFILE
READ_SMS READ_SOCIAL_STREAM READ_SYNC_SETTINGS READ_SYNC_STATS READ_USER_DICTIONARY READ_VOICEMAIL
REBOOT RECEIVE_BOOT_COMPLETED RECEIVE_MMS RECEIVE_SMS RECEIVE_WAP_PUSH RECORD_AUDIO
REORDER_TASKS REQUEST_IGNORE_BATTERY_OPTIMIZATIONS REQUEST_INSTALL_PACKAGES RESTART_PACKAGES
SEND_RESPOND_VIA_MESSAGE SEND_SMS SET_ACTIVITY_WATCHER SET_ALARM SET_ALWAYS_FINISH SET_ANIMATION_SCALE
SET_DEBUG_APP SET_ORIENTATION SET_POINTER_ICON SET_PREFERRED_APPLICATIONS SET_PROCESS_LIMIT
SET_TIME SET_TIME_ZONE SET_WALLPAPER SET_WALLPAPER_HINTS SIGNAL_PERSISTENT_PROCESSES STATUS_BAR
SUBSCRIBED_FEEDS_READ SUBSCRIBED_FEEDS_WRITE SYSTEM_ALERT_WINDOW TRANSMIT_IR UNINSTALL_SHORTCUT
UPDATE_DEVICE_STATS USE_CREDENTIALS USE_SIP VIBRATE WAKE_LOCK WRITE_APN_SETTINGS WRITE_CALENDAR
WRITE_CALL_LOG WRITE_CONTACTS WRITE_EXTERNAL_STORAGE WRITE_GSERVICES WRITE_HISTORY_BOOKMARKS
WRITE_PROFILE WRITE_SECURE_SETTINGS WRITE_SETTINGS WRITE_SMS WRITE_SOCIAL_STREAM WRITE_SYNC_SETTINGS
WRITE_USER_DICTIONARY WRITE_VOICEMAIL""".split()


def preset_header(idx: int, name: str, runnable: bool, export_path: str) -> str:
    return f"""[preset.{idx}]

name="{name}"
platform="Android"
runnable={"true" if runnable else "false"}
advanced_options=true
dedicated_server=false
custom_features=""
export_filter="all_resources"
include_filter=""
exclude_filter="{EXCLUDE}"
export_path="{export_path}"
patches=PackedStringArray()
encryption_include_filters=""
encryption_exclude_filters=""
seed=0
encrypt_pck=false
encrypt_directory=false
script_export_mode=2
"""


def preset_options(idx: int, is_aab: bool) -> str:
    perms = "\n".join(f"permissions/{p}={'true' if p in PERMISSIONS_TRUE else 'false'}"
                      for p in ALL_PERMISSIONS)
    custom = ", ".join(f'"{p}"' for p in CUSTOM_PERMISSIONS)
    return f"""[preset.{idx}.options]

custom_template/debug=""
custom_template/release=""
gradle_build/use_gradle_build=true
gradle_build/gradle_build_directory="res://android/"
gradle_build/android_source_template=""
gradle_build/compress_native_libraries=true
gradle_build/export_format={1 if is_aab else 0}
gradle_build/min_sdk="26"
gradle_build/target_sdk="35"
architectures/armeabi-v7a=true
architectures/arm64-v8a=true
architectures/x86=false
architectures/x86_64=false
version/code={VERSION_CODE}
version/name="{VERSION_NAME}"
package/unique_name="{PKG}"
package/name="{APP_NAME}"
package/signed=true
package/app_category=2
package/retain_data_on_uninstall=false
package/exclude_from_recents=false
package/show_in_android_tv=false
package/show_in_app_library=true
package/show_as_launcher_app=false
launcher_icons/main_192x192="res://assets/app_icon.png"
launcher_icons/adaptive_foreground_432x432="res://assets/app_icon.png"
launcher_icons/adaptive_background_432x432="res://assets/app_icon.png"
graphics/opengl_debug=false
xr_features/xr_mode=0
screen/immersive_mode=true
screen/support_small=true
screen/support_normal=true
screen/support_large=true
screen/support_xlarge=true
user_data_backup/allow=false
command_line/extra_args=""
apk_expansion/enable=false
apk_expansion/SALT=""
apk_expansion/public_key=""
{perms}
permissions/custom_permissions=PackedStringArray({custom})
"""


def main() -> int:
    header = (
        "; ============================================================================\n"
        "; إعدادات التصدير — أندرويد (APK + AAB)\n"
        "; مُولّد آليًا بواسطة tools/gen_export_presets.py — لا تُحرّره يدويًا!\n"
        "; ملاحظة أمنية (القسم ٤ + القرار ٢٣): لا خدمات سحابية ولا تتبّع ولا إعلانات.\n"
        "; إذن INTERNET موجود لأن أندرويد يمنع أي اتصال محلي (حتى UDP داخل نفس\n"
        "; الراوتر) بدونه؛ الأذونات الأخرى محصورة في الواي فاي والميكروفون الاختياري.\n"
        "; ============================================================================\n\n"
    )
    body = (
        preset_header(0, "Android APK", True, "build/M11-v1.0.0.apk")
        + "\n" + preset_options(0, False)
        + "\n" + preset_header(1, "Android AAB", False, "build/M11-v1.0.0.aab")
        + "\n" + preset_options(1, True)
    )
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(header + body)
    print(f"✔ كُتب {OUT}")
    print(f"  أذونات مفعّلة: {', '.join(PERMISSIONS_TRUE)}")
    print(f"  أذونات مخصّصة: {', '.join(CUSTOM_PERMISSIONS)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

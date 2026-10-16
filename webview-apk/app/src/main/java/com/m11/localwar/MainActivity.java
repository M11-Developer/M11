package com.m11.localwar;

// ============================================================================
//  MainActivity — يشغّل لعبة «ميكا ١١» (نسخة الويب) داخل WebView مع خدمة
//  الأصول محليًا بلا أي خادم وبلا إنترنت.
//
//  لماذا WebViewAssetLoader غير مستخدمة؟ لأنها تطلب مكتبة AndroidX، ونحن
//  نريد APK بلا أي تبعيات خارجية إطلاقًا (أصغر حجمًا وأبسط للمبتدئ).
//  لذلك نعترض الطلبات بأنفسنا: كل رابط يبدأ بـ https://m11.local/ يُقرأ من
//  مجلد assets المدمج في الحزمة، ويعود بنوع MIME الصحيح.
//
//  ملاحظة مهمة: ES Modules تحتاج أصلًا (origin) من نوع http(s) ولا تعمل مع
//  file:// — ولهذا نستخدم النطاق الوهمي المحلي.
// ============================================================================

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {

    private static final String TAG = "M11";
    /** النطاق المحلي الوهمي — كل شيء يُقرأ من أصول الحزمة */
    private static final String BASE = "https://m11.local/";

    private WebView web;
    private final Map<String, String> mimeCache = new HashMap<>();

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // شاشة اللعب: أفقي، مضاءة دائمًا، ملء الشاشة
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);              // اللعبة JavaScript
        s.setDomStorageEnabled(true);              // الحفظ/الإعدادات
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // الأصوات تعمل بعد أول لمسة
        s.setAllowFileAccess(false);               // لا وصول لملفات الجهاز
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setTextZoom(100);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        web.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        web.setBackgroundColor(0xFF0B0D10);        // لون الخلفية من لوحة اللعبة
        web.setWebViewClient(new LocalAssetsClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.i(TAG, m.message() + "  @" + m.sourceId() + ":" + m.lineNumber());
                return true;
            }
        });

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        setContentView(web);

        if (savedInstanceState == null) {
            web.loadUrl(BASE + "index.html");
        } else {
            web.restoreState(savedInstanceState);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        // داخل اللعبة: الرجوع يتصرّف كزر داخلي إن أمكن، وإلا نخرج
        if (web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) {
            web.onPause();      // إيقاف الرسم والصوت عند الخروج من التطبيق
            web.pauseTimers();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.resumeTimers();
            web.onResume();
        }
    }

    // ------------------------------------------------------------------ الأصول
    /** يقرأ كل طلب من أصول الحزمة ويعيده بنوع MIME الصحيح */
    private class LocalAssetsClient extends WebViewClient {

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            // أي رابط خارج النطاق المحلي يُرفض (بلا إنترنت أصلًا)
            return !request.getUrl().toString().startsWith(BASE);
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            String url = request.getUrl().toString();
            if (!url.startsWith(BASE)) {
                return null;
            }
            String path = url.substring(BASE.length());
            int q = path.indexOf('?');
            if (q >= 0) {
                path = path.substring(0, q);
            }
            if (path.isEmpty()) {
                path = "index.html";
            }
            try {
                InputStream in = getAssets().open(path);
                return new WebResourceResponse(mimeOf(path), "utf-8", in);
            } catch (IOException e) {
                Log.w(TAG, "أصل مفقود: " + path);
                return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                        new HashMap<String, String>(),
                        new ByteArrayInputStream(("missing: " + path).getBytes()));
            }
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request,
                                    android.webkit.WebResourceError error) {
            Log.e(TAG, "خطأ تحميل: " + request.getUrl() + " → " + error.getDescription());
        }
    }

    /** نوع المحتوى حسب امتداد الملف — ضروري لتعمل وحدات ES والخطوط والأصوات */
    private String mimeOf(String path) {
        String p = path.toLowerCase();
        String hit = mimeCache.get(p);
        if (hit != null) {
            return hit;
        }
        String mime = "application/octet-stream";
        int dot = p.lastIndexOf('.');
        String ext = dot >= 0 ? p.substring(dot + 1) : "";
        switch (ext) {
            case "html": case "htm": mime = "text/html"; break;
            case "js": case "mjs":   mime = "text/javascript"; break;
            case "css":              mime = "text/css"; break;
            case "json":             mime = "application/json"; break;
            case "png":              mime = "image/png"; break;
            case "jpg": case "jpeg": mime = "image/jpeg"; break;
            case "webp":             mime = "image/webp"; break;
            case "gif":              mime = "image/gif"; break;
            case "svg":              mime = "image/svg+xml"; break;
            case "mp3":              mime = "audio/mpeg"; break;
            case "ogg": case "opus": mime = "audio/ogg"; break;
            case "wav":              mime = "audio/wav"; break;
            case "m4a":              mime = "audio/mp4"; break;
            case "woff":             mime = "font/woff"; break;
            case "woff2":            mime = "font/woff2"; break;
            case "ttf":              mime = "font/ttf"; break;
            case "otf":              mime = "font/otf"; break;
            case "wasm":             mime = "application/wasm"; break;
            case "txt":              mime = "text/plain"; break;
            default: break;
        }
        mimeCache.put(p, mime);
        return mime;
    }
}

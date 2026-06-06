package com.flourmill.maintenance;

import android.app.Activity;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

/**
 * نشاط رئيسي يعرض تطبيق صيانة المطحنة (PWA) داخل WebView.
 * تُحمَّل ملفات الويب المضمّنة في assets/www وتُقدَّم عبر رابط
 * https آمن باستخدام WebViewAssetLoader حتى يعمل التخزين المحلي
 * وعامل الخدمة بشكل سليم — والتطبيق كله يعمل دون اتصال بالإنترنت.
 */
public class MainActivity extends Activity {

    private static final String START_URL =
            "https://appassets.androidwebview.domain/assets/www/index.html";

    private WebView webView;

    @SuppressWarnings("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView = new WebView(this);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // يلزم لتخزين البيانات محلياً (localStorage)
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);           // الأمان: نعتمد على asset loader فقط
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(
                    WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            // إبقاء التنقل داخل التطبيق
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String host = request.getUrl().getHost();
                return host == null || !host.equals("appassets.androidwebview.domain");
            }
        });

        setContentView(webView);

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(START_URL);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    // زر الرجوع يتنقل داخل صفحات التطبيق بدل الخروج فوراً
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView != null && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }
}

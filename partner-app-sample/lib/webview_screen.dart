import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';

/// Embeds the carecart H5 handoff URL in a WebView and listens for the
/// "close webview" signal on all three carecart-supported paths so the
/// production partner-app team can pick whichever fits their stack:
///
///   1. iOS WKWebView script message handler 'closeWebView'.
///      Carecart calls window.webkit.messageHandlers.closeWebView
///      .postMessage(null). On iOS, Flutter's addJavaScriptChannel
///      registers the message handler at exactly that JS path, so it
///      Just Works without extra code on our side.
///
///   2. Android JavascriptInterface-style window.Android.closeWebView().
///      Flutter's channel API exposes only window.<name>.postMessage,
///      not arbitrary methods on a named object, so we inject a tiny JS
///      shim on every page load that defines window.Android.closeWebView
///      to forward to the same channel.
///
///   3. URL-scheme deep link (defaults to papazao://close). Caught in
///      onNavigationRequest before the webview tries to load it.
///
/// All three end up calling Navigator.pop(context).
class WebViewScreen extends StatefulWidget {
  final String ppzId;
  final String email;
  final String baseUrl;
  final String closeUrl;

  const WebViewScreen({
    super.key,
    required this.ppzId,
    required this.email,
    required this.baseUrl,
    required this.closeUrl,
  });

  @override
  State<WebViewScreen> createState() => _WebViewScreenState();
}

class _WebViewScreenState extends State<WebViewScreen> {
  late final WebViewController _controller;
  bool _loading = true;

  /// Shim that defines window.Android.closeWebView so carecart's
  /// production-style window.Android.closeWebView() call can reach the
  /// Flutter JS channel which only exposes postMessage(). Idempotent —
  /// safe to inject on every page load.
  static const _androidBridgeShim = '''
    (function () {
      if (!window.Android || typeof window.Android !== 'object') {
        window.Android = {};
      }
      if (typeof window.Android.closeWebView !== 'function') {
        window.Android.closeWebView = function () {
          try {
            if (window.closeWebView && window.closeWebView.postMessage) {
              window.closeWebView.postMessage('close');
            }
          } catch (e) {}
        };
      }
    })();
  ''';

  @override
  void initState() {
    super.initState();

    // Manifest declares CAMERA, but Android 6+ also needs a runtime
    // grant on the host process — without it the WebView's permission
    // grant succeeds at the page level but the underlying Camera2
    // open is refused, surfacing in JS as NotReadableError. Fire and
    // forget; the OS only prompts on first run, and if it's already
    // denied the user has to flip it in Settings → Apps → Permissions.
    if (Platform.isAndroid) {
      Permission.camera.request();
    }

    final handoff = Uri.parse(
      '${widget.baseUrl}/h5/login'
      '?ppzid=${Uri.encodeComponent(widget.ppzId)}'
      '&email=${Uri.encodeComponent(widget.email)}',
    );

    // On Android, we have to construct the controller via the platform
    // creation params so we can opt-in to media playback (carecart's
    // getUserMedia / camera). On iOS the default params are sufficient
    // because WKWebView reads NSCameraUsageDescription from Info.plist.
    final PlatformWebViewControllerCreationParams params = Platform.isAndroid
        ? AndroidWebViewControllerCreationParams()
        : (Platform.isIOS
            ? WebKitWebViewControllerCreationParams(
                allowsInlineMediaPlayback: true,
                mediaTypesRequiringUserAction: const <PlaybackMediaTypes>{},
              )
            : const PlatformWebViewControllerCreationParams());

    final controller = WebViewController.fromPlatformCreationParams(params)
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.white)
      // (1) iOS — Flutter publishes this channel as
      // window.webkit.messageHandlers.closeWebView on WKWebView, which
      // is exactly what carecart's exitToApp() calls first. The same
      // callback also fires for the Android shim path below.
      ..addJavaScriptChannel(
        'closeWebView',
        onMessageReceived: (_) => _close(),
      );

    controller.setNavigationDelegate(
      NavigationDelegate(
        onPageStarted: (_) {
          if (mounted) setState(() => _loading = true);
        },
        onPageFinished: (_) async {
          // (2) Android — install the window.Android shim. Harmless on
          // iOS, where carecart's iOS check matches first anyway.
          try {
            await controller.runJavaScript(_androidBridgeShim);
          } catch (_) {}
          if (mounted) setState(() => _loading = false);
        },
        onNavigationRequest: (req) {
          // (3) URL-scheme fallback. Carecart fires this if neither
          // bridge above is registered.
          final close = widget.closeUrl.trim();
          if (close.isNotEmpty && req.url.startsWith(close)) {
            _close();
            return NavigationDecision.prevent;
          }
          return NavigationDecision.navigate;
        },
      ),
    );

    // Android-specific: auto-grant camera/mic permission requests from
    // pages inside the WebView. Without this, getUserMedia() inside
    // carecart silently fails on Android because the platform side
    // doesn't surface the prompt.
    if (Platform.isAndroid &&
        controller.platform is AndroidWebViewController) {
      final android = controller.platform as AndroidWebViewController;
      android.setMediaPlaybackRequiresUserGesture(false);
      android.setOnPlatformPermissionRequest((request) {
        request.grant();
      });
    }

    controller.loadRequest(handoff);
    _controller = controller;
  }

  void _close() {
    if (mounted && Navigator.canPop(context)) {
      Navigator.pop(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      // No AppBar — full-screen webview so the only way to exit is via
      // the carecart Home button (which is what we're testing). Android
      // system back still works as a manual escape hatch.
      body: Stack(
        children: [
          SafeArea(child: WebViewWidget(controller: _controller)),
          // Branded splash that fades out once the page paints. The
          // WebView itself renders white during navigation; covering
          // it with a styled overlay makes the wait feel intentional
          // instead of looking like the app froze.
          IgnorePointer(
            ignoring: !_loading,
            child: AnimatedOpacity(
              opacity: _loading ? 1.0 : 0.0,
              duration: const Duration(milliseconds: 220),
              curve: Curves.easeOut,
              child: Container(
                color: Colors.white,
                alignment: Alignment.center,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Image.asset(
                      'assets/icon.png',
                      width: 88,
                      height: 88,
                    ),
                    const SizedBox(height: 22),
                    const SizedBox(
                      width: 26,
                      height: 26,
                      child: CircularProgressIndicator(strokeWidth: 2.5),
                    ),
                    const SizedBox(height: 14),
                    Text(
                      'Opening carecart…',
                      style: TextStyle(
                        color: Colors.grey[600],
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

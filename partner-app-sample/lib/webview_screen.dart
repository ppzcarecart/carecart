import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

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

    // Pre-request runtime CAMERA permission so when the user opens
    // /admin/collection inside this webview and taps "Start camera",
    // the OS already has the permission. Without this the WebView's
    // permission grant succeeds but the underlying camera stream
    // fails silently. Fire-and-forget — if the user denies, the page
    // will just show its own permission-help dialog.
    Permission.camera.request();

    final handoff = Uri.parse(
      '${widget.baseUrl}/h5/login'
      '?ppzid=${Uri.encodeComponent(widget.ppzId)}'
      '&email=${Uri.encodeComponent(widget.email)}',
    );

    final controller = WebViewController()
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

    // Android only: by default WebView denies every page-level
    // permission request (camera, mic, location, etc.) without ever
    // surfacing the prompt to the user. carecart's QR scanner needs
    // camera access, so we explicitly grant camera/mic when the page
    // asks. Other request types (location, MIDI, protected media) are
    // denied to keep the permission surface minimal.
    if (controller.platform is AndroidWebViewController) {
      final android = controller.platform as AndroidWebViewController;
      android.setOnPlatformPermissionRequest((request) async {
        final wantsCamera = request.types.any(
          (t) =>
              t == WebViewPermissionResourceType.camera ||
              t == WebViewPermissionResourceType.microphone,
        );
        if (wantsCamera) {
          await request.grant();
        } else {
          await request.deny();
        }
      });
    }

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
      body: SafeArea(
        child: Stack(
          children: [
            WebViewWidget(controller: _controller),
            if (_loading)
              const LinearProgressIndicator(
                minHeight: 2,
                backgroundColor: Colors.transparent,
              ),
          ],
        ),
      ),
    );
  }
}

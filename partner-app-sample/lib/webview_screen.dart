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

    // Android 6+: declaring CAMERA in AndroidManifest only grants the
    // capability — the OS still requires the user (or the app) to
    // grant the permission at runtime. The WebView's
    // setOnPlatformPermissionRequest below grants the *page's*
    // request, but the underlying Camera2 open inside this host
    // process then fails with NotReadableError ("could not start
    // video source") unless the host process has runtime CAMERA too.
    // Fire-and-forget — if denied, the page surfaces its own help.
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

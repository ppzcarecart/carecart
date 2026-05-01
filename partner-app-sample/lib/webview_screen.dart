import 'dart:async';
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
/// All three pop with a String describing which bridge fired, so the
/// home screen can surface it in a snackbar — that confirmation is the
/// point of this sample, since the production team needs to know which
/// bridge their stack actually exercised in real testing.
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

class _WebViewScreenState extends State<WebViewScreen>
    with WidgetsBindingObserver {
  late final WebViewController _controller;
  late final Uri _handoff;
  bool _loading = true;
  WebResourceError? _error;
  bool _hadErrorDuringSession = false;
  bool _cameraPermanentlyDenied = false;
  bool _initialLoadComplete = false;
  Timer? _fadeTimer;

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
    WidgetsBinding.instance.addObserver(this);
    _checkCameraPermission();

    _handoff = Uri.parse(
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
      // The same channel fires from two different sources, distinguished
      // by platform: on iOS it's carecart's WKWebView script message
      // handler; on Android it's our injected window.Android shim
      // forwarding here. Tagging the source is the point of this sample
      // — it tells the production team which bridge their stack actually
      // exercised during testing.
      ..addJavaScriptChannel(
        'closeWebView',
        onMessageReceived: (_) => _close(
          Platform.isIOS
              ? 'iOS message handler (closeWebView)'
              : 'Android JS interface (window.Android.closeWebView)',
        ),
      );

    controller.setNavigationDelegate(
      NavigationDelegate(
        onPageStarted: (_) {
          // Cancel any pending fade — if a fresh navigation starts
          // while we were about to drop the splash (the redirect-chain
          // case: /h5/login → /shop), keep the splash up so the user
          // doesn't see a flash of white between hops.
          _fadeTimer?.cancel();
          if (_initialLoadComplete) return;
          if (mounted) {
            setState(() {
              _loading = true;
              _error = null;
            });
          }
        },
        onPageFinished: (_) async {
          // (2) Android — install the window.Android shim. Harmless on
          // iOS, where carecart's iOS check matches first anyway.
          try {
            await controller.runJavaScript(_androidBridgeShim);
          } catch (_) {}
          if (!mounted) return;
          if (_initialLoadComplete) return;
          // Debounce: only fade when no further navigation begins
          // within the window. The H5 handoff redirects login → shop,
          // and we don't want the splash to flash off and back on
          // between those two hops.
          _fadeTimer?.cancel();
          _fadeTimer = Timer(const Duration(milliseconds: 350), () {
            if (!mounted) return;
            setState(() {
              _loading = false;
              _initialLoadComplete = true;
            });
          });
        },
        onWebResourceError: (err) {
          // Skip sub-resource failures (favicon 404s, blocked tracking
          // pixels, ad domains) — those don't break the page and would
          // create noisy false-positive error states. Only main-frame
          // failures actually mean the user is stuck. isForMainFrame is
          // null on iOS, so we treat null as "could be main" and only
          // suppress when explicitly false (Android sub-resource case).
          if (err.isForMainFrame == false) return;
          if (!mounted) return;
          setState(() {
            _loading = false;
            _error = err;
            _hadErrorDuringSession = true;
          });
        },
        onNavigationRequest: (req) {
          // (3) URL-scheme fallback. Carecart fires this if neither
          // bridge above is registered.
          final close = widget.closeUrl.trim();
          if (close.isNotEmpty && req.url.startsWith(close)) {
            _close('URL scheme ($close)');
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

    controller.loadRequest(_handoff);
    _controller = controller;
  }

  @override
  void dispose() {
    _fadeTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // When the user returns from system Settings (after tapping
    // "Open Settings" in the camera-denied banner) re-check the camera
    // grant so the banner clears without a manual reload.
    if (state == AppLifecycleState.resumed) {
      _refreshCameraStatus();
    }
  }

  Future<void> _checkCameraPermission() async {
    // Manifest declares CAMERA, but Android 6+ also needs a runtime
    // grant on the host process — without it the WebView's per-page
    // permission grant succeeds but the underlying Camera2 open is
    // refused, surfacing in JS as NotReadableError. We capture the
    // result so we can show a recovery banner if the user has
    // permanently denied: that state can only be flipped from system
    // Settings, never from a re-prompt.
    if (!Platform.isAndroid) return;
    final status = await Permission.camera.request();
    if (!mounted) return;
    if (status.isPermanentlyDenied) {
      setState(() => _cameraPermanentlyDenied = true);
    }
  }

  Future<void> _refreshCameraStatus() async {
    if (!Platform.isAndroid) return;
    final status = await Permission.camera.status;
    if (!mounted) return;
    final denied = status.isPermanentlyDenied;
    if (denied != _cameraPermanentlyDenied) {
      setState(() => _cameraPermanentlyDenied = denied);
    }
  }

  void _close(String source) {
    if (!mounted || !Navigator.canPop(context)) return;
    // Only surface the close-bridge in the snackbar if something went
    // wrong during this session; on the happy path the toast is just
    // noise. Errors are the case where knowing which bridge ran is
    // diagnostically useful.
    Navigator.pop(context, _hadErrorDuringSession ? source : null);
  }

  void _retry() {
    _fadeTimer?.cancel();
    setState(() {
      _error = null;
      _loading = true;
      _initialLoadComplete = false;
    });
    _controller.loadRequest(_handoff);
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
            ignoring: !_loading || _error != null,
            child: AnimatedOpacity(
              opacity: _loading && _error == null ? 1.0 : 0.0,
              duration: const Duration(milliseconds: 220),
              curve: Curves.easeOut,
              child: Container(
                color: Colors.white,
                alignment: Alignment.center,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // Render the launcher tile ourselves: brand-color
                    // squircle + the transparent foreground icon, with
                    // padding around it. icon.png alone is the masked
                    // master and looks cropped when shown raw because
                    // its content reaches the canvas edge.
                    Container(
                      width: 96,
                      height: 96,
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: const Color(0xFF0F766E),
                        borderRadius: BorderRadius.circular(22),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.08),
                            blurRadius: 12,
                            offset: const Offset(0, 4),
                          ),
                        ],
                      ),
                      child: Image.asset(
                        'assets/icon-fg.png',
                        fit: BoxFit.contain,
                      ),
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
          if (_error != null)
            _ErrorOverlay(
              error: _error!,
              url: _handoff,
              onRetry: _retry,
              onBack: () => Navigator.of(context).maybePop(),
            ),
          if (_cameraPermanentlyDenied)
            const Align(
              alignment: Alignment.topCenter,
              child: SafeArea(child: _CameraDeniedBanner()),
            ),
        ],
      ),
    );
  }
}

class _ErrorOverlay extends StatelessWidget {
  final WebResourceError error;
  final Uri url;
  final VoidCallback onRetry;
  final VoidCallback onBack;

  const _ErrorOverlay({
    required this.error,
    required this.url,
    required this.onRetry,
    required this.onBack,
  });

  @override
  Widget build(BuildContext context) {
    final desc = error.description.isNotEmpty
        ? error.description
        : 'No further detail from the WebView.';
    final type = error.errorType?.toString().split('.').last ?? 'unknown';
    return Container(
      color: Colors.white,
      alignment: Alignment.center,
      padding: const EdgeInsets.all(28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.cloud_off_outlined,
            size: 56,
            color: Colors.grey[600],
          ),
          const SizedBox(height: 18),
          Text(
            "Couldn't load carecart",
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
          ),
          const SizedBox(height: 10),
          Text(
            desc,
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.grey[700], fontSize: 13),
          ),
          const SizedBox(height: 6),
          Text(
            'code ${error.errorCode} · $type',
            style: TextStyle(color: Colors.grey[500], fontSize: 11),
          ),
          const SizedBox(height: 14),
          SelectableText(
            url.toString(),
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Colors.grey[500],
              fontSize: 11,
              fontFamily: 'monospace',
            ),
          ),
          const SizedBox(height: 26),
          FilledButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: const Text('Retry'),
          ),
          const SizedBox(height: 8),
          TextButton(
            onPressed: onBack,
            child: const Text('Back'),
          ),
        ],
      ),
    );
  }
}

class _CameraDeniedBanner extends StatelessWidget {
  const _CameraDeniedBanner();

  @override
  Widget build(BuildContext context) {
    final accent = Colors.amber[900]!;
    return Material(
      color: const Color(0xFFFFF4D6),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Row(
          children: [
            Icon(Icons.camera_alt_outlined, size: 18, color: accent),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                "Camera permission is blocked. The QR scanner won't open until you allow it in Settings.",
                style: TextStyle(fontSize: 12, color: accent, height: 1.3),
              ),
            ),
            const SizedBox(width: 6),
            TextButton(
              onPressed: openAppSettings,
              style: TextButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 10),
                minimumSize: const Size(0, 32),
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              child: Text(
                'Open Settings',
                style: TextStyle(color: accent, fontWeight: FontWeight.w700),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

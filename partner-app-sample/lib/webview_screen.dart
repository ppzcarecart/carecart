import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

/// Embeds the carecart H5 handoff URL in a WebView. Intercepts navigation
/// to the configured close-URL (e.g. papazao://close) and pops back to
/// the partner app's home screen — exactly what the production partner
/// app's webview delegate is expected to do.
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

  @override
  void initState() {
    super.initState();

    final handoff = Uri.parse(
      '${widget.baseUrl}/h5/login'
      '?ppzid=${Uri.encodeComponent(widget.ppzId)}'
      '&email=${Uri.encodeComponent(widget.email)}',
    );

    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.white)
      ..setNavigationDelegate(NavigationDelegate(
        onPageStarted: (_) {
          if (mounted) setState(() => _loading = true);
        },
        onPageFinished: (_) {
          if (mounted) setState(() => _loading = false);
        },
        onNavigationRequest: (req) {
          // Carecart fires this URL from its mobile bottom-nav Home
          // button. Intercept it, don't let the webview navigate, and
          // close this screen so the user is back on the partner app's
          // home.
          final close = widget.closeUrl.trim();
          if (close.isNotEmpty && req.url.startsWith(close)) {
            if (mounted) Navigator.pop(context);
            return NavigationDecision.prevent;
          }
          return NavigationDecision.navigate;
        },
      ))
      ..loadRequest(handoff);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      // No AppBar — full-screen webview so the close button has to be the
      // carecart Home button (which is what we're testing). The Android
      // system back button still works as a manual escape hatch.
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

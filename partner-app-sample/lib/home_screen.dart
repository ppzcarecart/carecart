import 'package:flutter/material.dart';
import 'settings_screen.dart';
import 'settings_store.dart';
import 'webview_screen.dart';

/// Tap the Shop tile to launch carecart in a webview using the configured
/// PPZ ID and email. The cog icon opens the Settings screen.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  SettingsData? _data;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final s = await SettingsStore.load();
    if (!mounted) return;
    setState(() => _data = s);
  }

  Future<void> _openSettings() async {
    await Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const SettingsScreen()),
    );
    _load();
  }

  Future<void> _openShop() async {
    final d = _data;
    if (d == null || d.ppzId.isEmpty || d.email.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Set PPZ ID and email in Settings first.'),
        ),
      );
      return;
    }
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => WebViewScreen(
          ppzId: d.ppzId,
          email: d.email,
          baseUrl: d.baseUrl,
          closeUrl: d.closeUrl,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final ppzLine = _data == null
        ? '…'
        : (_data!.ppzId.isEmpty
            ? 'No customer configured'
            : 'PPZ ${_data!.ppzId} · ${_data!.email}');

    return Scaffold(
      appBar: AppBar(
        title: const Text('Partner App'),
        actions: [
          IconButton(
            tooltip: 'Settings',
            icon: const Icon(Icons.settings_outlined),
            onPressed: _openSettings,
          ),
        ],
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              InkWell(
                onTap: _openShop,
                borderRadius: BorderRadius.circular(28),
                child: Container(
                  width: 180,
                  height: 180,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [Color(0xFF0F766E), Color(0xFF14B8A6)],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    borderRadius: BorderRadius.circular(28),
                    boxShadow: const [
                      BoxShadow(
                        color: Colors.black12,
                        blurRadius: 24,
                        offset: Offset(0, 10),
                      ),
                    ],
                  ),
                  child: const Icon(
                    Icons.shopping_bag_outlined,
                    color: Colors.white,
                    size: 88,
                  ),
                ),
              ),
              const SizedBox(height: 18),
              Text(
                'Shop',
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
              ),
              const SizedBox(height: 6),
              Text(
                'Tap to open carecart',
                style: TextStyle(color: Colors.grey[600]),
              ),
              const SizedBox(height: 32),
              Text(
                ppzLine,
                style: TextStyle(color: Colors.grey[700], fontSize: 13),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              if (_data != null && _data!.ppzId.isEmpty)
                FilledButton.tonal(
                  onPressed: _openSettings,
                  child: const Text('Set PPZ ID & email'),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

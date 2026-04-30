import 'package:flutter/material.dart';
import 'settings_store.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final _ppzCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _baseCtrl = TextEditingController();
  final _closeCtrl = TextEditingController();
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final s = await SettingsStore.load();
    if (!mounted) return;
    setState(() {
      _ppzCtrl.text = s.ppzId;
      _emailCtrl.text = s.email;
      _baseCtrl.text = s.baseUrl;
      _closeCtrl.text = s.closeUrl;
      _loading = false;
    });
  }

  Future<void> _save() async {
    await SettingsStore.save(SettingsData(
      ppzId: _ppzCtrl.text.trim(),
      email: _emailCtrl.text.trim(),
      baseUrl: _baseCtrl.text.trim().isEmpty
          ? SettingsStore.defaultBaseUrl
          : _baseCtrl.text.trim(),
      closeUrl: _closeCtrl.text.trim(),
    ));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Saved')),
    );
    Navigator.pop(context);
  }

  @override
  void dispose() {
    _ppzCtrl.dispose();
    _emailCtrl.dispose();
    _baseCtrl.dispose();
    _closeCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          const Text(
            'Customer',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _ppzCtrl,
            decoration: const InputDecoration(
              labelText: 'PPZ ID',
              hintText: 'e.g. 4896',
              border: OutlineInputBorder(),
            ),
            keyboardType: TextInputType.text,
            autocorrect: false,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _emailCtrl,
            decoration: const InputDecoration(
              labelText: 'Email',
              hintText: 'e.g. john@example.com',
              border: OutlineInputBorder(),
            ),
            keyboardType: TextInputType.emailAddress,
            autocorrect: false,
          ),
          const SizedBox(height: 28),
          const Text(
            'carecart endpoints',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _baseCtrl,
            decoration: const InputDecoration(
              labelText: 'Base URL',
              hintText: SettingsStore.defaultBaseUrl,
              border: OutlineInputBorder(),
            ),
            keyboardType: TextInputType.url,
            autocorrect: false,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _closeCtrl,
            decoration: const InputDecoration(
              labelText: 'Close deep-link URL',
              hintText: SettingsStore.defaultCloseUrl,
              border: OutlineInputBorder(),
              helperText: 'Carecart navigates here when the user taps Home '
                  'on the bottom nav. We intercept and pop the webview.',
              helperMaxLines: 3,
            ),
            keyboardType: TextInputType.url,
            autocorrect: false,
          ),
          const SizedBox(height: 28),
          FilledButton(
            onPressed: _save,
            style: FilledButton.styleFrom(
              minimumSize: const Size.fromHeight(48),
            ),
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }
}

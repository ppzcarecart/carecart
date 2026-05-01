import 'package:flutter/material.dart';
import 'settings_screen.dart';
import 'settings_store.dart';
import 'webview_screen.dart';

/// Tap the Shop tile to launch carecart in a webview using the active
/// account's PPZ ID and email. The header chip lets you switch between
/// configured accounts on the fly. The cog icon opens Settings.
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

  Future<void> _switchAccount(Account account) async {
    await SettingsStore.setActive(account.id);
    await _load();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Switched to ${account.displayName}')),
    );
  }

  Future<void> _openShop() async {
    final d = _data;
    final active = d?.activeAccount;
    if (d == null || active == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Add an account in Settings first.'),
        ),
      );
      return;
    }
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => WebViewScreen(
          ppzId: active.ppzId,
          email: active.email,
          baseUrl: d.baseUrl,
          closeUrl: d.closeUrl,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    final active = data?.activeAccount;
    final hasAccounts = data != null && data.accounts.isNotEmpty;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Partner App'),
        actions: [
          if (hasAccounts)
            PopupMenuButton<String>(
              tooltip: 'Switch account',
              icon: const Icon(Icons.switch_account_outlined),
              onSelected: (id) {
                if (id == '__add__') {
                  _openSettings();
                  return;
                }
                final acc = data.accounts.firstWhere((a) => a.id == id);
                _switchAccount(acc);
              },
              itemBuilder: (_) => [
                ...data.accounts.map(
                  (a) => PopupMenuItem<String>(
                    value: a.id,
                    child: Row(
                      children: [
                        Icon(
                          a.id == data.activeAccountId
                              ? Icons.radio_button_checked
                              : Icons.radio_button_unchecked,
                          size: 18,
                          color: a.id == data.activeAccountId
                              ? Theme.of(context).colorScheme.primary
                              : Colors.grey,
                        ),
                        const SizedBox(width: 10),
                        Flexible(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                a.displayName,
                                overflow: TextOverflow.ellipsis,
                              ),
                              Text(
                                'PPZ ${a.ppzId}',
                                style: const TextStyle(
                                  fontSize: 11,
                                  color: Colors.grey,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const PopupMenuDivider(),
                const PopupMenuItem<String>(
                  value: '__add__',
                  child: Row(
                    children: [
                      Icon(Icons.add, size: 18),
                      SizedBox(width: 10),
                      Text('Manage accounts…'),
                    ],
                  ),
                ),
              ],
            ),
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
              _ShopTile(onTap: _openShop),
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
              if (data == null)
                const Text('…')
              else if (active == null)
                Column(
                  children: [
                    Text(
                      'No account configured',
                      style: TextStyle(color: Colors.grey[700], fontSize: 13),
                    ),
                    const SizedBox(height: 8),
                    FilledButton.tonal(
                      onPressed: _openSettings,
                      child: const Text('Add an account'),
                    ),
                  ],
                )
              else
                _ActiveAccountChip(
                  account: active,
                  totalAccounts: data.accounts.length,
                  onTap: _openSettings,
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ShopTile extends StatefulWidget {
  final VoidCallback onTap;
  const _ShopTile({required this.onTap});

  @override
  State<_ShopTile> createState() => _ShopTileState();
}

class _ShopTileState extends State<_ShopTile> {
  bool _pressed = false;

  void _setPressed(bool v) {
    if (_pressed == v) return;
    setState(() => _pressed = v);
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTapDown: (_) => _setPressed(true),
      onTapUp: (_) => _setPressed(false),
      onTapCancel: () => _setPressed(false),
      onTap: widget.onTap,
      child: AnimatedScale(
        scale: _pressed ? 0.94 : 1.0,
        duration: const Duration(milliseconds: 110),
        curve: Curves.easeOut,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          curve: Curves.easeOut,
          width: 180,
          height: 180,
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: _pressed
                  ? const [Color(0xFF0B5F58), Color(0xFF0F938C)]
                  : const [Color(0xFF0F766E), Color(0xFF14B8A6)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(28),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: _pressed ? 0.18 : 0.12),
                blurRadius: _pressed ? 12 : 24,
                offset: Offset(0, _pressed ? 4 : 10),
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
    );
  }
}

class _ActiveAccountChip extends StatelessWidget {
  final Account account;
  final int totalAccounts;
  final VoidCallback onTap;

  const _ActiveAccountChip({
    required this.account,
    required this.totalAccounts,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(24),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: BoxDecoration(
          color: theme.colorScheme.primaryContainer.withValues(alpha: 0.4),
          borderRadius: BorderRadius.circular(24),
          border: Border.all(
            color: theme.colorScheme.primary.withValues(alpha: 0.3),
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.account_circle_outlined,
              size: 18,
              color: theme.colorScheme.primary,
            ),
            const SizedBox(width: 8),
            Flexible(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    account.displayName,
                    style: const TextStyle(
                      fontWeight: FontWeight.w600,
                      fontSize: 13,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                  Text(
                    'PPZ ${account.ppzId} · ${account.email}',
                    style: TextStyle(
                      color: Colors.grey[700],
                      fontSize: 11,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: theme.colorScheme.primary.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                '$totalAccounts',
                style: TextStyle(
                  color: theme.colorScheme.primary,
                  fontWeight: FontWeight.w700,
                  fontSize: 11,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
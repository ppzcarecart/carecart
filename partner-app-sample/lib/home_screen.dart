import 'package:flutter/material.dart';
import 'settings_screen.dart';
import 'settings_store.dart';
import 'webview_screen.dart';

/// The Shop entry point lives in the floating-center button of the
/// bottom nav bar; the home body is a quiet welcome card so the FAB is
/// the only thing tugging at attention. The header chip lets you switch
/// between configured accounts.
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
    final closedVia = await Navigator.push<String>(
      context,
      MaterialPageRoute<String>(
        builder: (_) => WebViewScreen(
          ppzId: active.ppzId,
          email: active.email,
          baseUrl: d.baseUrl,
          closeUrl: d.closeUrl,
        ),
      ),
    );
    if (!mounted) return;
    if (closedVia != null && closedVia.isNotEmpty) {
      // The whole point of this sample is verifying which close-bridge
      // carecart actually used; surfacing it on return makes that
      // visible to whoever is QAing the integration.
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Closed via $closedVia'),
          duration: const Duration(seconds: 4),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    final active = data?.activeAccount;
    final hasAccounts = data != null && data.accounts.isNotEmpty;

    return Scaffold(
      backgroundColor: const Color(0xFFF6F8FA),
      appBar: AppBar(
        title: const Text('Partner App'),
        backgroundColor: Colors.transparent,
        elevation: 0,
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
        ],
      ),
      body: Center(
        child: Padding(
          // Bottom padding accounts for the bar + the FAB protruding
          // above it, so content never crowds the nav.
          padding: const EdgeInsets.fromLTRB(24, 24, 24, 96),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const _BrandTile(),
              const SizedBox(height: 24),
              Text(
                'Welcome to carecart',
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
              ),
              const SizedBox(height: 6),
              Text(
                'Tap the Shop button below to launch',
                style: TextStyle(color: Colors.grey[600]),
              ),
              const SizedBox(height: 28),
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
      floatingActionButton: _ShopFab(onTap: _openShop),
      // centerDocked + a CircularNotchedRectangle on the BottomAppBar
      // is what gives the FAB its "floating out of the nav" silhouette:
      // the bar curves around the FAB's lower half so it visibly
      // breaks the bar's top edge.
      floatingActionButtonLocation: FloatingActionButtonLocation.centerDocked,
      bottomNavigationBar: _BottomBar(
        onHome: () {},
        onSettings: _openSettings,
      ),
    );
  }
}

class _BrandTile extends StatelessWidget {
  const _BrandTile();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 96,
      height: 96,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF0F766E),
        borderRadius: BorderRadius.circular(22),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.08),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Image.asset('assets/icon-fg.png', fit: BoxFit.contain),
    );
  }
}

class _ShopFab extends StatelessWidget {
  final VoidCallback onTap;
  const _ShopFab({required this.onTap});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 64,
      height: 64,
      child: FloatingActionButton(
        backgroundColor: const Color(0xFF0F766E),
        foregroundColor: Colors.white,
        elevation: 8,
        highlightElevation: 4,
        shape: const CircleBorder(),
        tooltip: 'Shop',
        onPressed: onTap,
        child: const Icon(Icons.shopping_bag_rounded, size: 28),
      ),
    );
  }
}

class _BottomBar extends StatelessWidget {
  final VoidCallback onHome;
  final VoidCallback onSettings;

  const _BottomBar({required this.onHome, required this.onSettings});

  @override
  Widget build(BuildContext context) {
    return BottomAppBar(
      shape: const CircularNotchedRectangle(),
      notchMargin: 8,
      color: Colors.white,
      elevation: 12,
      padding: EdgeInsets.zero,
      height: 64,
      child: Row(
        children: [
          Expanded(
            child: _BarItem(
              icon: Icons.home_rounded,
              label: 'Home',
              active: true,
              onTap: onHome,
            ),
          ),
          // Reserves horizontal space for the FAB so the labels on
          // either side don't crowd it. The FAB itself is 64px; the
          // extra padding gives the notch breathing room.
          const SizedBox(width: 80),
          Expanded(
            child: _BarItem(
              icon: Icons.settings_outlined,
              label: 'Settings',
              active: false,
              onTap: onSettings,
            ),
          ),
        ],
      ),
    );
  }
}

class _BarItem extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool active;
  final VoidCallback onTap;

  const _BarItem({
    required this.icon,
    required this.label,
    required this.active,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final color = active
        ? Theme.of(context).colorScheme.primary
        : Colors.grey[600];
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: color, size: 24),
            const SizedBox(height: 2),
            Text(
              label,
              style: TextStyle(
                color: color,
                fontSize: 11,
                fontWeight: active ? FontWeight.w700 : FontWeight.w500,
              ),
            ),
          ],
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
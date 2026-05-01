import 'package:flutter/material.dart';
import 'settings_store.dart';

/// Settings as embeddable content (no Scaffold/AppBar of its own) so
/// it can live as a tab inside HomeScreen's IndexedStack — the
/// surrounding Scaffold supplies the AppBar title and bottom nav, and
/// state survives tab toggles because IndexedStack keeps both children
/// mounted.
///
/// [onChanged] fires after every mutation (account add/edit/delete,
/// active switch, endpoint save) so the parent can reload its own
/// snapshot of SettingsData — otherwise Home's account-switcher popup
/// would go stale until the user toggled tabs.
class SettingsContent extends StatefulWidget {
  final VoidCallback? onChanged;
  const SettingsContent({super.key, this.onChanged});

  @override
  State<SettingsContent> createState() => _SettingsContentState();
}

class _SettingsContentState extends State<SettingsContent> {
  final _baseCtrl = TextEditingController();
  final _closeCtrl = TextEditingController();
  SettingsData? _data;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final s = await SettingsStore.load();
    if (!mounted) return;
    setState(() {
      _data = s;
      _baseCtrl.text = s.baseUrl;
      _closeCtrl.text = s.closeUrl;
    });
  }

  void _notifyChanged() => widget.onChanged?.call();

  Future<void> _saveEndpoints() async {
    await SettingsStore.saveEndpoints(
      baseUrl: _baseCtrl.text.trim().isEmpty
          ? SettingsStore.defaultBaseUrl
          : _baseCtrl.text.trim(),
      closeUrl: _closeCtrl.text.trim(),
    );
    _notifyChanged();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Endpoints saved')),
    );
  }

  Future<void> _addAccount() async {
    final result = await _showAccountEditor();
    if (result == null) return;
    await SettingsStore.addAccount(
      ppzId: result.ppzId,
      email: result.email,
      label: result.label,
    );
    await _load();
    _notifyChanged();
  }

  Future<void> _editAccount(Account account) async {
    final result = await _showAccountEditor(initial: account);
    if (result == null) return;
    await SettingsStore.updateAccount(
      account.copyWith(
        ppzId: result.ppzId,
        email: result.email,
        label: result.label,
      ),
    );
    await _load();
    _notifyChanged();
  }

  Future<void> _deleteAccount(Account account) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete account?'),
        content: Text('Remove ${account.displayName}?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton.tonal(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirm != true) return;
    await SettingsStore.deleteAccount(account.id);
    await _load();
    _notifyChanged();
  }

  Future<void> _setActive(Account account) async {
    await SettingsStore.setActive(account.id);
    await _load();
    _notifyChanged();
  }

  Future<_AccountFormResult?> _showAccountEditor({Account? initial}) {
    return showDialog<_AccountFormResult>(
      context: context,
      builder: (_) => _AccountEditorDialog(initial: initial),
    );
  }

  @override
  void dispose() {
    _baseCtrl.dispose();
    _closeCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    if (data == null) {
      return const Center(child: CircularProgressIndicator());
    }
    return ListView(
      // Bottom padding clears the bottom nav + the FAB protruding
      // above it so the Save button isn't trapped under the FAB.
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 100),
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text(
              'Accounts',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
            ),
            FilledButton.tonalIcon(
              onPressed: _addAccount,
              icon: const Icon(Icons.add),
              label: const Text('Add'),
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (data.accounts.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 16),
            child: Text(
              'No accounts yet. Tap Add to create one.',
              style: TextStyle(color: Colors.grey),
            ),
          )
        else
          ...data.accounts.map((a) {
            final isActive = a.id == data.activeAccountId;
            return Card(
              margin: const EdgeInsets.symmetric(vertical: 6),
              child: ListTile(
                leading: Icon(
                  isActive
                      ? Icons.radio_button_checked
                      : Icons.radio_button_unchecked,
                  color: isActive
                      ? Theme.of(context).colorScheme.primary
                      : Colors.grey,
                ),
                title: Text(
                  a.displayName,
                  style: TextStyle(
                    fontWeight:
                        isActive ? FontWeight.w700 : FontWeight.w500,
                  ),
                ),
                subtitle: Text('PPZ ${a.ppzId} · ${a.email}'),
                onTap: isActive ? null : () => _setActive(a),
                trailing: PopupMenuButton<String>(
                  onSelected: (value) {
                    switch (value) {
                      case 'edit':
                        _editAccount(a);
                        break;
                      case 'delete':
                        _deleteAccount(a);
                        break;
                      case 'activate':
                        _setActive(a);
                        break;
                    }
                  },
                  itemBuilder: (_) => [
                    if (!isActive)
                      const PopupMenuItem(
                        value: 'activate',
                        child: Text('Set active'),
                      ),
                    const PopupMenuItem(
                      value: 'edit',
                      child: Text('Edit'),
                    ),
                    const PopupMenuItem(
                      value: 'delete',
                      child: Text('Delete'),
                    ),
                  ],
                ),
              ),
            );
          }),
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
        const SizedBox(height: 20),
        FilledButton(
          onPressed: _saveEndpoints,
          style: FilledButton.styleFrom(
            minimumSize: const Size.fromHeight(48),
          ),
          child: const Text('Save endpoints'),
        ),
      ],
    );
  }
}

class _AccountFormResult {
  final String ppzId;
  final String email;
  final String label;
  const _AccountFormResult({
    required this.ppzId,
    required this.email,
    required this.label,
  });
}

class _AccountEditorDialog extends StatefulWidget {
  final Account? initial;
  const _AccountEditorDialog({this.initial});

  @override
  State<_AccountEditorDialog> createState() => _AccountEditorDialogState();
}

class _AccountEditorDialogState extends State<_AccountEditorDialog> {
  late final TextEditingController _ppzCtrl;
  late final TextEditingController _emailCtrl;
  late final TextEditingController _labelCtrl;
  final _formKey = GlobalKey<FormState>();

  @override
  void initState() {
    super.initState();
    _ppzCtrl = TextEditingController(text: widget.initial?.ppzId ?? '');
    _emailCtrl = TextEditingController(text: widget.initial?.email ?? '');
    _labelCtrl = TextEditingController(text: widget.initial?.label ?? '');
  }

  @override
  void dispose() {
    _ppzCtrl.dispose();
    _emailCtrl.dispose();
    _labelCtrl.dispose();
    super.dispose();
  }

  void _submit() {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    Navigator.pop(
      context,
      _AccountFormResult(
        ppzId: _ppzCtrl.text.trim(),
        email: _emailCtrl.text.trim(),
        label: _labelCtrl.text.trim(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isEdit = widget.initial != null;
    return AlertDialog(
      title: Text(isEdit ? 'Edit account' : 'Add account'),
      content: Form(
        key: _formKey,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextFormField(
                controller: _labelCtrl,
                decoration: const InputDecoration(
                  labelText: 'Label (optional)',
                  hintText: 'e.g. Test 1, QA, John',
                  border: OutlineInputBorder(),
                ),
                autocorrect: false,
                textInputAction: TextInputAction.next,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _ppzCtrl,
                decoration: const InputDecoration(
                  labelText: 'PPZ ID',
                  hintText: 'e.g. 4896',
                  border: OutlineInputBorder(),
                ),
                autocorrect: false,
                textInputAction: TextInputAction.next,
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'Required' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _emailCtrl,
                decoration: const InputDecoration(
                  labelText: 'Email',
                  hintText: 'e.g. john@example.com',
                  border: OutlineInputBorder(),
                ),
                keyboardType: TextInputType.emailAddress,
                autocorrect: false,
                textInputAction: TextInputAction.done,
                onFieldSubmitted: (_) => _submit(),
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'Required' : null,
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _submit,
          child: Text(isEdit ? 'Save' : 'Add'),
        ),
      ],
    );
  }
}
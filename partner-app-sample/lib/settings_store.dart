import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

/// One configured customer (PPZ ID + email). Identified by a stable [id]
/// so the active selection survives edits to the label or fields.
class Account {
  final String id;
  final String ppzId;
  final String email;
  final String label;

  const Account({
    required this.id,
    required this.ppzId,
    required this.email,
    this.label = '',
  });

  String get displayName =>
      label.isNotEmpty ? label : (email.isNotEmpty ? email : 'PPZ $ppzId');

  Account copyWith({String? ppzId, String? email, String? label}) => Account(
        id: id,
        ppzId: ppzId ?? this.ppzId,
        email: email ?? this.email,
        label: label ?? this.label,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'ppzId': ppzId,
        'email': email,
        'label': label,
      };

  static Account fromJson(Map<String, dynamic> json) => Account(
        id: json['id'] as String,
        ppzId: (json['ppzId'] as String?) ?? '',
        email: (json['email'] as String?) ?? '',
        label: (json['label'] as String?) ?? '',
      );
}

class SettingsData {
  final List<Account> accounts;
  final String? activeAccountId;
  final String baseUrl;
  final String closeUrl;

  const SettingsData({
    required this.accounts,
    required this.activeAccountId,
    required this.baseUrl,
    required this.closeUrl,
  });

  Account? get activeAccount {
    if (activeAccountId == null) return null;
    for (final a in accounts) {
      if (a.id == activeAccountId) return a;
    }
    return null;
  }
}

class SettingsStore {
  static const _kAccounts = 'accounts';
  static const _kActiveAccountId = 'activeAccountId';
  static const _kBaseUrl = 'baseUrl';
  static const _kCloseUrl = 'closeUrl';

  // Legacy single-account keys; migrated on first load.
  static const _kLegacyPpzId = 'ppzId';
  static const _kLegacyEmail = 'email';

  static const defaultBaseUrl = 'https://web-production-ae5ea.up.railway.app';
  static const defaultCloseUrl = 'papazao://close';

  static Future<SettingsData> load() async {
    final p = await SharedPreferences.getInstance();
    final raw = p.getString(_kAccounts);
    var accounts = <Account>[];
    if (raw != null && raw.isNotEmpty) {
      final list = jsonDecode(raw) as List<dynamic>;
      accounts = list
          .map((e) => Account.fromJson(e as Map<String, dynamic>))
          .toList();
    } else {
      // Migrate from the old single-account layout.
      final ppz = p.getString(_kLegacyPpzId) ?? '';
      final email = p.getString(_kLegacyEmail) ?? '';
      if (ppz.isNotEmpty || email.isNotEmpty) {
        final migrated = Account(
          id: _newId(),
          ppzId: ppz,
          email: email,
        );
        accounts = [migrated];
        await _persistAccounts(p, accounts);
        await p.setString(_kActiveAccountId, migrated.id);
      }
    }
    var activeId = p.getString(_kActiveAccountId);
    if (activeId != null && !accounts.any((a) => a.id == activeId)) {
      activeId = null;
    }
    if (activeId == null && accounts.isNotEmpty) {
      activeId = accounts.first.id;
      await p.setString(_kActiveAccountId, activeId);
    }
    return SettingsData(
      accounts: accounts,
      activeAccountId: activeId,
      baseUrl: p.getString(_kBaseUrl) ?? defaultBaseUrl,
      closeUrl: p.getString(_kCloseUrl) ?? defaultCloseUrl,
    );
  }

  static Future<void> saveEndpoints({
    required String baseUrl,
    required String closeUrl,
  }) async {
    final p = await SharedPreferences.getInstance();
    await p.setString(_kBaseUrl, baseUrl);
    await p.setString(_kCloseUrl, closeUrl);
  }

  static Future<Account> addAccount({
    required String ppzId,
    required String email,
    String label = '',
  }) async {
    final p = await SharedPreferences.getInstance();
    final accounts = await _readAccounts(p);
    final account = Account(
      id: _newId(),
      ppzId: ppzId,
      email: email,
      label: label,
    );
    accounts.add(account);
    await _persistAccounts(p, accounts);
    if ((p.getString(_kActiveAccountId) ?? '').isEmpty) {
      await p.setString(_kActiveAccountId, account.id);
    }
    return account;
  }

  static Future<void> updateAccount(Account updated) async {
    final p = await SharedPreferences.getInstance();
    final accounts = await _readAccounts(p);
    final idx = accounts.indexWhere((a) => a.id == updated.id);
    if (idx == -1) return;
    accounts[idx] = updated;
    await _persistAccounts(p, accounts);
  }

  static Future<void> deleteAccount(String id) async {
    final p = await SharedPreferences.getInstance();
    final accounts = await _readAccounts(p);
    accounts.removeWhere((a) => a.id == id);
    await _persistAccounts(p, accounts);
    final activeId = p.getString(_kActiveAccountId);
    if (activeId == id) {
      if (accounts.isNotEmpty) {
        await p.setString(_kActiveAccountId, accounts.first.id);
      } else {
        await p.remove(_kActiveAccountId);
      }
    }
  }

  static Future<void> setActive(String id) async {
    final p = await SharedPreferences.getInstance();
    await p.setString(_kActiveAccountId, id);
  }

  static Future<List<Account>> _readAccounts(SharedPreferences p) async {
    final raw = p.getString(_kAccounts);
    if (raw == null || raw.isEmpty) return [];
    final list = jsonDecode(raw) as List<dynamic>;
    return list
        .map((e) => Account.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  static Future<void> _persistAccounts(
    SharedPreferences p,
    List<Account> accounts,
  ) async {
    await p.setString(
      _kAccounts,
      jsonEncode(accounts.map((a) => a.toJson()).toList()),
    );
  }

  static String _newId() =>
      DateTime.now().microsecondsSinceEpoch.toRadixString(36);
}
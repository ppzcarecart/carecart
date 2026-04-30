import 'package:shared_preferences/shared_preferences.dart';

/// Persistent settings for the sample partner app. Backed by
/// shared_preferences so values survive app restarts.
class SettingsData {
  final String ppzId;
  final String email;
  final String baseUrl;
  final String closeUrl;

  const SettingsData({
    required this.ppzId,
    required this.email,
    required this.baseUrl,
    required this.closeUrl,
  });
}

class SettingsStore {
  static const _kPpzId = 'ppzId';
  static const _kEmail = 'email';
  static const _kBaseUrl = 'baseUrl';
  static const _kCloseUrl = 'closeUrl';

  static const defaultBaseUrl = 'https://web-production-ae5ea.up.railway.app';
  static const defaultCloseUrl = 'papazao://close';

  static Future<SettingsData> load() async {
    final p = await SharedPreferences.getInstance();
    return SettingsData(
      ppzId: p.getString(_kPpzId) ?? '',
      email: p.getString(_kEmail) ?? '',
      baseUrl: p.getString(_kBaseUrl) ?? defaultBaseUrl,
      closeUrl: p.getString(_kCloseUrl) ?? defaultCloseUrl,
    );
  }

  static Future<void> save(SettingsData data) async {
    final p = await SharedPreferences.getInstance();
    await p.setString(_kPpzId, data.ppzId);
    await p.setString(_kEmail, data.email);
    await p.setString(_kBaseUrl, data.baseUrl);
    await p.setString(_kCloseUrl, data.closeUrl);
  }
}

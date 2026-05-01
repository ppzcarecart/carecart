# Carecart partner-app sample (Flutter)

A minimal Flutter app that simulates the partner app on Android. It has:

- A **Shop** tile on the home screen.
- A **Settings** screen where you can save the customer's PPZ ID, email,
  the carecart base URL, and the close-deep-link URL.
- A **WebView** that opens carecart's H5 handoff with the saved PPZ ID and
  email and intercepts the configured close URL to dismiss back to the
  home screen — exactly the behaviour the production partner-app webview
  delegate needs to implement.

Use this to verify the carecart "Home" button on the mobile bottom nav
actually closes the webview and lands the user back in the native app.

## What's in this folder

```
partner-app-sample/
├── pubspec.yaml             // Flutter manifest + deps + launcher-icon config
├── analysis_options.yaml    // lint config
├── assets/
│   ├── icon.png             // 1024×1024 carecart icon master
│   └── icon-fg.png          // adaptive-icon foreground (transparent)
├── lib/
│   ├── main.dart            // app entry, theme
│   ├── home_screen.dart     // Shop tile + settings link
│   ├── settings_screen.dart // form for ppzId / email / baseUrl / closeUrl
│   ├── settings_store.dart  // shared_preferences wrapper
│   └── webview_screen.dart  // embeds carecart, intercepts close URL
└── README.md
```

`android/` and `ios/` aren't checked in — you generate them locally with
`flutter create .` (one command, see step 2 below).

## Prerequisites

1. **Flutter SDK** installed and on your PATH:
   <https://docs.flutter.dev/get-started/install>
2. **Android Studio** with the Flutter and Dart plugins.
3. **An Android emulator** (Tools → Device Manager → Create device) OR a
   physical Android device with USB debugging enabled.

Verify Flutter sees Android Studio:

```bash
flutter doctor
```

Anything in red there should be fixed before continuing.

## First-time setup

```bash
cd partner-app-sample

# Generate the Android (and iOS) platform scaffolding into this folder.
# Pick any package id you like — this one's just an example.
flutter create --org com.example --project-name carecart_partner_sample .

# Pull dependencies.
flutter pub get
```

`flutter create .` is non-destructive — it adds `android/`, `ios/`,
`linux/`, etc. and leaves your existing `lib/` and `pubspec.yaml` alone.

### Generate the carecart launcher icon

The repo ships with the carecart icon master at
[`assets/icon.png`](assets/icon.png) (1024×1024) and the adaptive-icon
foreground at [`assets/icon-fg.png`](assets/icon-fg.png). Run
`flutter_launcher_icons` once and it'll write the per-platform icon
files into the `android/` and `ios/` projects you just generated:

```bash
dart run flutter_launcher_icons
```

That populates:

- Android: `android/app/src/main/res/mipmap-*/ic_launcher.png` plus
  the adaptive-icon XML and foreground at every density (mdpi → xxxhdpi)
- iOS: `ios/Runner/Assets.xcassets/AppIcon.appiconset/*.png` at every
  size the App Store / home screen needs

Re-run the command any time you tweak `assets/icon.png` or
`assets/icon-fg.png`. The config is in `pubspec.yaml` under
`flutter_launcher_icons:`.

### Add camera permission to the platform projects

The carecart **Manage Collection** page uses the device camera to scan
collection QRs. The Android WebView and iOS WKWebView won't request
camera access until the host app has the right manifest entries — even
with the runtime permission grant code in `lib/webview_screen.dart`.

After running `flutter create .`, edit two files:

**`android/app/src/main/AndroidManifest.xml`** — add inside `<manifest>`,
above the existing `<application>` tag:

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-feature android:name="android.hardware.camera" android:required="false" />
```

**`ios/Runner/Info.plist`** — add inside the top-level `<dict>`:

```xml
<key>NSCameraUsageDescription</key>
<string>Carecart needs the camera to scan collection QR codes.</string>
```

Without these the camera silently fails when staff tap **Start camera**
inside the webview, even though the page itself shows no error.

## Open in Android Studio

1. Android Studio → **Open** → pick the `partner-app-sample` folder.
2. Wait for the Gradle sync to finish.
3. In the run-target dropdown (top toolbar) pick your emulator or
   connected device.
4. Click **Run ▶**.

You can also run from the command line:

```bash
flutter run
```

## Using the app

1. The home screen shows a green **Shop** tile and a cog icon (top right).
2. Tap the cog → fill in **PPZ ID**, **Email**, leave **Base URL** as
   `https://web-production-ae5ea.up.railway.app`, leave **Close URL** as
   `papazao://close` (or change to whatever the carecart admin set in
   `/admin/settings → Partner integration`).
3. Tap **Save** → returns to the home screen.
4. Tap the **Shop** tile → carecart loads in a full-screen webview using
   `/h5/login?ppzid=…&email=…`. The handoff signs the user in
   automatically.
5. Inside carecart, tap the **Home** icon on the mobile bottom nav. The
   webview should close and you're back on the partner-app home.

## What's actually being tested

Carecart's `ppz.exitToApp()` (see `public/app.js`) tries **three** native
bridges in order. This sample wires up all three so the production
partner-app team can pick whichever fits their stack — and verify each
one works end-to-end before committing.

All three end up calling `Navigator.pop(context)`. See
[`lib/webview_screen.dart`](lib/webview_screen.dart).

### 1. iOS WKWebView script message handler

Carecart calls:

```js
window.webkit.messageHandlers.closeWebView.postMessage(null)
```

In Flutter we just register a JavaScript channel named `closeWebView`:

```dart
..addJavaScriptChannel(
  'closeWebView',
  onMessageReceived: (_) => _close(),
);
```

On iOS, `webview_flutter` publishes the channel at exactly
`window.webkit.messageHandlers.closeWebView`, so carecart's iOS path
hits this handler with no extra glue.

### 2. Android `window.Android.closeWebView()`

Carecart's Android path (the convention most production Android partner
apps use via `@JavascriptInterface`) calls:

```js
window.Android.closeWebView()
```

Flutter's channel API only exposes `window.<name>.postMessage(...)`, not
arbitrary methods on a named object, so we inject a tiny shim on every
`onPageFinished` that defines `window.Android.closeWebView` to forward
to the same Flutter channel:

```js
window.Android = window.Android || {};
window.Android.closeWebView = function () {
  window.closeWebView.postMessage('close');
};
```

### 3. URL-scheme deep link

If neither bridge is registered, carecart falls back to
`window.location.href = '<closeUrl>'` (defaults to `papazao://close`).
We catch it in `onNavigationRequest` before the webview tries to load
the unknown scheme:

```dart
onNavigationRequest: (req) {
  if (close.isNotEmpty && req.url.startsWith(close)) {
    _close();
    return NavigationDecision.prevent;
  }
  return NavigationDecision.navigate;
},
```

The production partner app does the equivalent in its native
`WKWebView` / `WebView` delegate (see the main carecart README's
*Partner integration* section).

### 4. Camera access for the Manage Collection scanner

When admin/manager/vendor open `/admin/collection` (or
`/vendor/collection`) and tap **Start camera**, the page calls
`navigator.mediaDevices.getUserMedia`. For that to work inside an
Android WebView the host app has to:

1. **Hold the runtime CAMERA permission** — we call
   `Permission.camera.request()` in `_WebViewScreenState.initState`
   so the user is prompted the first time they open the webview.
2. **Grant the per-page permission request** — Android's WebView
   denies every `getUserMedia` call by default. We use
   `AndroidWebViewController.setOnPlatformPermissionRequest` to
   `grant()` camera/microphone requests and `deny()` the rest:

   ```dart
   if (controller.platform is AndroidWebViewController) {
     final android = controller.platform as AndroidWebViewController;
     android.setOnPlatformPermissionRequest((request) async {
       final wantsCamera = request.types.any((t) =>
           t == WebViewPermissionResourceType.camera ||
           t == WebViewPermissionResourceType.microphone);
       if (wantsCamera) await request.grant();
       else await request.deny();
     });
   }
   ```

iOS WKWebView shows a native camera prompt automatically when the page
calls `getUserMedia`, provided `NSCameraUsageDescription` is present in
`Info.plist`.

The production partner app needs the equivalent: CAMERA in the
manifest, the runtime permission grant, and either
`onPermissionRequest` (native Android `WebChromeClient`) or
`setOnPlatformPermissionRequest` (Flutter) to grant the page's camera
request.

## Troubleshooting

- **"Tap to open Shop" does nothing** → you haven't saved a PPZ ID +
  email in Settings. Snackbar should tell you.
- **Webview shows a partner-API error page** → either the PPZ ID isn't
  in the partner system, the email doesn't match the partner record, or
  carecart's `PPZ_API_KEY` env var isn't set. Open the URL on a desktop
  browser to see the carecart `/login?error=<code>` redirect.
- **Home button on carecart doesn't close the webview** → the configured
  Close URL doesn't match. Carecart admin sets it under
  `/admin/settings → Partner integration`. Whatever's there must equal
  what you typed in the sample app's Settings.
- **Can't see network traffic** → use Chrome DevTools at
  `chrome://inspect/#devices` while the emulator is running and the
  webview is loaded. You'll see all the requests and console logs.
- **Camera blocked on Manage Collection / Start camera** → three things
  to check, in order:
  1. The CAMERA `<uses-permission>` is in
     `android/app/src/main/AndroidManifest.xml` (see *First-time setup*).
  2. The user actually granted camera permission to the host app.
     Settings → Apps → carecart_partner_sample → Permissions → Camera.
  3. Hot-restart isn't enough after editing the manifest — fully kill
     the app and `flutter run` again so the new permission registers.
  Inside the webview the page detects "I'm in an Android WebView" and
  surfaces a hint pointing the user to fix the host app, but it can't
  fix it for them.

## Once you're satisfied

Hand the production iOS / Android team:
- The carecart base URL.
- The H5 handoff URL pattern: `/h5/login?ppzid=…&email=…`.
- The Close URL value from `/admin/settings → Partner integration`.
- Confirmation of which of the three close paths their stack will use
  (iOS message handler `closeWebView`, Android JS interface
  `Android.closeWebView`, or URL scheme) — this sample proves all three
  work, so the choice is theirs.
- The camera-access checklist for `/admin/collection`:
  - Android: CAMERA in manifest + runtime permission grant +
    `WebChromeClient.onPermissionRequest` (or Flutter's
    `setOnPlatformPermissionRequest`) granting camera/mic.
  - iOS: `NSCameraUsageDescription` in `Info.plist` — WKWebView prompts
    automatically.
- The relevant interception snippet from this app's
  `webview_screen.dart` (Flutter) or the carecart README (Swift /
  Kotlin equivalents).

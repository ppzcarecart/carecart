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
├── pubspec.yaml             // Flutter manifest + dependencies
├── analysis_options.yaml    // lint config
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

The bit we care about is in [`lib/webview_screen.dart`](lib/webview_screen.dart):

```dart
onNavigationRequest: (req) {
  if (close.isNotEmpty && req.url.startsWith(close)) {
    if (mounted) Navigator.pop(context);
    return NavigationDecision.prevent;
  }
  return NavigationDecision.navigate;
},
```

When carecart's bottom-nav **Home** button fires, its JS does
`window.location.href = '<closeUrl>'`. The webview asks Flutter "should I
navigate to this?" via `onNavigationRequest`. We check the URL, recognise
it as the close command, return `NavigationDecision.prevent` (so the
webview never tries to actually load `papazao://close` — it can't), and
pop the screen.

That's the full integration. The production partner app does the
equivalent in its native `WKWebView` / `WebView` delegate (see the main
carecart README's *Partner integration* section).

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

## Once you're satisfied

Hand the production iOS / Android team:
- The carecart base URL.
- The H5 handoff URL pattern: `/h5/login?ppzid=…&email=…`.
- The Close URL value from `/admin/settings → Partner integration`.
- The 4-line interception snippet they need (see this app's
  `webview_screen.dart` for Flutter, or the carecart README for the
  Swift / Kotlin equivalents).

import type { ExpoConfig } from 'expo/config';

/**
 * Passkeys on a device are bound to a relying-party domain. EXPO_PUBLIC_RP_ID
 * names it; the host must serve /.well-known/apple-app-site-association and
 * /.well-known/assetlinks.json listing this app (templates in well-known/).
 * Unset, the native build has no associated domain and passkeys work only in
 * the web build, where the page's own host is the relying party.
 */
const rpId = process.env.EXPO_PUBLIC_RP_ID;

// The app's permanent identity in both stores: the site's domain reversed,
// as Apple asks. Fixed once the first build is uploaded; never rename.
const applicationId = 'work.inflight.taptrader';

const config: ExpoConfig = {
  name: 'Tap Trader',
  slug: 'tap-trader',
  version: '1.0.0',
  orientation: 'portrait',
  // Every icon here is generated: `node design/brand/export.mjs` draws the
  // mark and copies the set into assets/images/. Never edit one by hand.
  icon: './assets/images/icon.png',
  scheme: 'taptrader',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: applicationId,
    // The team that owns the bundle id. Xcode needs it to build a target with
    // entitlements, simulator included; signing for a device additionally
    // needs the Apple account in Xcode.
    appleTeamId: '9Q73U33Y7D',
    // A light and a dark ground, plus the greyscale master iOS tints itself.
    icon: {
      light: './assets/images/icon.png',
      dark: './assets/images/icon-dark.png',
      tinted: './assets/images/icon-tinted.png',
    },
    // The app signs (passkeys, Ed25519, secp256k1) and talks over TLS; it
    // ships no encryption of its own, so the export-compliance question in
    // App Store Connect is answered here, once, and TestFlight does not ask.
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
    ...(rpId ? { associatedDomains: [`webcredentials:${rpId}`] } : {}),
  },
  android: {
    package: applicationId,
    // Firebase names the app to Google's push service. The file is not in the
    // repository — this one is public — so EAS hands it to the build as a file
    // variable; without it the app builds and simply never asks for a token.
    ...(process.env.GOOGLE_SERVICES_JSON ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON } : {}),
    // The foreground stays inside the adaptive icon's safe circle, so the
    // ground is a flat brand colour rather than a second image to mask.
    adaptiveIcon: {
      backgroundColor: '#FBFAF9',
      foregroundImage: './assets/images/android-icon-foreground.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: { output: 'static', bundler: 'metro', favicon: './assets/images/favicon.png' },
  plugins: [
    'expo-router',
    // The brand's own ground and accent, as the theme has them: a splash in
    // a colour the app never uses again reads as someone else's app.
    ['expo-splash-screen', { backgroundColor: '#FBFAF9', image: './assets/images/splash-icon.png', imageWidth: 132, dark: { backgroundColor: '#0E100F', image: './assets/images/splash-icon-dark.png' } }],
    ['expo-secure-store', { faceIDPermission: 'Allow Tap Trader to unlock the account this device already signed in to.' }],
    // A position ends on the platform's timer whether the phone is awake or
    // not; the notification is how its owner learns the trade is over.
    ['expo-notifications', { icon: './assets/images/android-icon-monochrome.png', color: '#836EF9' }],
    // Asked for by the analytics client, which reads the device's locale.
    'expo-localization',
  ],
  experiments: { typedRoutes: true, reactCompiler: true },
  owner: 'romanwagmi',
  extra: { rpId, eas: { projectId: '3942c3aa-ddf6-4811-b3ef-6ea9cd2f8233' } },
};

export default config;

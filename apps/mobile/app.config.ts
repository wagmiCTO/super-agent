import type { ExpoConfig } from 'expo/config';

/**
 * Passkeys on a device are bound to a relying-party domain. EXPO_PUBLIC_RP_ID
 * names it; the host must serve /.well-known/apple-app-site-association and
 * /.well-known/assetlinks.json listing this app (templates in well-known/).
 * Unset, the native build has no associated domain and passkeys work only in
 * the web build, where the page's own host is the relying party.
 */
const rpId = process.env.EXPO_PUBLIC_RP_ID;

const applicationId = 'app.tradeagent.mobile';

const config: ExpoConfig = {
  name: 'TradeAgent',
  slug: 'tradeagent',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'tradeagent',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: applicationId,
    // The team that owns the bundle id. Xcode needs it to build a target with
    // entitlements, simulator included; signing for a device additionally
    // needs the Apple account in Xcode.
    appleTeamId: '9Q73U33Y7D',
    icon: './assets/expo.icon',
    ...(rpId ? { associatedDomains: [`webcredentials:${rpId}`] } : {}),
  },
  android: {
    package: applicationId,
    adaptiveIcon: {
          "backgroundColor": "#E6F4FE",
          "foregroundImage": "./assets/images/android-icon-foreground.png",
          "backgroundImage": "./assets/images/android-icon-background.png",
          "monochromeImage": "./assets/images/android-icon-monochrome.png"
    },
    predictiveBackGestureEnabled: false,
  },
  web: { output: 'static', bundler: 'metro', favicon: './assets/images/favicon.png' },
  plugins: [
    'expo-router',
    ['expo-splash-screen', { backgroundColor: '#208AEF', image: './assets/images/splash-icon.png', imageWidth: 76 }],
    ['expo-secure-store', { faceIDPermission: 'Allow TradeAgent to unlock the account this device already signed in to.' }],
  ],
  experiments: { typedRoutes: true, reactCompiler: true },
  extra: { rpId },
};

export default config;

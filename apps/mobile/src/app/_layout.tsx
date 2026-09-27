import '@/polyfills';

import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Appearance, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AccountProvider } from '@/account/useAccount';
import { WideScreenNote } from '@/components/wide-note';
import { FONT_FACES, DEFAULT_THEME, type ThemeName } from '@/constants/theme';
import { OnboardingProvider } from '@/onboarding/useOnboarding';
import { startAnalytics, track } from '@/analytics/track';
import { followNotifications } from '@/push/register';
import { PositionSettingsProvider } from '@/trading/useSettings';
import { ThemeProvider, useThemeControls } from '@/theme';
import { loadThemeChoice } from '@/theme/store';

// The native splash stays up until the faces are in memory. Without this the
// first frame renders in the system font and then jumps, which on a phone
// reads as a bug rather than as loading.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(FONT_FACES);
  // The appearance is read before the first frame, so a dark choice does not
  // open on a flash of white.
  const [skin, setSkin] = useState<ThemeName | null>(null);
  useEffect(() => {
    void loadThemeChoice().then((name) => setSkin(name ?? DEFAULT_THEME));
  }, []);
  const ready = (fontsLoaded || !!fontError) && skin !== null;

  useEffect(() => {
    // A missing face must not hold the app hostage: fall back to the system
    // font rather than showing a splash for ever.
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  // On the web the page is asked to reach under the notch, so the safe-area
  // insets say where the status bar is on a phone that added the site to
  // its home screen — and say zero in a browser tab, whose chrome is its own.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const meta = document.querySelector('meta[name="viewport"]');
    if (meta && !/viewport-fit/.test(meta.getAttribute('content') ?? '')) {
      meta.setAttribute('content', `${meta.getAttribute('content')}, viewport-fit=cover`);
    }
  }, []);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider initial={skin}>
        <AccountProvider>
          <OnboardingProvider>
            <PositionSettingsProvider>
              <Shell />
            </PositionSettingsProvider>
          </OnboardingProvider>
        </AccountProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function Shell() {
  const { theme, dark } = useThemeControls();
  // A tapped notification leads to the strategy it names, where the result
  // of the trade it is about is read.
  useEffect(followNotifications, []);
  // The top of the funnel. Everything else is counted against this.
  useEffect(() => {
    void startAnalytics().then(() => track('app_opened'));
  }, []);
  // What the app draws itself follows the skin; what the system draws — the
  // keyboard, an alert, the page behind a web view's overscroll — is told to
  // match, so a dark choice has no white edges.
  useEffect(() => {
    if (Platform.OS === 'web') {
      if (typeof document === 'undefined') return;
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
      document.body.style.backgroundColor = theme.color.paper;
      return;
    }
    Appearance.setColorScheme(dark ? 'dark' : 'light');
  }, [dark, theme]);
  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.color.paper },
          animation: 'slide_from_right',
        }}
      />
      <StatusBar style={dark ? 'light' : 'dark'} />
      <WideScreenNote />
    </>
  );
}

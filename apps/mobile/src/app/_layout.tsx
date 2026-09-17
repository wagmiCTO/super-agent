import '@/polyfills';

import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AccountProvider } from '@/account/useAccount';
import { FONT_FACES } from '@/constants/theme';
import { OnboardingProvider } from '@/onboarding/useOnboarding';
import { PositionSettingsProvider } from '@/trading/useSettings';
import { ThemeProvider, useThemeControls } from '@/theme';

// The native splash stays up until the faces are in memory. Without this the
// first frame renders in the system font and then jumps, which on a phone
// reads as a bug rather than as loading.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(FONT_FACES);

  useEffect(() => {
    // A missing face must not hold the app hostage: fall back to the system
    // font rather than showing a splash for ever.
    if (fontsLoaded || fontError) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, fontError]);

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

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider>
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
  const { theme, name } = useThemeControls();
  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.color.paper },
          animation: 'slide_from_right',
        }}
      />
      <StatusBar style={name === 'terminal' ? 'light' : 'dark'} />
    </>
  );
}

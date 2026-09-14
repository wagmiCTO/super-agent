import '@/polyfills';

import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

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

  if (!fontsLoaded && !fontError) return null;

  return (
    <ThemeProvider>
      <OnboardingProvider>
        <PositionSettingsProvider>
          <Shell />
        </PositionSettingsProvider>
      </OnboardingProvider>
    </ThemeProvider>
  );
}

function Shell() {
  const { theme, name } = useThemeControls();
  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.color.ground },
          animation: 'slide_from_right',
        }}
      />
      <StatusBar style={name === 'terminal' ? 'light' : 'dark'} />
    </>
  );
}

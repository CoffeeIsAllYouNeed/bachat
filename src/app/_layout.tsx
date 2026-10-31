import { Kalam_700Bold } from '@expo-google-fonts/kalam/700Bold';
import { useFonts } from 'expo-font';
import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useStore } from '@/data/store';
import { maybeNudge } from '@/engine/nudges';
import { PdfTextHost } from '@/engine/pdfText';
import { AppLock } from '@/shell/AppLock';
import { LOGO_FONT } from '@/shell/Logo';
import { Onboarding } from '@/shell/Onboarding';
import { Shell } from '@/shell/Shell';
import { useShellUI } from '@/shell/ui';
import { useColors } from '@/theme/theme';

/** Root layout: safe areas, status bar, waits for the store and the logo font, then onboarding or the app shell. */
export default function RootLayout() {
  // Gesture root: swipe actions on transaction rows (react-native-gesture-handler).
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Root />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Root() {
  const c = useColors();
  // Kalam 700 for the ब logo. On failure (or if it takes too long) the app continues with the system font.
  const [fontsLoaded, fontError] = useFonts({ [LOGO_FONT]: Kalam_700Bold });
  const [fontTimeout, setFontTimeout] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setFontTimeout(true), 4000);
    return () => clearTimeout(t);
  }, []);
  const fontsReady = fontsLoaded || !!fontError || fontTimeout;
  const hydrated = useStore((s) => s.hydrated);
  const onboarded = useStore((s) => s.profile.onboarded);
  // Demo loading from Home/Settings briefly resets `onboarded`; keep the app on screen meanwhile.
  const keepShell = useShellUI((s) => s.keepShell);
  const nudged = useRef(false);

  // One nudge check per launch, after the stored data is back.
  useEffect(() => {
    if (!hydrated || nudged.current) return;
    nudged.current = true;
    maybeNudge().catch(() => null);
  }, [hydrated]);

  return (
    <View style={{ flex: 1, backgroundColor: c.page }}>
      <StatusBar style={c.dark ? 'light' : 'dark'} />
      {!hydrated || !fontsReady ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={c.accent} />
        </View>
      ) : !onboarded && !keepShell ? (
        // No navigation happens while onboarding is shown (Onboarding never calls the router),
        // so it is safe for the root layout to render it instead of the <Slot/> navigator.
        <OnboardingScreen />
      ) : (
        <Shell>
          <Slot />
        </Shell>
      )}
      {/* Hidden pdf.js reader for PDF statements (phone; renders nothing on the web). */}
      <PdfTextHost />
      {/* Optional biometric / PIN lock over everything (phone; off by default). */}
      {hydrated ? <AppLock /> : null}
    </View>
  );
}

function OnboardingScreen() {
  const onDone = () => {
    // Onboarding saves the profile itself; if a path (e.g. demo) left the flag unset, set it here.
    const s = useStore.getState();
    if (!s.profile.onboarded) {
      const p = s.profile;
      s.saveProfile({
        monthlyIncome: p.monthlyIncome,
        irregularIncome: p.irregularIncome,
        rent: p.rent,
        emis: p.emis,
        otherFixed: p.otherFixed,
        emergencyFund: p.emergencyFund,
        emergencyMonths: p.emergencyMonths,
        onboarded: true,
      });
    }
  };
  // Onboarding pads itself for the safe areas (insets.top / insets.bottom), so no extra padding here.
  return <Onboarding onDone={onDone} />;
}

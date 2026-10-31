import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShellUI, type SettingsPage } from '@/shell/ui';
import { useColors, useWide } from '@/theme/theme';
import { Footer, IconButton } from '@/ui/kit';
import { AboutPage } from './AboutPage';
import { AppearancePage } from './AppearancePage';
import { PAGE_META, PAGE_PARENT, type SettingsNav } from './common';
import { DeveloperPage } from './DeveloperPage';
import { ExportPage } from './ExportPage';
import { FamilyPage } from './FamilyPage';
import { GeminiPage } from './GeminiPage';
import { HistoryPage } from './HistoryPage';
import { ImportPage } from './ImportPage';
import { MoneyPage } from './MoneyPage';
import { NotificationsPage } from './NotificationsPage';
import { PrivacyPage } from './PrivacyPage';
import { ProfilePage } from './ProfilePage';
import { ReviewPage } from './ReviewPage';
import { RulesPage } from './RulesPage';
import { SectionsPage } from './SectionsPage';
import { SettingsHome } from './SettingsHome';
import { SmsPage } from './SmsPage';
import { VoicePage } from './VoicePage';

/*
 * Settings (GOLD_SPEC "Settings — standard app settings pattern"):
 * phone = full-screen page sliding in, Settings home → sub-page with a back
 * arrow; laptop = centred large modal (max 1000×720) with a left tab list and
 * the selected page on the right. No routes: an internal stack.
 */

/** Stack for a requested page: home → [parent →] page. */
function stackFor(page: SettingsPage): SettingsPage[] {
  if (page === 'home') return ['home'];
  const parent = PAGE_PARENT[page];
  return parent ? ['home', parent, page] : ['home', page];
}

function PageBody({ page, nav }: { page: SettingsPage; nav: SettingsNav }) {
  switch (page) {
    case 'profile': return <ProfilePage />;
    case 'appearance': return <AppearancePage />;
    case 'sections': return <SectionsPage />;
    case 'notifications': return <NotificationsPage />;
    case 'money': return <MoneyPage nav={nav} />;
    case 'history': return <HistoryPage />;
    case 'voice': return <VoicePage />;
    case 'import': return <ImportPage />;
    case 'sms': return <SmsPage />;
    case 'rules': return <RulesPage />;
    case 'export': return <ExportPage nav={nav} />;
    case 'review': return <ReviewPage />;
    case 'gemini': return <GeminiPage />;
    case 'privacy': return <PrivacyPage nav={nav} />;
    case 'about': return <AboutPage />;
    case 'developer': return <DeveloperPage />;
    case 'family': return <FamilyPage />;
    case 'home': return null;
  }
}

/** Full-screen (phone) / large centred (laptop) Settings. Open with openSettings(page?). */
export function SettingsScreen({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const wide = useWide();
  const page = useShellUI((s) => s.settingsPage);
  const nonce = useShellUI((s) => s.settingsNonce);
  const [stack, setStack] = useState<SettingsPage[]>(() => stackFor(page));

  // Each openSettings(page) call (or reopening) starts from the requested page.
  useEffect(() => {
    if (visible) setStack(stackFor(page));
  }, [visible, page, nonce]);

  const top = stack[stack.length - 1] ?? 'home';
  const nav: SettingsNav = {
    push: (p) => setStack((s) => (s[s.length - 1] === p ? s : [...s, p])),
    back: () => {
      if (stack.length > 1) setStack((s) => s.slice(0, -1));
      else onClose();
    },
    close: onClose,
  };

  if (wide) return <WideSettings visible={visible} onClose={onClose} stack={stack} setStack={setStack} nav={nav} top={top} />;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={nav.back}>
      <PhoneSettings top={top} nav={nav} onClose={onClose} onOpen={(p) => setStack(['home', p])} />
    </Modal>
  );
}

// ---------------------------------------------------------------- phone

function PhoneSettings({ top, nav, onClose, onOpen }: {
  top: SettingsPage; nav: SettingsNav; onClose: () => void; onOpen: (p: SettingsPage) => void;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const title = PAGE_META[top].title;
  return (
    <View style={{ flex: 1, backgroundColor: c.page, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border }}>
        <IconButton name="arrow-back" label={top === 'home' ? 'Close settings' : 'Back'} onPress={nav.back} color={c.text} />
        <Text style={{ flex: 1, color: c.text, fontSize: 18, fontWeight: '700', marginLeft: 4 }} numberOfLines={1}>{title}</Text>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          key={top}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
          keyboardShouldPersistTaps="handled"
        >
          {top === 'home' ? (
            <SettingsHome onOpen={onOpen} onClose={onClose} />
          ) : (
            <PageBody page={top} nav={nav} />
          )}
          <Footer />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ---------------------------------------------------------------- laptop

function WideSettings({ visible, onClose, stack, setStack, nav, top }: {
  visible: boolean;
  onClose: () => void;
  stack: SettingsPage[];
  setStack: (s: SettingsPage[]) => void;
  nav: SettingsNav;
  top: SettingsPage;
}) {
  const c = useColors();
  const win = useWindowDimensions();
  const content: SettingsPage = top === 'home' ? 'profile' : top;
  const tab: SettingsPage = PAGE_PARENT[content] ?? content;
  const width = Math.min(1000, win.width - 48);
  const height = Math.min(720, win.height - 48);
  const canBack = stack.length > 2;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim }]} onPress={onClose} accessibilityLabel="Close settings" />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} pointerEvents="box-none">
        <View
          style={{
            width, height, backgroundColor: c.page, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
            overflow: 'hidden', flexDirection: 'row',
          }}
        >
          {/* left tab list */}
          <View style={{ width: 300, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: c.border }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 60, paddingHorizontal: 20 }}>
              <Text style={{ color: c.text, fontSize: 20, fontWeight: '700' }}>Settings</Text>
            </View>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}>
              <SettingsHome compact selected={tab} onOpen={(p) => setStack(['home', p])} onClose={onClose} />
            </ScrollView>
          </View>

          {/* content pane */}
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 60, paddingLeft: canBack ? 8 : 24, paddingRight: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border }}>
              {canBack ? <IconButton name="arrow-back" label="Back" onPress={nav.back} color={c.text} /> : null}
              <Text style={{ flex: 1, color: c.text, fontSize: 18, fontWeight: '700', marginLeft: canBack ? 4 : 0 }} numberOfLines={1}>{PAGE_META[content].title}</Text>
              <IconButton name="close" label="Close settings" onPress={onClose} />
            </View>
            <ScrollView key={content} contentContainerStyle={{ padding: 24, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
              <View style={{ width: '100%', maxWidth: 620 }}>
                <PageBody page={content} nav={nav} />
              </View>
            </ScrollView>
          </View>
        </View>
      </View>
    </Modal>
  );
}

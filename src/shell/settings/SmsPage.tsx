import React from 'react';
import { View } from 'react-native';
import { SmsReadFlow } from '@/shell/SmsRead';
import { SettingsNote } from '@/ui/settings';

/** Settings → Data → Read bank SMS: the same Allow flow as onboarding, then "Read again". */
export function SmsPage() {
  return (
    <View style={{ gap: 22 }}>
      <SmsReadFlow />
      <SettingsNote>
        Bachat reads only messages from banks and card issuers, skips OTPs, offers and failed payments, and keeps everything on this phone. Messages already added are never added twice.
      </SettingsNote>
    </View>
  );
}

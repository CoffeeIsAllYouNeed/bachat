import { Ionicons } from '@expo/vector-icons';
import React, { useRef } from 'react';
import { Platform, Text, View } from 'react-native';
import ReanimatedSwipeable, { SwipeDirection, type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useColors } from '@/theme/theme';

/*
 * Swipe actions on a transaction row (phones):
 *   swipe right → change category (opens the picker)
 *   swipe left  → mark reviewed (only offered while the row needs review)
 * On the web the row is returned as is (tap only).
 */

function Action({ icon, label, color, background, align }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; color: string; background: string; align: 'flex-start' | 'flex-end';
}) {
  return (
    <View style={{ flex: 1, backgroundColor: background, justifyContent: 'center', alignItems: align, paddingHorizontal: 20 }}>
      <View style={{ alignItems: 'center', gap: 2 }}>
        <Ionicons name={icon} size={20} color={color} />
        <Text style={{ color, fontSize: 12, fontWeight: '600' }}>{label}</Text>
      </View>
    </View>
  );
}

export function SwipeRow({ children, onCategory, onReviewed }: {
  children: React.ReactNode;
  onCategory: () => void;
  /** Omit when the row is already reviewed (no left swipe then). */
  onReviewed?: () => void;
}) {
  const c = useColors();
  const ref = useRef<SwipeableMethods>(null);
  if (Platform.OS === 'web') return <>{children}</>;
  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={2}
      leftThreshold={72}
      rightThreshold={72}
      overshootFriction={8}
      childrenContainerStyle={{ backgroundColor: c.card }}
      renderLeftActions={() => (
        <View style={{ width: 120 }}>
          <Action icon="pricetag-outline" label="Category" color={c.accent} background={c.accentSoft} align="flex-start" />
        </View>
      )}
      renderRightActions={onReviewed ? () => (
        <View style={{ width: 120 }}>
          <Action icon="checkmark-circle-outline" label="Reviewed" color={c.good} background={c.goodSoft} align="flex-end" />
        </View>
      ) : undefined}
      onSwipeableOpen={(direction) => {
        ref.current?.close();
        // RIGHT = the row moved right (left actions shown).
        if (direction === SwipeDirection.RIGHT) onCategory();
        else onReviewed?.();
      }}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

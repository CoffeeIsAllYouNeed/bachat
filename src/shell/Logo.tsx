import { isLoaded } from 'expo-font';
import React from 'react';
import { Text, View } from 'react-native';

/** Brand gold and ink: the logo keeps these in every theme / accent setting. */
export const LOGO_GOLD = '#D4AF37';
export const LOGO_INK = '#000000';

/** Handwritten Devanagari for the mark (loaded in the root layout with useFonts). */
export const LOGO_FONT = 'Kalam_700Bold';

function kalamReady(): boolean {
  try {
    return isLoaded(LOGO_FONT);
  } catch {
    return false;
  }
}

/**
 * Bachat mark: the Hindi letter "ब" in Kalam 700 (black) on a gold rounded-square
 * tile (radius 28% of size), or a gold circle when [round] (assistant button, chat avatar).
 * Kalam sits a little high in its line box, so the glyph is nudged down to look centred.
 * If Kalam failed to load, the system Devanagari font is used instead.
 */
export function Logo({ size, round }: { size: number; round?: boolean }) {
  const kalam = kalamReady();
  const glyph = Math.round(size * (kalam ? 0.62 : 0.6));
  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: size,
        borderRadius: round ? size / 2 : Math.round(size * 0.28),
        backgroundColor: LOGO_GOLD,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <Text
        allowFontScaling={false}
        style={
          kalam
            ? {
                color: LOGO_INK,
                fontFamily: LOGO_FONT,
                fontSize: glyph,
                includeFontPadding: false,
                textAlign: 'center',
                lineHeight: size,
                marginTop: Math.round(size * 0.07),
              }
            : {
                color: LOGO_INK,
                fontSize: glyph,
                fontWeight: '700',
                includeFontPadding: false,
                textAlign: 'center',
                lineHeight: Math.round(glyph * 1.25),
                // Devanagari glyphs sit high (headline bar); nudge down to look centred.
                marginTop: Math.round(size * 0.04),
              }
        }
      >
        ब
      </Text>
    </View>
  );
}

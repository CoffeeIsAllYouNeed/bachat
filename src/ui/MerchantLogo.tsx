import React, { useState } from 'react';
import { Image, View } from 'react-native';
import { displayName, merchantKey } from '@/engine/merchant';
import { Avatar } from '@/ui/kit';

/*
 * Official merchant logos, loaded at runtime from Google's favicon service
 * (never drawn by hand). Unknown merchants, or a failed load, fall back to a
 * letter avatar. Logos sit on a white rounded tile because they are designed
 * for light backgrounds.
 */

/**
 * Domain map (GOLD_SPEC "Merchant logos"). Keys are merchant-key words; the
 * first key contained in the merchant key wins, so order specific → general
 * ("swiggy instamart" → swiggy.com, "hdfc loan emi" → hdfcbank.com).
 */
const DOMAINS: [string, string][] = [
  ['swiggy', 'swiggy.com'],
  ['zomato', 'zomato.com'],
  ['zepto', 'zeptonow.com'],
  ['blinkit', 'blinkit.com'],
  ['bigbasket', 'bigbasket.com'],
  ['big basket', 'bigbasket.com'],
  ['amazon', 'amazon.in'],
  ['amzn', 'amazon.in'],
  ['flipkart', 'flipkart.com'],
  ['myntra', 'myntra.com'],
  ['netflix', 'netflix.com'],
  ['spotify', 'spotify.com'],
  ['youtube', 'youtube.com'],
  ['hdfc', 'hdfcbank.com'],
  ['icici', 'icicibank.com'],
  ['sbi', 'sbi.co.in'],
  ['state bank', 'sbi.co.in'],
  ['axis', 'axisbank.com'],
  ['kotak', 'kotak.com'],
  ['uber', 'uber.com'],
  ['olacabs', 'olacabs.com'],
  ['ola', 'olacabs.com'],
  ['rapido', 'rapido.bike'],
  ['irctc', 'irctc.co.in'],
  ['airtel', 'airtel.in'],
  ['jio', 'jio.com'],
  ['bescom', 'bescom.co.in'],
  ['adani electricity', 'adanielectricity.com'],
  ['cult fit', 'cult.fit'],
  ['cultfit', 'cult.fit'],
  ['cult.fit', 'cult.fit'],
  ['zerodha', 'zerodha.com'],
  ['groww', 'groww.in'],
  ['apollo', 'apollopharmacy.in'],
  ['pharmeasy', 'pharmeasy.in'],
  ['nobroker', 'nobroker.in'],
  ['makemytrip', 'makemytrip.com'],
  ['bookmyshow', 'bookmyshow.com'],
];

const cache = new Map<string, string | null>();

/** Domain for a merchant/account name, or null when it is not a known brand. */
export function merchantDomain(name: string): string | null {
  const raw = (name ?? '').trim();
  if (!raw) return null;
  const hit = cache.get(raw);
  if (hit !== undefined) return hit;
  let key = '';
  try {
    key = merchantKey(raw);
  } catch {
    key = '';
  }
  // Match whole words so "ola" does not match "cola" and "sbi" does not match "sbin…" refs.
  const hay = ` ${(key || raw.toLowerCase()).replace(/[^a-z0-9. ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
  let found: string | null = null;
  for (const [k, d] of DOMAINS) {
    if (hay.includes(` ${k} `)) {
      found = d;
      break;
    }
  }
  cache.set(raw, found);
  return found;
}

/** Clean name for the fallback letter ("UPI/123/RASOI EXPRESS/…" → "Rasoi Express"). */
function letterSource(name: string): string {
  try {
    return displayName(name) || name || '?';
  } catch {
    return name || '?';
  }
}

export function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
}

/** Merchant logo in a white rounded tile (radius 25%), or a letter avatar for unknown merchants / failed loads. */
export function MerchantLogo({ name, size = 32 }: { name: string; size?: number }) {
  const domain = merchantDomain(name);
  // Remember a failed load per domain so a re-render does not flash the broken image.
  const [failed, setFailed] = useState<string | null>(null);
  const radius = Math.round(size * 0.25);
  if (!domain || failed === domain) return <Avatar label={letterSource(name)} size={size} plain square />;
  const inner = Math.round(size * 0.72);
  return (
    <View
      accessibilityLabel={`${name} logo`}
      style={{ width: size, height: size, borderRadius: radius, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
    >
      <Image
        source={{ uri: faviconUrl(domain) }}
        style={{ width: inner, height: inner }}
        resizeMode="contain"
        onError={() => setFailed(domain)}
      />
    </View>
  );
}

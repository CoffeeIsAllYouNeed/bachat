import React, { useId, useState } from 'react';
import { LayoutChangeEvent, Pressable, Text, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { seriesColor, useColors } from '@/theme/theme';
import { Card } from './kit';

/*
 * Dashboard-style charts: thin straight lines, faint dashed grid, compact
 * axis labels, a legend of coloured squares and Bachat's series palette.
 * Drawn with react-native-svg (works in Expo Go and on the web).
 */

function useWidth(): [number, (e: LayoutChangeEvent) => void] {
  const [w, setW] = useState(0);
  return [w, (e) => setW(Math.round(e.nativeEvent.layout.width))];
}

// ---------------------------------------------------------------- rings & donuts

function arcPath(cx: number, cy: number, r: number, start: number, end: number): string {
  // angles in radians, 0 = 12 o'clock, clockwise
  const sweep = Math.min(end - start, Math.PI * 2 - 0.0001);
  const x1 = cx + r * Math.sin(start);
  const y1 = cy - r * Math.cos(start);
  const x2 = cx + r * Math.sin(start + sweep);
  const y2 = cy - r * Math.cos(start + sweep);
  const large = sweep > Math.PI ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

/** Budget ring with an emoji in the middle and "₹183 left" under it. */
export function Ring({ fraction, color, size = 64, stroke = 6, center, label, sublabel, labelColor }: {
  fraction: number; color: string; size?: number; stroke?: number; center?: React.ReactNode;
  label?: string; sublabel?: string; labelColor?: string;
}) {
  const c = useColors();
  const r = (size - stroke) / 2;
  const f = Math.max(0, Math.min(1, isFinite(fraction) ? fraction : 0));
  return (
    <View style={{ alignItems: 'center', gap: 6, minWidth: 72 }}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size} style={{ position: 'absolute' }}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.muted} strokeWidth={stroke} fill="none" />
          {f > 0 ? (
            f >= 0.999
              ? <Circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" />
              : <Path d={arcPath(size / 2, size / 2, r, 0, f * Math.PI * 2)} stroke={color} strokeWidth={stroke} strokeLinecap="round" fill="none" />
          ) : null}
        </Svg>
        {center}
      </View>
      {label ? <Text style={{ color: labelColor ?? c.text, fontSize: 13, fontWeight: '700' }}>{label}</Text> : null}
      {sublabel ? <Text style={{ color: c.textMuted, fontSize: 11 }}>{sublabel}</Text> : null}
    </View>
  );
}

export interface Slice { label: string; value: number; color?: string }

/** Multi-colour donut (Budgets page header). Colours default to the series palette. */
export function Donut({ slices, size = 84, stroke = 11, onSlice, single }: {
  slices: Slice[]; size?: number; stroke?: number; onSlice?: (label: string) => void;
  /** Draw a single-value ring instead: fraction 0..1 + colour. */
  single?: { fraction: number; color: string };
}) {
  const c = useColors();
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const total = slices.reduce((a, s) => a + Math.max(0, s.value), 0);
  let start = 0;
  const gap = slices.length > 1 ? 0.04 : 0;
  return (
    <Svg width={size} height={size}>
      <Circle cx={cx} cy={cx} r={r} stroke={c.muted} strokeWidth={stroke} fill="none" />
      {single ? (
        single.fraction > 0 ? (
          single.fraction >= 0.999
            ? <Circle cx={cx} cy={cx} r={r} stroke={single.color} strokeWidth={stroke} fill="none" />
            : <Path d={arcPath(cx, cx, r, 0, single.fraction * Math.PI * 2)} stroke={single.color} strokeWidth={stroke} strokeLinecap="round" fill="none" />
        ) : null
      ) : total > 0 ? (
        slices.map((s, i) => {
          const sweep = (Math.max(0, s.value) / total) * Math.PI * 2;
          const a0 = start;
          start += sweep;
          if (sweep <= gap) return null;
          return (
            <Path key={s.label + i} d={arcPath(cx, cx, r, a0 + gap / 2, a0 + sweep - gap / 2)}
              stroke={s.color ?? seriesColor(i, c.dark)} strokeWidth={stroke} fill="none"
              onPress={onSlice ? () => onSlice(s.label) : undefined} />
          );
        })
      ) : null}
    </Svg>
  );
}

/** Split page header: "₹185 / spent in Oct"  ◯  "₹183 / total budget". */
export function SplitHeader({ leftValue, leftCaption, rightValue, rightCaption, fraction, color, slices, over, onPress }: {
  leftValue: string; leftCaption: string; rightValue: string; rightCaption: string;
  fraction?: number; color?: string; slices?: Slice[]; over?: boolean; onPress?: () => void;
}) {
  const c = useColors();
  return (
    <Card onPress={onPress}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: over ? c.bad : c.text, fontSize: 22, fontWeight: '700' }} numberOfLines={1}>{leftValue}</Text>
          <Text style={{ color: c.textMuted, fontSize: 12 }} numberOfLines={1}>{leftCaption}</Text>
        </View>
        {slices ? <Donut slices={slices} size={78} /> : <Donut slices={[]} size={78} single={{ fraction: fraction ?? 0, color: over ? c.bad : color ?? c.accent }} />}
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <Text style={{ color: c.text, fontSize: 22, fontWeight: '700' }} numberOfLines={1}>{rightValue}</Text>
          <Text style={{ color: c.textMuted, fontSize: 12 }} numberOfLines={1}>{rightCaption}</Text>
        </View>
      </View>
    </Card>
  );
}

// ---------------------------------------------------------------- legend

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, rowGap: 6 }}>
      {items.map((it) => (
        <View key={it.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: it.color }} />
          <Text style={{ color: c.textMuted, fontSize: 11 }}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- line chart

export interface Series { label: string; values: number[]; color?: string; fill?: boolean; muted?: boolean; dashed?: boolean }

/**
 * Dashboard-style time-series panel: thin lines over a dashed grid, y labels via
 * [format], first/middle/last x labels, legend when more than one series.
 */
export function LineChart({ series, labels = [], format, height = 160, baseline, showLegend }: {
  series: Series[]; labels?: string[]; format?: (v: number) => string; height?: number;
  /** Dotted horizontal reference (e.g. starting value). */
  baseline?: number; showLegend?: boolean;
}) {
  const c = useColors();
  const [w, onLayout] = useWidth();
  // Unique gradient ids: on the web SVG ids are document-global, so two charts on one page would share "fill0".
  const gid = 'lc' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const usable = series.filter((s) => s.values.length >= 2);
  const yAxisW = format ? 44 : 0;
  const padTop = 8, padBottom = labels.length ? 18 : 6;
  const all = usable.flatMap((s) => s.values).concat(baseline != null ? [baseline] : []);
  const lo = all.length ? Math.min(...all) : 0;
  const hi = all.length ? Math.max(...all) : 1;
  const span = hi - lo || Math.max(Math.abs(hi), 1);
  const minY = lo - span * 0.12, maxY = hi + span * 0.12;
  const plotW = Math.max(0, w - yAxisW - 4);
  const plotH = height - padTop - padBottom;
  const n = Math.max(...usable.map((s) => s.values.length), 2);
  const x = (i: number) => yAxisW + (plotW * i) / (n - 1);
  const y = (v: number) => padTop + plotH - (plotH * (v - minY)) / (maxY - minY || 1);
  const ticks = [maxY - (maxY - minY) * 0.12, (minY + maxY) / 2, minY + (maxY - minY) * 0.12];
  const colors = usable.map((s, i) => s.color ?? seriesColor(i, c.dark));

  return (
    <View onLayout={onLayout} style={{ width: '100%', gap: 8 }}>
      {w > 0 && usable.length ? (
        <Svg width={w} height={height}>
          <Defs>
            {usable.map((s, i) => (
              <LinearGradient key={'g' + i} id={`${gid}fill${i}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colors[i]} stopOpacity={0.25} />
                <Stop offset="1" stopColor={colors[i]} stopOpacity={0} />
              </LinearGradient>
            ))}
          </Defs>
          {ticks.map((t, i) => (
            <G key={'t' + i}>
              <Line x1={yAxisW} x2={w} y1={y(t)} y2={y(t)} stroke={c.textFaint} strokeOpacity={0.25} strokeDasharray="4 6" strokeWidth={1} />
              {format ? <SvgText x={yAxisW - 6} y={y(t) + 3} fontSize={10} fill={c.textFaint} textAnchor="end">{format(t)}</SvgText> : null}
            </G>
          ))}
          {baseline != null ? (
            <Line x1={yAxisW} x2={w} y1={y(baseline)} y2={y(baseline)} stroke={c.textFaint} strokeDasharray="3 5" strokeWidth={1.2} />
          ) : null}
          {usable.map((s, i) => {
            const pts = s.values.map((v, k) => `${x(k)},${y(v)}`);
            const d = 'M ' + pts.join(' L ');
            const last = s.values.length - 1;
            const col = colors[i];
            return (
              <G key={s.label + i} opacity={s.muted ? 0.5 : 1}>
                {s.fill ? <Path d={`${d} L ${x(last)},${padTop + plotH} L ${x(0)},${padTop + plotH} Z`} fill={`url(#${gid}fill${i})`} /> : null}
                <Path d={d} stroke={col} strokeWidth={s.muted ? 1.5 : 2} fill="none" strokeDasharray={s.dashed ? '4 4' : undefined} strokeLinejoin="round" />
                {!s.muted ? <Circle cx={x(last)} cy={y(s.values[last])} r={4.5} fill={c.card} stroke={col} strokeWidth={2} /> : null}
              </G>
            );
          })}
          {labels.length ? (
            <G>
              <SvgText x={yAxisW} y={height - 3} fontSize={10} fill={c.textFaint}>{labels[0]}</SvgText>
              {labels.length > 2 ? <SvgText x={yAxisW + plotW / 2} y={height - 3} fontSize={10} fill={c.textFaint} textAnchor="middle">{labels[Math.floor(labels.length / 2)]}</SvgText> : null}
              {labels.length > 1 ? <SvgText x={w - 2} y={height - 3} fontSize={10} fill={c.textFaint} textAnchor="end">{labels[labels.length - 1]}</SvgText> : null}
            </G>
          ) : null}
        </Svg>
      ) : (
        <View style={{ height, alignItems: 'center', justifyContent: 'center' }}>
          {w > 0 ? <Text style={{ color: c.textMuted, fontSize: 12 }}>Not enough data yet</Text> : null}
        </View>
      )}
      {(showLegend ?? usable.length > 1) ? <Legend items={usable.map((s, i) => ({ label: s.label, color: colors[i] }))} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------- bar chart

export interface BarDatum {
  label: string;
  /** Single bar value (can be negative). Ignored when [stack] is given. */
  value?: number;
  /** Stacked segments (all ≥ 0). */
  stack?: { key: string; value: number; color: string }[];
  color?: string;
  /** Optional comparison point drawn as a dotted line (e.g. last year). */
  compare?: number | null;
  /** Optional per-bar budget mark (dashed tick). */
  mark?: number;
  /** Faded (future/no data). */
  faded?: boolean;
}

/**
 * Bars per period with a dashed zero line; negatives hang below. Optional
 * stacks (spend by category), a dotted comparison line (last year) and a
 * budget mark per bar. Tap a bar to select it.
 */
export function BarChart({ data, height = 150, positive, negative, format, onSelect, selected, letterLabels }: {
  data: BarDatum[]; height?: number; positive?: string; negative?: string;
  format?: (v: number) => string; onSelect?: (i: number) => void; selected?: number;
  /** Print every label (single letters like J F M …) instead of first/last only. */
  letterLabels?: boolean;
}) {
  const c = useColors();
  const [w, onLayout] = useWidth();
  const pos = positive ?? c.good;
  const neg = negative ?? c.bad;
  const vals = data.map((d) => (d.stack ? d.stack.reduce((a, s) => a + s.value, 0) : d.value ?? 0));
  const extra = data.flatMap((d) => [d.compare ?? 0, d.mark ?? 0]);
  const maxPos = Math.max(0, ...vals, ...extra);
  const maxNeg = Math.max(0, ...vals.map((v) => -v), ...extra.map((v) => -v));
  const span = maxPos + maxNeg || 1;
  const labelH = 16;
  const plotH = height - labelH;
  const zeroY = plotH * (maxPos / span);
  const slot = data.length ? w / data.length : 0;
  const barW = Math.min(slot * 0.56, 28);
  const yOf = (v: number) => zeroY - (plotH * v) / span;

  const comparePts = data
    .map((d, i) => (d.compare != null ? `${slot * i + slot / 2},${yOf(d.compare)}` : null))
    .filter((p): p is string => !!p);

  return (
    <View onLayout={onLayout} style={{ width: '100%' }}>
      {w > 0 ? (
        <Svg width={w} height={height}>
          <Line x1={0} x2={w} y1={zeroY} y2={zeroY} stroke={c.textFaint} strokeOpacity={0.5} strokeDasharray="4 5" />
          {data.map((d, i) => {
            const left = slot * i + (slot - barW) / 2;
            const opacity = d.faded ? 0.3 : selected != null && selected !== i ? 0.55 : 1;
            let body: React.ReactNode;
            if (d.stack) {
              let acc = 0;
              body = d.stack.map((s) => {
                const top = yOf(acc + s.value);
                const h = Math.max(0, yOf(acc) - top);
                acc += s.value;
                return h > 0 ? <Rect key={s.key} x={left} y={top} width={barW} height={h} fill={s.color} /> : null;
              });
            } else {
              const v = d.value ?? 0;
              const h = Math.abs((plotH * v) / span);
              body = h > 0
                ? <Rect x={left} y={v > 0 ? zeroY - h : zeroY} width={barW} height={Math.max(h, 1)} rx={3} fill={d.color ?? (v > 0 ? pos : neg)} />
                : <Rect x={left} y={zeroY - 1} width={barW} height={2} fill={c.textFaint} opacity={0.6} />;
            }
            return (
              <G key={d.label + i} opacity={opacity} onPress={onSelect ? () => onSelect(i) : undefined}>
                {/* invisible hit area */}
                <Rect x={slot * i} y={0} width={slot} height={plotH} fill="transparent" />
                {body}
                {d.mark != null ? <Line x1={left - 3} x2={left + barW + 3} y1={yOf(d.mark)} y2={yOf(d.mark)} stroke={c.text} strokeOpacity={0.7} strokeDasharray="3 2" /> : null}
                {(letterLabels || i === 0 || i === data.length - 1) ? (
                  <SvgText x={slot * i + slot / 2} y={height - 3} fontSize={10} fill={selected === i ? c.text : c.textFaint} textAnchor="middle">{d.label}</SvgText>
                ) : null}
              </G>
            );
          })}
          {comparePts.length > 1 ? <Path d={'M ' + comparePts.join(' L ')} stroke={c.textMuted} strokeOpacity={0.7} strokeDasharray="3 4" strokeWidth={1.5} fill="none" /> : null}
          {format && maxPos > 0 ? <SvgText x={2} y={10} fontSize={10} fill={c.textFaint}>{format(maxPos)}</SvgText> : null}
        </Svg>
      ) : <View style={{ height }} />}
    </View>
  );
}

// ---------------------------------------------------------------- pace chart

/**
 * Month pace: cumulative spend per day (green, warming to orange/red once past
 * the plan) against a dotted straight "on plan" line; red bubble when over.
 */
export function PaceChart({ cumulative, plan, daysInMonth, height = 130, overLabel }: {
  cumulative: number[]; plan: number; daysInMonth: number; height?: number; overLabel?: string;
}) {
  const c = useColors();
  const [w, onLayout] = useWidth();
  const maxY = Math.max(plan, ...cumulative, 1) * 1.1;
  const x = (d: number) => (w * d) / Math.max(1, daysInMonth - 1);
  const y = (v: number) => height - (height * v) / maxY;
  const last = cumulative.length - 1;
  const todayPlan = (plan * cumulative.length) / Math.max(1, daysInMonth);
  const over = last >= 0 && cumulative[last] > todayPlan;
  const lineCol = over ? c.bad : c.good;
  const d = cumulative.length ? 'M ' + cumulative.map((v, i) => `${x(i)},${y(v)}`).join(' L ') : '';
  const bubbleW = overLabel ? overLabel.length * 6.4 + 12 : 0;
  const ex = last >= 0 ? x(last) : 0;
  const ey = last >= 0 ? y(cumulative[last]) : 0;
  const bx = Math.max(0, ex + 8 + bubbleW > w ? ex - bubbleW - 8 : ex + 8);
  const by = Math.min(height - 20, ey + 8);
  return (
    <View onLayout={onLayout} style={{ width: '100%' }}>
      {w > 0 ? (
        <Svg width={w} height={height}>
          <Defs>
            <LinearGradient id="pace" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={c.good} />
              <Stop offset="0.6" stopColor={over ? c.warn : c.good} />
              <Stop offset="1" stopColor={lineCol} />
            </LinearGradient>
          </Defs>
          <Line x1={0} y1={y(0)} x2={w} y2={y(plan)} stroke={c.textFaint} strokeDasharray="5 6" strokeWidth={1.5} />
          {d ? <Path d={d} stroke="url(#pace)" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
          {last >= 0 ? <Circle cx={ex} cy={ey} r={6} fill={c.card} stroke={lineCol} strokeWidth={2.5} /> : null}
          {over && overLabel ? (
            <G>
              <Rect x={bx} y={by} width={bubbleW} height={20} rx={4} fill={c.bad} />
              <SvgText x={bx + 6} y={by + 14} fontSize={11} fontWeight="700" fill="#FFFFFF">{overLabel}</SvgText>
            </G>
          ) : null}
        </Svg>
      ) : <View style={{ height }} />}
    </View>
  );
}

/** Tappable legend-style chip row used under charts. */
export function ChipRow({ items, onPress }: { items: { key: string; label: string }[]; onPress: (key: string) => void }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {items.map((it) => (
        <Pressable key={it.key} onPress={() => onPress(it.key)} accessibilityRole="button"
          style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: c.border, justifyContent: 'center' }}>
          <Text style={{ color: c.text, fontSize: 13 }}>{it.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

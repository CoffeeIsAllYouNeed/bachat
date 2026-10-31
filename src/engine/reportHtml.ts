/**
 * Printable HTML for the monthly review (A4, Black & gold: black band with a
 * gold "ब" mark, light body so it prints well, clean numbered lists — no
 * tinted blocks). Colours come from the theme tokens, not literals.
 */

import { DARK, LIGHT } from '@/theme/theme';
import { moneyPlain as money, monthYear, pct } from '@/theme/format';
import type { MonthlyReport, ReportLine } from '@/engine/report';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Drops emoji / pictographs (focus areas are plain text). */
function stripEmoji(s: string): string {
  return s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').replace(/\s{2,}/g, ' ').trim();
}

function changeCell(c: number | null, upIsGood: boolean): string {
  if (c == null || !isFinite(c)) return '<td class="r faint">—</td>';
  const good = c === 0 ? null : (c > 0) === upIsGood;
  const cls = good == null ? 'faint' : good ? 'good' : 'bad';
  return `<td class="r ${cls}">${c > 0 ? '↗' : c < 0 ? '↘' : '='} ${Math.abs(c * 100).toFixed(1)}%</td>`;
}

function lineTable(rows: (ReportLine & { emoji?: string })[], prevLabel: string): string {
  if (!rows.length) return '<p class="faint">Nothing yet.</p>';
  return `<table><tr><th></th><th class="r">This month</th><th class="r">${esc(prevLabel)}</th><th class="r">Change</th></tr>${rows
    .map((r) => `<tr><td>${r.emoji ? r.emoji + ' ' : ''}${esc(r.name)}</td><td class="r">${money(r.amount)}</td><td class="r faint">${money(r.prev)}</td>${changeCell(r.change, false)}</tr>`)
    .join('')}</table>`;
}

/** Full HTML document for one month's review. */
export function reportHtml(r: MonthlyReport): string {
  const L = LIGHT;
  const D = DARK;
  const css = `
    @page { margin: 28px; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: ${L.text}; background: ${L.page}; margin: 0; font-size: 12px; }
    .band { background: ${D.page}; color: ${D.text}; padding: 22px 26px; border-radius: 14px; }
    .logo { display: inline-block; width: 30px; height: 30px; border-radius: 8px; background: ${D.accent}; color: ${D.onAccent}; font-family: 'Noto Sans Devanagari', 'Kohinoor Devanagari', 'Devanagari Sangam MN', 'Mangal', sans-serif; font-weight: 700; font-size: 18px; text-align: center; line-height: 32px; margin-right: 10px; vertical-align: middle; }
    .band h1 { display: inline; font-size: 20px; margin: 0; vertical-align: middle; }
    .band .sub { color: ${D.textMuted}; margin-top: 6px; }
    .kpis { display: flex; gap: 10px; margin-top: 16px; }
    .kpi { flex: 1; background: ${D.card}; border-radius: 10px; padding: 10px 12px; }
    .kpi .v { font-size: 17px; font-weight: 700; color: ${D.text}; }
    .kpi .c { color: ${D.textMuted}; font-size: 10px; text-transform: uppercase; letter-spacing: .5px; }
    .kpi .v.accent { color: ${D.accent}; }
    h2 { font-size: 11px; letter-spacing: .6px; text-transform: uppercase; color: ${L.textMuted}; margin: 20px 0 8px; }
    .card { background: ${L.card}; border: 1px solid ${L.border}; border-radius: 12px; padding: 12px 14px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-weight: 600; color: ${L.textFaint}; font-size: 10px; padding: 4px 0; }
    td { padding: 5px 0; border-top: 1px solid ${L.border}; }
    .r { text-align: right; }
    .faint { color: ${L.textFaint}; }
    .good { color: ${L.good}; }
    .bad { color: ${L.bad}; }
    .warn { color: ${L.warn}; }
    .list { list-style: none; margin: 0; padding: 0; }
    .list li { display: flex; gap: 12px; align-items: flex-start; padding: 10px 0; border-top: 1px solid ${L.border}; }
    .list li:first-child { border-top: 0; padding-top: 2px; }
    .num { flex: 0 0 22px; width: 22px; height: 22px; border-radius: 11px; background: ${D.muted}; color: ${D.text}; font-size: 11px; font-weight: 700; text-align: center; line-height: 22px; }
    .list .t { font-weight: 700; font-size: 13px; }
    .list .d { color: ${L.textMuted}; margin-top: 2px; }
    .two { display: flex; gap: 14px; }
    .two > div { flex: 1; }
    .foot { color: ${L.textFaint}; font-size: 10px; text-align: center; margin-top: 22px; }
  `;

  const netClass = r.net >= 0 ? 'accent' : '';
  const kpis = `
    <div class="kpis">
      <div class="kpi"><div class="c">Income</div><div class="v">${money(r.income)}</div></div>
      <div class="kpi"><div class="c">Spent</div><div class="v">${money(r.spend)}</div></div>
      <div class="kpi"><div class="c">Net</div><div class="v ${netClass}">${money(r.net)}</div></div>
      <div class="kpi"><div class="c">Savings rate</div><div class="v">${r.savingsRate != null ? pct(r.savingsRate) : '—'}</div></div>
    </div>`;

  const subs = r.subscriptionChanges.length
    ? `<table>${r.subscriptionChanges
        .map((a) => `<tr><td><b>${esc(a.title)}</b><br/><span class="faint">${esc(a.detail)}</span></td><td class="r ${a.yearlyImpact > 0 ? 'bad' : a.yearlyImpact < 0 ? 'good' : 'faint'}">${a.yearlyImpact ? (a.yearlyImpact > 0 ? '+' : '−') + money(Math.abs(a.yearlyImpact)) + '/yr' : ''}</td></tr>`)
        .join('')}</table>`
    : '<p class="faint">No price changes, trials or new subscriptions.</p>';

  const cancels = r.cancelCandidates.length
    ? `<table>${r.cancelCandidates
        .map((c) => `<tr><td>${esc(c.name)} <span class="faint">(${c.answer === 'cancel' ? 'you plan to cancel' : 'not using'})</span></td><td class="r good">save ${money(c.yearly)}/yr</td></tr>`)
        .join('')}</table>`
    : '<p class="faint">None marked.</p>';

  const goals = r.goals.length
    ? `<table><tr><th>Goal</th><th class="r">Saved</th><th class="r">Target</th><th class="r">On track for</th></tr>${r.goals
        .map((g) => `<tr><td>${g.emoji} ${esc(g.name)}</td><td class="r">${money(g.saved)}</td><td class="r">${money(g.target)}</td><td class="r">${g.eta ? monthYear(g.eta) : '<span class="faint">beyond 5 years</span>'}</td></tr>`)
        .join('')}</table>`
    : '<p class="faint">No goals yet.</p>';

  const e = r.emergency;
  const efLine = e.monthlyNeed > 0
    ? `${money(e.fund)} covers <b>${e.monthsCovered.toFixed(1)}</b> of ${e.targetMonths} months of expenses (${money(e.monthlyNeed)}/month).${e.eta ? ` At the current surplus the target is reached around ${monthYear(e.eta)}.` : ''}`
    : `${money(e.fund)} saved. Add a few months of data to see how many months it covers.`;

  const over = r.overBudget.length
    ? `<p>${r.overBudget.map((o) => `${o.emoji} ${esc(o.name)} <span class="bad">${money(o.spent)}</span> of ${money(o.budget)}`).join(' · ')}</p>`
    : '<p class="good">Every budget stayed within its limit.</p>';

  const learned = r.rulesLearned.count || r.rulesLearned.labels.length
    ? `<p>${r.rulesLearned.count} new rule${r.rulesLearned.count === 1 ? '' : 's'} learned from your corrections.</p>${r.rulesLearned.labels.length ? `<ol class="list">${r.rulesLearned.labels.map((l, i) => `<li><span class="num">${i + 1}</span><div class="d">${esc(l)}</div></li>`).join('')}</ol>` : ''}`
    : '<p class="faint">No corrections this month.</p>';

  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Bachat review — ${esc(r.label)}</title><style>${css}</style></head><body>
    <div class="band">
      <span class="logo">ब</span><h1>Monthly review · ${esc(r.label)}</h1>
      <div class="sub">${r.partial ? `Month to date (to ${esc(r.to)}), compared with the same days of ${esc(r.prevLabel)}` : `Compared with ${esc(r.prevLabel)}`}. Invested at cost this month: ${money(r.invested)} (not counted as spend).</div>
      ${kpis}
    </div>

    <h2>Focus for next month</h2>
    <div class="card"><ol class="list">${r.focus
      .map((f, i) => `<li><span class="num">${i + 1}</span><div><div class="t">${esc(stripEmoji(f.title))}</div><div class="d">${esc(stripEmoji(f.body))}</div></div></li>`)
      .join('')}</ol></div>

    <div class="two">
      <div><h2>Top categories</h2><div class="card">${lineTable(r.topCategories, r.prevLabel)}</div></div>
      <div><h2>Top merchants</h2><div class="card">${lineTable(r.topMerchants, r.prevLabel)}</div></div>
    </div>

    <h2>Budgets</h2><div class="card">${over}</div>

    <div class="two">
      <div><h2>Subscription changes</h2><div class="card">${subs}</div></div>
      <div><h2>Could cancel</h2><div class="card">${cancels}</div></div>
    </div>

    <h2>Goals</h2><div class="card">${goals}</div>
    <h2>Emergency fund</h2><div class="card"><p>${efLine}</p></div>
    <h2>What Bachat learned</h2><div class="card">${learned}</div>

    <div class="foot">Made on your device by Bachat. All numbers are computed from your own transactions.<br/>Educational information only, not financial advice.</div>
  </body></html>`;
}

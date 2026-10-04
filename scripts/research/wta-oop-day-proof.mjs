// WTA order-of-play DAY proof (owner requirement before the 23:59 MatchTimeStamp placeholder may set scheduled_day).
// Read-only, honest requests through workers/shared/http.js (polite client, our UA) to the SAME official endpoints the
// wta provider already uses (calendar + tournament matches). Nothing is written to any store.
//   node scripts/research/wta-oop-day-proof.mjs [--capture]  -> docs/evidence/wta-oop-day-proof.{json,md}
//   --capture also saves the raw (trimmed) scheduled rows to WTA_OOP_CAPTURES (default D:/Workers/research-data/tennis-oop-captures, never the repo)/<UTC-time>.json so a later
//   run can compare the placeholder day with the day the match was actually played (started_at local day).
//
// Checks, per tournament:
//   A. placeholder vs full ISO: entries that carry BOTH a 23:59 MatchTimeStamp placeholder AND a full-ISO
//      NotBeforeISOTime — two independent sourced statements of the same match's day (and offset) — must agree;
//   B. placeholder vs time-only NotBeforeISOTime offset: the placeholder's offset must equal the local offset the source
//      states for the start time ('15:00+0300');
//   C. plausibility: a placeholder day must lie within the tournament's start..end dates and, for a published order of
//      play, be the source's local today or tomorrow;
//   D. (from earlier captures) placeholder day vs the local day of the eventual sourced started_at, for matches played;
//   E. MatchTimeStamp + time-only NotBeforeISOTime agreement: a scheduled row whose MatchTimeStamp is a FULL timestamp
//      (not the 23:59 placeholder) whose local time-of-day AND offset equal the time-only NotBeforeISOTime ('20:30+0800'
//      vs '2026-10-04T20:30+08:00') — two sourced fields agreeing; its date is the sourced day of play;
//   F. placeholder rows flagged Unscheduled:true (not on an order of play yet) — their 23:59 date is NOT a day of play.
import fs from 'node:fs';
import { SourceClient } from '../../workers/shared/http.js';
import * as wta from '../../workers/providers/wta.js';

// Raw captures stay OUT of this public repo (CLAUDE.md: docs/evidence = counts/hashes only): private local research store.
const CAP = process.env.WTA_OOP_CAPTURES || 'D:/Workers/research-data/tennis-oop-captures';
const capture = process.argv.includes('--capture');
const client = new SourceClient();
const now = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const day = 864e5;
const PH = /^(\d{4}-\d{2}-\d{2})T23:59(?::00(?:\.0+)?)?([+-]\d{2}:?\d{2}|Z)$/;
const FULL = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?([+-]\d{2}:?\d{2}|Z)$/;
const TIME_ONLY = /^\d{2}:\d{2}([+-]\d{2}:?\d{2})$/;
const normOff = (o) => (o === 'Z' ? '+00:00' : o.length === 5 ? `${o.slice(0, 3)}:${o.slice(3)}` : o);
const localDay = (isoTs) => { const m = FULL.exec(isoTs || ''); if (!m) return null; const off = normOff(m[2]); const sign = off[0] === '-' ? -1 : 1; const mins = sign * (Number(off.slice(1, 3)) * 60 + Number(off.slice(4, 6))); return iso(new Date(Date.parse(isoTs) + mins * 60e3)); };

const cal = wta.calendar.request({ from: iso(new Date(now - 3 * day)), to: iso(new Date(+now + 3 * day)), pageSize: 50 });
const calRes = await client.get(cal.url, { conditional: false });
const events = (JSON.parse(calRes.body).content || []).filter((t) => t.startDate <= iso(new Date(+now + 2 * day)) && t.endDate >= iso(now));
const fetched = [{ url: cal.url, status: calRes.status, fetched_at: calRes.fetched_at }];
const rows = [];
const per = {};
for (const t of events) {
  const id = t.tournamentGroup?.id, year = t.year;
  const r = wta.matches.request({ eventId: id, year });
  let res;
  try { res = await client.get(r.url, { conditional: false }); } catch (e) { fetched.push({ url: r.url, error: String(e.message || e).slice(0, 120) }); continue; }
  fetched.push({ url: r.url, status: res.status, fetched_at: res.fetched_at });
  const ms = (JSON.parse(res.body).matches || []);
  const name = `${t.tournamentGroup?.name || id} (${t.level})`;
  const P = (per[name] ||= { start: t.startDate, end: t.endDate, scheduled_rows: 0, placeholders: 0, placeholders_unscheduled: 0, E_both: 0, E_agree: 0, E_mismatch: [], A_both: 0, A_agree: 0, A_mismatch: [], B_both: 0, B_agree: 0, B_mismatch: [], C_out_of_window: [], placeholder_days: {} });
  for (const m of ms) {
    if (m.MatchState !== 'U') continue;
    P.scheduled_rows += 1;
    const ph = PH.exec(m.MatchTimeStamp || '');
    rows.push({ event: id, year, name, MatchID: m.MatchID, MatchState: m.MatchState, MatchTimeStamp: m.MatchTimeStamp ?? null, NotBefore: m.NotBefore ?? null, NotBeforeISOTime: m.NotBeforeISOTime ?? null, Unscheduled: m.Unscheduled ?? null, CourtName: m.CourtName ?? null });
    const nbT = TIME_ONLY.exec(m.NotBeforeISOTime || '');
    const mtsFull = !ph && FULL.exec(m.MatchTimeStamp || '');
    if (nbT && mtsFull) {
      P.E_both += 1;
      const mtsTime = /T(\d{2}:\d{2})/.exec(m.MatchTimeStamp)[1];
      const ok = mtsTime === m.NotBeforeISOTime.slice(0, 5) && normOff(mtsFull[2]) === normOff(nbT[1]);
      if (ok) P.E_agree += 1; else P.E_mismatch.push({ MatchID: m.MatchID, match_time_stamp: m.MatchTimeStamp, not_before: m.NotBeforeISOTime });
    }
    if (!ph) continue;
    P.placeholders += 1;
    if (m.Unscheduled === true) P.placeholders_unscheduled += 1;
    const pDay = ph[1], pOff = normOff(ph[2]);
    P.placeholder_days[pDay] = (P.placeholder_days[pDay] || 0) + 1;
    const nb = m.NotBeforeISOTime || '';
    const full = FULL.exec(nb);
    if (full) { P.A_both += 1; const nbDay = localDay(nb) ?? full[1]; if (nbDay === pDay) P.A_agree += 1; else P.A_mismatch.push({ MatchID: m.MatchID, placeholder: m.MatchTimeStamp, not_before: nb }); }
    const tOnly = TIME_ONLY.exec(nb);
    if (tOnly) { P.B_both += 1; if (normOff(tOnly[1]) === pOff) P.B_agree += 1; else P.B_mismatch.push({ MatchID: m.MatchID, placeholder: m.MatchTimeStamp, not_before: nb }); }
    if (pDay < t.startDate || pDay > t.endDate) P.C_out_of_window.push({ MatchID: m.MatchID, placeholder: m.MatchTimeStamp });
  }
}
// D: earlier captures -> did matches play on the placeholder's day?
const D = { captures: 0, compared: 0, agree: 0, mismatch: [] };
if (fs.existsSync(CAP)) {
  const current = new Map();
  for (const t of events) {
    try { const res = await client.get(wta.matches.request({ eventId: t.tournamentGroup?.id, year: t.year }).url); for (const m of JSON.parse(res.body).matches || []) current.set(`${t.tournamentGroup?.id}|${m.MatchID}`, m); } catch { /* recorded above */ }
  }
  for (const f of fs.readdirSync(CAP).filter((x) => x.endsWith('.json'))) {
    D.captures += 1;
    for (const r of JSON.parse(fs.readFileSync(`${CAP}/${f}`, 'utf8')).rows || []) {
      const ph = PH.exec(r.MatchTimeStamp || ''); if (!ph) continue;
      const m = current.get(`${r.event}|${r.MatchID}`);
      if (!m || !['P', 'F'].includes(m.MatchState) || !FULL.test(m.MatchTimeStamp || '')) continue;
      const playedLocal = localDay(m.MatchTimeStamp.replace(/[+-]\d{2}:?\d{2}$|Z$/, normOff(ph[2]) === '+00:00' ? 'Z' : normOff(ph[2])));
      D.compared += 1;
      if (playedLocal === ph[1]) D.agree += 1; else D.mismatch.push({ capture: f, MatchID: r.MatchID, placeholder: r.MatchTimeStamp, started: m.MatchTimeStamp });
    }
  }
}
if (capture) { fs.mkdirSync(CAP, { recursive: true }); fs.writeFileSync(`${CAP}/${now.toISOString().replace(/[:.]/g, '-')}.json`, JSON.stringify({ captured_at: now.toISOString(), rows }, null, 1)); }
const tot = (k) => Object.values(per).reduce((n, p) => n + (Array.isArray(p[k]) ? p[k].length : p[k]), 0);
const tournamentsWithEvidence = Object.values(per).filter((p) => p.A_both + p.B_both > 0).length;
const eTournaments = Object.values(per).filter((p) => p.E_both > 0).length;
const verdict = {
  placeholder_day_proven: tot('A_both') > 0 && tot('A_mismatch') === 0 && tot('C_out_of_window') === 0 && Object.values(per).filter((p) => p.A_both > 0).length >= 2 && D.mismatch.length === 0,
  rule: 'proven only if: >= 2 tournaments have entries carrying both a placeholder and a full-ISO NotBeforeISOTime, every such pair agrees on the local day, no placeholder falls outside its tournament window, and no earlier capture contradicts the day the match was played',
  placeholders_all_unscheduled: tot('placeholders') > 0 && tot('placeholders_unscheduled') === tot('placeholders'),
  mts_notbefore_agreement: { rows: tot('E_both'), agree: tot('E_agree'), mismatch: tot('E_mismatch'), tournaments: eTournaments, consistent: tot('E_both') > 0 && tot('E_mismatch') === 0 },
};
const out = { generated_at: now.toISOString(), source: 'api.wtatennis.com (same endpoints as workers/providers/wta.js), read-only, polite client', requests: fetched, totals: { tournaments: Object.keys(per).length, scheduled_rows: tot('scheduled_rows'), placeholders: tot('placeholders'), placeholders_unscheduled: tot('placeholders_unscheduled'), E_both: tot('E_both'), E_agree: tot('E_agree'), E_mismatch: tot('E_mismatch'), A_both: tot('A_both'), A_agree: tot('A_agree'), A_mismatch: tot('A_mismatch'), B_both: tot('B_both'), B_agree: tot('B_agree'), B_mismatch: tot('B_mismatch'), C_out_of_window: tot('C_out_of_window'), tournaments_with_cross_evidence: tournamentsWithEvidence }, D_played_day: D, per_tournament: per, verdict };
fs.writeFileSync('docs/evidence/wta-oop-day-proof.json', JSON.stringify(out, null, 1));
const md = [`# WTA order-of-play day proof — ${now.toISOString()}`, '', `Verdict: **placeholder day ${verdict.placeholder_day_proven ? 'PROVEN' : 'NOT PROVEN'}** — ${verdict.rule}.`, '', `Totals: ${JSON.stringify(out.totals)}`, '', `Placeholders on Unscheduled:true rows: ${tot('placeholders_unscheduled')} of ${tot('placeholders')} (an unscheduled row is not on an order of play: its 23:59 date is never a day of play).`, '', `E. MatchTimeStamp vs time-only NotBeforeISOTime agreement: ${tot('E_agree')} of ${tot('E_both')} rows agree on local time + offset across ${eTournaments} tournaments (${tot('E_mismatch')} mismatches).`, '', 'Consequence in code (workers/providers/wta.js wtaScheduleDay): the placeholder path stays OFF (PLACEHOLDER_DAY_PROVEN = false; never on an Unscheduled row even if enabled). Precedence 1 = full-ISO NotBeforeISOTime (source wta_not_before_iso). Precedence 2 = a non-placeholder MatchTimeStamp whose local time and offset equal the time-only NotBeforeISOTime (source wta_order_of_play; check E above). +00:00 / Z offsets are stored as null (unproven -> HOLD). Re-run with --capture on later days; check D then compares earlier placeholders with the day each match was actually played.', '', `Played-day check (earlier captures): ${JSON.stringify({ captures: D.captures, compared: D.compared, agree: D.agree, mismatches: D.mismatch.length })}`, '', '| Tournament | window | scheduled U rows | placeholders | A: both / agree / mismatch | B: both / agree / mismatch | out of window | placeholder days |', '|---|---|---|---|---|---|---|---|',
  ...Object.entries(per).map(([n, p]) => `| ${n} | ${p.start}..${p.end} | ${p.scheduled_rows} | ${p.placeholders} | ${p.A_both} / ${p.A_agree} / ${p.A_mismatch.length} | ${p.B_both} / ${p.B_agree} / ${p.B_mismatch.length} | ${p.C_out_of_window.length} | ${JSON.stringify(p.placeholder_days)} |`)].join('\n');
fs.writeFileSync('docs/evidence/wta-oop-day-proof.md', `${md}\n`);
console.log(JSON.stringify({ totals: out.totals, D: { compared: D.compared, agree: D.agree, mismatch: D.mismatch.length }, verdict: verdict.placeholder_day_proven }));

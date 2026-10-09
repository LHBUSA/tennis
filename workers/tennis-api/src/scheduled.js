// tennis-api cron (*/10): freeze pre-match matchup snapshots (matchup-freeze.js), the PBE Picker V1 ledger, and the RESEARCH-ONLY Matchup Model V2
// shadow for the snapshots just written (mm2-shadow.js). The shadow can never affect a snapshot or any API response:
// it runs after the freezer, writes only under research/mm2/ in R2, and its failures are logged and swallowed.
import { freezeUpcoming } from './matchup.js';
import { shadowFrozen } from './mm2-shadow.js';
import { runPicker } from './picker-ledger.js';
import { runAtpShadow } from './picker-v2-atp.js';
import { r2CreateOnlySelftest, SELFTEST_VERSION } from './r2-selftest.js';
import { runVerification } from './picks-verify.js';

export async function scheduledRun(store, env) {
  let out;
  try { out = await freezeUpcoming(store, env); }
  catch (e) { if (env.TENNIS_STATE) await env.TENNIS_STATE.put('matchup:freeze:error', JSON.stringify({ at: new Date().toISOString(), error: String(e?.stack || e).slice(0, 600) })); return; }
  try {
    const s = await shadowFrozen(env.TENNIS_SOURCE, out?.items);
    if (env.TENNIS_STATE && s.considered) await env.TENNIS_STATE.put('mm2:shadow:last', JSON.stringify(s));
  } catch (e) { if (env.TENNIS_STATE) await env.TENNIS_STATE.put('mm2:shadow:error', JSON.stringify({ at: new Date().toISOString(), error: String(e?.stack || e).slice(0, 600) })); }
  // PBE Picker V1 ledger (picker-ledger.js): designated decisions at their lock + grading. Records are write-once and
  // PROSPECTIVE · NOT OFFICIAL until the owner activates the policy. PICKER_V1=0 stops recording.
  if (env.PICKER_V1 !== '0') {
    try { await runPicker(store, env); }
    catch (e) { if (env.TENNIS_STATE) await env.TENNIS_STATE.put('picker:v1:error', JSON.stringify({ at: new Date().toISOString(), error: String(e?.stack || e).slice(0, 600) })); }
  }
  // Tennis Picks V2 ATP SHADOW ledger (picker-v2-atp.js): the prospective holdout of atp-recal/2. RESEARCH only, never
  // official, never touches Picker V1 records. PICKER_V2_ATP=0 stops recording.
  if (env.PICKER_V2_ATP !== '0') {
    try { await runAtpShadow(store, env); }
    catch (e) { if (env.TENNIS_STATE) await env.TENNIS_STATE.put('picker:v2:atp-shadow:error', JSON.stringify({ at: new Date().toISOString(), error: String(e?.stack || e).slice(0, 600) })); }
  }
  // Read-only lock verification ledger (picks-verify.js): re-checks every new decision from its stored bytes and appends
  // findings under ledger/verification/v1/ only — it never writes or changes a decision. PICKS_VERIFY=0 stops it.
  if (env.PICKS_VERIFY !== '0') {
    try { await runVerification(store, env); }
    catch (e) { if (env.TENNIS_STATE) await env.TENNIS_STATE.put('picks:verify:error', JSON.stringify({ at: new Date().toISOString(), error: String(e?.stack || e).slice(0, 600) })); }
  }
  // One-time REAL-R2 proof of the create-only ledger contract (r2-selftest.js): runs once per SELFTEST_VERSION, writes only
  // under ledger/selftest/, evidence in KV picker:v2:r2-selftest:<version>.
  try {
    if (env.TENNIS_STATE && env.TENNIS_SOURCE && !(await env.TENNIS_STATE.get(`picker:v2:r2-selftest:${SELFTEST_VERSION}`))) {
      const r = await r2CreateOnlySelftest(env.TENNIS_SOURCE);
      await env.TENNIS_STATE.put(`picker:v2:r2-selftest:${SELFTEST_VERSION}`, JSON.stringify(r));
    }
  } catch (e) { if (env.TENNIS_STATE) await env.TENNIS_STATE.put(`picker:v2:r2-selftest:${SELFTEST_VERSION}`, JSON.stringify({ at: new Date().toISOString(), pass: false, error: String(e?.stack || e).slice(0, 600) })); }
}

// tennis-api cron (*/10): freeze pre-match matchup snapshots (matchup-freeze.js), the PBE Picker V1 ledger, and the RESEARCH-ONLY Matchup Model V2
// shadow for the snapshots just written (mm2-shadow.js). The shadow can never affect a snapshot or any API response:
// it runs after the freezer, writes only under research/mm2/ in R2, and its failures are logged and swallowed.
import { freezeUpcoming } from './matchup.js';
import { shadowFrozen } from './mm2-shadow.js';
import { runPicker } from './picker-ledger.js';

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
}

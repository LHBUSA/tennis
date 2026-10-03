// /methodology — rendered from the SAME definition registry the DNA builder uses, so the page can
// never drift from the math.

import { html, render } from '../lib/dom.js';
import { DEFINITIONS, DEFINITION_VERSION } from '../../workers/shared/dna/metric.js';
import { MATCH_DEFINITIONS, MATCH_DNA_VERSION, PERCENTILE_MIN_PEERS, COMPARATIVE_MIN } from '../../workers/shared/dna/match-dna.js';

const FAMILY = { serve: 'Serve', return: 'Return', pressure: 'Pressure' };
const MFAMILY = { result_strength: 'Result strength', pressure: 'Pressure (from scores)', opponent_quality: 'Opponent quality' };

export function mount(root) {
  const fams = Object.keys(FAMILY);
  render(root, html`<div class="page prose-page">
    <header class="page-h">
      <p class="eyebrow">Methodology</p>
      <h1>Tennis DNA</h1>
      <p class="lede">Every derived number on PropBetEdge Tennis is a frozen formula over canonical match data, published with its numerator, denominator, sample, confidence and an exclusive as-of date. No metric exists until its formula is documented here. Tennis DNA has two layers: <b>Match DNA</b> (v${MATCH_DNA_VERSION}, built from results and scores — available for ATP and WTA players alike) and <b>technical DNA</b> (v${DEFINITION_VERSION}, serve/return/pressure from match statistics — only where statistics exist).</p>
    </header>
    <section class="mod"><header class="mod-h"><h2>Match DNA v${MATCH_DNA_VERSION} — results-based</h2></header><div class="mod-b prose">
      <ul>
        <li><b>Same tour only.</b> ATP and WTA players are separate populations; a percentile never pools the two.</li>
        <li><b>Percentiles</b> need at least ${PERCENTILE_MIN_PEERS} same-tour peers with medium or high confidence on that metric; a comparison is published once ${COMPARATIVE_MIN} same-tour players qualify.</li>
        <li><b>PBE Rating</b> is published for a tour only where it beats a ranking-based baseline out of sample; otherwise it is held.</li>
        <li><b>Sources.</b> Men’s results come from official Grand Slam feeds and, for the ATP Tour, a secondary source; women’s from official WTA data, its player histories and the same secondary source. Every snapshot lists its source families.</li>
      </ul>
    </div></section>
    ${Object.keys(MFAMILY).map((f) => html`<section class="mod"><header class="mod-h"><h2>Match DNA · ${MFAMILY[f]}</h2></header><div class="mod-b">
      <table class="defs"><thead><tr><th scope="col">Metric</th><th scope="col">Definition</th><th scope="col">Min. denominator</th></tr></thead>
      <tbody>${Object.entries(MATCH_DEFINITIONS).filter(([, d]) => d.family === f).map(([k, d]) => html`<tr><th scope="row"><code>${k}</code></th><td>${d.doc}</td><td>${d.min_den}</td></tr>`)}</tbody></table>
    </div></section>`)}
    <section class="mod"><header class="mod-h"><h2>Technical DNA v${DEFINITION_VERSION} — from match statistics</h2></header><div class="mod-b prose"><p>Serve, return and pressure metrics need per-match statistics. Where a tour does not yet have enough players with meaningful statistical samples, technical comparisons stay held — Match DNA is still shown.</p></div></section>
    <section class="mod"><header class="mod-h"><h2>Rules for every metric</h2></header><div class="mod-b prose">
      <ul>
        <li><b>Summed, not averaged.</b> Ratios sum numerators and denominators across the sample; a player with one 3-set match and one 5-set match is not weighted per match.</li>
        <li><b>Missing stays missing.</b> A match without an input is excluded from that metric and lowers its coverage — it is never counted as zero.</li>
        <li><b>Exclusive as-of.</b> A snapshot dated D contains only matches played before D, so history can be re-read exactly as it stood.</li>
        <li><b>Confidence.</b> <i>insufficient</i> below the metric’s minimum denominator; <i>low</i> under 5 matches or under twice the minimum; <i>medium</i> under 15 matches or five times the minimum; <i>high</i> above.</li>
        <li><b>Versioned.</b> A formula change is a new definition version; old snapshots keep the version they were built with.</li>
        <li><b>Fact, metric, model, interpretation are separate.</b> A PBE-derived metric is never presented as an official statistic, and a model output is never presented as a metric.</li>
      </ul>
    </div></section>
    ${fams.map((f) => html`<section class="mod"><header class="mod-h"><h2>${FAMILY[f]}</h2></header><div class="mod-b">
      <table class="defs"><thead><tr><th scope="col">Metric</th><th scope="col">Definition</th><th scope="col">Min. denominator</th></tr></thead>
      <tbody>${Object.entries(DEFINITIONS).filter(([, d]) => d.family === f).map(([k, d]) => html`<tr><th scope="row"><code>${k}</code></th><td>${d.doc}</td><td>${d.min_den}</td></tr>`)}</tbody></table>
    </div></section>`)}
    <section class="mod"><header class="mod-h"><h2>Not defined yet — so not shown</h2></header><div class="mod-b prose">
      <p>Pressure composites (“clutch”), momentum, Partner Lift, Breakout Watch and a betting-grade match model each need a published, versioned method and — where predictive — an out-of-sample validation before they appear anywhere on this site.</p>
    </div></section>
  </div>`);
  return () => {};
}

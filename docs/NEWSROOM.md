# Newsroom (tennis-news)

Not `RSS → LLM → publish`. Pipeline:

`source event (our own graph) → normalization → entity graph → evidence packet → materiality → article
structure → generation → factual gates → reconciliation → publish | HOLD`

Status: contract only. The Worker is a skeleton; there is no event graph yet, so nothing can publish.

## Events

Detected from canonical data and the source-change ledger: upsets (rank-gap thresholds at the snapshot
valid on match date), comebacks, marathon matches, retirements (never a reason), first wins at a level,
first Top-100/50/25/10 wins, qualifier / lucky-loser runs, first QF/SF/final/title, ranking milestones
and career highs, draw releases and withdrawals, doubles pair titles/changes, ITF → Challenger → tour
transitions. `event_id = hash(kind + entity ids + as_of)` so reruns never duplicate.

## Evidence packet

`{ event, match, participants, score, rankings, surface, tournament, round, match_stats, serve_stats,
return_stats, recent_form, historical_context, dna_snapshot, model_snapshot, market_snapshot,
draw_context, sources }` — only families that exist. Frozen into `tennis_article_evidence` at
generation; historical articles never re-read live tables.

## Gates (a failure = HOLD, never publish around it)

numeric grounding (every number in prose exists in the packet) · entity/name · score (re-validated with
`validateScore`) · ranking (snapshot at event date, not today) · temporal (no DNA/ranking newer than the
event) · duplicate real-world event · media (approved photo of the right player) · banned phrases
(cliché, unsupported mentality/injury/motivation claims) · fact vs PBE metric vs model vs interpretation
labeling.

## Article format

MATCH DATA · WHY IT MATTERED · TENNIS DNA · PATH THROUGH THE DRAW · WHAT'S NEXT · EVIDENCE & METHOD.
Every analysis piece carries a read, evidence, counter-evidence, unknowns and next implication.
Auto-links: players, opponent, tournament, match, draw, ranking, H2H, prior stories.

## QA fixtures to build with the first event source

fabricated score, wrong opponent, wrong ranking, wrong tournament, unsupported medical claim,
unsupported odds claim, current ranking in a historical article, live DNA in a historical article,
duplicate event, wrong photo, unsupported numeric prose, frozen snapshot unchanged, quiet day → no article.

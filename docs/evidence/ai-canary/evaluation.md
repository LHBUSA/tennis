# Astra vs Sol offline canary — evaluation (2026-09-29)

Offline only: 10 frozen production packets, both models, identical instructions / packet / schema / plan / gates,
attempts=1, output cap 8000. **Nothing was published.** Run against production tennis-news 5060d7fe via the admin
`POST /v1/news/canary`; raw outputs in `raw/`, blind artifact `blind-review.md`, key `key.json`.

## Gates
| | at run (gates 4.0.0) | re-gated (4.0.1) |
|---|---|---|
| gpt-5.6-sol | 5/10 | 7/10 |
| gpt-6-astra | 7/10 | 9/10 |

4.0.1 removed four false-positive patterns the canary exposed (W-L "67-107 record" read as odds and as a record claim;
"last 10 matches" window size; wrong_winner matching across headline/dek; the losing finalist "reached the title
match"). Regression tests keep the real violations held. Every remaining failure is `chart_narration` (paragraph reads a
chart's figures back): Sol 01, 05, 07; Astra 08. In production a gate failure falls back to the deterministic baseline —
no fact risk either way, but a failed call is a wasted call.

## Metrics (per call, averages)
| | input | output | reasoning | median latency | median words | nominal cost (10 calls) |
|---|---|---|---|---|---|---|
| Sol | 5,859 | 1,512 | 973 | 20.3 s | 255 | $0.2134 (nominal standard rate) |
| Astra | 5,859 | 785 | 213 | 18.1 s | 253 | rate not configured — not stated |

Astra used ~48% fewer output tokens (much less reasoning) at similar length and latency.

## Blind review
Reviewer: Claude (single reviewer). **Blindness caveat:** the artifact printed each version's gate result next to it,
and the earlier failure listing named models, so identity was partly inferable before scoring. Treat as indicative.

| # | category (packet) | preferred | why |
|---|---|---|---|
| 1 | major match (title) | Astra | synthesis ("pressure on both deliveries") vs Sol stat recitation, Sol chart-narration fail |
| 2 | upset (Prozorova d. Eala) | Astra | explains 2nd-serve-return vs overall-return split; draw context; Sol ungrounded number |
| 3 | routine (Fernandez comeback) | tie | Astra cleaner reading of "not broad dominance"; Sol's archive comeback-rate paragraph equally strong |
| 4 | player form (Preston d. Ostapenko) | Astra | links 38.6% first-serve-in to exposure; Sol three number-dense paragraphs |
| 5 | ranking movement* (Chengdu final) | Astra | tiebreak/semifinal contrast, opponent profile; Sol 5 number-dense paragraphs + chart narration |
| 6 | tournament intelligence* (Seoul final) | tie | Astra adds form context; Sol adds return-points detail |
| 7 | ATP (Harris d. Vacherot) | Astra | frames form vs ranking; Sol chart narration |
| 8 | WTA (Porto 125 final) | Sol | Astra chart-narration fail; Sol equal insight, gate pass |
| 9 | rich packet (Cengiz comeback) | tie | Sol tells the comeback directly; Astra less dense + prior-final context |
| 10 | thin doubles | Astra | "aces misleading / same first-serve %" insight; Sol repeats itself |

*substitutes: no ranking-movement or tournament-intelligence packet has ever been stored.

**Astra 6 · Sol 1 · tie 3.**

## Verdict
- **ASTRA materially better: MIXED, leaning yes** — better synthesis on upsets and finals (fewer stat read-outs,
  more "why"), higher gate pass, half the output tokens. Not decisive on routine, title-summary and rich-comeback stories.
- **Where Sol is equivalent:** routine results, tournament-closing titles, rich packets with an obvious narrative.
- **Evidence gap:** none of the 10 packets was flagship-eligible (no Grand Slam match, no major ranking move, no deep
  story exists yet). Every Astra win is on WTA 125–500 / ATP 250 material. No flagship class is *proven*.

## Recommended routing
- STANDARD_EDITORIAL stays `gpt-5.6-sol` for all model-written stories.
- `TENNIS_AI_FLAGSHIP_ENABLED` stays **false**; `TENNIS_AI_FLAGSHIP_CLASSES` stays empty. Not promoted globally, not per class.
- Release candidates when proven: `major_upset_deep`, `major_final_semifinal` (the story shapes Astra won).
  Proof = the same canary on ≥5 real flagship-eligible packets (next: Australian Open, Jan 2027) plus a configured
  Astra rate in `TENNIS_AI_RATES` so nominal cost is comparable. Release is a var change only (no code).

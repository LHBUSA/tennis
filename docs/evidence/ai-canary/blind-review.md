# Tennis AI canary — blind review

Two versions per frozen packet, identical instructions, schema, plan, output cap and gates. Model names are hidden: score first, then open key.json.

## Scoring (1-5 each; gate pass is objective)
1. factual gate pass · 2. depth / evidence coverage · 3. synthesis vs stat recitation · 4. headline · 5. section quality · 6. repetition (5 = none) · 7. tennis-specific analysis · 8. readability · 9. tokens (from metrics) · 10. latency (from metrics)

## 1. major match — full · wta

### VERSION A
- gate: PASS · 517 words · 4 sections · families: stats, dna · repeated 5-grams 0 · paragraphs with 4+ numbers 1

**Fernandez wins Singapore title with decisive return advantage**

_Leylah Fernandez beat Talia Gibson 7-5, 6-0 in 1 hour 38 minutes to win the indoor-hard WTA 500 final._

#### A wildcard entry delivers the title
Fernandez arrived in Singapore as a wildcard and the No. 6 seed. Her championship adds a title-winning finish to a recent hard-court schedule that included wins in Montreal and at the US Open, alongside defeats at Cincinnati and the US Open.

There were no previous meetings between Fernandez and Gibson in our records, so the archive offered no direct matchup history to frame this final. The evidence from Singapore itself is clearer: Fernandez combined more productive serving with return pressure that Gibson could not match.

#### Pressure on both deliveries
The serve numbers show why Gibson had difficulty protecting her games. She won 51.4% of points behind her first serve and 40.6% behind her second. Landing the first delivery therefore offered only limited protection; Fernandez was competitive against it and had the stronger share of exchanges when Gibson needed another delivery.

Fernandez’s own second serve provided a meaningful contrast. She won 55% of those points, keeping that part of her service game on the positive side of the ledger. Gibson could apply pressure, but Fernandez was less exposed when her first serve did not land.

That distinction carried through to the opportunities on return. Fernandez generated 12 break points and converted 6. Her advantage was not simply that she won return points in volume: she repeatedly brought Gibson’s service games to a point where they could change hands, then converted those chances.

Gibson converted 2 of 5 break points, so this was not a final in which Fernandez’s serve went untouched. The difference was the frequency of the pressure. Gibson made use of some openings, while Fernandez created a much larger supply and turned that sustained return threat into the more consequential advantage.

#### The final departed from the stored profile
The stored Technical DNA gives useful context without explaining every exchange. Gibson’s service-games-held figure was 72.5%, compared with Fernandez’s 68.5%. That profile did not translate into a serving advantage for Gibson in the final. It is a reminder that an aggregate describes a player’s sample, not the outcome of a particular matchup.

The return profiles were closer, with Fernandez holding the higher return-points-won figure. Her 53.6% in the final was above her stored 44.6%, showing how much more productive her return was in this match than across that broader sample.

Those DNA figures are not identified as indoor-hard-only statistics. They offer a reference for the performance, rather than evidence that the Singapore surface caused the separation between the players.

#### A different task from the semifinal
The supplied Singapore draw path shows Fernandez beating Maja Chwalinska 1-6 6-4 6-2 in the semifinal. That required a recovery after losing the opening set; the final did not require the same route through the score. Her title-clinching performance followed a match in which she had already demonstrated a different way to win.

Her recent hard-court results also resist a simple description of uninterrupted form. At the US Open, Fernandez beat Shuai Zhang and Mananchaya Sawangkaew before losing to Jessica Pegula. Gibson’s recent results included a Cincinnati win over Lilli Tagger and defeats against Aryna Sabalenka, Lizette Cabrera and Donna Vekic. Singapore supplied a new endpoint for those contrasting recent sequences: Fernandez finished with the trophy, Gibson as the finalist.

### VERSION B
- gate: FAIL (chart_narration) · 513 words · 5 sections · families: match, stats, dna, draw_path, tournament · repeated 5-grams 0 · paragraphs with 4+ numbers 8

**Fernandez wins the Singapore title**

_Fernandez won 7-5, 6-0 in 1 hour 38 minutes in the final of Singapore._

#### Fernandez closes with a shutout set
Leylah Fernandez defeated Talia Gibson 7-5, 6-0 to complete the WTA 500 indoor-hard event in Singapore. The No. 6 seed came through a competitive opening set before Gibson failed to win a game in the second.

The completed final lasted 1 hour 38 minutes. It was the last match of Singapore 2026 and Fernandez’s 2nd victory of the tournament in the stored draw path. There was no prior meeting between Fernandez and Gibson in our records.

#### Serve and return created the separation
The serve numbers show a wide gap in effectiveness. Fernandez won 62.3% of her service points, while Gibson won 46.4%. Fernandez also had the stronger first-serve outcome, winning 66.7% of those points compared with Gibson’s 51.4%.

The difference remained when the first serve missed. Fernandez won 55% of her second-serve points; Gibson won 40.6%. That gave Fernandez a more stable base in her service games while leaving Gibson exposed whenever rallies began behind the second serve.

Fernandez applied more return pressure, earning 12 break points to Gibson’s 5. She converted 50% of her chances, compared with Gibson’s 40%, allowing Fernandez to turn the larger supply of opportunities into control of the score.

Gibson could not compensate on return. Fernandez won 53.6% of her return points, whereas Gibson won 37.7%. Fernandez finished with 5 aces and Gibson with 2, another indication that Fernandez obtained more direct value from her delivery.

#### A title secured from the No. 6 seed line
Fernandez entered Singapore at No. 31 on the official WTA SINGLES list in force at the start of the tournament. Gibson was No. 63 on that same list. Fernandez’s ranking position and No. 6 seeding supplied the tournament context, but the final was settled by her advantage across both service and return points.

The result completed Fernandez’s Singapore run with the title rather than merely extending it. With no further match listed after the final, the consequence is definitive: she ended the WTA 500 event as champion.

#### Stored profiles did not capture the size of the final gap
The stored Technical DNA showed Gibson with a 72.5% hold rate and Fernandez at 68.5%. In the final, however, Fernandez produced the stronger service-point performance and faced fewer break opportunities, so the pre-match service profile did not carry through to this matchup.

Return performance offered a different signal. Fernandez’s stored return-points-won figure was 44.6%, narrowly above Gibson’s 43.9%. Fernandez then made return play the clearest part of her advantage in the final, especially by creating the larger pool of break chances.

The second-serve matchup was particularly important on the indoor hard court. Fernandez’s stored second-serve figure was 45.1%, but she won 55% in the final. Gibson entered with a stored figure of 46.2% and won 40.6% against Fernandez.

#### A turnaround in the semifinal, control in the final
Fernandez reached the title match by beating Maja Chwalinska 1-6, 6-4, 6-2 in the semifinal. That required her to respond after losing the opening set and complete the match across three sets.

The final followed a different shape. Fernandez did not need a deciding set against Gibson, moving from the tight 7-5 opener to a 6-0 second set. The contrast between those matches shows two distinct routes through the closing rounds: recovery in the semifinal and sustained statistical superiority in the championship match.

| criterion | A | B |
|---|---|---|
| 1 gate | | |
| 2 depth | | |
| 3 synthesis | | |
| 4 headline | | |
| 5 sections | | |
| 6 repetition | | |
| 7 tennis analysis | | |
| 8 readability | | |

## 2. upset — brief · wta

### VERSION A
- gate: FAIL (numeric_grounding) · 269 words · 4 sections · families: stats, dna · repeated 5-grams 0 · paragraphs with 4+ numbers 2

**Prozorova completes three-set Singapore upset of Eala**

_The No. 180 player recovered to win 4-6, 7-5, 6-3 in 3 hours 9 minutes at the indoor hard-court WTA 500._

#### Prozorova advances in Singapore
Tatiana Prozorova eliminated No. 3 seed Alexandra Eala in round 2, completing a demanding comeback after dropping the opening set. The official result sent Prozorova through with her 2nd win of the tournament, following her round 1 victory over Sofia Costoulas.

The best-of-3 match was completed without a retirement. It extended Prozorova’s run at an event where both of her matches have required a deciding set.

#### A major ranking upset
On the official WTA singles list in force at the start of the tournament, Prozorova was No. 180 and Eala was No. 18. Eala’s seeding and ranking made this the defining upset of the Singapore round 2 results.

The archived pre-match form samples added context to that separation: Prozorova had 5 wins and 5 losses over her last 10 matches, while Eala had 8 wins and 2 losses. Prozorova overturned that contrast on the court rather than allowing Eala’s stronger recent results to dictate the match.

#### First-serve strength offset second-serve pressure
The official serve numbers show why the contest stayed tight. Prozorova won 64.1% of her first-serve points, compared with Eala’s 52.2%. That stronger production gave Prozorova a foundation even though she won only 31.1% behind her second serve.

Eala attacked that second serve effectively, winning 68.9% of those return points. Prozorova nevertheless handled the larger break-point burden more successfully, saving 64.7% of the chances she faced; Eala saved 41.7%.

#### Conversion separated a match full of return pressure
Both players produced sustained return pressure, but Prozorova used her opportunities more efficiently. She converted 58.3% of her break points, while Eala converted 35.3%. That edge in conversion, combined with Prozorova’s stronger first-serve results, explains how she survived Eala’s advantage against the second serve and completed the upset.

### VERSION B
- gate: PASS · 277 words · 3 sections · families: stats · repeated 5-grams 0 · paragraphs with 4+ numbers 1

**Prozorova ousts Eala in Singapore comeback**

_Tatiana Prozorova won 4-6, 7-5, 6-3 in round 2, completing the upset in 3 hours 9 minutes._

#### A seeded exit in Singapore
The indoor-hard WTA 500 event lost its No. 3 seed as Alexandra Eala fell to an opponent ranked well below her at the start of the tournament. On the official WTA singles list in force when the tournament began, Prozorova was No. 180 and Eala No. 18.

The ranking contrast framed the upset, but the match statistics show a narrower contest: Prozorova had the stronger return performance overall despite Eala’s pronounced advantage against second serves.

#### Pressure converted, not just created
Prozorova’s service foundation was her first delivery: she won 64.1% of those points, compared with Eala’s 52.2%. That advantage mattered because her second serve was considerably more exposed. Eala repeatedly found success there, but that return strength did not extend equally across Prozorova’s service game.

Eala won 68.9% of second-serve return points against Prozorova’s 53.7%. The distinction is important: the loser was more effective in that specific exchange, while Prozorova’s stronger returns against the first serve helped her win a larger share of return points overall.

The break-point figures show how Prozorova made that pressure count. She converted 58.3% of her opportunities, compared with Eala’s 35.3%, and saved 64.7% of the break points she faced. Her success was not built on avoiding danger, but on limiting its consequences.

#### Another recovery in the draw
Prozorova had already come from a set down against Sofia Costoulas in round 1. That earlier recovery included a tiebreak; against Eala, she again overturned an opening-set loss to keep her Singapore run going.

The tournament also provides a contrast with Prozorova’s recent archived results, which include defeats to Kristina Liutova in US Open qualifying and Anastasia Zakharova at Landisville. In Singapore, she has followed her win over Costoulas by eliminating a seeded opponent.

| criterion | A | B |
|---|---|---|
| 1 gate | | |
| 2 depth | | |
| 3 synthesis | | |
| 4 headline | | |
| 5 sections | | |
| 6 repetition | | |
| 7 tennis analysis | | |
| 8 readability | | |

## 3. routine match — brief · wta

### VERSION A
- gate: PASS · 253 words · 3 sections · families: stats, match_dna · repeated 5-grams 0 · paragraphs with 4+ numbers 1

**Fernandez recovers from a set down to beat Chwalinska in Singapore**

_Second-serve returns provided the clearest statistical edge in a semifinal that was otherwise closely balanced._

#### Fernandez overturns the opening set
Leylah Fernandez beat Maja Chwalinska 1-6, 6-4, 6-2 in the Singapore semifinal, recovering from a heavily one-sided opening set at the indoor-hard WTA 500 tournament. The match lasted 2 hours 8 minutes.

The result put Fernandez above an opponent who began the tournament ahead of her on the ranking list. Fernandez stood at No. 31 and Chwalinska at No. 25 on the official WTA singles list in force at the start of the tournament.

#### Second serves made the separation
The serve numbers show that Fernandez's advantage was not built on a substantial difference behind the first serve: the players won a similar share of those points. Chwalinska landed her first serve more often, but was more exposed whenever she had to use her second delivery.

Fernandez won 44.4% of her second-serve points against Chwalinska's 33.3%. Neither player made that delivery a secure source of points, but Fernandez's return pressure extracted more from it.

Conversion did not separate them: each converted 5 of 8 break-point opportunities. That balance matters when reading the scoreline. Fernandez won the closing sets clearly, yet the match-wide figures do not describe sustained dominance.

The total-points comparison reinforces that distinction: Fernandez finished with 72 to Chwalinska's 69. Her recovery produced a decisive closing set without a similarly broad advantage across the match as a whole.

#### A different finish on hard courts
Fernandez's recent hard-court results included losses to Jessica Pegula at the US Open and Xiyu Wang in Cincinnati after winning the opening set. Singapore supplied the reverse outcome: she recovered from the initial deficit rather than surrendering an early lead.

### VERSION B
- gate: FAIL (unsupported_first_or_record) · 231 words · 3 sections · families: stats, match_dna · repeated 5-grams 0 · paragraphs with 4+ numbers 1

**Fernandez turns Singapore semifinal around against Chwalinska**

_The sixth seed recovered from a 1-6 opening set to win 1-6, 6-4, 6-2 in 2 hours 8 minutes on Singapore’s indoor hard court._

#### Fernandez answers a one-sided opening set
Leylah Fernandez defeated Maja Chwalinska in the completed semifinal of the WTA 500 event in Singapore. Fernandez entered as the sixth seed and Chwalinska as the fifth seed.

Fernandez was No. 31 and Chwalinska No. 25 on the official WTA singles list in force at the start of the tournament. The ranking gap and the opening set both pointed in Chwalinska’s direction, but Fernandez took the next two sets to complete the comeback.

#### Second-serve points created the separation
The serve numbers show the clearest distinction behind the second delivery. Fernandez won 44.4% of her second-serve points, while Chwalinska won 33.3%. Fernandez also claimed 66.7% of the points played against Chwalinska’s second serve, giving her a productive route into return games.

Both players converted 5 of 8 break points. That matching conversion line shows that neither lacked opportunities; the stronger work around Chwalinska’s second serve helped Fernandez turn pressure into a winning three-set pattern.

#### A comeback that cut against their archive profiles
Fernandez’s pre-match record in our archive showed a 15.4% comeback win rate across 39 matches in which she lost the opening set. Chwalinska’s profile showed an 87.3% match win rate across 55 matches after winning the first set. This result ran against both patterns.

The overall points remained close despite the sharp swings between sets: Fernandez won 72 points and Chwalinska 69. Fernandez’s advantage was not broad dominance across the match, but better production in the later sets after Chwalinska controlled the opener.

| criterion | A | B |
|---|---|---|
| 1 gate | | |
| 2 depth | | |
| 3 synthesis | | |
| 4 headline | | |
| 5 sections | | |
| 6 repetition | | |
| 7 tennis analysis | | |
| 8 readability | | |

## 4. player form — brief · wta

### VERSION A
- gate: FAIL (wrong_winner) · 253 words · 3 sections · families: stats, match_dna, dna · repeated 5-grams 0 · paragraphs with 4+ numbers 0

**Preston knocks out No. 1 seed Ostapenko in Seoul**

_Taylah Preston beat Jelena Ostapenko 6-4, 6-1 in 1 hour 17 minutes to advance from round 2._

#### A ranking gap overcome
Preston entered Seoul unseeded and ranked No. 94, with Ostapenko at No. 32 on the official WTA singles list in force at the start of the tournament. Their meeting on the outdoor hard courts at the WTA 250 event ended with Preston advancing and the top seed eliminated.

The scoreline was clear, but the statistics show that Preston still had pressure to manage. The distinction was not simply creating opportunities: she was more effective at converting them and at protecting her own serve.

#### Serve quality and conversion separate them
Ostapenko landed just 38.6% of her first serves, leaving her second serve heavily exposed. Preston won 60% of points returning that delivery, while Ostapenko's 10 double faults added to the cost. Preston's return success targeted the part of Ostapenko's service game used most often.

Preston had a stronger foundation behind her own first delivery, winning 81.3% of those points. Her second serve was less productive, but she saved 7 of 8 break points. That resistance kept Ostapenko's opportunities from translating into comparable scoreboard gains.

At the other end, Preston converted 50% of her break chances, compared with Ostapenko's 12.5%. The conversion figures explain why a match in which each player had openings finished so decisively in Preston's favour.

#### A sharper finish to the Seoul path
Preston had needed a deciding set to get past Himeno Sakatsume in the preceding round. Against Ostapenko, she completed the job in straight sets. Her Seoul progress also contrasts with her most recent archived appearance at the US Open, where a win over Alycia Parks was followed by defeat to Taylor Townsend.

### VERSION B
- gate: PASS · 241 words · 3 sections · families: match, stats, match_dna · repeated 5-grams 0 · paragraphs with 4+ numbers 3

**Preston removes top seed Ostapenko in Seoul**

_The unseeded No. 94 controlled the service-point battle in a 6-4, 6-1 victory at the WTA 250._

#### Preston advances in straight sets
Taylah Preston defeated Jelena Ostapenko in round 2 on Seoul’s hard courts, completing the match in 1 hour 17 minutes. Preston took the opening set 6-4 and closed the completed best-of-3 contest with a 6-1 second set.

On the official WTA singles list in force at the start of the tournament, Preston was No. 94 and Ostapenko was No. 32. Preston entered unseeded, while Ostapenko held the No. 1 seed at the WTA 250.

#### Service points created the separation
The official match statistics show Preston won 67.9% of her service points, compared with Ostapenko’s 52.6%. Preston’s first serve was especially effective when it landed, producing an 81.3% success rate.

Preston also limited the damage behind her second serve, winning 50% of those points. Ostapenko won 40% behind hers and finished with 10 double faults, giving Preston repeated opportunities to attack.

That pressure carried into the break-point numbers. Preston converted 4 of 8 chances, while Ostapenko converted 1 of 8. Preston also saved 7 of the 8 break points she faced, preventing Ostapenko from turning return pressure into enough service breaks.

#### A seeded exit and another Seoul win
The result removed the tournament’s highest seed and gave Preston her 2nd win of the event. She had already beaten Himeno Sakatsume in round 1 before facing Ostapenko.

The players had no prior meetings in our records, so this match established their archived head-to-head. More immediately, Preston’s combination of stronger service-point production and more efficient break-point conversion supplied the decisive statistical edge against the higher-ranked player.

| criterion | A | B |
|---|---|---|
| 1 gate | | |
| 2 depth | | |
| 3 synthesis | | |
| 4 headline | | |
| 5 sections | | |
| 6 repetition | | |
| 7 tennis analysis | | |
| 8 readability | | |

## 5. ranking movement — brief · atp _(no stored packet for "ranking movement": substituted the remaining ATP story (no ranking article has ever been published, so no ranking packet exists))_

### VERSION A
- gate: FAIL (unsupported_first_or_record, chart_narration, chart_narration) · 255 words · 3 sections · families: match_dna, draw_path, tournament · repeated 5-grams 0 · paragraphs with 4+ numbers 5

**Davidovich Fokina wins the Chengdu Open title**

_The No. 2 seed defeated Hubert Hurkacz 6-4, 7-6(7), completing his Chengdu run with another straight-sets victory._

#### Davidovich Fokina closes out the final
Alejandro Davidovich Fokina defeated Hubert Hurkacz 6-4, 7-6(7) in the Chengdu Open final. After taking the opening set, Davidovich Fokina secured the completed straight-sets result through a second-set tiebreak.

Davidovich Fokina was the No. 2 seed and Hurkacz the No. 5 seed. On the ATP singles list in the PropBetEdge archive in force at the start of the tournament, Davidovich Fokina was No. 29 and Hurkacz was No. 46.

#### Three wins delivered the Chengdu title
The final was the last match of the Chengdu Open 2026 and gave Davidovich Fokina his 3rd win of the tournament. His archived draw path shows a 6-1, 7-5 quarterfinal victory over Alexandre Muller followed by a 4-6, 6-4, 6-3 semifinal win over Nikoloz Basilashvili.

That route required Davidovich Fokina to win in contrasting ways before the final: he advanced in straight sets against Muller, recovered after losing the opening set against Basilashvili and then completed the title match without allowing Hurkacz to force a deciding set.

#### The result strengthened his showing against a top-50 opponent
The opponent context adds weight to the result. Davidovich Fokina entered the match with 67 wins and 107 losses against top-50 players in his own pre-match record in our archive. Hurkacz’s No. 46 place on the tournament-start list put this final within that category.

The closing set also mattered to the shape of the victory. Davidovich Fokina had already secured the only set won by a two-game margin, then prevailed in the tiebreak to prevent the best-of-3 final from extending to a deciding set. There were no previous meetings between the players in our records, whose coverage starts 2024-12-29.

### VERSION B
- gate: FAIL (unsupported_market, unsupported_first_or_record) · 244 words · 3 sections · families: match_dna · repeated 5-grams 0 · paragraphs with 4+ numbers 0

**Davidovich Fokina wins the Chengdu Open title**

_Alejandro Davidovich Fokina beat Hubert Hurkacz 6-4, 7-6(7) to claim the ATP 250 title._

#### A tiebreak finish
Alejandro Davidovich Fokina settled the Chengdu Open final by taking the closing tiebreak 9 points to 7 against Hubert Hurkacz. The tiebreak kept the match from reaching a deciding set, giving Davidovich Fokina a straight-sets finish after his semifinal had required a comeback.

Davidovich Fokina entered the tournament at No. 29 and Hurkacz at No. 46 on the ATP singles list in the PropBetEdge archive, in force at the start of the tournament. That list comes from the secondary source ESPN.

#### From a semifinal comeback to the trophy
The route to the title demanded different kinds of results. Davidovich Fokina beat Alexandre Muller in straight sets in the quarterfinal, then lost the opening set against Nikoloz Basilashvili in the semifinal before recovering to advance.

Against Hurkacz, he did not need to recover a set deficit. Instead, he followed an opening-set win by taking the longer closing set. The contrast with the semifinal is the clearest feature of his title run: he advanced by reversing a deficit, then completed the tournament without another deciding set.

#### A useful result against a top-50 opponent
Davidovich Fokina's pre-match Tennis DNA shows a 67-107 record against top-50 opponents in our archive. Beating Hurkacz therefore adds a title-winning result in an opponent category where his archived losses had outnumbered his wins.

Hurkacz brought a different profile, with a 97-86 record against top-50 opposition in the same pre-match archive. That context gives the final more substance than the ranking order alone: Davidovich Fokina beat an opponent whose own results in that category had been positive.

| criterion | A | B |
|---|---|---|
| 1 gate | | |
| 2 depth | | |
| 3 synthesis | | |
| 4 headline | | |
| 5 sections | | |
| 6 repetition | | |
| 7 tennis analysis | | |
| 8 readability | | |

## 6. tournament intelligence — brief · wta _(no stored packet for "tournament intelligence": substituted a tournament-concluding title story (no tournament-intelligence feature packet exists))_

### VERSION A
- gate: PASS · 257 words · 3 sections · families: stats, match_dna, dna · repeated 5-grams 0 · paragraphs with 4+ numbers 1

**Birrell wins Seoul title with decisive return pressure**

_Kimberly Birrell beat Maya Joint 6-4, 6-2 in 1 hour 23 minutes to claim the hard-court WTA 250 title._

#### Birrell finishes on top
Kimberly Birrell completed Seoul’s title match with a straight-sets victory over Maya Joint, converting sustained pressure on return into the championship. The result closed the tournament without the final needing a deciding set.

Birrell entered as the No. 2 seed and Joint as the No. 5 seed. On the official WTA singles list in force at the start of the tournament, Birrell was No. 60 and Joint No. 99.

#### Second serves made the separation
The serve numbers show why Birrell had more room to work. She won 50% of points behind her second serve, while Joint managed 30.4%. Birrell’s second delivery was contestable, but Joint’s left her substantially more exposed.

Birrell also had the stronger foundation behind her first serve, winning 66.7% of those points against Joint’s 51.6%. Her advantage was not built on aces: she finished with none. Instead, she won a greater share of points behind each delivery.

On return, Birrell converted 6 of 10 break-point opportunities. Joint created chances of her own, and Birrell saved 50% of the break points she faced. This was not a final in which the champion’s serve went untouched; Birrell’s broader return pressure outweighed the openings she conceded.

#### A different hard-court outcome
The title contrasts with Birrell’s recent archived hard-court results: losses to Kamilla Rakhimova in Cincinnati and Viktorija Golubic in Montreal. Seoul supplied a championship outcome after those early exits.

Joint’s recent hard-court results included a US Open win over Liudmila Samsonova before a loss to Elina Svitolina. Here, her run ended in the final against a player who consistently extracted more from both serve and return.

### VERSION B
- gate: PASS · 234 words · 3 sections · families: match, stats, match_dna, dna, tournament · repeated 5-grams 0 · paragraphs with 4+ numbers 2

**Birrell wins the Seoul title**

_The No. 2 seed defeated Maya Joint 6-4, 6-2 in the WTA 250 final, completing the victory in 1 hour 23 minutes._

#### Birrell closes out Seoul in straight sets
Kimberly Birrell defeated Maya Joint 6-4, 6-2 in the Seoul final on hard court. Birrell, the No. 2 seed, completed the match in 1 hour 23 minutes against the No. 5 seed.

Birrell was No. 60 and Joint No. 99 on the official WTA singles list in force at the start of the tournament. The completed final was the last match of Seoul 2026.

#### Second-serve points created the separation
The sharpest statistical divide came behind the second serve. Birrell won 50% of those points, while Joint won 30.4%, leaving Joint exposed whenever she missed her first delivery.

Birrell also won 66.7% of her first-serve points and finished with 61.1% of all service points despite recording 0 aces. Her advantage came from sustained effectiveness across the service exchanges rather than free points from aces.

The return numbers show how consistently Birrell applied pressure. She won 57.4% of her return points and converted 60% of her break-point opportunities. Joint won 38.9% of her return points, limiting her chances to disrupt Birrell’s service games.

#### A title decided through control on serve and return
The result gave Birrell the Seoul WTA 250 title and ended the tournament with a straight-sets victory over another seeded player. Her superiority behind both first and second serves was reinforced by a more productive return performance.

Joint generated 6 break-point opportunities and converted 3, but Birrell created 10 and converted 6. That combination—stronger service-point production and more frequent return pressure—provided the clearest explanation for the final score.

| criterion | A | B |
|---|---|---|
| 1 gate | | |
| 2 depth | | |
| 3 synthesis | | |
| 4 headline | | |
| 5 sections | | |
| 6 repetition | | |
| 7 tennis analysis | | |
| 8 readability | | |

## 7. ATP — brief · atp

### VERSION A
- gate: PASS · 229 words · 3 sections · families: match_dna · repeated 5-grams 0 · paragraphs with 4+ numbers 1

**Harris knocks out No. 1 seed Vacherot at Chengdu Open**

_Harris won 6-4, 7-6(5) in round 2, extending a Chengdu run that began in qualifying._

#### A qualifier removes the top seed
Lloyd Harris closed out Valentin Vacherot in a tiebreak to keep his Chengdu Open campaign moving without a deciding set. The unseeded winner had come through qualifying; Vacherot leaves the ATP 250 event as its top seed.

The ranking contrast gives the result its significance. Harris stood at No. 136 and Vacherot at No. 19 on the ATP singles list in the PropBetEdge archive in force at the start of the tournament. That list comes from secondary source ESPN.

#### A run built through qualifying
This was Harris’s 4th win of the tournament. His route ran through Kenta Miyoshi and Alexis Galarneau in qualifying, then Aleksandar Kovacevic in the main draw before Vacherot.

The draw path shows a consistent feature: Harris completed each of those earlier matches in straight sets, too. Against Vacherot, the closing set required a tiebreak, but Harris again finished without extending the match to a decider.

#### Recent results add context
Harris’s pre-match Tennis DNA snapshot contained 11 wins and 25 losses against top 25 opponents in our archive. Beating Vacherot adds a higher-ranked opponent to a Chengdu run that had already taken Harris from qualifying into the main draw.

His recent-form snapshot also showed a 7-3 win-loss mark. Vacherot’s corresponding mark was 4-6. Those archived results do not explain the tiebreak, but they show why the ranking and seeding contrast is not the whole story: Harris had the stronger recent win-loss return entering this match.

### VERSION B
- gate: FAIL (unsupported_first_or_record, chart_narration) · 253 words · 3 sections · families: match_dna · repeated 5-grams 0 · paragraphs with 4+ numbers 3

**Harris knocks out No. 1 seed Vacherot at Chengdu Open**

_The unseeded Lloyd Harris won 6-4, 7-6(5) in round 2, removing the top seed from the ATP 250 draw._

#### Harris closes it in straight sets
Lloyd Harris beat Valentin Vacherot 6-4, 7-6(5) in round 2 of the Chengdu Open. Harris took the opening set and then secured the completed best-of-3 match by winning the second-set tiebreak.

The victory continued a run through both qualifying and the main draw for Harris. Before facing Vacherot, he had beaten Kenta Miyoshi 6-3, 7-5 in qualifying round 1, Alexis Galarneau by the same score in qualifying round 2 and Aleksandar Kovacevic 6-3, 6-4 in round 1. The win over Vacherot was his 4th of the tournament.

#### The top seed is out
Vacherot entered as the No. 1 seed, while Harris was unseeded. On the ATP singles list in the PropBetEdge archive in force at the start of the tournament, Vacherot was No. 19 and Harris was No. 136. That made the result a clear reversal of the draw’s seeding and the tournament-entry rankings.

Harris also prevented Vacherot from extending the match to a deciding set. The second-set tiebreak therefore carried the immediate consequence: Harris advanced in straight sets and the highest seed exited the ATP 250 event.

#### A notable result against a top-25 opponent
Harris entered the match with an 11-25 record against top-25 opponents in our archive. Beating the No. 19 player added another strong-opponent win to a category in which his losses had outweighed his wins before the match.

The matchup had no prior meetings in our records, which cover matches from 2024-12-29. With no earlier head-to-head evidence separating them, Harris established control through the opening set and settled the match in the tiebreak rather than allowing Vacherot another set to respond.

| criterion | A | B |
|---|---|---|
| 1 gate | | |
| 2 depth | | |
| 3 synthesis | | |
| 4 headline | | |
| 5 sections | | |
| 6 repetition | | |
| 7 tennis analysis | | |
| 8 readability | | |

## 8. WTA — brief · wta

### VERSION A
- gate: FAIL (wrong_winner, chart_narration) · 252 words · 3 sections · families: match, stats · repeated 5-grams 0 · paragraphs with 4+ numbers 2

**Timofeeva wins the Porto 125 title**

_Maria Timofeeva beat Reese Brantmeier 7-6(8), 6-2, with stronger first-serve results and more opportunities on return._

#### Top seed finishes the job
No. 1 seed Maria Timofeeva completed her title run on the outdoor hard courts in Porto by defeating qualifier Reese Brantmeier in a final lasting 1 hour 58 minutes. The victory closed out her week at the WTA 125 event.

Timofeeva was No. 88 and Brantmeier No. 385 on the official WTA singles list in force at the start of the tournament. Brantmeier reached the title match as a qualifier, but Timofeeva’s more productive serve-and-return combination separated them in the final.

#### More chances, not better conversion
The serve numbers show where Timofeeva found her advantage: she won 65.4% of points behind her first serve, compared with Brantmeier’s 51.9%. Brantmeier actually had the better second-serve success rate, so this was not a uniform advantage across every part of the service contest.

Timofeeva also landed 75.4% of her first serves. That gave her more frequent access to the delivery on which she was most effective, rather than leaving the match to be decided by second-serve exchanges.

On return, Timofeeva earned 9 break points to Brantmeier’s 3. Their conversion rates were identical: the important distinction was how often Timofeeva created an opening, not greater efficiency when an opportunity arrived.

#### A title run with a semifinal test
Timofeeva’s route included straight-set victories over Sofia Johnson, Kajsa Rinaldo Persson and Gabriela Knutson before Mia Pohankova took her to a deciding set in the semifinal.

She came through that match 6-2, 6-7(3), 6-3, then finished the tournament without needing a deciding set against Brantmeier. The final completed a title run that included both decisive wins and a longer semifinal examination.

### VERSION B
- gate: PASS · 270 words · 3 sections · families: stats, match_dna, draw_path, tournament · repeated 5-grams 0 · paragraphs with 4+ numbers 0

**Timofeeva wins the Porto 125 title**

_Timofeeva won 7-6(8), 6-2 in 1 hour 58 minutes in the final of Porto 125._

#### Timofeeva completes the title run
Top seed Maria Timofeeva defeated qualifier Reese Brantmeier in straight sets on Porto’s outdoor hard court, completing her run through the WTA 125 event. The opening set went to a tiebreak before Timofeeva controlled the second.

Timofeeva was No. 88 and Brantmeier No. 385 on the official WTA singles list in force at the start of the tournament. The result closed the gap between their starting positions in the draw: Timofeeva entered as the top seed, while Brantmeier came through qualifying.

#### First-serve and return pressure made the difference
The official match statistics show the clearest separation behind first serves. Timofeeva won 65.4% of those points, compared with Brantmeier’s 51.9%, giving the champion the stronger base in her service games.

The second-serve figures ran the other way, with Brantmeier winning 55.6% and Timofeeva 52.9%. That makes Timofeeva’s advantage on first-serve points, rather than a broad edge across both serves, the central service feature of the match.

Timofeeva also won 46.9% of her return points, while Brantmeier won 37.7%. That greater return yield produced more sustained pressure across the match.

The opportunity count reflected that pressure: Timofeeva earned 9 break points and converted 3, while Brantmeier earned 3. Timofeeva’s advantage came from creating more chances rather than a higher conversion rate.

#### A five-win week ends with the trophy
The final was the last match of Porto 125 2026 and gave Timofeeva her 5th win of the tournament. Her route included victories over Sofia Johnson, Kajsa Rinaldo Persson and Gabriela Knutson before a semifinal win over Mia Pohankova.

The championship match also continued the pattern of Timofeeva taking the opening set and closing in straight sets, after Brantmeier had pushed that opening set deep into a tiebreak.

| criterion | A | B |
|---|---|---|
| 1 gate | | |
| 2 depth | | |
| 3 synthesis | | |
| 4 headline | | |
| 5 sections | | |
| 6 repetition | | |
| 7 tennis analysis | | |
| 8 readability | | |

## 9. rich packet — brief · wta

### VERSION A
- gate: PASS · 264 words · 3 sections · families: stats, match_dna · repeated 5-grams 0 · paragraphs with 4+ numbers 4

**Cengiz wins the Ankara 125 title**

_Cengiz won 2-6, 6-4, 7-5 in 2 hours 5 minutes in the final of Ankara 125._

#### Cengiz completes the comeback
Berfu Cengiz recovered after dropping the opening set to beat Teodora Kostovic in the WTA 125 hard-court final. Cengiz answered the 2-6 start by taking the next two sets 6-4 and 7-5, completing the turnaround in the deciding set.

The rankings added weight to the result. Cengiz was No. 307 and Kostovic No. 159 on the official WTA singles list in force at the start of the tournament. Kostovic was the No. 5 seed, while Cengiz was unseeded.

#### Return volume offset Kostovic’s serve advantage
The official match statistics show that Kostovic was stronger behind her first serve, winning 71% of those points compared with Cengiz’s 61.3%. She also finished with 6 aces to Cengiz’s 1 and won 95 total points against Cengiz’s 87, but those advantages did not decide the match.

Cengiz created the greater volume of return pressure. She earned 12 break-point opportunities and converted 50%, while Kostovic earned 8 and converted 75%. That left both players with 6 conversions despite Kostovic’s higher efficiency. Cengiz also won 63.6% of her second-serve return points, giving her a route into Kostovic’s service games when the first serve missed.

#### A title secured from a set down
The victory closed Ankara 125 and gave Cengiz the title after she had fallen behind by a set. It also followed the pattern of her only previous meeting with Kostovic in our records: Cengiz won that clay-court match 7-6(3), 6-3 at Kursumlijska Banja 23.

This final required a different route. Kostovic held the statistical edge on first-serve points and total points, but Cengiz’s pressure on the second serve and larger supply of break chances proved enough to turn the match over three sets.

### VERSION B
- gate: PASS · 254 words · 3 sections · families: stats, match_dna · repeated 5-grams 0 · paragraphs with 4+ numbers 1

**Cengiz comes back to win Ankara 125 title**

_Berfu Cengiz beat Teodora Kostovic 2-6, 6-4, 7-5 in the hard-court final, completing the match in 2 hours 5 minutes._

#### A title across the ranking gap
Berfu Cengiz entered Ankara at No. 307 on the official WTA singles list in force at the start of the tournament. Teodora Kostovic stood at No. 159 on that same list and was seeded No. 5. The WTA 125 trophy went to the lower-ranked player.

The result was not built on an overall points advantage. Kostovic won 95 points to Cengiz’s 87, a reminder that the final’s aggregate totals and its set-by-set outcome told different stories.

#### Second-serve returns kept Cengiz competitive
The serve numbers show why Kostovic remained difficult to beat: she won 71% of points behind her first serve, compared with Cengiz’s 61.3%. Cengiz nevertheless landed her first delivery more often, limiting her exposure to a second serve that was also vulnerable.

Cengiz found a productive route on return when Kostovic missed her first serve. She won 63.6% of second-serve return points, countering Kostovic’s stronger results behind the first delivery.

That pressure produced 12 break-point opportunities for Cengiz. She converted 6, matching Kostovic’s conversion total despite being less efficient with her chances. The distinction was opportunity creation rather than superior conversion: Cengiz gave herself more chances to disrupt Kostovic’s service games.

#### A different finish from Gran Canaria
Cengiz’s recent results included a final defeat to Laura Pigossi at Gran Canaria and opening-round losses in Antalya and Valencia. Ankara supplied a title after those setbacks, with this final ending differently from her previous listed championship match.

The prior meeting in our records also went to Cengiz, on clay at Kursumlijska Banja 23. This time she beat Kostovic on hard court, with a title at stake.

| criterion | A | B |
|---|---|---|
| 1 gate | | |
| 2 depth | | |
| 3 synthesis | | |
| 4 headline | | |
| 5 sections | | |
| 6 repetition | | |
| 7 tennis analysis | | |
| 8 readability | | |

## 10. thin but publishable — brief · doubles

### VERSION A
- gate: PASS · 237 words · 3 sections · families: match, stats, tournament · repeated 5-grams 1 · paragraphs with 4+ numbers 0

**Jorge/Jorge claim Porto 125 doubles title in deciding tiebreak**

_Francisca Jorge and Matilde Jorge defeated Ariana Arseneault and Raphaelle Lacasse 6-3, 3-6, [10-3] after the teams split the opening sets._

#### Jorge pair close out the final
Francisca Jorge and Matilde Jorge won the Porto 125 doubles title by beating Ariana Arseneault and Raphaelle Lacasse in the final on the hard court. The fourth seeds took the opening set, lost the second and controlled the deciding tiebreak to complete the victory in 1 hour 32 minutes.

The result completed the last match of Porto 125 2026, with the Portuguese pair finishing as champions after a final in which each team won a set by the same margin.

#### Second-serve points created the separation
The serve numbers show Jorge/Jorge were more effective after both the first and second deliveries. They won 68.4% of their first-serve points, compared with 60.5% for Arseneault/Lacasse.

The wider gap came behind the second serve. Jorge/Jorge won 47.4% of those points, while Arseneault/Lacasse won 36.8%. That advantage was reinforced on return, where the champions won 63.2% of the points played against a second serve.

Neither pair separated itself through break-point conversions alone: both teams converted 3. Jorge/Jorge instead built the stronger overall points profile, winning 62 total points and 61.4% of their service points.

#### A title settled after two contrasting sets
The final changed direction across the opening sets, but the deciding tiebreak produced the clearest scoreline of the match. Jorge/Jorge followed their second-set loss by allowing Arseneault/Lacasse only 3 points in that final phase.

The victory gave Francisca Jorge and Matilde Jorge the WTA 125 doubles title in Porto and closed a completed final that required the deciding tiebreak to separate the teams.

### VERSION B
- gate: PASS · 239 words · 3 sections · families: match, stats · repeated 5-grams 0 · paragraphs with 4+ numbers 0

**Jorge/Jorge win the Porto 125 doubles title**

_Francisca Jorge and Matilde Jorge defeated Ariana Arseneault and Raphaelle Lacasse 6-3, 3-6, [10-3] in a final lasting 1 hour 32 minutes._

#### A title settled in the match tiebreak
Francisca Jorge and Matilde Jorge, seeded 4, secured the WTA 125 hard-court doubles title in Porto, giving the Portuguese pair a tournament victory in their home country against Canadian opponents Ariana Arseneault and Raphaelle Lacasse.

Arseneault/Lacasse answered the opening-set loss by taking the next set. That sent the final to a deciding match tiebreak rather than another full set, and Jorge/Jorge took it [10-3]. The decisive separation therefore came after the teams had matched each other in the completed sets.

#### Serve effectiveness, not ace production
The serve numbers show why ace production alone would give a misleading picture. Jorge/Jorge finished without an ace, while Arseneault/Lacasse hit 4. Yet the champions won a greater share of points behind both their first and second serves.

Both teams put 66.7% of their first serves in play, so the distinction was what happened after those deliveries landed, not how often they landed. Behind the second serve, Jorge/Jorge won 47.4% of points against 36.8% for Arseneault/Lacasse. Neither team won a majority in that category, but the champions were less exposed.

#### Return pressure beyond the conversions
Jorge/Jorge also won a larger share of return points, with their strongest return yield coming against second serves. That gave them an advantage across the return exchanges even though both teams converted 3 break points.

Arseneault/Lacasse actually converted a higher proportion of their opportunities. The distinction is useful: conversion efficiency did not separate the champions from the runners-up in the same way that broader serve and return effectiveness did.

| criterion | A | B |
|---|---|---|
| 1 gate | | |
| 2 depth | | |
| 3 synthesis | | |
| 4 headline | | |
| 5 sections | | |
| 6 repetition | | |
| 7 tennis analysis | | |
| 8 readability | | |


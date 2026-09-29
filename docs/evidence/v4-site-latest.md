# Tennis V4 site QA — latest

Generated 2026-09-29T20:21:57.298Z by `scripts/qa/v4-site.mjs`. Screenshots: `qa-artifacts/v4/<label>-<page>-<width>.png` (full page at 390 and 1440).

## /news page height

| run | base | 320px | 360px | 390px | 430px | 768px | 1024px | 1440px |
|---|---|---|---|---|---|---|---|---|
| production (2026-09-29T20:18Z) | https://tennis.propbetedge.ai | 9002 | 8542 | 8222 | 8168 | 7619 | 5416 | 5227 |
| local (2026-09-29T20:13Z) | http://localhost:5194 | 8802 | 8435 | 8203 | 8106 | 6423 | 5022 | 4699 |

Reference: the old endless wire measured 12,459px at 1440; V3 about 5,200px.

## production — 7/56 green

Base https://tennis.propbetedge.ai, run 2026-09-29T20:18:45.011Z.

| page | width | height | CLS | text measured / failing AA | result |
|---|---|---|---|---|---|
| home | 320 | 14614 | 0.4869 | 454 / 30 | contrast: a.mod-k "All casts and replays →" 4.30<4.5 \| span.men-rp-k "Men's singles · Final" 4.30<4.5 \| span.men-rp-k "Men's doubles · Final" 4.30<4.5 \| span.men-rp-k "Mixed doubles · Final" 4.30<4.5 \| span.men-rp-k "Men's singles · Semifinal" 4.30<4.5<br>cls: 0.4869 >= 0.1 (0.292@731ms FOOTER.ftr 637->0 ; 0.045@753ms DIV.page 883->829, A.btn 732->678, P.hero-strip 802->748, A.btn 678->678, A.btn 678->624 ; 0.070@980ms SECTION.mod 837->0) |
| home | 360 | 13312 | 0.4841 | 454 / 30 | contrast: a.mod-k "All casts and replays →" 4.30<4.5 \| span.men-rp-k "Men's singles · Final" 4.30<4.5 \| span.men-rp-k "Men's doubles · Final" 4.30<4.5 \| span.men-rp-k "Mixed doubles · Final" 4.30<4.5 \| span.men-rp-k "Men's singles · Semifinal" 4.30<4.5<br>cls: 0.4841 >= 0.1 (0.292@374ms FOOTER.ftr 637->0 ; 0.086@577ms SECTION.mod 823->0 ; 0.094@601ms DIV.page 815->842, SECTION. 869->0) |
| home | 390 | 12679 | 0.416 | 454 / 30 | contrast: a.mod-k "All casts and replays →" 4.30<4.5 \| span.men-rp-k "Men's singles · Final" 4.30<4.5 \| span.men-rp-k "Men's doubles · Final" 4.30<4.5 \| span.men-rp-k "Mixed doubles · Final" 4.30<4.5 \| span.men-rp-k "Men's singles · Semifinal" 4.30<4.5<br>cls: 0.416 >= 0.1 (0.292@335ms FOOTER.ftr 637->0 ; 0.122@520ms DIV.page 790->817, SECTION.mod 798->0) |
| home | 430 | 12378 | 0.4727 | 454 / 30 | contrast: a.mod-k "All casts and replays →" 4.30<4.5 \| span.men-rp-k "Men's singles · Final" 4.30<4.5 \| span.men-rp-k "Men's doubles · Final" 4.30<4.5 \| span.men-rp-k "Mixed doubles · Final" 4.30<4.5 \| span.men-rp-k "Men's singles · Semifinal" 4.30<4.5<br>cls: 0.4727 >= 0.1 (0.305@785ms FOOTER.ftr 637->0, SPAN.brand-text 13->13, SPAN.brand-sep 17->17 ; 0.022@795ms A.btn 618->618, A.btn 618->564, A.btn 564->564, A.btn 564->564, #text. 823->823 ; 0.146@1073ms DIV.page 769->796, SECTION.mod 777->0) |
| home | 768 | 10159 | 0.6454 | 456 / 31 | contrast: a.mod-k "All casts and replays →" 4.30<4.5 \| span.men-rp-k "Men's singles · Final" 4.30<4.5 \| span.men-rp-k "Men's doubles · Final" 4.30<4.5 \| span.men-rp-k "Mixed doubles · Final" 4.30<4.5 \| span.men-rp-k "Men's singles · Semifinal" 4.30<4.5<br>cls: 0.6454 >= 0.1 (0.292@359ms FOOTER.ftr 637->0 ; 0.201@602ms SECTION.mod 716->0, SECTION.mod 838->0 ; 0.151@3122ms SECTION. 762->0) |
| home | 1024 | 7343 | 0.3277 | 456 / 31 | contrast: a.mod-k "All casts and replays →" 4.30<4.5 \| span.men-rp-k "Men's singles · Final" 4.30<4.5 \| span.men-rp-k "Men's doubles · Final" 4.30<4.5 \| span.men-rp-k "Mixed doubles · Final" 4.30<4.5 \| span.men-rp-k "Men's singles · Semifinal" 4.30<4.5<br>cls: 0.3277 >= 0.1 (0.292@483ms FOOTER.ftr 637->0 ; 0.035@735ms SECTION.mod 859->0) |
| home | 1440 | 6190 | 0.2325 | 454 / 30 | contrast: a.mod-k "All casts and replays →" 4.30<4.5 \| span.men-rp-k "Men's singles · Final" 4.30<4.5 \| span.men-rp-k "Men's doubles · Final" 4.30<4.5 \| span.men-rp-k "Mixed doubles · Final" 4.30<4.5 \| span.men-rp-k "Men's singles · Semifinal" 4.30<4.5<br>cls: 0.2325 >= 0.1 (0.228@294ms FOOTER.ftr 637->0) |
| news | 320 | 9002 | 0.8301 | 279 / 34 | contrast: a.is-empty "Grand Slams" 3.80<4.5 \| span.nf-cls "Full story" 3.71<4.5 \| span.nf-kind "Title" 3.94<4.5 \| span.nf-kind "Seed upset" 3.94<4.5 \| span.nf-kind "Comeback" 3.94<4.5<br>h1: 0 visible h1<br>cls: 0.8301 >= 0.1 (0.828@1392ms DIV.page 210->229, FOOTER.ftr 637->0, NAV.nf-desks 168->185, #text. 138->138) |
| news | 360 | 8542 | 0.8298 | 279 / 34 | contrast: a.is-empty "Grand Slams" 3.80<4.5 \| span.nf-cls "Full story" 3.71<4.5 \| span.nf-kind "Title" 3.94<4.5 \| span.nf-kind "Seed upset" 3.94<4.5 \| span.nf-kind "Comeback" 3.94<4.5<br>h1: 0 visible h1<br>cls: 0.8298 >= 0.1 (0.829@618ms DIV.page 210->229, FOOTER.ftr 637->0, NAV.nf-desks 168->185, #text. 138->138) |
| news | 390 | 8222 | 0.37 | 279 / 34 | contrast: a.is-empty "Grand Slams" 3.80<4.5 \| span.nf-cls "Full story" 3.71<4.5 \| span.nf-kind "Title" 3.94<4.5 \| span.nf-kind "Seed upset" 3.94<4.5 \| span.nf-kind "Comeback" 3.94<4.5<br>h1: 0 visible h1<br>cls: 0.37 >= 0.1 (0.062@332ms DIV.page 210->186, NAV.nf-desks 168->144, #text. 105->79, P.nf-date 138->114, A. 144->144 ; 0.307@3636ms FOOTER.ftr 637->0, #text. 114->114) |
| news | 430 | 8168 | 0.3115 | 279 / 34 | contrast: a.is-empty "Grand Slams" 3.80<4.5 \| span.nf-cls "Full story" 3.71<4.5 \| span.nf-kind "Title" 3.94<4.5 \| span.nf-kind "Seed upset" 3.94<4.5 \| span.nf-kind "Comeback" 3.94<4.5<br>h1: 0 visible h1<br>cls: 0.3115 >= 0.1 (0.306@1020ms FOOTER.ftr 637->0, #text. 114->114) |
| news | 768 | 7619 | 0.8594 | 327 / 40 | contrast: a.is-empty "Grand Slams" 3.80<4.5 \| span.nf-cls "Full story" 3.71<4.5 \| span.nf-kind "Title" 3.94<4.5 \| span.nf-kind "Seed upset" 3.94<4.5 \| span.nf-kind "Comeback" 3.94<4.5<br>h1: 0 visible h1<br>cls: 0.8594 >= 0.1 (0.858@577ms DIV.page 178->202, FOOTER.ftr 637->0, DIV.page 136->158, P.nf-date 106->128) |
| news | 1024 | 5416 | 0.8431 | 327 / 40 | contrast: a.is-empty "Grand Slams" 3.80<4.5 \| span.nf-cls "Full story" 3.71<4.5 \| span.nf-kind "Title" 3.94<4.5 \| span.nf-kind "Seed upset" 3.94<4.5 \| span.nf-kind "Comeback" 3.94<4.5<br>h1: 0 visible h1<br>cls: 0.8431 >= 0.1 (0.837@3939ms DIV.page 195->219, FOOTER.ftr 637->0, DIV.page 153->175, P.nf-date 123->145) |
| news | 1440 | 5227 | 0.3001 | 327 / 40 | contrast: a.is-empty "Grand Slams" 3.80<4.5 \| span.nf-cls "Full story" 3.71<4.5 \| span.nf-kind "Title" 3.94<4.5 \| span.nf-kind "Seed upset" 3.94<4.5 \| span.nf-kind "Comeback" 3.94<4.5<br>h1: 0 visible h1<br>cls: 0.3001 >= 0.1 (0.297@543ms FOOTER.ftr 637->0, P.nf-date 123->123) |
| article | 320 | 9320 | 0.2936 | 249 / 4 | contrast: p.nf-intel-k "PBE Intelligence" 1.02<4.5 \| span.nf-kind "Comeback" 4.30<4.5 \| span.nf-kind "Doubles title" 4.30<4.5 \| span.nf-kind "Title" 4.30<4.5<br>cls: 0.2936 >= 0.1 (0.292@1681ms FOOTER.ftr 637->0) |
| article | 360 | 8844 | 0.3146 | 249 / 4 | contrast: p.nf-intel-k "PBE Intelligence" 1.02<4.5 \| span.nf-kind "Comeback" 4.30<4.5 \| span.nf-kind "Doubles title" 4.30<4.5 \| span.nf-kind "Title" 4.30<4.5<br>cls: 0.3146 >= 0.1 (0.292@6566ms FOOTER.ftr 637->0 ; 0.022@6632ms #text. 436->436, #text. 454->454, #text. 419->436, #text. 419->419) |
| article | 390 | 8498 | 0.3156 | 250 / 4 | contrast: p.nf-intel-k "PBE Intelligence" 1.02<4.5 \| span.nf-kind "Comeback" 4.30<4.5 \| span.nf-kind "Doubles title" 4.30<4.5 \| span.nf-kind "Title" 4.30<4.5<br>cls: 0.3156 >= 0.1 (0.292@547ms FOOTER.ftr 637->0 ; 0.023@618ms #text. 419->419, #text. 436->436, #text. 454->471) |
| article | 430 | 8177 | 0.2947 | 250 / 4 | contrast: p.nf-intel-k "PBE Intelligence" 1.02<4.5 \| span.nf-kind "Comeback" 4.30<4.5 \| span.nf-kind "Doubles title" 4.30<4.5 \| span.nf-kind "Title" 4.30<4.5<br>cls: 0.2947 >= 0.1 (0.292@958ms FOOTER.ftr 637->0) |
| article | 768 | 6506 | 0.2959 | 250 / 4 | contrast: p.nf-intel-k "PBE Intelligence" 1.02<3 \| span.nf-kind "Comeback" 4.30<4.5 \| span.nf-kind "Doubles title" 4.30<4.5 \| span.nf-kind "Title" 4.30<4.5<br>cls: 0.2959 >= 0.1 (0.292@581ms FOOTER.ftr 637->0) |
| article | 1024 | 6128 | 0.2947 | 250 / 4 | contrast: p.nf-intel-k "PBE Intelligence" 1.02<3 \| span.nf-kind "Comeback" 4.30<4.5 \| span.nf-kind "Doubles title" 4.30<4.5 \| span.nf-kind "Title" 4.30<4.5<br>cls: 0.2947 >= 0.1 (0.292@540ms FOOTER.ftr 637->0) |
| article | 1440 | 5371 | 0.2938 | 250 / 4 | contrast: p.nf-intel-k "PBE Intelligence" 1.02<3 \| span.nf-kind "Comeback" 4.30<4.5 \| span.nf-kind "Doubles title" 4.30<4.5 \| span.nf-kind "Title" 4.30<4.5<br>cls: 0.2938 >= 0.1 (0.292@548ms FOOTER.ftr 637->0) |
| player-alcaraz | 320 | 7443 | 0.2931 | 286 / 7 | contrast: span.fresh "Cached · 3d old" 4.30<4.5 \| a.mod-k "Open full Tennis DNA →" 4.30<4.5 \| span.mod-k "singles in the PropBetEdge r" 4.30<4.5 \| span.mod-k "singles · where the surface " 4.30<4.5 \| span.mod-k "ATP singles · secondary sour" 4.30<4.5<br>cls: 0.2931 >= 0.1 (0.292@6439ms FOOTER.ftr 637->0) |
| player-alcaraz | 360 | 7273 | 0.2928 | 292 / 7 | contrast: span.fresh "Cached · 3d old" 4.30<4.5 \| a.mod-k "Open full Tennis DNA →" 4.30<4.5 \| span.mod-k "singles in the PropBetEdge r" 4.30<4.5 \| span.mod-k "singles · where the surface " 4.30<4.5 \| span.mod-k "ATP singles · secondary sour" 4.30<4.5<br>cls: 0.2928 >= 0.1 (0.292@663ms FOOTER.ftr 637->0) |
| player-alcaraz | 390 | 7225 | 0.293 | 326 / 7 | contrast: span.fresh "Cached · 3d old" 4.30<4.5 \| a.mod-k "Open full Tennis DNA →" 4.30<4.5 \| span.mod-k "singles in the PropBetEdge r" 4.30<4.5 \| span.mod-k "singles · where the surface " 4.30<4.5 \| span.mod-k "ATP singles · secondary sour" 4.30<4.5<br>cls: 0.293 >= 0.1 (0.292@2860ms FOOTER.ftr 637->0) |
| player-alcaraz | 430 | 6667 | 0.2942 | 326 / 7 | contrast: span.fresh "Cached · 3d old" 4.30<4.5 \| a.mod-k "Open full Tennis DNA →" 4.30<4.5 \| span.mod-k "singles in the PropBetEdge r" 4.30<4.5 \| span.mod-k "singles · where the surface " 4.30<4.5 \| span.mod-k "ATP singles · secondary sour" 4.30<4.5<br>cls: 0.2942 >= 0.1 (0.292@667ms FOOTER.ftr 637->0) |
| player-alcaraz | 768 | 5648 | 0.2943 | 408 / 7 | contrast: span.fresh "Cached · 3d old" 4.30<4.5 \| a.mod-k "Open full Tennis DNA →" 4.30<4.5 \| span.mod-k "singles in the PropBetEdge r" 4.30<4.5 \| span.mod-k "singles · where the surface " 4.30<4.5 \| span.mod-k "ATP singles · secondary sour" 4.30<4.5<br>cls: 0.2943 >= 0.1 (0.292@680ms FOOTER.ftr 637->0) |
| player-alcaraz | 1024 | 5273 | 0.2926 | 408 / 7 | contrast: span.fresh "Cached · 3d old" 4.30<4.5 \| a.mod-k "Open full Tennis DNA →" 4.30<4.5 \| span.mod-k "singles in the PropBetEdge r" 4.30<4.5 \| span.mod-k "singles · where the surface " 4.30<4.5 \| span.mod-k "ATP singles · secondary sour" 4.30<4.5<br>cls: 0.2926 >= 0.1 (0.292@729ms FOOTER.ftr 637->0) |
| player-alcaraz | 1440 | 5094 | 0.2936 | 408 / 7 | contrast: span.fresh "Cached · 3d old" 4.30<4.5 \| a.mod-k "Open full Tennis DNA →" 4.30<4.5 \| span.mod-k "singles in the PropBetEdge r" 4.30<4.5 \| span.mod-k "singles · where the surface " 4.30<4.5 \| span.mod-k "ATP singles · secondary sour" 4.30<4.5<br>cls: 0.2936 >= 0.1 (0.292@687ms FOOTER.ftr 637->0) |
| player-swiatek | 320 | 7268 | 0.2931 | 295 / 6 | contrast: span.fresh "Cached · 40h old" 4.30<4.5 \| a.mod-k "Open full Tennis DNA →" 4.30<4.5 \| span.mod-k "singles in the PropBetEdge r" 4.30<4.5 \| span.mod-k "singles · where the surface " 4.30<4.5 \| span.mod-k "singles · last 40" 4.30<4.5<br>cls: 0.2931 >= 0.1 (0.292@6558ms FOOTER.ftr 637->0) |
| player-swiatek | 360 | 7117 | 0.2928 | 306 / 6 | contrast: span.fresh "Cached · 40h old" 4.30<4.5 \| a.mod-k "Open full Tennis DNA →" 4.30<4.5 \| span.mod-k "singles in the PropBetEdge r" 4.30<4.5 \| span.mod-k "singles · where the surface " 4.30<4.5 \| span.mod-k "singles · last 40" 4.30<4.5<br>cls: 0.2928 >= 0.1 (0.292@755ms FOOTER.ftr 637->0) |
| player-swiatek | 390 | 7065 | 0.293 | 335 / 6 | contrast: span.fresh "Cached · 40h old" 4.30<4.5 \| a.mod-k "Open full Tennis DNA →" 4.30<4.5 \| span.mod-k "singles in the PropBetEdge r" 4.30<4.5 \| span.mod-k "singles · where the surface " 4.30<4.5 \| span.mod-k "singles · last 40" 4.30<4.5<br>cls: 0.293 >= 0.1 (0.292@803ms FOOTER.ftr 637->0) |
| player-swiatek | 430 | 6694 | 0.2942 | 335 / 6 | contrast: span.fresh "Cached · 40h old" 4.30<4.5 \| a.mod-k "Open full Tennis DNA →" 4.30<4.5 \| span.mod-k "singles in the PropBetEdge r" 4.30<4.5 \| span.mod-k "singles · where the surface " 4.30<4.5 \| span.mod-k "singles · last 40" 4.30<4.5<br>cls: 0.2942 >= 0.1 (0.292@804ms FOOTER.ftr 637->0) |
| player-swiatek | 768 | 5666 | 0.2943 | 417 / 6 | contrast: span.fresh "Cached · 40h old" 4.30<4.5 \| a.mod-k "Open full Tennis DNA →" 4.30<4.5 \| span.mod-k "singles in the PropBetEdge r" 4.30<4.5 \| span.mod-k "singles · where the surface " 4.30<4.5 \| span.mod-k "singles · last 40" 4.30<4.5<br>cls: 0.2943 >= 0.1 (0.292@730ms FOOTER.ftr 637->0) |
| player-swiatek | 1024 | 5325 | 0.2926 | 417 / 6 | contrast: span.fresh "Cached · 40h old" 4.30<4.5 \| a.mod-k "Open full Tennis DNA →" 4.30<4.5 \| span.mod-k "singles in the PropBetEdge r" 4.30<4.5 \| span.mod-k "singles · where the surface " 4.30<4.5 \| span.mod-k "singles · last 40" 4.30<4.5<br>cls: 0.2926 >= 0.1 (0.292@2693ms FOOTER.ftr 637->0) |
| player-swiatek | 1440 | 5150 | 0.2936 | 417 / 6 | contrast: span.fresh "Cached · 40h old" 4.30<4.5 \| a.mod-k "Open full Tennis DNA →" 4.30<4.5 \| span.mod-k "singles in the PropBetEdge r" 4.30<4.5 \| span.mod-k "singles · where the surface " 4.30<4.5 \| span.mod-k "singles · last 40" 4.30<4.5<br>cls: 0.2936 >= 0.1 (0.292@638ms FOOTER.ftr 637->0) |
| tournament | 320 | 15513 | 1.0897 | 769 / 9 | contrast: span.fresh "Cached · 26m old" 4.30<4.5 \| span.mod-k "stories and live wire from t" 4.30<4.5 \| span.nf-kind "Title" 4.30<4.5 \| p.nf-w-day "Live wire" 3.80<4.5 \| p.nf-w-ev "AITO Hangzhou Open · ATP" 4.30<4.5<br>cls: 1.0897 >= 0.1 (0.292@1473ms FOOTER.ftr 637->0 ; 0.797@1524ms SECTION.mod 202->0, DIV. 181->246) |
| tournament | 360 | 15298 | 1.0896 | 769 / 9 | contrast: span.fresh "Cached · 26m old" 4.30<4.5 \| span.mod-k "stories and live wire from t" 4.30<4.5 \| span.nf-kind "Title" 4.30<4.5 \| p.nf-w-day "Live wire" 3.80<4.5 \| p.nf-w-ev "AITO Hangzhou Open · ATP" 4.30<4.5<br>cls: 1.0896 >= 0.1 (0.292@849ms FOOTER.ftr 637->0 ; 0.797@902ms SECTION.mod 202->0, DIV. 181->246) |
| tournament | 390 | 15078 | 1.09 | 770 / 9 | contrast: span.fresh "Cached · 26m old" 4.30<4.5 \| span.mod-k "stories and live wire from t" 4.30<4.5 \| span.nf-kind "Title" 4.30<4.5 \| p.nf-w-day "Live wire" 3.80<4.5 \| p.nf-w-ev "AITO Hangzhou Open · ATP" 4.30<4.5<br>cls: 1.09 >= 0.1 (0.292@797ms FOOTER.ftr 637->0 ; 0.797@839ms SECTION.mod 202->0, DIV. 181->246) |
| tournament | 430 | 15066 | 0.7522 | 770 / 9 | contrast: span.fresh "Cached · 26m old" 4.30<4.5 \| span.mod-k "stories and live wire from t" 4.30<4.5 \| span.nf-kind "Title" 4.30<4.5 \| p.nf-w-day "Live wire" 3.80<4.5 \| p.nf-w-ev "AITO Hangzhou Open · ATP" 4.30<4.5<br>cls: 0.7522 >= 0.1 (0.750@542ms DIV. 181->246, FOOTER.ftr 637->0) |
| tournament | 768 | 14057 | 0.9656 | 770 / 9 | contrast: span.fresh "Cached · 26m old" 4.30<4.5 \| span.mod-k "stories and live wire from t" 4.30<4.5 \| span.nf-kind "Title" 4.30<4.5 \| p.nf-w-day "Live wire" 3.80<4.5 \| p.nf-w-ev "AITO Hangzhou Open · ATP" 4.30<4.5<br>cls: 0.9656 >= 0.1 (0.190@596ms FOOTER.ftr 637->0 ; 0.774@638ms SECTION.mod 210->0, DIV. 189->235) |
| tournament | 1024 | 8825 | 0.7553 | 770 / 9 | contrast: span.fresh "Cached · 26m old" 4.30<4.5 \| span.mod-k "stories and live wire from t" 4.30<4.5 \| span.nf-kind "Title" 4.30<4.5 \| p.nf-w-day "Live wire" 3.80<4.5 \| p.nf-w-ev "AITO Hangzhou Open · ATP" 4.30<4.5<br>cls: 0.7553 >= 0.1 (0.755@535ms DIV. 203->230, FOOTER.ftr 637->0) |
| tournament | 1440 | 7320 | 0.7096 | 770 / 9 | contrast: span.fresh "Cached · 26m old" 4.30<4.5 \| span.mod-k "stories and live wire from t" 4.30<4.5 \| span.nf-kind "Title" 4.30<4.5 \| p.nf-w-day "Live wire" 3.80<4.5 \| p.nf-w-ev "AITO Hangzhou Open · ATP" 4.30<4.5<br>cls: 0.7096 >= 0.1 (0.708@542ms DIV. 205->206, FOOTER.ftr 637->0) |
| match | 320 | 3039 | 0.6295 | 38 / 1 | contrast: span.fresh "Cached · 26m old" 4.30<4.5<br>cls: 0.6295 >= 0.1 (0.629@1002ms DIV. 181->355, FOOTER.ftr 637->0) |
| match | 360 | 2920 | 0.6894 | 38 / 1 | contrast: span.fresh "Cached · 26m old" 4.30<4.5<br>cls: 0.6894 >= 0.1 (0.689@556ms DIV. 181->301, FOOTER.ftr 637->0) |
| match | 390 | 2843 | 0.6907 | 39 / 1 | contrast: span.fresh "Cached · 26m old" 4.30<4.5<br>cls: 0.6907 >= 0.1 (0.689@535ms DIV. 181->301, FOOTER.ftr 637->0) |
| match | 430 | 2806 | 0.6911 | 39 / 1 | contrast: span.fresh "Cached · 26m old" 4.30<4.5<br>cls: 0.6911 >= 0.1 (0.689@640ms DIV. 181->301, FOOTER.ftr 637->0) |
| match | 768 | 2366 | 0.734 | 39 / 1 | contrast: span.fresh "Cached · 26m old" 4.30<4.5<br>cls: 0.734 >= 0.1 (0.732@557ms DIV. 189->255, FOOTER.ftr 637->0) |
| match | 1024 | 1825 | 0.6109 | 39 / 1 | contrast: span.fresh "Cached · 26m old" 4.30<4.5<br>cls: 0.6109 >= 0.1 (0.505@501ms DIV. 203->225, FOOTER.ftr 637->0 ; 0.106@557ms DIV. 225->250, SPAN. 184->211) |
| match | 1440 | 1801 | 0.3372 | 39 / 1 | contrast: span.fresh "Cached · 26m old" 4.30<4.5<br>cls: 0.3372 >= 0.1 (0.336@516ms DIV. 205->226, FOOTER.ftr 637->0) |
| rankings | 320 | 2070 | 0.0708 | 12 / 0 | PASS |
| rankings | 360 | 2009 | 0.0677 | 12 / 0 | PASS |
| rankings | 390 | 1947 | 0.0495 | 12 / 0 | PASS |
| rankings | 430 | 1910 | 0.0507 | 12 / 0 | PASS |
| rankings | 768 | 1408 | 0.0016 | 12 / 0 | PASS |
| rankings | 1024 | 1118 | 0.0009 | 12 / 0 | PASS |
| rankings | 1440 | 1118 | 0.0014 | 12 / 0 | PASS |

/news sections at 1440: fernandez wins the singapore title · live tennis wire · latest intelligence · current tournaments · players moving

## local — 56/56 green

Base http://localhost:5194, run 2026-09-29T20:13:49.656Z.

| page | width | height | CLS | text measured / failing AA | result |
|---|---|---|---|---|---|
| home | 320 | 16142 | 0.0137 | 517 / 0 | PASS |
| home | 360 | 14799 | 0.0131 | 517 / 0 | PASS |
| home | 390 | 14095 | 0.013 | 517 / 0 | PASS |
| home | 430 | 13797 | 0.0324 | 517 / 0 | PASS |
| home | 768 | 11300 | 0.0015 | 519 / 0 | PASS |
| home | 1024 | 8011 | 0.0002 | 519 / 0 | PASS |
| home | 1440 | 6807 | 0.0004 | 517 / 0 | PASS |
| news | 320 | 8802 | 0.0032 | 299 / 0 | PASS |
| news | 360 | 8435 | 0.0027 | 299 / 0 | PASS |
| news | 390 | 8203 | 0.0031 | 299 / 0 | PASS |
| news | 430 | 8106 | 0.0031 | 299 / 0 | PASS |
| news | 768 | 6423 | 0.003 | 315 / 0 | PASS |
| news | 1024 | 5022 | 0.0025 | 315 / 0 | PASS |
| news | 1440 | 4699 | 0.0018 | 315 / 0 | PASS |
| article | 320 | 9312 | 0.0011 | 251 / 0 | PASS |
| article | 360 | 8787 | 0.022 | 251 / 0 | PASS |
| article | 390 | 8442 | 0.023 | 252 / 0 | PASS |
| article | 430 | 8150 | 0.0009 | 252 / 0 | PASS |
| article | 768 | 6476 | 0.0023 | 252 / 0 | PASS |
| article | 1024 | 6097 | 0.0015 | 252 / 0 | PASS |
| article | 1440 | 5341 | 0.0006 | 252 / 0 | PASS |
| player-alcaraz | 320 | 7446 | 0.0006 | 286 / 0 | PASS |
| player-alcaraz | 360 | 7276 | 0.0002 | 292 / 0 | PASS |
| player-alcaraz | 390 | 7228 | 0.0005 | 326 / 0 | PASS |
| player-alcaraz | 430 | 6670 | 0.0004 | 326 / 0 | PASS |
| player-alcaraz | 768 | 5651 | 0.0002 | 408 / 0 | PASS |
| player-alcaraz | 1024 | 5276 | 0.0002 | 408 / 0 | PASS |
| player-alcaraz | 1440 | 5097 | 0.0005 | 408 / 0 | PASS |
| player-swiatek | 320 | 7271 | 0.0006 | 295 / 0 | PASS |
| player-swiatek | 360 | 7120 | 0.0002 | 306 / 0 | PASS |
| player-swiatek | 390 | 7068 | 0.0005 | 335 / 0 | PASS |
| player-swiatek | 430 | 6697 | 0.0004 | 335 / 0 | PASS |
| player-swiatek | 768 | 5669 | 0.0002 | 417 / 0 | PASS |
| player-swiatek | 1024 | 5328 | 0.0002 | 417 / 0 | PASS |
| player-swiatek | 1440 | 5153 | 0.0005 | 417 / 0 | PASS |
| tournament | 320 | 15585 | 0.0118 | 770 / 0 | PASS |
| tournament | 360 | 15331 | 0.0002 | 770 / 0 | PASS |
| tournament | 390 | 15111 | 0.0005 | 771 / 0 | PASS |
| tournament | 430 | 15099 | 0.0004 | 771 / 0 | PASS |
| tournament | 768 | 14097 | 0.0002 | 771 / 0 | PASS |
| tournament | 1024 | 8882 | 0.0002 | 771 / 0 | PASS |
| tournament | 1440 | 7405 | 0.0005 | 771 / 0 | PASS |
| match | 320 | 3073 | 0.0707 | 38 / 0 | PASS |
| match | 360 | 2954 | 0.036 | 38 / 0 | PASS |
| match | 390 | 2876 | 0.0362 | 39 / 0 | PASS |
| match | 430 | 2839 | 0.0362 | 39 / 0 | PASS |
| match | 768 | 2406 | 0.0002 | 39 / 0 | PASS |
| match | 1024 | 1882 | 0.0002 | 39 / 0 | PASS |
| match | 1440 | 1886 | 0.0005 | 39 / 0 | PASS |
| rankings | 320 | 2214 | 0.0006 | 12 / 0 | PASS |
| rankings | 360 | 2194 | 0.0002 | 12 / 0 | PASS |
| rankings | 390 | 2157 | 0.0005 | 12 / 0 | PASS |
| rankings | 430 | 2120 | 0.0004 | 12 / 0 | PASS |
| rankings | 768 | 1768 | 0.0002 | 12 / 0 | PASS |
| rankings | 1024 | 1478 | 0.0005 | 12 / 0 | PASS |
| rankings | 1440 | 1478 | 0.0005 | 12 / 0 | PASS |

/news sections at 1440: fernandez wins the singapore title · current tournaments · latest intelligence · players moving · wta wta desk · what’s next · notable results

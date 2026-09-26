# Player media

UFC-quality bar, rights first. Ledger: `data/media/player-media.json` (empty today) mirrored by
`tennis_player_media`.

## Acquisition

Wikidata P18 → Commons file → `commons.license` adapter reads license, author, credit, size. Accepted
licenses: CC0, Public Domain, CC BY, CC BY-SA (any version). Rejected: NC, ND, unknown, "all rights
reserved", tour/tournament/agency photography, AI likenesses, anything identity-unproven. Wikidata
records ~2,146 ATP-id and ~1,487 WTA-id humans with an image (distinct images) — a real starting pool.

## Approval

Each approved entry carries: player UUID, display name, source page, original URL, author, license,
attribution, width/height, reviewed focal (face) box, identity evidence (QID ↔ tour id ↔ caption/date),
rights status, verified_at, derivative metadata. The guard fails the build on an approved entry missing
any of these, a non-free license, a missing derivative, or an orphan derivative folder.

## Derivatives

`portrait`, `card`, `thumb`, `wide`, `og` (webp) generated from the reviewed focal box; no forehead crops,
no stretching, no browser re-crop that overrides art direction. Stored under
`public/media/players/<uuid>/`.

## Fallback

No approved photo → initials identity card (`src/ui/identity-card.js`). Never another athlete's photo.
Coverage KPI order: live/upcoming → top ranked → current fields → Challenger/WTA 125 → ITF → archive.

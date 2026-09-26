# PropBetEdge Tennis

Global professional tennis intelligence for `tennis.propbetedge.ai` — ATP, WTA, Challenger, WTA 125,
ITF, Grand Slams and team events; singles, doubles and mixed doubles — built on a canonical data graph
PropBetEdge acquires, normalizes and owns ($0 data licensing).

**Status: foundation (Milestone 0 + shell). Not deployed. `PRODUCTION READY: NO`.** See `docs/STATUS.md`.

```
npm install
npm run check     # truth guard + 62 tests + Vite build + prerender
npm run canary    # live read-only source canaries -> docs/evidence/source-canary-latest.json
npm run matrix    # regenerate docs/TENNIS_SOURCE_MATRIX.md
npm run qa        # six-viewport overflow/console QA (needs local Chrome)
npm run dev
```

Architecture: Vercel serves `dist/` (static). Cloudflare Workers `tennis-api`, `tennis-ingest`,
`tennis-live`, `tennis-model`, `tennis-news` own every API and runtime job. Supabase holds canonical
records; R2 holds content-addressed raw source evidence. See `CLAUDE.md` and `docs/`.

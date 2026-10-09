// RESEARCH visibility control for the PBE Picks surfaces (owner, LHBUSA/tennis#12, 2026-10-09). Separate from PICKS_LIVE
// (official activation, still false) and PICKER_POLICY.activated_at (still null): it shows the prospective RESEARCH
// ledgers — never official picks — without the ?preview=picker query. Pending pre-match selections stay All Access (the
// API enforces it: /v1/picks* is membership-gated, fail-closed, private no-store); the public sees resolved results only.
export const PICKS_RESEARCH_VISIBLE = true;

# Tennis DNA — limitations

- **Coverage is source-bound.** Today only the WTA API provides full per-set serve/return statistics
  (pending the rights decision). ATP and ITF statistics have no open official path yet; Slam statistics
  exist only for the current AO edition. Men's DNA is therefore not computable yet.
- **Doubles statistics are team-level.** WTA doubles stats describe the side, not each player.
  Individual doubles DNA must not be derived from team totals.
- **Walkovers contribute nothing;** retirements contribute the points actually played and are flagged.
- **Break points faced/saved come from the opponent's return columns** (source semantics verified on
  one capture; re-verified by the consistency check on every parse).
- **Small samples:** confidence tiers are conservative; `insufficient` metrics must not be ranked.
- **No shot, rally or court-position data** exists in any open source found. Those metrics stay absent.

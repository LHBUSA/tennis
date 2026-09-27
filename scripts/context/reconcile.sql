-- Phase 5 reconciliation (idempotent; scripts/context/reconcile.mjs runs it and writes the evidence file).
-- Rule version context-v1. Nothing here matches tournaments by name.

-- R1. ESPN edition -> canonical edition, from the rows the ESPN event's own match ids point at.
--     prov espn_atp (MS/MD/XD rows) / espn_wta (WS/WD rows); external id = ESPN event key '<tid>-<year>'.
with x as (
  select split_part(xi.external_id, ':', 1) ev,
         case when m.event_type in ('WS', 'WD') then 'espn_wta' else 'espn_atp' end prov,
         m.edition_id, e.source_family esrc, e.start_date
  from tennis_match_external_ids xi join tennis_matches m using (match_id) join tennis_tournament_editions e using (edition_id)
  where xi.provider = 'espn'),
g as (select prov, ev, edition_id, esrc, min(start_date) start_date, count(*) n from x group by 1, 2, 3, 4),
t as (select prov, ev, sum(n) total, count(*) filter (where esrc <> 'espn') n_off, count(*) filter (where esrc = 'espn') n_espn from g group by 1, 2),
off as (select distinct on (prov, ev) prov, ev, edition_id, n, start_date from g where esrc <> 'espn' order by prov, ev, n desc, edition_id),
own as (select distinct on (prov, ev) prov, ev, edition_id, n, start_date from g where esrc = 'espn' order by prov, ev, n desc, edition_id),
d as (
  select t.prov, t.ev, t.total, t.n_off, t.n_espn, off.edition_id off_id, off.n off_n, off.start_date off_start, own.edition_id own_id, own.n own_n, own.start_date own_start,
    case
      when t.n_off > 1 then 'ambiguous'
      when t.n_off = 1 and off.n >= 2 and (own.start_date is null or off.start_date is null or abs(off.start_date - own.start_date) <= 7) then 'mapped'
      when t.n_off = 1 then 'unresolved'
      when t.n_espn = 1 then 'mapped'
      else 'ambiguous' end status,
    case when t.n_off = 1 and off.n >= 3 then 'high' when t.n_off = 1 and off.n >= 2 then 'medium' when t.n_off = 0 and t.n_espn = 1 then 'high' end conf
  from t left join off using (prov, ev) left join own using (prov, ev))
insert into tennis_source_mappings (entity_type, provider, external_id, canonical_id, status, method, confidence, evidence, rule_version, decided_at)
select 'edition', prov, ev,
  case when status = 'mapped' then coalesce(case when n_off = 1 then off_id end, own_id) end,
  status,
  case when n_off >= 1 then 'shared_matches' else 'espn_founded' end,
  case when status = 'mapped' then conf end,
  jsonb_build_object('espn_rows', total, 'rows_in_official_edition', off_n, 'official_editions', n_off, 'rows_in_espn_edition', own_n, 'espn_edition', own_id, 'official_edition', off_id, 'official_start', off_start, 'espn_start', own_start),
  'context-v1', now()
from d
on conflict (entity_type, provider, external_id) do update set canonical_id = excluded.canonical_id, status = excluded.status, method = excluded.method, confidence = excluded.confidence, evidence = excluded.evidence, rule_version = excluded.rule_version, decided_at = excluded.decided_at;

-- R2. ESPN tournament id -> canonical tournament: every mapped edition of that tid (per league) must sit in ONE
--     canonical tournament; two or more -> ambiguous (never picked).
with e as (
  select m.provider prov, split_part(m.external_id, '-', 1) tid, ed.tournament_id, m.confidence
  from tennis_source_mappings m join tennis_tournament_editions ed on ed.edition_id = m.canonical_id
  where m.entity_type = 'edition' and m.provider in ('espn_atp', 'espn_wta') and m.status = 'mapped'),
g as (select prov, tid, count(distinct tournament_id) ts, count(*) eds, count(*) filter (where confidence = 'high') high, min(tournament_id::text)::uuid tournament_id from e group by 1, 2)
insert into tennis_source_mappings (entity_type, provider, external_id, canonical_id, status, method, confidence, evidence, rule_version, decided_at)
select 'tournament', prov, tid, case when ts = 1 then tournament_id end, case when ts = 1 then 'mapped' else 'ambiguous' end, 'mapped_editions',
  case when ts = 1 and high >= 2 then 'high' when ts = 1 then 'medium' end,
  jsonb_build_object('mapped_editions', eds, 'high_editions', high, 'canonical_tournaments', ts), 'context-v1', now()
from g
on conflict (entity_type, provider, external_id) do update set canonical_id = excluded.canonical_id, status = excluded.status, method = excluded.method, confidence = excluded.confidence, evidence = excluded.evidence, rule_version = excluded.rule_version, decided_at = excluded.decided_at;

-- R3. Combined events: an ESPN ATP edition whose ESPN event id is ALSO the WTA league's event mapped (high) to
--     an official WTA edition in the same city (folded) within 7 days takes that official edition's surface /
--     indoor as a sourced attribute (source wta, method combined_event). City = the edition's, else the official
--     calendar's (attribute evidence). No city, or a different one (Toronto / Montreal), -> nothing.
with a as (
  select m.external_id ev, m.canonical_id atp_ed from tennis_source_mappings m
  where m.entity_type = 'edition' and m.provider = 'espn_atp' and m.status = 'mapped' and m.method = 'espn_founded'),
w as (
  select m.external_id ev, m.canonical_id wta_ed from tennis_source_mappings m
  where m.entity_type = 'edition' and m.provider = 'espn_wta' and m.status = 'mapped' and m.confidence = 'high' and m.method = 'shared_matches'),
c as (
  select a.atp_ed, w.wta_ed, a.ev, ea.city atp_city, ew.wta_city, ea.start_date atp_start, ew.start_date wta_start, ew.surface, ew.indoor
  from a join w using (ev) join tennis_tournament_editions ea on ea.edition_id = a.atp_ed
  join (select x.*, coalesce(nullif(x.city, ''), nullif((select at.evidence->>'city' from tennis_edition_attributes at where at.edition_id = x.edition_id and at.attribute = 'surface' and at.source = 'wta' and at.method = 'direct' limit 1), '')) wta_city
        from tennis_tournament_editions x) ew on ew.edition_id = w.wta_ed
  where ew.source_family <> 'espn' and ew.surface is not null
    and lower(regexp_replace(translate(coalesce(ea.city, ''), 'áàâäãåéèêëíìîïóòôöõúùûüçñ', 'aaaaaaeeeeiiiiooooouuuucn'), '[^a-zA-Z]', '', 'g')) =
        lower(regexp_replace(translate(coalesce(ew.wta_city, ''), 'áàâäãåéèêëíìîïóòôöõúùûüçñ', 'aaaaaaeeeeiiiiooooouuuucn'), '[^a-zA-Z]', '', 'g'))
    and coalesce(ea.city, '') <> '' and abs(ea.start_date - ew.start_date) <= 7)
insert into tennis_edition_attributes (edition_id, attribute, value, source, method, source_ref, evidence, observed_at)
select atp_ed, 'surface', surface, 'wta', 'combined_event', 'espn:' || ev, jsonb_build_object('espn_event', ev, 'wta_edition', wta_ed, 'atp_city', atp_city, 'wta_city', wta_city, 'atp_start', atp_start, 'wta_start', wta_start), now() from c
union all
select atp_ed, 'indoor', indoor::text, 'wta', 'combined_event', 'espn:' || ev, jsonb_build_object('espn_event', ev, 'wta_edition', wta_ed), now() from c where indoor is not null
on conflict (edition_id, attribute, source) do update set value = excluded.value, method = excluded.method, source_ref = excluded.source_ref, evidence = excluded.evidence, observed_at = excluded.observed_at;

-- R4. Effective edition surface / indoor = the sourced attribute when the edition has none (never overwrites);
--     a sourced value that disagrees with a stored one is logged.
update tennis_tournament_editions e set surface = a.value
from (select distinct on (edition_id) edition_id, value from tennis_edition_attributes where attribute = 'surface' order by edition_id, case method when 'direct' then 0 when 'draw_sheet' then 1 else 2 end) a
where a.edition_id = e.edition_id and e.surface is null;
update tennis_tournament_editions e set indoor = a.value::boolean
from (select distinct on (edition_id) edition_id, value from tennis_edition_attributes where attribute = 'indoor' order by edition_id, case method when 'direct' then 0 when 'draw_sheet' then 1 else 2 end) a
where a.edition_id = e.edition_id and e.indoor is null;
insert into tennis_source_disagreements (entity_type, entity_id, field, source, source_value, derived_value, detail)
select 'edition', a.edition_id::text, 'surface', a.source || ':' || a.method, to_jsonb(a.value), to_jsonb(e.surface), jsonb_build_object('source_ref', a.source_ref)
from tennis_edition_attributes a join tennis_tournament_editions e using (edition_id)
where a.attribute = 'surface' and e.surface is not null and e.surface <> a.value
on conflict (entity_type, entity_id, field, source) do nothing;

-- R5. Matches inherit their edition's surface / indoor (only where the match has none).
update tennis_matches m set surface = e.surface from tennis_tournament_editions e where e.edition_id = m.edition_id and m.surface is null and e.surface is not null;
update tennis_matches m set indoor = e.indoor from tennis_tournament_editions e where e.edition_id = m.edition_id and m.indoor is null and e.indoor is not null;

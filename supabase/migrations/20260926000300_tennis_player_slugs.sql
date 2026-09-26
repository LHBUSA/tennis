-- Stable, readable player slugs for /players/:slug. Assigned once at insert (never rewritten, so URLs
-- never break); a name collision appends the first 6 hex of the player UUID.
alter table public.tennis_players add column if not exists slug text;

create or replace function public.tennis_slugify(t text) returns text language sql immutable as $$
  select trim(both '-' from regexp_replace(lower(translate(coalesce(t, ''),
    'ÁÀÂÄÃÅĄĂáàâäãåąăÇĆČçćčĎĐďđÉÈÊËĘĚéèêëęěÍÌÎÏíìîïıĹĽŁĺľłÑŃŇñńňÓÒÔÖÕŐØóòôöõőøŔŘŕřŚŠŞśšşŤŢťţÚÙÛÜŮŰúùûüůűÝýÿŹŻŽźżž',
    'AAAAAAAAaaaaaaaaCCCcccDDddEEEEEEeeeeeeIIIIiiiiiLLLlllNNNnnnOOOOOOOoooooooRRrrSSSsssTTttUUUUUUuuuuuuYyyZZZzzz')), '[^a-z0-9]+', '-', 'g'))
$$;

create or replace function public.tennis_players_assign_slug() returns trigger language plpgsql as $$
declare base text;
begin
  if new.slug is null then
    base := nullif(public.tennis_slugify(new.full_name), '');
    if base is null or exists (select 1 from public.tennis_players where slug = base and pbe_player_id <> new.pbe_player_id) then
      base := coalesce(base || '-', 'player-') || left(replace(new.pbe_player_id::text, '-', ''), 6);
    end if;
    new.slug := base;
  end if;
  return new;
end $$;

create trigger tennis_players_slug before insert or update on public.tennis_players
  for each row execute function public.tennis_players_assign_slug();

update public.tennis_players set slug = null where slug is null;  -- fires the trigger for existing rows
create unique index if not exists tennis_players_slug_key on public.tennis_players (slug);

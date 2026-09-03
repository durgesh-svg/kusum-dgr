-- Migration: protect site_config from being blanked
--
-- Background (Sep 2026 incident):
--   loadSites() in assets/js/auth.js ran on every login. When the site_config
--   read came back empty OR errored (supabase-js returns {data:null,error}
--   instead of throwing, so the try/catch fallback never fired), it upserted the
--   35 hardcoded DEFAULT_SITES with all-NULL capacities. One failed request on
--   one user's phone blanked inverter_count / dc_capacity_kw / ac_capacity_kw /
--   strings_per_inv for 35 sites, for all 73 users. It stayed invisible for two
--   days because startDGR() silently fell back to `inverter_count || 6`.
--
--   The client bug is fixed. This migration is the database-side backstop so
--   that no future client bug — or console paste — can repeat it.
--
-- IMPORTANT: run PART 1. PART 2 is optional and must be verified before relying
-- on it (see the notes there).

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 1 — Never let an UPDATE blank a capacity column that already has a value
-- ─────────────────────────────────────────────────────────────────────────────
-- Deliberately PRESERVES the old value instead of raising, so that a partial
-- admin save can never hard-fail and never loses data. The skipped column is
-- reported as a WARNING in the Postgres logs.
--
-- To intentionally clear one of these columns, do it from the Supabase SQL
-- editor (this trigger only guards the app's anon-key writes):
--   ALTER TABLE site_config DISABLE TRIGGER site_config_no_blanking;
--   UPDATE site_config SET inverter_count = NULL WHERE site_name = '...';
--   ALTER TABLE site_config ENABLE  TRIGGER site_config_no_blanking;

CREATE OR REPLACE FUNCTION site_config_block_blanking()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.inverter_count IS NOT NULL AND NEW.inverter_count IS NULL THEN
    RAISE WARNING 'site_config: kept inverter_count for "%" (write tried to blank it)', OLD.site_name;
    NEW.inverter_count := OLD.inverter_count;
  END IF;

  IF OLD.dc_capacity_kw IS NOT NULL AND NEW.dc_capacity_kw IS NULL THEN
    RAISE WARNING 'site_config: kept dc_capacity_kw for "%" (write tried to blank it)', OLD.site_name;
    NEW.dc_capacity_kw := OLD.dc_capacity_kw;
  END IF;

  IF OLD.ac_capacity_kw IS NOT NULL AND NEW.ac_capacity_kw IS NULL THEN
    RAISE WARNING 'site_config: kept ac_capacity_kw for "%" (write tried to blank it)', OLD.site_name;
    NEW.ac_capacity_kw := OLD.ac_capacity_kw;
  END IF;

  IF OLD.strings_per_inv IS NOT NULL AND NEW.strings_per_inv IS NULL THEN
    RAISE WARNING 'site_config: kept strings_per_inv for "%" (write tried to blank it)', OLD.site_name;
    NEW.strings_per_inv := OLD.strings_per_inv;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS site_config_no_blanking ON site_config;
CREATE TRIGGER site_config_no_blanking
  BEFORE UPDATE ON site_config
  FOR EACH ROW
  EXECUTE FUNCTION site_config_block_blanking();

-- Verify PART 1 (should leave the value untouched and log a warning):
--   UPDATE site_config SET inverter_count = NULL WHERE site_name = 'Birmana Tal';
--   SELECT site_name, inverter_count FROM site_config WHERE site_name = 'Birmana Tal';
--   -- expected: 9

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 2 — OPTIONAL: block DELETE via the anon key
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THIS IS LIMITED: the app does not use Supabase Auth. All 73 users — every
-- engineer, manager and admin — share the SAME anon key, so Postgres cannot tell
-- an admin apart from an engineer. A real "only admins may write site_config"
-- policy is NOT possible until either:
--   (a) the app moves to Supabase Auth and roles land in the JWT, or
--   (b) all site_config writes move into an Edge Function that checks the
--       caller's role server-side and uses the service_role key.
-- Until then the most RLS can add is: everyone reads, everyone writes, nobody
-- deletes. Combined with PART 1, that removes both ways to lose data.
--
-- DO NOT run this blind — enabling RLS with a wrong policy set locks the app
-- out. Run it, then immediately confirm the app can still log in, list sites,
-- and save a site from Admin > Sites. Rollback is the last line of this file.
--
-- ALTER TABLE site_config ENABLE ROW LEVEL SECURITY;
--
-- CREATE POLICY site_config_read   ON site_config FOR SELECT TO anon USING (true);
-- CREATE POLICY site_config_insert ON site_config FOR INSERT TO anon WITH CHECK (true);
-- CREATE POLICY site_config_update ON site_config FOR UPDATE TO anon USING (true) WITH CHECK (true);
-- -- no DELETE policy is created, so DELETE is denied for anon.
-- -- Edge Functions use service_role, which bypasses RLS and is unaffected.
--
-- Rollback if anything breaks:
--   ALTER TABLE site_config DISABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- SEPARATE ISSUE, not fixed here
-- ─────────────────────────────────────────────────────────────────────────────
-- auth.js reads the users table with the anon key: sb.from('users').select('*'),
-- which returns password_hash for every user to anyone who opens the app. That
-- needs its own fix (Supabase Auth, or an Edge Function login) and is out of
-- scope for this migration.

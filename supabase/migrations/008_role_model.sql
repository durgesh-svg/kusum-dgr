-- Role model: director > admin > manager > engineer. APPLIED 2026-10-06.
-- Kept as reference, in line with how 001 documents out-of-band DDL.
--
--   director  Durgesh, Ankit shah
--   admin     Chirag Panchal, Shubham (7014162986)   -- unchanged
--   manager   Arun Verma, Monika, Shri Ram Saini, Admin (shared, 9999999999)
--   engineer  everyone else -- untouched, nobody deactivated
--
-- Only phone-authenticated DGR accounts are touched. None of the six changed
-- rows is a Supabase Auth user, so the other app sharing this table (whose RLS
-- on expenses/plans tests role IN ('admin','super_admin')) is unaffected.
-- The 'admin' O&M account (7014162982) IS an auth user there and is left alone.
--
-- Sessions cache the role in localStorage at login, so a change only takes
-- effect when that person logs out and back in.

CREATE TABLE IF NOT EXISTS role_migration_backup (
  user_id   UUID PRIMARY KEY,
  name      TEXT,
  phone     TEXT,
  old_role  TEXT,
  taken_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- RLS on with no policy: not readable through the anon key, unlike `users`.
ALTER TABLE role_migration_backup ENABLE ROW LEVEL SECURITY;

INSERT INTO role_migration_backup (user_id, name, phone, old_role)
SELECT id, name, phone, role FROM users
WHERE phone IN ('7503640664','9582040879','9024224565','9358185988','6367768902','9999999999')
ON CONFLICT (user_id) DO NOTHING;

UPDATE users SET role = 'director'
 WHERE phone IN ('7503640664','9582040879') AND password_hash IS NOT NULL;

UPDATE users SET role = 'manager'
 WHERE phone IN ('9024224565','9358185988','6367768902','9999999999') AND password_hash IS NOT NULL;

-- ROLLBACK
--   UPDATE users u SET role = b.old_role FROM role_migration_backup b WHERE u.id = b.user_id;

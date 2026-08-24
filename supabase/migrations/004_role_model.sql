-- ============================================================================
-- DGR portal: role model consolidation + deactivation of dormant accounts
--
--   director  Durgesh, Ankit shah
--   admin     Chirag Panchal, Shubham (7014162986)
--   manager   Arun Verma, Monika, Shri Ram Saini, Admin (shared 9999999999)
--   engineer  the 42 actively filing site engineers (unchanged)
--   inactive  10 dormant / test accounts -- locked and password cleared
--
-- SCOPE: only rows that can log into the DGR app (phone + password_hash).
-- This users table is shared with another app whose accounts are email-only and
-- whose RLS on `expenses` and `plans` tests role IN ('admin','super_admin').
-- Those rows are deliberately untouched.
--
-- !! DEPLOY APP CODE FIRST !!
-- The live build has no 'director' branch and does not check `active`. Running
-- this before the code ships would drop Durgesh and Ankit to engineer treatment
-- and leave deactivated users still able to log in (until their hash is cleared
-- below, which this migration does do).
-- ============================================================================

-- 1. Deactivation support --------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

-- 2. Reversible snapshot ---------------------------------------------------
CREATE TABLE IF NOT EXISTS role_migration_backup (
  user_id       UUID PRIMARY KEY,
  name          TEXT,
  phone         TEXT,
  old_role      TEXT,
  old_active    BOOLEAN,
  old_pw_hash   TEXT,
  taken_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Locked down: no policy = no access via the anon key, unlike `users`.
ALTER TABLE role_migration_backup ENABLE ROW LEVEL SECURITY;

INSERT INTO role_migration_backup (user_id, name, phone, old_role, old_active, old_pw_hash)
SELECT id, name, phone, role, active, password_hash FROM users
WHERE phone IS NOT NULL AND phone <> '' AND password_hash IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

-- 3. Roles -----------------------------------------------------------------
UPDATE users SET role = 'director'
 WHERE phone IN ('7503640664',   -- Durgesh
                 '9582040879')   -- Ankit shah
   AND password_hash IS NOT NULL;

UPDATE users SET role = 'admin'
 WHERE phone IN ('7732917204',   -- Chirag Panchal
                 '7014162986')   -- Shubham
   AND password_hash IS NOT NULL;

UPDATE users SET role = 'manager'
 WHERE phone IN ('9024224565',   -- Arun Verma
                 '9358185988',   -- Monika
                 '6367768902',   -- Shri Ram Saini
                 '9999999999')   -- Admin (shared account; 5,835 approvals to date)
   AND password_hash IS NOT NULL;

-- 4. Deactivate dormant / test accounts ------------------------------------
-- Verified: every site assigned to these users is being filed by someone else
-- (11-14 reports in the trailing 14 days), so no site loses coverage.
UPDATE users
   SET active = false,
       role = 'engineer',
       password_hash = NULL,      -- blocks login today, before any code change
       must_change_pw = true
 WHERE phone IN (
   '9468582852',  -- Harish              78 reports, last 22 Jun
   '9784835392',  -- Krishna Kumar mali  29 reports, last 05 Jul
   '8306646948',  -- Shubham            109 reports, last 09 Jul
   '8302802158',  -- Ramchandra         107 reports, last 12 Jul
   '8209795945',  -- Parmendra           16 reports, last 04 Jun
   '7014162985',  -- shubham              4 reports, last 31 May
   '7523861136',  -- Gaurav gupta         0 reports, 35 sites assigned
   '8949795167',  -- Mahendra             0 reports
   '7014162984',  -- shubham2             0 reports
   '7014162982'   -- admin (O&M)          0 reports, 0 approvals
 );

-- 5. Keep the other app working --------------------------------------------
-- Its policies test ('admin','super_admin'); demoted DGR accounts are now
-- 'manager' or 'director'. Widen so nobody silently loses access.
DROP POLICY IF EXISTS "Admins and Super Admins can view all expenses" ON expenses;
CREATE POLICY "Admins and Super Admins can view all expenses" ON expenses FOR SELECT
  USING (auth.uid() = user_id OR (SELECT role FROM users WHERE id = auth.uid())
         = ANY (ARRAY['admin','super_admin','manager','director']));

DROP POLICY IF EXISTS "Admins and Super Admins can update expenses" ON expenses;
CREATE POLICY "Admins and Super Admins can update expenses" ON expenses FOR UPDATE
  USING ((SELECT role FROM users WHERE id = auth.uid())
         = ANY (ARRAY['admin','super_admin','manager','director']));

DROP POLICY IF EXISTS "View plans policy" ON plans;
CREATE POLICY "View plans policy" ON plans FOR SELECT
  USING (auth.uid() = user_id OR (SELECT role FROM users WHERE id = auth.uid())
         = ANY (ARRAY['admin','super_admin','manager','director']));

-- ============================================================================
-- ROLLBACK
--   UPDATE users u
--      SET role = b.old_role, active = b.old_active, password_hash = b.old_pw_hash
--     FROM role_migration_backup b
--    WHERE u.id = b.user_id;
-- ============================================================================

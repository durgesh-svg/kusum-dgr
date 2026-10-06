-- Attendance bridge: the expense portal (separate Supabase project,
-- zsxnaslqursbdpvuzssn) already runs GPS check-ins for site engineers. The DGR
-- app reads them through a read-only RPC there (dgr_checkin_status) and stamps
-- the matching check-in onto each daily report.
--
-- Engineers are matched by phone. Sites are matched by the portal's site_code,
-- because names differ ("Choti Serva" vs "Choti serwa") and several portal
-- sites cover more than one DGR site ("Pahel & Haspurkalan", "Chitawa").

ALTER TABLE site_config ADD COLUMN IF NOT EXISTS attendance_site_code TEXT;
-- For engineers registered with a different number in the portal.
ALTER TABLE users ADD COLUMN IF NOT EXISTS attendance_phone TEXT;

ALTER TABLE dgr_submissions
  ADD COLUMN IF NOT EXISTS checkin_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS checkin_site   TEXT,
  -- verified | other_site | none | unmatched | error
  ADD COLUMN IF NOT EXISTS checkin_status TEXT;

UPDATE site_config SET attendance_site_code = m.code
FROM (VALUES
  ('Anjoliya ka kheda','LOC0114'),('Badsar','LOC0015'),('Bamboo','LOC0062'),
  ('Bhudhro Ki dhani','LOC0002'),('Bidasar','LOC0003'),('Birmana Tal','LOC0009'),
  ('Chitawa-1','LOC0023'),('Chitawa-2','LOC0023'),('Chitawa-3','LOC0023'),
  ('Choti serwa','LOC0040'),('Dausar','LOC0133'),
  ('Gajroopdesar -1','LOC0046'),   -- portal "Gajroopdesar(4MW)"   = 5.6 MW DC site
  ('Gajroopdesar -2','LOC0060'),   -- portal "Gajroopdesar(2.5 MW)" = 3.5 MW DC site
  ('Ghantel','LOC0010'),('Haspur','LOC0059'),('Jamola','LOC0007'),('Jetpura','LOC0132'),
  ('Keshloi tal','LOC0011'),('Khakholi','LOC0058'),
  ('Kherla nagar-1','LOC0008'),('Kherla nagar-2','LOC0008'),
  ('Khunkhuna','LOC0036'),('Kunpalsar','LOC0012'),('Lalasar','LOC0037'),('Muknasar','LOC0018'),
  ('Nadiya Tal','LOC0004'),('Pahel','LOC0059'),('Pilania pau','LOC0038'),('Purnadatal','LOC0022'),
  ('Raimalwara-1','LOC0017'),('Raimalwara-2','LOC0017'),('Rajaldesar','LOC0024'),
  ('Ramdevra-1','LOC0045'),('Ramdevra-2','LOC0013'),('Ratnania Cohra','LOC0006'),
  ('Rohisa','LOC0041'),('Sandwa','LOC0014'),('Sarana','LOC0116'),
  ('Satra-1','LOC0043'),('Satra-2','LOC0043'),('Sindhu-1','LOC0001'),('Sindhu-2','LOC0001'),
  ('Surawas','LOC0105'),('Udwala','LOC0005')
) AS m(site_name, code)
WHERE site_config.site_name = m.site_name;
-- No portal location exists for: Devliya kallan, Dhirasar, Ghewariya, Godwanti Tal.
-- Those stay NULL and report checkin_status = 'unmatched' until one is added.

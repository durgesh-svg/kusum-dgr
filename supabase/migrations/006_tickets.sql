-- Ticketing system: site engineers raise repair / expense requests against a site.
-- Applied via Supabase MCP apply_migration (same approach as 001).
--
-- Auth note: dgr.html has no Supabase Auth session — it authenticates against
-- public.users with the anon key. auth.uid() is always NULL here, so these tables
-- use the same permissive RLS as dgr_submissions / site_config / users, and
-- authorization is enforced client-side by role.

CREATE TABLE IF NOT EXISTS dgr_tickets (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_no                  BIGINT      GENERATED ALWAYS AS IDENTITY,
  site_name                  TEXT        NOT NULL REFERENCES site_config(site_name),
  category                   TEXT        NOT NULL DEFAULT 'Repair',
  title                      TEXT        NOT NULL,
  description                TEXT,
  priority                   TEXT        NOT NULL DEFAULT 'medium',
  target_date                DATE,
  estimated_cost             NUMERIC,
  approved_amount            NUMERIC,
  -- open | l1_approved | approved | rejected | closure_requested | closed | cancelled
  status                     TEXT        NOT NULL DEFAULT 'open',
  raised_by_phone            TEXT,
  raised_by_name             TEXT,
  l1_status                  TEXT        DEFAULT 'pending',
  l1_by_name                 TEXT,
  l1_at                      TIMESTAMPTZ,
  l1_remark                  TEXT,
  l2_status                  TEXT        DEFAULT 'pending',
  l2_by_name                 TEXT,
  l2_at                      TIMESTAMPTZ,
  l2_remark                  TEXT,
  closure_requested_at       TIMESTAMPTZ,
  closure_requested_by_name  TEXT,
  closure_note               TEXT,
  closed_at                  TIMESTAMPTZ,
  closed_by_name             TEXT,
  image_urls                 JSONB,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dgr_tickets_site_created ON dgr_tickets (site_name, created_at DESC);
CREATE INDEX IF NOT EXISTS dgr_tickets_status       ON dgr_tickets (status);
CREATE INDEX IF NOT EXISTS dgr_tickets_raised_by    ON dgr_tickets (raised_by_phone);

CREATE TABLE IF NOT EXISTS dgr_ticket_comments (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    UUID        NOT NULL REFERENCES dgr_tickets(id) ON DELETE CASCADE,
  author_phone TEXT,
  author_name  TEXT,
  author_role  TEXT,
  comment      TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dgr_ticket_comments_ticket ON dgr_ticket_comments (ticket_id, created_at);

-- Keep updated_at fresh on every ticket mutation
CREATE OR REPLACE FUNCTION dgr_tickets_touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dgr_tickets_set_updated_at ON dgr_tickets;
CREATE TRIGGER dgr_tickets_set_updated_at
  BEFORE UPDATE ON dgr_tickets
  FOR EACH ROW EXECUTE FUNCTION dgr_tickets_touch_updated_at();

-- RLS: mirrors "Allow all dgr_submissions"
ALTER TABLE dgr_tickets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE dgr_ticket_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all dgr_tickets" ON dgr_tickets;
CREATE POLICY "Allow all dgr_tickets" ON dgr_tickets FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all dgr_ticket_comments" ON dgr_ticket_comments;
CREATE POLICY "Allow all dgr_ticket_comments" ON dgr_ticket_comments FOR ALL USING (true) WITH CHECK (true);

-- Settings consumed by loadAppSettings() / saveAppSetting() in dgr.html
INSERT INTO dgr_settings (key, value) VALUES
  ('ticket_l2_threshold', '5000'::jsonb),
  ('ticket_categories',   '["Repair","Spare part","Expense","Other"]'::jsonb)
ON CONFLICT (key) DO NOTHING;

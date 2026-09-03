-- Module cleaning: the site engineer's independent daily observation.
--
-- Smart Watt (the cleaning vendor) does not use this app, so their claim
-- arrives separately as a document. The engineer's record is captured daily
-- and BEFORE anyone sees that claim -- month-end then matches two records
-- written blind to each other. Reverse that order and the engineer is
-- countersigning an invoice rather than verifying work.
--
-- Unit of work is the INVERTER, not the module: site_config.inverter_count is
-- populated for all 48 sites, while total_modules is missing for 20 of them.
-- Module quantities are derived downstream wherever the count exists.
--
-- Keyed (site_name, observed_on) and upserted, matching how dgr_submissions
-- is keyed (site_name, report_date).

CREATE TABLE IF NOT EXISTS cleaning_logs (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_name          TEXT        NOT NULL REFERENCES site_config(site_name),
  observed_on        DATE        NOT NULL,
  -- 'unknown' is deliberately a first-class answer: forcing yes/no when the
  -- engineer arrived after the crew left manufactures data.
  cleaning_done      TEXT        NOT NULL DEFAULT 'unknown'
                                 CHECK (cleaning_done IN ('yes','no','unknown')),
  inverters_cleaned  INTEGER[],
  quality            TEXT        CHECK (quality IN ('clean','streaked','partial','poor')),
  crew_seen          INTEGER,
  notes              TEXT,
  photo_urls         JSONB,
  observed_by_phone  TEXT,
  observed_by_name   TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_name, observed_on)
);

CREATE INDEX IF NOT EXISTS cleaning_logs_site_date ON cleaning_logs (site_name, observed_on DESC);
CREATE INDEX IF NOT EXISTS cleaning_logs_date      ON cleaning_logs (observed_on DESC);

CREATE OR REPLACE FUNCTION cleaning_logs_touch() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cleaning_logs_set_updated_at ON cleaning_logs;
CREATE TRIGGER cleaning_logs_set_updated_at
  BEFORE UPDATE ON cleaning_logs
  FOR EACH ROW EXECUTE FUNCTION cleaning_logs_touch();

-- Same permissive RLS as the other DGR tables: auth is custom, so auth.uid()
-- is always null here and authorization is enforced client-side.
ALTER TABLE cleaning_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all cleaning_logs" ON cleaning_logs;
CREATE POLICY "Allow all cleaning_logs" ON cleaning_logs FOR ALL USING (true) WITH CHECK (true);

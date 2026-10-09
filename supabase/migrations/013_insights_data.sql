-- 013: everything the Insights dashboard needs, in the database
--
-- The Stockwell DGR Dashboard arrived with two static files: data/dgr.json
-- (daily rows from the CUF Analysis workbooks, Oct 2025 onward) and
-- data/master.json (site master, meter readings, seasonal factors). Both now
-- live here, so dashboard/dgr-config.js reads only from Supabase.
--
-- All site names are in DGR-app form: Gajroopdesar -1 is the 4 MW plant.
-- The budget sheet names the two Gajroopdesar plants the other way round;
-- dgr_settings.insights_rename can swap them for display but is set to {}
-- (decided 9 Oct 2026: Insights shows the same names as the rest of the app).
--
-- Read-only for the app: SELECT policies only. Rows are loaded by an admin.
-- Seeded 9 Oct 2026 from the dashboard package (Stockwell DGR Dashboard (2).zip).

-- Site master fields the dashboard uses, alongside capacity and lat/lng
ALTER TABLE site_config ADD COLUMN IF NOT EXISTS district        text;
ALTER TABLE site_config ADD COLUMN IF NOT EXISTS tariff          numeric;   -- Rs/kWh
ALTER TABLE site_config ADD COLUMN IF NOT EXISTS pvsyst_dc_cuf   numeric;   -- annual, fraction (0.1889 = 18.89%)
ALTER TABLE site_config ADD COLUMN IF NOT EXISTS pvsyst_note     text;      -- why a PVsyst value is not used
ALTER TABLE site_config ADD COLUMN IF NOT EXISTS tilt_deg        numeric;
ALTER TABLE site_config ADD COLUMN IF NOT EXISTS peer_sites      text[];    -- "nearby plants" for same-day benchmarking
ALTER TABLE site_config ADD COLUMN IF NOT EXISTS colocated_sites text[];    -- same compound / feeder

-- Daily generation from the CUF workbooks, only for site-days with no DGR
CREATE TABLE IF NOT EXISTS dgr_history (
  site_name     text    NOT NULL,
  report_date   date    NOT NULL,
  ac_kw         numeric,
  dc_kwp        numeric,
  gen_kwh       numeric,
  grid_out_min  numeric,
  plant_out_min numeric,
  source        text    NOT NULL DEFAULT 'cuf_workbook',
  PRIMARY KEY (site_name, report_date)
);

-- Monthly meter (JMR) readings and budget, per site
CREATE TABLE IF NOT EXISTS site_meter_monthly (
  site_name    text    NOT NULL,
  month        text    NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  actual_kwh   numeric,
  import_kwh   numeric,
  export_kwh   numeric,
  budget_kwh   numeric,
  plant_avail  numeric,   -- fraction
  grid_avail   numeric,   -- fraction
  tariff       numeric,
  PRIMARY KEY (site_name, month)
);

ALTER TABLE dgr_history        ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_meter_monthly ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read dgr_history" ON dgr_history;
CREATE POLICY "Read dgr_history" ON dgr_history FOR SELECT USING (true);
DROP POLICY IF EXISTS "Read site_meter_monthly" ON site_meter_monthly;
CREATE POLICY "Read site_meter_monthly" ON site_meter_monthly FOR SELECT USING (true);

-- Seasonal factors and the display rename go in dgr_settings (JSONB key/value):
--   insights_seasonal = {"factors": {"01": 0.861, ...}, "note": "..."}
--   insights_rename   = {"map": {"Gajroopdesar -1": "Gajroopdesar -2", ...}, "note": "..."}
-- insights_rename is {"map": {}}: DGR-app names unchanged.

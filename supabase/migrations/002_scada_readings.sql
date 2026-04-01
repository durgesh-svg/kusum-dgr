-- SCADA readings table: stores time-series data fetched from Suryalog API
-- Separate from DGR manual entries; linked to site_config by site_name

CREATE TABLE IF NOT EXISTS scada_readings (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_name     TEXT        REFERENCES site_config(site_name),
  plant_key     TEXT        NOT NULL,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  data_start    TIMESTAMPTZ NOT NULL,
  data_end      TIMESTAMPTZ NOT NULL,
  raw_json      JSONB       NOT NULL,
  result_code   INT,
  storage_path  TEXT        -- path in suryalog-data Storage bucket
);

CREATE INDEX IF NOT EXISTS scada_readings_site_fetched
  ON scada_readings (site_name, fetched_at DESC);

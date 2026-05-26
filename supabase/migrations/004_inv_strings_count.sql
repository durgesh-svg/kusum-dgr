-- Add inv_strings_count column to dgr_submissions
-- Stores employee-entered string count per inverter (array, up to 20 inverters)

ALTER TABLE dgr_submissions
  ADD COLUMN IF NOT EXISTS inv_strings_count jsonb DEFAULT '[]'::jsonb;

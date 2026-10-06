-- Monthly joint meter readings (DISCOM-signed), extracted from scanned JMR PDFs.
-- The export figure is the DISCOM's "import" row (energy received from the plant).
CREATE TABLE IF NOT EXISTS jmr_readings (
  site_name   TEXT NOT NULL REFERENCES site_config(site_name),
  month       DATE NOT NULL,              -- first day of the month
  export_kwh  INTEGER NOT NULL,
  method      TEXT,                       -- ocr_pair | ocr_pair_deserialised | page_read
  loaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (site_name, month)
);
ALTER TABLE jmr_readings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all jmr_readings" ON jmr_readings;
CREATE POLICY "Allow all jmr_readings" ON jmr_readings FOR ALL USING (true) WITH CHECK (true);
INSERT INTO jmr_readings (site_name, month, export_kwh, method) VALUES
('Anjoliya ka kheda','2026-08-01',229840,'ocr_pair'),
('Badsar','2026-08-01',440500,'ocr_pair'),
('Bamboo','2026-08-01',289000,'ocr_pair'),
('Bhudhro Ki dhani','2026-08-01',643260,'ocr_pair'),
('Bidasar','2026-08-01',780240,'ocr_pair'),
('Birmana Tal','2026-08-01',438850,'ocr_pair'),
('Chitawa-1','2026-08-01',465120,'ocr_pair'),
('Chitawa-2','2026-08-01',343050,'ocr_pair'),
('Chitawa-3','2026-08-01',388650,'ocr_pair'),
('Choti serwa','2026-08-01',228650,'page_read'),
('Dausar','2026-08-01',276560,'ocr_pair'),
('Devliya kallan','2026-08-01',148080,'ocr_pair'),
('Dhirasar','2026-08-01',437500,'ocr_pair'),
('Gajroopdesar -1','2026-08-01',615600,'page_read'),
('Gajroopdesar -2','2026-08-01',329000,'page_read'),
('Ghantel','2026-08-01',463450,'ocr_pair'),
('Ghewariya','2026-08-01',130940,'ocr_pair'),
('Godwanti Tal','2026-08-01',466700,'ocr_pair'),
('Haspur','2026-08-01',436800,'ocr_pair'),
('Jamola','2026-08-01',464640,'ocr_pair'),
('Jetpura','2026-08-01',221280,'ocr_pair'),
('Keshloi tal','2026-08-01',268000,'ocr_pair'),
('Khakholi','2026-08-01',624600,'ocr_pair'),
('Kherla nagar-1','2026-08-01',502850,'ocr_pair_deserialised'),
('Kherla nagar-2','2026-08-01',501950,'ocr_pair_deserialised'),
('Khunkhuna','2026-08-01',777420,'ocr_pair'),
('Kunpalsar','2026-08-01',428700,'ocr_pair'),
('Lalasar','2026-08-01',761580,'ocr_pair'),
('Muknasar','2026-08-01',462250,'ocr_pair_deserialised'),
('Nadiya Tal','2026-08-01',368960,'ocr_pair'),
('Pahel','2026-08-01',586530,'page_read'),
('Pilania pau','2026-08-01',272360,'ocr_pair'),
('Purnadatal','2026-08-01',480850,'ocr_pair'),
('Raimalwara-1','2026-08-01',446850,'ocr_pair_deserialised'),
('Raimalwara-2','2026-08-01',442600,'ocr_pair_deserialised'),
('Rajaldesar','2026-08-01',749580,'ocr_pair'),
('Ramdevra-1','2026-08-01',417150,'ocr_pair'),
('Ramdevra-2','2026-08-01',452900,'ocr_pair'),
('Ratnania Cohra','2026-08-01',291320,'ocr_pair'),
('Rohisa','2026-08-01',369500,'ocr_pair'),
('Sandwa','2026-08-01',423700,'ocr_pair'),
('Sarana','2026-08-01',248040,'ocr_pair'),
('Satra-1','2026-08-01',762480,'ocr_pair'),
('Satra-2','2026-08-01',468650,'ocr_pair'),
('Sindhu-1','2026-08-01',435850,'ocr_pair'),
('Sindhu-2','2026-08-01',435100,'ocr_pair'),
('Surawas','2026-08-01',186080,'ocr_pair'),
('Udwala','2026-08-01',279360,'ocr_pair')
ON CONFLICT (site_name, month) DO UPDATE SET export_kwh=EXCLUDED.export_kwh, method=EXCLUDED.method, loaded_at=now();

-- Auto-ticketing for red alerts. A nightly pg_cron job evaluates the day's
-- reports and raises tickets in dgr_tickets with source='auto'. One open
-- ticket per (rule, site): if the condition fires again while that ticket is
-- open, a comment is appended instead of a duplicate.
--
-- Rules (p_date = the report date being evaluated, normally yesterday):
--   low_yield_3d     site below 85% of fleet median 3 days running, no outage declared  high
--   zero_gen         zero generation with no outage declared                            critical
--   inverter_zero    an inverter at 0 kWh while the site produced                      high
--   transformer_hot  WTI or OTI above 85 C                                              critical
--   site_silent_2d   no DGR filed for 2 consecutive days                                high
--   no_checkin_3d    3 consecutive reports with no site check-in                        medium
--   chronic_grid     > 15 h recorded grid outage in the trailing 7 days (Mondays only)  medium
--   cleaning_poor    engineer logged cleaning quality 'poor'                            medium

ALTER TABLE dgr_tickets
  ADD COLUMN IF NOT EXISTS source     TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS rule_key   TEXT,
  ADD COLUMN IF NOT EXISTS alert_date DATE;
CREATE INDEX IF NOT EXISTS dgr_tickets_rule_site ON dgr_tickets (rule_key, site_name) WHERE source='auto';

UPDATE dgr_settings SET value = (value::jsonb || '["Alert"]'::jsonb)
 WHERE key='ticket_categories' AND NOT (value::jsonb ? 'Alert');

-- Raise or re-fire one alert. Returns 'raised' | 're-fired' | 'dry-run'.
CREATE OR REPLACE FUNCTION auto_raise_ticket(
  p_rule text, p_site text, p_title text, p_desc text, p_priority text,
  p_category text, p_date date, p_dry boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM dgr_tickets
   WHERE source='auto' AND rule_key=p_rule AND site_name=p_site
     AND status IN ('open','l1_approved','approved','closure_requested')
   ORDER BY created_at DESC LIMIT 1;
  IF p_dry THEN RETURN CASE WHEN v_id IS NULL THEN 'would raise' ELSE 're-fire on existing' END; END IF;
  IF v_id IS NOT NULL THEN
    INSERT INTO dgr_ticket_comments (ticket_id, author_phone, author_name, author_role, comment)
    VALUES (v_id,'system','System','system','Condition fired again for '||p_date||': '||p_desc);
    RETURN 're-fired';
  END IF;
  INSERT INTO dgr_tickets (site_name, category, title, description, priority, status,
                           raised_by_phone, raised_by_name, source, rule_key, alert_date)
  VALUES (p_site, p_category, p_title, p_desc, p_priority, 'open', 'system', 'System', 'auto', p_rule, p_date);
  RETURN 'raised';
END $$;

-- Evaluate every rule for one report date. Call with p_dry=true to preview.
CREATE OR REPLACE FUNCTION run_auto_tickets(p_date date DEFAULT current_date - 1, p_dry boolean DEFAULT false)
RETURNS TABLE (rule text, site text, priority text, title text, outcome text)
LANGUAGE plpgsql AS $$
DECLARE r record; v_idx numeric;
BEGIN
  -- Specific-yield index vs fleet median for the three days ending p_date
  CREATE TEMP TABLE IF NOT EXISTS _idx ON COMMIT DROP AS
  WITH d AS (
    SELECT s.site_name, s.report_date, s.total_gen_kwh, c.dc_capacity_kw dc,
           coalesce(s.grid_outage,false) go, coalesce(s.plant_outage,false) po
      FROM dgr_submissions s JOIN site_config c USING (site_name)
     WHERE s.report_date BETWEEN p_date-2 AND p_date AND c.dc_capacity_kw>0),
  m AS (SELECT report_date, percentile_cont(0.5) WITHIN GROUP (ORDER BY total_gen_kwh/dc) med
          FROM d WHERE total_gen_kwh>0 GROUP BY 1)
  SELECT d.site_name, d.report_date, d.total_gen_kwh/d.dc/nullif(m.med,0) idx, d.go, d.po
    FROM d JOIN m USING (report_date);

  -- low_yield_3d
  FOR r IN
    SELECT site_name, round(100*avg(idx)) idx3 FROM _idx
     GROUP BY site_name
    HAVING count(*)=3 AND bool_and(idx<0.85) AND bool_and(NOT go AND NOT po)
  LOOP
    rule:='low_yield_3d'; site:=r.site_name; priority:='high';
    title:=format('Low generation 3 days running: %s (index %s)', r.site_name, r.idx3);
    outcome:=auto_raise_ticket(rule, site, title,
      format('Specific yield averaged %s%% of the fleet median over %s to %s with no outage declared. Inspect inverters and strings.', r.idx3, p_date-2, p_date),
      priority,'Alert',p_date,p_dry);
    RETURN NEXT;
  END LOOP;

  -- zero_gen
  FOR r IN SELECT site_name FROM dgr_submissions WHERE report_date=p_date
             AND coalesce(total_gen_kwh,0)=0 AND NOT coalesce(grid_outage,false) AND NOT coalesce(plant_outage,false)
  LOOP
    rule:='zero_gen'; site:=r.site_name; priority:='critical';
    title:=format('Zero generation, no outage declared: %s', r.site_name);
    outcome:=auto_raise_ticket(rule, site, title, format('Report for %s shows 0 kWh with neither grid nor plant outage flagged.', p_date), priority,'Alert',p_date,p_dry);
    RETURN NEXT;
  END LOOP;

  -- inverter_zero
  FOR r IN
    SELECT s.site_name, array_agg(g.n ORDER BY g.n) invs
      FROM dgr_submissions s, unnest(coalesce(s.inv_gen,'{}'::numeric[])) WITH ORDINALITY g(v,n)
     WHERE s.report_date=p_date AND g.v=0 AND coalesce(s.total_gen_kwh,0)>0 AND NOT coalesce(s.plant_outage,false)
     GROUP BY s.site_name
  LOOP
    rule:='inverter_zero'; site:=r.site_name; priority:='high';
    title:=format('Inverter %s at 0 kWh: %s', array_to_string(r.invs,', '), r.site_name);
    outcome:=auto_raise_ticket(rule, site, title, format('On %s inverter(s) %s reported 0 kWh while the site generated. Check inverter, DC isolator and strings.', p_date, array_to_string(r.invs,', ')), priority,'Alert',p_date,p_dry);
    RETURN NEXT;
  END LOOP;

  -- transformer_hot
  FOR r IN SELECT site_name, wti_c, oti_c FROM dgr_submissions
            WHERE report_date=p_date AND (coalesce(wti_c,0)>85 OR coalesce(oti_c,0)>85)
  LOOP
    rule:='transformer_hot'; site:=r.site_name; priority:='critical';
    title:=format('Transformer over 85°C: %s (WTI %s / OTI %s)', r.site_name, r.wti_c, r.oti_c);
    outcome:=auto_raise_ticket(rule, site, title, format('Winding %s°C, oil %s°C reported on %s. Check cooling, load and oil level.', r.wti_c, r.oti_c, p_date), priority,'Alert',p_date,p_dry);
    RETURN NEXT;
  END LOOP;

  -- site_silent_2d
  FOR r IN SELECT c.site_name FROM site_config c WHERE c.active
            AND EXISTS (SELECT 1 FROM dgr_submissions s WHERE s.site_name=c.site_name AND s.report_date BETWEEN p_date-30 AND p_date-2)
            AND NOT EXISTS (SELECT 1 FROM dgr_submissions s WHERE s.site_name=c.site_name AND s.report_date IN (p_date, p_date-1))
  LOOP
    rule:='site_silent_2d'; site:=r.site_name; priority:='high';
    title:=format('No DGR filed for 2 days: %s', r.site_name);
    outcome:=auto_raise_ticket(rule, site, title, format('No report for %s or %s.', p_date-1, p_date), priority,'Alert',p_date,p_dry);
    RETURN NEXT;
  END LOOP;

  -- no_checkin_3d
  FOR r IN
    SELECT site_name, max(submitted_by_name) eng FROM dgr_submissions
     WHERE report_date BETWEEN p_date-2 AND p_date AND checkin_status='none'
     GROUP BY site_name HAVING count(*)=3
  LOOP
    rule:='no_checkin_3d'; site:=r.site_name; priority:='medium';
    title:=format('Reports filed without site check-in, 3 days: %s', r.site_name);
    outcome:=auto_raise_ticket(rule, site, title, format('%s filed reports for %s to %s with no check-in recorded in the expense portal.', r.eng, p_date-2, p_date), priority,'Alert',p_date,p_dry);
    RETURN NEXT;
  END LOOP;

  -- chronic_grid (Mondays only, hours from recorded outage windows)
  IF extract(dow FROM p_date)=1 THEN
    FOR r IN
      SELECT s.site_name, round(sum(
        greatest(0,(split_part(o->>'to',':',1)::int*60+split_part(o->>'to',':',2)::int)
                   -(split_part(o->>'from',':',1)::int*60+split_part(o->>'from',':',2)::int)))/60.0,1) hrs
        FROM dgr_submissions s, jsonb_array_elements(coalesce(s.grid_outage_details,'[]'::jsonb)) o
       WHERE s.report_date BETWEEN p_date-6 AND p_date AND s.grid_outage
         AND (o->>'from') ~ '^\d{1,2}:\d{2}$' AND (o->>'to') ~ '^\d{1,2}:\d{2}$'
       GROUP BY s.site_name HAVING sum(greatest(0,(split_part(o->>'to',':',1)::int*60+split_part(o->>'to',':',2)::int)
                   -(split_part(o->>'from',':',1)::int*60+split_part(o->>'from',':',2)::int)))/60.0 > 15
    LOOP
      rule:='chronic_grid'; site:=r.site_name; priority:='medium';
      title:=format('Grid outage %s h in the last 7 days: %s', r.hrs, r.site_name);
      outcome:=auto_raise_ticket(rule, site, title, format('%s hours of recorded grid outage %s to %s. Escalate to DISCOM; export the claim from Insights.', r.hrs, p_date-6, p_date), priority,'Alert',p_date,p_dry);
      RETURN NEXT;
    END LOOP;
  END IF;

  -- cleaning_poor
  FOR r IN SELECT site_name, observed_by_name FROM cleaning_logs WHERE observed_on=p_date AND quality='poor'
  LOOP
    rule:='cleaning_poor'; site:=r.site_name; priority:='medium';
    title:=format('Cleaning quality logged as poor: %s', r.site_name);
    outcome:=auto_raise_ticket(rule, site, title, format('%s rated the night of %s as poor. Raise with Smart Watt; hold the block for re-clean.', r.observed_by_name, p_date), priority,'Alert',p_date,p_dry);
    RETURN NEXT;
  END LOOP;
  RETURN;
END $$;

-- Nightly at 21:30 IST (16:00 UTC): the day's reports are in by then.
SELECT cron.schedule('dgr-auto-tickets','0 16 * * *',$$SELECT run_auto_tickets(current_date - 1)$$);  -- APPLIED 2026-10-07

-- SUPERSEDED in part by 012_alerts_on_submit.sql: per-site rules now run from a
-- trigger at save time; the nightly job keeps site_silent_2d, chronic_grid and a
-- low-yield catch-up.

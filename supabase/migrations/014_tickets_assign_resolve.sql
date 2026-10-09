-- 014: tickets get an owner, alerts get their own lifecycle, closures record spend
--
-- Applied 10 Oct 2026 via Supabase MCP apply_migration.
--
-- Assignee: a ticket can be handed to an engineer, a manager, or a vendor
-- (vendors have no login, so assigned_to_phone is null and assigned_kind says
-- 'vendor'). Vendor names come from dgr_settings.ticket_vendors.
--
-- Alerts (source='auto') do not go through approval. Their statuses are
--   open -> acknowledged -> resolved
-- with an optional snoozed_until date that hides them from "awaiting me"
-- and stops the re-fire comments until it passes.
--
-- actual_cost is entered at closure request and compared with approved_amount.

ALTER TABLE dgr_tickets ADD COLUMN IF NOT EXISTS assigned_to_phone    text;
ALTER TABLE dgr_tickets ADD COLUMN IF NOT EXISTS assigned_to_name     text;
ALTER TABLE dgr_tickets ADD COLUMN IF NOT EXISTS assigned_kind        text;      -- engineer | manager | vendor
ALTER TABLE dgr_tickets ADD COLUMN IF NOT EXISTS assigned_at          timestamptz;
ALTER TABLE dgr_tickets ADD COLUMN IF NOT EXISTS assigned_by_name     text;
ALTER TABLE dgr_tickets ADD COLUMN IF NOT EXISTS acknowledged_at      timestamptz;
ALTER TABLE dgr_tickets ADD COLUMN IF NOT EXISTS acknowledged_by_name text;
ALTER TABLE dgr_tickets ADD COLUMN IF NOT EXISTS resolved_at          timestamptz;
ALTER TABLE dgr_tickets ADD COLUMN IF NOT EXISTS resolved_by_name     text;
ALTER TABLE dgr_tickets ADD COLUMN IF NOT EXISTS resolution_note      text;
ALTER TABLE dgr_tickets ADD COLUMN IF NOT EXISTS snoozed_until        date;
ALTER TABLE dgr_tickets ADD COLUMN IF NOT EXISTS actual_cost          numeric;

CREATE INDEX IF NOT EXISTS dgr_tickets_assigned ON dgr_tickets (assigned_to_phone) WHERE assigned_to_phone IS NOT NULL;

INSERT INTO dgr_settings (key, value) VALUES ('ticket_vendors', '["Smart Watt"]'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Dedup now treats an acknowledged alert as still open, and stays quiet while
-- a ticket is snoozed instead of adding a "fired again" comment every evening.
CREATE OR REPLACE FUNCTION public.auto_raise_ticket(p_rule text, p_site text, p_title text, p_desc text, p_priority text, p_category text, p_date date, p_dry boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql AS $function$
DECLARE v_id uuid; v_date date; v_snooze date;
BEGIN
  SELECT id, alert_date, snoozed_until INTO v_id, v_date, v_snooze FROM dgr_tickets
   WHERE source='auto' AND rule_key=p_rule AND site_name=p_site
     AND status IN ('open','acknowledged','l1_approved','approved','closure_requested')
   ORDER BY created_at DESC LIMIT 1;
  IF p_dry THEN RETURN CASE WHEN v_id IS NULL THEN 'would raise' ELSE 're-fire on existing' END; END IF;
  IF v_id IS NOT NULL THEN
    IF v_date = p_date OR (v_snooze IS NOT NULL AND v_snooze >= p_date)
       OR EXISTS (SELECT 1 FROM dgr_ticket_comments c WHERE c.ticket_id=v_id AND c.author_phone='system' AND c.comment LIKE 'Condition fired again for '||p_date||'%') THEN
      RETURN 'already';
    END IF;
    INSERT INTO dgr_ticket_comments (ticket_id, author_phone, author_name, author_role, comment)
    VALUES (v_id,'system','System','system','Condition fired again for '||p_date||': '||p_desc);
    RETURN 're-fired';
  END IF;
  INSERT INTO dgr_tickets (site_name, category, title, description, priority, status,
                           raised_by_phone, raised_by_name, source, rule_key, alert_date)
  VALUES (p_site, p_category, p_title, p_desc, p_priority, 'open', 'system', 'System', 'auto', p_rule, p_date);
  RETURN 'raised';
END $function$;

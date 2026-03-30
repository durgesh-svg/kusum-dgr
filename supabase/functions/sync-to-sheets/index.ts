// Supabase Edge Function: sync-to-sheets
// Fetches all approved, unsynced DGR submissions and appends them to a Google Sheet
// via a Google Apps Script Web App URL stored in app_options.
//
// Triggered by:
//   - Manual: Admin clicks "Sync Now" in admin panel
//   - Auto:   pg_cron schedule every 30 minutes (set up separately in Supabase SQL editor)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Use service_role key so we can read all rows and update synced flag
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // ── 1. Load settings from app_options ──────────────────────────────────
    const { data: opts } = await supabase
      .from('dgr_settings')
      .select('key, value')
      .in('key', ['sheets_script_url', 'sheets_sheet_id', 'sheets_tab_name']);

    const settings: Record<string, string> = {};
    (opts || []).forEach((o: { key: string; value: unknown }) => {
      // value is JSONB — unwrap strings stored as JSON strings
      const v = o.value;
      settings[o.key] = typeof v === 'string' ? v : JSON.stringify(v);
    });

    const scriptUrl  = settings['sheets_script_url']  || '';
    const sheetId    = settings['sheets_sheet_id']    || '1agcGb0nTi1u-hEOlHU1eXt30wsWyEeK_';
    const tabName    = settings['sheets_tab_name']    || 'Raw Data';

    if (!scriptUrl) {
      return new Response(
        JSON.stringify({ error: 'sheets_script_url not configured in app_options' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── 2. Fetch approved DGRs not yet synced ──────────────────────────────
    const { data: rows, error: fetchErr } = await supabase
      .from('dgr_submissions')
      .select('*')
      .eq('status', 'approved')
      .eq('synced_to_sheet', false)
      .order('report_date', { ascending: true });

    if (fetchErr) throw fetchErr;
    if (!rows || rows.length === 0) {
      // Update last sync time even if nothing to sync
      await supabase.from('dgr_settings').upsert(
        { key: 'sheets_last_sync', value: `${new Date().toISOString()}|0` },
        { onConflict: 'key' }
      );
      return new Response(
        JSON.stringify({ synced: 0, message: 'No new approved DGRs to sync' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── 3. Flatten each row into the 55-column sheet format ─────────────────
    function calcMins(o: { from?: string; to?: string }) {
      if (!o?.from || !o?.to) return 0;
      const [fh, fm] = o.from.split(':').map(Number);
      const [th, tm] = o.to.split(':').map(Number);
      return Math.max(0, (th * 60 + tm) - (fh * 60 + fm));
    }

    function flattenRow(d: Record<string, unknown>): unknown[] {
      const gridDetails = (d.grid_outage_details as { from?: string; to?: string; reason?: string }[]) || [];
      const plantDetails = (d.plant_outage_details as { from?: string; to?: string; fault_code?: string }[]) || [];
      const gridMins = gridDetails.reduce((a, o) => a + calcMins(o), 0);
      const plantMins = plantDetails.reduce((a, o) => a + calcMins(o), 0);
      const gridReasons = gridDetails.map(o => o.reason || '').filter(Boolean).join('; ');
      const plantFaults = plantDetails.map(o => o.fault_code || '').filter(Boolean).join('; ');
      const inv = (d.inv_gen as number[]) || [];
      const invCols = Array.from({ length: 20 }, (_, i) => inv[i] !== undefined ? inv[i] : '');

      return [
        d.report_date,
        d.site_name,
        d.submitted_by_name,
        d.submitted_by_phone,
        d.created_at ? new Date(d.created_at as string).toLocaleString('en-IN') : '',
        d.status,
        d.reviewed_by || '',
        d.reviewed_at ? new Date(d.reviewed_at as string).toLocaleString('en-IN') : '',
        d.review_note || '',
        d.dc_capacity_kw || '',
        d.ac_capacity_kw || '',
        d.total_gen_kwh || '',
        d.dc_cuf_pct || '',
        d.ac_cuf_pct || '',
        d.pr_pct || '',
        d.peak_radiation_wm2 || '',
        d.poa_kwh_m2 || '',
        d.peak_power_kwh || '',
        ...invCols,
        d.grid_outage ? 'Yes' : 'No', gridMins, gridReasons,
        d.plant_outage ? 'Yes' : 'No', plantMins, plantFaults,
        d.wti_c || '', d.oti_c || '', d.mog_level || '', d.silica_gel || '',
        d.modules_cleaned_today || '', d.modules_total || '',
        d.weather || '',
        d.rain ? 'Yes' : 'No',
        d.weather_avg_ambient_c || '',
        d.daily_activity || '',
        d.remarks || '',
      ];
    }

    const sheetRows = rows.map(flattenRow);

    // ── 4. POST to Google Apps Script Web App ──────────────────────────────
    const payload = { sheetId, tabName, rows: sheetRows };
    const scriptRes = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow',
    });

    const scriptBody = await scriptRes.text();
    let scriptJson: Record<string, unknown> = {};
    try { scriptJson = JSON.parse(scriptBody); } catch { scriptJson = { raw: scriptBody }; }

    if (!scriptRes.ok || scriptJson['status'] === 'error') {
      throw new Error(`Apps Script error: ${scriptBody}`);
    }

    // ── 5. Mark rows as synced ─────────────────────────────────────────────
    const ids = rows.map((r: { id: string }) => r.id);
    const { error: updateErr } = await supabase
      .from('dgr_submissions')
      .update({ synced_to_sheet: true, synced_at: new Date().toISOString() })
      .in('id', ids);

    if (updateErr) throw updateErr;

    // ── 6. Update last sync timestamp in app_options ───────────────────────
    await supabase.from('dgr_settings').upsert(
      { key: 'sheets_last_sync', value: `${new Date().toISOString()}|${rows.length}` },
      { onConflict: 'key' }
    );

    return new Response(
      JSON.stringify({ synced: rows.length, message: `${rows.length} row(s) synced to Google Sheets` }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

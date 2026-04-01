// Supabase Edge Function: fetch-suryalog
// Fetches last 5 min of SCADA data from Suryalog for ALL configured sites,
// saves raw JSON to Storage, and parses into typed DB tables.
//
// Secrets required:
//   SURYALOG_SECRET  — shared API secret
//   SURYALOG_SITES   — JSON array: [{"site_name":"Haspur","plant_key":"..."},...]
//
// Triggered by: pg_cron every 5 min, or manual POST

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const API_URL = 'https://cloud.suryalog.ae/api/get_datalog_v6.php';

interface SiteConfig { site_name: string; plant_key: string; }
interface SiteResult  { site: string; ok: boolean; skipped?: boolean; storagePath?: string; error?: string; }

Deno.serve(async () => {
  try {
    const secret    = Deno.env.get('SURYALOG_SECRET') ?? '';
    const sitesJson = Deno.env.get('SURYALOG_SITES')  ?? '[]';

    let sites: SiteConfig[] = [];
    try { sites = JSON.parse(sitesJson); } catch {
      return json({ error: 'SURYALOG_SITES is not valid JSON' }, 500);
    }
    if (!secret || sites.length === 0)
      return json({ error: 'Missing SURYALOG_SECRET or SURYALOG_SITES' }, 500);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const endTime   = Math.floor(Date.now() / 1000);
    const startTime = endTime - 300;

    const results: SiteResult[] = [];
    for (const site of sites) {
      try {
        results.push(await processSite(supabase, secret, site, startTime, endTime));
      } catch (err) {
        results.push({ site: site.site_name, ok: false, error: (err as Error).message });
      }
    }

    return json({ ok: true, sites: results });

  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});

// ── helpers ───────────────────────────────────────────────────────────────────
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function pf(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return isNaN(n) ? null : n;
}

// ── per-site processing ───────────────────────────────────────────────────────
async function processSite(
  supabase: ReturnType<typeof createClient>,
  secret: string,
  site: SiteConfig,
  startTime: number,
  endTime: number
): Promise<SiteResult> {

  // 1. Fetch from Suryalog API
  const apiRes = await fetch(API_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ secret, plant: site.plant_key, format: 'std', for: 'data', stime: startTime, etime: endTime }),
    signal:  AbortSignal.timeout(30_000),
  });
  if (!apiRes.ok) throw new Error(`HTTP ${apiRes.status}`);

  const result = await apiRes.json() as Record<string, any>;
  if (result.result !== 0) throw new Error(`API error: ${JSON.stringify(result)}`);

  // 2. Check data exists
  const dataKeys = Object.keys(result.data ?? {});
  if (dataKeys.length === 0) return { site: site.site_name, ok: true, skipped: true };

  const deviceTs        = parseInt(dataKeys[0]);
  const deviceTimestamp = new Date(deviceTs * 1000).toISOString();
  const siteData        = result.data[dataKeys[0]];

  // 3. Storage path
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const storagePath = `${site.site_name}/${now.getUTCFullYear()}/${now.getUTCMonth()+1}/${now.getUTCDate()}/${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}.json`;

  await supabase.storage.from('suryalog-data')
    .upload(storagePath, JSON.stringify(result), { contentType: 'application/json', upsert: false });

  // 4. Insert snapshot (raw)
  const { data: snap, error: snapErr } = await supabase
    .from('scada_snapshots')
    .insert({
      site_name:        site.site_name,
      plant_key:        site.plant_key,
      data_start:       new Date(startTime * 1000).toISOString(),
      data_end:         new Date(endTime   * 1000).toISOString(),
      device_timestamp: deviceTimestamp,
      raw_json:         result,
      result_code:      result.result,
      storage_path:     storagePath,
    })
    .select('id').single();

  if (snapErr) throw new Error(`Snapshot: ${snapErr.message}`);
  const snapshotId = snap.id;

  const alarmRows: any[] = [];

  // 5. Meter readings
  for (const [mType, m] of Object.entries(siteData.meter ?? {}) as [string, any][]) {
    if (!['SM','GM0'].includes(mType)) continue;
    await supabase.from('scada_meter_readings').insert({
      snapshot_id: snapshotId, site_name: site.site_name, meter_type: mType,
      device_timestamp: deviceTimestamp,
      total_power_w:      m.WT   ?? null,
      power_l1_w:         m.W1   ?? null,
      power_l2_w:         m.W2   ?? null,
      power_l3_w:         m.W3   ?? null,
      voltage_l1_v:       m.V1   ?? null,
      voltage_l2_v:       m.V2   ?? null,
      voltage_l3_v:       m.V3   ?? null,
      current_l1_a:       m.I1   ?? null,
      current_l2_a:       m.I2   ?? null,
      current_l3_a:       m.I3   ?? null,
      power_factor:       m.PFT  ?? null,
      frequency_hz:       m.FREQ ?? null,
      kwh_today:          pf(m.KWH_Day),
      kwh_yesterday:      pf(m.YEST_KWH),
      kwh_month:          pf(m.MONTH_KWH),
      kwh_year:           pf(m.YEAR_KWH),
      kwh_lifetime:       m.WHTot != null ? m.WHTot / 1000 : null,
      exported_kwh_today: pf(m.EXP_Day),
      imported_kwh_today: pf(m.IMP_Day),
      pr_today_pct:       pf(m.Day_PR),
      cuf_ac_today_pct:   pf(m.Day_CUF_AC),
      cuf_dc_today_pct:   pf(m.Day_CUF_DC),
      ac_capacity_kw:     pf(m.AC_CAP),
      dc_capacity_kw:     pf(m.DC_CAP),
      meter_status:       m.meter_status ?? 0,
      alarm1:             m.meter_alarm1 ?? 0,
      alarm2:             m.meter_alarm2 ?? 0,
      error1:             m.meter_error1 ?? 0,
      error2:             m.meter_error2 ?? 0,
    });
    for (const f of ['meter_alarm1','meter_alarm2','meter_error1','meter_error2']) {
      if (m[f]) alarmRows.push({ site_name: site.site_name, device_type: 'meter', device_id: mType,
        alarm_field: f.replace('meter_',''), alarm_value: m[f], detected_at: deviceTimestamp, first_snapshot_id: snapshotId });
    }
  }

  // 6. Inverter readings
  for (const [invId, inv] of Object.entries(siteData.inverter ?? {}) as [string, any][]) {
    await supabase.from('scada_inverter_readings').insert({
      snapshot_id: snapshotId, site_name: site.site_name, inverter_id: invId,
      device_timestamp: deviceTimestamp,
      ac_power_w:      inv.WT    ?? null,
      ac_voltage_v:    inv.VT    ?? null,
      ac_current_a:    inv.IT    ?? null,
      ac_power_l1_w:   inv.W1    ?? null,
      ac_power_l2_w:   inv.W2    ?? null,
      ac_power_l3_w:   inv.W3    ?? null,
      frequency_hz:    inv.FREQ  ?? null,
      power_factor:    inv.PFT   ?? null,
      dc_power_w:      inv.DC_W  ?? null,
      dc_voltage_v:    inv.DC_V  ?? null,
      dc_current_a:    inv.DC_I  ?? null,
      kwh_today:       inv.WHDay  != null ? inv.WHDay  / 1000 : null,
      kwh_lifetime:    inv.WHTot  != null ? inv.WHTot  / 1000 : null,
      pr_today_pct:    pf(inv.Day_PR),
      temp_internal_c: inv.TEMP_INT ?? null,
      temp_heatsink_c: inv.TEMP_HS  ?? null,
      run_hours:       inv.RUN_HOURS ?? null,
      inverter_status: inv.inverter_status ?? 0,
      alarm1:          inv.inverter_alarm1 ?? 0,
      alarm2:          inv.inverter_alarm2 ?? 0,
      error1:          inv.inverter_error1 ?? 0,
      error2:          inv.inverter_error2 ?? 0,
      ac_capacity_kw:  pf(inv.AC_CAP),
      dc_capacity_kw:  pf(inv.DC_CAP),
    });
    for (const f of ['inverter_alarm1','inverter_alarm2','inverter_error1','inverter_error2']) {
      if (inv[f]) alarmRows.push({ site_name: site.site_name, device_type: 'inverter', device_id: invId,
        alarm_field: f.replace('inverter_',''), alarm_value: inv[f], detected_at: deviceTimestamp, first_snapshot_id: snapshotId });
    }
  }

  // 7. SMB (string combiner) readings
  for (const [smbId, smb] of Object.entries(siteData.smb ?? {}) as [string, any][]) {
    const sc: Record<string, number> = {};
    for (let i = 1; i <= 32; i++) { if (smb[`I${i}`] !== undefined) sc[`I${i}`] = smb[`I${i}`]; }

    await supabase.from('scada_smb_readings').insert({
      snapshot_id: snapshotId, site_name: site.site_name, smb_id: smbId,
      device_timestamp: deviceTimestamp,
      voltage_v:       smb.V    ?? null,
      current_total_a: smb.ITOT ?? null,
      energy_wh:       smb.WTOT ?? null,
      string_currents: sc,
      temp_external_c: smb.TExt ?? null,
      temp_internal_c: smb.TInt ?? null,
      smb_status:      smb.smb_status ?? 0,
      alarm1:          smb.smb_alarm1 ?? 0,
      alarm2:          smb.smb_alarm2 ?? 0,
      error1:          smb.smb_error1 ?? 0,
      error2:          smb.smb_error2 ?? 0,
    });
    for (const f of ['smb_alarm1','smb_alarm2','smb_error1','smb_error2']) {
      if (smb[f]) alarmRows.push({ site_name: site.site_name, device_type: 'smb', device_id: smbId,
        alarm_field: f.replace('smb_',''), alarm_value: smb[f], detected_at: deviceTimestamp, first_snapshot_id: snapshotId });
    }
  }

  // 8. Weather / irradiance
  const w = siteData.weather ?? {};
  if (Object.keys(w).length > 0) {
    await supabase.from('scada_weather_readings').insert({
      snapshot_id: snapshotId, site_name: site.site_name,
      device_timestamp: deviceTimestamp,
      irradiance_wm2:   w.W2_val      ?? null,
      irradiance_ins:   pf(w.W2_INS),
      day_energy_wh_m2: w.W2_energy   ?? null,
      day_avg_wm2:      pf(w.W2_DAY_AVG),
      day_min_wm2:      pf(w.W2_DAY_MIN),
      day_max_wm2:      pf(w.W2_DAY__MAX),
      yesterday_ins:    pf(w.YESTW2_INS),
      month_irradiance: pf(w.MONTH_W2_INS),
    });
  }

  // 9. Alarms (upsert — ignore duplicate same-timestamp alarms)
  if (alarmRows.length > 0) {
    await supabase.from('scada_alarms')
      .upsert(alarmRows, { onConflict: 'site_name,device_type,device_id,alarm_field,detected_at' });
  }

  return { site: site.site_name, ok: true, storagePath };
}

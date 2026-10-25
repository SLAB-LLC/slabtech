import type { SupabaseClient } from '@supabase/supabase-js';

export interface UsageUser {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  is_active: boolean;
  company_id: string | null;
  company_name: string | null;
  company_slug: string | null;
  created_at: string;
  last_seen_ever: string | null;
}

export interface UsageDay {
  user_id: string;
  day: string; // YYYY-MM-DD in the report's timezone
  active_seconds: number;
  listening_seconds: number;
  video_seconds: number;
  web_seconds: number;
  app_seconds: number;
  visits: number;
  transcript_views: number;
  uploads: number;
  first_seen: string | null;
  last_seen: string | null;
}

export interface UsageReportData {
  timezone: string;
  start: string;
  end: string;
  users: UsageUser[];
  daily: UsageDay[];
  pages: { path: string; platform: 'web' | 'app'; seconds: number }[];
  hours: { hour: number; seconds: number }[];
}

// A day counts as "active" once the user has 2+ minutes of engaged time (same bar as streaks)
export const ACTIVE_DAY_SECONDS = 120;

export class MigrationMissingError extends Error {}

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** YYYY-MM-DD for "today" in a timezone, shifted by offsetDays */
export function isoDay(timezone: string, offsetDays = 0): string {
  const now = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (d <= last) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export async function fetchUsageReport(
  supabase: SupabaseClient,
  params: { start: string; end: string; timezone: string; companyId?: string | null; userId?: string | null }
): Promise<UsageReportData> {
  const { data, error } = await supabase.rpc('get_usage_report', {
    p_start: params.start,
    p_end: params.end,
    p_tz: params.timezone,
    p_company_id: params.companyId ?? null,
    p_user_id: params.userId ?? null,
  });
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883' || /get_usage_report/.test(error.message)) {
      throw new MigrationMissingError(error.message);
    }
    throw new Error(error.message);
  }
  return data as UsageReportData;
}

export interface UserTotals {
  user: UsageUser;
  activeSeconds: number;
  listeningSeconds: number;
  videoSeconds: number;
  webSeconds: number;
  appSeconds: number;
  visits: number;
  transcriptViews: number;
  uploads: number;
  activeDays: number;
  lastSeen: string | null;
}

export interface Totals {
  seats: number;
  activeUsers: number;
  activeSeconds: number;
  listeningSeconds: number;
  videoSeconds: number;
  webSeconds: number;
  appSeconds: number;
  visits: number;
  transcriptViews: number;
  uploads: number;
  activeUserDays: number;
  avgDailyActiveUsers: number;
}

export function totalsByUser(users: UsageUser[], daily: UsageDay[], days: Set<string>): UserTotals[] {
  const map = new Map<string, UserTotals>();
  for (const user of users) {
    map.set(user.id, {
      user, activeSeconds: 0, listeningSeconds: 0, videoSeconds: 0, webSeconds: 0, appSeconds: 0,
      visits: 0, transcriptViews: 0, uploads: 0, activeDays: 0, lastSeen: null,
    });
  }
  for (const d of daily) {
    if (!days.has(d.day)) continue;
    const t = map.get(d.user_id);
    if (!t) continue;
    t.activeSeconds += d.active_seconds;
    t.listeningSeconds += d.listening_seconds;
    t.videoSeconds += d.video_seconds ?? 0;
    t.webSeconds += d.web_seconds;
    t.appSeconds += d.app_seconds;
    t.visits += d.visits;
    t.transcriptViews += d.transcript_views;
    t.uploads += d.uploads;
    if (d.active_seconds >= ACTIVE_DAY_SECONDS) t.activeDays += 1;
    if (d.last_seen && (!t.lastSeen || d.last_seen > t.lastSeen)) t.lastSeen = d.last_seen;
  }
  return Array.from(map.values());
}

export function summarize(rows: UserTotals[], dayCount: number): Totals {
  const seats = rows.filter(r => r.user.is_active).length;
  const sum = (f: (r: UserTotals) => number) => rows.reduce((s, r) => s + f(r), 0);
  const activeUserDays = sum(r => r.activeDays);
  return {
    seats,
    activeUsers: rows.filter(r => r.activeDays > 0).length,
    activeSeconds: sum(r => r.activeSeconds),
    listeningSeconds: sum(r => r.listeningSeconds),
    videoSeconds: sum(r => r.videoSeconds),
    webSeconds: sum(r => r.webSeconds),
    appSeconds: sum(r => r.appSeconds),
    visits: sum(r => r.visits),
    transcriptViews: sum(r => r.transcriptViews),
    uploads: sum(r => r.uploads),
    activeUserDays,
    avgDailyActiveUsers: dayCount > 0 ? activeUserDays / dayCount : 0,
  };
}

export function perDay(daily: UsageDay[], dayList: string[], userIds: Set<string>) {
  const byDay = new Map(dayList.map(d => [d, { day: d, activeUsers: 0, seconds: 0, listeningSeconds: 0 }]));
  for (const d of daily) {
    const row = byDay.get(d.day);
    if (!row || !userIds.has(d.user_id)) continue;
    row.seconds += d.active_seconds;
    row.listeningSeconds += d.listening_seconds;
    if (d.active_seconds >= ACTIVE_DAY_SECONDS) row.activeUsers += 1;
  }
  return dayList.map(d => byDay.get(d)!);
}

export type Status = 'active' | 'slipping' | 'inactive' | 'never';

export function userStatus(lastSeen: string | null, now = Date.now()): Status {
  if (!lastSeen) return 'never';
  const days = (now - new Date(lastSeen).getTime()) / 86400000;
  if (days <= 3) return 'active';
  if (days <= 10) return 'slipping';
  return 'inactive';
}

export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Axis label for a minutes scale */
export function formatMinutesAxis(minutes: number): string {
  if (minutes >= 120) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes)}m`;
}

export function formatHours(seconds: number): string {
  const hours = seconds / 3600;
  return hours >= 10 ? `${Math.round(hours)}h` : `${hours.toFixed(1)}h`;
}

export function formatRelative(iso: string | null, now = Date.now()): string {
  if (!iso) return 'Never';
  const diff = now - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 2) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const escape = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob([rows.map(r => r.map(escape).join(',')).join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

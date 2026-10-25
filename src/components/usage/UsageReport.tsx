'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { BarChart, RankedBars, SplitBar } from './UsageCharts';
import {
  ACTIVE_DAY_SECONDS,
  MigrationMissingError,
  UsageReportData,
  UserTotals,
  browserTimezone,
  daysBetween,
  downloadCsv,
  fetchUsageReport,
  formatDuration,
  formatHours,
  formatMinutesAxis,
  formatRelative,
  isoDay,
  perDay,
  percentChange,
  summarize,
  totalsByUser,
  userStatus,
  Status,
} from './usageData';

const RANGES = [7, 30, 90] as const;
export type Range = (typeof RANGES)[number];

type SortKey = 'name' | 'status' | 'activeDays' | 'activeSeconds' | 'listeningSeconds' | 'avg' | 'transcriptViews' | 'lastSeen';

const STATUS_STYLES: Record<Status, { label: string; dot: string; text: string }> = {
  active: { label: 'Active', dot: 'bg-green-600', text: 'text-green-800' },
  slipping: { label: 'Slipping', dot: 'bg-amber-500', text: 'text-amber-800' },
  inactive: { label: 'Inactive', dot: 'bg-red-600', text: 'text-red-800' },
  never: { label: 'Never used', dot: 'bg-gray-400', text: 'text-gray-600' },
};

export function StatusBadge({ status }: { status: Status }) {
  const s = STATUS_STYLES[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${s.text}`}>
      <span className={`h-2 w-2 rounded-full ${s.dot}`} aria-hidden />
      {s.label}
    </span>
  );
}

export function Kpi({
  label,
  value,
  sub,
  change,
}: {
  label: string;
  value: string;
  sub?: string;
  change?: number | null;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums text-gray-900">{value}</span>
        {change !== undefined && change !== null && Math.abs(change) >= 0.5 && (
          <span className={`text-xs font-semibold ${change > 0 ? 'text-green-700' : 'text-red-700'}`}>
            {change > 0 ? '▲' : '▼'} {Math.abs(Math.round(change))}%
          </span>
        )}
      </div>
      {sub && <div className="mt-1 text-sm text-gray-500">{sub}</div>}
    </div>
  );
}

export function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {note && <span className="text-xs text-gray-500">{note}</span>}
      </div>
      {children}
    </section>
  );
}

export function RangePicker({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-gray-300 bg-white p-0.5" role="group" aria-label="Date range">
      {RANGES.map(r => (
        <button
          key={r}
          onClick={() => onChange(r)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            value === r ? 'bg-midnight-blue text-white' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          {r} days
        </button>
      ))}
    </div>
  );
}

export function MigrationNotice() {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
      <p className="font-semibold">The usage report needs a one-time database update.</p>
      <p className="mt-1">
        Run <code className="rounded bg-amber-100 px-1">sql/usage-report-migration.sql</code> in the Supabase SQL Editor,
        then reload this page.
      </p>
    </div>
  );
}

export function useUsageReport(params: {
  range: number;
  companyId?: string | null;
  userId?: string | null;
  enabled?: boolean;
}) {
  const { range, companyId, userId, enabled = true } = params;
  const [data, setData] = useState<UsageReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'migration' | string | null>(null);
  const timezone = useMemo(() => browserTimezone(), []);
  const end = isoDay(timezone);
  const start = isoDay(timezone, -(range - 1));
  // The period before, so every number can be compared with it
  const prevEnd = isoDay(timezone, -range);
  const prevStart = isoDay(timezone, -(range * 2 - 1));

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const supabase = createClient();
    // Close sessions that stopped sending heartbeats (keeps the raw sessions table tidy)
    fetch('/api/activity/session', { method: 'GET' }).catch(() => {});
    Promise.all([
      fetchUsageReport(supabase, { start, end, timezone, companyId, userId }),
      fetchUsageReport(supabase, { start: prevStart, end: prevEnd, timezone, companyId, userId }),
    ])
      .then(([cur, prev]) => !cancelled && setData({ ...cur, daily: [...prev.daily, ...cur.daily] }))
      .catch(e => !cancelled && setError(e instanceof MigrationMissingError ? 'migration' : e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [start, end, prevStart, prevEnd, timezone, companyId, userId, enabled]);

  const currentDays = useMemo(() => daysBetween(start, end), [start, end]);
  const previousDays = useMemo(() => daysBetween(prevStart, prevEnd), [prevStart, prevEnd]);

  return { data, loading, error, timezone, currentDays, previousDays };
}

export function UsageReport({
  companyId,
  showCompanies = false,
  userHref,
  exportName,
}: {
  companyId?: string | null;
  showCompanies?: boolean;
  userHref: (userId: string) => string;
  exportName: string;
}) {
  const [range, setRange] = useState<Range>(30);
  const [companyFilter, setCompanyFilter] = useState<string>('all');
  const [includeAdmins, setIncludeAdmins] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'activeSeconds', dir: -1 });

  const { data, loading, error, timezone, currentDays, previousDays } = useUsageReport({ range, companyId });

  const users = useMemo(() => {
    if (!data) return [];
    return data.users.filter(
      u => (includeAdmins || u.role !== 'super_admin') && (companyFilter === 'all' || u.company_id === companyFilter)
    );
  }, [data, includeAdmins, companyFilter]);

  const userIds = useMemo(() => new Set(users.map(u => u.id)), [users]);
  const current = useMemo(
    () => (data ? totalsByUser(users, data.daily, new Set(currentDays)) : []),
    [data, users, currentDays]
  );
  const previous = useMemo(
    () => (data ? totalsByUser(users, data.daily, new Set(previousDays)) : []),
    [data, users, previousDays]
  );
  const now = summarize(current, currentDays.length);
  const before = summarize(previous, previousDays.length);
  const days = useMemo(() => (data ? perDay(data.daily, currentDays, userIds) : []), [data, currentDays, userIds]);

  const companies = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, { id: string; name: string; rows: UserTotals[] }>();
    for (const row of current) {
      const id = row.user.company_id || 'none';
      if (!map.has(id)) map.set(id, { id, name: row.user.company_name || 'No company', rows: [] });
      map.get(id)!.rows.push(row);
    }
    return Array.from(map.values())
      .map(c => ({ ...c, totals: summarize(c.rows, currentDays.length) }))
      .sort((a, b) => b.totals.activeSeconds - a.totals.activeSeconds);
  }, [data, current, currentDays.length]);

  const companyOptions = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, string>();
    data.users.forEach(u => u.company_id && map.set(u.company_id, u.company_name || 'Unnamed'));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  const tableRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = current.filter(
      r =>
        !q ||
        r.user.email.toLowerCase().includes(q) ||
        (r.user.display_name || '').toLowerCase().includes(q) ||
        (r.user.company_name || '').toLowerCase().includes(q)
    );
    const statusRank: Record<Status, number> = { active: 3, slipping: 2, inactive: 1, never: 0 };
    const value = (r: UserTotals): number | string => {
      switch (sort.key) {
        case 'name': return (r.user.display_name || r.user.email).toLowerCase();
        case 'status': return statusRank[userStatus(r.user.last_seen_ever)];
        case 'avg': return r.activeDays ? r.activeSeconds / r.activeDays : 0;
        case 'lastSeen': return r.user.last_seen_ever || '';
        default: return r[sort.key];
      }
    };
    return [...rows].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
  }, [current, search, sort]);

  const toggleSort = (key: SortKey) =>
    setSort(s => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === 'name' ? 1 : -1 }));

  const exportCsv = () => {
    downloadCsv(`${exportName}-usage-${currentDays[0]}-to-${currentDays[currentDays.length - 1]}.csv`, [
      ['Name', 'Email', 'Company', 'Status', 'Active days', 'Engaged minutes', 'Listening minutes', 'Training video minutes',
        'Web minutes', 'App minutes', 'Visits', 'Transcripts opened', 'Uploads', 'Last seen'],
      ...tableRows.map(r => [
        r.user.display_name || '', r.user.email, r.user.company_name || '', STATUS_STYLES[userStatus(r.user.last_seen_ever)].label,
        r.activeDays, Math.round(r.activeSeconds / 60), Math.round(r.listeningSeconds / 60), Math.round(r.videoSeconds / 60),
        Math.round(r.webSeconds / 60), Math.round(r.appSeconds / 60), r.visits, r.transcriptViews, r.uploads,
        r.user.last_seen_ever || '',
      ]),
    ]);
  };

  if (error === 'migration') return <MigrationNotice />;
  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">Couldn&apos;t load usage: {error}</div>;

  const adoption = now.seats ? Math.round((now.activeUsers / now.seats) * 100) : 0;
  const perActiveUser = now.activeUsers ? now.activeSeconds / now.activeUsers : 0;
  const shortDate = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const sortArrow = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : '');
  const th = 'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500';

  return (
    <div className="space-y-6 text-gray-900">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <RangePicker value={range} onChange={setRange} />
        {showCompanies && (
          <select
            value={companyFilter}
            onChange={e => setCompanyFilter(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
            aria-label="Company"
          >
            <option value="all">All companies</option>
            {companyOptions.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        )}
        {showCompanies && (
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={includeAdmins} onChange={e => setIncludeAdmins(e.target.checked)} />
            Include SLAB admins
          </label>
        )}
        <span className="ml-auto text-xs text-gray-500">Days in {timezone.replace('_', ' ')}</span>
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-success-gold" />
        </div>
      ) : (
        <div className={`space-y-6 transition-opacity ${loading ? 'opacity-50' : ''}`}>
          {/* Headline numbers, each compared with the previous period */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              label="Active users"
              value={`${now.activeUsers}`}
              sub={`of ${now.seats} seats · ${adoption}% adoption`}
              change={percentChange(now.activeUsers, before.activeUsers)}
            />
            <Kpi
              label="Daily active (avg)"
              value={now.avgDailyActiveUsers.toFixed(1)}
              sub={`${now.activeUserDays} active user-days`}
              change={percentChange(now.avgDailyActiveUsers, before.avgDailyActiveUsers)}
            />
            <Kpi
              label="Engaged time"
              value={formatHours(now.activeSeconds)}
              sub={`${formatDuration(perActiveUser)} per active user`}
              change={percentChange(now.activeSeconds, before.activeSeconds)}
            />
            <Kpi
              label="Listening time"
              value={formatHours(now.listeningSeconds)}
              sub={now.activeSeconds ? `${Math.round((now.listeningSeconds / now.activeSeconds) * 100)}% of engaged time` : 'No activity yet'}
              change={percentChange(now.listeningSeconds, before.listeningSeconds)}
            />
          </div>

          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-200 shadow-sm sm:grid-cols-5">
            {[
              ['Transcripts opened', now.transcriptViews.toLocaleString()],
              ['Uploads', now.uploads.toLocaleString()],
              ['Visits', now.visits.toLocaleString()],
              ['Training video', formatHours(now.videoSeconds)],
              ['Web / app', now.webSeconds + now.appSeconds
                ? `${Math.round((now.webSeconds / (now.webSeconds + now.appSeconds)) * 100)}% / ${Math.round((now.appSeconds / (now.webSeconds + now.appSeconds)) * 100)}%`
                : '—'],
            ].map(([label, value]) => (
              <div key={label} className="bg-white px-4 py-3">
                <div className="text-xs text-gray-500">{label}</div>
                <div className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">{value}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="Active users per day" note={`2+ minutes counts as active`}>
              <BarChart
                ariaLabel="Active users per day"
                data={days.map(d => ({
                  key: d.day,
                  label: shortDate(d.day),
                  value: d.activeUsers,
                  tooltip: `${shortDate(d.day)}: ${d.activeUsers} active`,
                }))}
                formatValue={v => (Number.isInteger(v) ? String(v) : v.toFixed(1))}
              />
            </Panel>
            <Panel title="Engaged minutes per day" note={`${formatHours(now.activeSeconds)} total`}>
              <BarChart
                ariaLabel="Engaged minutes per day"
                data={days.map(d => ({
                  key: d.day,
                  label: shortDate(d.day),
                  value: Math.round(d.seconds / 60),
                  tooltip: `${shortDate(d.day)}: ${formatDuration(d.seconds)} (${formatDuration(d.listeningSeconds)} listening)`,
                }))}
                formatValue={formatMinutesAxis}
              />
            </Panel>
            <Panel title="When people use it" note="Engaged minutes by hour of day">
              <BarChart
                ariaLabel="Engaged minutes by hour of day"
                height={150}
                labelEvery={3}
                data={Array.from({ length: 24 }, (_, h) => {
                  const secs = data?.hours.find(x => x.hour === h)?.seconds || 0;
                  const label = h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`;
                  return { key: String(h), label, value: Math.round(secs / 60), tooltip: `${label}: ${formatDuration(secs)}` };
                })}
                formatValue={formatMinutesAxis}
              />
            </Panel>
            <Panel title="Where time goes" note="Top pages and app screens">
              <RankedBars
                rows={(data?.pages || []).slice(0, 8).map(p => ({
                  label: p.path.replace(/^\/c\/[^/]+/, '').replace(/^\/mobile\//, '') || '/',
                  value: p.seconds,
                  display: formatDuration(p.seconds),
                  tag: p.platform,
                }))}
              />
            </Panel>
          </div>

          {showCompanies && companyFilter === 'all' && companies.length > 1 && (
            <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <h2 className="border-b border-gray-200 px-5 py-4 text-sm font-semibold text-gray-900">Companies</h2>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className={th}>Company</th>
                      <th className={th}>Active / seats</th>
                      <th className={th}>Adoption</th>
                      <th className={th}>Daily active</th>
                      <th className={th}>Engaged</th>
                      <th className={th}>Per active user</th>
                      <th className={th}>Listening</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-gray-700">
                    {companies.map(c => {
                      const pct = c.totals.seats ? Math.round((c.totals.activeUsers / c.totals.seats) * 100) : 0;
                      return (
                        <tr key={c.id} className="cursor-pointer hover:bg-gray-50" onClick={() => c.id !== 'none' && setCompanyFilter(c.id)}>
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{c.name}</td>
                          <td className="px-4 py-3 text-sm tabular-nums text-gray-700">{c.totals.activeUsers} / {c.totals.seats}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-20 rounded-full bg-gray-100">
                                <div className="h-1.5 rounded-full bg-midnight-blue" style={{ width: `${Math.min(pct, 100)}%` }} />
                              </div>
                              <span className="text-sm tabular-nums text-gray-700">{pct}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm tabular-nums text-gray-700">{c.totals.avgDailyActiveUsers.toFixed(1)}</td>
                          <td className="px-4 py-3 text-sm tabular-nums text-gray-700">{formatHours(c.totals.activeSeconds)}</td>
                          <td className="px-4 py-3 text-sm tabular-nums text-gray-700">
                            {formatDuration(c.totals.activeUsers ? c.totals.activeSeconds / c.totals.activeUsers : 0)}
                          </td>
                          <td className="px-4 py-3 text-sm tabular-nums text-gray-700">{formatHours(c.totals.listeningSeconds)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 px-5 py-4">
              <h2 className="text-sm font-semibold text-gray-900">People ({tableRows.length})</h2>
              <input
                type="search"
                placeholder="Search name, email or company"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="ml-auto w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900 sm:w-64"
              />
              <button
                onClick={exportCsv}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Export CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    {([
                      ['name', 'Person'],
                      ['status', 'Status'],
                      ['activeDays', `Active days`],
                      ['activeSeconds', 'Engaged'],
                      ['listeningSeconds', 'Listening'],
                      ['avg', 'Per active day'],
                      ['transcriptViews', 'Transcripts'],
                    ] as [SortKey, string][]).map(([key, label]) => (
                      <th key={key} className={th}>
                        <button onClick={() => toggleSort(key)} className="uppercase hover:text-gray-900">
                          {label}{sortArrow(key)}
                        </button>
                      </th>
                    ))}
                    <th className={th}>Web / app</th>
                    <th className={th}>
                      <button onClick={() => toggleSort('lastSeen')} className="uppercase hover:text-gray-900">
                        Last seen{sortArrow('lastSeen')}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700">
                  {tableRows.map(r => (
                    <tr key={r.user.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link href={userHref(r.user.id)} className="group block">
                          <div className="text-sm font-medium text-gray-900 group-hover:text-success-gold">
                            {r.user.display_name || r.user.email}
                          </div>
                          <div className="text-xs text-gray-500">
                            {r.user.display_name ? r.user.email : ''}
                            {showCompanies && r.user.company_name ? `${r.user.display_name ? ' · ' : ''}${r.user.company_name}` : ''}
                          </div>
                        </Link>
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={userStatus(r.user.last_seen_ever)} /></td>
                      <td className="px-4 py-3 text-sm tabular-nums text-gray-700">
                        {r.activeDays}<span className="text-gray-400"> / {currentDays.length}</span>
                      </td>
                      <td className="px-4 py-3 text-sm font-medium tabular-nums text-gray-900">{formatDuration(r.activeSeconds)}</td>
                      <td className="px-4 py-3 text-sm tabular-nums text-gray-700">{formatDuration(r.listeningSeconds)}</td>
                      <td className="px-4 py-3 text-sm tabular-nums text-gray-700">
                        {r.activeDays ? formatDuration(r.activeSeconds / r.activeDays) : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm tabular-nums text-gray-700">{r.transcriptViews}</td>
                      <td className="px-4 py-3"><SplitBar web={r.webSeconds} app={r.appSeconds} /></td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{formatRelative(r.user.last_seen_ever)}</td>
                    </tr>
                  ))}
                  {tableRows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-10 text-center text-sm text-gray-500">No one matches.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <p className="text-xs text-gray-500">
            Engaged time counts on the website while someone has interacted in the last 2 minutes or has audio or video
            playing, and in the app while it is open on screen or playing audio. A day is active at {ACTIVE_DAY_SECONDS / 60}+
            minutes. Arrows compare with the previous {range} days.
          </p>
        </div>
      )}
    </div>
  );
}

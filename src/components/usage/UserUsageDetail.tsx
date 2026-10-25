'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { BarChart, RankedBars } from './UsageCharts';
import { Kpi, MigrationNotice, Panel, RangePicker, Range, StatusBadge, useUsageReport } from './UsageReport';
import {
  ACTIVE_DAY_SECONDS,
  formatDuration,
  formatHours,
  formatMinutesAxis,
  formatRelative,
  percentChange,
  summarize,
  totalsByUser,
  userStatus,
} from './usageData';

export function UserUsageDetail({ userId, backHref, backLabel }: { userId: string; backHref: string; backLabel: string }) {
  const [range, setRange] = useState<Range>(30);
  const { data, loading, error, timezone, currentDays, previousDays } = useUsageReport({ range, userId });

  const user = data?.users.find(u => u.id === userId) || null;
  const now = useMemo(
    () => summarize(data && user ? totalsByUser([user], data.daily, new Set(currentDays)) : [], currentDays.length),
    [data, user, currentDays]
  );
  const before = useMemo(
    () => summarize(data && user ? totalsByUser([user], data.daily, new Set(previousDays)) : [], previousDays.length),
    [data, user, previousDays]
  );
  const byDay = useMemo(() => {
    const map = new Map((data?.daily || []).filter(d => d.user_id === userId).map(d => [d.day, d]));
    return currentDays.map(day => ({ day, row: map.get(day) }));
  }, [data, userId, currentDays]);

  const shortDate = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const time = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone }) : '';

  return (
    <div className="space-y-6 text-gray-900">
      <div>
        <Link href={backHref} className="text-sm text-gray-500 hover:text-gray-900">← {backLabel}</Link>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <h1 className="text-2xl font-bold text-gray-900">{user?.display_name || user?.email || 'Usage'}</h1>
          {user && <StatusBadge status={userStatus(user.last_seen_ever)} />}
        </div>
        {user && (
          <p className="mt-1 text-sm text-gray-500">
            {user.display_name ? `${user.email} · ` : ''}
            {user.company_name ? `${user.company_name} · ` : ''}
            Last seen {formatRelative(user.last_seen_ever).toLowerCase()}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <RangePicker value={range} onChange={setRange} />
        <span className="ml-auto text-xs text-gray-500">Days in {timezone.replace('_', ' ')}</span>
      </div>

      {error === 'migration' ? (
        <MigrationNotice />
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">Couldn&apos;t load usage: {error}</div>
      ) : loading && !data ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-success-gold" />
        </div>
      ) : !user ? (
        <p className="text-sm text-gray-600">This person isn&apos;t in your usage report.</p>
      ) : (
        <div className={`space-y-6 transition-opacity ${loading ? 'opacity-50' : ''}`}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              label="Active days"
              value={`${now.activeUserDays}`}
              sub={`of ${currentDays.length} days`}
              change={percentChange(now.activeUserDays, before.activeUserDays)}
            />
            <Kpi
              label="Engaged time"
              value={formatHours(now.activeSeconds)}
              sub={now.activeUserDays ? `${formatDuration(now.activeSeconds / now.activeUserDays)} per active day` : 'No active days'}
              change={percentChange(now.activeSeconds, before.activeSeconds)}
            />
            <Kpi
              label="Listening time"
              value={formatHours(now.listeningSeconds)}
              sub={`${formatHours(now.videoSeconds)} training video`}
              change={percentChange(now.listeningSeconds, before.listeningSeconds)}
            />
            <Kpi
              label="Transcripts opened"
              value={`${now.transcriptViews}`}
              sub={`${now.uploads} uploaded · ${now.visits} visits`}
              change={percentChange(now.transcriptViews, before.transcriptViews)}
            />
          </div>

          <Panel title="Engaged minutes per day" note={`A day is active at ${ACTIVE_DAY_SECONDS / 60}+ minutes`}>
            <BarChart
              ariaLabel="Engaged minutes per day"
              data={byDay.map(({ day, row }) => ({
                key: day,
                label: new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
                value: Math.round((row?.active_seconds || 0) / 60),
                tooltip: `${shortDate(day)}: ${formatDuration(row?.active_seconds || 0)} (${formatDuration(row?.listening_seconds || 0)} listening)`,
              }))}
              formatValue={formatMinutesAxis}
            />
          </Panel>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="Where their time goes" note="Top pages and app screens">
              <RankedBars
                rows={(data?.pages || []).slice(0, 8).map(p => ({
                  label: p.path.replace(/^\/c\/[^/]+/, '').replace(/^\/mobile\//, '') || '/',
                  value: p.seconds,
                  display: formatDuration(p.seconds),
                  tag: p.platform,
                }))}
              />
            </Panel>
            <Panel title="When they practice" note="Engaged minutes by hour of day">
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
          </div>

          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <h2 className="border-b border-gray-200 px-5 py-4 text-sm font-semibold text-gray-900">Day by day</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    {['Day', 'Engaged', 'Listening', 'Training video', 'Web', 'App', 'Transcripts', 'First – last seen'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700">
                  {[...byDay].reverse().filter(d => d.row).map(({ day, row }) => (
                    <tr key={day} className={row!.active_seconds >= ACTIVE_DAY_SECONDS ? '' : 'text-gray-400'}>
                      <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">{shortDate(day)}</td>
                      <td className="px-4 py-3 text-sm tabular-nums">{formatDuration(row!.active_seconds)}</td>
                      <td className="px-4 py-3 text-sm tabular-nums">{formatDuration(row!.listening_seconds)}</td>
                      <td className="px-4 py-3 text-sm tabular-nums">{formatDuration(row!.video_seconds || 0)}</td>
                      <td className="px-4 py-3 text-sm tabular-nums">{formatDuration(row!.web_seconds)}</td>
                      <td className="px-4 py-3 text-sm tabular-nums">{formatDuration(row!.app_seconds)}</td>
                      <td className="px-4 py-3 text-sm tabular-nums">{row!.transcript_views}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                        {row!.first_seen ? `${time(row!.first_seen)} – ${time(row!.last_seen)}` : '—'}
                      </td>
                    </tr>
                  ))}
                  {!byDay.some(d => d.row) && (
                    <tr>
                      <td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-500">No activity in this range.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

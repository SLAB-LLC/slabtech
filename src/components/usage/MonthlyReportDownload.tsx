'use client';

import { useMemo, useState } from 'react';

// Owner download of the monthly engagement report (same CSV that is emailed on the 1st).
export function MonthlyReportDownload({ slug }: { slug: string }) {
  const months = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 15);
      out.push({
        value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleString('en-US', { month: 'long', year: 'numeric' }) + (i === 0 ? ' (so far)' : ''),
      });
    }
    return out;
  }, []);
  const [month, setMonth] = useState(months[1].value);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3">
      <span className="text-sm font-medium text-gray-900">Monthly report</span>
      <select
        value={month}
        onChange={e => setMonth(e.target.value)}
        className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900"
      >
        {months.map(m => (
          <option key={m.value} value={m.value}>{m.label}</option>
        ))}
      </select>
      <a
        href={`/api/company/${encodeURIComponent(slug)}/usage-report?month=${month}`}
        className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
      >
        Download CSV
      </a>
      <span className="text-xs text-gray-500">Owners also get this by email on the 1st of each month.</span>
    </div>
  );
}

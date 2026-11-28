'use client';

import { useCallback, useEffect, useState } from 'react';

interface Person {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  created_at: string;
  sign_in_nudged_at: string | null;
}

// Owners see who was given an account but never signed in, and can email them a
// "set your password + get the app" link (one person or everyone at once).
export function NeverSignedIn({ slug }: { slug: string }) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/company/${encodeURIComponent(slug)}/sign-in-nudge`)
      .then(r => (r.ok ? r.json() : { people: [] }))
      .then(d => setPeople(d.people || []))
      .catch(() => setPeople([]));
  }, [slug]);
  useEffect(load, [load]);

  async function send(ids?: string[]) {
    const key = ids ? ids[0] : 'all';
    if (!ids && !window.confirm(`Email all ${people?.length ?? 0} people a link to set their password and get the app?`)) return;
    setBusy(key);
    setNote(null);
    try {
      const res = await fetch(`/api/company/${encodeURIComponent(slug)}/sign-in-nudge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ids ? { userIds: ids } : {}),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Send failed');
      setNote(`Sent ${d.sent}.${d.skipped ? ` ${d.skipped} skipped (emailed in the last 3 days).` : ''}${d.failed ? ` ${d.failed} failed.` : ''}`);
      load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setBusy(null);
    }
  }

  if (!people || people.length === 0) return null;
  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <div className="text-sm font-semibold text-amber-900">{people.length} {people.length === 1 ? 'person has' : 'people have'} never signed in</div>
          <div className="text-xs text-amber-800">They have accounts but haven&apos;t opened SLAB. Email them a link to set their password and get the app.</div>
        </div>
        <button onClick={() => setOpen(o => !o)} className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm text-amber-900 hover:bg-amber-100">
          {open ? 'Hide list' : 'See who'}
        </button>
        <button onClick={() => send()} disabled={!!busy} className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
          {busy === 'all' ? 'Sending…' : 'Email all'}
        </button>
      </div>
      {note && <div className="mt-2 text-sm text-amber-900">{note}</div>}
      {open && (
        <ul className="mt-3 max-h-80 divide-y divide-amber-100 overflow-y-auto rounded-md border border-amber-200 bg-white">
          {people.map(p => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-gray-900">{p.display_name || p.email}</div>
                <div className="truncate text-xs text-gray-500">{p.email}{p.role === 'manager' ? ' · manager' : ''}</div>
              </div>
              {p.sign_in_nudged_at && <span className="text-xs text-gray-500">Emailed {day(p.sign_in_nudged_at)}</span>}
              <button onClick={() => send([p.id])} disabled={!!busy} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-800 hover:bg-gray-50 disabled:opacity-50">
                {busy === p.id ? '…' : 'Email'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

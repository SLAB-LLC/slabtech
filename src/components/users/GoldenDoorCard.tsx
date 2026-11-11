'use client';

import { useEffect, useState } from 'react';
import { Heading, Text } from '@/components';

/** The pixel gold door the app shows next to a winner's name */
function DoorIcon({ count }: { count: number }) {
  return (
    <span className="relative inline-block w-10 h-10 shrink-0">
      <svg viewBox="0 0 12 12" shapeRendering="crispEdges" className="w-10 h-10" aria-hidden="true">
        <rect x="2" y="0" width="8" height="12" fill="#c79a32" />
        <rect x="3" y="1" width="6" height="11" fill="#f3cf72" />
        <rect x="4" y="2" width="4" height="3" fill="#c79a32" />
        <rect x="4" y="6" width="4" height="4" fill="#c79a32" />
        <rect x="7" y="6" width="1" height="1" fill="#16161a" />
      </svg>
      {count > 1 && (
        <span className="absolute -bottom-1 -right-2 rounded bg-black px-1 text-[11px] font-bold leading-4 text-[#f3cf72]">
          ×{count}
        </span>
      )}
    </span>
  );
}

/** Admin user page: how many Golden Doors this rep has won. SLAB admins can change it. */
export function GoldenDoorCard({ userId }: { userId: string }) {
  const [count, setCount] = useState(0);
  const [saved, setSaved] = useState(0);
  const [canEdit, setCanEdit] = useState(false);
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/users/${userId}/awards`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setCount(d.goldenDoors);
        setSaved(d.goldenDoors);
        setCanEdit(!!d.canEdit);
        setReady(d.ready !== false);
      })
      .finally(() => setLoading(false));
  }, [userId]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    const r = await fetch(`/api/admin/users/${userId}/awards`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goldenDoors: count }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      setSaved(d.goldenDoors);
      setMessage('Saved. It shows in the app the next time they open it.');
    } else {
      setMessage(d.error || 'Could not save. Try again.');
    }
    setSaving(false);
  };

  if (loading) return null;
  // Owners only see it once a rep has one
  if (!canEdit && saved === 0) return null;

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mt-6">
      <div className="flex items-center gap-4">
        <DoorIcon count={count} />
        <div className="min-w-0">
          <Heading level={3} size="lg" className="text-gray-900">
            Golden Door
          </Heading>
          <Text variant="muted" size="sm" className="text-gray-600">
            Winners get the gold door badge, a shiny gold row on the leaderboard and the golden doorway behind their rep.
          </Text>
        </div>
      </div>

      {!ready ? (
        <Text size="sm" className="mt-4 text-amber-700">
          Run sql/golden-door-migration.sql in Supabase to turn this on.
        </Text>
      ) : canEdit ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-gray-700">Times won</span>
          <div className="flex items-center rounded-lg border border-gray-300">
            <button
              type="button"
              onClick={() => setCount((c) => Math.max(0, c - 1))}
              className="px-3 py-2 text-lg leading-none text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              disabled={count === 0}
              aria-label="One fewer"
            >
              −
            </button>
            <span className="w-10 text-center font-semibold tabular-nums text-gray-900">{count}</span>
            <button
              type="button"
              onClick={() => setCount((c) => Math.min(20, c + 1))}
              className="px-3 py-2 text-lg leading-none text-gray-700 hover:bg-gray-50"
              aria-label="One more"
            >
              +
            </button>
          </div>
          <button
            type="button"
            onClick={save}
            disabled={saving || count === saved}
            className="px-4 py-2 bg-success-gold text-black font-medium rounded-lg hover:bg-amber-500 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          {message && <Text size="sm" className="w-full text-gray-600">{message}</Text>}
        </div>
      ) : (
        <Text size="sm" className="mt-4 text-gray-700">
          Won {saved} time{saved === 1 ? '' : 's'}.
        </Text>
      )}
    </div>
  );
}

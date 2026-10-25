'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

interface ActivityTrackingOptions {
  heartbeatInterval?: number; // ms between heartbeats (default 30s; the usage report credits up to 30s per web heartbeat)
  inactivityThreshold?: number; // ms without input before the user counts as idle (default 2min)
  enabled?: boolean;
}

type EventType =
  | 'transcript_upload'
  | 'transcript_view'
  | 'audio_play'
  | 'audio_pause'
  | 'audio_complete'
  | 'page_view';

const SESSION_KEY = 'activity_session_id';
const SESSION_USER_KEY = 'activity_user_id';
const SESSION_LAST_KEY = 'activity_session_last';
const SESSION_IDLE_MS = 30 * 60 * 1000; // a new visit starts after 30 minutes without a heartbeat

function readStorage(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // storage unavailable (private mode); tracking still works for this page load
  }
}

/**
 * Tracks engaged time on the website.
 *
 * Every heartbeatInterval the hook sends one heartbeat when the tab is visible and the
 * user has interacted in the last inactivityThreshold, or whenever audio or video is
 * playing (even in a background tab). The server turns heartbeats into minutes, so a
 * missed heartbeat only ever undercounts.
 */
export function useActivityTracking(options: ActivityTrackingOptions = {}) {
  const {
    heartbeatInterval = 30000,
    inactivityThreshold = 120000,
    enabled = true,
  } = options;

  const pathname = usePathname();
  const [sessionId, setSessionId] = useState<string | null>(null);

  const supabaseRef = useRef(createClient());
  const sessionIdRef = useRef<string | null>(null);
  const pathnameRef = useRef(pathname);
  const lastInputRef = useRef(Date.now());
  const sessionPromiseRef = useRef<Promise<string | null> | null>(null);

  pathnameRef.current = pathname;

  const getPlayingMedia = (): 'audio' | 'video' | null => {
    const media = Array.from(document.querySelectorAll<HTMLMediaElement>('audio, video'));
    const playing = media.filter(m => !m.paused && !m.ended && m.readyState > 2);
    if (playing.some(m => m.tagName === 'AUDIO')) return 'audio';
    if (playing.some(m => m.tagName === 'VIDEO' && !m.muted)) return 'video';
    return null;
  };

  const startSession = useCallback(async (): Promise<string | null> => {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (sessionPromiseRef.current) return sessionPromiseRef.current;

    sessionPromiseRef.current = (async () => {
      try {
        const { data: { user } } = await supabaseRef.current.auth.getUser();
        if (!user) return null;

        // Reuse this tab's session if it belongs to this user and is still warm
        const storedId = readStorage(SESSION_KEY);
        const storedUser = readStorage(SESSION_USER_KEY);
        const storedLast = Number(readStorage(SESSION_LAST_KEY) || 0);
        if (storedId && storedUser === user.id && Date.now() - storedLast < SESSION_IDLE_MS) {
          sessionIdRef.current = storedId;
          setSessionId(storedId);
          return storedId;
        }

        const response = await fetch('/api/activity/session', { method: 'POST' });
        if (!response.ok) return null;
        const { sessionId: newId } = await response.json();
        sessionIdRef.current = newId;
        setSessionId(newId);
        writeStorage(SESSION_KEY, newId);
        writeStorage(SESSION_USER_KEY, user.id);
        writeStorage(SESSION_LAST_KEY, String(Date.now()));
        return newId;
      } catch (error) {
        console.warn('Activity session start failed:', error);
        return null;
      } finally {
        sessionPromiseRef.current = null;
      }
    })();

    return sessionPromiseRef.current;
  }, []);

  const endSession = useCallback(async () => {
    const id = sessionIdRef.current || readStorage(SESSION_KEY);
    sessionIdRef.current = null;
    setSessionId(null);
    writeStorage(SESSION_KEY, null);
    writeStorage(SESSION_USER_KEY, null);
    writeStorage(SESSION_LAST_KEY, null);
    if (!id) return;
    try {
      await fetch('/api/activity/session', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: id }),
      });
    } catch {
      // the server closes idle sessions on its own
    }
  }, []);

  const sendHeartbeat = useCallback(async (activityType: string) => {
    // A tab left idle for 30+ minutes starts a fresh session
    const last = Number(readStorage(SESSION_LAST_KEY) || 0);
    if (sessionIdRef.current && last && Date.now() - last > SESSION_IDLE_MS) {
      sessionIdRef.current = null;
    }
    const id = await startSession();
    if (!id) return;

    try {
      const response = await fetch('/api/activity/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: id,
          pagePath: pathnameRef.current,
          activityType,
          metadata: { platform: 'web' },
        }),
        keepalive: true,
      });
      if (response.ok) writeStorage(SESSION_LAST_KEY, String(Date.now()));
    } catch {
      // offline or navigating away; the next heartbeat picks up
    }
  }, [startSession]);

  const trackEvent = useCallback(async (eventType: EventType, eventData: Record<string, unknown> = {}) => {
    if (!enabled) return;
    try {
      await fetch('/api/activity/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionIdRef.current, eventType, eventData }),
      });
    } catch {
      // non-critical
    }
  }, [enabled]);

  // Start (or resume) the session
  useEffect(() => {
    if (!enabled) return;
    startSession();
  }, [enabled, startSession]);

  // Record input so we know the user is present
  useEffect(() => {
    if (!enabled) return;
    const markActive = () => {
      lastInputRef.current = Date.now();
    };
    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'wheel'];
    events.forEach(e => window.addEventListener(e, markActive, { passive: true }));
    document.addEventListener('visibilitychange', markActive);
    return () => {
      events.forEach(e => window.removeEventListener(e, markActive));
      document.removeEventListener('visibilitychange', markActive);
    };
  }, [enabled]);

  // One steady heartbeat timer for the life of the layout (navigation doesn't reset it)
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      const media = getPlayingMedia();
      if (media === 'audio') {
        sendHeartbeat('audio_playing');
      } else if (media === 'video') {
        sendHeartbeat('video_playing');
      } else if (
        document.visibilityState === 'visible' &&
        Date.now() - lastInputRef.current < inactivityThreshold
      ) {
        sendHeartbeat('page_active');
      }
    }, heartbeatInterval);
    return () => clearInterval(timer);
  }, [enabled, heartbeatInterval, inactivityThreshold, sendHeartbeat]);

  // Page views (transcript pages count as transcript views in the usage report)
  useEffect(() => {
    if (!enabled || !sessionId) return;
    trackEvent('page_view', { path: pathname });
  }, [enabled, sessionId, pathname, trackEvent]);

  // Audio events, captured at the document so dynamically added players are covered
  useEffect(() => {
    if (!enabled) return;
    const onMedia = (e: Event) => {
      const el = e.target;
      if (!(el instanceof HTMLAudioElement)) return;
      lastInputRef.current = Date.now();
      const type: EventType = e.type === 'play' ? 'audio_play' : e.type === 'ended' ? 'audio_complete' : 'audio_pause';
      trackEvent(type, {
        path: pathnameRef.current,
        currentTime: Math.round(el.currentTime),
        duration: Number.isFinite(el.duration) ? Math.round(el.duration) : null,
      });
    };
    document.addEventListener('play', onMedia, true);
    document.addEventListener('pause', onMedia, true);
    document.addEventListener('ended', onMedia, true);
    return () => {
      document.removeEventListener('play', onMedia, true);
      document.removeEventListener('pause', onMedia, true);
      document.removeEventListener('ended', onMedia, true);
    };
  }, [enabled, trackEvent]);

  // End the session on sign-out
  useEffect(() => {
    if (!enabled) return;
    const { data: { subscription } } = supabaseRef.current.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') endSession();
    });
    return () => subscription.unsubscribe();
  }, [enabled, endSession]);

  return { sessionId, trackEvent, sendHeartbeat };
}

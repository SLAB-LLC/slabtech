'use client';

/**
 * SLAB marketing home page (v2 design).
 *
 * Structure and styling come from the static v5 design; everything that was a
 * TODO in that file is wired here:
 *   - the apply form posts to /api/purchase-inquiry
 *   - the tape rows drive a real <audio> element (see TAPES below)
 *   - header links reach the actual app (rep login / admin login)
 *
 * GSAP choreography is optional — if it fails to load or the visitor prefers
 * reduced motion, the page renders fully and just doesn't animate.
 */

import { Fragment, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import '@/app/home-v2.css';

/**
 * The tape list. Drop an mp3/m4a into /public/v2/tapes and point `src` at it —
 * the row becomes playable automatically. Leave `src` empty and the row stays
 * in the list as a locked preview.
 *
 * `seconds` is the run time shown before the file loads. The real duration is
 * read off the audio once metadata arrives and replaces this, so a stale value
 * self-corrects — but printing it up front means the list never sits on a
 * placeholder if the browser is slow to fetch metadata (or declines to, which
 * it does for background tabs and on some mobile data savers).
 */
const TAPES = [
  { id: 'intro', title: 'THE INTRO', blurb: 'the first six seconds at the door', src: '/v2/tapes/intro.mp3', seconds: 19.7 },
  { id: 'switchover', title: 'THE SWITCHOVER', blurb: 'turning "we already have a guy" into a yes', src: '/v2/tapes/switchover.mp3', seconds: 58.9 },
  { id: 'value', title: 'BUILDING VALUE', blurb: 'making the price feel obvious before you say it', src: '/v2/tapes/building-value.mp3', seconds: 88.1 },
  { id: 'close', title: 'THE CLOSE', blurb: 'asking for it like you mean it', src: '/v2/tapes/close.mp3', seconds: 25.8 },
];

/** Run times to show immediately, before any metadata comes back. */
const INITIAL_DURATIONS: Record<string, number> = Object.fromEntries(
  TAPES.filter((t) => t.src && t.seconds).map((t) => [t.id, t.seconds]),
);

const SPECIMENS = [
  { src: '/v2/poster-doberman.jpg', alt: 'SLAB doberman poster', name: 'HOLD THE LINE' },
  { src: '/v2/poster-skeleton-yellow.jpg', alt: 'SLAB halftone skeleton poster', name: 'DEAD TRAINING' },
  { src: '/v2/poster-hand-fire.jpg', alt: 'SLAB burning logo above open hand', name: 'THE OFFER' },
  { src: '/v2/poster-fire-ring.jpg', alt: 'SLAB badge ringed in fire', name: 'FORGED' },
  { src: '/v2/poster-gasmask.jpg', alt: 'SLAB gas mask halftone poster', name: 'DOOR IN SIGHT' },
  { src: '/v2/poster-field-fire.jpg', alt: 'SLAB logo over burning field', name: 'FIELD WORK' },
  { src: '/v2/poster-vhs.jpg', alt: 'SLAB VHS glow logo', name: 'THE TAPES' },
  { src: '/v2/poster-skeleton-rays.jpg', alt: 'SLAB skeleton hand poster', name: 'REACH' },
  { src: '/v2/poster-cowboy.jpg', alt: 'SLAB western poster', name: 'OUT WEST' },
  { src: '/v2/poster-viper.jpg', alt: 'SLAB logo over a red sports car above the city', name: 'NIGHT SHIFT' },
  { src: '/v2/poster-bliss.jpg', alt: 'SLAB badge on a green hill under a blue sky', name: 'START UP' },
  { src: '/v2/poster-cliff-dive.jpg', alt: 'SLAB logo over a cliff diver above turquoise water', name: 'SEND IT' },
  { src: '/v2/poster-pixel-hands.jpg', alt: 'Pixelated reaching hands above the SLAB wordmark', name: 'CREATION' },
  { src: '/v2/poster-red-hero.jpg', alt: 'Red neon SLAB badge above a figure on a mountain peak', name: 'THE SUMMIT' },
];

const fmt = (s: number) =>
  Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '—:—';

type Role = 'rep' | 'owner' | 'other';

/**
 * The doors SLAB trains for. The opener, the objection and the close are the
 * same muscle whatever's on the clipboard — each card names the moment that
 * makes or breaks a deal in that vertical. The same list drives the apply
 * form's industry picker (`label` is what gets saved on the lead, matching the
 * store form's values), so add a vertical here and it shows up in both.
 */
const INDUSTRIES = [
  { label: 'Pest', tag: '// THE SWITCHOVER', line: '"We already have a guy." Flip it before the screen door shuts.' },
  { label: 'Roofing', tag: '// THE INSPECTION', line: 'Earn the ladder. Get on the roof, then get the signature.' },
  { label: 'Solar', tag: '// THE BILL', line: 'Get the utility bill out of the drawer and onto the table.' },
  { label: 'Fiber', tag: '// THE SWITCH', line: '"My internet\'s fine." Make them feel the lag they stopped noticing.' },
];
const INDUSTRY_OPTIONS = [...INDUSTRIES.map((i) => i.label), 'Other'];

export default function HomeV2() {
  const rootRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const recordRef = useRef<HTMLDivElement>(null);
  const waveRef = useRef<HTMLDivElement>(null);
  const introRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  // ---- tape playback ------------------------------------------------------
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [durations, setDurations] = useState<Record<string, number>>(INITIAL_DURATIONS);

  // ---- apply form ---------------------------------------------------------
  const [role, setRole] = useState<Role>('rep');
  const [industry, setIndustry] = useState('Pest');
  /** Marshall vs. the chatbot: 0 = the record, 1 = the robot. */
  const [vsSlide, setVsSlide] = useState(0);
  const vsRef = useRef<HTMLDivElement>(null);
  const goToSlide = (i: number) => {
    const track = vsRef.current;
    if (track) track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' });
  };
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  /* The v2 palette is a full-bleed black page; tag html/body so the scroll
     chrome matches and the app's default light styling doesn't show through. */
  useEffect(() => {
    document.documentElement.classList.add('slab-v2-html');
    document.body.classList.add('slab-v2-body');
    return () => {
      document.documentElement.classList.remove('slab-v2-html');
      document.body.classList.remove('slab-v2-body');
    };
  }, []);

  /* Read each tape's real run time off the file so the list never lies. */
  useEffect(() => {
    TAPES.filter((t) => t.src).forEach((t) => {
      const probe = new Audio();
      probe.preload = 'metadata';
      probe.src = t.src;
      probe.addEventListener('loadedmetadata', () => {
        setDurations((d) => ({ ...d, [t.id]: probe.duration }));
      });
    });
  }, []);

  /* Sticky header goes solid once you leave the hero. */
  useEffect(() => {
    const onScroll = () => {
      headerRef.current?.classList.toggle('solid', window.scrollY > window.innerHeight * 0.75);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /* Waveform bars — random heights, built once on the client. */
  useEffect(() => {
    const wave = waveRef.current;
    if (!wave || wave.childElementCount) return;
    for (let i = 0; i < 46; i++) {
      const b = document.createElement('i');
      b.style.setProperty('--hi', 20 + Math.random() * 80 + '%');
      b.style.setProperty('--lo', 6 + Math.random() * 14 + '%');
      b.style.animationDelay = Math.random() * 1.1 + 's';
      wave.appendChild(b);
    }
  }, []);

  /* The wall: drifts sideways on its own in an endless loop. Grab it (mouse or
     touch) to fling through it; let go and it coasts back into the drift.
     Vertical page scroll is never hijacked — touch-action: pan-y hands
     vertical swipes to the browser. Reduced motion gets a plain swipe strip. */
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      rail.classList.add('no-pin');
      return;
    }

    const DRIFT = -45; // px/s, leftward
    let x = 0;
    let v = DRIFT;
    let loop = 0;
    let raf = 0;
    let last = 0;
    let onScreen = true;

    let pid: number | null = null;
    let dragged = false;
    let startX = 0;
    let startPos = 0;
    let lastX = 0;
    let lastT = 0;
    let flingV = 0;

    // Width of one full set of pieces; the second (aria-hidden) set starts here.
    const measure = () => {
      const first = rail.firstElementChild as HTMLElement | null;
      const dupe = rail.querySelector<HTMLElement>('[data-loop-start]');
      loop = first && dupe ? dupe.offsetLeft - first.offsetLeft : 0;
    };
    // Keep x inside (-loop, 0] so the two copies always cover the viewport.
    const wrap = () => {
      if (loop <= 0) return 0;
      const before = x;
      x = ((x % loop) - loop) % loop;
      return x - before;
    };
    const paint = () => { rail.style.transform = `translate3d(${x}px,0,0)`; };

    const tick = (t: number) => {
      const dt = last ? Math.min(0.05, (t - last) / 1000) : 0;
      last = t;
      if (pid === null) {
        v += (DRIFT - v) * (1 - Math.exp(-dt * 2.5)); // fling decays back into the drift
        x += v * dt;
        wrap();
        paint();
      }
      raf = onScreen && !document.hidden ? requestAnimationFrame(tick) : 0;
    };
    const start = () => {
      if (!raf && onScreen && !document.hidden) { last = 0; raf = requestAnimationFrame(tick); }
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pid = e.pointerId;
      dragged = false;
      startX = lastX = e.clientX;
      startPos = x;
      lastT = performance.now();
      flingV = 0;
      rail.classList.add('grabbing');
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      const dx = e.clientX - startX;
      if (!dragged && Math.abs(dx) > 4) {
        dragged = true;
        rail.setPointerCapture(e.pointerId);
      }
      if (!dragged) return;
      x = startPos + dx;
      startPos += wrap();
      paint();
      const now = performance.now();
      const dt = (now - lastT) / 1000;
      if (dt > 0) flingV = 0.8 * ((e.clientX - lastX) / dt) + 0.2 * flingV;
      lastX = e.clientX;
      lastT = now;
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      pid = null;
      rail.classList.remove('grabbing');
      // a finger that stopped before lifting shouldn't fling
      const idle = performance.now() - lastT > 90;
      v = dragged && !idle ? Math.max(-3000, Math.min(3000, flingV)) : DRIFT;
    };

    measure();
    paint();
    start();

    const ro = new ResizeObserver(() => { measure(); wrap(); paint(); });
    ro.observe(rail);
    // Watch the section, not the rail: the rail's own box slides off screen
    // as it translates, which would read as "not visible" and stall the drift.
    const io = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      start();
    });
    io.observe(rail.parentElement ?? rail);
    const onVis = () => start();
    document.addEventListener('visibilitychange', onVis);

    rail.addEventListener('pointerdown', onDown);
    rail.addEventListener('pointermove', onMove);
    rail.addEventListener('pointerup', onUp);
    rail.addEventListener('pointercancel', onUp);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      rail.removeEventListener('pointerdown', onDown);
      rail.removeEventListener('pointermove', onMove);
      rail.removeEventListener('pointerup', onUp);
      rail.removeEventListener('pointercancel', onUp);
    };
  }, []);

  /* GSAP choreography. Loaded dynamically so a failure here can never take the
     page down with it — reveals are un-clipped and the page stays static. */
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const root = rootRef.current;
    if (!root) return;

    const showEverything = () => {
      root.querySelectorAll<HTMLElement>('.reveal').forEach((el) => (el.style.clipPath = 'none'));
      introRef.current?.remove();
    };

    if (reduce) {
      showEverything();
      return;
    }

    /* Hard failsafe: the intro is a full-screen overlay, so it must never be
       able to trap the page — if the wipe hasn't run in 4s, drop it. */
    const introKill = window.setTimeout(() => introRef.current?.remove(), 4000);

    let cleanup = () => {};
    let cancelled = false;

    (async () => {
      let gsap: typeof import('gsap').gsap;
      let ScrollTrigger: typeof import('gsap/ScrollTrigger').ScrollTrigger;
      try {
        gsap = (await import('gsap')).gsap;
        ScrollTrigger = (await import('gsap/ScrollTrigger')).ScrollTrigger;
      } catch {
        showEverything();
        return;
      }
      if (cancelled) return;

      gsap.registerPlugin(ScrollTrigger);
      const ctx = gsap.context(() => {
        // intro: flicker then hard wipe
        const intro = introRef.current;
        if (intro) {
          const tl = gsap.timeline({ onComplete: () => intro.remove() });
          tl.fromTo('#intro img', { opacity: 0 }, { opacity: 1, duration: 0.06, repeat: 5, yoyo: true, ease: 'none' })
            .to('#intro img', { opacity: 1, duration: 0.35 })
            .fromTo('#intro .tag', { opacity: 0 }, { opacity: 1, duration: 0.2 }, '<')
            .to('#intro', { yPercent: -100, duration: 0.55, ease: 'power4.inOut', delay: 0.35 });
        }
        // hero rows snap up after the intro
        gsap.from('.hero h1 .row span', { yPercent: 110, duration: 0.6, ease: 'power4.out', stagger: 0.08, delay: 1.35 });
        gsap.from('.specter', { opacity: 0, scale: 1.06, duration: 1.4, ease: 'power2.out', delay: 1.15 });

        // headline reveals: hard clip wipes
        gsap.utils.toArray<HTMLElement>('.reveal').forEach((el) => {
          gsap.to(el, {
            clipPath: 'inset(0 0 0% 0)', duration: 0.6, ease: 'power4.inOut',
            scrollTrigger: { trigger: el, start: 'top 82%' },
          });
        });
        // the two circles slide in from either side and lock together, then SLAB lands in the overlap
        const vennTl = gsap.timeline({ scrollTrigger: { trigger: '.venn', start: 'top 75%' } });
        vennTl
          .from('.venn-circle.owners', { xPercent: -30, opacity: 0, duration: 0.7, ease: 'power3.out' })
          .from('.venn-circle.reps', { xPercent: 30, opacity: 0, duration: 0.7, ease: 'power3.out' }, '<')
          .from('.venn-core', { scale: 0.4, opacity: 0, duration: 0.5, ease: 'back.out(2.2)' }, '-=0.15');
        gsap.from('.track', {
          x: -24, opacity: 0, duration: 0.35, ease: 'power3.out', stagger: 0.07,
          scrollTrigger: { trigger: '.tracklist', start: 'top 80%' },
        });
        gsap.from('.sys-cell', {
          y: 40, opacity: 0, duration: 0.45, ease: 'power3.out', stagger: 0.1,
          scrollTrigger: { trigger: '.sys-grid', start: 'top 80%' },
        });

        // the record: hard odometer roll into 1,730
        const rf = recordRef.current;
        if (rf) {
          ScrollTrigger.create({
            trigger: rf, start: 'top 85%', once: true,
            onEnter: () => {
              const o = { v: 0 };
              gsap.to(o, {
                v: 1730, duration: 1.4, ease: 'power3.out',
                onUpdate: () => { rf.textContent = Math.round(o.v).toLocaleString(); },
              });
            },
          });
        }
      }, root);

      cleanup = () => ctx.revert();
    })();

    return () => { cancelled = true; clearTimeout(introKill); cleanup(); };
  }, []);

  /**
   * Which row the audio element is currently committed to. The <audio> events
   * are the source of truth for the highlight — switching src on a playing
   * element fires its own 'pause', so deriving state from a play() promise
   * instead would race with that and could leave audio playing with no row lit.
   * This also keeps the UI honest when playback is driven from outside the page
   * (OS media keys, the headphone button, a notification-shade control).
   */
  const pendingIdRef = useRef<string | null>(null);

  const toggleTape = (id: string, src: string) => {
    const audio = audioRef.current;
    if (!src || !audio) {
      // No file wired up yet — flash the row so the UI still reads as alive.
      setPlayingId((p) => (p === id ? null : id));
      return;
    }
    if (playingId === id) {
      audio.pause(); // 'pause' clears the highlight
      return;
    }
    pendingIdRef.current = id;
    setProgress(0);
    // A fresh src already starts at zero — setting currentTime before metadata
    // has arrived is what throws InvalidStateError on some browsers.
    audio.src = src;
    audio.play().catch(() => {
      // autoplay refused, decode failed, file missing — don't light the row
      if (pendingIdRef.current === id) {
        pendingIdRef.current = null;
        setPlayingId(null);
      }
    });
  };

  const handleApply = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);
    setSending(true);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch('/api/purchase-inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // purchase_inquiries only accepts these three product types; an owner
          // is a company lead, everyone else is an individual lead.
          productType: role === 'owner' ? 'company' : 'individual',
          name: fd.get('name'),
          email: fd.get('email'),
          phone: fd.get('phone'),
          industry,
          message: fd.get('message'),
          customData: {
            source: 'home-apply',
            role,
            company: fd.get('company') || null,
          },
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setSent(true);
    } catch {
      setFormError('send-failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="slab-v2" ref={rootRef}>
      <div className="grain" aria-hidden="true" />

      <div id="intro" aria-hidden="true" ref={introRef}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/v2/logo-dark.png" alt="" />
        <div className="tag">SALES LAB</div>
      </div>

      <header className="site-head" ref={headerRef}>
        <a href="#top">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="mark" src="/v2/logo-dark.png" alt="SLAB" />
        </a>
        <nav>
          <a href="#theory">THE THEORY</a>
          <a href="#doors">EVERY DOOR</a>
          <a href="#tapes">THE SOURCE MATERIAL</a>
          <a href="#system">THE SYSTEM</a>
          <a href="#work">THE WALL</a>
        </nav>
        <div className="head-right">
          <Link className="login-link" href="/user/login">LOG IN</Link>
          <a className="apply-pill" href="#knock">APPLY</a>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="specter" aria-hidden="true">
            <span className="hum" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/v2/specter.png" alt="" />
          </div>
          <div className="hero-scrim" aria-hidden="true" />
          <div className="hero-text">
            <h1>
              <span className="row"><span>Training</span></span>
              <span className="row"><span>D2D reps</span></span>
              <span className="row"><span className="actually">actually</span></span>
              <span className="row"><span>wanna use.</span></span>
            </h1>
            <p className="hero-sub">
              <b>SLAB</b> (or <b>Sales Lab</b>) is a <b>gamified training lab</b> for door-to-door
              sales teams in <b>pest, roofing, solar and fiber</b>. No binders. No dead PowerPoints. Built in the field,{' '}
              <b>trained off the best of the best.</b>
            </p>
            <div className="hero-ctas">
              <a href="#knock" className="btn primary">[ APPLY TO JOIN ]</a>
              <a href="#theory" className="btn ghost">[ THE THEORY ]</a>
            </div>
          </div>
        </section>

        <div className="ticker" aria-hidden="true">
          <div className="ticker-inner">
            REAL AUDIO &nbsp;★&nbsp; REAL DOORS &nbsp;★&nbsp; REAL CLOSES &nbsp;★&nbsp; PEST &nbsp;★&nbsp; ROOFING &nbsp;★&nbsp; SOLAR &nbsp;★&nbsp; FIBER &nbsp;★&nbsp; NO BABYSITTING &nbsp;★&nbsp; TRAINED OFF THE BEST &nbsp;★&nbsp;
            REAL AUDIO &nbsp;★&nbsp; REAL DOORS &nbsp;★&nbsp; REAL CLOSES &nbsp;★&nbsp; PEST &nbsp;★&nbsp; ROOFING &nbsp;★&nbsp; SOLAR &nbsp;★&nbsp; FIBER &nbsp;★&nbsp; NO BABYSITTING &nbsp;★&nbsp; TRAINED OFF THE BEST &nbsp;★&nbsp;
          </div>
        </div>

        <section className="theory pad" id="theory">
          <span className="kicker">THE THEORY</span>
          <h2 className="h2 reveal">Every team has the same disease.</h2>
          <p className="theory-punch">
            Training that&apos;s <b>weak</b> — or training <b>nobody touches</b> unless a manager is
            standing over their shoulder. SLAB was built on one observation:
          </p>
          <div className="venn">
            <div className="venn-circle owners">
              <div className="venn-copy">
                <h3>Owners want <em>a system.</em></h3>
                <div className="who">{'// STRUCTURE. VISIBILITY.'}</div>
                <ul>
                  <li>A pattern every rookie follows</li>
                  <li>The pitch, the objections, the close</li>
                  <li>Proof of who&apos;s actually training</li>
                  <li>Ramp that doesn&apos;t need one good trainer</li>
                </ul>
              </div>
            </div>
            <div className="venn-circle reps">
              <div className="venn-copy">
                <h3>Reps want <em>the sauce.</em></h3>
                <div className="who">{'// RAW. FAST. FROM THE FIELD.'}</div>
                <ul>
                  <li>Pure audio from real doorsteps</li>
                  <li>What the killers say, word for word</li>
                  <li>A game, not a homework packet</li>
                  <li>Worth opening between doors</li>
                </ul>
              </div>
            </div>
            <div className="venn-core">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/v2/logo-dark.png" alt="SLAB" />
              <span>THE ANSWER</span>
            </div>
          </div>
          <p className="theory-punch" style={{ marginTop: 48 }}>
            SLAB gives both sides what they want in one machine. <b>That&apos;s the whole trick.</b>
          </p>
        </section>

        <section className="doors pad" id="doors">
          <div className="doors-top">
            <figure className="door-shot" aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/v2/door-knock.jpg" alt="" />
            </figure>
            <div className="doors-copy">
              <span className="kicker">EVERY DOOR</span>
              <h2 className="h2 reveal">Built for <em>every industry.</em></h2>
              <p className="doors-sub">
                Bugs, shingles, panels or a fiber line — the homeowner still opens the door the same
                way. SLAB trains the part that travels: <b>the opener, the objection, the close.</b>
              </p>
            </div>
          </div>
          <div className="doors-grid">
            {INDUSTRIES.map((ind) => (
              <div className="door-card" key={ind.label}>
                <h3>{ind.label}</h3>
                <div className="who">{ind.tag}</div>
                <p>{ind.line}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="tapes pad" id="tapes">
          <span className="kicker">THE SOURCE MATERIAL</span>
          <div className="vs-bar" role="tablist" aria-label="Who trains your reps">
            {['US', 'OUR COMPETITORS'].map((label, i) => (
              <Fragment key={label}>
                {i === 1 && <span className="vs-badge" aria-hidden="true">VS</span>}
                <button
                  type="button" role="tab" aria-selected={vsSlide === i}
                  className={`vs-btn${i === 1 ? ' them' : ''}${vsSlide === i ? ' on' : ''}`}
                  onClick={() => goToSlide(i)}
                >
                  <span className="vs-label">{label}</span>
                  {vsSlide !== i && (
                    <span className="vs-cta" aria-hidden="true">{i === 1 ? 'SEE THEM →' : '← BACK TO US'}</span>
                  )}
                </button>
              </Fragment>
            ))}
          </div>
          <div
            className="vs-track"
            ref={vsRef}
            onScroll={(e) => {
              const t = e.currentTarget;
              setVsSlide(Math.round(t.scrollLeft / Math.max(t.clientWidth, 1)));
            }}
          >
          <div className="vs-slide" aria-hidden={vsSlide !== 0 || undefined}>
          <div className="tapes-grid">
            <figure className="mug">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/v2/marshall.jpg" alt="Marshall Hawkes" />
              <figcaption>MARSHALL HAWKES · THE RECORD</figcaption>
            </figure>
            <div className="tapes-right">
              <div className="tapes-copy">
                <h2 className="h2 reveal">We mic&apos;d up <em>Marshall Hawkes.</em></h2>
                <p className="tapes-sub">
                  Instead of some soulless AI chatbot or semi-decent salesman, we wanted{' '}
                  <b>the cream of the crop</b>. So we took <b>the previous record holder</b>, wired
                  him up, and recorded every opener, every objection, every close to get the best
                  possible training and models. The product changes from door to door.{' '}
                  <b>The pattern doesn&apos;t.</b>
                </p>
                <div className="wave" aria-hidden="true" ref={waveRef} />
                <span className="stamp">RAW. UNCUT. FROM THE DOORSTEP.</span>
              </div>
              <div className="record-stack">
                <div className="figure" ref={recordRef}>1,730</div>
                <div className="rlabel">Accounts sold in a single summer</div>
                <div className="rmeta">$1,523,680 · 2024 · <b>THE RECORD</b></div>
              </div>
            </div>
          </div>
          </div>

          <div className="vs-slide vs-bot" aria-hidden={vsSlide !== 1 || undefined}>
          <div className="tapes-grid">
            <figure className="mug">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/v2/chatbot.jpg" alt="ChatBot 3000, a humanoid robot with crossed arms on a parody of Marshall's poster: $0.00, 0 accounts" />
              <figcaption>CHATBOT 3000 · THE INDUSTRY STANDARD</figcaption>
            </figure>
            <div className="tapes-right">
              <div className="tapes-copy">
                <h2 className="h2">Or we could&apos;ve used <em>a robot.</em></h2>
                <p className="tapes-sub">
                  That&apos;s what a lot of training companies hand your reps: <b>an AI chatbot that
                  has never knocked a door.</b> Never heard a dog lose it behind the screen. Never
                  watched a homeowner reach for the handle. It roleplays a script it found on the
                  internet and calls it training. <b>You can&apos;t learn the sauce from something
                  that&apos;s never tasted it.</b>
                </p>
                <div className="flatline" aria-hidden="true"><i /></div>
                <span className="stamp">TRAINED ON NOTHING. SOLD NOTHING.</span>
              </div>
              <div className="record-stack">
                <div className="figure">ZERO</div>
                <div className="rlabel">Accounts sold. Ever.</div>
                <div className="rmeta">$0.00 · NEVER · <b>THE CHATBOT</b></div>
              </div>
            </div>
          </div>
          </div>
          </div>

          <div className="tracks-head">
            <h3>The tapes</h3>
            <span>{'// PRESS PLAY'}</span>
          </div>
          <div className="tracks-row">
            <div className="record-rail" aria-hidden="true">
              <b>1,730</b>&nbsp;ACCOUNTS&nbsp;·&nbsp;ONE&nbsp;SUMMER
            </div>
            <div className="tracklist">
              {TAPES.map((tape) => {
                const isPlaying = playingId === tape.id;
                return (
                  <div
                    key={tape.id}
                    className={`track${isPlaying ? ' is-playing' : ''}${tape.src ? '' : ' is-locked'}`}
                  >
                    <button
                      className="play"
                      onClick={() => toggleTape(tape.id, tape.src)}
                      aria-label={`${isPlaying ? 'Pause' : 'Play'}: ${tape.title}`}
                    >
                      <svg className="ico-play" viewBox="0 0 16 16"><path d="M3 1.5v13l11-6.5z" /></svg>
                      <svg className="ico-pause" viewBox="0 0 16 16"><path d="M3 2h4v12H3zM9 2h4v12H9z" /></svg>
                    </button>
                    <div>
                      <div className="t">{tape.title}</div>
                      <div className="d">{tape.blurb}</div>
                    </div>
                    <div className="eq" aria-hidden="true">
                      <i /><i /><i /><i /><i /><i />
                    </div>
                    <div className="len">{tape.src ? fmt(durations[tape.id]) : '—:—'}</div>
                    {isPlaying && tape.src && (
                      <span className="progress" style={{ transform: `scaleX(${progress})` }} aria-hidden="true" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="track-note">
            {'// pulled straight off the tape — raw, uncut, nothing rewritten'}
          </div>
          <audio
            ref={audioRef}
            preload="none"
            onPlay={() => setPlayingId(pendingIdRef.current)}
            onTimeUpdate={(e) => {
              const a = e.currentTarget;
              setProgress(a.duration ? a.currentTime / a.duration : 0);
            }}
            onLoadedMetadata={(e) => {
              // the playing file is the most accurate duration we'll get
              const id = pendingIdRef.current;
              const d = e.currentTarget.duration;
              if (id && Number.isFinite(d)) setDurations((prev) => ({ ...prev, [id]: d }));
            }}
            onEnded={() => { pendingIdRef.current = null; setPlayingId(null); setProgress(0); }}
            onPause={() => setPlayingId(null)}
            onError={() => { pendingIdRef.current = null; setPlayingId(null); }}
          />
          <p className="sr-only" role="status">
            {playingId ? `Playing ${TAPES.find((t) => t.id === playingId)?.title}` : ''}
          </p>
        </section>

        <section className="system pad" id="system">
          <span className="kicker">THE SYSTEM</span>
          <h2 className="h2 reveal">A lab, not a lecture.</h2>
          <div className="sys-grid">
            <div className="sys-cell">
              <h3>It&apos;s a game</h3>
              <p>
                Streaks, ranks, and reps competing against reps <b>for incentives and rewards</b>.
                The leaderboard does the nagging so managers don&apos;t have to.
              </p>
              <div className="prize">
                <span className="prize-tag">THIS MONTH&apos;S BOUNTY</span>
                <span className="shadow" aria-hidden="true" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="float-obj glasses" src="/v2/meta-glasses.png" alt="Smart glasses offered as a training reward" />
              </div>
              <div className="tagline">{'// THEY OPEN IT ON THEIR OWN'}</div>
            </div>

            <div className="sys-cell">
              <h3>It&apos;s the real pitch</h3>
              <p>
                Interactive drills built off field tape from top producers — not a script written in
                a conference room.
              </p>
              <div className="prize" style={{ '--d': '.7s' } as React.CSSProperties}>
                <span className="prize-tag">GOLDEN DOOR AWARD</span>
                <span className="shadow" aria-hidden="true" />
                <svg className="float-obj award" viewBox="0 0 120 164" role="img" aria-label="Golden Door Award — gold eagle and door knocker on a wood plaque">
                  <defs>
                    <radialGradient id="woodg" cx="42%" cy="36%" r="80%">
                      <stop offset="0%" stopColor="#8A5D36" /><stop offset="55%" stopColor="#634023" /><stop offset="100%" stopColor="#3A2413" />
                    </radialGradient>
                    <linearGradient id="goldg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#F9E08A" /><stop offset="45%" stopColor="#DCA93F" /><stop offset="100%" stopColor="#A0741F" />
                    </linearGradient>
                    <linearGradient id="goldg2" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#F3CD6B" /><stop offset="100%" stopColor="#8F6516" />
                    </linearGradient>
                  </defs>
                  <ellipse cx="60" cy="100" rx="50" ry="62" fill="url(#woodg)" stroke="#241407" strokeWidth="3" />
                  <ellipse cx="60" cy="100" rx="43" ry="55" fill="none" stroke="#9a7a48" strokeWidth="1.6" opacity=".5" />
                  <ellipse cx="60" cy="100" rx="36" ry="48" fill="none" stroke="#2e1c0e" strokeWidth="1" opacity=".35" />
                  <g fill="url(#goldg)" stroke="#7c5a12" strokeWidth="1" strokeLinejoin="round">
                    <path d="M58 44 C47 42 38 37 33 28 C31 22 31 14 32 7 L38 14 L42 9 L47 16 L50 11 L54 19 C56 26 57 35 58 44 Z" />
                    <path d="M62 44 C73 42 82 37 87 28 C89 22 89 14 88 7 L82 14 L78 9 L73 16 L70 11 L66 19 C64 26 63 35 62 44 Z" />
                    <path d="M60 16 C63 16 65 18 65 21 C65 23 64 24 63 25 C66 28 67 33 66 38 C65 44 63 48 60 51 C57 48 55 44 54 38 C53 33 54 28 57 25 C56 24 55 23 55 21 C55 18 57 16 60 16 Z" />
                    <path d="M55 49 L57 58 L60 52 L63 58 L65 49 Z" />
                  </g>
                  <path d="M64 19.5 l6 1.8 -6 2.4 z" fill="#8F6516" stroke="#7c5a12" strokeWidth=".5" />
                  <circle cx="60" cy="84" r="9" fill="url(#goldg2)" stroke="#6e4f0e" strokeWidth="1.2" />
                  <circle cx="60" cy="84" r="3.4" fill="#6e4f0e" />
                  <circle cx="60" cy="104" r="16" fill="none" stroke="url(#goldg)" strokeWidth="6.6" />
                  <rect x="40" y="132" width="40" height="15" rx="2" fill="#17171A" stroke="url(#goldg2)" strokeWidth="1.4" />
                  <path d="M46 139 h28" stroke="#c9a24a" strokeWidth="1.1" opacity=".65" />
                </svg>
              </div>
              <div className="tagline">{'// TRAINED OFF THE BEST'}</div>
            </div>

            <div className="sys-cell">
              <h3>It sorts itself</h3>
              <p>
                Owners see who&apos;s grinding and who&apos;s stuck — by block, by rep, by week —
                without standing over anyone&apos;s shoulder.
              </p>
              <div className="prize" style={{ '--d': '1.4s' } as React.CSSProperties}>
                <span className="prize-tag">THE PAPER TRAIL</span>
                <span className="shadow" aria-hidden="true" />
                <svg className="float-obj folder" viewBox="0 0 210 150" role="img" aria-label="Black folder of rep reports">
                  <defs>
                    <linearGradient id="fgrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2E2E33" /><stop offset="100%" stopColor="#0B0B0D" />
                    </linearGradient>
                  </defs>
                  <path d="M14 40 a8 8 0 0 1 8 -8 h42 c4 0 7 1 10 4 l8 8 c2 2 5 3 8 3 h94 a8 8 0 0 1 8 8 v79 a8 8 0 0 1 -8 8 h-162 a8 8 0 0 1 -8 -8 z" fill="#131316" />
                  <rect x="30" y="22" width="150" height="88" rx="3" fill="#EDEAE2" stroke="#C7C4BA" />
                  <path d="M44 36 h96 M44 48 h110 M44 60 h84" stroke="#9a978e" strokeWidth="4" strokeLinecap="round" />
                  <path d="M6 66 a8 8 0 0 1 8 -8 h182 a8 8 0 0 1 8 8 v68 a8 8 0 0 1 -8 8 h-182 a8 8 0 0 1 -8 -8 z" fill="url(#fgrad)" />
                  <path d="M14 66 h182" stroke="#43434B" strokeWidth="2.5" />
                </svg>
              </div>
              <div className="tagline">{'// VISIBILITY WITHOUT BABYSITTING'}</div>
            </div>
          </div>
        </section>

        <section className="gallery" id="work">
          <div className="gallery-head">
            <span className="kicker">THE WALL</span>
            <h2 className="h2 reveal">Specimens from the lab.</h2>
          </div>
          <div className="rail" ref={railRef}>
            {/* two copies back to back so the drift loops seamlessly */}
            {[0, 1].map((copy) => (
              <Fragment key={copy}>
                {SPECIMENS.map((s, i) => (
                  <figure
                    className="piece"
                    key={s.src}
                    aria-hidden={copy === 1 || undefined}
                    data-loop-start={copy === 1 && i === 0 ? '' : undefined}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.src} alt={copy ? '' : s.alt} draggable={false} />
                    <figcaption>
                      <b>SPECIMEN {String(i + 1).padStart(2, '0')}</b>
                      <span>{s.name}</span>
                    </figcaption>
                  </figure>
                ))}
                <figure className="piece" aria-hidden={copy === 1 || undefined}>
                  <video src="/v2/hero-loop.mp4" poster="/v2/hero-poster.jpg" autoPlay muted loop playsInline />
                  <figcaption>
                    <b>SPECIMEN {String(SPECIMENS.length + 1).padStart(2, '0')}</b>
                    <span>FIELD TAPE</span>
                  </figcaption>
                </figure>
              </Fragment>
            ))}
          </div>
        </section>

        <section className="apply pad" id="knock">
          <span className="kicker">THE DOOR</span>
          <h2 className="h2 reveal">Knock.</h2>
          <p className="apply-sub">
            Rep or owner, pest or roofing, solar or fiber — tell us who you are and what you&apos;re chasing. We sort every
            submission and knock back on the ones that fit.
          </p>

          {sent ? (
            <div id="formOk">
              <div className="big">Received.</div>
              <p>We&apos;ll knock back if it fits. Keep your phone loud.</p>
            </div>
          ) : (
            <form onSubmit={handleApply} autoComplete="on">
              <div className="seg-label" aria-hidden="true">I AM A</div>
              <div className="seg" role="radiogroup" aria-label="I am a">
                {(['rep', 'owner', 'other'] as Role[]).map((r) => (
                  <Fragment key={r}>
                    <input
                      type="radio" name="role" id={`r-${r}`} value={r}
                      checked={role === r} onChange={() => setRole(r)}
                    />
                    <label htmlFor={`r-${r}`}>{r.toUpperCase()}</label>
                  </Fragment>
                ))}
              </div>
              <div className="seg-label" aria-hidden="true">MY INDUSTRY</div>
              <div className="seg" role="radiogroup" aria-label="Industry">
                {INDUSTRY_OPTIONS.map((opt) => (
                  <Fragment key={opt}>
                    <input
                      type="radio" name="industry" id={`i-${opt}`} value={opt}
                      checked={industry === opt} onChange={() => setIndustry(opt)}
                    />
                    <label htmlFor={`i-${opt}`}>{opt.toUpperCase()}</label>
                  </Fragment>
                ))}
              </div>
              <div className="frow">
                <div className="field">
                  <label htmlFor="f-name">NAME</label>
                  <input id="f-name" name="name" autoComplete="name" required />
                </div>
                <div className="field">
                  <label htmlFor="f-company">COMPANY / MARKET</label>
                  <input id="f-company" name="company" autoComplete="organization" />
                </div>
              </div>
              <div className="frow">
                <div className="field">
                  <label htmlFor="f-email">EMAIL</label>
                  <input id="f-email" name="email" type="email" autoComplete="email" required />
                </div>
                <div className="field">
                  <label htmlFor="f-phone">PHONE</label>
                  <input id="f-phone" name="phone" type="tel" autoComplete="tel" required />
                </div>
              </div>
              <div className="field">
                <label htmlFor="f-msg">WHAT ARE YOU CHASING?</label>
                <textarea id="f-msg" name="message" />
              </div>
              <div className="form-actions">
                <button className="btn primary" type="submit" disabled={sending}>
                  {sending ? '[ SENDING… ]' : '[ SEND IT ]'}
                </button>
                <span className="form-note">{'// we read everything.'}</span>
              </div>
              {formError && (
                <p className="form-error">
                  That didn&apos;t go through. Try again, or hit us straight at{' '}
                  <a href="mailto:duncan@slabtraining.com">duncan@slabtraining.com</a>.
                </p>
              )}
            </form>
          )}
        </section>
      </main>

      <footer className="site-foot">
        <div className="foot-row">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/v2/logo-dark.png" alt="SLAB" />
          <div className="foot-links">
            <a href="#theory">THEORY</a>
            <a href="#tapes">SOURCE MATERIAL</a>
            <a href="#system">SYSTEM</a>
            <a href="#knock">APPLY</a>
            <Link href="/store">STORE</Link>
            <Link href="/user/login">LOG IN</Link>
            <Link href="/privacy">PRIVACY</Link>
            <Link href="/terms">TERMS</Link>
          </div>
        </div>
        <p className="foot-note">
          © {new Date().getFullYear()} SLAB Training · slabtraining.com
        </p>
      </footer>
    </div>
  );
}

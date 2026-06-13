import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { EnrichedCard } from './sort';
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  buildConnections,
  layoutStars,
  type CardCategory,
  type CardStar,
} from './constellation';
import { resolveServerUrl } from './apiBase';

/**
 * 3D "Nebula" visualization of the portfolio.
 *
 * Each card becomes a star whose coordinates are computed by
 * `layoutStars` (x = momentum, y = ROI, z = sales pace). We apply a
 * simple perspective projection ourselves so the rendered output is
 * just HTML + SVG (no three.js / WebGL dependency).
 *
 * Per frame:
 *   - Rotate world coords around Y (spin) then X (tilt).
 *   - Perspective-project to 2D.
 *   - Size + opacity scale with depth.
 *   - Sort back-to-front so closer cards occlude farther ones.
 *
 * Connections ("webbing") are drawn as SVG line segments between
 * same-category nearest neighbours. Background starfield is a static
 * SVG layer with a gentle twinkle.
 */

type Props = {
  cards: EnrichedCard[];
  onSelect?: (cardId: string) => void;
};

const WIDTH = 960;
const HEIGHT = 600;
const RADIUS_XY = 260;
const RADIUS_Z = 280;
const FOCAL = 900;

type Projected = {
  star: CardStar;
  sx: number;
  sy: number;
  z: number;
  scale: number;
};

/** Rotate then perspective-project a star in the unit cube. */
const project = (
  star: CardStar,
  rotX: number,
  rotY: number,
  zoom: number,
  t: number
): Projected => {
  // Gentle float - offsets slightly so identical stars don't sync.
  const bob = Math.sin(t * 0.001 + (star.x + star.y * 2 + star.z * 3)) * 3;
  const wx = star.x * RADIUS_XY * zoom;
  const wy = star.y * RADIUS_XY * zoom + bob;
  const wz = star.z * RADIUS_Z * zoom;

  const cosY = Math.cos(rotY);
  const sinY = Math.sin(rotY);
  const x1 = wx * cosY + wz * sinY;
  const z1 = -wx * sinY + wz * cosY;

  const cosX = Math.cos(rotX);
  const sinX = Math.sin(rotX);
  const y2 = wy * cosX - z1 * sinX;
  const z2 = wy * sinX + z1 * cosX;

  const rawScale = FOCAL / (FOCAL + z2);
  const scale = Math.max(0.32, Math.min(1.6, rawScale));
  return {
    star,
    sx: WIDTH / 2 + x1 * rawScale,
    sy: HEIGHT / 2 + y2 * rawScale,
    z: z2,
    scale,
  };
};

type BgStar = { x: number; y: number; r: number; o: number; phase: number };

/** Deterministic pseudo-random background starfield. Seeded from a tiny
 *  PRNG so the backdrop stays consistent across re-renders without
 *  tripping React strict-mode double-render jitter. */
const makeBgStars = (n: number): BgStar[] => {
  let seed = 1337;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed & 0x7fffffff) / 0x7fffffff;
  };
  return Array.from({ length: n }, () => ({
    x: rnd() * WIDTH,
    y: rnd() * HEIGHT,
    r: rnd() * 1.4 + 0.3,
    o: rnd() * 0.65 + 0.2,
    phase: rnd() * Math.PI * 2,
  }));
};

export const NebulaView = ({ cards, onSelect }: Props) => {
  // Camera state.
  const [spin, setSpin] = useState(0);
  const [tilt, setTilt] = useState(-0.22);
  const [zoom, setZoom] = useState(1);
  const [auto, setAuto] = useState(true);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // React attaches wheel listeners as passive by default, which makes
  // preventDefault() a no-op and causes the page to scroll while the user
  // is zooming the nebula. Binding a native non-passive listener fixes it.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => Math.max(0.5, Math.min(2.2, z - e.deltaY * 0.001)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // UI state.
  const [active, setActive] = useState<Set<CardCategory>>(
    () => new Set(CATEGORY_ORDER)
  );
  const [selected, setSelected] = useState<string | null>(null);

  // Animation tick - used ONLY for the bob/twinkle offsets. The camera
  // angle is in state too, but we update both here at the same cadence.
  const [tick, setTick] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const loop = () => {
      setTick((t) => (t + 1) % 1_000_000);
      if (auto) setSpin((s) => s + 0.0035);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [auto]);

  const stars = useMemo(() => layoutStars(cards), [cards]);
  const connections = useMemo(() => buildConnections(stars, 2), [stars]);
  const bgStars = useMemo(() => makeBgStars(180), []);

  // Project every star for this frame.
  const t = tick * 16;
  const projected: Projected[] = stars.map((s) =>
    project(s, tilt, spin, zoom, t)
  );
  // Sort farthest first so nearer stars render last (on top).
  const ordered = [...projected].sort((a, b) => b.z - a.z);

  const visible = new Set(
    ordered
      .filter((p) => active.has(p.star.category))
      .map((p) => p.star.id)
  );

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    setSpin((s) => s + dx * 0.006);
    setTilt((ti) => Math.max(-1.25, Math.min(1.25, ti + dy * 0.006)));
    setDrag({ x: e.clientX, y: e.clientY });
  };

  const toggleCat = (cat: CardCategory) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });

  const selectedStar = selected
    ? stars.find((s) => s.id === selected) ?? null
    : null;

  const counts = useMemo(() => {
    const c: Record<CardCategory, number> = {
      BUY: 0, SELL: 0, HOLD: 0, SLEEPER: 0, CLIMBER: 0, DUD: 0, NGMI: 0,
    };
    for (const s of stars) c[s.category]++;
    return c;
  }, [stars]);

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-3xl border border-slate-800 shadow-2xl"
      style={{
        width: WIDTH,
        height: HEIGHT,
        background:
          'radial-gradient(ellipse at 50% 55%, #1e1b4b 0%, #0b0f1e 55%, #020617 100%)',
      }}
      onMouseDown={(e) => {
        setDrag({ x: e.clientX, y: e.clientY });
        setAuto(false);
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={() => setDrag(null)}
      onMouseLeave={() => setDrag(null)}
    >
      {/* Background: nebula glow + twinkling starfield + webbing. */}
      <svg
        width={WIDTH}
        height={HEIGHT}
        className="absolute inset-0 pointer-events-none"
      >
        <defs>
          <radialGradient id="nebula-glow-a" cx="35%" cy="40%" r="45%">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="nebula-glow-b" cx="70%" cy="65%" r="40%">
            <stop offset="0%" stopColor="#a855f7" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#a855f7" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="nebula-glow-c" cx="55%" cy="30%" r="30%">
            <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width={WIDTH} height={HEIGHT} fill="url(#nebula-glow-a)" />
        <rect width={WIDTH} height={HEIGHT} fill="url(#nebula-glow-b)" />
        <rect width={WIDTH} height={HEIGHT} fill="url(#nebula-glow-c)" />

        {bgStars.map((s, i) => {
          const tw = 0.6 + 0.4 * Math.sin(t * 0.002 + s.phase);
          return (
            <circle
              key={i}
              cx={s.x}
              cy={s.y}
              r={s.r}
              fill="white"
              opacity={s.o * tw}
            />
          );
        })}

        {/* Constellation web: one line per same-category nearest-neighbour edge. */}
        {connections.map(([i, j], k) => {
          const a = projected[i];
          const b = projected[j];
          if (!visible.has(a.star.id) || !visible.has(b.star.id)) return null;
          const avgZ = (a.z + b.z) / 2;
          // Lines fade with depth and collapse at the back of the scene.
          const depthFade = Math.max(0, 1 - (avgZ + RADIUS_Z) / (RADIUS_Z * 3));
          const opacity = 0.08 + depthFade * 0.28;
          const color = CATEGORY_META[a.star.category].color;
          return (
            <line
              key={k}
              x1={a.sx}
              y1={a.sy}
              x2={b.sx}
              y2={b.sy}
              stroke={color}
              strokeWidth={0.85}
              opacity={opacity}
            />
          );
        })}
      </svg>

      {/* Cards as stars. Render in depth order; farther = dimmer + smaller. */}
      {ordered.map(({ star, sx, sy, z, scale }) => {
        if (!active.has(star.category)) return null;
        const sz = 48 * scale;
        const isSel = selected === star.id;
        const meta = CATEGORY_META[star.category];
        const depth01 = Math.max(0, Math.min(1, (z + RADIUS_Z) / (RADIUS_Z * 2)));
        const opacity = 0.4 + (1 - depth01) * 0.6;
        return (
          <button
            key={star.id}
            className="absolute rounded-xl border-2 overflow-hidden transition-transform duration-150"
            style={{
              left: sx - sz / 2,
              top: sy - sz / 2,
              width: sz,
              height: sz,
              borderColor: meta.color,
              boxShadow: isSel
                ? `0 0 ${20 * scale}px ${meta.glow}, 0 0 ${40 * scale}px ${meta.glow}`
                : `0 0 ${10 * scale}px ${meta.glow}`,
              opacity,
              transform: isSel ? 'scale(1.25)' : 'scale(1)',
              zIndex: Math.round(1000 - z),
              background: star.card.localImage
                ? `url(${resolveServerUrl(star.card.localImage)}) center/cover no-repeat, #0f172a`
                : '#0f172a',
            }}
            onClick={(e) => {
              e.stopPropagation();
              setSelected(star.id);
              onSelect?.(star.id);
            }}
            title={`${star.card.name} - ${meta.label}`}
          >
            {/* Inner tint overlay for category reinforcement. */}
            <span
              className="absolute inset-0 pointer-events-none"
              style={{
                background: `linear-gradient(180deg, transparent 40%, ${meta.color}55 100%)`,
              }}
            />
          </button>
        );
      })}

      {/* Legend + category toggles. */}
      <div className="absolute top-3 left-3 flex flex-col gap-0.5 bg-slate-950/70 backdrop-blur-md rounded-xl p-2.5 border border-slate-700/80 shadow-lg">
        <div className="text-[9px] text-slate-400 uppercase font-black tracking-[0.2em] mb-1.5 px-1">
          Categories
        </div>
        {CATEGORY_ORDER.map((cat) => {
          const meta = CATEGORY_META[cat];
          const on = active.has(cat);
          return (
            <button
              key={cat}
              onClick={() => toggleCat(cat)}
              className="flex items-center gap-2 text-[10px] font-bold px-2 py-1 rounded-md transition-colors min-w-[140px]"
              style={{
                color: on ? meta.color : '#64748b',
                background: on ? 'rgba(255,255,255,0.04)' : 'transparent',
              }}
              title={meta.description}
            >
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{
                  backgroundColor: on ? meta.color : '#334155',
                  boxShadow: on ? `0 0 6px ${meta.glow}` : 'none',
                }}
              />
              <span className="uppercase tracking-wider">{meta.label}</span>
              <span className="ml-auto text-slate-500 tabular-nums text-[9px]">
                {counts[cat]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Camera controls. */}
      <div className="absolute top-3 right-3 flex gap-1 bg-slate-950/70 backdrop-blur-md rounded-xl border border-slate-700/80 p-1 shadow-lg">
        <button
          onClick={() => setAuto((a) => !a)}
          className="text-[9px] font-black uppercase tracking-[0.15em] px-2.5 py-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 flex items-center gap-1.5"
          title={auto ? 'Pause auto-rotate' : 'Resume auto-rotate'}
        >
          {auto ? <Pause size={11} /> : <Play size={11} />}
          {auto ? 'Pause' : 'Spin'}
        </button>
        <button
          onClick={() => setZoom((z) => Math.min(2.2, z + 0.15))}
          className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800"
          title="Zoom in"
        >
          <ZoomIn size={13} />
        </button>
        <button
          onClick={() => setZoom((z) => Math.max(0.5, z - 0.15))}
          className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800"
          title="Zoom out"
        >
          <ZoomOut size={13} />
        </button>
        <button
          onClick={() => {
            setSpin(0);
            setTilt(-0.22);
            setZoom(1);
            setAuto(true);
          }}
          className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-800"
          title="Reset camera"
        >
          <RotateCcw size={13} />
        </button>
      </div>

      {/* Axis key (bottom-right). */}
      <div className="absolute bottom-3 right-3 text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400 bg-slate-950/70 backdrop-blur-md rounded-xl border border-slate-700/80 px-3 py-2 shadow-lg leading-5">
        <div><span className="text-slate-500">X</span> Momentum (slope/mean)</div>
        <div><span className="text-slate-500">Y</span> Value (ROI %)</div>
        <div><span className="text-slate-500">Z</span> Activity (sales pace)</div>
      </div>

      {/* Drag hint (fades out after first interaction). */}
      {auto && !drag && (
        <div className="absolute bottom-3 left-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500 bg-slate-950/50 backdrop-blur-md rounded-lg border border-slate-800 px-2.5 py-1.5">
          Drag to orbit - scroll to zoom
        </div>
      )}

      {/* Selected-card info panel. */}
      {selectedStar && (
        <div
          className="absolute left-3 right-[300px] bottom-3 flex items-center gap-3 bg-slate-950/90 backdrop-blur-md rounded-xl border p-2.5 shadow-xl"
          style={{ borderColor: CATEGORY_META[selectedStar.category].color + '66' }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {selectedStar.card.localImage && (
            <img
              src={resolveServerUrl(selectedStar.card.localImage)}
              alt=""
              className="w-14 h-14 rounded-md object-cover border flex-shrink-0"
              style={{ borderColor: CATEGORY_META[selectedStar.category].color }}
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-black text-white truncate">
              {selectedStar.card.name}
            </div>
            <div className="text-[9px] uppercase tracking-[0.15em] text-slate-400 truncate">
              {selectedStar.card.set}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-semibold">
              <span
                className="uppercase tracking-wider font-black"
                style={{ color: CATEGORY_META[selectedStar.category].color }}
              >
                {CATEGORY_META[selectedStar.category].label}
              </span>
              <span className="text-slate-300">
                ROI <span className="tabular-nums">{selectedStar.roi.toFixed(0)}%</span>
              </span>
              <span className="text-slate-300">
                Slope{' '}
                <span className="tabular-nums">
                  {(selectedStar.momentum * 100).toFixed(2)}%/d
                </span>
              </span>
              <span className="text-slate-300">
                Pace{' '}
                <span className="tabular-nums">
                  {selectedStar.pacePerMonth}/mo
                </span>
              </span>
              {selectedStar.analytics && (
                <span className="text-slate-300">
                  z{' '}
                  <span className="tabular-nums">
                    {selectedStar.analytics.zScore.toFixed(2)}
                  </span>
                </span>
              )}
            </div>
          </div>
          <button
            onClick={() => setSelected(null)}
            className="p-1 rounded-md text-slate-500 hover:text-white hover:bg-slate-800 flex-shrink-0"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
};

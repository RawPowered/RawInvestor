import type { ReactNode } from 'react';
import type { RowSignalIcons } from './rowSignals';

const svgWrap = (children: ReactNode, title: string, accentClass: string) => (
  <span
    className={`inline-flex items-center justify-center w-[22px] h-[22px] rounded-md border ${accentClass}`}
    title={title}
    role="img"
    aria-label={title}
  >
    <svg viewBox="0 0 24 24" className="w-[14px] h-[14px]" fill="currentColor" aria-hidden>
      {children}
    </svg>
  </span>
);

/** Strong grading / EV case (clipboard + check). */
export const MustGradeIcon = () =>
  svgWrap(
    <>
      <rect
        x="7"
        y="4"
        width="10"
        height="15"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="M10 12.5l2 2 3.5-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>,
    'Must grade: strong grading EV / Nebula BUY–SLEEPER–CLIMBER style edge.',
    'text-emerald-700 bg-emerald-50 border-emerald-200'
  );

/** Bought notably under raw FMV — stylized Pokéball. */
export const GoodCatchIcon = () =>
  svgWrap(
    <>
      <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5 12h14" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M12 5a7 7 0 017 7h-7V5z"
        fill="currentColor"
        opacity="0.45"
      />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="white" />
    </>,
    'Good catch: paid meaningfully under current raw.',
    'text-rose-700 bg-rose-50 border-rose-200'
  );

/** Hold / wait — diamond. */
export const HoldDiamondIcon = () =>
  svgWrap(
    <path d="M12 3l2.8 5.5L21 10l-5.2 2.5L12 21l-3.8-8.5L3 10l6.2-1.5L12 3z" />,
    'Hold: Nebula HOLD/DUD — no urgent buy or sell edge.',
    'text-amber-800 bg-amber-50 border-amber-200'
  );

/** Must sell — pokeball + dollar hint. */
export const MustSellIcon = () =>
  svgWrap(
    <>
      <circle cx="9.5" cy="12" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3.3 12h12.4" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M9.5 5.8a6.2 6.2 0 016.2 6.2H3.3a6.2 6.2 0 016.2-6.2z"
        fill="currentColor"
        opacity="0.35"
      />
      <text
        x="14.2"
        y="17.2"
        fontSize="9"
        fontWeight="800"
        fill="currentColor"
        fontFamily="system-ui,Segoe UI,sans-serif"
      >
        $
      </text>
    </>,
    'Must sell: Nebula SELL/NGMI or clearly negative EV.',
    'text-violet-800 bg-violet-50 border-violet-200'
  );

export const SignalIconsRow = ({ icons }: { icons: RowSignalIcons }) => (
  <div className="flex flex-wrap items-center justify-center gap-0.5 max-w-[5.5rem]">
    {icons.mustGrade ? <MustGradeIcon /> : null}
    {icons.goodCatch ? <GoodCatchIcon /> : null}
    {icons.hold ? <HoldDiamondIcon /> : null}
    {icons.mustSell ? <MustSellIcon /> : null}
    {!icons.mustGrade && !icons.goodCatch && !icons.hold && !icons.mustSell ? (
      <span className="text-[9px] text-slate-300 font-bold">—</span>
    ) : null}
  </div>
);

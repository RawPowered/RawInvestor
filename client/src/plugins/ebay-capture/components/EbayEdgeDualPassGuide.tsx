/** Shown only when ebayLegacyDualGraded plugin setting is enabled (singles-dual Quick Fetch). */
export type EbayEdgeDualPassGuideProps = {
  gradedNoDone: boolean;
  gradedYesDone: boolean;
  openBothTabs?: boolean;
};

export function EbayEdgeDualPassGuide({
  gradedNoDone,
  gradedYesDone,
  openBothTabs,
}: EbayEdgeDualPassGuideProps) {
  const next =
    !gradedNoDone && !gradedYesDone
      ? 'Capture either tab in Edge (extension → Capture current tab). Both URLs may already be open.'
      : !gradedNoDone
        ? 'Graded Yes captured — capture Graded No tab next.'
        : !gradedYesDone
          ? 'Graded No captured — capture Graded Yes tab next.'
          : 'Both passes detected — merging…';

  return (
    <div
      className="rounded-lg border border-indigo-200 bg-indigo-50/80 px-3 py-2 text-[11px] text-indigo-950"
      data-plugin-id="ebay-edge-dual-guide"
    >
      <p className="font-semibold uppercase tracking-wide text-[10px]">Edge dual graded passes</p>
      <p className="mt-1">{next}</p>
      <p className="mt-1 text-[10px] opacity-80">
        No: {gradedNoDone ? 'done' : 'pending'} · Yes: {gradedYesDone ? 'done' : 'pending'}
        {openBothTabs ? ' · two tabs opened' : ''}
      </p>
    </div>
  );
}

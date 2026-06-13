/** eBay sold-search Graded facet lane from URL (Graded=No / Graded=Yes). */
export const ebayGradedLaneFromUrl = (url: string | null | undefined): 'no' | 'yes' | null => {
  try {
    const u = new URL(String(url || ''));
    const graded = String(u.searchParams.get('Graded') || u.searchParams.get('graded') || '')
      .trim()
      .toLowerCase();
    if (graded === 'no') return 'no';
    if (graded === 'yes') return 'yes';
    return null;
  } catch {
    return null;
  }
};

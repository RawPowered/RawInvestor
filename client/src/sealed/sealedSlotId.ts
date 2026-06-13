/** Stable slot id for merging parser output with user edits on the same row. */
export const sealedSlotId = (tableIndex: number, rowIndex: number, row: string[]): string => {
  const norm = row.map((c) => String(c ?? '').trim()).join('|');
  let h = 2166136261;
  const str = `${tableIndex}|${rowIndex}|${norm}`;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `t${tableIndex}-r${rowIndex}-${(h >>> 0).toString(16)}`;
};

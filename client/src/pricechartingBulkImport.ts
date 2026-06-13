import JSZip from 'jszip';

export type PriceChartingCollectionRow = {
  productId: string;
  productName: string;
  consoleName: string;
  priceInPennies: number;
  costBasisInPennies: number;
  quantity: number;
};

const parseCsv = (raw: string): string[][] => {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;
  while (i < raw.length) {
    const ch = raw[i];
    if (inQuotes) {
      if (ch === '"') {
        if (raw[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(cell);
      out.push(row);
      row = [];
      cell = '';
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    out.push(row);
  }
  return out;
};

const normalizeHeader = (s: string): string =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');

const toInt = (v: string | undefined, fallback = 0): number => {
  const n = Number.parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) ? n : fallback;
};

const rowsFromCsvText = (text: string): PriceChartingCollectionRow[] => {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map(normalizeHeader);
  const idx = (name: string) => headers.indexOf(name);
  const iProductId = idx('id');
  const iProductName = idx('product-name');
  const iConsoleName = idx('console-name');
  const iPrice = idx('price-in-pennies');
  const iCostBasis = idx('cost-basis-in-pennies');
  const iQty = idx('quantity');
  if (iProductId < 0 || iProductName < 0) return [];

  const out: PriceChartingCollectionRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const productId = String(row[iProductId] ?? '').trim();
    const productName = String(row[iProductName] ?? '').trim();
    if (!productId || !productName) continue;
    out.push({
      productId,
      productName,
      consoleName: String(row[iConsoleName] ?? '').trim(),
      priceInPennies: toInt(row[iPrice]),
      costBasisInPennies: toInt(row[iCostBasis]),
      quantity: Math.max(1, toInt(row[iQty], 1)),
    });
  }
  return out;
};

const csvTextFromZip = async (file: File): Promise<string> => {
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const csvName = Object.keys(zip.files).find((k) => k.toLowerCase().endsWith('.csv'));
  if (!csvName) throw new Error('ZIP does not contain a CSV file.');
  const entry = zip.file(csvName);
  if (!entry) throw new Error('Could not read CSV from ZIP.');
  return entry.async('text');
};

export const parsePriceChartingCollectionFile = async (
  file: File
): Promise<PriceChartingCollectionRow[]> => {
  const name = file.name.toLowerCase();
  const text = name.endsWith('.zip') ? await csvTextFromZip(file) : await file.text();
  const rows = rowsFromCsvText(text);
  if (rows.length === 0) {
    throw new Error('No valid PriceCharting collection rows found in file.');
  }
  return rows;
};

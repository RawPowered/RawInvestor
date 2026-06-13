import type { PriceChartingCollectionRow } from '../pricechartingBulkImport';

export type CollectionImportProgress = {
  running: boolean;
  total: number;
  processed: number;
  imported: number;
  skipped: number;
  failed: number;
  current: string;
};

export type CollectionImportIssue = {
  status: 'skipped' | 'failed';
  reason: string;
  row: PriceChartingCollectionRow;
  candidates: string[];
};

export type AdminPanelSection = 'configuration' | 'database' | 'diagnostics';

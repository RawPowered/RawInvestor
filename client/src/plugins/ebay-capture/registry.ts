import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { EbayCaptureTimingSectionProps } from './components/EbayCaptureTimingSection';
import type { EbayCaptureDiagnosticsStripProps } from './components/EbayCaptureDiagnosticsStrip';
import type { EbayEdgeDualPassGuideProps } from './components/EbayEdgeDualPassGuide';
import type { EbayBatchProgressPanelProps } from './components/EbayBatchProgressPanel';
import type { EbayCapturePluginHostProps } from './components/EbayCapturePluginHost';

export type EbayCapturePluginId =
  | 'timing'
  | 'diagnostics'
  | 'edgeGuide'
  | 'batchProgress'
  | 'host';

const lazyNamed = <P extends Record<string, unknown>>(
  loader: () => Promise<{ [key: string]: ComponentType<P> }>,
  exportName: string
): LazyExoticComponent<ComponentType<P>> =>
  lazy(async () => {
    const mod = await loader();
    const Comp = mod[exportName];
    if (!Comp) throw new Error(`Plugin export missing: ${exportName}`);
    return { default: Comp };
  });

export const EbayCaptureTimingSectionLazy = lazyNamed<EbayCaptureTimingSectionProps>(
  () => import('./components/EbayCaptureTimingSection'),
  'EbayCaptureTimingSection'
);

export const EbayCaptureDiagnosticsStripLazy = lazyNamed<EbayCaptureDiagnosticsStripProps>(
  () => import('./components/EbayCaptureDiagnosticsStrip'),
  'EbayCaptureDiagnosticsStrip'
);

export const EbayEdgeDualPassGuideLazy = lazyNamed<EbayEdgeDualPassGuideProps>(
  () => import('./components/EbayEdgeDualPassGuide'),
  'EbayEdgeDualPassGuide'
);

export const EbayBatchProgressPanelLazy = lazyNamed<EbayBatchProgressPanelProps>(
  () => import('./components/EbayBatchProgressPanel'),
  'EbayBatchProgressPanel'
);

export const EbayCapturePluginHostLazy = lazyNamed<EbayCapturePluginHostProps>(
  () => import('./components/EbayCapturePluginHost'),
  'EbayCapturePluginHost'
);

import { Suspense, type ReactNode } from 'react';
import { PluginErrorBoundary } from '../../../shared/PluginErrorBoundary';

export type EbayCapturePluginHostProps = {
  pluginId: string;
  label: string;
  children: ReactNode;
  fallback?: ReactNode;
};

export function EbayCapturePluginHost({ pluginId, label, children, fallback }: EbayCapturePluginHostProps) {
  return (
    <PluginErrorBoundary label={label}>
      <Suspense
        fallback={
          fallback ?? (
            <p className="text-[10px] text-slate-500 font-mono" data-plugin-id={pluginId}>
              Loading {label}…
            </p>
          )
        }
      >
        {children}
      </Suspense>
    </PluginErrorBoundary>
  );
}

import { Field, NumberInput } from '../../../shared/formFields';

import type { QuickFetchTiming } from '../../../utils/quickFetchTiming';

import type { EbayCapturePluginSettings } from '../types';



export type EbayCaptureTimingSectionProps = {

  quickFetchTiming: QuickFetchTiming;

  onQuickFetchTimingFieldChange: (field: keyof QuickFetchTiming, value: number) => void;

  pluginSettings: EbayCapturePluginSettings;

  onPluginSettingsChange: (partial: Partial<EbayCapturePluginSettings>) => void;

};



export function EbayCaptureTimingSection({

  quickFetchTiming,

  onQuickFetchTimingFieldChange,

  pluginSettings,

  onPluginSettingsChange,

}: EbayCaptureTimingSectionProps) {

  return (

    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mt-3">

      <Field label="eBay after activate (ms)">

        <NumberInput

          value={quickFetchTiming.ebayPostActivateMs}

          onChange={(v) => onQuickFetchTimingFieldChange('ebayPostActivateMs', v)}

          step={50}

        />

      </Field>

      <Field label="eBay impatience (ms)">

        <NumberInput

          value={quickFetchTiming.ebayImpatienceMs}

          onChange={(v) => onQuickFetchTimingFieldChange('ebayImpatienceMs', v)}

          step={50}

        />

      </Field>

      <Field label="eBay results per page">

        <NumberInput

          value={quickFetchTiming.ebayPerPageTarget}

          onChange={(v) => onQuickFetchTimingFieldChange('ebayPerPageTarget', v)}

          step={10}

        />

      </Field>

      <Field label="Quick refresh eBay max / page (cap)">

        <NumberInput

          value={quickFetchTiming.ebayQuickRefreshMaxPerPage}

          onChange={(v) => onQuickFetchTimingFieldChange('ebayQuickRefreshMaxPerPage', v)}

          step={5}

        />

      </Field>

      <Field label="Quick refresh eBay stop buffer (ms)">

        <NumberInput

          value={quickFetchTiming.ebayQuickStopBufferMs}

          onChange={(v) => onQuickFetchTimingFieldChange('ebayQuickStopBufferMs', v)}

          step={3600000}

        />

      </Field>

      <Field label="eBay deep concurrency">

        <NumberInput

          value={quickFetchTiming.ebayDeepFetchConcurrency}

          onChange={(v) => onQuickFetchTimingFieldChange('ebayDeepFetchConcurrency', v)}

          step={1}

        />

      </Field>

      <Field label="eBay deep budget (ms)">

        <NumberInput

          value={quickFetchTiming.ebayDeepBudgetMs}

          onChange={(v) => onQuickFetchTimingFieldChange('ebayDeepBudgetMs', v)}

          step={5000}

        />

      </Field>

      <div className="sm:col-span-2 md:col-span-3 flex flex-col gap-2 pt-1 border-t border-slate-200">

        <label className="flex items-center gap-2 text-[11px] font-medium text-slate-700 cursor-pointer">

          <input

            type="checkbox"

            checked={pluginSettings.ebayLegacyDualGraded}

            onChange={(e) =>

              onPluginSettingsChange({

                ebayLegacyDualGraded: e.target.checked,

                ...(e.target.checked ? {} : { captureEbayDualParallel: false, ebaySingleInjectionDualFacet: false }),

              })

            }

            className="rounded border-slate-300"

          />

          Legacy dual graded (Graded=No + Yes tabs — off by default; standard is one sold-search tab)

        </label>

        {pluginSettings.ebayLegacyDualGraded ? (

          <>

            <label className="flex items-center gap-2 text-[11px] font-medium text-slate-700 cursor-pointer">

              <input

                type="checkbox"

                checked={pluginSettings.captureEbayDualParallel}

                onChange={(e) =>

                  onPluginSettingsChange({

                    captureEbayDualParallel: e.target.checked,

                    ...(e.target.checked ? { ebaySingleInjectionDualFacet: false } : {}),

                  })

                }

                className="rounded border-slate-300"

              />

              Parallel Graded No + Yes tabs (RawEngine Quick Fetch; caps deep concurrency at 4)

            </label>

            <label className="flex items-center gap-2 text-[11px] font-medium text-slate-700 cursor-pointer">

              <input

                type="checkbox"

                checked={pluginSettings.ebaySingleInjectionDualFacet}

                onChange={(e) =>

                  onPluginSettingsChange({

                    ebaySingleInjectionDualFacet: e.target.checked,

                    ...(e.target.checked ? { captureEbayDualParallel: false } : {}),

                  })

                }

                className="rounded border-slate-300"

              />

              Single-tab dual facet (one tab, two passes — use if parallel tabs stall)

            </label>

          </>

        ) : null}

        <label className="flex items-center gap-2 text-[11px] font-medium text-slate-700 cursor-pointer">

          <input

            type="checkbox"

            checked={pluginSettings.ebayAggressiveDeep}

            onChange={(e) => onPluginSettingsChange({ ebayAggressiveDeep: e.target.checked })}

            className="rounded border-slate-300"

          />

          Aggressive deep profile (concurrency 6 when not customized)

        </label>

        <Field label="Portfolio eBay batch max cards">

          <NumberInput

            value={pluginSettings.maxConcurrentCards}

            onChange={(v) => onPluginSettingsChange({ maxConcurrentCards: Math.max(1, Math.min(4, v)) })}

            step={1}

          />

        </Field>

      </div>

    </div>

  );

}



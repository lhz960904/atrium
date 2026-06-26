import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type UsageRange = '7d' | '30d' | 'month' | 'year' | 'all';
export type UsageChartMode = 'total' | 'byModel';

type UsagePrefsStore = {
  range: UsageRange;
  chartMode: UsageChartMode;
  setRange: (range: UsageRange) => void;
  setChartMode: (chartMode: UsageChartMode) => void;
};

/** The usage page's view choices (period + chart mode), persisted so the page
 *  reopens to where the user left it instead of resetting every visit. */
export const useUsagePrefs = create<UsagePrefsStore>()(
  persist(
    (set) => ({
      range: 'month',
      chartMode: 'total',
      setRange: (range) => set({ range }),
      setChartMode: (chartMode) => set({ chartMode }),
    }),
    { name: 'atrium-usage-prefs' },
  ),
);

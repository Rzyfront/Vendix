import { InjectionToken } from '@angular/core';
import { TourConfig } from '../services/tour.service';
import { POS_TOUR_CONFIG } from './pos-tour.config';
import { ECOMMERCE_TOUR_CONFIG } from './ecommerce-tour.config';

/**
 * Every guided tour Vexi can offer, by id (U-2/U-3/U-4).
 *
 * Each feature used to import its own config directly, which left the agent
 * with no surface to list or start tours from. This map is the single
 * registry: adding a tour is one entry here, and the dispatcher, the layout
 * shell and the spec all read the same list instead of drifting.
 */
export const TOUR_CONFIG_MAP: Record<string, TourConfig> = {
  [POS_TOUR_CONFIG.id]: POS_TOUR_CONFIG,
  [ECOMMERCE_TOUR_CONFIG.id]: ECOMMERCE_TOUR_CONFIG,
};

/**
 * Injectable tour map.
 *
 * Provided in root with the static map above; tests override it with a
 * fixture map instead of importing real configs.
 */
export const VEXI_TOUR_CONFIGS = new InjectionToken<Record<string, TourConfig>>(
  'VEXI_TOUR_CONFIGS',
  { providedIn: 'root', factory: () => TOUR_CONFIG_MAP },
);

import { createActionGroup, emptyProps, props } from '@ngrx/store';
import {
  Promotion,
  PromotionsSummary,
  CreatePromotionDto,
  UpdatePromotionDto,
} from '../../interfaces/promotion.interface';

export const PromotionsActions = createActionGroup({
  source: 'Promotions',
  events: {
    // Load
    'Load Promotions': emptyProps(),
    'Load Promotions Success': props<{ promotions: Promotion[]; meta: any }>(),
    'Load Promotions Failure': props<{ error: string }>(),
    // Summary
    'Load Summary': emptyProps(),
    'Load Summary Success': props<{ summary: PromotionsSummary }>(),
    'Load Summary Failure': props<{ error: string }>(),
    // CRUD
    'Create Promotion': props<{ dto: CreatePromotionDto }>(),
    'Create Promotion Success': props<{ promotion: Promotion }>(),
    'Create Promotion Failure': props<{ error: string }>(),
    'Update Promotion': props<{ id: number; dto: UpdatePromotionDto }>(),
    'Update Promotion Success': props<{ promotion: Promotion }>(),
    'Update Promotion Failure': props<{ error: string }>(),
    'Delete Promotion': props<{ id: number }>(),
    'Delete Promotion Success': props<{ id: number }>(),
    'Delete Promotion Failure': props<{ error: string }>(),
    // State transitions
    'Activate Promotion': props<{ id: number }>(),
    'Activate Promotion Success': props<{ promotion: Promotion }>(),
    'Activate Promotion Failure': props<{ error: string }>(),
    'Pause Promotion': props<{ id: number }>(),
    'Pause Promotion Success': props<{ promotion: Promotion }>(),
    'Pause Promotion Failure': props<{ error: string }>(),
    'Cancel Promotion': props<{ id: number }>(),
    'Cancel Promotion Success': props<{ promotion: Promotion }>(),
    'Cancel Promotion Failure': props<{ error: string }>(),
    // Filters
    'Set Search': props<{ search: string }>(),
    'Set Page': props<{ page: number }>(),
    'Set Sort': props<{ sort_by: string; sort_order: 'asc' | 'desc' }>(),
    'Set State Filter': props<{ state: string }>(),
    'Set Type Filter': props<{ promotion_type: string }>(),
    'Set Scope Filter': props<{ scope: string }>(),
    'Clear Filters': emptyProps(),
  },
});

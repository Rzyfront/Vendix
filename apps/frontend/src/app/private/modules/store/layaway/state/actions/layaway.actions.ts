import { createAction, props } from '@ngrx/store';
import { LayawayPlan, LayawayStats, CreateLayawayRequest, MakePaymentRequest, CancelLayawayRequest } from '../../interfaces/layaway.interface';

// Load
export const loadLayaways = createAction('[Layaway] Load Layaways');
export const loadLayawaysSuccess = createAction('[Layaway] Load Layaways Success', props<{ layaways: LayawayPlan[]; meta: any }>());
export const loadLayawaysFailure = createAction('[Layaway] Load Layaways Failure', props<{ error: string }>());

// Create
export const createLayaway = createAction('[Layaway] Create', props<{ data: CreateLayawayRequest }>());
export const createLayawaySuccess = createAction('[Layaway] Create Success', props<{ layaway: LayawayPlan }>());
export const createLayawayFailure = createAction('[Layaway] Create Failure', props<{ error: string }>());

// Make Payment
export const makePayment = createAction('[Layaway] Make Payment', props<{ plan_id: number; data: MakePaymentRequest }>());
export const makePaymentSuccess = createAction('[Layaway] Make Payment Success');
export const makePaymentFailure = createAction('[Layaway] Make Payment Failure', props<{ error: string }>());

// Cancel
export const cancelLayaway = createAction('[Layaway] Cancel', props<{ plan_id: number; data: CancelLayawayRequest }>());
export const cancelLayawaySuccess = createAction('[Layaway] Cancel Success');
export const cancelLayawayFailure = createAction('[Layaway] Cancel Failure', props<{ error: string }>());

// Stats
export const loadStats = createAction('[Layaway] Load Stats');
export const loadStatsSuccess = createAction('[Layaway] Load Stats Success', props<{ stats: LayawayStats }>());
export const loadStatsFailure = createAction('[Layaway] Load Stats Failure', props<{ error: string }>());

// Filters
export const setSearch = createAction('[Layaway] Set Search', props<{ search: string }>());
export const setPage = createAction('[Layaway] Set Page', props<{ page: number }>());
export const setSort = createAction('[Layaway] Set Sort', props<{ sort_by: string; sort_order: 'asc' | 'desc' }>());
export const setStateFilter = createAction('[Layaway] Set State Filter', props<{ state: string | null }>());

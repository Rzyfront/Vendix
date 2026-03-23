import { createAction, props } from '@ngrx/store';
import { Credit, CreditStats, RegisterPaymentRequest } from '../../interfaces/credit.interface';

// Load
export const loadCredits = createAction('[Credits] Load Credits');
export const loadCreditsSuccess = createAction('[Credits] Load Credits Success', props<{ credits: Credit[]; meta: any }>());
export const loadCreditsFailure = createAction('[Credits] Load Credits Failure', props<{ error: string }>());

// Register Payment
export const registerPayment = createAction('[Credits] Register Payment', props<{ credit_id: number; data: RegisterPaymentRequest }>());
export const registerPaymentSuccess = createAction('[Credits] Register Payment Success');
export const registerPaymentFailure = createAction('[Credits] Register Payment Failure', props<{ error: string }>());

// Cancel
export const cancelCredit = createAction('[Credits] Cancel', props<{ credit_id: number; reason?: string }>());
export const cancelCreditSuccess = createAction('[Credits] Cancel Success');
export const cancelCreditFailure = createAction('[Credits] Cancel Failure', props<{ error: string }>());

// Stats
export const loadStats = createAction('[Credits] Load Stats');
export const loadStatsSuccess = createAction('[Credits] Load Stats Success', props<{ stats: CreditStats }>());
export const loadStatsFailure = createAction('[Credits] Load Stats Failure', props<{ error: string }>());

// Filters
export const setSearch = createAction('[Credits] Set Search', props<{ search: string }>());
export const setPage = createAction('[Credits] Set Page', props<{ page: number }>());
export const setSort = createAction('[Credits] Set Sort', props<{ sort_by: string; sort_order: 'asc' | 'desc' }>());
export const setStateFilter = createAction('[Credits] Set State Filter', props<{ state: string | null }>());

import { createAction, props } from '@ngrx/store';
import { NormalizedApiPayload } from '../../utils/api-error-handler';

export const loadCurrent = createAction('[Subscription] Load Current');

export const loadCurrentSuccess = createAction(
  '[Subscription] Load Current Success',
  props<{ subscription: any }>(),
);

export const loadCurrentFailure = createAction(
  '[Subscription] Load Current Failure',
  props<{ error: NormalizedApiPayload | string }>(),
);

export const loadAccess = createAction('[Subscription] Load Access');

export const loadAccessSuccess = createAction(
  '[Subscription] Load Access Success',
  props<{ access: any }>(),
);

export const loadAccessFailure = createAction(
  '[Subscription] Load Access Failure',
  props<{ error: NormalizedApiPayload | string }>(),
);

export const subscribe = createAction(
  '[Subscription] Subscribe',
  props<{ planId: string; partnerOverrideId?: string }>(),
);

export const subscribeSuccess = createAction(
  '[Subscription] Subscribe Success',
  props<{ subscription: any }>(),
);

export const subscribeFailure = createAction(
  '[Subscription] Subscribe Failure',
  props<{ error: NormalizedApiPayload | string }>(),
);

export const cancel = createAction(
  '[Subscription] Cancel',
  props<{ reason?: string }>(),
);

export const cancelSuccess = createAction(
  '[Subscription] Cancel Success',
  props<{ subscription: any }>(),
);

export const cancelFailure = createAction(
  '[Subscription] Cancel Failure',
  props<{ error: NormalizedApiPayload | string }>(),
);

export const changePlan = createAction(
  '[Subscription] Change Plan',
  props<{ planId: string }>(),
);

export const changePlanSuccess = createAction(
  '[Subscription] Change Plan Success',
  props<{ subscription: any }>(),
);

export const changePlanFailure = createAction(
  '[Subscription] Change Plan Failure',
  props<{ error: NormalizedApiPayload | string }>(),
);

export const checkoutPreview = createAction(
  '[Subscription] Checkout Preview',
  props<{ planId: string }>(),
);

export const checkoutPreviewSuccess = createAction(
  '[Subscription] Checkout Preview Success',
  props<{ preview: any }>(),
);

export const checkoutPreviewFailure = createAction(
  '[Subscription] Checkout Preview Failure',
  props<{ error: NormalizedApiPayload | string }>(),
);

export const checkoutCommit = createAction(
  '[Subscription] Checkout Commit',
  props<{ planId: string; paymentMethodId?: string }>(),
);

export const checkoutCommitSuccess = createAction(
  '[Subscription] Checkout Commit Success',
  props<{ subscription: any }>(),
);

export const checkoutCommitFailure = createAction(
  '[Subscription] Checkout Commit Failure',
  props<{ error: NormalizedApiPayload | string }>(),
);

export const loadInvoices = createAction('[Subscription] Load Invoices');

export const loadInvoicesSuccess = createAction(
  '[Subscription] Load Invoices Success',
  props<{ invoices: any[] }>(),
);

export const loadInvoicesFailure = createAction(
  '[Subscription] Load Invoices Failure',
  props<{ error: NormalizedApiPayload | string }>(),
);

export const loadSubscription = createAction(
  '[Subscription] Load Subscription',
);

export const loadSubscriptionSuccess = createAction(
  '[Subscription] Load Subscription Success',
  props<{ subscription: any }>(),
);

export const loadSubscriptionFailure = createAction(
  '[Subscription] Load Subscription Failure',
  props<{ error: any }>(),
);

export const subscriptionUpdated = createAction(
  '[Subscription] Subscription Updated',
  props<{ subscription: any }>(),
);

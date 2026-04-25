import { createReducer, on } from '@ngrx/store';
import * as SubscriptionActions from './subscription.actions';
import { NormalizedApiPayload } from '../../utils/api-error-handler';

export interface SubscriptionState {
  current: any | null;
  status: string;
  daysUntilDue: number;
  featureMatrix: Record<string, any>;
  access: any | null;
  loaded: boolean;
  loading: boolean;
  error: NormalizedApiPayload | string | null;
  invoices: any[];
  preview: any | null;
}

export const initialSubscriptionState: SubscriptionState = {
  current: null,
  status: 'none',
  daysUntilDue: 0,
  featureMatrix: {},
  access: null,
  loaded: false,
  loading: false,
  error: null,
  invoices: [],
  preview: null,
};

export const subscriptionReducer = createReducer(
  initialSubscriptionState,

  on(SubscriptionActions.loadCurrent, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(SubscriptionActions.loadCurrentSuccess, (state, { subscription }) => ({
    ...state,
    current: subscription,
    status: subscription?.status ?? state.status,
    daysUntilDue: subscription?.daysUntilDue ?? state.daysUntilDue,
    featureMatrix: subscription?.featureMatrix ?? state.featureMatrix,
    loaded: true,
    loading: false,
    error: null,
  })),

  on(SubscriptionActions.loadCurrentFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(SubscriptionActions.loadAccess, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(SubscriptionActions.loadAccessSuccess, (state, { access }) => ({
    ...state,
    access,
    loading: false,
    error: null,
  })),

  on(SubscriptionActions.loadAccessFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(SubscriptionActions.subscribe, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(SubscriptionActions.subscribeSuccess, (state, { subscription }) => ({
    ...state,
    current: subscription,
    status: subscription?.status ?? state.status,
    daysUntilDue: subscription?.daysUntilDue ?? state.daysUntilDue,
    featureMatrix: subscription?.featureMatrix ?? state.featureMatrix,
    loaded: true,
    loading: false,
    error: null,
  })),

  on(SubscriptionActions.subscribeFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(SubscriptionActions.cancel, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(SubscriptionActions.cancelSuccess, (state, { subscription }) => ({
    ...state,
    current: subscription,
    status: subscription?.status ?? state.status,
    loaded: true,
    loading: false,
    error: null,
  })),

  on(SubscriptionActions.cancelFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(SubscriptionActions.changePlan, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(SubscriptionActions.changePlanSuccess, (state, { subscription }) => ({
    ...state,
    current: subscription,
    status: subscription?.status ?? state.status,
    daysUntilDue: subscription?.daysUntilDue ?? state.daysUntilDue,
    featureMatrix: subscription?.featureMatrix ?? state.featureMatrix,
    loaded: true,
    loading: false,
    error: null,
  })),

  on(SubscriptionActions.changePlanFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(SubscriptionActions.checkoutPreview, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(SubscriptionActions.checkoutPreviewSuccess, (state, { preview }) => ({
    ...state,
    preview,
    loading: false,
    error: null,
  })),

  on(SubscriptionActions.checkoutPreviewFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(SubscriptionActions.checkoutCommit, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(SubscriptionActions.checkoutCommitSuccess, (state, { subscription }) => ({
    ...state,
    current: subscription,
    status: subscription?.status ?? state.status,
    daysUntilDue: subscription?.daysUntilDue ?? state.daysUntilDue,
    featureMatrix: subscription?.featureMatrix ?? state.featureMatrix,
    preview: null,
    loaded: true,
    loading: false,
    error: null,
  })),

  on(SubscriptionActions.checkoutCommitFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(SubscriptionActions.loadInvoices, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(SubscriptionActions.loadInvoicesSuccess, (state, { invoices }) => ({
    ...state,
    invoices,
    loading: false,
    error: null,
  })),

  on(SubscriptionActions.loadInvoicesFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(SubscriptionActions.loadSubscription, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(SubscriptionActions.loadSubscriptionSuccess, (state, { subscription }) => ({
    ...state,
    current: subscription,
    status: subscription?.status ?? subscription?.state ?? state.status,
    daysUntilDue: subscription?.daysUntilDue ?? state.daysUntilDue,
    featureMatrix: subscription?.resolved_features ?? subscription?.featureMatrix ?? {},
    loaded: true,
    loading: false,
    error: null,
  })),

  on(SubscriptionActions.loadSubscriptionFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(SubscriptionActions.subscriptionUpdated, (state, { subscription }) => ({
    ...state,
    current: subscription,
    status: subscription?.status ?? subscription?.state ?? state.status,
    daysUntilDue: subscription?.daysUntilDue ?? state.daysUntilDue,
    featureMatrix: subscription?.resolved_features ?? subscription?.featureMatrix ?? state.featureMatrix,
    loaded: true,
    loading: false,
    error: null,
  })),
);

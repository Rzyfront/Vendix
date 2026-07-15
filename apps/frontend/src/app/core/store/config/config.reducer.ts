import { createReducer, on } from '@ngrx/store';
import { AppConfig } from '../../services/app-config.service';
import * as ConfigActions from './config.actions';
import type { DomainResolutionErrorKind } from './config.actions';

export interface ConfigState {
  appConfig: AppConfig | null;
  loading: boolean;
  error: any;
  /** Fallo tipado de resolución de dominio/app_type (null si no hay error). */
  resolutionError: { kind: DomainResolutionErrorKind } | null;
}

export const initialConfigState: ConfigState = {
  appConfig: null,
  loading: true, // Inicia en true porque la app siempre se inicializa al cargar
  error: null,
  resolutionError: null,
};

export const configReducer = createReducer(
  initialConfigState,

  on(ConfigActions.initializeApp, (state) => ({
    ...state,
    loading: true,
    error: null,
    resolutionError: null,
  })),

  on(ConfigActions.retryResolution, (state) => ({
    ...state,
    loading: true,
    error: null,
    resolutionError: null,
  })),

  on(ConfigActions.initializeAppSuccess, (state, { config }) => ({
    ...state,
    appConfig: config,
    loading: false,
    error: null,
    resolutionError: null,
  })),

  on(ConfigActions.initializeAppFailure, (state, { error }) => ({
    ...state,
    appConfig: null,
    loading: false,
    error,
    resolutionError: { kind: error.kind },
  })),

  on(ConfigActions.updateEnvironment, (state, { environment }) => {
    if (!state.appConfig) return state;
    return {
      ...state,
      appConfig: {
        ...state.appConfig,
        environment: environment,
        domainConfig: {
          ...state.appConfig.domainConfig,
          environment: environment,
        },
      },
    };
  }),
);

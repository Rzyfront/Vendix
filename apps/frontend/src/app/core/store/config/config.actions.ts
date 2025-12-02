import { createAction, props } from '@ngrx/store';
import { AppConfig } from '../../services/app-config.service';
import { AppEnvironment } from '../../models/domain-config.interface';

export const initializeApp = createAction('[Config] Initialize App');

export const initializeAppSuccess = createAction(
  '[Config] Initialize App Success',
  props<{ config: AppConfig }>(),
);

export const initializeAppFailure = createAction(
  '[Config] Initialize App Failure',
  props<{ error: any }>(),
);

export const updateEnvironment = createAction(
  '[Config] Update Environment',
  props<{ environment: AppEnvironment }>(),
);

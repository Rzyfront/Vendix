import { InjectionToken } from '@angular/core';

export interface DialogConfig {
  hasBackdrop?: boolean;
  backdropClass?: string;
  panelClass?: string;
  closeOnBackdropClick?: boolean;
}

export const DIALOG_CONFIG = new InjectionToken<DialogConfig>('DIALOG_CONFIG');
export const DIALOG_DATA = new InjectionToken<any>('DIALOG_DATA');

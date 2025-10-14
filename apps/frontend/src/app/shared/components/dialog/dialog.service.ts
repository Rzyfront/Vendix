import { Injectable } from '@angular/core';

export interface DialogConfig {
  hasBackdrop?: boolean;
  backdropClass?: string;
  panelClass?: string;
  closeOnBackdropClick?: boolean;
}

export interface ConfirmData {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
}

export interface PromptData {
  title: string;
  message: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
}

@Injectable({ providedIn: 'root' })
export class DialogService {
  confirm(data: ConfirmData, config: DialogConfig = {}): Promise<boolean> {
    console.warn('DialogService.confirm not implemented:', data, config);
    return Promise.resolve(false);
  }

  prompt(data: PromptData, config: DialogConfig = {}): Promise<string | undefined> {
    console.warn('DialogService.prompt not implemented:', data, config);
    return Promise.resolve(undefined);
  }
}

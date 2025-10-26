import {
  Injectable,
  createComponent,
  EnvironmentInjector,
  ApplicationRef,
} from '@angular/core';
import { ConfirmationModalComponent } from '../confirmation-modal/confirmation-modal.component';

export interface DialogConfig {
  hasBackdrop?: boolean;
  backdropClass?: string;
  panelClass?: string;
  closeOnBackdropClick?: boolean;
  size?: 'sm' | 'md' | 'lg';
  centered?: boolean;
  showCloseButton?: boolean;
  customClasses?: string;
}

export interface ConfirmData {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: 'primary' | 'danger';
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
  constructor(
    private injector: EnvironmentInjector,
    private appRef: ApplicationRef,
  ) {}

  confirm(data: ConfirmData, config: DialogConfig = {}): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const componentRef = createComponent(ConfirmationModalComponent, {
        environmentInjector: this.injector,
      });

      componentRef.instance.title = data.title;
      componentRef.instance.message = data.message;
      if (data.confirmText)
        componentRef.instance.confirmText = data.confirmText;
      if (data.cancelText) componentRef.instance.cancelText = data.cancelText;
      if (data.confirmVariant)
        componentRef.instance.confirmVariant = data.confirmVariant;

      const sub = componentRef.instance.confirm.subscribe(() => {
        resolve(true);
        sub.unsubscribe();
        this.appRef.detachView(componentRef.hostView);
        componentRef.destroy();
      });

      const subCancel = componentRef.instance.cancel.subscribe(() => {
        resolve(false);
        subCancel.unsubscribe();
        this.appRef.detachView(componentRef.hostView);
        componentRef.destroy();
      });

      this.appRef.attachView(componentRef.hostView);
      const domElem = (componentRef.hostView as any)
        .rootNodes[0] as HTMLElement;
      document.body.appendChild(domElem);
    });
  }

  prompt(
    data: PromptData,
    config: DialogConfig = {},
  ): Promise<string | undefined> {
    console.warn('DialogService.prompt not implemented:', data, config);
    return Promise.resolve(undefined);
  }
}

import {
  Injectable,
  createComponent,
  EnvironmentInjector,
  ApplicationRef,
} from '@angular/core';
import { ConfirmationModalComponent } from '../confirmation-modal/confirmation-modal.component';
import { PromptModalComponent } from '../prompt-modal/prompt-modal.component';

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
  inputType?: 'text' | 'number';
}

@Injectable({ providedIn: 'root' })
export class DialogService {
  constructor(
    private injector: EnvironmentInjector,
    private appRef: ApplicationRef,
  ) {}

  private setSignalValue(instance: any, key: string, value: any): void {
    const prop = instance[key];
    if (prop && typeof prop === 'function') {
      const signal = prop as any;
      if (typeof signal.set === 'function') {
        signal.set(value);
      } else if (typeof signal.update === 'function') {
        signal.update(() => value);
      }
    }
  }

  confirm(data: ConfirmData, config: DialogConfig = {}): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const componentRef = createComponent(ConfirmationModalComponent, {
        environmentInjector: this.injector,
      });
      this.setSignalValue(componentRef.instance, 'title', data.title);
      this.setSignalValue(componentRef.instance, 'message', data.message);
      if (data.confirmText)
        this.setSignalValue(
          componentRef.instance,
          'confirmText',
          data.confirmText,
        );
      if (data.cancelText)
        this.setSignalValue(
          componentRef.instance,
          'cancelText',
          data.cancelText,
        );
      if (data.confirmVariant)
        this.setSignalValue(
          componentRef.instance,
          'confirmVariant',
          data.confirmVariant,
        );
      if (config.size)
        this.setSignalValue(componentRef.instance, 'size', config.size);
      if (config.showCloseButton !== undefined)
        this.setSignalValue(
          componentRef.instance,
          'showCloseButton',
          config.showCloseButton,
        );
      if (config.customClasses)
        this.setSignalValue(
          componentRef.instance,
          'customClasses',
          config.customClasses,
        );
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
    return new Promise<string | undefined>((resolve) => {
      const componentRef = createComponent(PromptModalComponent, {
        environmentInjector: this.injector,
      });
      this.setSignalValue(componentRef.instance, 'title', data.title);
      this.setSignalValue(componentRef.instance, 'message', data.message);
      this.setSignalValue(
        componentRef.instance,
        'placeholder',
        data.placeholder || '',
      );
      this.setSignalValue(
        componentRef.instance,
        'defaultValue',
        data.defaultValue || '',
      );
      if (data.confirmText)
        this.setSignalValue(
          componentRef.instance,
          'confirmText',
          data.confirmText,
        );
      if (data.cancelText)
        this.setSignalValue(
          componentRef.instance,
          'cancelText',
          data.cancelText,
        );
      if (data.inputType)
        this.setSignalValue(componentRef.instance, 'inputType', data.inputType);
      if (config.size)
        this.setSignalValue(componentRef.instance, 'size', config.size);
      if (config.showCloseButton !== undefined)
        this.setSignalValue(
          componentRef.instance,
          'showCloseButton',
          config.showCloseButton,
        );
      if (config.customClasses)
        this.setSignalValue(
          componentRef.instance,
          'customClasses',
          config.customClasses,
        );
      const sub = componentRef.instance.confirm.subscribe((value: string) => {
        resolve(value);
        sub.unsubscribe();
        this.appRef.detachView(componentRef.hostView);
        componentRef.destroy();
      });
      const subCancel = componentRef.instance.cancel.subscribe(() => {
        resolve(undefined);
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
}

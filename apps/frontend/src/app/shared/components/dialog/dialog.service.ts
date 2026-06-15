import {
  Injectable,
  ComponentRef,
  createComponent,
  EnvironmentInjector,
  ApplicationRef,
  DestroyRef,
  inject,
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
  private destroyRef = inject(DestroyRef);

  constructor(
    private injector: EnvironmentInjector,
    private appRef: ApplicationRef,
  ) {}

  /**
   * Escribe un input del componente creado dinámicamente.
   *
   * IMPORTANTE: los modales declaran sus props con `input()` (read-only), que NO
   * exponen `.set()`/`.update()`. La forma oficial de escribir un input de un
   * componente creado por `createComponent` es `ComponentRef.setInput()` — que
   * además funciona para `model()`. Antes esto usaba `signal.set()` sobre la
   * instancia, lo que fallaba en silencio y dejaba todos los modales con sus
   * valores por defecto (título genérico, mensaje vacío). Solo escribe cuando el
   * valor está definido para no pisar los defaults del componente.
   */
  private setInput(ref: ComponentRef<unknown>, key: string, value: unknown): void {
    if (value !== undefined) {
      ref.setInput(key, value);
    }
  }

  confirm(data: ConfirmData, config: DialogConfig = {}): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const componentRef = createComponent(ConfirmationModalComponent, {
        environmentInjector: this.injector,
      });
      this.setInput(componentRef, 'title', data.title);
      this.setInput(componentRef, 'message', data.message);
      this.setInput(componentRef, 'confirmText', data.confirmText);
      this.setInput(componentRef, 'cancelText', data.cancelText);
      this.setInput(componentRef, 'confirmVariant', data.confirmVariant);
      this.setInput(componentRef, 'size', config.size);
      this.setInput(componentRef, 'showCloseButton', config.showCloseButton);
      this.setInput(componentRef, 'customClasses', config.customClasses);

      let sub: any;
      let subCancel: any;

      const cleanup = () => {
        sub?.unsubscribe();
        subCancel?.unsubscribe();
        this.appRef.detachView(componentRef.hostView);
        componentRef.destroy();
      };

      this.destroyRef.onDestroy(() => cleanup());

      sub = componentRef.instance.confirm.subscribe(() => {
        resolve(true);
        cleanup();
      });
      subCancel = componentRef.instance.cancel.subscribe(() => {
        resolve(false);
        cleanup();
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
      this.setInput(componentRef, 'title', data.title);
      this.setInput(componentRef, 'message', data.message);
      this.setInput(componentRef, 'placeholder', data.placeholder || '');
      this.setInput(componentRef, 'defaultValue', data.defaultValue || '');
      this.setInput(componentRef, 'confirmText', data.confirmText);
      this.setInput(componentRef, 'cancelText', data.cancelText);
      this.setInput(componentRef, 'inputType', data.inputType);
      this.setInput(componentRef, 'size', config.size);
      this.setInput(componentRef, 'showCloseButton', config.showCloseButton);
      this.setInput(componentRef, 'customClasses', config.customClasses);

      let sub: any;
      let subCancel: any;

      const cleanup = () => {
        sub?.unsubscribe();
        subCancel?.unsubscribe();
        this.appRef.detachView(componentRef.hostView);
        componentRef.destroy();
      };

      this.destroyRef.onDestroy(() => cleanup());

      sub = componentRef.instance.confirm.subscribe((value: string) => {
        resolve(value);
        cleanup();
      });
      subCancel = componentRef.instance.cancel.subscribe(() => {
        resolve(undefined);
        cleanup();
      });
      this.appRef.attachView(componentRef.hostView);
      const domElem = (componentRef.hostView as any)
        .rootNodes[0] as HTMLElement;
      document.body.appendChild(domElem);
    });
  }
}

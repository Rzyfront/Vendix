import {
  Injectable,
  ComponentRef,
  createComponent,
  EnvironmentInjector,
  ApplicationRef,
  DestroyRef,
  inject,
  signal,
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

/**
 * A `confirm()` dialog waiting on a human (U-6).
 *
 * Published so Vexi's dispatcher can answer it from the chat — without this
 * the turn degrades to a `needs_user_input` dead end. `danger` mirrors the
 * modal's `confirmVariant`: when true the dispatcher only accepts with the
 * consequence written by the person, never on the model's own judgement.
 */
export interface VexiPendingConfirm {
  message: string;
  confirmText: string;
  danger: boolean;
}

@Injectable({ providedIn: 'root' })
export class DialogService {
  private destroyRef = inject(DestroyRef);

  /**
   * The currently pending `confirm()` dialog, or null when there is none.
   *
   * Read-only from the outside: only `confirm()` publishes and only the
   * dialog's own resolution (click or `vexiResolvePending`) clears it, so a
   * stale entry can never outlive its modal.
   */
  readonly pendingConfirm = signal<VexiPendingConfirm | null>(null);

  private pendingResolve: ((value: boolean) => void) | null = null;
  private pendingCleanup: (() => void) | null = null;

  constructor(
    private injector: EnvironmentInjector,
    private appRef: ApplicationRef,
  ) {}

  /**
   * Answers the pending `confirm()` from the Vexi chat (U-6).
   *
   * Returns false when there is nothing pending — the dispatcher reports
   * `no_pending_confirm` then. Resolving through the same promise the clicks
   * use is what keeps the caller's `await` contract intact: the host code
   * cannot tell a chat answer from a click.
   */
  vexiResolvePending(accept: boolean): boolean {
    const resolve = this.pendingResolve;
    const cleanup = this.pendingCleanup;
    if (!resolve || !this.pendingConfirm()) return false;
    this.pendingResolve = null;
    this.pendingCleanup = null;
    this.pendingConfirm.set(null);
    resolve(accept);
    cleanup?.();
    return true;
  }

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

      // Published for Vexi (U-6) and cleared on every resolution path, so the
      // signal never claims a dialog is pending after its modal is gone.
      this.pendingResolve = resolve;
      this.pendingCleanup = cleanup;
      this.pendingConfirm.set({
        message: data.message,
        confirmText: data.confirmText ?? 'Confirmar',
        danger: data.confirmVariant === 'danger',
      });

      const settle = (value: boolean) => {
        this.pendingResolve = null;
        this.pendingCleanup = null;
        this.pendingConfirm.set(null);
        resolve(value);
        cleanup();
      };

      this.destroyRef.onDestroy(() => cleanup());

      sub = componentRef.instance.confirm.subscribe(() => settle(true));
      subCancel = componentRef.instance.cancel.subscribe(() => settle(false));
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

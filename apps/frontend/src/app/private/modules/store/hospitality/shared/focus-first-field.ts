import { DestroyRef, ElementRef, inject } from '@angular/core';

/** app-modal first moves the focus to its own container (QUI-746); wait for it. */
const AFTER_MODAL_FOCUS_MS = 250;

const EDITABLE =
  'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])';

/**
 * R-FORM-05 — a form modal opens on its first field. Returns a function that
 * focuses the first editable element inside the first `[data-autofocus]` of
 * this component, once app-modal is done with its own focus. A pending focus
 * is replaced by the next call and cancelled when the component is destroyed.
 * Call it in an injection context (a field initializer).
 */
export function injectFocusFirstField(): () => void {
  const host: HTMLElement = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  let timer: ReturnType<typeof setTimeout> | undefined;
  inject(DestroyRef).onDestroy(() => clearTimeout(timer));
  return () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      host
        .querySelector('[data-autofocus]')
        ?.querySelector<HTMLElement>(EDITABLE)
        ?.focus();
    }, AFTER_MODAL_FOCUS_MS);
  };
}

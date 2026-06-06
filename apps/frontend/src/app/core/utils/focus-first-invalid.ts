import { ElementRef } from '@angular/core';

/**
 * Moves keyboard focus to the first invalid form control inside `host`.
 *
 * Intended to be called right after `form.markAllTouched()` in a step's
 * `submit()` when validation fails, so the user is taken to the offending
 * field instead of having to hunt for it. The lookup is deferred with
 * `queueMicrotask` so Angular has flushed the `.ng-invalid` classes triggered
 * by marking the controls as touched before we query the DOM.
 *
 * Zoneless-safe: no zone scheduling, no manual change detection — a `.focus()`
 * call is a pure DOM side effect that does not require Angular's involvement.
 *
 * @param host The component's `ElementRef` (its DOM subtree is searched).
 */
export function focusFirstInvalid(host: ElementRef<HTMLElement>): void {
  queueMicrotask(() => {
    const target = host.nativeElement.querySelector<HTMLElement>(
      '.ng-invalid:not(form)',
    );
    target?.focus();
  });
}

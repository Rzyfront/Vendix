import { ElementRef } from '@angular/core';

/** Optional behavior tweaks for {@link focusFirstInvalid}. All default to the original behavior. */
export interface FocusFirstInvalidOptions {
  /**
   * When true, smooth-scrolls the target into the viewport center before
   * focusing it. Defaults to false (no scroll) to keep every existing call
   * site's behavior unchanged.
   */
  scroll?: boolean;
}

/**
 * Moves keyboard focus to the first invalid form control inside `host`.
 *
 * Intended to be called right after `form.markAllTouched()` in a step's
 * `submit()` when validation fails, so the user is taken to the offending
 * field instead of having to hunt for it. The lookup is deferred with
 * `queueMicrotask` so Angular has flushed the `.ng-invalid` classes triggered
 * by marking the controls as touched before we query the DOM.
 *
 * The matched `.ng-invalid` element is often a custom CVA wrapper host (e.g.
 * `app-input`, `app-selector`) — Angular's `NgControlStatus` classes land on
 * the host, not on the native control inside it. If the matched element is
 * not itself a focusable `input`/`select`/`textarea`, we drill into it for
 * one, falling back to the matched element so behavior never regresses for
 * call sites where the class already lands on a native control.
 *
 * Zoneless-safe: no zone scheduling, no manual change detection — a `.focus()`
 * call is a pure DOM side effect that does not require Angular's involvement.
 *
 * @param host The component's `ElementRef` (its DOM subtree is searched).
 * @param options Optional behavior tweaks (see {@link FocusFirstInvalidOptions}). Omit for the original behavior.
 */
export function focusFirstInvalid(
  host: ElementRef<HTMLElement>,
  options?: FocusFirstInvalidOptions,
): void {
  queueMicrotask(() => {
    const target = host.nativeElement.querySelector<HTMLElement>(
      '.ng-invalid:not(form)',
    );
    if (!target) return;

    const focusable = target.matches('input,select,textarea')
      ? target
      : (target.querySelector<HTMLElement>('input,select,textarea') ?? target);

    if (options?.scroll) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    focusable.focus();
  });
}

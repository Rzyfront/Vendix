import { Injector, Signal, computed } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, AsyncValidatorFn, ValidationErrors } from '@angular/forms';
import {
  Observable,
  catchError,
  map,
  merge,
  of,
  scan,
  startWith,
  switchMap,
  timer,
} from 'rxjs';

/** Shape returned by every `GET .../username-availability` endpoint (`data`). */
export interface UsernameAvailability {
  available: boolean;
  reason?: 'taken' | 'invalid';
}

export type UsernameAvailabilityCheck = (
  username: string,
  excludeUserId?: number,
) => Observable<UsernameAvailability>;

export interface UsernameAvailabilityOptions {
  /** Current persisted username (edit mode). Equal values skip the request. */
  originalValue?: () => string | null | undefined;
  /** Id of the user being edited, excluded from the uniqueness check. */
  excludeUserId?: () => number | undefined;
  /** Debounce before hitting the API. Default 400 ms. */
  debounceMs?: number;
}

export const USERNAME_DEFAULT_DEBOUNCE_MS = 400;

/**
 * Async validator that checks username availability against the backend.
 *
 * - Debounced via `timer()`: Angular unsubscribes the previous async validator
 *   observable when the value changes, so the timer and any in-flight request
 *   are cancelled (stale results never apply).
 * - Empty values and values equal (trimmed, case-insensitive) to the original
 *   are valid without a request.
 * - A failed check never blocks the user (returns `null`); the backend 409
 *   `USER_USERNAME_TAKEN` remains the safety net.
 * - Errors: `{ usernameTaken: true }` or `{ usernameInvalid: true }`.
 */
export function usernameAvailabilityValidator(
  check: UsernameAvailabilityCheck,
  options: UsernameAvailabilityOptions = {},
): AsyncValidatorFn {
  const debounceMs = options.debounceMs ?? USERNAME_DEFAULT_DEBOUNCE_MS;

  return (control: AbstractControl): Observable<ValidationErrors | null> => {
    const raw = control.value;
    const username = typeof raw === 'string' ? raw.trim() : '';
    if (!username) return of(null);

    const original = options.originalValue?.()?.trim();
    if (original && original.toLowerCase() === username.toLowerCase()) {
      return of(null);
    }

    return timer(debounceMs).pipe(
      switchMap(() => check(username, options.excludeUserId?.())),
      map((res): ValidationErrors | null => {
        if (res.available) return null;
        return res.reason === 'invalid'
          ? { usernameInvalid: true }
          : { usernameTaken: true };
      }),
      catchError(() => of(null)),
    );
  };
}

export const USERNAME_TAKEN_MESSAGE = 'No disponible, elige otro';
export const USERNAME_INVALID_MESSAGE =
  'Nombre de usuario no válido. Usa de 3 a 50 caracteres (letras, números y guion bajo).';

export interface UsernameFieldState {
  /** `true` while the availability check is running. */
  pending: Signal<boolean>;
  /** `true` when the (changed, non-empty, dirty) username was confirmed free. */
  available: Signal<boolean>;
  /** Message for the async errors (taken / invalid), `null` otherwise. */
  error: Signal<string | null>;
}

/**
 * Bridges a username control's async state into signals so zoneless templates
 * re-render when the check starts/finishes. Must run in an injection context
 * (constructor or field initializer) because it uses `toSignal`; otherwise pass
 * an `injector` (e.g. when the form is built in `ngOnInit`).
 */
export function createUsernameFieldState(
  control: AbstractControl,
  originalValue: () => string | null | undefined = () => null,
  injector?: Injector,
): UsernameFieldState {
  // Counter bumps on every value/status emission so the computeds below
  // re-read the (non-signal) control state.
  const version = toSignal(
    merge(control.statusChanges, control.valueChanges).pipe(
      scan((n) => n + 1, 0),
      startWith(0),
    ),
    { initialValue: 0, injector },
  );

  const pending = computed(() => (version(), control.pending));

  const available = computed(() => {
    version();
    const value = typeof control.value === 'string' ? control.value.trim() : '';
    if (!value || !control.dirty || !control.valid) return false;
    const original = originalValue()?.trim().toLowerCase();
    return value.toLowerCase() !== original;
  });

  const error = computed(() => {
    version();
    if (control.hasError('usernameTaken')) return USERNAME_TAKEN_MESSAGE;
    if (control.hasError('usernameInvalid')) return USERNAME_INVALID_MESSAGE;
    return null;
  });

  return { pending, available, error };
}

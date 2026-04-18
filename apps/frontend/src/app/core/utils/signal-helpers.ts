import { toSignal } from '@angular/core/rxjs-interop';
import { Signal } from '@angular/core';
import { Observable } from 'rxjs';

export function safeToSignal<T>(source$: Observable<T>, initialValue: T): Signal<T> {
  return toSignal(source$, { initialValue });
}

export function safeToSignalFromStore<T>(selector$: Observable<T>, initialValue: T): Signal<T> {
  return toSignal(selector$, { initialValue });
}
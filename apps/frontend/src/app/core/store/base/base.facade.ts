import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { BaseState } from './base.reducer';
import * as BaseActions from './base.actions';
import { extractApiErrorMessage } from '../../utils/api-error-handler';

@Injectable()
export class BaseFacade<T = any> {
  protected store = inject(Store<BaseState<T>>);

  // Observable selectors (to be overridden in concrete implementations)
  readonly data$ = this.store.select((state: BaseState<T>) => state.data);
  readonly loading$ = this.store.select((state: BaseState<T>) => state.loading);
  readonly error$ = this.store.select((state: BaseState<T>) => state.error);
  readonly lastUpdated$ = this.store.select(
    (state: BaseState<T>) => state.lastUpdated,
  );

  // ─── Signal parallels (Angular 20 — backward compatible) ──────────────────
  readonly data = toSignal(this.data$, { initialValue: null as T | null });
  readonly loading = toSignal(this.loading$, { initialValue: false });
  readonly error = toSignal(this.error$, { initialValue: null });
  readonly lastUpdated = toSignal(this.lastUpdated$, { initialValue: null as Date | null });

  // Actions
  loadData(id?: string, params?: any): void {
    this.store.dispatch(BaseActions.loadData({ id, params }));
  }

  createData(data: T): void {
    this.store.dispatch(BaseActions.createData({ data }));
  }

  updateData(id: string, data: Partial<T>): void {
    this.store.dispatch(BaseActions.updateData({ id, data }));
  }

  deleteData(id: string): void {
    this.store.dispatch(BaseActions.deleteData({ id }));
  }

  clearData(): void {
    this.store.dispatch(BaseActions.clearData());
  }

  setLoading(loading: boolean): void {
    this.store.dispatch(BaseActions.setLoading({ loading }));
  }

  setError(error: any): void {
    this.store.dispatch(BaseActions.setError({ error }));
  }

  clearError(): void {
    this.store.dispatch(BaseActions.clearError());
  }

  // Synchronous getters for templates
  getCurrentData(): T | null {
    return this.data() ?? null;
  }

  isLoading(): boolean {
    return this.loading();
  }

  getCurrentError(): any {
    const error = this.error();
    if (error === null || error === undefined) {
      return null;
    } else if (typeof error === 'string') {
      return error;
    } else {
      return extractApiErrorMessage(error);
    }
  }

  hasData(): boolean {
    return this.getCurrentData() !== null;
  }

  hasError(): boolean {
    return this.getCurrentError() !== null;
  }

  // Utility methods
  reload(): void {
    this.loadData();
  }

  reset(): void {
    this.clearData();
    this.clearError();
  }
}

import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
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
    let result: T | null = null;
    this.data$.subscribe((data) => (result = data)).unsubscribe();
    return result;
  }

  isLoading(): boolean {
    let result = false;
    this.loading$.subscribe((loading) => (result = loading)).unsubscribe();
    return result;
  }

  getCurrentError(): any {
    let result: any = null;
    this.error$
      .subscribe((error) => {
        if (error === null) {
          result = null;
        } else if (typeof error === 'string') {
          result = error;
        } else {
          // Handle NormalizedApiPayload by extracting the message
          result = extractApiErrorMessage(error);
        }
      })
      .unsubscribe();
    return result;
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

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, BehaviorSubject, throwError } from 'rxjs';
import {
  debounceTime,
  distinctUntilChanged,
  switchMap,
  takeUntil,
  map,
  catchError,
  tap,
} from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import { Store } from '@ngrx/store';
import {
  ApiResponse,
  StoreSettings,
} from '../../../../../../core/models/store-settings.interface';
import * as AuthActions from '../../../../../../core/store/auth/auth.actions';
import { CurrencyFormatService } from '../../../../../../shared/pipes';

@Injectable({
  providedIn: 'root',
})
export class StoreSettingsService {
  private http = inject(HttpClient);
  private store = inject(Store);
  private currencyFormatService = inject(CurrencyFormatService);
  private readonly api_base_url = `${environment.apiUrl}/store`;

  private save_settings$$ = new Subject<Partial<StoreSettings>>();
  private destroy$$ = new Subject<void>();

  private settings$$ = new BehaviorSubject<StoreSettings | null>(null);
  settings$ = this.settings$$.asObservable();

  private auto_save_error$$ = new Subject<Error>();
  autoSaveError$ = this.auto_save_error$$.asObservable();

  constructor() {
    this.setupAutoSave();
  }

  private setupAutoSave() {
    this.save_settings$$
      .pipe(
        debounceTime(2500),
        distinctUntilChanged(
          (prev, curr) => JSON.stringify(prev) === JSON.stringify(curr),
        ),
        switchMap((settings) =>
          this.update_settings_api(settings).pipe(
            catchError((error) => {
              console.error('Error saving settings:', error);
              this.auto_save_error$$.next(error);
              return throwError(() => error);
            }),
          ),
        ),
        takeUntil(this.destroy$$),
      )
      .subscribe({
        next: (response: ApiResponse<StoreSettings>) => {
          console.log('Settings saved successfully:', response);
          // Update local BehaviorSubject
          this.settings$$.next(response.data);
          // Dispatch success action directly to update NgRx store
          this.store.dispatch(AuthActions.updateStoreSettingsSuccess({ store_settings: response.data }));

          // Refrescar moneda si cambió la configuración de moneda
          if (response.data?.general?.currency) {
            this.currencyFormatService.refresh();
          }
        },
      });
  }

  getSettings(): Observable<ApiResponse<StoreSettings>> {
    return this.http
      .get<ApiResponse<StoreSettings>>(
        `${this.api_base_url}/settings`,
      )
      .pipe(
        map((response) => response || { success: true, data: null }),
        catchError(this.handleError)
      );
  }

  /**
   * Dispara el auto-guardado con debounce.
   * El flujo de auto-save ya está configurado en setupAutoSave().
   * Suscríbete a settings$ para recibir notificaciones cuando el guardado se complete.
   */
  triggerAutoSave(settings: Partial<StoreSettings>): void {
    this.save_settings$$.next(settings);
  }

  saveSettingsNow(
    settings: Partial<StoreSettings>,
  ): Observable<ApiResponse<StoreSettings>> {
    return this.update_settings_api(settings);
  }

  resetToDefault(): Observable<ApiResponse<StoreSettings>> {
    return this.http
      .post<ApiResponse<StoreSettings>>(
        `${this.api_base_url}/settings/reset`,
        {},
      )
      .pipe(
        map((response) => response || { success: true, data: null }),
        catchError(this.handleError)
      );
  }

  getSystemTemplates(): Observable<ApiResponse<any[]>> {
    return this.http
      .get<ApiResponse<any[]>>(
        `${this.api_base_url}/settings/templates`,
      )
      .pipe(
        map((response) => response || { success: true, data: [] }),
        catchError(this.handleError)
      );
  }

  applyTemplate(template_name: string): Observable<ApiResponse<StoreSettings>> {
    return this.http
      .post<ApiResponse<StoreSettings>>(
        `${this.api_base_url}/settings/apply-template`,
        { template_name },
      )
      .pipe(
        map((response) => response || { success: true, data: null }),
        catchError(this.handleError)
      );
  }

  private update_settings_api(
    settings: Partial<StoreSettings>,
  ): Observable<ApiResponse<StoreSettings>> {
    return this.http
      .patch<ApiResponse<StoreSettings>>(
        `${this.api_base_url}/settings`,
        settings,
      )
      .pipe(
        map((response) => response || { success: true, data: null }),
        catchError(this.handleError)
      );
  }

  private handleError(error: any): Observable<never> {
    let error_message = 'An unknown error occurred';

    if (error.error instanceof ErrorEvent) {
      error_message = error.error.message;
    } else if (error.error && error.error.message) {
      error_message = error.error.message;
    } else if (error.message) {
      error_message = error.message;
    }

    console.error('StoreSettingsService error:', error);
    return throwError(() => new Error(error_message));
  }

  ngOnDestroy() {
    this.destroy$$.next();
    this.destroy$$.complete();
  }
}

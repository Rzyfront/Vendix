import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, BehaviorSubject } from 'rxjs';
import {
  debounceTime,
  distinctUntilChanged,
  switchMap,
  takeUntil,
} from 'rxjs/operators';
import {
  ApiResponse,
  StoreSettings,
} from '../../../../../../core/models/store-settings.interface';

@Injectable({
  providedIn: 'root',
})
export class StoreSettingsService {
  private http = inject(HttpClient);
  private api_url = '/api';

  private save_settings$$ = new Subject<Partial<StoreSettings>>();
  private destroy$$ = new Subject<void>();

  private settings$$ = new BehaviorSubject<StoreSettings | null>(null);
  settings$ = this.settings$$.asObservable();

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
        switchMap((settings) => this.update_settings_api(settings)),
        takeUntil(this.destroy$$),
      )
      .subscribe({
        next: (response) => {
          console.log('Settings saved successfully:', response);
          this.settings$$.next(response.data);
        },
        error: (error) => console.error('Error saving settings:', error),
      });
  }

  getSettings(): Observable<ApiResponse<StoreSettings>> {
    return this.http.get<ApiResponse<StoreSettings>>(
      `${this.api_url}/store/settings`,
    );
  }

  saveSettings(settings: Partial<StoreSettings>): void {
    this.save_settings$$.next(settings);
  }

  saveSettingsNow(
    settings: Partial<StoreSettings>,
  ): Observable<ApiResponse<StoreSettings>> {
    return this.update_settings_api(settings);
  }

  resetToDefault(): Observable<ApiResponse<StoreSettings>> {
    return this.http.post<ApiResponse<StoreSettings>>(
      `${this.api_url}/store/settings/reset`,
      {},
    );
  }

  getSystemTemplates(): Observable<ApiResponse<any[]>> {
    return this.http.get<ApiResponse<any[]>>(
      `${this.api_url}/store/settings/templates`,
    );
  }

  applyTemplate(template_name: string): Observable<ApiResponse<StoreSettings>> {
    return this.http.post<ApiResponse<StoreSettings>>(
      `${this.api_url}/store/settings/apply-template`,
      { template_name },
    );
  }

  private update_settings_api(
    settings: Partial<StoreSettings>,
  ): Observable<ApiResponse<StoreSettings>> {
    return this.http.patch<ApiResponse<StoreSettings>>(
      `${this.api_url}/store/settings`,
      settings,
    );
  }

  ngOnDestroy() {
    this.destroy$$.next();
    this.destroy$$.complete();
  }
}

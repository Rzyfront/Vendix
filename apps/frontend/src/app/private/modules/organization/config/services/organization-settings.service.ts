import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, map, catchError, of } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { environment } from '../../../../../../environments/environment';
import {
  OrganizationSettings,
  OrganizationBranding,
  OrganizationInventorySettings,
} from '../../../../../core/models/organization.model';

const DEFAULT_ORG_SETTINGS: OrganizationSettings = {
  allowPublicStore: false,
  allowMultipleStores: true,
  maxStores: 5,
  maxUsers: 10,
  features: {
    ecommerce: true,
    inventory: true,
    analytics: false,
    multiCurrency: false,
    taxManagement: true,
    shippingManagement: false,
  },
  branding: {
    name: '',
    primary_color: '#3B82F6',
    secondary_color: '#6366F1',
    accent_color: '#8B5CF6',
    background_color: '#FFFFFF',
    surface_color: '#F9FAFB',
    text_color: '#111827',
    text_secondary_color: '#6B7280',
    text_muted_color: '#9CA3AF',
  },
  inventory: {
    mode: 'independent',
    low_stock_alerts_scope: 'location',
    fallback_on_stockout: 'reject',
  },
};

@Injectable({ providedIn: 'root' })
export class OrganizationSettingsService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}/organization/settings`;

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly settings = signal<OrganizationSettings | null>(null);
  readonly error = signal<string | null>(null);

  getSettings(): Observable<OrganizationSettings> {
    this.loading.set(true);
    this.error.set(null);

    return this.http.get<{ data: OrganizationSettings }>(this.baseUrl).pipe(
      map((response) => {
        const data = response?.data;
        if (!data) return DEFAULT_ORG_SETTINGS as OrganizationSettings;
        return {
          ...DEFAULT_ORG_SETTINGS,
          ...data,
          branding: { ...DEFAULT_ORG_SETTINGS.branding, ...data.branding },
          inventory: data.inventory
            ? { ...DEFAULT_ORG_SETTINGS.inventory!, ...data.inventory }
            : DEFAULT_ORG_SETTINGS.inventory,
        } as OrganizationSettings;
      }),
      tap((settings) => {
        this.settings.set(settings);
        this.loading.set(false);
      }),
      catchError((err) => {
        this.loading.set(false);
        this.error.set('Error al cargar la configuración de la organización.');
        return of(DEFAULT_ORG_SETTINGS as OrganizationSettings);
      }),
    );
  }

  saveSettings(updates: Partial<OrganizationSettings>): Observable<OrganizationSettings> {
    this.saving.set(true);
    this.error.set(null);

    return this.http.put<{ data: OrganizationSettings }>(this.baseUrl, { settings: updates }).pipe(
      map((response) => {
        const current = this.settings();
        const updated = response?.data ?? { ...current, ...updates } as OrganizationSettings;
        this.settings.set(updated);
        return updated;
      }),
      tap(() => this.saving.set(false)),
      catchError((err) => {
        this.saving.set(false);
        this.error.set('Error al guardar la configuración.');
        throw err;
      }),
    );
  }

  saveBranding(branding: Partial<OrganizationBranding>): Observable<OrganizationBranding | undefined> {
    const currentBranding = this.settings()?.branding;
    return this.saveSettings({ branding: { ...currentBranding, ...branding } } as any).pipe(
      map((settings) => settings.branding),
    );
  }
}
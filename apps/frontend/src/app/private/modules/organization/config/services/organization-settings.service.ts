import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, map, catchError, of, throwError } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  OrganizationSettings,
  OrganizationBranding,
} from '../../../../../core/models/organization.model';

const DEFAULT_ORG_SETTINGS: OrganizationSettings = {
  branding: {
    name: '',
    primary_color: '#7ED7A5',
    secondary_color: '#2F6F4E',
    accent_color: '#FFFFFF',
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

interface OrganizationAssetUploadResult {
  key: string;
  url: string;
  thumbKey?: string;
  thumbUrl?: string;
}

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

    return this.http.get<unknown>(this.baseUrl).pipe(
      map((response) => this.normalizeSettingsResponse(response)),
      tap((settings) => {
        this.settings.set(settings);
        this.loading.set(false);
      }),
      catchError(() => {
        const fallback = this.mergeWithDefaults({});
        this.loading.set(false);
        this.error.set('Error al cargar la configuración de la organización.');
        this.settings.set(fallback);
        return of(fallback);
      }),
    );
  }

  saveSettings(
    updates: Partial<OrganizationSettings> & Record<string, any>,
  ): Observable<OrganizationSettings> {
    this.saving.set(true);
    this.error.set(null);

    const payload = this.mergeSettings(this.settings(), updates);

    return this.http.put<unknown>(this.baseUrl, { settings: payload }).pipe(
      map((response) => this.normalizeSettingsResponse(response, payload)),
      tap((updated) => this.settings.set(updated)),
      tap(() => this.saving.set(false)),
      catchError((err) => {
        this.saving.set(false);
        this.error.set('Error al guardar la configuración.');
        return throwError(() => err);
      }),
    );
  }

  saveBranding(
    branding: Partial<OrganizationBranding>,
  ): Observable<OrganizationBranding | undefined> {
    return this.saveSettings({ branding } as any).pipe(
      map((settings) => settings.branding),
    );
  }

  uploadOrganizationLogo(
    file: File,
  ): Observable<OrganizationAssetUploadResult> {
    return this.uploadOrganizationAsset(file);
  }

  uploadOrganizationFavicon(
    file: File,
  ): Observable<OrganizationAssetUploadResult> {
    return this.uploadOrganizationAsset(file);
  }

  private uploadOrganizationAsset(
    file: File,
  ): Observable<OrganizationAssetUploadResult> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('entityType', 'logos');
    formData.append('isMainImage', 'true');

    return this.http
      .post<unknown>(`${environment.apiUrl}/upload`, formData)
      .pipe(
        map((response) => this.extractUploadResult(response)),
        catchError((err) => {
          this.error.set('Error al subir el recurso de marca.');
          return throwError(() => err);
        }),
      );
  }

  private normalizeSettingsResponse(
    response: unknown,
    fallback?: OrganizationSettings,
  ): OrganizationSettings {
    const candidate = this.extractSettingsCandidate(response) ?? fallback ?? {};
    return this.mergeWithDefaults(candidate);
  }

  private extractSettingsCandidate(
    response: unknown,
  ): Record<string, any> | null {
    if (!response || typeof response !== 'object') return null;

    const raw = response as Record<string, any>;
    const data = raw['data'];

    if (data && typeof data === 'object') {
      const dataRecord = data as Record<string, any>;
      if (
        dataRecord['settings'] &&
        typeof dataRecord['settings'] === 'object'
      ) {
        return dataRecord['settings'];
      }
      return dataRecord;
    }

    if (raw['settings'] && typeof raw['settings'] === 'object') {
      return raw['settings'];
    }

    return raw;
  }

  private extractUploadResult(
    response: unknown,
  ): OrganizationAssetUploadResult {
    const data =
      response && typeof response === 'object'
        ? ((response as Record<string, any>)['data'] ?? response)
        : response;

    return data as OrganizationAssetUploadResult;
  }

  private mergeSettings(
    current: OrganizationSettings | null,
    updates: Record<string, any>,
  ): OrganizationSettings {
    const base = this.mergeWithDefaults(current ?? {});
    const merged = {
      ...base,
      ...updates,
    } as OrganizationSettings & Record<string, any>;

    if (updates['branding']) {
      merged['branding'] = {
        ...base.branding,
        ...updates['branding'],
      };
    }

    if (updates['inventory']) {
      merged['inventory'] = {
        ...base.inventory,
        ...updates['inventory'],
      };
    }

    if (updates['panel_ui']) {
      merged['panel_ui'] = {
        ...(base.panel_ui ?? {}),
        ...updates['panel_ui'],
        ORG_ADMIN: {
          ...(base.panel_ui?.ORG_ADMIN ?? {}),
          ...(updates['panel_ui']?.ORG_ADMIN ?? {}),
        },
      };
    }

    return merged;
  }

  private mergeWithDefaults(data: Record<string, any>): OrganizationSettings {
    return {
      ...DEFAULT_ORG_SETTINGS,
      ...data,
      branding: {
        ...DEFAULT_ORG_SETTINGS.branding,
        ...(data['branding'] ?? {}),
      },
      inventory: data['inventory']
        ? {
            ...DEFAULT_ORG_SETTINGS.inventory!,
            ...data['inventory'],
          }
        : DEFAULT_ORG_SETTINGS.inventory,
    } as OrganizationSettings;
  }
}

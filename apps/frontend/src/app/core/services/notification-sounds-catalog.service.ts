import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { shareReplay, map, catchError } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

export interface NotificationSoundCatalogItem {
  id: string;
  name: string;
  url: string;
  sort_order: number;
}

@Injectable({ providedIn: 'root' })
export class NotificationSoundsCatalogService {
  private readonly http = inject(HttpClient);
  private catalog$: Observable<NotificationSoundCatalogItem[]> | null = null;

  getCatalog(forceRefresh = false): Observable<NotificationSoundCatalogItem[]> {
    if (forceRefresh || !this.catalog$) {
      this.catalog$ = this.http
        .get<{ data: NotificationSoundCatalogItem[] }>(
          `${environment.apiUrl}/notification-sounds`,
        )
        .pipe(
          map((response) => response?.data ?? []),
          catchError(() => of([] as NotificationSoundCatalogItem[])),
          shareReplay({ bufferSize: 1, refCount: false }),
        );
    }
    return this.catalog$;
  }

  invalidateCache(): void {
    this.catalog$ = null;
  }
}

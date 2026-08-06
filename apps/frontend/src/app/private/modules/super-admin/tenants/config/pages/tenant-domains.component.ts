import { HttpClient, HttpParams } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import { environment } from '../../../../../../../environments/environment';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import {
  AlertBannerComponent,
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  IconComponent,
} from '../../../../../../shared/components';
import type { BadgeVariant } from '../../../../../../shared/components/badge/badge.component';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';
import { TenantContextStore } from '../../state/tenant-context.store';

interface TenantDomainRow {
  readonly id: number;
  readonly hostname: string;
  readonly domain_type: string | null;
  readonly status: string | null;
  readonly organization_id: number | null;
  readonly store_id: number | null;
  readonly verified_at?: string | null;
  readonly ssl_expires_at?: string | null;
  readonly created_at?: string | null;
  readonly store?: { readonly id: number; readonly name: string } | null;
}

interface TenantDomainsResponse {
  readonly data?: readonly TenantDomainRow[];
  readonly meta?: { readonly total?: number };
}

const STATUS_LABELS: Readonly<Record<string, string>> = {
  active: 'Activo',
  inactive: 'Inactivo',
  pending: 'Pendiente',
  verified: 'Verificado',
  failed: 'Fallido',
};

const TYPE_LABELS: Readonly<Record<string, string>> = {
  primary: 'Principal',
  alias: 'Alias',
  customer: 'Cliente',
};

/**
 * Dominios del tenant — SOLO LECTURA.
 *
 * El rail `/superadmin/tenants/:scope/:id/*` no expone dominios: viven en
 * `/superadmin/domains`, un directorio global con sus propios permisos. Esta
 * pestaña los consulta filtrando por el tenant abierto y remite al directorio
 * para cualquier cambio, en vez de duplicar aquí un CRUD cuyo borrado tiene
 * reglas propias (no se puede eliminar el dominio principal) que esta pantalla
 * no conoce.
 */
@Component({
  selector: 'app-tenant-domains',
  standalone: true,
  imports: [
    RouterLink,
    AlertBannerComponent,
    BadgeComponent,
    ButtonComponent,
    CardComponent,
    EmptyStateComponent,
    IconComponent,
  ],
  template: `
    <div class="space-y-3 md:space-y-4">
      <app-alert-banner variant="info" icon="info">
        Los dominios se administran en el directorio global, no desde la ficha
        del tenant: su borrado y su verificación tienen reglas propias. Aquí se
        consultan filtrados por
        {{ store.isOrganization() ? 'la organización' : 'la tienda' }}.
      </app-alert-banner>

      @if (loading()) {
        <app-card [responsive]="true">
          <div class="flex items-center justify-center gap-3 py-10">
            <div
              class="h-6 w-6 animate-spin rounded-full border-b-2 border-primary"
            ></div>
            <p class="text-sm text-text-secondary">Cargando dominios…</p>
          </div>
        </app-card>
      } @else if (loadError()) {
        <app-card [responsive]="true">
          <div class="flex flex-col items-center gap-3 py-8 text-center">
            <app-icon
              name="alert-triangle"
              [size]="22"
              class="text-red-600"
            ></app-icon>
            <p class="max-w-md text-sm text-text-secondary">{{ loadError() }}</p>
            <app-button variant="outline" size="sm" (clicked)="load()">
              <app-icon name="refresh-cw" [size]="16" slot="icon"></app-icon>
              Reintentar
            </app-button>
          </div>
        </app-card>
      } @else {
        <app-card [responsive]="true">
          <div class="space-y-4">
            <header
              class="flex flex-wrap items-start justify-between gap-2 border-b border-border pb-3"
            >
              <div class="min-w-0">
                <h2 class="text-base font-semibold text-text-primary">
                  Dominios
                </h2>
                <p class="mt-0.5 text-xs text-text-secondary">
                  {{ domains().length }} registrado(s) para este tenant.
                </p>
              </div>
              <app-button
                variant="outline"
                size="sm"
                routerLink="/super-admin/domains"
              >
                <app-icon name="external-link" [size]="16" slot="icon"></app-icon>
                Ir al directorio
              </app-button>
            </header>

            @if (domains().length) {
              <div class="space-y-2">
                @for (domain of domains(); track domain.id) {
                  <div class="rounded-lg border border-border p-3">
                    <div
                      class="flex flex-wrap items-center justify-between gap-2"
                    >
                      <div class="flex min-w-0 items-center gap-2">
                        <app-icon
                          name="globe"
                          [size]="16"
                          class="flex-shrink-0 text-text-secondary"
                        ></app-icon>
                        <span
                          class="truncate text-sm font-semibold text-text-primary"
                        >
                          {{ domain.hostname }}
                        </span>
                      </div>
                      <div class="flex flex-wrap items-center gap-1.5">
                        <app-badge variant="neutral" size="xs">
                          {{ typeLabel(domain) }}
                        </app-badge>
                        <app-badge [variant]="statusVariant(domain)" size="sm">
                          {{ statusLabel(domain) }}
                        </app-badge>
                      </div>
                    </div>

                    <div
                      class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary"
                    >
                      <span>{{ scopeLabel(domain) }}</span>
                      <span>Verificado: {{ date(domain.verified_at) }}</span>
                      <span>SSL vence: {{ date(domain.ssl_expires_at) }}</span>
                    </div>
                  </div>
                }
              </div>
            } @else {
              <app-empty-state
                icon="globe"
                size="sm"
                title="Sin dominios registrados"
                description="Este tenant no tiene hostnames propios: se sirve por el subdominio compartido de la plataforma."
                [showActionButton]="false"
              ></app-empty-state>
            }
          </div>
        </app-card>
      }
    </div>
  `,
})
export class TenantDomainsComponent {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly store = inject(TenantContextStore);

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  private readonly rows = signal<readonly TenantDomainRow[]>([]);

  protected readonly domains = computed(() => this.rows());

  constructor() {
    this.load();
  }

  protected load(): void {
    const tenantId = this.store.tenantId();
    if (tenantId === null) {
      this.loading.set(false);
      this.loadError.set('El contexto de tenant no está sembrado.');
      return;
    }

    this.loading.set(true);
    this.loadError.set(null);

    // Una tienda filtra por `store_id`; una organización por `organization_id`,
    // que devuelve además los dominios de sus tiendas — que es justo lo que
    // soporte necesita ver desde la ficha de la organización.
    const params = new HttpParams()
      .set(
        this.store.isOrganization() ? 'organization_id' : 'store_id',
        String(tenantId),
      )
      .set('limit', '100');

    this.http
      .get<TenantDomainsResponse>(`${environment.apiUrl}/superadmin/domains`, {
        params,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.rows.set(response?.data ?? []);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.rows.set([]);
          this.loadError.set(
            extractApiErrorMessage(err) ||
              'No se pudieron cargar los dominios del tenant.',
          );
        },
      });
  }

  protected typeLabel(domain: TenantDomainRow): string {
    const type = domain.domain_type ?? '';
    return TYPE_LABELS[type] ?? type ?? '—';
  }

  protected statusLabel(domain: TenantDomainRow): string {
    const status = domain.status ?? '';
    return STATUS_LABELS[status] ?? status ?? '—';
  }

  protected statusVariant(domain: TenantDomainRow): BadgeVariant {
    switch (domain.status) {
      case 'active':
      case 'verified':
        return 'success';
      case 'pending':
        return 'warning';
      case 'failed':
        return 'error';
      default:
        return 'neutral';
    }
  }

  protected scopeLabel(domain: TenantDomainRow): string {
    if (domain.store?.name) return `Tienda: ${domain.store.name}`;
    if (domain.store_id) return `Tienda #${domain.store_id}`;
    return 'Nivel organización';
  }

  /**
   * Los campos fecha-sólo llegan como medianoche UTC: formatearlos en hora
   * local los correría un día hacia atrás en Colombia.
   */
  protected date(value: string | null | undefined): string {
    return value ? formatDateOnlyUTC(value) : '—';
  }
}

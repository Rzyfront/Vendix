import { Component, computed, inject } from '@angular/core';

import {
  BadgeComponent,
  CardComponent,
  EmptyStateComponent,
  IconComponent,
} from '../../../../../../shared/components';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';
import {
  DIAN_ENABLEMENT_LABELS,
  TENANT_SCOPE_LABELS,
  type TenantDianConfig,
  type TenantResolution,
} from '../../interfaces/tenant-profile.interface';
import { TenantContextStore } from '../../state/tenant-context.store';

interface FactRow {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
}

/**
 * Pestaña General: retrato de configuración del tenant, en sólo lectura.
 *
 * Contesta las cuatro preguntas con las que un comerciante llama a soporte:
 * quién es el titular del NIT, si su facturación electrónica está habilitada,
 * si el certificado sigue vivo y cuánta numeración le queda. La escritura vive
 * en la pestaña Configuración; aquí no hay un solo botón que mute nada.
 *
 * Los secretos se describen, nunca se muestran: PIN, contraseña del certificado
 * y clave técnica aparecen como "Configurado / Sin configurar" porque el
 * backend no envía otra cosa.
 */
@Component({
  selector: 'app-tenant-general',
  standalone: true,
  imports: [CardComponent, BadgeComponent, IconComponent, EmptyStateComponent],
  template: `
    @if (profile(); as data) {
      <div class="space-y-3 md:space-y-4">
        <!-- Alcance -->
        <app-card [responsive]="true">
          <div class="space-y-4">
            <header class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <h2 class="text-base font-semibold text-text-primary">
                  Alcance del tenant
                </h2>
                <p class="mt-0.5 text-xs text-text-secondary">
                  Determina de qué nivel cuelgan la identidad fiscal y las
                  configuraciones DIAN.
                </p>
              </div>
              @if (data.header.is_active === false) {
                <app-badge variant="error" size="sm">Inactiva</app-badge>
              } @else if (data.header.is_active === true) {
                <app-badge variant="success" size="sm">Activa</app-badge>
              }
            </header>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              @for (fact of scopeFacts(); track fact.label) {
                <div class="rounded-lg border border-border bg-background p-3">
                  <p class="text-xs font-medium text-text-secondary">
                    {{ fact.label }}
                  </p>
                  <p class="mt-1 text-sm font-semibold text-text-primary">
                    {{ fact.value }}
                  </p>
                  @if (fact.hint) {
                    <p class="mt-0.5 text-[11px] text-text-secondary">
                      {{ fact.hint }}
                    </p>
                  }
                </div>
              }
            </div>

            @if (!data.scope.owns_fiscal_identity) {
              <div
                class="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3"
              >
                <app-icon
                  name="alert-triangle"
                  [size]="16"
                  class="mt-0.5 flex-shrink-0 text-amber-600"
                ></app-icon>
                <p class="text-xs text-amber-900">
                  Esta ficha <strong>no es la titular del NIT</strong>. La
                  identidad fiscal y las configuraciones DIAN que se ven aquí
                  pertenecen al nivel
                  «{{ scopeLabel(data.scope.fiscal_scope) }}»: editar desde el
                  nivel equivocado crea configuraciones que el comerciante no ve
                  en su propio panel.
                </p>
              </div>
            }
          </div>
        </app-card>

        <!-- Identidad fiscal -->
        <app-card [responsive]="true">
          <div class="space-y-4">
            <header class="min-w-0">
              <h2 class="text-base font-semibold text-text-primary">
                Identidad fiscal
              </h2>
              <p class="mt-0.5 text-xs text-text-secondary">
                Titular del NIT ante la DIAN.
              </p>
            </header>

            @if (hasFiscalIdentity()) {
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                @for (fact of identityFacts(); track fact.label) {
                  <div
                    class="rounded-lg border border-border bg-background p-3"
                  >
                    <p class="text-xs font-medium text-text-secondary">
                      {{ fact.label }}
                    </p>
                    <p class="mt-1 text-sm font-semibold text-text-primary">
                      {{ fact.value }}
                    </p>
                  </div>
                }
              </div>

              @if (data.fiscal_identity.responsibilities.length) {
                <div>
                  <p class="mb-2 text-xs font-medium text-text-secondary">
                    Responsabilidades fiscales
                  </p>
                  <div class="flex flex-wrap gap-1.5">
                    <!-- track por índice: la DIAN puede repetir un código de
                         responsabilidad en el RUT y una clave duplicada hace
                         reventar el @for. -->
                    @for (
                      responsibility of data.fiscal_identity.responsibilities;
                      track $index
                    ) {
                      <app-badge variant="neutral" size="sm">
                        {{ responsibility }}
                      </app-badge>
                    }
                  </div>
                </div>
              }
            } @else {
              <app-empty-state
                icon="file-text"
                size="sm"
                title="Sin identidad fiscal registrada"
                description="El tenant no ha completado el asistente fiscal, así que no hay NIT ni régimen que mostrar."
                [showActionButton]="false"
              ></app-empty-state>
            }
          </div>
        </app-card>

        <!-- Facturación electrónica -->
        <app-card [responsive]="true">
          <div class="space-y-4">
            <header class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <h2 class="text-base font-semibold text-text-primary">
                  Facturación electrónica
                </h2>
                <p class="mt-0.5 text-xs text-text-secondary">
                  {{ dianConfigs().length }} configuración(es) DIAN en este
                  alcance.
                </p>
              </div>
            </header>

            @if (dianConfigs().length) {
              <div class="space-y-3">
                @for (config of dianConfigs(); track config.id) {
                  <div class="rounded-lg border border-border p-3">
                    <div
                      class="flex flex-wrap items-center justify-between gap-2"
                    >
                      <div class="flex min-w-0 flex-wrap items-center gap-2">
                        <span
                          class="truncate text-sm font-semibold text-text-primary"
                        >
                          {{ config.name || 'Configuración #' + config.id }}
                        </span>
                        @if (config.is_default) {
                          <app-badge variant="primary" size="xs">
                            Predeterminada
                          </app-badge>
                        }
                        @if (config.configuration_type) {
                          <app-badge variant="neutral" size="xs">
                            {{ config.configuration_type }}
                          </app-badge>
                        }
                      </div>
                      <app-badge
                        [variant]="enablementVariant(config)"
                        size="sm"
                      >
                        {{ enablementLabel(config) }}
                      </app-badge>
                    </div>

                    <div
                      class="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-3"
                    >
                      <div class="flex justify-between gap-2">
                        <span class="text-text-secondary">NIT</span>
                        <span class="font-medium text-text-primary">
                          {{ nitOf(config) }}
                        </span>
                      </div>
                      <div class="flex justify-between gap-2">
                        <span class="text-text-secondary">Ambiente</span>
                        <span class="font-medium text-text-primary">
                          {{ config.environment || '—' }}
                        </span>
                      </div>
                      <div class="flex justify-between gap-2">
                        <span class="text-text-secondary">Modo</span>
                        <span class="font-medium text-text-primary">
                          {{ config.operation_mode || '—' }}
                        </span>
                      </div>
                      <div class="flex justify-between gap-2">
                        <span class="text-text-secondary">Software ID</span>
                        <span class="font-medium text-text-primary">
                          {{ setLabel(config.software_id_set) }}
                        </span>
                      </div>
                      <div class="flex justify-between gap-2">
                        <span class="text-text-secondary">PIN de software</span>
                        <span class="font-medium text-text-primary">
                          {{ setLabel(config.software_pin_set) }}
                        </span>
                      </div>
                      <div class="flex justify-between gap-2">
                        <span class="text-text-secondary">Set de pruebas</span>
                        <span class="font-medium text-text-primary">
                          {{ testSetLabel(config) }}
                        </span>
                      </div>
                    </div>

                    <!-- Certificado -->
                    <div
                      class="mt-3 flex flex-wrap items-center gap-2 rounded-md p-2"
                      [class.bg-red-50]="config.certificate.expired"
                      [class.bg-background]="!config.certificate.expired"
                    >
                      <app-icon
                        [name]="
                          config.certificate.present ? 'shield-check' : 'shield'
                        "
                        [size]="16"
                        [class.text-green-600]="
                          config.certificate.present &&
                          !config.certificate.expired
                        "
                        [class.text-red-600]="config.certificate.expired"
                        [class.text-gray-400]="!config.certificate.present"
                      ></app-icon>
                      <span class="text-xs font-medium text-text-primary">
                        {{ certificateLabel(config) }}
                      </span>
                      @if (config.certificate.subject) {
                        <span class="truncate text-[11px] text-text-secondary">
                          {{ config.certificate.subject }}
                        </span>
                      }
                    </div>
                  </div>
                }
              </div>
            } @else {
              <app-empty-state
                icon="file-text"
                size="sm"
                title="Sin configuración DIAN"
                description="Este alcance no tiene configuraciones de facturación electrónica registradas."
                [showActionButton]="false"
              ></app-empty-state>
            }
          </div>
        </app-card>

        <!-- Resoluciones -->
        <app-card [responsive]="true">
          <div class="space-y-4">
            <header class="min-w-0">
              <h2 class="text-base font-semibold text-text-primary">
                Resoluciones de numeración
              </h2>
              <p class="mt-0.5 text-xs text-text-secondary">
                Rangos autorizados y consumo actual.
              </p>
            </header>

            @if (resolutions().length) {
              <div class="space-y-3">
                @for (resolution of resolutions(); track resolution.id) {
                  <div class="rounded-lg border border-border p-3">
                    <div
                      class="flex flex-wrap items-center justify-between gap-2"
                    >
                      <div class="flex min-w-0 flex-wrap items-center gap-2">
                        <span class="text-sm font-semibold text-text-primary">
                          {{ resolution.prefix || 'Sin prefijo' }}
                        </span>
                        <span class="text-xs text-text-secondary">
                          {{ resolution.document_type || '—' }} ·
                          {{ resolution.resolution_number || 'sin número' }}
                        </span>
                      </div>
                      <div class="flex items-center gap-1.5">
                        @if (!resolution.technical_key_set) {
                          <app-badge variant="warning" size="xs">
                            Sin clave técnica
                          </app-badge>
                        }
                        <app-badge
                          [variant]="resolution.is_active ? 'success' : 'neutral'"
                          size="xs"
                        >
                          {{ resolution.is_active ? 'Activa' : 'Inactiva' }}
                        </app-badge>
                      </div>
                    </div>

                    <div
                      class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary"
                    >
                      <span>
                        Rango {{ resolution.range_from }} –
                        {{ resolution.range_to }}
                      </span>
                      <span>Actual {{ resolution.current_number }}</span>
                      <span>{{ validityLabel(resolution) }}</span>
                    </div>

                    <div class="mt-2">
                      <div
                        class="h-1.5 w-full overflow-hidden rounded-full bg-gray-200"
                      >
                        <div
                          class="h-full rounded-full"
                          [class.bg-red-500]="resolution.consumed_pct >= 90"
                          [class.bg-amber-500]="
                            resolution.consumed_pct >= 70 &&
                            resolution.consumed_pct < 90
                          "
                          [class.bg-green-500]="resolution.consumed_pct < 70"
                          [style.width.%]="clampPct(resolution.consumed_pct)"
                        ></div>
                      </div>
                      <p class="mt-1 text-[11px] text-text-secondary">
                        {{ consumedLabel(resolution) }}
                      </p>
                    </div>
                  </div>
                }
              </div>
            } @else {
              <app-empty-state
                icon="file-text"
                size="sm"
                title="Sin resoluciones"
                description="Este alcance no tiene rangos de numeración autorizados."
                [showActionButton]="false"
              ></app-empty-state>
            }
          </div>
        </app-card>
      </div>
    } @else {
      <app-card [responsive]="true">
        <app-empty-state
          icon="building-2"
          size="sm"
          title="Ficha no disponible"
          description="El perfil del tenant no está cargado."
          [showActionButton]="false"
        ></app-empty-state>
      </app-card>
    }
  `,
})
export class TenantGeneralComponent {
  private readonly store = inject(TenantContextStore);

  protected readonly profile = this.store.profile;
  protected readonly dianConfigs = this.store.dianConfigs;
  protected readonly resolutions = this.store.resolutions;

  protected readonly hasFiscalIdentity = computed(() => {
    const identity = this.profile()?.fiscal_identity;
    return Boolean(identity?.nit || identity?.legal_name);
  });

  protected readonly scopeFacts = computed<FactRow[]>(() => {
    const data = this.profile();
    if (!data) return [];

    return [
      {
        label: 'Alcance fiscal',
        value: TENANT_SCOPE_LABELS[data.scope.fiscal_scope],
        hint:
          data.scope.fiscal_scope === 'ORGANIZATION'
            ? 'La organización factura con un NIT único.'
            : 'Cada tienda factura con su propio NIT.',
      },
      {
        label: 'Alcance operativo',
        value: TENANT_SCOPE_LABELS[data.scope.operating_scope],
      },
      {
        label: 'Titular del NIT',
        value: data.scope.owns_fiscal_identity ? 'Sí' : 'No',
        hint: data.scope.owns_fiscal_identity
          ? 'Esta ficha posee la identidad fiscal.'
          : 'La identidad la posee el otro nivel.',
      },
      {
        label: 'Entidad contable',
        value:
          data.scope.accounting_entity_id === null
            ? 'Sin materializar'
            : `#${data.scope.accounting_entity_id}`,
        hint:
          data.scope.accounting_entity_id === null
            ? 'Se crea al activar el módulo fiscal; consultarla aquí no la crea.'
            : undefined,
      },
      {
        label: 'Organización',
        value: data.header.organization_name,
        hint: `#${data.header.organization_id}`,
      },
      {
        label: 'Tiendas activas',
        value: String(data.scope.stores_count),
      },
    ];
  });

  protected readonly identityFacts = computed<FactRow[]>(() => {
    const identity = this.profile()?.fiscal_identity;
    if (!identity) return [];

    return [
      { label: 'Razón social', value: identity.legal_name ?? '—' },
      {
        label: 'NIT',
        value: identity.nit
          ? identity.nit_dv
            ? `${identity.nit}-${identity.nit_dv}`
            : identity.nit
          : '—',
      },
      { label: 'Tipo de documento', value: identity.nit_type ?? '—' },
      { label: 'Tipo de persona', value: identity.person_type ?? '—' },
      { label: 'Régimen', value: identity.tax_regime ?? '—' },
      { label: 'CIIU', value: identity.ciiu ?? '—' },
      { label: 'Dirección fiscal', value: identity.fiscal_address ?? '—' },
      {
        label: 'Código de municipio',
        value: identity.municipality_code ?? '—',
      },
    ];
  });

  protected scopeLabel(scope: 'STORE' | 'ORGANIZATION'): string {
    return TENANT_SCOPE_LABELS[scope];
  }

  protected setLabel(isSet: boolean): string {
    return isSet ? 'Configurado' : 'Sin configurar';
  }

  protected nitOf(config: TenantDianConfig): string {
    if (!config.nit) return '—';
    return config.nit_dv ? `${config.nit}-${config.nit_dv}` : config.nit;
  }

  protected enablementLabel(config: TenantDianConfig): string {
    return (
      DIAN_ENABLEMENT_LABELS[config.enablement_status] ??
      config.enablement_status
    );
  }

  protected enablementVariant(
    config: TenantDianConfig,
  ): 'success' | 'primary' | 'warning' | 'error' | 'neutral' {
    switch (config.enablement_status) {
      case 'enabled':
        return 'success';
      case 'test_set_passed':
        return 'primary';
      case 'testing':
        return 'warning';
      case 'suspended':
      case 'expired':
        return 'error';
      default:
        return 'neutral';
    }
  }

  /**
   * El bloque `test_set` lo añade una tarea de backend en vuelo; hasta que
   * llegue se cae a `test_set_id`, que ya viene en el perfil. Nunca inventa un
   * estado: si no hay ninguno de los dos, dice que no se ha enviado.
   */
  protected testSetLabel(config: TenantDianConfig): string {
    const state = config.test_set?.state;
    if (state) return state;
    const id = config.test_set?.test_set_id ?? config.test_set_id;
    return id ? `Enviado (${id})` : 'No enviado';
  }

  protected certificateLabel(config: TenantDianConfig): string {
    const certificate = config.certificate;
    if (!certificate.present) return 'Sin certificado digital';

    const parts: string[] = ['Certificado cargado'];
    if (!certificate.password_set) parts.push('sin contraseña');
    if (certificate.expired) {
      parts.push('EXPIRADO');
    } else if (certificate.days_to_expiry !== null) {
      parts.push(`vence en ${certificate.days_to_expiry} día(s)`);
    }
    if (certificate.expires_at) {
      parts.push(this.formatDate(certificate.expires_at));
    }
    return parts.join(' · ');
  }

  protected validityLabel(resolution: TenantResolution): string {
    const from = resolution.valid_from
      ? this.formatDate(resolution.valid_from)
      : '—';
    const to = resolution.valid_to
      ? this.formatDate(resolution.valid_to)
      : '—';
    return `Vigencia ${from} → ${to}`;
  }

  protected consumedLabel(resolution: TenantResolution): string {
    const remaining = Math.max(
      0,
      resolution.range_to - resolution.current_number,
    );
    return `${this.clampPct(resolution.consumed_pct).toFixed(1)}% consumido · ${remaining} disponible(s)`;
  }

  protected clampPct(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(100, Math.max(0, value));
  }

  /**
   * Campos fecha-sólo del backend llegan como medianoche UTC: formatearlos en
   * hora local los correría un día hacia atrás en Colombia.
   */
  private formatDate(value: string): string {
    return formatDateOnlyUTC(value);
  }
}

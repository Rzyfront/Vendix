import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import {
  BadgeComponent,
  CardComponent,
  IconComponent,
} from '../../../../../../../shared/components';
import { DianCertificatePanelComponent } from '../../../../../../../shared/components/dian';
import { formatDateOnlyUTC } from '../../../../../../../shared/utils/date.util';
import { TENANT_CAPABILITY } from '../../../services/superadmin-dian-context.factory';
import { TenantContextStore } from '../../../state/tenant-context.store';
import { TenantDianAxisPickerComponent } from './tenant-dian-axis-picker.component';
import { TenantDianConsoleStore } from './tenant-dian-console.store';

/**
 * Certificado digital del tenant: si ya lo tiene, hasta cuándo, de quién es,
 * quién custodia la llave privada y cómo se reemplaza.
 *
 * ## Por qué es una VISTA propia y no un bloque más
 *
 * «¿Este cliente tiene certificado?» es la pregunta que abre la mitad de los
 * casos de soporte, y hasta ahora se contestaba desplazándose por una pantalla
 * de 2.400 líneas hasta un badge. Con ruta propia se llega por enlace directo y
 * se lee de un vistazo.
 *
 * ## El panel es el COMPARTIDO
 *
 * `app-dian-certificate-panel` es el mismo que monta el panel del comerciante.
 * Habla con el tenant abierto porque la ruta reapunta `DIAN_API_CONTEXT`, no
 * porque el componente sepa dónde está montado. La única diferencia entre las
 * dos consolas es la capacidad `uploadCertificate`, que el panel lee del token.
 *
 * ## La ficha del contribuyente va al lado, no dentro
 *
 * El panel compara el NIT del `.p12` contra el que declara la configuración.
 * Aquí se añade el tercer NIT en juego —el de la identidad fiscal del tenant—
 * porque una configuración creada con el NIT equivocado pasa la comparación del
 * panel y sigue firmando a nombre de otro contribuyente.
 */
@Component({
  selector: 'app-tenant-dian-certificate',
  standalone: true,
  imports: [
    BadgeComponent,
    CardComponent,
    IconComponent,
    DianCertificatePanelComponent,
    TenantDianAxisPickerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-3">
      <app-card [responsive]="true">
        <app-tenant-dian-axis-picker></app-tenant-dian-axis-picker>
      </app-card>

      @if (store.selectedConfig(); as config) {
        <!-- Identidad de la configuración: los tres NIT en juego, juntos -->
        <app-card [responsive]="true">
          <div class="space-y-2.5">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div class="min-w-0">
                <h2 class="text-base font-semibold text-text-primary">
                  {{ config.name }}
                </h2>
                <p class="mt-0.5 text-xs text-text-secondary">
                  Configuración #{{ config.id }} ·
                  {{ config.environment === 'production' ? 'Producción' : 'Pruebas' }}
                </p>
              </div>
              @if (config.is_default) {
                <app-badge variant="info" size="xs">Predeterminada</app-badge>
              }
            </div>

            <dl
              class="grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg border border-border bg-background/60 p-2.5 sm:grid-cols-3 xl:grid-cols-4"
            >
              <div class="min-w-0">
                <dt class="text-[10px] uppercase text-text-secondary">
                  NIT de la configuración
                </dt>
                <dd class="font-mono text-xs text-text-primary">
                  {{ config.nit }}{{ config.nit_dv ? '-' + config.nit_dv : '' }}
                </dd>
              </div>
              <div class="min-w-0">
                <dt class="text-[10px] uppercase text-text-secondary">
                  NIT del contribuyente
                </dt>
                <dd class="font-mono text-xs text-text-primary">
                  {{ tenantNit() || '—' }}
                </dd>
              </div>
              <div class="col-span-2 min-w-0">
                <dt class="text-[10px] uppercase text-text-secondary">
                  Software ID
                </dt>
                <dd class="break-all font-mono text-[11px] text-text-primary">
                  {{ config.software_id || '—' }}
                </dd>
              </div>
            </dl>

            @if (declaredNitMismatch(); as mismatch) {
              <p
                class="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900"
              >
                <app-icon
                  name="alert-triangle"
                  [size]="14"
                  class="mt-px shrink-0"
                ></app-icon>
                <span>
                  Esta configuración declara el NIT {{ mismatch.config }} y la
                  identidad fiscal del tenant es {{ mismatch.tenant }}. Un
                  certificado válido para el NIT declarado seguiría firmando a
                  nombre de otro contribuyente: corrige la configuración antes de
                  subir nada.
                </span>
              </p>
            }

            @if (config.certificate_password_encrypted) {
              <p class="flex items-start gap-1.5 text-[11px] text-text-secondary">
                <app-icon name="lock" [size]="12" class="mt-0.5 shrink-0"></app-icon>
                <span>
                  Hay una contraseña guardada para el certificado actual. No abre
                  un <code>.p12</code> distinto: al reemplazarlo hay que escribir
                  la del archivo nuevo.
                </span>
              </p>
            }
          </div>
        </app-card>

        <!-- Panel COMPARTIDO: hace sus propias llamadas por el rail del token -->
        <app-dian-certificate-panel
          [certificate]="store.selectedCertificate()"
          [configId]="config.id"
          [expectedNit]="config.nit"
          (uploaded)="store.reload()"
        ></app-dian-certificate-panel>

        @if (uploadedAt(); as uploaded) {
          <p class="text-[11px] text-text-secondary">
            Último reemplazo registrado: {{ uploaded }}. La vigencia, la huella y
            el NIT que se muestran arriba los deriva el backend del propio
            archivo — no se teclean.
          </p>
        }
      } @else {
        <app-card [responsive]="true">
          <div class="flex flex-col items-center gap-3 py-10 text-center">
            <div
              class="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100"
            >
              <app-icon
                name="shield-check"
                [size]="22"
                class="text-gray-500"
              ></app-icon>
            </div>
            <h2 class="text-base font-semibold text-text-primary">
              Esta habilitación no tiene configuración DIAN
            </h2>
            <p class="max-w-md text-sm text-text-secondary">
              El certificado se custodia por configuración, así que primero hay
              que crear la de este eje desde «Habilitaciones». Mientras tanto no
              hay ningún <code>.p12</code> que ver ni que reemplazar.
            </p>
          </div>
        </app-card>
      }

      @if (!canUploadCertificate()) {
        <p class="text-[11px] text-text-secondary">
          El reemplazo del certificado requiere la capacidad
          <code>{{ capability.dianCertificateWrite }}</code
          >. La ficha se muestra igual: para atender al comerciante hay que poder
          leer qué certificado tiene, aunque no se pueda cambiar.
        </p>
      }
    </div>
  `,
})
export class TenantDianCertificateComponent {
  protected readonly store = inject(TenantDianConsoleStore);
  protected readonly tenant = inject(TenantContextStore);

  protected readonly capability = TENANT_CAPABILITY;

  protected readonly canUploadCertificate = computed(() =>
    this.tenant.can(TENANT_CAPABILITY.dianCertificateWrite),
  );

  protected readonly tenantNit = computed(
    () => this.tenant.profile()?.fiscal_identity.nit ?? null,
  );

  /**
   * NIT de la configuración contra el de la identidad fiscal del tenant.
   *
   * Se comparan por dígitos: el DV viaja aparte en una y pegado en la otra según
   * quién la escribió, y compararlas como cadenas produce falsos positivos que
   * asustan sin motivo.
   */
  protected readonly declaredNitMismatch = computed<{
    config: string;
    tenant: string;
  } | null>(() => {
    const config = this.store.selectedConfig();
    const tenantNit = this.tenantNit();
    if (!config?.nit || !tenantNit) return null;

    const digits = (value: string) => value.replace(/\D/g, '');
    const fromConfig = digits(config.nit);
    const fromTenant = digits(tenantNit);
    if (!fromConfig || !fromTenant) return null;
    if (
      fromConfig === fromTenant ||
      fromConfig.startsWith(fromTenant) ||
      fromTenant.startsWith(fromConfig)
    ) {
      return null;
    }
    return { config: config.nit, tenant: tenantNit };
  });

  protected readonly uploadedAt = computed<string | null>(() => {
    const raw = this.store.selectedConfig()?.certificate_uploaded_at ?? null;
    if (!raw) return null;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return null;
    return formatDateOnlyUTC(date);
  });
}

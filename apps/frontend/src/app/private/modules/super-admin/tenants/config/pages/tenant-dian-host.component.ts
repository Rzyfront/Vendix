import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  DestroyRef,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { fromEvent, of, timer, type Observable } from 'rxjs';
import { catchError, filter, exhaustMap, startWith, tap } from 'rxjs/operators';

import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import { dianEnablementLabel } from '../../../../../../core/utils/dian-enablement-status.util';
import { DianConfigComponent } from '../../../../store/invoicing/components/dian-config/dian-config.component';
import type {
  DianConfig,
  DianEmissionStatus,
  DianProductionReadiness,
  DianReadinessCheck,
  DianTestResult,
  InvoiceResolution,
} from '../../../../store/invoicing/interfaces/invoice.interface';
import {
  AlertBannerComponent,
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  ConfirmationModalComponent,
  FileUploadDropzoneComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  ToastService,
  type SelectorOption,
} from '../../../../../../shared/components';
import {
  formatDateOnlyUTC,
  toLocalDateString,
  toUTCDateString,
} from '../../../../../../shared/utils/date.util';
import { DianConfigApiService } from '../../../../../../shared/services/dian';
import {
  TENANT_CAPABILITY,
  fiscalOwnerNotice,
} from '../../services/superadmin-dian-context.factory';
import { TenantContextStore } from '../../state/tenant-context.store';

/** Centinela con el que la API representa un secreto guardado. */
const MASKED_SECRET = '****';

/** Cada cuánto se sondea el job encolado o el veredicto pendiente de la DIAN. */
const POLL_INTERVAL_MS = 15_000;

/** Umbral en días a partir del cual el certificado se avisa como «por vencer». */
const CERTIFICATE_EXPIRY_WARNING_DAYS = 60;

const MS_PER_DAY = 86_400_000;

/**
 * Único tipo de documento con el que la DIAN acepta un set de habilitación.
 * Enviar el set contra una resolución de nota crédito quema consecutivos de un
 * rango que no sirve para habilitar, y eso no se deshace.
 */
const TEST_SET_DOCUMENT_TYPE = 'sales_invoice';

const RESOLUTION_DOCUMENT_LABELS: Record<string, string> = {
  sales_invoice: 'factura de venta',
  credit_note: 'nota crédito',
  debit_note: 'nota débito',
  pos_equivalent: 'documento equivalente POS',
  support_document: 'documento soporte',
};

const CERTIFICATE_SOURCE_LABELS: Record<string, string> = {
  manual_upload: 'Carga manual',
  manual_upload_validated: 'Carga manual validada',
  kms_managed: 'Custodiado en KMS',
  imported: 'Importado',
};

const OPERATION_MODE_LABELS: Record<string, string> = {
  own_software: 'Software propio',
  provider: 'Proveedor tecnológico',
  free_dian: 'Gratuita DIAN',
};

/**
 * Bloque de consecutivos que el envío del set va a quemar. Lo calcula el backend
 * en la respuesta de `run-test-set` — antes de que el worker reserve nada — y es
 * la ÚNICA cifra autoritativa: la proyección que se muestra en la confirmación
 * se calcula con la composición que el propio backend publica, pero el rango
 * final lo fija quien reserva.
 */
interface TestSetConsumes {
  readonly resolution_id: number;
  readonly prefix: string | null;
  readonly resolution_number: string | null;
  readonly composition?: { readonly total: number; readonly label: string };
  readonly number_from: number;
  readonly number_to: number;
  readonly range_to: number;
  readonly irreversible: boolean;
}

interface TestSetComposition {
  readonly total: number;
  readonly label: string;
}

/**
 * Campos que el rail de super admin sí devuelve y que `DianConfig` todavía no
 * declara. Se tipan acá en vez de leerse por índice porque el proyecto compila
 * con `noPropertyAccessFromIndexSignature`: sobre un índice, `config?.campo` no
 * compila, y castear a `any` esconde exactamente los errores que este panel
 * existe para mostrar.
 */
interface TenantDianConfig extends DianConfig {
  readonly certificate_subject?: string | null;
  readonly certificate_issuer?: string | null;
  readonly certificate_serial_number?: string | null;
  readonly certificate_nit?: string | null;
  readonly certificate_source?: string | null;
  readonly certificate_uploaded_at?: string | null;
  readonly certificate_kms_key_id?: string | null;
  readonly operation_mode?: string | null;
  readonly configuration_type?: string | null;
}

/**
 * `document_type` viaja en la respuesta de resoluciones pero no está declarado
 * en `InvoiceResolution`, y es EL campo que decide si una resolución sirve para
 * un set de habilitación.
 */
interface ResolutionRow extends InvoiceResolution {
  readonly document_type?: string | null;
  readonly technical_key_set?: boolean;
}

/** Ficha legible del certificado, derivada del DN que devuelve la API. */
interface CertificateSummary {
  readonly holder: string | null;
  readonly nit: string | null;
  readonly serial: string | null;
  readonly issuer: string | null;
  readonly uploadedAt: string | null;
  readonly expiry: string | null;
  readonly daysLeft: number | null;
  readonly statusLabel: string;
  readonly statusVariant: StatusVariant;
  readonly source: string | null;
}

/** Evidencia del último lote enviado, para no dejar un badge rojo sin respaldo. */
interface LastSubmission {
  readonly total: number | null;
  readonly invoices: number | null;
  readonly creditNotes: number | null;
  readonly debitNotes: number | null;
  readonly executedAt: string | null;
  readonly recheckedAt: string | null;
  readonly zipKey: string | null;
  readonly polls: number;
  readonly pollsWithoutVerdict: number;
  readonly lastPollMessage: string | null;
}

interface ChecklistGroup {
  readonly key: string;
  readonly title: string;
  readonly hint: string;
  readonly classes: string;
  readonly items: DianReadinessCheck[];
}

type StatusVariant = 'success' | 'warning' | 'error' | 'neutral' | 'info';

type RiskyAction = 'certificate' | 'run-test-set' | 'abandon';

/**
 * Documentos electrónicos del tenant, desde la consola de super admin.
 *
 * ARQUITECTURA DE ESTA PANTALLA — importa entenderla antes de tocarla:
 *
 * 1. **El componente compartido se monta tal cual.** `vendix-dian-config` es el
 *    mismo que ve el comerciante; no lleva un solo condicional de alcance
 *    dentro. Habla con el tenant abierto porque la RUTA reapunta
 *    `DIAN_API_CONTEXT` (ver `provideSuperadminDianApi`), no porque el
 *    componente sepa dónde está montado.
 *
 * 2. **El gating por capacidades vive AQUÍ.** `TenantContextStore.can()` devuelve
 *    `false` cuando el perfil no declara la capacidad, así que la consola cae en
 *    solo lectura por defecto. Ofrecer un botón de escritura porque el backend
 *    no dijo nada es peor que no ofrecerlo.
 *
 * 3. **Las operaciones irreversibles se ejercen desde este host, con
 *    confirmación reforzada**, y no desde el asistente del comerciante: subir el
 *    `.p12` de un tercero, quemar consecutivos autorizados y promover a
 *    producción son acciones que en soporte se hacen sobre el NIT de OTRO, y la
 *    fricción tiene que ser proporcional a eso. El asistente conserva sus
 *    propios botones porque es código compartido; el camino soportado para
 *    super admin es este panel.
 *
 * 4. **Esta consola MUESTRA, no vuelve a preguntar.** Es la pantalla con la que
 *    soporte destraba una habilitación sin entrar al panel del comerciante: si
 *    el dato ya viaja en la respuesta —el titular del certificado, el ZipKey del
 *    lote, la checklist de producción— pedirlo otra vez o esconderlo obliga a
 *    adivinar sobre el NIT de un tercero. Todo lo que el backend publica se
 *    pinta; nada que el backend vaya a rechazar se ofrece habilitado.
 */
@Component({
  selector: 'app-tenant-dian-host',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AlertBannerComponent,
    BadgeComponent,
    ButtonComponent,
    CardComponent,
    ConfirmationModalComponent,
    FileUploadDropzoneComponent,
    IconComponent,
    InputComponent,
    ModalComponent,
    SelectorComponent,
    DianConfigComponent,
  ],
  template: `
    <div class="space-y-3">
      @if (ownerNotice(); as notice) {
        <app-alert-banner variant="warning" icon="alert-triangle">
          {{ notice.message }}
          <a
            [routerLink]="notice.route"
            class="ml-1 font-semibold underline underline-offset-2"
          >
            Abrir {{ notice.organizationName }}
          </a>
        </app-alert-banner>
      }

      @if (!anyCapability()) {
        <app-alert-banner variant="info" icon="info">
          El perfil de este tenant no declara ninguna capacidad de escritura
          DIAN, así que la consola opera en solo lectura. La autorización real la
          resuelve el backend; esta pantalla sólo deja de ofrecer lo que no se
          declaró.
        </app-alert-banner>
      }

      <!-- Estado de emisión ------------------------------------------------ -->
      <app-card [responsive]="true">
        <div class="space-y-3">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <h2 class="text-base font-semibold text-text-primary">
                Emisión electrónica
              </h2>
              <p class="mt-0.5 max-w-xl text-xs text-text-secondary">
                {{ emissionReason() }}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <app-badge [variant]="emissionVariant()" size="sm">
                Emisión: {{ emissionLabel() }}
              </app-badge>
              <app-button
                variant="ghost"
                size="sm"
                [loading]="refreshing()"
                (clicked)="reload()"
              >
                <app-icon name="refresh-cw" [size]="16" slot="icon"></app-icon>
                Actualizar
              </app-button>
            </div>
          </div>

          <!-- La respuesta completa de emission-status: es literalmente la
               contestación a «¿por qué este cliente no está emitiendo?», que es
               para lo que existe esta consola. -->
          @if (emissionGroups().length) {
            <div
              class="grid gap-2 border-t border-border pt-3 sm:grid-cols-2 xl:grid-cols-3"
            >
              @for (group of emissionGroups(); track group.key) {
                <div class="rounded-md border p-2.5" [class]="group.classes">
                  <p class="text-[11px] font-semibold uppercase tracking-wide">
                    {{ group.title }}
                  </p>
                  <p class="mt-0.5 text-[11px] opacity-80">{{ group.hint }}</p>
                  <ul class="mt-1.5 space-y-1.5">
                    @for (item of group.items; track item.key) {
                      <li class="text-[11px] leading-snug">
                        <span class="font-medium">{{ item.label }}</span>
                        @if (item.action) {
                          <span class="block opacity-80">{{ item.action }}</span>
                        }
                      </li>
                    }
                  </ul>
                </div>
              }
            </div>
          }
        </div>
      </app-card>

      <!-- Operaciones de riesgo -------------------------------------------- -->
      @if (configs().length) {
        <app-card [responsive]="true">
          <div class="space-y-3">
            <header
              class="flex flex-wrap items-start justify-between gap-2 border-b border-border pb-2.5"
            >
              <div class="min-w-0">
                <h2 class="text-base font-semibold text-text-primary">
                  Operaciones de habilitación
                </h2>
                <p class="mt-0.5 text-xs text-text-secondary">
                  Acciones que tocan la identidad fiscal del contribuyente.
                  Todas piden confirmación explícita.
                </p>
              </div>
              @if (selectedConfig(); as config) {
                <app-badge variant="info" size="xs">
                  Habilitación: {{ enablementLabel(config) }}
                </app-badge>
              }
            </header>

            <!-- app-selector es un CVA: su valor entra por formControl, no por
                 un input "value". Las señales de esta pantalla se puentean con
                 toSignal porque un computed() no reacciona a un FormControl. -->
            <app-selector
              label="Configuración DIAN"
              placeholder="Selecciona la configuración a operar"
              [options]="configOptions()"
              [formControl]="configControl"
            ></app-selector>

            @if (selectedConfig(); as config) {
              <!-- Identidad de la configuración ------------------------- -->
              <!-- Estaba sólo dentro del asistente de edición: para leer el
                   software_id había que abrir un formulario de escritura sobre
                   el NIT de un tercero. -->
              <dl
                class="grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg border border-border bg-background/60 p-2.5 sm:grid-cols-3 xl:grid-cols-6"
              >
                <div class="min-w-0">
                  <dt class="text-[10px] uppercase text-text-secondary">
                    NIT-DV
                  </dt>
                  <dd class="font-mono text-xs text-text-primary">
                    {{ config.nit }}{{ config.nit_dv ? '-' + config.nit_dv : '' }}
                  </dd>
                </div>
                <div class="min-w-0">
                  <dt class="text-[10px] uppercase text-text-secondary">
                    Ambiente
                  </dt>
                  <dd class="text-xs text-text-primary">
                    {{
                      config.environment === 'production'
                        ? 'Producción'
                        : 'Pruebas'
                    }}
                  </dd>
                </div>
                <div class="min-w-0">
                  <dt class="text-[10px] uppercase text-text-secondary">
                    Modo de operación
                  </dt>
                  <dd class="text-xs text-text-primary">
                    {{ operationModeLabel(config) }}
                  </dd>
                </div>
                <div class="min-w-0">
                  <dt class="text-[10px] uppercase text-text-secondary">
                    Predeterminada
                  </dt>
                  <dd class="text-xs text-text-primary">
                    {{ config.is_default ? 'Sí' : 'No' }}
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
                <div class="col-span-2 min-w-0 xl:col-span-6">
                  <dt class="text-[10px] uppercase text-text-secondary">
                    Test Set ID
                  </dt>
                  <dd class="break-all font-mono text-[11px] text-text-primary">
                    {{ config.test_set_id || '—' }}
                  </dd>
                </div>
              </dl>

              <!-- Certificado ------------------------------------------- -->
              <section class="rounded-lg border border-border p-2.5">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <app-icon
                      name="key"
                      [size]="16"
                      class="text-text-secondary"
                    ></app-icon>
                    <h3 class="text-sm font-semibold text-text-primary">
                      Certificado digital
                    </h3>
                  </div>
                  <div class="flex items-center gap-2">
                    @if (certificateSummary(); as cert) {
                      <app-badge [variant]="cert.statusVariant" size="xs">
                        {{ cert.statusLabel }}
                      </app-badge>
                    } @else {
                      <app-badge variant="neutral" size="xs">
                        Sin cargar
                      </app-badge>
                    }
                    @if (
                      canUploadCertificate() &&
                      hasCertificate(config) &&
                      !replacingCertificate()
                    ) {
                      <app-button
                        variant="ghost"
                        size="sm"
                        (clicked)="startCertificateReplacement()"
                      >
                        <app-icon
                          name="upload"
                          [size]="14"
                          slot="icon"
                        ></app-icon>
                        Reemplazar
                      </app-button>
                    }
                  </div>
                </div>

                <!-- Ficha: los 8 campos que ya llegaban y la pantalla tiraba.
                     Un badge que sólo dice «Cargado» obliga a abrir el .p12 por
                     fuera para saber a nombre de quién firma este tenant. -->
                @if (certificateSummary(); as cert) {
                  <dl
                    class="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3 xl:grid-cols-4"
                  >
                    <div class="col-span-2 min-w-0">
                      <dt class="text-[10px] uppercase text-text-secondary">
                        Titular
                      </dt>
                      <dd
                        class="truncate text-xs font-medium text-text-primary"
                        [title]="cert.holder || ''"
                      >
                        {{ cert.holder || '—' }}
                      </dd>
                    </div>
                    <div class="min-w-0">
                      <dt class="text-[10px] uppercase text-text-secondary">
                        NIT del certificado
                      </dt>
                      <dd class="font-mono text-xs text-text-primary">
                        {{ cert.nit || '—' }}
                      </dd>
                    </div>
                    <div class="min-w-0">
                      <dt class="text-[10px] uppercase text-text-secondary">
                        Serie
                      </dt>
                      <dd class="break-all font-mono text-xs text-text-primary">
                        {{ cert.serial || '—' }}
                      </dd>
                    </div>
                    <div class="col-span-2 min-w-0">
                      <dt class="text-[10px] uppercase text-text-secondary">
                        Emisor
                      </dt>
                      <dd
                        class="truncate text-xs text-text-primary"
                        [title]="cert.issuer || ''"
                      >
                        {{ cert.issuer || '—' }}
                      </dd>
                    </div>
                    <div class="min-w-0">
                      <dt class="text-[10px] uppercase text-text-secondary">
                        Cargado
                      </dt>
                      <dd class="text-xs text-text-primary">
                        {{ cert.uploadedAt || '—' }}
                      </dd>
                    </div>
                    <div class="min-w-0">
                      <dt class="text-[10px] uppercase text-text-secondary">
                        Vence
                      </dt>
                      <dd class="text-xs text-text-primary">
                        {{ cert.expiry || '—' }}
                        @if (cert.daysLeft !== null) {
                          <span class="text-text-secondary">
                            ({{ cert.daysLeft }} días)
                          </span>
                        }
                      </dd>
                    </div>
                    <div class="col-span-2 min-w-0">
                      <dt class="text-[10px] uppercase text-text-secondary">
                        Origen
                      </dt>
                      <dd class="text-xs text-text-primary">
                        {{ cert.source || '—' }}
                      </dd>
                    </div>
                  </dl>
                } @else if (canUploadCertificate()) {
                  <p class="mt-2 text-[11px] text-text-secondary">
                    Esta configuración no tiene certificado cargado: sin él no
                    se puede firmar ningún documento ante la DIAN.
                  </p>
                }

                @if (canUploadCertificate()) {
                  @if (certificateFormOpen()) {
                    <div
                      class="mt-2.5 space-y-2 rounded-md border border-dashed border-border p-2.5"
                    >
                      <app-file-upload-dropzone
                        label="Adjunta el archivo .p12 o .pfx"
                        helperText="La clave privada del contribuyente. El backend rechaza el archivo si su NIT no coincide."
                        accept=".p12,.pfx"
                        icon="key"
                        (fileSelected)="onCertificateFileSelected($event)"
                        (fileRemoved)="onCertificateFileSelected(null)"
                      ></app-file-upload-dropzone>

                      <!-- La contraseña guardada NO se precarga enmascarada: un
                           campo con «****» revelable por el botón de ojo parece
                           la contraseña real, y canSubmitCertificate ya rechaza
                           ese centinela, así que rellenarlo sólo confundía. -->
                      @if (hasStoredCertificatePassword()) {
                        <p
                          class="flex items-start gap-1.5 text-[11px] text-text-secondary"
                        >
                          <app-icon
                            name="lock"
                            [size]="13"
                            class="mt-px shrink-0"
                          ></app-icon>
                          <span>
                            Hay una contraseña guardada para el certificado
                            actual. No hace falta reingresarla, y no abre un
                            archivo nuevo.
                          </span>
                        </p>
                      }

                      <app-input
                        label="Contraseña del .p12 nuevo"
                        type="password"
                        [formControl]="certificatePassword"
                        helperText="Se habilita al adjuntar el archivo: la contraseña guardada no abre un .p12 distinto."
                      ></app-input>

                      <div class="flex flex-wrap justify-end gap-2">
                        @if (hasCertificate(selectedConfig())) {
                          <app-button
                            variant="ghost"
                            size="sm"
                            (clicked)="cancelCertificateReplacement()"
                          >
                            Cancelar
                          </app-button>
                        }
                        <app-button
                          variant="primary"
                          size="sm"
                          [disabled]="!canSubmitCertificate()"
                          [loading]="uploadingCertificate()"
                          (clicked)="askAction('certificate')"
                        >
                          <app-icon
                            name="upload"
                            [size]="16"
                            slot="icon"
                          ></app-icon>
                          Subir certificado
                        </app-button>
                      </div>
                    </div>
                  }
                } @else {
                  <p class="mt-2 text-[11px] text-text-secondary">
                    Requiere la capacidad
                    <code>{{ capability.dianCertificateWrite }}</code>.
                  </p>
                }
              </section>

              <!-- Set de pruebas ---------------------------------------- -->
              <section class="rounded-lg border border-border p-2.5">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <app-icon
                      name="file-check"
                      [size]="16"
                      class="text-text-secondary"
                    ></app-icon>
                    <h3 class="text-sm font-semibold text-text-primary">
                      Set de pruebas de habilitación
                    </h3>
                  </div>
                  <!-- Rotulado como LOTE a propósito: describe el envío, no la
                       emisión ni la habilitación. Sin el prefijo, este badge y
                       el de emisión parecen contradecirse en la misma pantalla. -->
                  <app-badge [variant]="testSetVariant()" size="xs">
                    Lote: {{ testSetLabel() }}
                  </app-badge>
                </div>

                <!-- Evidencia del último envío: sin esto el operador ve un
                     badge rojo y ningún dato con el que reclamar el veredicto. -->
                @if (lastSubmission(); as sent) {
                  <dl
                    class="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 rounded-md bg-background/60 p-2.5 sm:grid-cols-4"
                  >
                    <div class="min-w-0">
                      <dt class="text-[10px] uppercase text-text-secondary">
                        Documentos enviados
                      </dt>
                      <dd class="text-xs text-text-primary">
                        {{ sent.total ?? '—' }}
                        @if (sent.invoices !== null) {
                          <span class="text-text-secondary">
                            ({{ sent.invoices }} FV / {{ sent.creditNotes }} NC /
                            {{ sent.debitNotes }} ND)
                          </span>
                        }
                      </dd>
                    </div>
                    <div class="min-w-0">
                      <dt class="text-[10px] uppercase text-text-secondary">
                        Enviado
                      </dt>
                      <dd class="text-xs text-text-primary">
                        {{ sent.executedAt || '—' }}
                      </dd>
                    </div>
                    <div class="min-w-0">
                      <dt class="text-[10px] uppercase text-text-secondary">
                        Última consulta
                      </dt>
                      <dd class="text-xs text-text-primary">
                        {{ sent.recheckedAt || '—' }}
                      </dd>
                    </div>
                    <div class="min-w-0">
                      <dt class="text-[10px] uppercase text-text-secondary">
                        Consultas sin veredicto
                      </dt>
                      <dd class="text-xs text-text-primary">
                        {{ sent.pollsWithoutVerdict }} de {{ sent.polls }}
                      </dd>
                    </div>
                    @if (sent.zipKey) {
                      <div class="col-span-2 min-w-0 sm:col-span-4">
                        <dt class="text-[10px] uppercase text-text-secondary">
                          ZipKey — identificador con el que se reclama el
                          veredicto a la DIAN
                        </dt>
                        <dd
                          class="break-all font-mono text-[11px] text-text-primary"
                        >
                          {{ sent.zipKey }}
                        </dd>
                      </div>
                    }
                    @if (sent.lastPollMessage) {
                      <div class="col-span-2 min-w-0 sm:col-span-4">
                        <dt class="text-[10px] uppercase text-text-secondary">
                          Respuesta de la DIAN
                        </dt>
                        <dd class="text-[11px] text-text-primary">
                          {{ sent.lastPollMessage }}
                        </dd>
                      </div>
                    }
                  </dl>
                }

                @if (consumes(); as burned) {
                  <div
                    class="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900"
                  >
                    <p class="font-semibold">
                      Consecutivos quemados por el último envío
                    </p>
                    <p class="mt-0.5">
                      {{ burned.prefix }}{{ burned.number_from }} –
                      {{ burned.prefix }}{{ burned.number_to }} · hasta
                      {{ burned.range_to }} autorizado. No se recuperan.
                    </p>
                  </div>
                }

                @if (polling()) {
                  <div
                    class="mt-2 flex items-center gap-2 rounded-md bg-background p-2 text-xs text-text-secondary"
                  >
                    <div
                      class="h-3 w-3 animate-spin rounded-full border-b-2 border-primary"
                    ></div>
                    <span>{{ pollingLabel() }}</span>
                  </div>
                }

                @if (canRunTestSet()) {
                  <div class="mt-2.5 space-y-2">
                    <app-selector
                      label="Resolución de numeración"
                      placeholder="Selecciona la resolución que se va a consumir"
                      [options]="resolutionOptions()"
                      [formControl]="resolutionControl"
                      helpText="El envío consume un bloque de esta resolución."
                    ></app-selector>

                    <!-- Varias resoluciones sirven y ninguna se elige sola:
                         quemar consecutivos de la equivocada es irreversible. -->
                    @if (resolutionChoiceRequired()) {
                      <p
                        class="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900"
                      >
                        <app-icon
                          name="alert-triangle"
                          [size]="14"
                          class="mt-px shrink-0"
                        ></app-icon>
                        <span>
                          Hay {{ eligibleResolutions().length }} resoluciones de
                          factura de venta vigentes y con rango disponible. No se
                          preselecciona ninguna: el envío quema consecutivos que
                          no se recuperan, así que la resolución la escoges tú.
                        </span>
                      </p>
                    }

                    @for (warning of resolutionWarnings(); track warning) {
                      <p
                        class="flex items-start gap-1.5 text-[11px] text-red-600"
                      >
                        <app-icon
                          name="alert-triangle"
                          [size]="14"
                          class="mt-px shrink-0"
                        ></app-icon>
                        <span>{{ warning }}</span>
                      </p>
                    }

                    @if (projectedBurn(); as burn) {
                      <p class="text-[11px] text-text-secondary">
                        Proyección: {{ burn.label }} — quemaría
                        {{ burn.numberFrom }} → {{ burn.numberTo }}
                        ({{ burn.total }} consecutivos).
                        @if (burn.overflows) {
                          <span class="font-semibold text-red-600">
                            Excede el rango autorizado ({{ burn.rangeTo }}).
                          </span>
                        }
                      </p>
                    }

                    <div class="flex flex-wrap justify-end gap-2">
                      <app-button
                        variant="outline"
                        size="sm"
                        [disabled]="!canAbandon()"
                        [loading]="abandoning()"
                        (clicked)="askAction('abandon')"
                      >
                        <app-icon
                          name="trash-2"
                          [size]="16"
                          slot="icon"
                        ></app-icon>
                        Descartar lote
                      </app-button>
                      <app-button
                        variant="primary"
                        size="sm"
                        [disabled]="!canSubmitTestSet()"
                        [loading]="runningTestSet()"
                        (clicked)="askAction('run-test-set')"
                      >
                        <app-icon name="play" [size]="16" slot="icon"></app-icon>
                        Ejecutar set de pruebas
                      </app-button>
                    </div>
                  </div>
                } @else {
                  <p class="mt-2 text-[11px] text-text-secondary">
                    Requiere la capacidad <code>{{ capability.dianWrite }}</code
                    >.
                  </p>
                }
              </section>

              <!-- Promoción a producción -------------------------------- -->
              <section class="rounded-lg border border-border p-2.5">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <app-icon
                      name="globe"
                      [size]="16"
                      class="text-text-secondary"
                    ></app-icon>
                    <h3 class="text-sm font-semibold text-text-primary">
                      Promover a producción
                    </h3>
                  </div>
                  <app-badge
                    [variant]="
                      config.environment === 'production' ? 'success' : 'neutral'
                    "
                    size="xs"
                  >
                    Ambiente:
                    {{
                      config.environment === 'production'
                        ? 'Producción'
                        : 'Pruebas'
                    }}
                  </app-badge>
                </div>

                <p class="mt-1.5 text-xs text-text-secondary">
                  A partir de la promoción, cada venta del comerciante se emite
                  ante la DIAN con este NIT y deja de imprimirse como documento
                  no fiscal.
                </p>

                <!-- Checklist de production-readiness. El backend ya la
                     devolvía y nadie la pedía: sin ella el operador teclea el
                     NIT completo para enterarse del rechazo después. -->
                @if (readinessGroups().length) {
                  <div
                    class="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3"
                  >
                    @for (group of readinessGroups(); track group.key) {
                      <div class="rounded-md border p-2.5" [class]="group.classes">
                        <p
                          class="text-[11px] font-semibold uppercase tracking-wide"
                        >
                          {{ group.title }}
                        </p>
                        <p class="mt-0.5 text-[11px] opacity-80">
                          {{ group.hint }}
                        </p>
                        <ul class="mt-1.5 space-y-1.5">
                          @for (item of group.items; track item.key) {
                            <li class="flex items-start gap-1.5 text-[11px]">
                              <app-icon
                                [name]="item.satisfied ? 'check' : 'x'"
                                [size]="13"
                                class="mt-px shrink-0"
                              ></app-icon>
                              <span class="leading-snug">
                                <span class="font-medium">{{ item.label }}</span>
                                @if (!item.satisfied && item.action) {
                                  <span class="block opacity-80">
                                    {{ item.action }}
                                  </span>
                                }
                              </span>
                            </li>
                          }
                        </ul>
                      </div>
                    }
                  </div>
                }

                @if (readinessUnavailable()) {
                  <p
                    class="mt-2 flex items-start gap-1.5 text-[11px] text-text-secondary"
                  >
                    <app-icon
                      name="info"
                      [size]="13"
                      class="mt-px shrink-0"
                    ></app-icon>
                    <span>
                      No se pudo verificar la checklist de producción. La
                      promoción sigue disponible detrás del NIT tecleado: un
                      fallo de red no debe frenar una operación de soporte
                      legítima, y el backend vuelve a validar al recibirla.
                    </span>
                  </p>
                }

                @if (canPromote()) {
                  <div
                    class="mt-2.5 flex flex-wrap items-center justify-end gap-2"
                  >
                    @if (promoteBlockReason(); as reason) {
                      <p
                        class="mr-auto flex items-start gap-1.5 text-[11px] text-red-600"
                      >
                        <app-icon
                          name="alert-triangle"
                          [size]="14"
                          class="mt-px shrink-0"
                        ></app-icon>
                        <span>{{ reason }}</span>
                      </p>
                    }
                    <app-button
                      variant="danger"
                      size="sm"
                      [disabled]="!canOpenPromoteGate()"
                      [loading]="promoting()"
                      (clicked)="openPromoteGate()"
                    >
                      <app-icon name="globe" [size]="16" slot="icon"></app-icon>
                      Promover a producción
                    </app-button>
                  </div>
                } @else {
                  <p class="mt-2 text-[11px] text-text-secondary">
                    Requiere la capacidad <code>{{ capability.dianPromote }}</code
                    >.
                  </p>
                }
              </section>
            }
          </div>
        </app-card>
      }

      <!-- Módulo compartido de configuraciones DIAN ------------------------ -->
      <vendix-dian-config [readOnly]="!canWriteConfig()"></vendix-dian-config>
    </div>

    <!-- Confirmaciones ---------------------------------------------------- -->
    @if (pendingAction(); as action) {
      <app-confirmation-modal
        [isOpen]="true"
        [title]="confirmTitle(action)"
        [message]="confirmMessage(action)"
        [confirmText]="confirmCta(action)"
        cancelText="Cancelar"
        confirmVariant="danger"
        size="md"
        (confirm)="runAction(action)"
        (cancel)="pendingAction.set(null)"
      ></app-confirmation-modal>
    }

    <!-- Promoción: exige teclear el NIT ------------------------------------ -->
    <app-modal
      [(isOpen)]="promoteGateOpen"
      title="Promover a producción"
      subtitle="Confirmación reforzada"
      size="md"
      [closeOnBackdrop]="false"
      (cancel)="onPromoteGateClosed()"
    >
      <div class="space-y-3">
        <app-alert-banner variant="danger" icon="alert-triangle">
          Estás a punto de poner a facturar en producción el NIT de
          {{ store.tenantName() }}. Los documentos que se emitan desde ese
          momento son fiscales ante la DIAN y no se pueden retirar: sólo se
          anulan con nota crédito.
        </app-alert-banner>

        @if (readinessUnavailable()) {
          <app-alert-banner variant="warning" icon="info">
            No se pudo leer la checklist de producción de este tenant, así que
            esta promoción va sin verificación previa. El backend la vuelve a
            validar y puede rechazarla.
          </app-alert-banner>
        }

        <p class="text-sm text-text-secondary">
          Escribe el NIT
          <strong class="text-text-primary">{{ expectedNit() }}</strong> para
          confirmar que operas sobre el contribuyente correcto.
        </p>

        <app-input
          label="NIT del tenant"
          [formControl]="promoteNit"
          placeholder="Sin dígito de verificación"
        ></app-input>

        @if (promoteNitTyped().length && !promoteNitMatches()) {
          <p class="flex items-center gap-1.5 text-xs text-red-600">
            <app-icon name="alert-triangle" [size]="14"></app-icon>
            El NIT no coincide con el de la configuración seleccionada.
          </p>
        }
      </div>

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="ghost" size="sm" (clicked)="closePromoteGate()">
          Cancelar
        </app-button>
        <app-button
          variant="danger"
          size="sm"
          [disabled]="!promoteNitMatches() || promoting()"
          [loading]="promoting()"
          (clicked)="promoteToProduction()"
        >
          <app-icon name="globe" [size]="16" slot="icon"></app-icon>
          Promover
        </app-button>
      </div>
    </app-modal>
  `,
})
export class TenantDianHostComponent {
  private readonly api = inject(DianConfigApiService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  protected readonly store = inject(TenantContextStore);

  protected readonly capability = TENANT_CAPABILITY;

  // ── Datos ────────────────────────────────────────────────────────────
  protected readonly configs = signal<TenantDianConfig[]>([]);
  protected readonly resolutions = signal<ResolutionRow[]>([]);
  protected readonly emission = signal<DianEmissionStatus | null>(null);
  protected readonly lastResult = signal<DianTestResult | null>(null);
  protected readonly composition = signal<TestSetComposition | null>(null);
  protected readonly consumes = signal<TestSetConsumes | null>(null);
  protected readonly readiness = signal<DianProductionReadiness | null>(null);
  /** La checklist no se pudo leer. NO bloquea: sólo se declara. */
  protected readonly readinessUnavailable = signal(false);

  // Los dos selectores son CVAs: el valor viaja por FormControl y se puentea a
  // señal con `toSignal`, porque un `computed()` que lea `control.value` se
  // evaluaría una sola vez y jamás volvería a recalcularse.
  protected readonly configControl = new FormControl<number | null>(null);
  protected readonly resolutionControl = new FormControl<number | null>(null);

  private readonly configControlValue = toSignal(
    this.configControl.valueChanges.pipe(startWith(this.configControl.value)),
    { initialValue: this.configControl.value },
  );
  private readonly resolutionControlValue = toSignal(
    this.resolutionControl.valueChanges.pipe(
      startWith(this.resolutionControl.value),
    ),
    { initialValue: this.resolutionControl.value },
  );

  protected readonly selectedConfigId = computed<number | null>(() =>
    this.toId(this.configControlValue()),
  );
  protected readonly selectedResolutionId = computed<number | null>(() =>
    this.toId(this.resolutionControlValue()),
  );

  // ── Estado de UI ─────────────────────────────────────────────────────
  protected readonly refreshing = signal(false);
  protected readonly uploadingCertificate = signal(false);
  protected readonly runningTestSet = signal(false);
  protected readonly abandoning = signal(false);
  protected readonly promoting = signal(false);
  protected readonly pendingAction = signal<RiskyAction | null>(null);
  protected readonly promoteGateOpen = signal(false);
  /** El formulario de subida sólo se abre a petición si ya hay certificado. */
  protected readonly replacingCertificate = signal(false);

  private readonly certificateFile = signal<File | null>(null);
  private readonly activeJobId = signal<string | null>(null);

  protected readonly certificatePassword = new FormControl<string>('', {
    nonNullable: true,
  });
  protected readonly promoteNit = new FormControl<string>('', {
    nonNullable: true,
  });

  /**
   * `computed()` no reacciona a un `FormControl`: sus propiedades son campos
   * planos. Sin este puente el botón de promoción no se habilitaría nunca.
   */
  private readonly certificatePasswordTyped = toSignal(
    this.certificatePassword.valueChanges.pipe(
      startWith(this.certificatePassword.value),
    ),
    { initialValue: this.certificatePassword.value },
  );

  protected readonly promoteNitTyped = toSignal(
    this.promoteNit.valueChanges.pipe(startWith(this.promoteNit.value)),
    { initialValue: this.promoteNit.value },
  );

  /** Gate de visibilidad: una pestaña oculta no interroga a la DIAN. */
  private readonly documentVisible = signal(true);

  // ── Derivados ────────────────────────────────────────────────────────
  protected readonly ownerNotice = computed(() => fiscalOwnerNotice(this.store));

  protected readonly canWriteConfig = computed(() =>
    this.store.can(TENANT_CAPABILITY.dianWrite),
  );
  protected readonly canUploadCertificate = computed(() =>
    this.store.can(TENANT_CAPABILITY.dianCertificateWrite),
  );
  protected readonly canRunTestSet = computed(() =>
    this.store.can(TENANT_CAPABILITY.dianWrite),
  );
  protected readonly canPromote = computed(() =>
    this.store.can(TENANT_CAPABILITY.dianPromote),
  );
  protected readonly anyCapability = computed(
    () =>
      this.canWriteConfig() ||
      this.canUploadCertificate() ||
      this.canPromote(),
  );

  protected readonly selectedConfig = computed<TenantDianConfig | null>(() => {
    const id = this.selectedConfigId();
    return this.configs().find((config) => config.id === id) ?? null;
  });

  protected readonly selectedResolution = computed<ResolutionRow | null>(() => {
    const id = this.selectedResolutionId();
    return this.resolutions().find((row) => row.id === id) ?? null;
  });

  protected readonly configOptions = computed<SelectorOption[]>(() =>
    this.configs().map((config) => ({
      value: config.id,
      label: config.is_default ? `${config.name} (predeterminada)` : config.name,
      description: `${config.nit}${config.nit_dv ? '-' + config.nit_dv : ''} · ${
        config.environment === 'production' ? 'Producción' : 'Pruebas'
      } · ${dianEnablementLabel(config.enablement_status)}`,
    })),
  );

  /**
   * Opciones del selector de resoluciones.
   *
   * Desactivar sólo por `is_active` era insuficiente: una resolución de nota
   * crédito está activa y sirve perfectamente para su documento, pero NO para
   * un set de habilitación. La descripción dice por qué está bloqueada en vez
   * de dejar una fila muerta sin explicación.
   */
  protected readonly resolutionOptions = computed<SelectorOption[]>(() =>
    this.resolutions().map((row) => {
      const blocked = this.resolutionBlockReason(row);
      const remaining = row.range_to - (row.current_number ?? 0);
      return {
        value: row.id,
        label: `${row.prefix || 'sin prefijo'} · ${row.resolution_number}`,
        description: blocked
          ? `${blocked} · rango ${row.range_from}–${row.range_to}`
          : `Actual ${row.current_number} · rango ${row.range_from}–${row.range_to} · quedan ${remaining}`,
        disabled: blocked !== null,
      };
    }),
  );

  /**
   * Resoluciones con las que un set de habilitación es viable HOY: activas, de
   * factura de venta, vigentes por fecha y con rango disponible.
   */
  protected readonly eligibleResolutions = computed<ResolutionRow[]>(() =>
    this.resolutions().filter((row) => this.isEligibleForTestSet(row)),
  );

  /** Hay más de una candidata y ninguna elegida: la escoge el operador. */
  protected readonly resolutionChoiceRequired = computed(
    () =>
      this.selectedResolutionId() === null &&
      this.eligibleResolutions().length > 1,
  );

  /**
   * Avisos sobre la resolución YA elegida. El desbordamiento de rango lo reporta
   * `projectedBurn`; acá van los dos que faltaban: vigencia vencida y tipo de
   * documento equivocado.
   */
  protected readonly resolutionWarnings = computed<string[]>(() => {
    const row = this.selectedResolution();
    if (!row) return [];

    const warnings: string[] = [];

    if (this.isResolutionExpired(row)) {
      warnings.push(
        `Esta resolución venció el ${this.formatDay(row.valid_to) ?? row.valid_to}. La DIAN rechaza documentos numerados fuera de vigencia.`,
      );
    }

    const documentType = this.resolutionDocumentType(row);
    if (documentType !== null && documentType !== TEST_SET_DOCUMENT_TYPE) {
      warnings.push(
        `Esta resolución es de ${this.documentTypeLabel(documentType)}, no de factura de venta: no sirve para un set de habilitación.`,
      );
    }

    return warnings;
  });

  protected readonly expectedNit = computed(
    () => this.selectedConfig()?.nit ?? '',
  );

  protected readonly promoteNitMatches = computed(() => {
    const expected = this.expectedNit().trim();
    if (!expected) return false;
    return this.promoteNitTyped().trim() === expected;
  });

  // ── Certificado ──────────────────────────────────────────────────────
  protected readonly hasStoredCertificatePassword = computed(() => {
    const stored = this.selectedConfig()?.certificate_password_encrypted;
    return Boolean(stored);
  });

  /**
   * Sin certificado el formulario está abierto —es lo único que falta—; con
   * certificado se abre a petición. Un input de archivo vacío junto a un badge
   * «Cargado» invita a resubir un .p12 que ya está bien.
   */
  protected readonly certificateFormOpen = computed(() => {
    const config = this.selectedConfig();
    if (!config) return false;
    if (!this.hasCertificate(config)) return true;
    return this.replacingCertificate();
  });

  protected readonly certificateSummary = computed<CertificateSummary | null>(
    () => {
      const config = this.selectedConfig();
      if (!config || !this.hasCertificate(config)) return null;

      const daysLeft = this.daysUntil(config.certificate_expiry);
      const source = config.certificate_source ?? null;

      return {
        holder: this.extractCommonName(config.certificate_subject),
        nit: config.certificate_nit ?? null,
        serial: config.certificate_serial_number ?? null,
        issuer: this.extractCommonName(config.certificate_issuer),
        uploadedAt: this.formatInstant(config.certificate_uploaded_at),
        expiry: this.formatDay(config.certificate_expiry),
        daysLeft,
        statusLabel: this.certificateStatusLabel(daysLeft),
        statusVariant: this.certificateStatusVariant(daysLeft),
        source: source ? (CERTIFICATE_SOURCE_LABELS[source] ?? source) : null,
      };
    },
  );

  // ── Emisión: la respuesta completa, no una línea ─────────────────────
  protected readonly emissionGroups = computed<ChecklistGroup[]>(() => {
    const status = this.emission();
    if (!status) return [];

    const blockers = status.blockers ?? [];
    const warnings = status.warnings ?? [];

    return this.buildGroups(
      blockers.filter(
        (item) => item.owner === 'platform' && item.blocked_by !== 'dian',
      ),
      blockers.filter(
        (item) => item.owner === 'tenant' && item.blocked_by !== 'dian',
      ),
      blockers.filter((item) => item.blocked_by === 'dian'),
      warnings,
    );
  });

  // ── Producción: checklist real, no adivinanza ────────────────────────
  protected readonly readinessGroups = computed<ChecklistGroup[]>(() => {
    const report = this.readiness();
    if (!report) return [];

    const checks = report.checks ?? [];
    const blocking = checks.filter((item) => item.severity !== 'warning');

    return this.buildGroups(
      blocking.filter(
        (item) => item.owner === 'platform' && item.blocked_by !== 'dian',
      ),
      blocking.filter(
        (item) => item.owner === 'tenant' && item.blocked_by !== 'dian',
      ),
      blocking.filter((item) => item.blocked_by === 'dian'),
      checks.filter((item) => item.severity === 'warning'),
    );
  });

  /**
   * Primer bloqueante que impide la promoción.
   *
   * `readiness() === null` NO bloquea: si la consulta falló, el gate de tecleo
   * del NIT sigue siendo la protección, y un fallo de red no puede impedir una
   * operación de soporte legítima.
   */
  protected readonly promoteBlockReason = computed<string | null>(() => {
    const config = this.selectedConfig();
    if (!config) return null;
    if (config.environment === 'production') {
      return 'Esta configuración ya está en producción.';
    }

    const report = this.readiness();
    if (!report || report.ready !== false) return null;

    const pending = (report.checks ?? []).find(
      (item) => !item.satisfied && item.severity !== 'warning',
    );
    if (!pending) {
      return 'La checklist de producción del backend todavía no está satisfecha.';
    }

    return `Falta: ${pending.label}${pending.action ? ` — ${pending.action}` : ''} (${this.ownerLabel(pending)}).`;
  });

  protected readonly canOpenPromoteGate = computed(() => {
    const config = this.selectedConfig();
    if (!config || this.promoting()) return false;
    if (config.environment === 'production') return false;
    return this.readiness()?.ready !== false;
  });

  // ── Set de pruebas ───────────────────────────────────────────────────
  /**
   * Proyección del bloque que el envío quemaría.
   *
   * El total NO está hardcodeado: sale de `composition` que publica el propio
   * backend en `getDianTestResults`. Hardcodear 50 aquí es exactamente el
   * defecto que costó una habilitación — la composición la aprovisiona la DIAN
   * por set y sólo el backend la conoce.
   */
  protected readonly projectedBurn = computed(() => {
    const resolution = this.selectedResolution();
    const composition = this.composition();
    if (!resolution || !composition) return null;

    const numberFrom = Math.max(
      resolution.range_from,
      (resolution.current_number ?? 0) + 1,
    );
    const numberTo = numberFrom + composition.total - 1;

    return {
      label: composition.label,
      total: composition.total,
      numberFrom,
      numberTo,
      rangeTo: resolution.range_to,
      overflows: numberTo > resolution.range_to,
    };
  });

  /** Evidencia del último envío: composición, ZipKey, fechas y sondeos. */
  protected readonly lastSubmission = computed<LastSubmission | null>(() => {
    const result = this.lastResult();
    if (!result) return null;

    const history = result.poll_history ?? [];
    const zipKey = result.zip_key ?? null;
    const total = result.total_documents ?? null;
    const invoices = result.invoices_count ?? null;

    // Sin ninguno de estos datos no hay nada que mostrar: el badge basta.
    if (total === null && invoices === null && !zipKey && !result.executed_at) {
      return null;
    }

    const lastPoll = history.length ? history[history.length - 1] : null;

    return {
      total:
        total ??
        (invoices !== null
          ? invoices +
            (result.credit_notes_count ?? 0) +
            (result.debit_notes_count ?? 0)
          : null),
      invoices,
      creditNotes: result.credit_notes_count ?? null,
      debitNotes: result.debit_notes_count ?? null,
      executedAt: this.formatInstant(result.executed_at),
      recheckedAt: this.formatInstant(result.rechecked_at),
      zipKey,
      polls: history.length,
      pollsWithoutVerdict: history.filter((entry) => !entry.success).length,
      lastPollMessage: lastPoll?.status_message ?? null,
    };
  });

  /** Hay veredicto pendiente que la DIAN todavía puede emitir. */
  private readonly verdictPending = computed(() => {
    const result = this.lastResult();
    if (!result) return false;
    if (result.success || result.rejected) return false;
    if (result.wait?.stalled) return false;
    return result.pending === true;
  });

  protected readonly polling = computed(
    () => this.activeJobId() !== null || this.verdictPending(),
  );

  protected readonly pollingLabel = computed(() =>
    this.activeJobId() !== null
      ? 'Construyendo, firmando y enviando el lote a la DIAN…'
      : 'La DIAN acusó recibo del lote y todavía no emite veredicto.',
  );

  /**
   * Etiqueta del LOTE enviado — no de la habilitación ni de la emisión.
   *
   * Los tres badges de esta pantalla describen cosas distintas y se leían como
   * contradicción; el vocabulario de `enablement_status` tiene un dueño único
   * (`dianEnablementLabel`) y no se replica acá.
   */
  protected readonly testSetLabel = computed(() => {
    const result = this.lastResult();
    if (!result) return 'No enviado';
    if (result.success) return 'Aprobado';
    if (result.rejected) return 'Rechazado';
    if (result.wait?.stalled) return 'Sin veredicto';
    if (result.pending) return 'En validación';
    return 'Desconocido';
  });

  protected readonly testSetVariant = computed<StatusVariant>(() => {
    const result = this.lastResult();
    if (!result) return 'neutral';
    if (result.success) return 'success';
    if (result.rejected) return 'error';
    if (result.wait?.stalled) return 'error';
    if (result.pending) return 'warning';
    return 'neutral';
  });

  protected readonly emissionLabel = computed(() =>
    this.emission()?.is_live ? 'Emitiendo' : 'No emite',
  );

  protected readonly emissionVariant = computed<'success' | 'neutral'>(() =>
    this.emission()?.is_live ? 'success' : 'neutral',
  );

  protected readonly emissionReason = computed(
    () =>
      this.emission()?.reason ??
      (this.emission()?.is_live
        ? 'La tienda emite facturas electrónicas ante la DIAN ahora mismo.'
        : 'Estado de emisión no disponible.'),
  );

  // ── Habilitación de botones ──────────────────────────────────────────
  protected readonly canSubmitCertificate = computed(() => {
    if (!this.canUploadCertificate() || this.uploadingCertificate()) {
      return false;
    }
    if (!this.certificateFile()) return false;
    const password = this.certificatePasswordTyped().trim();
    // El centinela NO se envía: es lo que la API devuelve para decir «hay una
    // guardada», y la guardada no abre el .p12 nuevo.
    return password.length > 0 && password !== MASKED_SECRET;
  });

  protected readonly canSubmitTestSet = computed(() => {
    if (!this.canRunTestSet() || this.runningTestSet()) return false;
    if (this.selectedResolutionId() === null) return false;
    if (this.polling()) return false;
    return true;
  });

  protected readonly canAbandon = computed(() => {
    if (!this.canRunTestSet() || this.abandoning()) return false;
    const result = this.lastResult();
    return Boolean(result?.pending) || Boolean(result?.wait?.stalled);
  });

  constructor() {
    // La contraseña sólo se habilita cuando hay un .p12 adjunto: es el único
    // momento en que el backend la exige.
    this.certificatePassword.disable({ emitEvent: false });

    if (isPlatformBrowser(this.platformId)) {
      this.documentVisible.set(document.visibilityState === 'visible');
      fromEvent(document, 'visibilitychange')
        .pipe(takeUntilDestroyed())
        .subscribe(() =>
          this.documentVisible.set(document.visibilityState === 'visible'),
        );
    }

    /**
     * UN solo sondeo para toda la pantalla, creado una vez y atado al ciclo de
     * vida del componente. Nada de `setInterval`: un temporizador imperativo
     * sobrevive a la navegación si alguien olvida limpiarlo, y en una consola
     * cross-tenant eso significa seguir interrogando a la DIAN por el
     * contribuyente que el operador ya cerró.
     *
     * `exhaustMap` descarta los ticks que caen mientras una consulta sigue en
     * vuelo; `catchError` local impide que un 500 mate el flujo para siempre.
     */
    timer(POLL_INTERVAL_MS, POLL_INTERVAL_MS)
      .pipe(
        filter(() => this.documentVisible() && this.polling()),
        exhaustMap(() => this.pollOnce()),
        takeUntilDestroyed(),
      )
      .subscribe();

    // Los efectos de cambiar de configuración cuelgan del control, no de los
    // manejadores del template: así valen igual para una selección del usuario
    // y para la que hace `reload()` al llegar la lista.
    this.configControl.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((value) => this.onConfigSelected(this.toId(value)));

    this.reload();
  }

  // ── Carga ────────────────────────────────────────────────────────────
  protected reload(): void {
    this.refreshing.set(true);

    this.api
      .getDianConfigs()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: unknown) => {
          const rows = this.unwrapArray<TenantDianConfig>(response);
          this.configs.set(rows);
          this.refreshing.set(false);

          const current = this.selectedConfigId();
          const stillThere = rows.some((row) => row.id === current);
          const next = stillThere
            ? current
            : (rows.find((row) => row.is_default)?.id ?? rows[0]?.id ?? null);
          this.selectConfig(next);
        },
        error: (err: unknown) => {
          this.refreshing.set(false);
          this.configs.set([]);
          this.toast.error(
            extractApiErrorMessage(err) ||
              'No se pudieron cargar las configuraciones DIAN del tenant',
          );
        },
      });

    this.api
      .getResolutions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.resolutions.set([
            ...((response?.data ?? []) as ResolutionRow[]),
          ]);
          // Las resoluciones y el último resultado llegan en cualquier orden,
          // así que la preselección se reintenta desde ambos lados.
          this.autoSelectResolution();
        },
        error: () => this.resolutions.set([]),
      });

    this.api
      .getDianEmissionStatus()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => this.emission.set(response?.data ?? null),
        error: () => this.emission.set(null),
      });
  }

  /** Publica la selección en el control; los efectos los dispara su stream. */
  private selectConfig(configId: number | null): void {
    if (configId === this.selectedConfigId()) {
      // Mismo id: el control no emitiría, así que los efectos se aplican a mano
      // (es el caso de un `reload()` que devuelve la misma configuración).
      this.onConfigSelected(configId);
      return;
    }
    this.configControl.setValue(configId);
  }

  private onConfigSelected(configId: number | null): void {
    // Nada de la configuración anterior sobrevive al cambio: un secreto, un
    // veredicto o una resolución arrastrados describirían al contribuyente
    // equivocado. La resolución se limpia para volver a derivarse del
    // `last_result` de ESTA configuración.
    this.certificateFile.set(null);
    this.consumes.set(null);
    this.lastResult.set(null);
    this.composition.set(null);
    this.activeJobId.set(null);
    this.readiness.set(null);
    this.readinessUnavailable.set(false);
    this.replacingCertificate.set(false);
    this.resolutionControl.setValue(null);

    // La contraseña guardada NO se precarga: `****` en un campo revelable
    // parece la contraseña real y `canSubmitCertificate` ya rechaza el
    // centinela, así que rellenarlo sólo confundía.
    this.certificatePassword.setValue('');
    this.certificatePassword.disable({ emitEvent: false });

    if (configId === null) return;

    this.loadTestResults(configId);
    this.loadReadiness(configId);
    this.resumeActiveJob(configId);
  }

  private loadTestResults(configId: number): void {
    this.api
      .getDianTestResults(configId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: unknown) => {
          const payload = this.unwrapObject(response);
          this.lastResult.set(
            (payload?.['last_result'] as DianTestResult) ?? null,
          );
          this.composition.set(
            (payload?.['composition'] as TestSetComposition) ?? null,
          );
          this.autoSelectResolution();
        },
        error: () => {
          this.lastResult.set(null);
          this.composition.set(null);
        },
      });
  }

  /**
   * Checklist de producción del backend. Existía y nadie la pedía: sin ella el
   * botón se ofrecía habilitado y el rechazo llegaba después de teclear el NIT
   * completo del contribuyente.
   */
  private loadReadiness(configId: number): void {
    this.api
      .getDianProductionReadiness(configId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: unknown) => {
          const payload = this.unwrapObject(response);
          this.readiness.set(
            (payload as DianProductionReadiness | null) ?? null,
          );
          this.readinessUnavailable.set(payload === null);
        },
        error: () => {
          // Falla de red o 5xx: se declara, pero NO se bloquea la promoción.
          this.readiness.set(null);
          this.readinessUnavailable.set(true);
        },
      });
  }

  /**
   * Preselección de la resolución que el envío va a consumir.
   *
   * Orden deliberado:
   *   1. La del último envío. Cambiarla quema un bloque DISTINTO de
   *      consecutivos autorizados, así que la elección previa manda.
   *   2. Si no hubo envío, la única candidata viable — activa, de factura de
   *      venta, vigente y con rango disponible.
   *   3. Si hay VARIAS candidatas no se elige ninguna. Elegir en silencio entre
   *      candidatas es irreversible y ya se pagó una vez: el operador escoge.
   */
  private autoSelectResolution(): void {
    if (this.selectedResolutionId() !== null) return;

    const rows = this.resolutions();
    if (!rows.length) return;

    const fromLastResult = this.lastResult()?.resolution_id ?? null;
    if (fromLastResult && rows.some((row) => row.id === fromLastResult)) {
      this.resolutionControl.setValue(fromLastResult);
      return;
    }

    const candidates = this.eligibleResolutions();
    if (candidates.length === 1) {
      this.resolutionControl.setValue(candidates[0].id);
    }
  }

  // ── Sondeo ───────────────────────────────────────────────────────────
  private pollOnce(): Observable<unknown> {
    const configId = this.selectedConfigId();
    if (configId === null) return of(null);

    const jobId = this.activeJobId();
    if (jobId) {
      return this.api.getDianTestSetJob(configId, jobId).pipe(
        tap((response: unknown) => this.applyJobStatus(configId, response)),
        catchError(() => {
          // Un job evicted responde 404 para siempre: soltarlo evita un sondeo
          // eterno, y el veredicto sigue siendo recuperable por ZipKey.
          this.forgetJob(configId);
          return of(null);
        }),
      );
    }

    return this.api.checkDianTestSetStatus(configId).pipe(
      tap((response: unknown) => {
        const payload = this.unwrapObject(response);
        this.lastResult.set((payload as DianTestResult | null) ?? null);
      }),
      catchError(() => of(null)),
    );
  }

  private applyJobStatus(configId: number, response: unknown): void {
    const payload = this.unwrapObject(response);
    const status = payload?.['status'] as string | undefined;
    if (status !== 'completed' && status !== 'failed') return;

    this.forgetJob(configId);

    if (status === 'failed') {
      this.toast.error(
        (payload?.['error'] as string) ||
          'El envío del set de pruebas falló en el worker.',
      );
    } else {
      this.toast.success('El lote llegó a la DIAN. Falta su veredicto.');
    }

    this.loadTestResults(configId);
  }

  /**
   * Reanuda el sondeo de un envío que quedó en vuelo.
   *
   * El `job_id` se guarda en `sessionStorage` porque el backend no lo persiste
   * en la configuración: sin esto, salir de la pestaña durante los ~74 s que
   * tarda el envío dejaría al operador sin ninguna señal de que su lote —que ya
   * quemó consecutivos— sigue vivo.
   */
  private resumeActiveJob(configId: number): void {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      const stored = sessionStorage.getItem(this.jobStorageKey(configId));
      this.activeJobId.set(stored);
    } catch {
      // Modo privado o storage bloqueado: se pierde la reanudación, no el lote.
      this.activeJobId.set(null);
    }
  }

  private rememberJob(configId: number, jobId: string): void {
    this.activeJobId.set(jobId);
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      sessionStorage.setItem(this.jobStorageKey(configId), jobId);
    } catch {
      /* no bloquea el flujo */
    }
  }

  private forgetJob(configId: number): void {
    this.activeJobId.set(null);
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      sessionStorage.removeItem(this.jobStorageKey(configId));
    } catch {
      /* no bloquea el flujo */
    }
  }

  /** La clave lleva el tenant: dos fichas abiertas no se pisan el job. */
  private jobStorageKey(configId: number): string {
    return `vendix.superadmin.dian.job.${this.store.scope}.${this.store.tenantId()}.${configId}`;
  }

  // ── Certificado: adjuntar y reemplazar ───────────────────────────────
  protected startCertificateReplacement(): void {
    this.replacingCertificate.set(true);
  }

  protected cancelCertificateReplacement(): void {
    this.replacingCertificate.set(false);
    this.onCertificateFileSelected(null);
  }

  protected onCertificateFileSelected(file: File | null): void {
    this.certificateFile.set(file);
    this.certificatePassword.setValue('');
    if (file) {
      this.certificatePassword.enable({ emitEvent: false });
    } else {
      this.certificatePassword.disable({ emitEvent: false });
    }
  }

  // ── Confirmaciones ───────────────────────────────────────────────────
  protected askAction(action: RiskyAction): void {
    this.pendingAction.set(action);
  }

  protected confirmTitle(action: RiskyAction): string {
    switch (action) {
      case 'certificate':
        return 'Cargar el certificado digital del tenant';
      case 'run-test-set':
        return 'Ejecutar el set de pruebas de habilitación';
      case 'abandon':
        return 'Descartar el lote enviado';
    }
  }

  protected confirmCta(action: RiskyAction): string {
    switch (action) {
      case 'certificate':
        return 'Subir certificado';
      case 'run-test-set':
        return 'Quemar consecutivos y enviar';
      case 'abandon':
        return 'Descartar lote';
    }
  }

  protected confirmMessage(action: RiskyAction): string {
    const tenant = this.store.tenantName();
    const config = this.selectedConfig();

    switch (action) {
      case 'certificate':
        return (
          `Se cargará la clave privada del certificado .p12 de ${tenant} sobre la configuración ` +
          `«${config?.name ?? ''}» (NIT ${config?.nit ?? '—'}). El backend rechaza el archivo si ` +
          'su NIT no coincide con el de la configuración, pero un certificado válido y equivocado ' +
          'firmaría documentos a nombre de otro contribuyente.'
        );

      case 'run-test-set': {
        const burn = this.projectedBurn();
        const base =
          `El envío construye, firma y transmite el set completo a la DIAN a nombre de ${tenant} ` +
          '(NIT ' +
          (config?.nit ?? '—') +
          '). ';
        if (!burn) {
          return (
            base +
            'Consume un bloque IRRECUPERABLE de consecutivos autorizados de la resolución ' +
            'seleccionada. El backend declara el rango exacto al encolar.'
          );
        }
        return (
          base +
          `Consumirá ${burn.total} consecutivos autorizados (${burn.label}): del ${burn.numberFrom} ` +
          `al ${burn.numberTo}, sobre un rango que llega hasta ${burn.rangeTo}. ` +
          (burn.overflows
            ? 'ATENCIÓN: el bloque EXCEDE el rango autorizado. '
            : '') +
          'Esos números no se recuperan aunque la DIAN rechace el lote. El backend confirma el ' +
          'rango definitivo en su respuesta.'
        );
      }

      case 'abandon':
        return (
          `Se descartará el lote que ${tenant} tiene enviado y sin veredicto, liberando la guarda ` +
          'de reenvío. Los consecutivos que ese lote ya quemó NO se recuperan, y si la DIAN acaba ' +
          'aprobándolo, el veredicto llegará sobre un lote que la plataforma ya dio por perdido.'
        );
    }
  }

  protected runAction(action: RiskyAction): void {
    this.pendingAction.set(null);
    switch (action) {
      case 'certificate':
        this.uploadCertificate();
        return;
      case 'run-test-set':
        this.runTestSet();
        return;
      case 'abandon':
        this.abandonBatch();
        return;
    }
  }

  // ── Acciones ─────────────────────────────────────────────────────────
  private uploadCertificate(): void {
    const configId = this.selectedConfigId();
    const file = this.certificateFile();
    const password = this.certificatePassword.value.trim();
    if (configId === null || !file || !password || password === MASKED_SECRET) {
      return;
    }

    this.uploadingCertificate.set(true);
    this.api
      .uploadDianCertificate(configId, file, password)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.uploadingCertificate.set(false);
          this.replacingCertificate.set(false);
          this.onCertificateFileSelected(null);
          this.toast.success('Certificado cargado');
          this.reload();
        },
        error: (err: unknown) => {
          this.uploadingCertificate.set(false);
          this.toast.error(
            extractApiErrorMessage(err) || 'No se pudo cargar el certificado',
          );
        },
      });
  }

  private runTestSet(): void {
    const configId = this.selectedConfigId();
    const resolutionId = this.selectedResolutionId();
    if (configId === null || resolutionId === null) return;

    this.runningTestSet.set(true);
    this.api
      .runDianTestSet(configId, resolutionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: unknown) => {
          this.runningTestSet.set(false);
          const payload = this.unwrapObject(response);
          // El rango que devuelve el backend es el AUTORITATIVO: la proyección
          // de la confirmación sólo sirvió para que nadie confirme a ciegas.
          this.consumes.set(
            (payload?.['consumes'] as TestSetConsumes) ?? null,
          );

          const jobId = payload?.['job_id'];
          if (typeof jobId === 'string' && jobId) {
            this.rememberJob(configId, jobId);
            this.toast.info(
              'Set de pruebas encolado. El envío tarda alrededor de un minuto.',
            );
          } else {
            this.loadTestResults(configId);
          }
        },
        error: (err: unknown) => {
          this.runningTestSet.set(false);
          this.toast.error(
            extractApiErrorMessage(err) ||
              'No se pudo encolar el set de pruebas',
          );
        },
      });
  }

  private abandonBatch(): void {
    const configId = this.selectedConfigId();
    if (configId === null) return;

    this.abandoning.set(true);
    this.api
      .abandonDianTestSet(configId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.abandoning.set(false);
          this.forgetJob(configId);
          this.consumes.set(null);
          this.toast.success('Lote descartado. Ya se puede reenviar.');
          this.loadTestResults(configId);
        },
        error: (err: unknown) => {
          this.abandoning.set(false);
          this.toast.error(
            extractApiErrorMessage(err) || 'No se pudo descartar el lote',
          );
        },
      });
  }

  // ── Promoción con NIT tecleado ───────────────────────────────────────
  protected openPromoteGate(): void {
    this.promoteNit.setValue('');
    this.promoteGateOpen.set(true);
  }

  protected closePromoteGate(): void {
    this.promoteGateOpen.set(false);
    this.promoteNit.setValue('');
  }

  protected onPromoteGateClosed(): void {
    this.promoteNit.setValue('');
  }

  protected promoteToProduction(): void {
    const configId = this.selectedConfigId();
    if (configId === null || !this.promoteNitMatches() || this.promoting()) {
      return;
    }

    this.promoting.set(true);
    this.api
      .promoteDianToProduction(configId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.promoting.set(false);
          this.closePromoteGate();
          this.toast.success('Configuración promovida a producción');
          this.reload();
        },
        error: (err: unknown) => {
          this.promoting.set(false);
          this.toast.error(
            extractApiErrorMessage(err) ||
              'La DIAN o el checklist de producción rechazaron la promoción',
          );
        },
      });
  }

  // ── Utilidades ───────────────────────────────────────────────────────
  /**
   * El rail de super admin REDACTA `certificate_s3_key` y reporta
   * `certificate_present` en su lugar: una clave de objeto no es la clave
   * privada, pero nombra dónde vive. Leer sólo `certificate_s3_key` haría que
   * esta consola dijera «sin cargar» sobre certificados que sí existen.
   */
  protected hasCertificate(config: DianConfig | null): boolean {
    if (!config) return false;
    const present = (config as { certificate_present?: boolean })
      .certificate_present;
    return present ?? Boolean(config.certificate_s3_key);
  }

  protected enablementLabel(config: TenantDianConfig): string {
    return dianEnablementLabel(config.enablement_status);
  }

  protected operationModeLabel(config: TenantDianConfig): string {
    const mode = config.operation_mode;
    if (!mode) return '—';
    return OPERATION_MODE_LABELS[mode] ?? mode;
  }

  private ownerLabel(check: DianReadinessCheck): string {
    return check.owner === 'platform'
      ? 'lo resuelve Vendix'
      : 'lo resuelve el comerciante';
  }

  /**
   * Las cuatro cubetas con las que se lee cualquier checklist DIAN: quién puede
   * moverla. Sin esta separación, «esperando a la DIAN» se lee como tarea
   * pendiente y alguien reenvía un set que sigue en revisión.
   */
  private buildGroups(
    platform: DianReadinessCheck[],
    tenant: DianReadinessCheck[],
    waiting: DianReadinessCheck[],
    warnings: DianReadinessCheck[],
  ): ChecklistGroup[] {
    return [
      {
        key: 'platform',
        title: 'Lo resuelve Vendix',
        hint: 'Operación de plataforma; el comerciante no puede tocarlo.',
        classes: 'border-red-300 bg-red-50 text-red-900',
        items: platform,
      },
      {
        key: 'tenant',
        title: 'Lo resuelve el comerciante',
        hint: 'Accionable ya desde el panel del tenant.',
        classes: 'border-amber-300 bg-amber-50 text-amber-900',
        items: tenant,
      },
      {
        key: 'dian',
        title: 'Sólo se espera a la DIAN',
        hint: 'Nuestra parte está hecha. Reenviar no adelanta nada.',
        classes: 'border-blue-300 bg-blue-50 text-blue-900',
        items: waiting,
      },
      {
        key: 'warnings',
        title: 'Avisos tempranos',
        hint: 'No frenan la emisión, pero se vencen.',
        classes: 'border-border bg-background text-text-secondary',
        items: warnings,
      },
    ].filter((group) => group.items.length > 0);
  }

  // ── Resoluciones ─────────────────────────────────────────────────────
  /**
   * `null` significa DESCONOCIDO, no «factura de venta».
   *
   * La asimetría es deliberada: lo desconocido nunca se elige solo (podría
   * quemar el rango equivocado) pero tampoco se bloquea en el selector (el
   * operador sabe más que un campo ausente).
   */
  private resolutionDocumentType(row: ResolutionRow): string | null {
    const type = row.document_type;
    return typeof type === 'string' && type ? type : null;
  }

  private documentTypeLabel(type: string): string {
    return RESOLUTION_DOCUMENT_LABELS[type] ?? type;
  }

  private isResolutionExpired(row: ResolutionRow): boolean {
    if (!row.valid_to) return false;
    const end = new Date(row.valid_to);
    if (Number.isNaN(end.getTime())) return false;
    // `valid_to` es un día calendario, no un instante: se compara como fecha
    // sólo, en UTC, para no correrlo un día por el huso del navegador.
    return toUTCDateString(end) < toLocalDateString();
  }

  private isEligibleForTestSet(row: ResolutionRow): boolean {
    if (!row.is_active) return false;
    if (this.resolutionDocumentType(row) !== TEST_SET_DOCUMENT_TYPE) {
      return false;
    }
    if (this.isResolutionExpired(row)) return false;
    return (row.current_number ?? 0) < row.range_to;
  }

  /** Por qué esta resolución no sirve, o `null` si sí sirve. */
  private resolutionBlockReason(row: ResolutionRow): string | null {
    if (!row.is_active) return 'Inactiva';

    const documentType = this.resolutionDocumentType(row);
    if (documentType !== null && documentType !== TEST_SET_DOCUMENT_TYPE) {
      return `No sirve para el set: es de ${this.documentTypeLabel(documentType)}`;
    }

    if (this.isResolutionExpired(row)) {
      return `Vencida el ${this.formatDay(row.valid_to) ?? row.valid_to}`;
    }

    if ((row.current_number ?? 0) >= row.range_to) return 'Rango agotado';

    return null;
  }

  // ── Fechas ───────────────────────────────────────────────────────────
  /**
   * Fecha de calendario. Pasa por `formatDateOnlyUTC`, la utilidad del
   * proyecto: `toLocaleDateString` directo corre el día un puesto en husos
   * negativos, que es el defecto conocido de esta base de código.
   */
  protected formatDay(value: string | null | undefined): string | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return formatDateOnlyUTC(date);
  }

  /**
   * Instante (envío, reconsulta, carga del certificado).
   *
   * La fecha sale de la utilidad del proyecto y la hora se arma con las partes
   * UTC del propio Date, sin pasar por ICU: el `hourCycle` del contenedor
   * imprime «24:00» a medianoche y acá no hay ninguna razón para arriesgarlo.
   */
  protected formatInstant(value: string | null | undefined): string | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    return `${formatDateOnlyUTC(date)} ${hours}:${minutes} UTC`;
  }

  private daysUntil(value: string | null | undefined): number | null {
    if (!value) return null;
    const target = new Date(value);
    if (Number.isNaN(target.getTime())) return null;

    const targetDay = Date.UTC(
      target.getUTCFullYear(),
      target.getUTCMonth(),
      target.getUTCDate(),
    );
    const now = new Date();
    const today = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );

    return Math.round((targetDay - today) / MS_PER_DAY);
  }

  private certificateStatusLabel(daysLeft: number | null): string {
    if (daysLeft === null) return 'Cargado';
    if (daysLeft < 0) return 'Vencido';
    if (daysLeft < CERTIFICATE_EXPIRY_WARNING_DAYS) {
      return `Vence en ${daysLeft} días`;
    }
    return 'Vigente';
  }

  private certificateStatusVariant(daysLeft: number | null): StatusVariant {
    if (daysLeft === null) return 'neutral';
    if (daysLeft < 0) return 'error';
    if (daysLeft < CERTIFICATE_EXPIRY_WARNING_DAYS) return 'warning';
    return 'success';
  }

  /**
   * Extrae el `CN=` de un DN X.500.
   *
   * El DN llega como lista separada por comas y el CN casi nunca es el primer
   * atributo: en el certificado real viene detrás de `streetAddress` y de un
   * OID numérico, así que partir por la primera coma devolvería basura.
   */
  private extractCommonName(dn: string | null | undefined): string | null {
    if (!dn) return null;
    const match = /(?:^|,)\s*CN\s*=\s*([^,]+)/i.exec(dn);
    const value = match ? match[1].trim() : '';
    return value || null;
  }

  /** El CVA puede devolver el valor como string; el id siempre es numérico. */
  private toId(value: string | number | null | undefined): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private unwrapObject(response: unknown): Record<string, unknown> | null {
    if (!response || typeof response !== 'object') return null;
    const envelope = response as Record<string, unknown>;
    const data = envelope['data'];
    if (data && typeof data === 'object') return data as Record<string, unknown>;
    return envelope;
  }

  private unwrapArray<T>(response: unknown): T[] {
    if (Array.isArray(response)) return response as T[];
    if (!response || typeof response !== 'object') return [];
    const data = (response as Record<string, unknown>)['data'];
    return Array.isArray(data) ? (data as T[]) : [];
  }
}

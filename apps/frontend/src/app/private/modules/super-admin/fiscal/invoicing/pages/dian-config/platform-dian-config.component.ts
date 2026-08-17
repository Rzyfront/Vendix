import { JsonPipe, DatePipe, NgClass } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs';
import { pollAsyncJob } from '../../../../../../../core/utils/async-job-poll.util';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import {
  AlertBannerComponent,
  ButtonComponent,
  DianTechnicalResponseComponent,
  DianTechnicalResponseData,
  FileUploadDropzoneComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  StatsComponent,
  ToastService,
  ToggleComponent,
} from '../../../../../../../shared/components';
// El MISMO panel que usa el asistente DIAN de tiendas, sin una línea de cambio:
// habla con el riel de plataforma porque la ruta reapunta `DIAN_API_CONTEXT`
// (ver `platform-dian-context.factory.ts`), no porque el componente sepa dónde
// está montado.
// Se importa desde el sub-barril `shared/components/dian`, que es de donde lo
// toma el asistente de tiendas: el barril raíz `shared/components` no lo
// reexporta.
import { DianNumberingRangePanelComponent } from '../../../../../../../shared/components/dian';
import { computeNitDv } from '../../../../../../../shared/utils/nit.util';
import {
  SubscriptionFiscalEnvironment,
  SubscriptionFiscalStatus,
  UpsertSubscriptionFiscalConfigDto,
} from '../../../../subscriptions/interfaces/fiscal-billing.interface';
import { FiscalBillingAdminService } from '../../../../subscriptions/services/fiscal-billing-admin.service';
// El reporte de readiness es EL MISMO que el del riel de tiendas: el backend
// delega en su implementación bajo contexto de plataforma.
import type { DianProductionReadiness } from '../../../../../store/invoicing/interfaces/invoice.interface';
import { PlatformInvoicingStore } from '../../platform-invoicing.store';
import { PlatformDianGuideComponent } from '../../components/platform-dian-guide.component';
import {
  DIAN_CONFIG_ENVIRONMENT_OPTIONS,
  confirmProductionValidator,
  environmentLabel,
  nitFormatValidator,
  numericIdValidator,
  optionalNumericIdValidator,
  parseOptionalId,
  parseRequiredId,
  toIdValue,
  uuidValidator,
} from '../../platform-invoicing.constants';

interface FiscalConfigFormControls {
  // Sin `platform_organization_id`, `accounting_entity_id` ni
  // `dian_configuration_id`: la plataforma tiene UNA identidad fiscal y UNA
  // configuración, y el backend las deriva. Pedirlas como ids obligaba a acertar
  // un número que el cliente Prisma scopeado ya calcula, y un valor distinto no
  // fallaba al guardar — fallaba después, con un 404 sobre filas que existían.
  invoice_resolution_id: FormControl<string | null>;
  name: FormControl<string | null>;
  nit: FormControl<string | null>;
  nit_dv: FormControl<string | null>;
  software_id: FormControl<string | null>;
  software_pin: FormControl<string | null>;
  test_set_id: FormControl<string | null>;
  environment: FormControl<SubscriptionFiscalEnvironment>;
  is_enabled: FormControl<boolean>;
  auto_issue: FormControl<boolean>;
  confirm_production: FormControl<boolean>;
}

/** Estados de `dian_configurations.enablement_status`, en palabras. */
const ENABLEMENT_LABELS: Record<string, string> = {
  not_started: 'No iniciada',
  testing: 'En pruebas',
  enabled: 'Habilitada',
  suspended: 'Suspendida',
};

/** Etiqueta legible por control, para decir QUÉ falta en vez de "revisa el formulario". */
const REQUIRED_LABELS: Record<string, string> = {
  name: 'Nombre de configuración',
  nit: 'NIT',
  software_id: 'Software ID',
};

/**
 * Pestaña «Configuración DIAN» de Facturación de plataforma.
 *
 * Reúne lo que antes eran 5 tarjetas sueltas del monolito: entidad emisora,
 * credenciales, flujo de emisión, certificado P12 y set de pruebas — más la
 * guía de habilitación, que es la paridad con el módulo de tiendas.
 */
@Component({
  selector: 'app-platform-dian-config',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    DatePipe,
    JsonPipe,
    NgClass,
    RouterLink,
    AlertBannerComponent,
    ButtonComponent,
    FileUploadDropzoneComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    StatsComponent,
    ToggleComponent,
    PlatformDianGuideComponent,
    DianTechnicalResponseComponent,
    DianNumberingRangePanelComponent,
  ],
  templateUrl: './platform-dian-config.component.html',
})
export class PlatformDianConfigComponent {
  private readonly fb = inject(FormBuilder);
  private readonly fiscal = inject(FiscalBillingAdminService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly store = inject(PlatformInvoicingStore);

  readonly saving = signal(false);
  readonly testing = signal(false);
  /** Un solo candado para las 4 acciones del set de pruebas: son excluyentes. */
  readonly testSetBusy = signal(false);
  readonly testSetResult = signal<unknown>(null);
  readonly uploadingCertificate = signal(false);
  readonly selectedCertificate = signal<File | null>(null);
  readonly certificatePasswordFilled = signal(false);
  readonly selectedEnvironment = signal<SubscriptionFiscalEnvironment>('test');
  readonly isEnabled = signal(false);
  readonly formInvalid = signal(true);
  readonly identityPrefillApplied = signal(false);

  /**
   * Solo sandbox. El paso a producción va por `promote-to-production`, que exige
   * el reporte de readiness completo; `PATCH config` responde 400 a cualquier
   * `environment: 'production'`, así que ofrecerlo acá solo produciría un 400
   * después de llenar el formulario.
   */
  readonly environmentOptions = DIAN_CONFIG_ENVIRONMENT_OPTIONS;
  readonly environmentLabel = environmentLabel;

  // ── Paso a producción ──────────────────────────────────────
  readonly readiness = signal<DianProductionReadiness | null>(null);
  readonly loadingReadiness = signal(false);
  readonly promoting = signal(false);

  /** Bloqueantes del readiness. Vacío no significa listo: puede no haberse leído. */
  readonly readinessBlockers = computed(
    () => this.readiness()?.missing ?? [],
  );

  readonly canPromote = computed(() => this.readiness()?.ready === true);

  /**
   * Notas que quedaron generadas y sin transmitir por el envío en dos fases.
   *
   * Mismo dato y mismo criterio que el asistente de tiendas: el backend proyecta
   * con `buildNotePhaseView` en los tres rieles, así que las tres superficies
   * describen el diferimiento con las mismas palabras.
   */
  readonly hasDeferredNotes = computed(() => {
    const phase = this.store.testSet()?.note_phase ?? null;
    return !!phase && phase.sent === false && phase.deferred_count > 0;
  });

  /** Rango de consecutivos retenidos: cuáles, no solo cuántos. */
  readonly deferredConsecutivesLabel = computed(() => {
    const list = this.store.testSet()?.note_phase?.deferred_consecutives ?? [];
    if (!list.length) return null;
    const from = Math.min(...list);
    const to = Math.max(...list);
    return from === to ? `${from}` : `${from} – ${to}`;
  });

  /** ¿La plataforma ya emite en producción? Entonces no hay nada que promover. */
  readonly alreadyInProduction = computed(() => {
    const config = this.store.dianConfig();
    return (
      config?.environment === 'production' &&
      config?.enablement_status === 'enabled'
    );
  });

  /**
   * Configuración DIAN sobre la que opera el panel de numeración autorizada.
   *
   * `null` mientras la plataforma no tenga configuración: el panel compartido se
   * auto-deshabilita con un `configId` nulo, que es mejor que consultar un id
   * inventado y recibir un 404 al abrir la pestaña.
   */
  readonly dianConfigId = computed(() => this.store.dianConfig()?.id ?? null);

  readonly form: FormGroup<FiscalConfigFormControls> =
    this.fb.group<FiscalConfigFormControls>(
      {
        invoice_resolution_id: this.fb.control<string | null>(null, [
          optionalNumericIdValidator,
        ]),
        name: this.fb.control<string | null>(null, [Validators.required]),
        nit: this.fb.control<string | null>(null, [
          Validators.required,
          nitFormatValidator,
        ]),
        nit_dv: this.fb.control<string | null>(null),
        software_id: this.fb.control<string | null>(null, [
          Validators.required,
          uuidValidator,
        ]),
        software_pin: this.fb.control<string | null>(null),
        test_set_id: this.fb.control<string | null>(null, [uuidValidator]),
        environment:
          this.fb.nonNullable.control<SubscriptionFiscalEnvironment>('test'),
        is_enabled: this.fb.nonNullable.control(false),
        auto_issue: this.fb.nonNullable.control(false),
        confirm_production: this.fb.nonNullable.control(false),
      },
      { validators: confirmProductionValidator },
    );

  readonly certificatePasswordControl = this.fb.control<string | null>(null);

  readonly salesInvoiceResolutionOptions = computed(() =>
    this.store.resolutionOptions('sales_invoice', this.selectedEnvironment()),
  );

  readonly lastTest = computed(
    () => this.store.settings()?.last_test_result ?? null,
  );

  readonly lastTestedAt = computed(
    () => this.store.settings()?.last_tested_at ?? null,
  );

  /** Solo los requisitos incumplidos: la lista completa es ruido cuando falta uno. */
  private readonly unsatisfiedChecks = computed(
    () =>
      this.store
        .habilitationReadiness()
        ?.checks.filter((check) => !check.satisfied) ?? [],
  );

  /**
   * Requisitos que BLOQUEAN el envío del set. Excluye las alertas anticipadas
   * (`severity: 'warning'`): un certificado que vence en 20 días todavía firma,
   * así que contarlo aquí bloquearía la habilitación por un problema futuro.
   */
  readonly pendingChecks = computed(() =>
    this.unsatisfiedChecks().filter((check) => check.severity !== 'warning'),
  );

  /** Alertas anticipadas: mismo contrato y mismos umbrales que en la tienda. */
  readonly readinessWarnings = computed(() =>
    this.unsatisfiedChecks().filter((check) => check.severity === 'warning'),
  );

  /** Lectura acotada de la espera del lote, calculada por el backend. */
  readonly testSetWait = computed(() => this.store.testSet()?.wait ?? null);

  /**
   * Snapshot persistido del lote, para el panel técnico.
   *
   * NO es `testSetResult()`: ese guarda la respuesta de la ÚLTIMA operación (envío,
   * consulta o diagnóstico) y no incluye los nombres de archivo entregados ni el
   * sobre SOAP. Lo que la DIAN devolvió sobre el lote vive en `last_test_result`.
   */
  readonly technicalResult = computed<DianTechnicalResponseData | null>(
    () =>
      (this.store.testSet()?.last_test_result as DianTechnicalResponseData) ??
      null,
  );

  /**
   * Composición del set según el modo de operación, resuelta por el backend. Se
   * lee de ahí y no se escribe a mano: la pantalla decía "50 documentos" —la
   * composición de 2019— cuando `own_software` envía 4 y consume 4 consecutivos
   * de la resolución.
   */
  readonly testSetComposition = computed(
    () => this.store.testSet()?.composition ?? null,
  );

  /** "4 documentos (2 facturas + 1 nota crédito + 1 nota débito)" */
  readonly testSetCompositionLabel = computed(() => {
    const composition = this.testSetComposition();
    if (!composition) return 'los documentos de habilitación';
    return `${composition.total} documento${
      composition.total === 1 ? '' : 's'
    } (${composition.label})`;
  });

  readonly testSetStalled = computed(
    () => this.testSetWait()?.stalled === true,
  );

  /**
   * Los lotes enviados antes de que se persistieran las claves de documento no
   * se pueden consultar por CUFE: ofrecer el botón solo produciría un 412.
   */
  readonly canDiagnoseDocuments = computed(
    () => this.testSetWait()?.diagnosable !== false,
  );

  /** Un lote en curso o estancado bloquea un reenvío: primero hay que descartarlo. */
  readonly testSetBlocksResend = computed(() => {
    const state = this.testSetWait()?.state;
    return state === 'processing' || state === 'stalled';
  });

  readonly testSetStateLabel = computed(() => {
    switch (this.testSetWait()?.state) {
      case 'processing':
        return 'En validación en la DIAN';
      case 'stalled':
        return 'Sin veredicto de la DIAN';
      case 'passed':
        return 'Aprobado por la DIAN';
      case 'rejected':
        return 'Rechazado por la DIAN';
      case 'abandoned':
        return 'Lote descartado';
      default:
        return 'Sin enviar';
    }
  });

  readonly certificateReady = computed(
    () =>
      !!this.selectedCertificate() &&
      this.certificatePasswordFilled() &&
      !this.uploadingCertificate(),
  );

  // ── Semáforo de habilitación ────────────────────────────────────────────
  // Las mismas cuatro tarjetas que abre el módulo DIAN del admin de tienda. La
  // página era un formulario largo sin estado visible: había que leer los seis
  // bloques para saber en qué punto de la habilitación estaba la plataforma.

  readonly enablementStateLabel = computed(() => {
    if (!this.store.configured()) return 'Sin configurar';
    const status = this.store.dianConfig()?.enablement_status ?? 'not_started';
    return ENABLEMENT_LABELS[status] ?? status;
  });

  readonly certificateStateLabel = computed(() => {
    const config = this.store.dianConfig();
    if (!config?.has_certificate) return 'Sin cargar';
    if (!config.certificate_expiry) return 'Cargado';
    const expiry = new Date(config.certificate_expiry).getTime();
    if (Number.isNaN(expiry)) return 'Cargado';
    return expiry < Date.now() ? 'Vencido' : 'Vigente';
  });

  /**
   * Consecutivo consumido sobre el rango autorizado. Es la cifra que dice si la
   * numeración se va a agotar, y vivía enterrada en la pestaña de resoluciones.
   */
  readonly resolutionStateLabel = computed(() => {
    const resolution = this.store.status()?.resolution ?? null;
    if (!resolution) return 'Sin asignar';
    return `${resolution.prefix} · ${resolution.current_number}/${resolution.range_to}`;
  });

  readonly issuanceStateLabel = computed(() => {
    const settings = this.store.settings();
    if (!settings?.is_enabled) return 'Inactiva';
    return settings.auto_issue ? 'Automática' : 'Manual';
  });

  // Cada paso marca su propio cierre: así el número de la sección deja de ser
  // decoración y dice si ya está resuelto.
  readonly stepCredentialsDone = computed(() => this.store.configured());
  readonly stepCertificateDone = computed(
    () => this.store.dianConfig()?.has_certificate === true,
  );
  readonly stepTestSetDone = computed(
    () => this.store.dianConfig()?.enablement_status === 'enabled',
  );
  readonly stepIssuanceDone = computed(
    () => this.store.settings()?.is_enabled === true,
  );

  /**
   * Qué impide guardar, en palabras. El error de grupo
   * `confirm_production_required` no cuelga de ningún control, así que sin esto
   * el botón queda deshabilitado sin explicar por qué.
   */
  readonly blockingProblems = computed<string[]>(() => {
    // Se lee `formInvalid()` para que el computed reaccione: las validaciones de
    // un FormGroup no son señales y no disparan recomputación por sí solas.
    this.formInvalid();
    const problems: string[] = [];

    for (const [name, label] of Object.entries(REQUIRED_LABELS)) {
      const control = this.form.get(name);
      if (control?.hasError('required')) problems.push(label);
    }
    if (this.form.get('nit')?.hasError('nit_format')) {
      problems.push('NIT: solo dígitos, con DV opcional tras el guion');
    }
    if (this.form.get('software_id')?.hasError('dian_uuid')) {
      problems.push('Software ID debe ser el UUID que emitió la DIAN');
    }
    if (this.form.get('test_set_id')?.hasError('dian_uuid')) {
      problems.push('Test Set ID debe ser el UUID que emitió la DIAN');
    }
    if (this.form.errors?.['confirm_production_required']) {
      problems.push('Confirma la casilla de producción DIAN');
    }
    if (!this.store.configured() && !this.form.get('software_pin')?.value?.trim()) {
      problems.push('PIN de software (obligatorio al crear)');
    }
    return problems;
  });

  constructor() {
    this.store.loadStatus();
    this.store.loadResolutions();

    // El status puede venir ya cacheado del store (al volver a la pestaña) o
    // llegar después. El efecto cubre ambos casos con un solo camino, y el
    // guard por referencia evita repisar lo que el usuario esté editando
    // cuando otra pestaña refresque el store.
    let lastApplied: SubscriptionFiscalStatus | null = null;
    effect(() => {
      const status = this.store.status();
      if (!status || status === lastApplied) return;
      lastApplied = status;
      this.applyStatusToForm(status);
    });

    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshFormSignals());

    this.form.controls.environment.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((environment) => {
        this.selectedEnvironment.set(environment);
        if (environment !== 'production') {
          this.form.controls.confirm_production.setValue(false, {
            emitEvent: false,
          });
        }
        this.form.updateValueAndValidity({ emitEvent: false });
        this.refreshFormSignals();
      });

    this.form.controls.is_enabled.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((enabled) => {
        this.isEnabled.set(enabled);
        this.form.updateValueAndValidity({ emitEvent: false });
        this.refreshFormSignals();
      });

    this.certificatePasswordControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.certificatePasswordFilled.set(!!value?.trim()));

    // El DV es un checksum del NIT, no un dato independiente: se recalcula al
    // teclear. El backend lo vuelve a derivar al guardar; esto solo es para que
    // el usuario vea el dígito correcto antes de enviar.
    this.form.controls.nit.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        // Se corta por el guion: quien escribe `900123456-7` da NIT y DV
        // juntos, y el módulo 11 sobre la cadena completa metería el propio DV
        // como dígito y daría un resultado equivocado.
        const base = (value ?? '').split('-')[0];
        this.form.controls.nit_dv.setValue(computeNitDv(base) ?? null, {
          emitEvent: false,
        });
      });
  }

  onCertificateSelected(file: File): void {
    this.selectedCertificate.set(file);
  }

  onCertificateRemoved(): void {
    this.selectedCertificate.set(null);
  }

  onUploadCertificate(): void {
    const file = this.selectedCertificate();
    const password = this.certificatePasswordControl.value?.trim();
    if (!file || !password) {
      this.toast.warning(
        'Selecciona el P12 y escribe la contraseña',
        'Faltan datos',
      );
      return;
    }

    this.uploadingCertificate.set(true);
    this.fiscal
      .uploadCertificate(file, password)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.uploadingCertificate.set(false);
          this.selectedCertificate.set(null);
          this.certificatePasswordControl.reset(null, { emitEvent: false });
          this.toast.success('Certificado DIAN validado y guardado', 'Listo');
          this.reloadStatus();
        },
        error: (err: { error?: { message?: string } }) => {
          this.uploadingCertificate.set(false);
          this.toast.error(
            err?.error?.message ?? 'No se pudo subir el certificado',
            'Error',
          );
        },
      });
  }

  // ── Set de pruebas DIAN ─────────────────────────────────────────────────
  // Vendix debe aprobar el mismo set de habilitación que cualquier obligado
  // antes de que la DIAN lo habilite en producción.

  /**
   * Encola el set y sondea el job hasta que termina.
   *
   * El POST devuelve 202 con un `job_id`: construir, firmar y subir los 50
   * documentos toma ~74 s, y el request sincrónico anterior moría en el
   * `proxy_read_timeout` de 60 s de nginx con un 504 mientras el backend lo
   * completaba bien. Ese 504 caía en el `error` de abajo, así que `reloadStatus()`
   * no corría y la pantalla se quedaba con el estado de ANTES del envío.
   */
  onRunTestSet(): void {
    if (!this.store.configured() || this.testSetBusy()) return;
    // PR 7 — guard UI anti-doble-click. PR 4+5 ya rechazan server-side con 409,
    // pero esto evita un viaje de red y un toast de error cuando el usuario
    // hace doble-click antes de que la primera llamada termine.
    // El signal está tipado como `unknown` (el servicio devuelve `unknown`);
    // afirmamos la forma mínima `{ pending?: boolean }` para evitar que el
    // compilador rechace el acceso a `.pending`.
    if ((this.testSetResult() as { pending?: boolean } | null)?.pending) {
      this.toast.warning(
        'Ya hay un set de pruebas en validación. Consulta su estado en lugar de reenviar.',
      );
      return;
    }
    this.testSetBusy.set(true);
    this.fiscal
      .runTestSet()
      .pipe(
        switchMap(({ job_id }) =>
          pollAsyncJob(() => this.fiscal.getTestSetJobStatus(job_id), {
            onStall: () =>
              this.toast.warning(
                'El servicio de fondo no responde; consulta el estado más tarde.',
              ),
          }),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (job) => {
          this.testSetBusy.set(false);
          this.testSetResult.set(job.result ?? job);
          if (job.status === 'failed') {
            this.toast.error(
              job.error ?? 'El envío del set de pruebas falló',
              'Falló el envío',
            );
          } else {
            this.toast.success('Set de pruebas enviado a la DIAN', 'Enviado');
          }
          // Se recarga en los DOS casos: un job fallido pudo haber alcanzado a
          // enviar el lote antes de romperse, y el estado real vive en el backend.
          this.reloadStatus();
        },
        error: (err: any) => {
          this.testSetBusy.set(false);
          // PR 6 — distinguir timeout del resto.
          if (err?.name === 'TimeoutError') {
            this.toast.error(
              'El envío excedió el tiempo de espera. Consulta el estado antes de reenviar.',
            );
            this.reloadStatus();
            return;
          }
          // PR 6 — mismo manejo del 409 que el wizard de tienda.
          if (err?.status === 409) {
            this.toast.warning(
              err?.error?.message ??
                'Ya hay un set de pruebas en validación en la DIAN.',
            );
            this.reloadStatus();
            return;
          }
          // NUNCA afirmar «no se pudo enviar»: si el envío ya arrancó, el lote
          // salió y quemó su bloque de consecutivos autorizados, que no se
          // recuperan. Un mensaje que asegura que no pasó nada invita a reenviar
          // y quemar otro bloque.
          this.toast.error(
            err?.error?.message ??
              'No se pudo confirmar el envío. El lote puede haber salido: consulta el estado antes de reenviar.',
            'Sin confirmar',
          );
          this.reloadStatus();
        },
      });
  }

  onCheckTestSet(): void {
    if (!this.store.configured() || this.testSetBusy()) return;
    this.testSetBusy.set(true);
    this.fiscal
      .checkTestSetStatus()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.testSetBusy.set(false);
          this.testSetResult.set(result);
          this.toast.success('Estado consultado a la DIAN', 'Consultado');
          this.reloadStatus();
        },
        error: (err: { error?: { message?: string } }) => {
          this.testSetBusy.set(false);
          this.toast.error(
            err?.error?.message ?? 'No se pudo consultar el estado',
            'Error',
          );
        },
      });
  }

  onDiagnoseTestSet(): void {
    if (!this.store.configured() || this.testSetBusy()) return;
    this.testSetBusy.set(true);
    this.fiscal
      .getTestSetDocuments()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.testSetBusy.set(false);
          this.testSetResult.set(result);
          this.toast.success('Diagnóstico por documento listo', 'Diagnóstico');
        },
        error: (err: { error?: { message?: string } }) => {
          this.testSetBusy.set(false);
          this.toast.error(
            err?.error?.message ?? 'No se pudo diagnosticar el lote',
            'Error',
          );
        },
      });
  }

  onAbandonTestSet(): void {
    if (!this.store.configured() || this.testSetBusy()) return;
    this.testSetBusy.set(true);
    this.fiscal
      .abandonTestSet()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.testSetBusy.set(false);
          this.testSetResult.set(result);
          this.toast.success(
            'Lote descartado. Puedes enviar un set nuevo.',
            'Descartado',
          );
          this.reloadStatus();
        },
        error: (err: { error?: { message?: string } }) => {
          this.testSetBusy.set(false);
          this.toast.error(
            err?.error?.message ?? 'No se pudo descartar el lote',
            'Error',
          );
          // Recargar también al fallar: el descarte pudo haberse aplicado y solo
          // haberse perdido la respuesta. Dejar la UI con el estado viejo es lo
          // que hacía parecer que el botón no hacía nada.
          this.reloadStatus();
        },
      });
  }

  /**
   * El panel de numeración escribió en `invoice_resolutions`: se relee todo lo que
   * cuelga de ellas.
   *
   * Son TRES lecturas y no una porque la resolución alimenta tres cosas distintas:
   * el listado que ofrecen los selectores (`resolutions`), el estado agregado que
   * pinta la tarjeta «Resolución activa» y los requisitos de habilitación
   * (`status`), y el reporte de producción, cuyo chequeo `production_resolution`
   * acaba de cambiar de veredicto.
   *
   * El readiness se refresca SÓLO si ya se había leído: pedirlo sin que el
   * operador lo haya solicitado abriría la sección 6 sola y, sin configuración,
   * respondería 400 con un toast de error sobre algo que sí funcionó.
   */
  onNumberingRangesChanged(): void {
    this.store.loadResolutions(true);
    this.reloadStatus();
    if (this.readiness()) this.onCheckReadiness();
  }

  onTestConnection(): void {
    if (!this.store.configured() || this.testing()) return;
    this.testing.set(true);
    this.fiscal
      .testConnection()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.testing.set(false);
          if (result.ok) {
            this.toast.success(
              result.message ?? 'Conexión DIAN OK',
              'Test exitoso',
            );
          } else {
            this.toast.error(
              result.message ?? 'DIAN no respondió correctamente',
              'Test fallido',
            );
          }
          this.reloadStatus();
        },
        error: (err: { error?: { message?: string } }) => {
          this.testing.set(false);
          this.toast.error(
            err?.error?.message ?? 'No se pudo probar la conexión DIAN',
            'Test fallido',
          );
        },
      });
  }

  onSave(): void {
    if (this.saving()) return;
    const problems = this.blockingProblems();
    if (this.form.invalid || problems.length > 0) {
      this.form.markAllAsTouched();
      this.refreshFormSignals();
      this.toast.warning(
        `Faltan datos: ${this.blockingProblems().join(', ')}.`,
        'No se puede guardar',
      );
      return;
    }

    this.saving.set(true);
    this.fiscal
      .saveConfig(this.buildConfigDto())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (status) => {
          this.store.setStatus(status);
          this.applyStatusToForm(status);
          this.saving.set(false);
          this.toast.success('Configuración fiscal guardada', 'Facturación');
        },
        error: (err: { error?: { message?: string } }) => {
          this.saving.set(false);
          this.toast.error(
            err?.error?.message ?? 'No se pudo guardar la configuración',
            'Error',
          );
        },
      });
  }

  /**
   * Lee qué falta para producción. Solo lectura y repetible.
   *
   * NO se llama al montar: responde 400 mientras la plataforma no tenga
   * configuración, y un error al abrir la pestaña se lee como si algo estuviera
   * roto. Se pide cuando el operador pregunta.
   */
  onCheckReadiness(): void {
    if (this.loadingReadiness()) return;
    this.loadingReadiness.set(true);
    this.fiscal
      .getProductionReadiness()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (report) => {
          this.readiness.set(report);
          this.loadingReadiness.set(false);
        },
        error: (err: { error?: { message?: string } }) => {
          this.loadingReadiness.set(false);
          this.readiness.set(null);
          this.toast.error(
            err?.error?.message ??
              'No se pudo leer el estado de preparación para producción',
            'Error',
          );
        },
      });
  }

  /**
   * Pasa la plataforma a producción.
   *
   * La guarda es del backend: responde 412 con la lista completa de faltantes. Esta
   * UI no la duplica —repetir la condición acá crearía dos reglas que se
   * desincronizan— y se limita a mostrar lo que el servidor contestó.
   *
   * Tras promover RELEE el estado en vez de deducirlo del payload enviado: la
   * respuesta trae `promoted` y `status`, pero el resto de la pestaña —resoluciones
   * por ambiente, insignias, readiness— cuelga del status del store, y actualizar
   * señales locales dejaría media pantalla describiendo el estado anterior.
   */
  onPromoteToProduction(): void {
    if (this.promoting()) return;
    this.promoting.set(true);
    this.fiscal
      .promoteToProduction()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.promoting.set(false);
          this.toast.success(
            'La plataforma quedó en producción ante la DIAN.',
            'Listo',
          );
          this.reloadStatus();
          // El readiness anterior describe un estado que ya no existe: se vuelve a
          // pedir en vez de dejar en pantalla una lista de faltantes obsoleta.
          this.onCheckReadiness();
        },
        error: (err: {
          error?: { message?: string; details?: { missing?: unknown } };
        }) => {
          this.promoting.set(false);
          // El 412 trae `details.missing`. Se guarda para pintar la misma lista que
          // muestra el reporte, en vez de un toast que solo dice «faltan
          // requisitos» sin decir cuáles.
          const missing = err?.error?.details?.missing;
          if (Array.isArray(missing)) {
            this.readiness.update((current) =>
              current
                ? { ...current, ready: false, missing: missing as string[] }
                : current,
            );
          }
          this.toast.error(
            err?.error?.message ?? 'No se pudo pasar a producción',
            'Error',
          );
        },
      });
  }

  /** El `effect` del constructor vuelca el nuevo status en el formulario. */
  private reloadStatus(): void {
    this.store.loadStatus(true);
  }

  private applyStatusToForm(status: SubscriptionFiscalStatus): void {
    const settings = status.settings;
    const config = status.dian_config;
    // La sugerencia solo rellena huecos: si ya hay config guardada, manda ella.
    // Prellenar por encima de lo guardado convertiría una recarga de página en
    // una edición silenciosa de la configuración fiscal.
    const suggested = status.suggested ?? null;

    const name = config?.name ?? suggested?.name ?? null;
    const nit = config?.nit ?? suggested?.nit ?? null;
    // Siempre derivado del NIT que se está mostrando, nunca el almacenado: hay
    // configuraciones antiguas con un DV tecleado a mano que no cuadra, y
    // mostrarlo tal cual lo haría pasar por verificado.
    const nitDv = computeNitDv((nit ?? '').split('-')[0]) ?? null;

    this.identityPrefillApplied.set(!!suggested && !config && (!!name || !!nit));

    this.form.patchValue(
      {
        invoice_resolution_id: toIdValue(settings.invoice_resolution_id),
        name,
        nit,
        nit_dv: nitDv,
        software_id: config?.software_id ?? null,
        software_pin: null,
        test_set_id: config?.test_set_id ?? null,
        environment: settings.environment,
        is_enabled: settings.is_enabled,
        auto_issue: settings.auto_issue,
        confirm_production: false,
      },
      { emitEvent: false },
    );
    this.refreshFormSignals();
  }

  private refreshFormSignals(): void {
    const value = this.form.getRawValue();
    this.selectedEnvironment.set(value.environment);
    this.isEnabled.set(value.is_enabled);
    this.formInvalid.set(this.form.invalid);
  }

  private buildConfigDto(): UpsertSubscriptionFiscalConfigDto {
    const value = this.form.getRawValue();
    // Sin ids de identidad: el backend deriva organización y entidad fiscal.
    const dto: UpsertSubscriptionFiscalConfigDto = {
      name: value.name?.trim() ?? '',
      nit: value.nit?.trim() ?? '',
      software_id: value.software_id?.trim() ?? '',
      environment: value.environment,
      is_enabled: value.is_enabled,
      auto_issue: value.auto_issue,
    };

    const resolutionId = parseOptionalId(value.invoice_resolution_id);
    if (resolutionId) dto.invoice_resolution_id = resolutionId;
    if (value.nit_dv?.trim()) dto.nit_dv = value.nit_dv.trim();
    if (value.software_pin?.trim()) dto.software_pin = value.software_pin.trim();
    if (value.test_set_id?.trim()) dto.test_set_id = value.test_set_id.trim();
    if (value.environment === 'production') {
      dto.confirm_production = value.confirm_production;
    }
    return dto;
  }
}

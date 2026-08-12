import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { startWith } from 'rxjs/operators';

import { extractApiErrorMessage } from '../../../../../../../core/utils/api-error-handler';
import {
  AlertBannerComponent,
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  ToastService,
  type SelectorOption,
} from '../../../../../../../shared/components';
import {
  DIAN_CONFIGURATION_TYPE_LABELS,
  DianDocumentTypeCardComponent,
  summarizeReadiness,
  type DianConfigurationType,
  type FiscalReadinessAxis,
} from '../../../../../../../shared/components/dian';
import { DianConfigApiService } from '../../../../../../../shared/services/dian';
import { TENANT_CAPABILITY } from '../../../services/superadmin-dian-context.factory';
import { TenantContextStore } from '../../../state/tenant-context.store';
import { TenantDianConsoleStore } from './tenant-dian-console.store';

/** Modos de operación que el DTO de alta acepta. Cualquier otro produce un 400. */
const OPERATION_MODE_OPTIONS: SelectorOption[] = [
  {
    value: 'own_software',
    label: 'Software propio',
    description: 'Vendix firma y transmite con el SoftwareID del contribuyente.',
  },
  {
    value: 'technological_provider',
    label: 'Proveedor tecnológico',
    description: 'La habilitación se ejerce a través de un proveedor autorizado.',
  },
];

/**
 * Habilitaciones DIAN del tenant: las CUATRO, siempre.
 *
 * ## Qué contesta esta vista
 *
 * «¿En qué punto de la habilitación está cada documento electrónico de este
 * cliente?» — que es la primera pregunta de cualquier llamada a soporte. Los
 * cuatro ejes se pintan aunque no tengan configuración: un eje ausente se lee
 * como «no aplica», y esa lectura es la razón por la que el documento soporte y
 * el documento equivalente llevan años invisibles.
 *
 * ## El paso a producción vive aquí
 *
 * Es el último eslabón del mismo checklist que la tarjeta resume, así que
 * separarlo en otra pantalla obligaría a leer el estado en un sitio y actuar en
 * otro. Conserva su confirmación reforzada: hay que teclear el NIT del
 * contribuyente. Promover pone a facturar en producción el NIT de un TERCERO, y
 * los documentos que salgan desde ese momento son fiscales ante la DIAN — sólo
 * se anulan con nota crédito.
 */
@Component({
  selector: 'app-tenant-dian-enablements',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    AlertBannerComponent,
    BadgeComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    InputComponent,
    ModalComponent,
    SelectorComponent,
    DianDocumentTypeCardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-3">
      @if (!anyWriteCapability()) {
        <app-alert-banner variant="info" icon="info">
          El perfil de este tenant no declara ninguna capacidad de escritura
          DIAN, así que la consola opera en solo lectura. La autorización real la
          resuelve el backend; esta pantalla sólo deja de ofrecer lo que no se
          declaró.
        </app-alert-banner>
      }

      <!-- Emisión: la respuesta a «¿por qué este cliente no está facturando?» -->
      <app-card [responsive]="true">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 class="text-base font-semibold text-text-primary">
              Emisión electrónica
            </h2>
            <p class="mt-0.5 max-w-2xl text-xs text-text-secondary">
              {{ emissionReason() }}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <app-badge [variant]="emissionVariant()" size="sm">
              Emisión: {{ emissionLabel() }}
            </app-badge>
            <app-button
              variant="outline"
              size="sm"
              [loading]="store.loading()"
              (clicked)="store.reload()"
            >
              <app-icon name="refresh-cw" [size]="16" slot="icon"></app-icon>
              Actualizar
            </app-button>
          </div>
        </div>
      </app-card>

      @if (store.error(); as message) {
        <app-alert-banner variant="danger" icon="alert-triangle">
          {{ message }}
        </app-alert-banner>
      }

      <!-- Los cuatro ejes -->
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        @for (axis of store.axes(); track axis.configuration_type) {
          <app-dian-document-type-card
            [axis]="axis"
            [busy]="store.loading()"
            [writeBlockedReason]="writeBlockedReason()"
            (configure)="onConfigure($event)"
            (viewDetail)="onViewDetail($event)"
          ></app-dian-document-type-card>
        }
      </div>

      <!-- Paso a producción del eje elegido -->
      @if (store.selectedAxis(); as axis) {
        @if (axis.config_id !== null) {
          <app-card [responsive]="true">
            <div class="space-y-2.5">
              <div class="flex flex-wrap items-start justify-between gap-2">
                <div class="min-w-0">
                  <h2 class="text-base font-semibold text-text-primary">
                    Promover a producción — {{ axis.label }}
                  </h2>
                  <p class="mt-0.5 max-w-2xl text-xs text-text-secondary">
                    A partir de la promoción, cada documento de este eje se emite
                    ante la DIAN con el NIT de
                    {{ tenant.tenantName() }} y deja de imprimirse como documento
                    no fiscal.
                  </p>
                </div>
                <app-badge
                  [variant]="axis.environment === 'production' ? 'success' : 'neutral'"
                  size="xs"
                >
                  Ambiente:
                  {{ axis.environment === 'production' ? 'Producción' : 'Pruebas' }}
                </app-badge>
              </div>

              @if (canPromote()) {
                <div class="flex flex-wrap items-center justify-end gap-2">
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
                <p class="text-[11px] text-text-secondary">
                  Requiere la capacidad <code>{{ capability.dianPromote }}</code
                  >.
                </p>
              }
            </div>
          </app-card>
        }
      }
    </div>

    <!-- Alta de configuración por eje ------------------------------------- -->
    <app-modal
      [(isOpen)]="createOpen"
      [title]="createTitle()"
      subtitle="Alta de configuración DIAN del tenant"
      size="lg"
      [closeOnBackdrop]="false"
      (cancel)="resetCreateForm()"
    >
      <form [formGroup]="createForm" class="space-y-3">
        <app-alert-banner variant="warning" icon="alert-triangle">
          Los datos son los que la DIAN entregó al contribuyente en su portal de
          habilitación. Un SoftwareID o un PIN de otro NIT hacen que la DIAN
          descarte el lote sin veredicto legible.
        </app-alert-banner>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <app-input
            label="Nombre de la configuración"
            placeholder="Ej: Facturación electrónica"
            [required]="true"
            formControlName="name"
          ></app-input>

          <app-selector
            label="Modo de operación"
            [options]="operationModes"
            formControlName="operation_mode"
          ></app-selector>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <app-input
            label="NIT"
            placeholder="Sin dígito de verificación"
            [required]="true"
            helperText="Sólo dígitos. El backend rechaza cualquier otro carácter."
            formControlName="nit"
          ></app-input>

          <app-input
            label="DV"
            placeholder="0-9"
            formControlName="nit_dv"
          ></app-input>

          <app-input
            label="Test Set ID"
            placeholder="UUID del portal DIAN"
            helperText="Opcional en el alta; obligatorio para enviar el set."
            formControlName="test_set_id"
          ></app-input>
        </div>

        <app-input
          label="Software ID"
          placeholder="UUID emitido por el portal de la DIAN"
          [required]="true"
          helperText="Es un UUID. Un valor corto tipo «9547» llega tal cual a la DIAN y el lote se descarta."
          formControlName="software_id"
        ></app-input>

        <app-input
          label="Software PIN"
          type="password"
          [required]="true"
          helperText="Alimenta el CUDE de notas, documento soporte y documento equivalente."
          formControlName="software_pin"
        ></app-input>

        @if (createError(); as message) {
          <p class="text-xs text-red-600">{{ message }}</p>
        }
      </form>

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="outline" size="sm" (clicked)="closeCreate()">
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          size="sm"
          [disabled]="!canCreate()"
          [loading]="creating()"
          (clicked)="submitCreate()"
        >
          <app-icon name="save" [size]="16" slot="icon"></app-icon>
          Crear configuración
        </app-button>
      </div>
    </app-modal>

    <!-- Promoción: exige teclear el NIT ----------------------------------- -->
    <app-modal
      [(isOpen)]="promoteGateOpen"
      title="Promover a producción"
      subtitle="Confirmación reforzada"
      size="md"
      [closeOnBackdrop]="false"
      (cancel)="promoteNit.setValue('')"
    >
      <div class="space-y-3">
        <app-alert-banner variant="danger" icon="alert-triangle">
          Estás a punto de poner a facturar en producción el NIT de
          {{ tenant.tenantName() }}. Los documentos que se emitan desde ese
          momento son fiscales ante la DIAN y no se pueden retirar: sólo se
          anulan con nota crédito.
        </app-alert-banner>

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
        <app-button variant="outline" size="sm" (clicked)="closePromoteGate()">
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
export class TenantDianEnablementsComponent {
  protected readonly store = inject(TenantDianConsoleStore);
  protected readonly tenant = inject(TenantContextStore);
  private readonly api = inject(DianConfigApiService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly capability = TENANT_CAPABILITY;
  protected readonly operationModes = OPERATION_MODE_OPTIONS;

  protected readonly canWriteConfig = computed(() =>
    this.tenant.can(TENANT_CAPABILITY.dianWrite),
  );
  protected readonly canPromote = computed(() =>
    this.tenant.can(TENANT_CAPABILITY.dianPromote),
  );
  protected readonly anyWriteCapability = computed(
    () =>
      this.canWriteConfig() ||
      this.canPromote() ||
      this.tenant.can(TENANT_CAPABILITY.dianCertificateWrite) ||
      this.tenant.can(TENANT_CAPABILITY.resolutionsWrite),
  );

  /**
   * Por qué la tarjeta no ofrece configurar. Un botón ausente sin explicación se
   * lee como un fallo de la aplicación, no como una restricción deliberada.
   */
  protected readonly writeBlockedReason = computed<string | null>(() => {
    if (this.canWriteConfig()) return null;
    return `Requiere la capacidad ${TENANT_CAPABILITY.dianWrite} sobre este tenant.`;
  });

  // ── Emisión ─────────────────────────────────────────────────────────
  protected readonly emissionLabel = computed(() =>
    this.store.emission()?.is_live ? 'Emitiendo' : 'No emite',
  );

  protected readonly emissionVariant = computed<'success' | 'neutral'>(() =>
    this.store.emission()?.is_live ? 'success' : 'neutral',
  );

  protected readonly emissionReason = computed(() => {
    const emission = this.store.emission();
    if (!emission) return 'Estado de emisión no disponible.';
    return (
      emission.reason ??
      (emission.is_live
        ? 'Este tenant emite facturas electrónicas ante la DIAN ahora mismo.'
        : 'Estado de emisión no disponible.')
    );
  });

  // ── Alta de configuración ───────────────────────────────────────────
  protected readonly createOpen = signal(false);
  protected readonly creating = signal(false);
  protected readonly createError = signal<string | null>(null);
  private readonly createTarget = signal<DianConfigurationType>('invoicing');

  protected readonly createTitle = computed(
    () =>
      `Configurar ${DIAN_CONFIGURATION_TYPE_LABELS[this.createTarget()]}`,
  );

  protected readonly createForm = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(100)],
    }),
    nit: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^\d+$/)],
    }),
    nit_dv: new FormControl('', { nonNullable: true }),
    software_id: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    software_pin: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    test_set_id: new FormControl('', { nonNullable: true }),
    operation_mode: new FormControl<string>('own_software', {
      nonNullable: true,
    }),
  });

  /**
   * `form.status` es una PROPIEDAD, no una señal: leerla dentro de un `computed`
   * lo evalúa una vez con el estado inicial —inválido por los `required`— y no
   * vuelve a recalcular. El botón «Crear» se quedaría deshabilitado para siempre
   * por mucho que el operador rellenara el formulario.
   */
  private readonly createStatus = toSignal(
    this.createForm.statusChanges.pipe(startWith(this.createForm.status)),
    { initialValue: this.createForm.status },
  );

  protected readonly canCreate = computed(
    () =>
      this.canWriteConfig() &&
      this.createStatus() === 'VALID' &&
      !this.creating(),
  );

  // ── Promoción ───────────────────────────────────────────────────────
  protected readonly promoteGateOpen = signal(false);
  protected readonly promoting = signal(false);
  protected readonly promoteNit = new FormControl<string>('', {
    nonNullable: true,
  });

  protected readonly promoteNitTyped = toSignal(
    this.promoteNit.valueChanges.pipe(startWith(this.promoteNit.value)),
    { initialValue: this.promoteNit.value },
  );

  protected readonly expectedNit = computed(
    () => this.store.selectedConfig()?.nit ?? '',
  );

  protected readonly promoteNitMatches = computed(() => {
    const expected = this.expectedNit().trim();
    if (!expected) return false;
    return this.promoteNitTyped().trim() === expected;
  });

  /**
   * Primer bloqueante que impide la promoción.
   *
   * Un checklist sin evaluar NO bloquea: si la lectura falló, el gate de tecleo
   * del NIT sigue siendo la protección real y un fallo de red no puede frenar
   * una operación de soporte legítima. El backend vuelve a validar al recibirla.
   */
  protected readonly promoteBlockReason = computed<string | null>(() => {
    const axis = this.store.selectedAxis();
    if (!axis || axis.config_id === null) return null;
    if (axis.environment === 'production') {
      return 'Esta configuración ya está en producción.';
    }

    const summary = summarizeReadiness(axis.readiness);
    if (summary.notEvaluated || summary.ready) return null;

    const pending = summary.todo[0] ?? summary.waiting[0] ?? null;
    if (!pending) {
      return 'La checklist de producción del backend todavía no está satisfecha.';
    }
    return `Falta: ${pending.label}${pending.action ? ` — ${pending.action}` : ''}.`;
  });

  protected readonly canOpenPromoteGate = computed(() => {
    const axis = this.store.selectedAxis();
    if (!axis || axis.config_id === null || this.promoting()) return false;
    if (axis.environment === 'production') return false;
    const summary = summarizeReadiness(axis.readiness);
    // `notEvaluated` no bloquea: el gate del NIT y el backend siguen ahí.
    return summary.notEvaluated || summary.ready;
  });

  // ── Acciones de la tarjeta ──────────────────────────────────────────
  /**
   * «Configurar» / «Ajustar» de la tarjeta.
   *
   * Sin configuración abre el alta; con configuración lleva al certificado, que
   * es donde de verdad se destraba una habilitación en curso.
   */
  protected onConfigure(axis: FiscalReadinessAxis): void {
    this.store.selectAxis(axis.configuration_type);
    if (axis.config_id === null) {
      this.openCreate(axis.configuration_type);
      return;
    }
    // Con configuración, «Ajustar» lleva al certificado: es lo que de verdad
    // destraba una habilitación en curso.
    this.goToSibling('certificado');
  }

  protected onViewDetail(axis: FiscalReadinessAxis): void {
    this.store.selectAxis(axis.configuration_type);
    this.goToSibling('pruebas');
  }

  /**
   * Navega a otra hoja de la MISMA sección DIAN.
   *
   * Va relativo al padre (`route.parent`) y no al `ActivatedRoute` propio: esta
   * página es una hoja del outlet de la sección, así que una navegación relativa
   * a sí misma la anidaría bajo su propia URL.
   */
  private goToSibling(path: string): void {
    void this.router.navigate(['../', path], {
      relativeTo: this.route,
    });
  }

  protected openCreate(type: DianConfigurationType): void {
    this.createTarget.set(type);
    this.createError.set(null);
    const identity = this.tenant.profile()?.fiscal_identity ?? null;
    this.createForm.reset({
      name: DIAN_CONFIGURATION_TYPE_LABELS[type],
      // El NIT se precarga desde la identidad fiscal del tenant: es el dato que
      // el backend confronta contra el certificado, y teclearlo a mano sobre el
      // contribuyente de otro es donde nace la configuración anclada al NIT
      // equivocado.
      nit: identity?.nit ?? '',
      nit_dv: identity?.nit_dv ?? '',
      software_id: '',
      software_pin: '',
      test_set_id: '',
      operation_mode: 'own_software',
    });
    this.createOpen.set(true);
  }

  protected closeCreate(): void {
    this.createOpen.set(false);
    this.resetCreateForm();
  }

  protected resetCreateForm(): void {
    this.createError.set(null);
    this.creating.set(false);
  }

  protected submitCreate(): void {
    if (!this.canCreate()) {
      this.createForm.markAllAsTouched();
      return;
    }

    const raw = this.createForm.getRawValue();
    const payload: Record<string, unknown> = {
      name: raw.name.trim(),
      nit: raw.nit.trim(),
      configuration_type: this.createTarget(),
      operation_mode: raw.operation_mode,
      software_id: raw.software_id.trim(),
      software_pin: raw.software_pin,
      environment: 'test',
    };
    // Los opcionales sólo viajan con valor: una cadena vacía en `test_set_id`
    // falla el `@IsUUID` y produce un 400 sobre un campo que nadie rellenó.
    if (raw.nit_dv.trim()) payload['nit_dv'] = raw.nit_dv.trim();
    if (raw.test_set_id.trim()) payload['test_set_id'] = raw.test_set_id.trim();

    this.creating.set(true);
    this.createError.set(null);

    this.api
      .createDianConfig(payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.creating.set(false);
          this.createOpen.set(false);
          this.toast.success('Configuración DIAN creada');
          this.store.reload();
        },
        error: (err: unknown) => {
          this.creating.set(false);
          // El mensaje del backend se pinta CRUDO: distingue el UUID mal
          // formado del NIT que no es del tenant, y un «no se pudo crear»
          // genérico deja al operador probando combinaciones.
          this.createError.set(
            extractApiErrorMessage(err) ||
              'No se pudo crear la configuración DIAN.',
          );
        },
      });
  }

  // ── Promoción ───────────────────────────────────────────────────────
  protected openPromoteGate(): void {
    this.promoteNit.setValue('');
    this.promoteGateOpen.set(true);
  }

  protected closePromoteGate(): void {
    this.promoteGateOpen.set(false);
    this.promoteNit.setValue('');
  }

  protected promoteToProduction(): void {
    const configId = this.store.selectedAxis()?.config_id ?? null;
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
          this.store.reload();
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
}

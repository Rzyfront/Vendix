import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import {
  ModalComponent,
  IconComponent,
  StepsLineComponent,
} from '../../../../../../../shared/components';
import type {
  SelectorOption,
  StepsLineItem,
} from '../../../../../../../shared/components';
import { CurrencyPipe, CurrencyFormatService } from '../../../../../../../shared/pipes/currency';
import { focusFirstInvalid } from '../../../../../../../core/utils/focus-first-invalid';
import { PopCartState } from '../../interfaces/pop-cart.interface';
import {
  PopCostPreviewResponse,
  PopShippingAllocation,
} from '../../interfaces';
import {
  PopPaymentStepComponent,
  PopPaymentPlan,
} from './steps/pop-payment-step.component';
import {
  PopReceiveStepComponent,
  PopPricingOverridesMap,
} from './steps/pop-receive-step.component';
import { PopConfirmStepComponent } from './steps/pop-confirm-step.component';
import { PopConfigStepComponent } from './steps/pop-config-step.component';

export type PopCheckoutAction = 'create' | 'create-receive';

/**
 * PASO 4 QUI-647 — `app-pop-checkout-shell`.
 *
 * Shell con stepper que reemplaza el modal de confirmación de la creación de
 * órdenes de compra (POP). Pasos:
 *  - `create`         → [Pago, Confirmación]
 *  - `create-receive` → [Pago, Recepción, Confirmación]
 *  - sin configurar  → antepone [Configuración, ...] (QUI-647): proveedor,
 *    bodega, fechas y envío como PASO 1; al avanzar al paso Pago la config ya
 *    quedó escrita en el carrito (el padre la persiste en vivo) y el módulo
 *    queda "Configurado". Cuando ya hay config, el wizard arranca en Pago.
 * El paso Pago es SIEMPRE el primero salvo `needsConfig` (reactive forms:
 * focusFirstInvalid depende de `.ng-invalid`). El paso Recepción reúne el
 * acuse (genera la remisión de entrada) y la valoración de inventario con
 * márgenes (QUI-425). El paso Confirmación es el resumen final: qué se compra,
 * cuánto se paga hoy, cuánto queda debiendo y en qué fechas.
 *
 * Patrón replicado de `pos-checkout-shell`: `steps`/`stepKeys` computed +
 * `currentStep` signal, `attemptNextStep()` que valida el paso actual (errores
 * inline + focus al primer inválido + flash en el botón) y `contentEpoch` para
 * remontar el contenido al abrir. El plan de pago pertenece a la instancia del
 * carrito: se resetea en cada apertura (el bug de prod era un plan filtrado que
 * se colaba entre aperturas).
 *
 * NO emite ni ejecuta la creación: solo emite `confirmed` y el padre
 * (pop.component) orquesta los efectos con la matriz anti-doble-registro en
 * `attachPaymentPlan`.
 */
@Component({
  selector: 'app-pop-checkout-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ModalComponent,
    IconComponent,
    StepsLineComponent,
    CurrencyPipe,
    PopConfigStepComponent,
    PopPaymentStepComponent,
    PopReceiveStepComponent,
    PopConfirmStepComponent,
  ],
  templateUrl: './pop-checkout-shell.component.html',
  styleUrl: './pop-checkout-shell.component.scss',
})
export class PopCheckoutShellComponent {
  // ── Inputs ────────────────────────────────────────────────────────────────
  readonly isOpen = input<boolean>(false);
  readonly cartState = input<PopCartState | null>(null);
  readonly supplierName = input('');
  readonly locationName = input('');
  readonly actionType = input<PopCheckoutAction>('create');
  readonly costPreview = input<PopCostPreviewResponse | null>(null);
  readonly loadingCostPreview = input(false);
  /**
   * A.5 — mensaje del fallo de la vista previa. Mientras esté presente el paso
   * de recepción pinta un panel de error y la confirmación queda bloqueada: sin
   * vista previa el operador estaría aprobando un costo que no vio.
   */
  readonly costPreviewError = input<string | null>(null);
  readonly isProcessing = input(false);
  /** Ref (`#id` / `order_number`) de la OC pendiente de recepción (reintento). */
  readonly retryOrderRef = input<string | null>(null);

  /**
   * CP-ID-VNDX-2026-08-18-PO-PROD — F2.S6: panel post-creación.
   * `orderResult` aparece cuando el POST OK. El shell pinta un bloque
   * `app-success` con id + total + botones "Ver detalle" / "Nueva compra".
   * `orderError` aparece cuando el POST falló — pinta `app-error` con
   * mensaje y opción de reintentar.
   *
   * 5.3/5.5 — La forma se extiende con `stages[]` (rastro de etapas) y
   * `failedStage` para que el shell distinga éxito pleno de éxito parcial
   * y ofrezca acciones por etapa (reintentar pago, reintentar recepción).
   */
  readonly orderResult = input<{
    id: number;
    total: number;
    orderNumber: string;
    stages?: Array<{
      name: 'create' | 'receive' | 'pay';
      label: string;
      status: 'success' | 'failed' | 'skipped';
      errorMessage?: string;
    }>;
    failedStage?: 'create' | 'receive' | 'pay';
  } | null>(null);
  readonly orderError = input<string | null>(null);

  // ── Paso Configuración (solo cuando el POP no tiene proveedor/bodega) ────
  /** Snapshot al abrir: true ⇒ el wizard arranca en Configuración (paso 1). */
  readonly needsConfig = input(false);
  readonly supplierOptions = input<SelectorOption[]>([]);
  readonly locationOptions = input<SelectorOption[]>([]);
  readonly shippingMethodOptions = input<SelectorOption[]>([]);
  readonly selectedSupplierId = input<number | null>(null);
  readonly selectedLocationId = input<number | null>(null);
  readonly orderDate = input('');
  readonly expectedDate = input('');
  readonly shippingMethod = input('');
  readonly minExpectedDate = input('');
  /** C.5 — flete vigente en el carrito y su imputación. */
  readonly shippingCost = input(0);
  readonly shippingCostAllocation = input<PopShippingAllocation | undefined>(
    undefined,
  );

  // ── Outputs ───────────────────────────────────────────────────────────────
  readonly isOpenChange = output<boolean>();
  readonly closed = output<void>();
  /** El padre ejecuta la creación/recepción/pago con el plan ya sincronizado. */
  readonly confirmed = output<void>();
  /** El wizard cierra SIN éxito: el padre baja `showOrderConfirmModal`. */
  readonly cancelled = output<void>();
  readonly navigateToSettings = output<void>();
  /** A.5 — el panel de error del paso de recepción pide otra vista previa. */
  readonly retryCostPreview = output<void>();
  /**
   * B.5 — el CTA del aviso «no sabemos tu estado fiscal» lleva al asistente
   * fiscal. La ruta la manda el backend dentro de `fiscal_explanation.cta`: la
   * pantalla no la inventa.
   */
  readonly navigateToFiscalWizard = output<string>();

  /**
   * CP-ID-VNDX-2026-08-21-POP-MODAL — El panel post-creación (`app-success`)
   * se extrajo a un modal standalone fuera del shell. Los emits
   * `viewCreatedOrder` / `createAnotherOrder` ya no viven aquí: la X, el
   * overlay y ESC del modal `app-pop-order-confirmation-modal` llegan al
   * padre como `(closed)`, que limpia `orderResult` y redirige a la lista
   * de OC. `retryOrder` se conserva para el botón "Reintentar" del panel
   * de error del wizard (no del modal).
   */
  readonly retryOrder = output<void>();
  readonly pricingOverridesChange = output<PopPricingOverridesMap>();
  readonly ackReceiveChange = output<boolean>();
  readonly paymentPlanChange = output<PopPaymentPlan>();
  /** Pasó de Configuración → Pago con el form válido (el padre recarga el cost preview). */
  readonly configComplete = output<void>();
  /** Cambios del paso Configuración → el padre los persiste en el carrito. */
  readonly configSupplierChange = output<number | null | string>();
  readonly configLocationChange = output<number | null | string>();
  readonly configOrderDateChange = output<string>();
  readonly configExpectedDateChange = output<string>();
  readonly configShippingMethodChange = output<string>();
  readonly configShippingCostChange = output<number>();
  readonly configShippingCostAllocationChange =
    output<PopShippingAllocation>();
  readonly configOpenSupplierModal = output<void>();
  readonly configOpenWarehouseModal = output<void>();

  private readonly currencyService = inject(CurrencyFormatService);
  private readonly host = inject(ElementRef<HTMLElement>);

  // ── Child references (pasos) ─────────────────────────────────────────────
  protected readonly configStep = viewChild(PopConfigStepComponent);
  protected readonly paymentStep = viewChild(PopPaymentStepComponent);
  protected readonly receiveStep = viewChild(PopReceiveStepComponent);

  // ── Stepper state ────────────────────────────────────────────────────────
  readonly currentStep = signal(0);

  /**
   * B.6 — Latch del paso Configuración.
   *
   * `needsConfig` es un snapshot tomado al ABRIR (`!supplierId || !locationId`).
   * En el caso normal —proveedor y bodega ya elegidos, que es SIEMPRE el caso al
   * reabrir tras cancelar— era `false` y el paso no entraba al stepper: el campo
   * de flete y su conmutador no existían en el DOM y el wizard confirmaba la
   * orden sin haber preguntado nunca. Un control que decide dinero no puede
   * depender de un snapshot.
   *
   * El latch se enciende al abrir si la orden YA lleva flete, y en cuanto el
   * operador elige «Flete» dentro del paso. Nunca se apaga a mitad de sesión:
   * un paso que desaparece bajo los pies del operador (al volver el método a
   * «Recolección») renumeraría el stepper mientras está parado en él.
   */
  private readonly configLatch = signal(false);

  /** El carrito trae flete: método «Flete» o un costo ya capturado. */
  private readonly orderCarriesFreight = computed<boolean>(() => {
    const state = this.cartState();
    return (
      state?.shippingMethod === 'freight' || Number(state?.shippingCost ?? 0) > 0
    );
  });

  /** El paso Configuración se monta por falta de config O por llevar flete. */
  readonly showConfigStep = computed<boolean>(
    () => this.needsConfig() || this.configLatch(),
  );

  readonly steps = computed<StepsLineItem[]>(() => {
    const base =
      this.actionType() === 'create-receive'
        ? [{ label: 'Pago' }, { label: 'Recepción' }, { label: 'Confirmación' }]
        : [{ label: 'Pago' }, { label: 'Confirmación' }];
    return this.showConfigStep()
      ? [{ label: 'Configuración' }, ...base]
      : base;
  });

  /** Espeja EXACTAMENTE {@link steps}: ambos comparten `currentStep` como índice. */
  readonly stepKeys = computed<string[]>(() => {
    const base =
      this.actionType() === 'create-receive'
        ? ['pago', 'recepcion', 'confirmacion']
        : ['pago', 'confirmacion'];
    return this.showConfigStep() ? ['configuracion', ...base] : base;
  });

  readonly currentStepKey = computed<string>(
    () => this.stepKeys()[this.currentStep()] ?? '',
  );

  readonly isFirstStep = computed<boolean>(() => this.currentStep() === 0);
  readonly isLastStep = computed<boolean>(
    () => this.currentStep() === this.stepKeys().length - 1,
  );

  readonly title = computed<string>(() => {
    if (this.actionType() === 'create-receive') return 'Crear y Recibir Inventario';
    return this.showConfigStep()
      ? 'Nueva Orden de Compra'
      : 'Confirmar Orden de Compra';
  });

  readonly subtitle = computed<string>(() => {
    switch (this.currentStepKey()) {
      case 'configuracion':
        return 'Configuración · Proveedor, bodega, fechas, envío y flete';
      case 'pago':
        return 'Pago · Cómo se paga esta orden';
      case 'recepcion':
        return 'Recepción · Verificación y valoración';
      default:
        return this.actionType() === 'create-receive'
          ? 'Confirmación · Revisar y crear'
          : 'Confirmación · Revisar la orden';
    }
  });

  /** Flash del botón "Siguiente" cuando un paso no deja avanzar. */
  readonly buttonFlash = signal(false);

  /**
   * Clave de remontaje del contenido. Se incrementa SOLO al abrir
   * (`resetState`): los pasos (formulario de pago, acuse, overrides) se
   * DESTRUYEN y RECREAN pristinos. El contenido proyectado dentro de
   * <app-modal> NO se destruye al cerrar (solo se desprende), así que sin esto
   * el plan de pago y los acuses de la última apertura sobrevivirían a la
   * siguiente (justo el bug de prod que QUI-647 corrige).
   */
  readonly contentEpoch = signal(0);

  constructor() {
    // La moneda debe estar cargada para el | currency del footer/resumen.
    this.currencyService.loadCurrency();
  }

  // ── Open / close ─────────────────────────────────────────────────────────
  onOpened(): void {
    this.resetState();
  }

  onModalClosed(): void {
    this.isOpenChange.emit(false);
    this.cancelled.emit();
    this.closed.emit();
  }

  onBackMobile(): void {
    if (this.isFirstStep()) {
      this.onModalClosed();
    } else {
      this.prevStep();
    }
  }

  /**
   * Reset al abrir: cursor al primer paso + remonta los pasos. Cancelar NO lo
   * incrementa (el cierre preserva estado a mitad de wizard); el reset solo
   * pasa en la apertura porque el plan pertenece a la instancia del carrito.
   */
  private resetState(): void {
    this.currentStep.set(0);
    this.buttonFlash.set(false);
    // B.6 — el latch se re-evalúa por apertura: una orden que llega con flete
    // abre con el paso Configuración presente aunque ya tenga proveedor y
    // bodega.
    this.configLatch.set(this.orderCarriesFreight());
    this.contentEpoch.update((n) => n + 1);
  }

  /**
   * C.5 — el paso avisa que el método de envío cambió. Elegir «Flete» ENCIENDE
   * el latch para que el campo no pueda desaparecer del stepper en la misma
   * sesión, y el valor sigue viaje al padre, que lo escribe en el carrito.
   */
  onConfigShippingMethodChange(value: string): void {
    if (value === 'freight') this.configLatch.set(true);
    this.configShippingMethodChange.emit(value);
  }

  // ── Navegación (no bloqueante) ───────────────────────────────────────────
  goToStep(index: number): void {
    if (index < 0 || index >= this.stepKeys().length) return;
    this.currentStep.set(index);
  }

  nextStep(): void {
    this.goToStep(this.currentStep() + 1);
  }

  prevStep(): void {
    this.goToStep(this.currentStep() - 1);
  }

  /**
   * Footer "Siguiente". Valida el paso actual antes de avanzar: si el paso de
   * pago no es válido, enciende los errores inline (markAllTouched), lleva el
   * foco al primer campo `.ng-invalid` y flashea el botón — no avanza.
   */
  attemptNextStep(): void {
    const key = this.currentStepKey();
    if (key === 'configuracion') {
      const cfg = this.configStep();
      if (!cfg || !cfg.validate()) {
        this.flashButton();
        focusFirstInvalid(this.host);
        return;
      }
      // La config ya quedó escrita en el carrito (cambios en vivo); avisamos al
      // padre para que recargue el cost preview ahora que hay proveedor+bodega.
      this.configComplete.emit();
      this.nextStep();
      return;
    }
    if (key === 'pago') {
      const pay = this.paymentStep();
      if (!pay || !pay.validate()) {
        this.flashButton();
        focusFirstInvalid(this.host);
        return;
      }
      this.nextStep();
      return;
    }
    // Recepción / Confirmación avanzan libre: el acuse es una decisión (no un
    // requisito) y los overrides de margen son opcionales.
    this.nextStep();
  }

  private flashButton(): void {
    this.buttonFlash.set(true);
    setTimeout(() => this.buttonFlash.set(false), 450);
  }

  // ── Confirmación (paso terminal) ─────────────────────────────────────────
  readonly confirmDisabled = computed<boolean>(() => {
    if (this.isProcessing()) return true;
    const pay = this.paymentStep();
    if (pay && !pay.isValid()) return true;
    // A.5 — sin vista previa no se confirma una recepción: el operador estaría
    // aprobando un costo de inventario que la pantalla nunca le mostró.
    if (this.actionType() === 'create-receive' && this.costPreviewError())
      return true;
    return false;
  });

  readonly confirmLabel = computed<string>(() => {
    if (this.retryOrderRef()) return 'Reintentar recepción';
    return this.actionType() === 'create-receive' ? 'Confirmar' : 'Crear Orden';
  });

  /**
   * Emite el plan de pago, el acuse y los overrides vigentes y después
   * `confirmed`. Los outputs son síncronos: el padre setea sus signals antes de
   * que corra su handler de `confirmed`, así la orquestación lee el plan fresco.
   */
  onConfirm(): void {
    if (this.confirmDisabled()) return;
    const pay = this.paymentStep();
    const rec = this.receiveStep();
    if (pay) this.paymentPlanChange.emit(pay.plan());
    if (rec) {
      this.ackReceiveChange.emit(rec.ackReceive());
      this.pricingOverridesChange.emit(rec.pricingOverrides());
    }
    this.confirmed.emit();
  }

  onNavigateToSettings(): void {
    this.navigateToSettings.emit();
  }
}
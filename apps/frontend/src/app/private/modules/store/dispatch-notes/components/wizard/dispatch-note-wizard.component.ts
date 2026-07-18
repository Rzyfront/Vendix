import {
  Component,
  DestroyRef,
  inject,
  input,
  output,
  signal,
  computed,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  StepsLineComponent,
  ToastService,
} from '../../../../../../shared/components';

import { DispatchNoteWizardService } from '../../services/dispatch-note-wizard.service';
import type {
  WizardTerminalAction,
  WizardItem,
  WizardDetails,
} from '../../services/dispatch-note-wizard.service';
import { DispatchNotesService } from '../../services/dispatch-notes.service';
import { DispatchNotePrintService } from '../../services/dispatch-note-print.service';
import type {
  DispatchNote,
  CreateDispatchFromOrderDto,
  CreateDispatchFromOrderItemDto,
  CreateTransferDispatchDto,
  CreateReturnDispatchDto,
  CreatePurchaseReceiptDispatchDto,
  CreateDispatchNoteItemDto,
  ConfirmDispatchNoteDto,
  ConfirmDispatchNoteItemSerialsDto,
} from '../../interfaces/dispatch-note.interface';

import { OrderStepComponent } from './order-step.component';
import { OrderItemsStepComponent } from './order-items-step.component';
import { PartyStepComponent } from './party-step.component';
import { ItemPickerStepComponent } from './item-picker-step.component';
import { RouteStepComponent } from './route-step.component';
import { ReviewStepComponent } from './review-step.component';
import { TypeStepComponent } from './type-step.component';
import {
  DispatchNoteSerialsModalComponent,
  DispatchNoteSerialLine,
} from '../dispatch-note-serials-modal/dispatch-note-serials-modal.component';

/**
 * Dispatch note wizard (ref plan wizard remisión — Ola 3, orquestador).
 *
 * customer_delivery (5): Tipo → Orden → Ítems y bodega → Ruta → Revisión.
 * inbound subtypes  (4): Tipo → Party → Ítems y bodega → Revisión.
 *
 * Regla de negocio derivada (ya NO hay "acción terminal" manual):
 *   - customer_delivery: se crea SIEMPRE `draft` vía `createFromOrder`. Si el
 *     operario asignó ruta (`routeMode() !== 'none'`) se CONFIRMA la remisión
 *     vía `confirm()` (que sí enlaza seriales — `createFromOrder` con
 *     `target_status:'confirmed'` NO los enlaza). Sin ruta → queda `draft`.
 *   - inbound (transfer_out/in, purchase_receipt, customer_return): se crea
 *     `draft` con el `create*` correspondiente; sin encadenar confirm/receive.
 *
 * Cada paso renderiza su propia cabecera (`app-wizard-step-section`), por eso
 * el chrome del modal ya no pinta subtítulo por paso (evita doble cabecera).
 */
@Component({
  selector: 'app-dispatch-note-wizard',
  standalone: true,
  imports: [
    ModalComponent,
    ButtonComponent,
    IconComponent,
    StepsLineComponent,
    TypeStepComponent,
    OrderStepComponent,
    OrderItemsStepComponent,
    PartyStepComponent,
    ItemPickerStepComponent,
    RouteStepComponent,
    ReviewStepComponent,
    DispatchNoteSerialsModalComponent,
  ],
  providers: [DispatchNoteWizardService],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      title="Nueva Remisión"
      size="lg"
      [showCloseButton]="true"
    >
      <!-- Steps Header (sin subtítulo por paso: cada paso pinta su cabecera) -->
      <div class="px-4 py-2 border-b border-[var(--color-border)]">
        <app-steps-line
          [steps]="wizardService.stepsConfig()"
          [currentStep]="wizardService.currentStep()"
          [clickable]="true"
          (stepClicked)="onStepClicked($event)"
          size="md"
        ></app-steps-line>
      </div>

      <!-- Step Content -->
      <div class="p-4 max-h-[55vh] overflow-y-auto">
        @switch (wizardService.currentStep()) {
          @case (0) {
            <app-dispatch-wizard-type-step />
          }
          @case (1) {
            @if (wizardService.subtype() === 'customer_delivery') {
              <app-dispatch-wizard-order-step />
            } @else {
              <app-dispatch-wizard-party-step />
            }
          }
          @case (2) {
            @if (wizardService.subtype() === 'customer_delivery') {
              <app-dispatch-wizard-order-items-step />
            } @else {
              <app-dispatch-wizard-item-picker-step />
            }
          }
          @case (3) {
            @if (wizardService.subtype() === 'customer_delivery') {
              <app-dispatch-wizard-route-step />
            } @else {
              <app-dispatch-wizard-review-step
                [created]="isCreated()"
                [createdNote]="createdNote()"
                [completedAction]="completedAction()"
                (goToStep)="wizardService.goToStep($event)"
                (viewDetail)="onViewDetail($event)"
                (createAnother)="onCreateAnother()"
                (printNote)="onPrint($event)"
              />
            }
          }
          @case (4) {
            <app-dispatch-wizard-review-step
              [created]="isCreated()"
              [createdNote]="createdNote()"
              [completedAction]="completedAction()"
              (goToStep)="wizardService.goToStep($event)"
              (viewDetail)="onViewDetail($event)"
              (createAnother)="onCreateAnother()"
              (printNote)="onPrint($event)"
            />
          }
        }
      </div>

      <!-- Footer Navigation -->
      <div slot="footer">
        <div
          class="flex items-center justify-between px-4 py-2.5
                 bg-[var(--color-surface-elevated)] border-t border-[var(--color-border)]"
        >
          @if (wizardService.currentStep() > 0 && !isCreated()) {
            <app-button variant="outline" (clicked)="wizardService.previousStep()">
              <app-icon name="arrow-left" [size]="16" slot="icon"></app-icon>
              Anterior
            </app-button>
          } @else {
            <div></div>
          }

          @if (wizardService.currentStep() < wizardService.lastStepIndex() && !isCreated()) {
            <app-button
              variant="primary"
              (clicked)="wizardService.nextStep()"
              [disabled]="!wizardService.canProceed()"
            >
              Siguiente
              <app-icon name="arrow-right" [size]="16" slot="icon"></app-icon>
            </app-button>
          } @else if (!isCreated()) {
            <div class="relative flex items-center">
              <app-button
                variant="primary"
                (clicked)="onCreate()"
                [disabled]="!wizardService.canProceed() || isSubmitting()"
                [loading]="isSubmitting()"
                [showTextWhileLoading]="true"
              >
                Crear remisión
              </app-button>
            </div>
          }
        </div>
      </div>
    </app-modal>

    <!-- Serial Selection Modal (QUI-431) -->
    <app-dispatch-note-serials-modal
      [(isOpen)]="showSerialsModal"
      [items]="serialLines()"
      (confirmed)="onSerialsConfirmed($event)"
      (cancelled)="onSerialsCancelled()"
    ></app-dispatch-note-serials-modal>
  `,
})
export class DispatchNoteWizardComponent {
  private destroyRef = inject(DestroyRef);
  readonly wizardService = inject(DispatchNoteWizardService);
  private readonly dispatchNotesService = inject(DispatchNotesService);
  private readonly toast = inject(ToastService);
  private readonly printService = inject(DispatchNotePrintService);

  // Inputs
  readonly isOpen = input<boolean>(false);

  // Outputs
  readonly isOpenChange = output<boolean>();
  readonly created = output<DispatchNote>();

  // Local state
  readonly isSubmitting = signal(false);
  readonly isCreated = signal(false);
  readonly createdNote = signal<DispatchNote | null>(null);

  /**
   * Acción "completada" DERIVADA (no lee `terminalAction`). Sólo alimenta el
   * título de la pantalla de éxito del `review-step`, cuyo input es
   * `WizardTerminalAction`. Mapeo del estado destino derivado:
   *   - customer_delivery con ruta (`deriveTargetStatus()==='confirmed'`)
   *     → 'confirm_route' (título "Remisión confirmada y asignada").
   *   - customer_delivery sin ruta / inbound → 'draft' (título "Remisión creada").
   */
  readonly completedAction = computed<WizardTerminalAction>(() => {
    if (this.wizardService.subtype() === 'customer_delivery') {
      return this.wizardService.deriveTargetStatus() === 'confirmed'
        ? 'confirm_route'
        : 'draft';
    }
    return 'draft';
  });

  // QUI-431 — serial-selection state (sólo customer_delivery con ruta).
  readonly showSerialsModal = signal(false);
  readonly serialLines = signal<DispatchNoteSerialLine[]>([]);
  private pendingSerialNote: DispatchNote | null = null;

  onStepClicked(index: number): void {
    if (index <= this.wizardService.currentStep()) {
      this.wizardService.goToStep(index);
    }
  }

  onCreate(): void {
    this.isSubmitting.set(true);

    const sub = this.wizardService.subtype();
    const items = this.wizardService.items();
    const details = this.wizardService.details();

    // Defensive guard (canProceed ya lo gatea en el paso 'Ítems y bodega').
    if (items.length === 0) {
      this.toast.error('Debes despachar al menos un ítem');
      this.isSubmitting.set(false);
      return;
    }
    if (!details.dispatch_location_id) {
      this.toast.error('Selecciona una bodega de despacho');
      this.isSubmitting.set(false);
      return;
    }

    // Branch by subtype — each builds a different DTO and calls a different endpoint.
    switch (sub) {
      case 'customer_delivery':
        this._submitCustomerDelivery(items, details);
        break;
      case 'transfer_out':
      case 'transfer_in':
        this._submitTransfer(sub, items, details);
        break;
      case 'customer_return':
        this._submitReturn(items, details);
        break;
      case 'purchase_receipt':
        this._submitPurchaseReceipt(items, details);
        break;
      default:
        this.toast.error('Tipo de remisión no soportado');
        this.isSubmitting.set(false);
        break;
    }
  }

  // --- customer_delivery: order-first flow (createFromOrder → optional confirm) ---

  private _submitCustomerDelivery(items: WizardItem[], details: WizardDetails): void {
    const order = this.wizardService.selectedOrder();
    if (!order) {
      this.toast.error('Debes seleccionar una orden');
      this.isSubmitting.set(false);
      return;
    }
    // Siempre se crea como `draft`; el estado final se decide después con
    // `confirm()` (regla de negocio derivada de la asignación de ruta).
    const dto: CreateDispatchFromOrderDto = {
      target_status: 'draft',
      dispatch_location_id: details.dispatch_location_id,
      agreed_delivery_date: details.agreed_delivery_date || undefined,
      notes: details.notes || undefined,
      route_assignment: this.wizardService.buildRouteAssignment(),
      items: items.map(
        (i): CreateDispatchFromOrderItemDto => ({
          order_item_id: i.order_item_id!,
          dispatched_quantity: i.dispatched_quantity,
          location_id: i.location_id || undefined,
        }),
      ),
    };
    this.dispatchNotesService
      .createFromOrder(order.id, dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (note) => this._afterCustomerDeliveryCreate(note),
        error: (err) => this._onCreateError(err),
      });
  }

  /**
   * Post-creación customer_delivery. Regla derivada:
   *   - sin ruta (`routeMode()==='none'`) → queda `draft`, no se confirma.
   *   - con ruta → CONFIRMAR reutilizando el gate de seriales existente.
   */
  private _afterCustomerDeliveryCreate(note: DispatchNote): void {
    if (this.wizardService.routeMode() === 'none') {
      this._finishCreated(note);
      this.toast.success('Remisión creada como borrador');
      return;
    }

    // Ruta asignada → confirmar. Si hay líneas serializadas, primero se
    // capturan los seriales (confirm() los enlaza; createFromOrder no).
    const lines = this._buildSerialLines(note);
    if (lines.length > 0) {
      this.pendingSerialNote = note;
      this.serialLines.set(lines);
      this.showSerialsModal.set(true);
      return;
    }

    this._confirmNote(note, {});
  }

  private _confirmNote(note: DispatchNote, body: ConfirmDispatchNoteDto): void {
    this.dispatchNotesService
      .confirm(note.id, body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (confirmed) => {
          this._finishCreated(confirmed);
          this.toast.success('Remisión confirmada y asignada a la ruta');
        },
        error: (err) => this._onConfirmError(err),
      });
  }

  onSerialsConfirmed(item_serials: ConfirmDispatchNoteItemSerialsDto[]): void {
    const note = this.pendingSerialNote;
    this.showSerialsModal.set(false);
    if (!note) {
      this.isSubmitting.set(false);
      return;
    }
    this.pendingSerialNote = null;
    this._confirmNote(note, { item_serials });
  }

  onSerialsCancelled(): void {
    const note = this.pendingSerialNote;
    this.showSerialsModal.set(false);
    this.pendingSerialNote = null;
    if (note) {
      // La remisión ya existe como `draft`; sólo faltó confirmarla.
      this._finishCreated(note);
      this.toast.info('Remisión creada como borrador. Confírmala asignando los seriales.');
    } else {
      this.isSubmitting.set(false);
    }
  }

  // --- transfer_out / transfer_in: createTransfer (crea draft, sin confirm) ---

  private _submitTransfer(
    sub: 'transfer_out' | 'transfer_in',
    items: WizardItem[],
    details: WizardDetails,
  ): void {
    const fromId = this.wizardService.fromLocationId();
    const toId = this.wizardService.toLocationId();
    if (!fromId || !toId) {
      this.toast.error('Selecciona las bodegas de origen y destino');
      this.isSubmitting.set(false);
      return;
    }
    const dto: CreateTransferDispatchDto = {
      direction: this.wizardService.direction(),
      subtype: sub,
      reason: this.wizardService.reason() || undefined,
      from_location_id: fromId,
      to_location_id: toId,
      dispatch_location_id: details.dispatch_location_id,
      notes: details.notes || undefined,
      internal_notes: details.internal_notes || undefined,
      currency: details.currency,
      target_status: 'draft',
      items: items.map(
        (i): CreateDispatchNoteItemDto => ({
          product_id: i.product_id,
          product_variant_id: i.product_variant_id || undefined,
          location_id: i.location_id || details.dispatch_location_id,
          ordered_quantity: i.dispatched_quantity,
          dispatched_quantity: i.dispatched_quantity,
          unit_price: i.unit_price || undefined,
        }),
      ),
    };
    this.dispatchNotesService
      .createTransfer(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (note) => {
          this._finishCreated(note);
          this.toast.success('Remisión creada');
        },
        error: (err) => this._onCreateError(err),
      });
  }

  // --- customer_return: createReturn (crea draft, sin confirm/receive) ---

  private _submitReturn(items: WizardItem[], details: WizardDetails): void {
    const customerId = this.wizardService.customerId();
    if (!customerId) {
      this.toast.error('Selecciona un cliente');
      this.isSubmitting.set(false);
      return;
    }
    const dto: CreateReturnDispatchDto = {
      direction: 'inbound',
      subtype: 'customer_return',
      reason: this.wizardService.reason() || undefined,
      customer_id: customerId,
      related_dispatch_id: this.wizardService.relatedDispatchId() || undefined,
      dispatch_location_id: details.dispatch_location_id,
      notes: details.notes || undefined,
      internal_notes: details.internal_notes || undefined,
      currency: details.currency,
      target_status: 'draft',
      items: items.map(
        (i): CreateDispatchNoteItemDto => ({
          product_id: i.product_id,
          product_variant_id: i.product_variant_id || undefined,
          location_id: i.location_id || details.dispatch_location_id,
          ordered_quantity: i.dispatched_quantity,
          dispatched_quantity: i.dispatched_quantity,
          unit_price: i.unit_price || undefined,
        }),
      ),
    };
    this.dispatchNotesService
      .createReturn(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (note) => {
          this._finishCreated(note);
          this.toast.success('Remisión creada');
        },
        error: (err) => this._onCreateError(err),
      });
  }

  // --- purchase_receipt: createPurchaseReceipt (crea draft, sin confirm/receive) ---

  private _submitPurchaseReceipt(items: WizardItem[], details: WizardDetails): void {
    const supplierId = this.wizardService.supplierId();
    if (!supplierId) {
      this.toast.error('Selecciona un proveedor');
      this.isSubmitting.set(false);
      return;
    }
    const dto: CreatePurchaseReceiptDispatchDto = {
      direction: 'inbound',
      subtype: 'purchase_receipt',
      reason: this.wizardService.reason() || undefined,
      supplier_id: supplierId,
      purchase_order_id: this.wizardService.purchaseOrderId() || undefined,
      dispatch_location_id: details.dispatch_location_id,
      notes: details.notes || undefined,
      internal_notes: details.internal_notes || undefined,
      currency: details.currency,
      target_status: 'draft',
      items: items.map(
        (i): CreateDispatchNoteItemDto => ({
          product_id: i.product_id,
          product_variant_id: i.product_variant_id || undefined,
          location_id: i.location_id || details.dispatch_location_id,
          ordered_quantity: i.dispatched_quantity,
          dispatched_quantity: i.dispatched_quantity,
          unit_price: i.unit_price || undefined,
        }),
      ),
    };
    this.dispatchNotesService
      .createPurchaseReceipt(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (note) => {
          this._finishCreated(note);
          this.toast.success('Remisión creada');
        },
        error: (err) => this._onCreateError(err),
      });
  }

  private _buildSerialLines(note: DispatchNote): DispatchNoteSerialLine[] {
    return (note.dispatch_note_items ?? [])
      .filter((item) => item.product?.requires_serial_numbers === true)
      .map((item) => ({
        dispatch_note_item_id: item.id,
        product_id: item.product_id,
        product_variant_id: item.product_variant_id ?? undefined,
        location_id: item.location_id ?? note.dispatch_location_id ?? undefined,
        dispatched_quantity: item.dispatched_quantity,
        product_name: item.product?.name ?? `Producto #${item.product_id}`,
      }));
  }

  private _finishCreated(note: DispatchNote): void {
    this.isSubmitting.set(false);
    this.isCreated.set(true);
    this.createdNote.set(note);
    this.created.emit(note);
  }

  private _onCreateError(err: unknown): void {
    this.isSubmitting.set(false);
    this.toast.error((err as Error)?.message || 'Error al crear la remisión');
  }

  private _onConfirmError(err: unknown): void {
    // La remisión ya se creó como `draft`; sólo falló la confirmación.
    this.isSubmitting.set(false);
    this.toast.error(
      (err as Error)?.message || 'Remisión creada, pero falló la confirmación',
    );
  }

  onClose(): void {
    this.wizardService.reset();
    this.isCreated.set(false);
    this.createdNote.set(null);
    this._resetSerialState();
    this.isOpenChange.emit(false);
  }

  onCreateAnother(): void {
    this.wizardService.reset();
    this.isCreated.set(false);
    this.createdNote.set(null);
    this._resetSerialState();
  }

  private _resetSerialState(): void {
    this.showSerialsModal.set(false);
    this.serialLines.set([]);
    this.pendingSerialNote = null;
  }

  onViewDetail(_id: number): void {
    this.onClose();
  }

  onPrint(note: DispatchNote): void {
    this.printService.printDispatchNote(note);
  }
}

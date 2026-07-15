import {
  Component,
  DestroyRef,
  HostListener,
  inject,
  input,
  output,
  signal,
  computed,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap, of } from 'rxjs';

import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  StepsLineComponent,
  ToastService,
} from '../../../../../../shared/components';

import { DispatchNoteWizardService } from '../../services/dispatch-note-wizard.service';
import type { WizardTerminalAction } from '../../services/dispatch-note-wizard.service';
import { DispatchNotesService } from '../../services/dispatch-notes.service';
import { DispatchNotePrintService } from '../../services/dispatch-note-print.service';
import type { DispatchNote } from '../../interfaces/dispatch-note.interface';

import { OrderStepComponent } from './order-step.component';
import { OrderItemsStepComponent } from './order-items-step.component';
import { PartyStepComponent } from './party-step.component';
import { ItemPickerStepComponent } from './item-picker-step.component';
import { DetailsStepComponent } from './details-step.component';
import { RouteStepComponent } from './route-step.component';
import { ReviewStepComponent } from './review-step.component';
import { TypeStepComponent } from './type-step.component';
import {
  DispatchNoteSerialsModalComponent,
  DispatchNoteSerialLine,
} from '../dispatch-note-serials-modal/dispatch-note-serials-modal.component';

/**
 * Dispatch note wizard (ref 2026-06-25, plan wizard remisión order-first).
 *
 * 5 steps: Orden → Items → Detalles → Ruta → Revisión.
 * The wizard always creates a `draft` remisión via `createFromOrder` and
 * then chains `confirm` (with serial gate) and optionally `deliver` based
 * on the operator's terminal action.
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
    DetailsStepComponent,
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
      <!-- Steps Header -->
      <div class="px-4 py-2 border-b border-[var(--color-border)]">
        <app-steps-line
          [steps]="wizardService.stepsConfig()"
          [currentStep]="wizardService.currentStep()"
          [clickable]="true"
          (stepClicked)="onStepClicked($event)"
          size="md"
        ></app-steps-line>
        <p class="text-xs text-[var(--color-text-muted)] mt-1.5 mb-0.5">
          @switch (wizardService.currentStep()) {
            @case (0) { Selecciona el tipo de remisión }
            @case (1) {
              @switch (wizardService.subtype()) {
                @case ('customer_delivery') { Selecciona la orden a despachar }
                @case ('transfer_out') { Selecciona bodega origen y destino }
                @case ('transfer_in') { Selecciona bodega origen y destino }
                @case ('purchase_receipt') { Selecciona el proveedor }
                @case ('customer_return') { Selecciona el cliente y remisión original }
              }
            }
            @case (2) {
              @if (wizardService.subtype() === 'customer_delivery') {
                Ajusta las cantidades a despachar
              } @else {
                Busca y agrega los productos a despachar
              }
            }
            @case (3) { Configura bodega, fecha y notas }
            @case (4) {
              @if (wizardService.subtype() === 'customer_delivery') {
                Asigna la remisión a una ruta (opcional)
              } @else {
                Revisa y elige la acción terminal
              }
            }
            @case (5) { Revisa y elige la acción terminal }
          }
        </p>
      </div>

      <!-- Step Content -->
      <div class="p-4 max-h-[55vh] overflow-y-auto">
        @switch (wizardService.currentStep()) {
          @case (0) { <app-dispatch-wizard-type-step /> }
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
          @case (3) { <app-dispatch-wizard-details-step /> }
          @case (4) {
            @if (wizardService.subtype() === 'customer_delivery') {
              <app-dispatch-wizard-route-step />
            } @else {
              <app-dispatch-wizard-review-step
                [created]="isCreated()"
                [createdNote]="createdNote()"
                [completedAction]="completedAction()"
                [goToStepOffset]="1"
                (goToStep)="wizardService.goToStep($event)"
                (viewDetail)="onViewDetail($event)"
                (createAnother)="onCreateAnother()"
                (printNote)="onPrint($event)"
              />
            }
          }
          @case (5) {
            <app-dispatch-wizard-review-step
              [created]="isCreated()"
              [createdNote]="createdNote()"
              [completedAction]="completedAction()"
              [goToStepOffset]="1"
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
                {{ createActionLabel() }}
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

  /** Mirrors `wizardService.terminalAction()` for the review step. */
  readonly completedAction = computed(() => this.wizardService.terminalAction());

  // QUI-431 — serial-selection state.
  readonly showSerialsModal = signal(false);
  readonly serialLines = signal<DispatchNoteSerialLine[]>([]);
  private pendingSerialNote: DispatchNote | null = null;
  private pendingSerialAction: WizardTerminalAction | null = null;

  readonly createActionLabel = computed(() => {
    switch (this.wizardService.terminalAction()) {
      case 'confirm_route':
        return 'Confirmar y Asignar a Ruta';
      case 'deliver':
        return 'Confirmar y Entregar';
      case 'confirm':
        return 'Confirmar';
      case 'receive':
        return 'Confirmar y Recibir';
      default:
        return 'Crear como Borrador';
    }
  });

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
    const terminal = this.wizardService.terminalAction();

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
        this._submitCustomerDelivery(items, details, terminal);
        break;
      case 'transfer_out':
      case 'transfer_in':
        this._submitTransfer(sub, items, details, terminal);
        break;
      case 'customer_return':
        this._submitReturn(items, details, terminal);
        break;
      case 'purchase_receipt':
        this._submitPurchaseReceipt(items, details, terminal);
        break;
      default:
        this.toast.error('Tipo de remisión no soportado');
        this.isSubmitting.set(false);
        break;
    }
  }

  // --- customer_delivery: existing order-first flow (createFromOrder) ---

  private _submitCustomerDelivery(items: any[], details: any, terminal: WizardTerminalAction): void {
    const order = this.wizardService.selectedOrder();
    if (!order) {
      this.toast.error('Debes seleccionar una orden');
      this.isSubmitting.set(false);
      return;
    }
    const dto: any = {
      target_status: 'draft',
      dispatch_location_id: details.dispatch_location_id,
      agreed_delivery_date: details.agreed_delivery_date || undefined,
      notes: details.notes || undefined,
      route_assignment: this.wizardService.buildRouteAssignment(),
      items: items.map((i) => ({
        order_item_id: i.order_item_id,
        dispatched_quantity: i.dispatched_quantity,
        location_id: i.location_id || undefined,
      })),
    };
    this.dispatchNotesService
      .createFromOrder(order.id, dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (note) => this._afterCreate(note, terminal),
        error: (err) => this._onCreateError(err),
      });
  }

  // --- transfer_out / transfer_in: createTransfer ---

  private _submitTransfer(sub: 'transfer_out' | 'transfer_in', items: any[], details: any, terminal: WizardTerminalAction): void {
    const fromId = this.wizardService.fromLocationId();
    const toId = this.wizardService.toLocationId();
    if (!fromId || !toId) {
      this.toast.error('Selecciona las bodegas de origen y destino');
      this.isSubmitting.set(false);
      return;
    }
    const dto: any = {
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
      items: items.map((i) => ({
        product_id: i.product_id,
        product_variant_id: i.product_variant_id || undefined,
        location_id: i.location_id || details.dispatch_location_id,
        ordered_quantity: i.dispatched_quantity,
        dispatched_quantity: i.dispatched_quantity,
        unit_price: i.unit_price || undefined,
        lot_serial: i.lot_serial || undefined,
      })),
    };
    this.dispatchNotesService
      .createTransfer(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (note) => this._afterCreate(note, terminal),
        error: (err) => this._onCreateError(err),
      });
  }

  // --- customer_return: createReturn ---

  private _submitReturn(items: any[], details: any, terminal: WizardTerminalAction): void {
    const customerId = this.wizardService.customerId();
    if (!customerId) {
      this.toast.error('Selecciona un cliente');
      this.isSubmitting.set(false);
      return;
    }
    const dto: any = {
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
      items: items.map((i) => ({
        product_id: i.product_id,
        product_variant_id: i.product_variant_id || undefined,
        location_id: i.location_id || details.dispatch_location_id,
        ordered_quantity: i.dispatched_quantity,
        dispatched_quantity: i.dispatched_quantity,
        unit_price: i.unit_price || undefined,
      })),
    };
    this.dispatchNotesService
      .createReturn(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (note) => this._afterCreate(note, terminal),
        error: (err) => this._onCreateError(err),
      });
  }

  // --- purchase_receipt: createPurchaseReceipt ---

  private _submitPurchaseReceipt(items: any[], details: any, terminal: WizardTerminalAction): void {
    const supplierId = this.wizardService.supplierId();
    if (!supplierId) {
      this.toast.error('Selecciona un proveedor');
      this.isSubmitting.set(false);
      return;
    }
    const dto: any = {
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
      items: items.map((i) => ({
        product_id: i.product_id,
        product_variant_id: i.product_variant_id || undefined,
        location_id: i.location_id || details.dispatch_location_id,
        ordered_quantity: i.dispatched_quantity,
        dispatched_quantity: i.dispatched_quantity,
        unit_price: i.unit_price || undefined,
      })),
    };
    this.dispatchNotesService
      .createPurchaseReceipt(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (note) => this._afterCreate(note, terminal),
        error: (err) => this._onCreateError(err),
      });
  }

  private _afterCreate(note: DispatchNote, terminal: WizardTerminalAction): void {
    if (terminal === 'draft') {
      this._onCreateSuccess(note, 'draft');
      this.toast.success('Remisión creada como borrador');
      return;
    }

    // Build serial lines (serialized products require serial selection before confirm).
    const lines = this._buildSerialLines(note);
    if (lines.length > 0) {
      this.pendingSerialNote = note;
      this.pendingSerialAction = terminal;
      this.serialLines.set(lines);
      this.showSerialsModal.set(true);
      return;
    }

    this._continueAfterCreate(note, terminal, { item_serials: [] });
  }

  onSerialsConfirmed(item_serials: any[]): void {
    const note = this.pendingSerialNote;
    const action = this.pendingSerialAction;
    this.showSerialsModal.set(false);
    if (!note || !action) {
      this.isSubmitting.set(false);
      return;
    }
    this.pendingSerialNote = null;
    this.pendingSerialAction = null;
    this._continueAfterCreate(note, action, { item_serials });
  }

  onSerialsCancelled(): void {
    const note = this.pendingSerialNote;
    this.showSerialsModal.set(false);
    this.pendingSerialNote = null;
    this.pendingSerialAction = null;
    if (note) {
      this._onCreateSuccess(note, 'draft');
      this.toast.info('Remisión creada como borrador. Confírmala asignando los seriales.');
    } else {
      this.isSubmitting.set(false);
    }
  }

  private _continueAfterCreate(
    note: DispatchNote,
    action: WizardTerminalAction,
    body: { item_serials: any[] },
  ): void {
    this.dispatchNotesService
      .confirm(note.id, body)
      .pipe(
        switchMap((confirmed) => {
          if (action === 'deliver') {
            return this.dispatchNotesService
              .deliver(confirmed.id, { actual_delivery_date: new Date().toISOString() })
              .pipe(switchMap((delivered) => of(delivered)));
          }
          if (action === 'receive') {
            return this.dispatchNotesService
              .receive(confirmed.id)
              .pipe(switchMap((received) => of(received)));
          }
          // confirm_route and confirm: stop after confirm.
          return of(confirmed);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (final) => this._onCreateSuccess(final, action),
        error: (err) => this._onCreateError(err, action),
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

  private _onCreateSuccess(note: DispatchNote, action: WizardTerminalAction): void {
    this.isSubmitting.set(false);
    this.isCreated.set(true);
    this.createdNote.set(note);
    this.created.emit(note);
    const messages: Record<string, string> = {
      draft: 'Remisión creada',
      confirm_route: 'Remisión confirmada y asignada a la ruta',
      deliver: 'Remisión entregada',
      confirm: 'Remisión confirmada',
      receive: 'Remisión recibida',
    };
    this.toast.success(messages[action] ?? 'Remisión creada');
  }

  private _onCreateError(err: unknown, reachedAction?: WizardTerminalAction): void {
    this.isSubmitting.set(false);
    const messages: Record<string, string> = {
      confirm_route: 'Remisión creada, pero falló la confirmación',
      deliver: 'Remisión confirmada, pero falló la entrega',
      confirm: 'Remisión creada, pero falló la confirmación',
      receive: 'Remisión confirmada, pero falló la recepción',
    };
    const msg = reachedAction
      ? messages[reachedAction]
      : (err as Error)?.message || 'Error al crear la remisión';
    this.toast.error(msg);
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
    this.pendingSerialAction = null;
  }

  onViewDetail(_id: number): void {
    this.onClose();
  }

  onPrint(note: DispatchNote): void {
    this.printService.printDispatchNote(note);
  }
}

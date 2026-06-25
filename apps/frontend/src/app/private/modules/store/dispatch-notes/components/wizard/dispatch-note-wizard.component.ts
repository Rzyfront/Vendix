import {Component, HostListener, inject, input, output, signal, computed, DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap, of } from 'rxjs';

import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  StepsLineComponent,
  ToastService,
} from '../../../../../../shared/components';
import {
  DispatchNoteWizardService,
  type WizardCreateAction,
} from '../../services/dispatch-note-wizard.service';
import { DispatchNotesService } from '../../services/dispatch-notes.service';
import { DispatchNotePrintService } from '../../services/dispatch-note-print.service';
import type {
  DispatchNote,
  CreateDispatchNoteDto,
  CreateDispatchNoteItemDto,
  ConfirmDispatchNoteItemSerialsDto,
} from '../../interfaces/dispatch-note.interface';

import { CustomerStepComponent } from './customer-step.component';
import { ProductsStepComponent } from './products-step.component';
import { DetailsStepComponent } from './details-step.component';
import { ReviewStepComponent } from './review-step.component';
import {
  DispatchNoteSerialsModalComponent,
  DispatchNoteSerialLine,
} from '../dispatch-note-serials-modal/dispatch-note-serials-modal.component';

@Component({
  selector: 'app-dispatch-note-wizard',
  standalone: true,
  imports: [
    ModalComponent,
    ButtonComponent,
    IconComponent,
    StepsLineComponent,
    CustomerStepComponent,
    ProductsStepComponent,
    DetailsStepComponent,
    ReviewStepComponent,
    DispatchNoteSerialsModalComponent,
  ],
  providers: [DispatchNoteWizardService],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      title="Nueva Remision"
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
        <!-- Step hint line -->
        <p class="text-xs text-[var(--color-text-muted)] mt-1.5 mb-0.5">
          @switch (wizardService.currentStep()) {
            @case (0) {
              Selecciona el cliente para la remision
            }
            @case (1) {
              Agrega los productos a despachar
            }
            @case (2) {
              Configura fechas, ubicacion y notas
            }
            @case (3) {
              Revisa y confirma la remision
            }
          }
        </p>
      </div>

      <!-- Step Content -->
      <div class="p-4 max-h-[50vh] overflow-y-auto">
        @switch (wizardService.currentStep()) {
          @case (0) {
            <app-dispatch-wizard-customer-step />
          }
          @case (1) {
            <app-dispatch-wizard-products-step />
          }
          @case (2) {
            <app-dispatch-wizard-details-step />
          }
          @case (3) {
            <app-dispatch-wizard-review-step
              [created]="isCreated()"
              [createdNote]="createdNote()"
              [completedAction]="wizardService.createAction()"
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
          <!-- Left: Back button -->
          @if (wizardService.currentStep() > 0 && !isCreated()) {
            <app-button
              variant="outline"
              (clicked)="wizardService.previousStep()"
            >
              <app-icon name="arrow-left" [size]="16" slot="icon" ></app-icon>
              Anterior
            </app-button>
          } @else {
            <div></div>
          }

          <!-- Right: Next/Create button -->
          @if (wizardService.currentStep() < 3 && !isCreated()) {
            <app-button
              variant="primary"
              (clicked)="wizardService.nextStep()"
              [disabled]="!wizardService.canProceed()"
            >
              Siguiente
              <app-icon name="arrow-right" [size]="16" slot="icon" ></app-icon>
            </app-button>
          } @else if (!isCreated()) {
            <div class="relative flex items-center">
              <app-button
                variant="primary"
                (clicked)="onCreate()"
                [disabled]="!wizardService.canProceed() || isSubmitting()"
                [loading]="isSubmitting()"
                [showTextWhileLoading]="true"
                customClasses="!rounded-r-none"
              >
                {{ createActionLabel() }}
              </app-button>
              <button
                type="button"
                data-action-menu
                class="h-10 sm:h-11 px-2 bg-[var(--color-primary)] text-[var(--color-text-on-primary)]
                       rounded-r-xl border-l border-white/20
                       hover:bg-[var(--color-primary)]/80 transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed
                       flex items-center justify-center"
                [disabled]="isSubmitting()"
                (click)="toggleActionMenu($event)"
              >
                <app-icon name="chevron-down" [size]="14"></app-icon>
              </button>

              @if (showActionMenu()) {
                <div
                  data-action-menu
                  class="absolute bottom-full right-0 mb-1.5 w-52 rounded-xl border border-[var(--color-border)]
                         bg-[var(--color-surface)] shadow-lg z-10 py-1 overflow-hidden"
                >
                  <button
                    type="button"
                    class="w-full text-left px-3.5 py-2.5 text-sm transition-colors flex items-center gap-2"
                    [class]="
                      wizardService.createAction() === 'draft'
                        ? 'bg-[var(--color-primary-light)] font-semibold text-[var(--color-primary)]'
                        : 'hover:bg-[var(--color-background)] text-[var(--color-text-primary)]'
                    "
                    (click)="selectAction('draft')"
                  >
                    <app-icon name="file-text" [size]="15"></app-icon>
                    Crear (Borrador)
                  </button>
                  <button
                    type="button"
                    class="w-full text-left px-3.5 py-2.5 text-sm transition-colors flex items-center gap-2"
                    [class]="
                      wizardService.createAction() === 'confirm'
                        ? 'bg-[var(--color-primary-light)] font-semibold text-[var(--color-primary)]'
                        : 'hover:bg-[var(--color-background)] text-[var(--color-text-primary)]'
                    "
                    (click)="selectAction('confirm')"
                  >
                    <app-icon name="check-circle" [size]="15"></app-icon>
                    Crear y Confirmar
                  </button>
                  <button
                    type="button"
                    class="w-full text-left px-3.5 py-2.5 text-sm transition-colors flex items-center gap-2"
                    [class]="
                      wizardService.createAction() === 'invoice'
                        ? 'bg-[var(--color-primary-light)] font-semibold text-[var(--color-primary)]'
                        : 'hover:bg-[var(--color-background)] text-[var(--color-text-primary)]'
                    "
                    (click)="selectAction('invoice')"
                  >
                    <app-icon name="file-check" [size]="15"></app-icon>
                    Crear y Facturar
                  </button>
                </div>
              }
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
  readonly showActionMenu = signal(false);

  // QUI-431 — serial-selection state. When a created draft has serialized
  // lines, we pause the confirm/invoice chain to collect serials.
  readonly showSerialsModal = signal(false);
  readonly serialLines = signal<DispatchNoteSerialLine[]>([]);
  // The pending note + downstream action while the serials modal is open.
  private pendingSerialNote: DispatchNote | null = null;
  private pendingSerialAction: 'confirm' | 'invoice' | null = null;
  readonly createActionLabel = computed(() => {
    switch (this.wizardService.createAction()) {
      case 'confirm':
        return 'Crear y Confirmar';
      case 'invoice':
        return 'Crear y Facturar';
      default:
        return 'Crear Remision';
    }
  });

  onStepClicked(index: number): void {
    // Only allow going back, not forward
    if (index <= this.wizardService.currentStep()) {
      this.wizardService.goToStep(index);
    }
  }

  onCreate(): void {
    this.isSubmitting.set(true);

    const customer = this.wizardService.customer();
    const items = this.wizardService.items();
    const details = this.wizardService.details();

    if (!customer) {
      this.toast.error('Debes seleccionar un cliente');
      this.isSubmitting.set(false);
      return;
    }

    if (items.length === 0) {
      this.toast.error('Debes agregar al menos un producto');
      this.isSubmitting.set(false);
      return;
    }

    const dtoItems: CreateDispatchNoteItemDto[] = items.map((item) => ({
      product_id: item.product_id,
      product_variant_id: item.product_variant_id || undefined,
      location_id: item.location_id || undefined,
      ordered_quantity: item.ordered_quantity,
      dispatched_quantity: item.dispatched_quantity,
      unit_price: item.unit_price,
      discount_amount: item.discount_amount,
      tax_amount: item.tax_amount,
      lot_serial: item.lot_serial || undefined,
    }));

    const dto: CreateDispatchNoteDto = {
      customer_id: customer.id,
      dispatch_location_id: details.dispatch_location_id || undefined,
      emission_date: details.emission_date || undefined,
      agreed_delivery_date: details.agreed_delivery_date || undefined,
      notes: details.notes || undefined,
      internal_notes: details.internal_notes || undefined,
      currency: details.currency || undefined,
      items: dtoItems,
    };

    const action = this.wizardService.createAction();

    const create$ = this.dispatchNotesService.create(dto);

    if (action === 'draft') {
      // draft: solo crear
      create$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (note) => this._onCreateSuccess(note, 'draft'),
        error: (err) => this._onCreateError(err),
      });
      return;
    }

    // confirm / invoice: crear primero como borrador y luego encadenar.
    // QUI-431 — si la nota creada tiene líneas serializadas, NO auto-confirmar:
    // pausar para recolectar seriales vía el modal y continuar al confirmarlos.
    create$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (note) => {
        const lines = this._buildSerialLines(note);
        if (lines.length > 0) {
          this.pendingSerialNote = note;
          this.pendingSerialAction = action;
          this.serialLines.set(lines);
          this.showSerialsModal.set(true);
          // keep isSubmitting true; the chain resumes on serial confirm.
          return;
        }
        // No serialized lines → flujo encadenado original.
        this._continueAfterCreate(note, action);
      },
      error: (err) => this._onCreateError(err),
    });
  }

  /**
   * QUI-431 — Resume the confirm/invoice chain for a freshly created (draft)
   * note. `body` carries the assembled `item_serials[]` when the note has
   * serialized lines; it is omitted for non-serialized notes.
   */
  private _continueAfterCreate(
    note: DispatchNote,
    action: 'confirm' | 'invoice',
    body?: { item_serials: ConfirmDispatchNoteItemSerialsDto[] },
  ): void {
    if (action === 'confirm') {
      this.dispatchNotesService
        .confirm(note.id, body)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (confirmed) => this._onCreateSuccess(confirmed, 'confirm'),
          error: (err) => this._onCreateError(err, 'confirm'),
        });
      return;
    }

    // invoice: confirmar -> entregar -> facturar
    this.dispatchNotesService
      .confirm(note.id, body)
      .pipe(
        switchMap((confirmed) =>
          this.dispatchNotesService.deliver(confirmed.id).pipe(
            switchMap((delivered) =>
              this.dispatchNotesService
                .invoice(delivered.id)
                .pipe(switchMap((invoiced) => of(invoiced))),
            ),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (invoiced) => this._onCreateSuccess(invoiced, 'invoice'),
        error: (err) => this._onCreateError(err, 'invoice'),
      });
  }

  /** QUI-431 — modal emitted serials → resume the paused confirm/invoice chain. */
  onSerialsConfirmed(item_serials: ConfirmDispatchNoteItemSerialsDto[]): void {
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

  /**
   * QUI-431 — operator cancelled the serials modal. The draft note already
   * exists, so surface it as a created draft instead of losing it silently.
   */
  onSerialsCancelled(): void {
    const note = this.pendingSerialNote;
    this.showSerialsModal.set(false);
    this.pendingSerialNote = null;
    this.pendingSerialAction = null;
    if (note) {
      this._onCreateSuccess(note, 'draft');
      this.toast.info(
        'Remision creada como borrador. Confírmala asignando los seriales.',
      );
    } else {
      this.isSubmitting.set(false);
    }
  }

  /**
   * QUI-431 — Extract serialized lines from a created note. A line is
   * serialized when its included product has `requires_serial_numbers`.
   */
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

  private _onCreateSuccess(
    note: DispatchNote,
    action: WizardCreateAction | 'confirm' | 'invoice',
  ): void {
    this.isSubmitting.set(false);
    this.isCreated.set(true);
    this.createdNote.set(note);
    this.created.emit(note);

    const messages: Record<string, string> = {
      draft: 'Remision creada exitosamente',
      confirm: 'Remision creada y confirmada',
      invoice: 'Remision facturada',
    };
    this.toast.success(messages[action] ?? 'Remision creada exitosamente');
  }

  private _onCreateError(err: unknown, reachedAction?: string): void {
    this.isSubmitting.set(false);
    const messages: Record<string, string> = {
      confirm: 'Remision creada, pero falló la confirmacion',
      invoice: 'Remision creada y confirmada, pero falló la entrega',
    };
    const msg = reachedAction
      ? messages[reachedAction]
      : (err as Error)?.message || 'Error al crear la remision';
    this.toast.error(msg);
  }

  toggleActionMenu(event: Event): void {
    event.stopPropagation();
    this.showActionMenu.update((v) => !v);
  }

  selectAction(action: WizardCreateAction): void {
    this.wizardService.setCreateAction(action);
    this.showActionMenu.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    const target = event.target as HTMLElement;
    const button = target.closest('[data-action-menu]');
    if (!button) {
      this.showActionMenu.set(false);
    }
  }

  onClose(): void {
    this.showActionMenu.set(false);
    this.wizardService.reset();
    this.isCreated.set(false);
    this.createdNote.set(null);
    this._resetSerialState();
    this.isOpenChange.emit(false);
  }

  onCreateAnother(): void {
    this.showActionMenu.set(false);
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

  onViewDetail(id: number): void {
    this.onClose();
    // Navigation will be handled by the parent component
  }

  onPrint(note: DispatchNote): void {
    this.printService.printDispatchNote(note);
  }
}

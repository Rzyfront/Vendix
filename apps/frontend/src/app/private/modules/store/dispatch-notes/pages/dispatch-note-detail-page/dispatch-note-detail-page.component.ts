import { Component, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { DialogService } from '../../../../../../shared/components/dialog/dialog.service';
import { DispatchNotesService } from '../../services/dispatch-notes.service';
import { DispatchNoteDetailComponent } from '../../components/dispatch-note-detail/dispatch-note-detail.component';
import { DispatchNotePdfViewerComponent } from '../../components/dispatch-note-pdf-viewer/dispatch-note-pdf-viewer.component';
import { DeliverModalComponent } from '../../components/deliver-modal/deliver-modal.component';
import { AssignRouteModalComponent } from '../../components/assign-route-modal/assign-route-modal.component';
import { VoidModalComponent } from '../../components/void-modal/void-modal.component';
import { InvoiceModalComponent } from '../../components/invoice-modal/invoice-modal.component';
import {
  DispatchNoteSerialsModalComponent,
  DispatchNoteSerialLine,
} from '../../components/dispatch-note-serials-modal/dispatch-note-serials-modal.component';
import {
  DispatchNote,
  ConfirmDispatchNoteItemSerialsDto,
} from '../../interfaces/dispatch-note.interface';

@Component({
  selector: 'app-dispatch-note-detail-page',
  standalone: true,
  imports: [
    DispatchNoteDetailComponent,
    DispatchNotePdfViewerComponent,
    DeliverModalComponent,
    AssignRouteModalComponent,
    VoidModalComponent,
    InvoiceModalComponent,
    DispatchNoteSerialsModalComponent,
  ],
  template: `
    <div class="min-h-screen" style="background-color: var(--color-background)">
      <!-- Loading State -->
      @if (is_loading()) {
        <div class="p-8 text-center">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p class="mt-2 text-text-secondary">Cargando remision...</p>
        </div>
      }

      <!-- Detail Component -->
      @if (!is_loading() && dispatch_note()) {
        <app-dispatch-note-detail
          [dispatch_note]="dispatch_note()!"
          (confirmAction)="handleConfirm($event)"
          (deliverAction)="openDeliverModal($event)"
          (assignRouteAction)="openAssignRouteModal($event)"
          (voidAction)="openVoidModal($event)"
          (invoiceAction)="openInvoiceModal($event)"
          (printAction)="handlePrint($event)"
          (addressSaved)="onAddressSaved()"
        ></app-dispatch-note-detail>
      }

      <!-- Not Found State -->
      @if (!is_loading() && !dispatch_note()) {
        <div class="p-8 text-center">
          <p class="text-text-secondary">No se encontro la remision.</p>
        </div>
      }

      <!-- Lifecycle Modals -->
      @if (dispatch_note()) {
        <app-deliver-modal
          [isOpen]="showDeliverModal()"
          (isOpenChange)="showDeliverModal.set($event)"
          [dispatchNote]="dispatch_note()!"
          (delivered)="handleDeliver($event)"
        ></app-deliver-modal>

        <app-assign-route-modal
          [isOpen]="showAssignModal()"
          (isOpenChange)="showAssignModal.set($event)"
          [dispatchNote]="dispatch_note()!"
          (assigned)="onRouteAssigned()"
        ></app-assign-route-modal>

        <app-void-modal
          [isOpen]="showVoidModal()"
          (isOpenChange)="showVoidModal.set($event)"
          [dispatchNote]="dispatch_note()!"
          (voided)="handleVoid($event)"
        ></app-void-modal>

        <app-invoice-modal
          [isOpen]="showInvoiceModal()"
          (isOpenChange)="showInvoiceModal.set($event)"
          [dispatchNote]="dispatch_note()!"
          (invoiced)="handleInvoice()"
        ></app-invoice-modal>
      }

      <!-- Serial Selection Modal (QUI-431) -->
      <app-dispatch-note-serials-modal
        [(isOpen)]="showSerialsModal"
        [items]="serialLines()"
        (confirmed)="onSerialsConfirmed($event)"
      ></app-dispatch-note-serials-modal>

      <!-- PDF Viewer -->
      @if (showPdfViewer() && pdfNoteId()) {
        <app-dispatch-note-pdf-viewer
          [dispatchNoteId]="pdfNoteId()!"
          (close)="showPdfViewer.set(false)"
        ></app-dispatch-note-pdf-viewer>
      }
    </div>
  `,
})
export class DispatchNoteDetailPageComponent {
  private route = inject(ActivatedRoute);
  private dispatchNotesService = inject(DispatchNotesService);
  private toastService = inject(ToastService);
  private dialogService = inject(DialogService);
  private destroyRef = inject(DestroyRef);

  dispatch_note = signal<DispatchNote | null>(null);
  is_loading = signal(false);
  showDeliverModal = signal(false);
  showAssignModal = signal(false);
  showVoidModal = signal(false);
  showInvoiceModal = signal(false);
  showPdfViewer = signal(false);
  pdfNoteId = signal<number | null>(null);

  // QUI-431 — serial-selection modal state for confirming serialized notes.
  showSerialsModal = signal(false);
  serialLines = signal<DispatchNoteSerialLine[]>([]);

  constructor() {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (id) {
      this.loadDispatchNote(id);
    }
  }

  loadDispatchNote(id: number): void {
    this.is_loading.set(true);
    this.dispatchNotesService.getDispatchNote(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (dn) => {
          this.dispatch_note.set(dn);
          this.is_loading.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar la remision');
          this.is_loading.set(false);
        },
      });
  }

  async handleConfirm(dn: DispatchNote): Promise<void> {
    // QUI-431 — if any line is serialized, collect serials via the modal
    // instead of the plain confirm dialog. The backend requires exactly
    // `dispatched_quantity` serials per serialized line (SERIAL_REQUIRED_001).
    const lines = this.buildSerialLines(dn);
    if (lines.length > 0) {
      this.serialLines.set(lines);
      this.showSerialsModal.set(true);
      return;
    }

    const confirmed = await this.dialogService.confirm({
      title: 'Confirmar Remision',
      message: `Confirmar la remision ${dn.dispatch_number}?`,
      confirmText: 'Confirmar',
      cancelText: 'Volver',
    });
    if (!confirmed) return;

    this._doConfirm(dn.id);
  }

  /** QUI-431 — modal emitted the assembled serials → confirm with item_serials. */
  onSerialsConfirmed(item_serials: ConfirmDispatchNoteItemSerialsDto[]): void {
    const dn = this.dispatch_note();
    if (!dn) return;
    this.showSerialsModal.set(false);
    this._doConfirm(dn.id, { item_serials });
  }

  /** Shared confirm call (with or without serials). */
  private _doConfirm(
    id: number,
    body?: { item_serials: ConfirmDispatchNoteItemSerialsDto[] },
  ): void {
    this.dispatchNotesService.confirm(id, body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Remision confirmada');
          this.loadDispatchNote(id);
        },
        error: (err: Error) =>
          this.toastService.error(err?.message || 'Error al confirmar la remision'),
      });
  }

  /**
   * QUI-431 — Extract the serialized lines from a dispatch note. A line is
   * serialized when its included product has `requires_serial_numbers`.
   */
  private buildSerialLines(dn: DispatchNote): DispatchNoteSerialLine[] {
    return (dn.dispatch_note_items ?? [])
      .filter((item) => item.product?.requires_serial_numbers === true)
      .map((item) => ({
        dispatch_note_item_id: item.id,
        product_id: item.product_id,
        product_variant_id: item.product_variant_id ?? undefined,
        location_id: item.location_id ?? dn.dispatch_location_id ?? undefined,
        dispatched_quantity: item.dispatched_quantity,
        product_name: item.product?.name ?? `Producto #${item.product_id}`,
      }));
  }

  openDeliverModal(dn: DispatchNote): void {
    this.showDeliverModal.set(true);
  }

  openAssignRouteModal(dn: DispatchNote): void {
    this.showAssignModal.set(true);
  }

  /** The remisión was assigned to a route → reload so the detail reflects the
   *  new active route (chip + hidden "Asignar a ruta" action). */
  onRouteAssigned(): void {
    const dn = this.dispatch_note();
    if (dn) this.loadDispatchNote(dn.id);
  }

  openVoidModal(dn: DispatchNote): void {
    this.showVoidModal.set(true);
  }

  openInvoiceModal(dn: DispatchNote): void {
    this.showInvoiceModal.set(true);
  }

  handleDeliver(payload: { actual_delivery_date: string; notes?: string }): void {
    const dn = this.dispatch_note();
    if (!dn) return;

    this.showDeliverModal.set(false);
    this.dispatchNotesService.deliver(dn.id, payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Remision marcada como entregada');
          this.loadDispatchNote(dn.id);
        },
        error: () => this.toastService.error('Error al entregar la remision'),
      });
  }

  handleVoid(payload: { void_reason: string }): void {
    const dn = this.dispatch_note();
    if (!dn) return;

    this.showVoidModal.set(false);
    this.dispatchNotesService.void(dn.id, payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Remision anulada');
          this.loadDispatchNote(dn.id);
        },
        error: () => this.toastService.error('Error al anular la remision'),
      });
  }

  handleInvoice(): void {
    const dn = this.dispatch_note();
    if (!dn) return;

    this.showInvoiceModal.set(false);
    this.dispatchNotesService.invoice(dn.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Factura generada exitosamente');
          this.loadDispatchNote(dn.id);
        },
        error: () => this.toastService.error('Error al facturar la remision'),
      });
  }

  handlePrint(dn: DispatchNote): void {
    this.pdfNoteId.set(dn.id);
    this.showPdfViewer.set(true);
  }

  /**
   * The dispatch-note-detail child persisted a delivery address via its inline
   * `<app-dispatch-note-address-editor (saved)>` → refetch the remision so the
   * address snapshot, the "dirección de entrega" chip and the dispatch-block
   * banner all reflect the new state.
   */
  onAddressSaved(): void {
    const dn = this.dispatch_note();
    if (dn) this.loadDispatchNote(dn.id);
  }
}

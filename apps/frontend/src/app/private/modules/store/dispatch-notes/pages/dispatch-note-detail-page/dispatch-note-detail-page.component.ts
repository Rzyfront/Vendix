import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { DialogService } from '../../../../../../shared/components/dialog/dialog.service';
import { DispatchNotesService } from '../../services/dispatch-notes.service';
import { DispatchNotePrintService } from '../../services/dispatch-note-print.service';
import { DispatchNoteDetailComponent } from '../../components/dispatch-note-detail/dispatch-note-detail.component';
import { DeliverModalComponent } from '../../components/deliver-modal/deliver-modal.component';
import { VoidModalComponent } from '../../components/void-modal/void-modal.component';
import { InvoiceModalComponent } from '../../components/invoice-modal/invoice-modal.component';
import { DispatchNote } from '../../interfaces/dispatch-note.interface';

@Component({
  selector: 'app-dispatch-note-detail-page',
  standalone: true,
  imports: [
    DispatchNoteDetailComponent,
    DeliverModalComponent,
    VoidModalComponent,
    InvoiceModalComponent,
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
          (voidAction)="openVoidModal($event)"
          (invoiceAction)="openInvoiceModal($event)"
          (printAction)="handlePrint($event)"
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
    </div>
  `,
})
export class DispatchNoteDetailPageComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private dispatchNotesService = inject(DispatchNotesService);
  private printService = inject(DispatchNotePrintService);
  private toastService = inject(ToastService);
  private dialogService = inject(DialogService);

  dispatch_note = signal<DispatchNote | null>(null);
  is_loading = signal(false);
  showDeliverModal = signal(false);
  showVoidModal = signal(false);
  showInvoiceModal = signal(false);

  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (id) {
      this.loadDispatchNote(id);
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadDispatchNote(id: number): void {
    this.is_loading.set(true);
    this.dispatchNotesService.getDispatchNote(id)
      .pipe(takeUntil(this.destroy$))
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
    const confirmed = await this.dialogService.confirm({
      title: 'Confirmar Remision',
      message: `Confirmar la remision ${dn.dispatch_number}?`,
      confirmText: 'Confirmar',
      cancelText: 'Volver',
    });
    if (!confirmed) return;

    this.dispatchNotesService.confirm(dn.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.success('Remision confirmada');
          this.loadDispatchNote(dn.id);
        },
        error: () => this.toastService.error('Error al confirmar la remision'),
      });
  }

  openDeliverModal(dn: DispatchNote): void {
    this.showDeliverModal.set(true);
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
      .pipe(takeUntil(this.destroy$))
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
      .pipe(takeUntil(this.destroy$))
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
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.success('Factura generada exitosamente');
          this.loadDispatchNote(dn.id);
        },
        error: () => this.toastService.error('Error al facturar la remision'),
      });
  }

  handlePrint(dn: DispatchNote): void {
    this.printService.printDispatchNote(dn);
  }
}

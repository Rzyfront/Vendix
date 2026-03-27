import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { DialogService } from '../../../../../../shared/components/dialog/dialog.service';
import { DispatchNotesService } from '../../services/dispatch-notes.service';
import { DispatchNotePrintService } from '../../services/dispatch-note-print.service';
import { DispatchNoteDetailComponent } from '../../components/dispatch-note-detail/dispatch-note-detail.component';
import { DispatchNote } from '../../interfaces/dispatch-note.interface';

@Component({
  selector: 'app-dispatch-note-detail-page',
  standalone: true,
  imports: [
    CommonModule,
    DispatchNoteDetailComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Loading State -->
      <div *ngIf="is_loading()" class="p-8 text-center">
        <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        <p class="mt-2 text-text-secondary">Cargando remision...</p>
      </div>

      <!-- Detail Component -->
      <app-dispatch-note-detail
        *ngIf="!is_loading() && dispatch_note()"
        [dispatch_note]="dispatch_note()!"
        (confirmAction)="handleConfirm($event)"
        (deliverAction)="handleDeliver($event)"
        (voidAction)="handleVoid($event)"
        (invoiceAction)="handleInvoice($event)"
        (printAction)="handlePrint($event)"
        (backAction)="handleBack()"
      ></app-dispatch-note-detail>

      <!-- Not Found State -->
      <div *ngIf="!is_loading() && !dispatch_note()" class="p-8 text-center">
        <p class="text-text-secondary">No se encontro la remision.</p>
      </div>
    </div>
  `,
})
export class DispatchNoteDetailPageComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private dispatchNotesService = inject(DispatchNotesService);
  private printService = inject(DispatchNotePrintService);
  private toastService = inject(ToastService);
  private dialogService = inject(DialogService);

  dispatch_note = signal<DispatchNote | null>(null);
  is_loading = signal(false);

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

  async handleDeliver(dn: DispatchNote): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Marcar como Entregada',
      message: `Marcar la remision ${dn.dispatch_number} como entregada?`,
      confirmText: 'Entregar',
      cancelText: 'Volver',
    });
    if (!confirmed) return;

    this.dispatchNotesService.deliver(dn.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.success('Remision marcada como entregada');
          this.loadDispatchNote(dn.id);
        },
        error: () => this.toastService.error('Error al entregar la remision'),
      });
  }

  async handleVoid(dn: DispatchNote): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Anular Remision',
      message: `Anular la remision ${dn.dispatch_number}? Esta accion no se puede deshacer.`,
      confirmText: 'Anular',
      cancelText: 'Volver',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    this.dispatchNotesService.void(dn.id, { void_reason: 'Anulada por usuario' })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.success('Remision anulada');
          this.loadDispatchNote(dn.id);
        },
        error: () => this.toastService.error('Error al anular la remision'),
      });
  }

  async handleInvoice(dn: DispatchNote): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Facturar Remision',
      message: `Generar factura para la remision ${dn.dispatch_number}?`,
      confirmText: 'Facturar',
      cancelText: 'Volver',
    });
    if (!confirmed) return;

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

  handleBack(): void {
    this.router.navigate(['/admin/dispatch-notes']);
  }
}

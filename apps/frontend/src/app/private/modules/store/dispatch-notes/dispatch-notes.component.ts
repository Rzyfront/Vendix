import { Component, OnInit, OnDestroy, ViewChild, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { DialogService } from '../../../../shared/components/dialog/dialog.service';
import { DispatchNotesService } from './services/dispatch-notes.service';
import { DispatchNotePrintService } from './services/dispatch-note-print.service';
import { DispatchNoteListComponent } from './components/dispatch-note-list/dispatch-note-list.component';
import { DispatchNoteStatsComponent } from './components/dispatch-note-stats/dispatch-note-stats.component';
import { DispatchNoteFormModalComponent } from './components/dispatch-note-form-modal/dispatch-note-form-modal.component';
import {
  DispatchNote,
  DispatchNoteStats,
  CreateDispatchNoteDto,
} from './interfaces/dispatch-note.interface';

@Component({
  selector: 'app-dispatch-notes',
  standalone: true,
  imports: [
    CommonModule,
    DispatchNoteListComponent,
    DispatchNoteStatsComponent,
    DispatchNoteFormModalComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats: Sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-dispatch-note-stats
          [stats]="stats()"
          [loading]="stats_loading()"
        ></app-dispatch-note-stats>
      </div>

      <!-- List Component -->
      <app-dispatch-note-list
        (viewDetail)="onViewDetail($event)"
        (create)="openCreateModal()"
        (refresh)="refreshData()"
      ></app-dispatch-note-list>

      <!-- Create Modal -->
      <app-dispatch-note-form-modal
        [is_open]="is_modal_open()"
        [dispatch_note]="editing_note()"
        (save)="onCreateDispatchNote($event)"
        (closed)="closeCreateModal()"
      ></app-dispatch-note-form-modal>
    </div>
  `,
})
export class DispatchNotesComponent implements OnInit, OnDestroy {
  private dispatchNotesService = inject(DispatchNotesService);
  private printService = inject(DispatchNotePrintService);
  private router = inject(Router);
  private toastService = inject(ToastService);
  private dialogService = inject(DialogService);

  @ViewChild(DispatchNoteListComponent) dispatch_note_list!: DispatchNoteListComponent;

  stats = signal<DispatchNoteStats>({
    total: 0, draft: 0, confirmed: 0, delivered: 0, invoiced: 0, voided: 0,
  });
  stats_loading = signal(false);
  is_modal_open = signal(false);
  editing_note = signal<DispatchNote | null>(null);

  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.loadStats();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadStats(): void {
    this.stats_loading.set(true);
    this.dispatchNotesService.getStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (s) => {
          this.stats.set(s);
          this.stats_loading.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar estadisticas');
          this.stats_loading.set(false);
        },
      });
  }

  onViewDetail(dispatch_note: DispatchNote): void {
    this.router.navigate(['/admin/dispatch-notes', dispatch_note.id]);
  }

  openCreateModal(): void {
    this.editing_note.set(null);
    this.is_modal_open.set(true);
  }

  closeCreateModal(): void {
    this.is_modal_open.set(false);
    this.editing_note.set(null);
  }

  onCreateDispatchNote(dto: CreateDispatchNoteDto): void {
    this.dispatchNotesService.create(dto)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.success('Remision creada exitosamente');
          this.closeCreateModal();
          this.refreshData();
        },
        error: () => this.toastService.error('Error al crear la remision'),
      });
  }

  refreshData(): void {
    this.dispatchNotesService.invalidateCache();
    this.loadStats();
    this.dispatch_note_list?.loadDispatchNotes();
  }
}

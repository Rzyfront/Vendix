import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  inject,
  signal,
} from '@angular/core';

import { Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { DispatchNotesService } from './services/dispatch-notes.service';
import { DispatchNotePrintService } from './services/dispatch-note-print.service';
import { DispatchNoteListComponent } from './components/dispatch-note-list/dispatch-note-list.component';
import { DispatchNoteStatsComponent } from './components/dispatch-note-stats/dispatch-note-stats.component';
import { DispatchNoteWizardComponent } from './components/wizard/dispatch-note-wizard.component';
import {
  DispatchNote,
  DispatchNoteStats,
} from './interfaces/dispatch-note.interface';

@Component({
  selector: 'app-dispatch-notes',
  standalone: true,
  imports: [
    DispatchNoteListComponent,
    DispatchNoteStatsComponent,
    DispatchNoteWizardComponent,
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

      @defer (when is_modal_open()) {
        <app-dispatch-note-wizard
          [isOpen]="is_modal_open()"
          (isOpenChange)="onWizardOpenChange($event)"
          (created)="onDispatchNoteCreated()"
        ></app-dispatch-note-wizard>
      }
    </div>
  `,
})
export class DispatchNotesComponent implements OnInit, OnDestroy {
  private dispatchNotesService = inject(DispatchNotesService);
  private printService = inject(DispatchNotePrintService);
  private router = inject(Router);
  private toastService = inject(ToastService);

  @ViewChild(DispatchNoteListComponent)
  dispatch_note_list!: DispatchNoteListComponent;

  stats = signal<DispatchNoteStats>({
    total: 0,
    draft: 0,
    confirmed: 0,
    delivered: 0,
    invoiced: 0,
    voided: 0,
  });
  stats_loading = signal(false);
  is_modal_open = signal(false);

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
    this.dispatchNotesService
      .getStats()
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
    this.router.navigate(['/admin/orders/dispatch-notes', dispatch_note.id]);
  }

  openCreateModal(): void {
    this.is_modal_open.set(true);
  }

  onWizardOpenChange(isOpen: boolean): void {
    this.is_modal_open.set(isOpen);
  }

  onDispatchNoteCreated(): void {
    this.refreshData();
  }

  refreshData(): void {
    this.dispatchNotesService.invalidateCache();
    this.loadStats();
    this.dispatch_note_list?.loadDispatchNotes();
  }
}

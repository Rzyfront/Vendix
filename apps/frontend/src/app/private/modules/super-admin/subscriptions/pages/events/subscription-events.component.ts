import { Component, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SubscriptionAdminService } from '../../services/subscription-admin.service';
import { SubscriptionEvent } from '../../interfaces/subscription-admin.interface';
import {
  InputsearchComponent,
  ButtonComponent,
  IconComponent,
  TimelineComponent,
  TimelineStep,
  PaginationComponent,
  EmptyStateComponent,
} from '../../../../../../shared/components';

@Component({
  selector: 'app-subscription-events',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    InputsearchComponent,
    ButtonComponent,
    IconComponent,
    TimelineComponent,
    PaginationComponent,
    EmptyStateComponent,
  ],
  template: `
    <div class="w-full">
      <div class="flex items-center gap-3 mb-6">
        <button
          type="button"
          class="p-2 rounded-lg hover:bg-gray-100 text-text-secondary"
          (click)="router.navigate(['/super-admin/subscriptions/active'])"
        >
          <app-icon name="arrow-left" [size]="20"></app-icon>
        </button>
        <h1 class="text-xl font-semibold text-text-primary">Subscription Events</h1>
      </div>

      <div class="bg-surface rounded-card border border-border p-4 md:p-6 mb-6">
        <form [formGroup]="form" class="flex flex-col sm:flex-row gap-3">
          <app-inputsearch
            class="flex-1"
            placeholder="Search by subscription ID..."
            [debounceTime]="500"
            (searchChange)="onSubscriptionIdChange($event)"
          />
          <app-button variant="primary" size="sm" (clicked)="loadEvents()">
            <app-icon name="search" [size]="16" slot="icon"></app-icon>
            Search
          </app-button>
        </form>
      </div>

      @if (loading()) {
        <div class="p-8 text-center">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p class="mt-2 text-text-secondary">Loading events...</p>
        </div>
      } @else if (events().length === 0) {
        <app-empty-state
          icon="activity"
          title="No events found"
          description="Enter a subscription ID to view its audit timeline."
        ></app-empty-state>
      } @else {
        <div class="bg-surface rounded-card border border-border p-4 md:p-6">
          <app-timeline [steps]="timelineSteps()" variant="default" size="md"></app-timeline>
        </div>
        <div class="mt-6 flex justify-center">
          <app-pagination
            [currentPage]="pagination().page"
            [totalPages]="pagination().totalPages"
            [total]="pagination().total"
            [limit]="pagination().limit"
            infoStyle="page"
            (pageChange)="changePage($event)"
          />
        </div>
      }
    </div>
  `,
})
export class SubscriptionEventsComponent {
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);
  readonly router = inject(Router);
  private fb = inject(FormBuilder);
  private service = inject(SubscriptionAdminService);

  readonly events = signal<SubscriptionEvent[]>([]);
  readonly loading = signal(false);
  readonly subscriptionId = signal('');

  readonly pagination = signal({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });

  form: FormGroup = this.fb.group({
    subscriptionId: [''],
  });

  constructor() {
    const queryId = this.route.snapshot.queryParamMap.get('subscriptionId');
    if (queryId) {
      this.subscriptionId.set(queryId);
      this.form.patchValue({ subscriptionId: queryId });
      this.loadEvents();
    }
  }

  timelineSteps(): TimelineStep[] {
    return this.events().map((event, index) => ({
      key: `event-${index}`,
      label: event.event_type,
      description: event.description,
      date: event.created_at,
      status: 'completed' as const,
      variant: 'default' as const,
    }));
  }

  loadEvents(): void {
    const id = this.subscriptionId();
    if (!id) return;

    this.loading.set(true);
    const pag = this.pagination();
    this.service
      .getSubscriptionEvents(id, { page: pag.page, limit: pag.limit })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success) {
            this.events.set(res.data);
            this.pagination.update((p) => ({
              ...p,
              total: res.meta.total,
              totalPages: res.meta.totalPages,
            }));
          }
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  onSubscriptionIdChange(value: string): void {
    this.subscriptionId.set(value);
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadEvents();
  }

  changePage(page: number): void {
    this.pagination.update((p) => ({ ...p, page }));
    this.loadEvents();
  }
}

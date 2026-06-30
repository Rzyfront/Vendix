import {
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  PublicPqrView,
  PqrService,
} from '../../../../shared/services/pqr.service';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { PublicHeaderComponent } from '../../../landing/components/public-header/public-header.component';
import { TimelineComponent } from '../../../../shared/components/timeline/timeline.component';
import type {
  TimelineStep,
  TimelineStepStatus,
} from '../../../../shared/components/timeline/timeline.interfaces';

type TrackState = 'idle' | 'loading' | 'loaded' | 'not_found' | 'error';

/**
 * Public tracking page. Reads `:ticket_number` from the route, looks it up
 * via `PqrService.track()`, and shows the sanitized view (status + public
 * responses). Anonymous, rate-limited server-side.
 */
@Component({
  selector: 'app-pqr-track',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    DatePipe,
    IconComponent,
    PublicHeaderComponent,
    TimelineComponent,
  ],
  templateUrl: './pqr-track.component.html',
  styleUrls: ['./pqr-track.component.scss'],
})
export class PqrTrackComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly pqrService = inject(PqrService);

  readonly state = signal<TrackState>('idle');
  readonly view = signal<PublicPqrView | null>(null);
  readonly queryInput = signal('');
  readonly errorMsg = signal<string | null>(null);

  readonly ticketNumber = toSignal(
    this.route.paramMap,
    { initialValue: this.route.snapshot.paramMap },
  );

  readonly currentTicket = computed(
    () => this.ticketNumber().get('ticket_number') ?? '',
  );

  readonly typeLabel = computed(() => {
    const t = this.view()?.pqr_type;
    return (
      { PETITION: 'Petición', COMPLAINT: 'Queja', CLAIM: 'Reclamo' } as Record<
        string,
        string
      >
    )[t ?? ''] ?? '';
  });

  /**
   * Linear status flow used by the public progress tracker. The same
   * five-step lifecycle the legal SLA enforces (Ley 1755/2015 art. 14 +
   * Ley 1474/2011 art. 55). Order matters: each row's `status` flag
   * (`current` vs `completed` vs `upcoming`) is derived from the index
   * of the PQR's actual status within this flow.
   *
   * Note: REOPENED isn't a step — it's a "cycle restart" marker. We map
   * it to the OPEN position (see `lifecycleTimeline`) so the current
   * dot lands on "En revisión" without inventing a new bucket.
   */
  private readonly statusFlow: readonly { status: string; label: string }[] = [
    { status: 'NEW', label: 'Recibido' },
    { status: 'OPEN', label: 'En revisión' },
    { status: 'IN_PROGRESS', label: 'En proceso' },
    { status: 'WAITING_RESPONSE', label: 'Esperando tu respuesta' },
    { status: 'RESOLVED', label: 'Resuelto' },
    { status: 'CLOSED', label: 'Cerrado' },
  ];

  /**
   * Maps the loaded PQR's status to a TimelineStep[] for the
   * `<app-timeline>` component. Same component used by the order-details
   * page's "Progreso de la orden" — gives the public user a consistent
   * stepper UX. Collapsed view shows just the current step (with green
   * dot); expanded view shows the whole flow.
   *
   * Status semantics:
   *   - completed   : step the PQR has already passed
   *   - current     : step the PQR is on (green dot in default variant)
   *   - upcoming    : step the PQR hasn't reached yet
   *
   * Edge cases:
   *   - REOPENED → treated as currently at OPEN position (cycle restart).
   *   - CLOSED   → all previous steps + current step are "completed"
   *                (green), no "upcoming" remainders.
   */
  readonly lifecycleTimeline = computed<TimelineStep[]>(() => {
    const raw = this.view()?.status;
    if (!raw) return [];

    // REOPENED collapses into the OPEN bucket — see statusFlow comment.
    const effective = raw === 'REOPENED' ? 'OPEN' : raw;
    const idx = this.statusFlow.findIndex((s) => s.status === effective);
    if (idx === -1) return [];

    return this.statusFlow.map((step, i) => {
      let status: TimelineStepStatus;
      if (i < idx) {
        status = 'completed';
      } else if (i === idx) {
        // CLOSED is the terminal happy-path — every step including the
        // current reads as completed so the dots stay green all the way.
        status = raw === 'CLOSED' ? 'completed' : 'current';
      } else {
        status = 'upcoming';
      }
      return {
        key: step.status,
        label: step.label,
        status,
      };
    });
  });

  constructor() {
    effect(() => {
      const t = this.currentTicket();
      if (t) this.lookup(t);
    });
  }

  lookup(ticket: string) {
    const t = ticket.trim();
    if (!t) return;
    this.state.set('loading');
    this.errorMsg.set(null);
    this.pqrService.track(t).subscribe({
      next: (res) => {
        if (res.success) {
          this.view.set(res.data);
          this.state.set('loaded');
        } else {
          this.state.set('not_found');
        }
      },
      error: (err) => {
        if (err?.status === 404) {
          this.state.set('not_found');
        } else if (err?.status === 429) {
          this.state.set('error');
          this.errorMsg.set(
            'Has hecho muchas consultas en poco tiempo. Intenta de nuevo en un minuto.',
          );
        } else {
          this.state.set('error');
          this.errorMsg.set(
            err?.error?.message ?? 'No pudimos consultar el estado. Intenta de nuevo.',
          );
        }
      },
    });
  }

  search() {
    const t = this.queryInput().trim();
    if (!t) return;
    this.router.navigate(['/pqr/consultar', t]);
  }
}
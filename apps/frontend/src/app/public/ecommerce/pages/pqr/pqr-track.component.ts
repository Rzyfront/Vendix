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
import { PqrStatusPillComponent } from '../../../../private/modules/store/pqr/components/pqr-status-pill.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { PublicHeaderComponent } from '../../../landing/components/public-header/public-header.component';

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
    PqrStatusPillComponent,
    IconComponent,
    PublicHeaderComponent,
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
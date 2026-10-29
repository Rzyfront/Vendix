import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  ButtonComponent,
  IconComponent,
  TextareaComponent,
} from '../../../../../shared/components/index';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { HotelBookingService, HotelStayReview } from '../../services/hotel-booking.service';
import { apiMessage, formatDateOnly } from './hotel-date.util';

/** Same cap as the API. */
const MAX_COMMENT = 1000;

/**
 * Hospitality Suite (H8.5) — private stay rating: the guest opens the link of
 * the thank-you email, without login, and gives 1-5 stars and an optional
 * comment. Only the hotel sees it (Clientes → Reseñas and the reservation).
 */
@Component({
  selector: 'app-hotel-stay-review',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, ButtonComponent, IconComponent, TextareaComponent],
  template: `
    <div class="mx-auto max-w-xl space-y-4 p-4" data-testid="stay-review-page">
      <h1 class="flex items-center gap-2 text-xl font-semibold">
        <app-icon name="star" [size]="22" />
        Califica tu estadía
      </h1>

      @if (loadError(); as message) {
        <div class="space-y-3 rounded-lg border border-border p-4" data-testid="stay-review-error">
          <p class="text-sm">{{ message }}</p>
          @if (retryable()) {
            <app-button variant="outline" (clicked)="load()">
              <app-icon slot="icon" name="refresh-cw" [size]="14" />
              Reintentar
            </app-button>
          }
        </div>
      } @else if (info(); as r) {
        <div class="space-y-1 rounded-lg border border-border p-4 text-sm">
          <p class="font-medium">{{ r.store_name }} · Reserva {{ r.reservation_number }}</p>
          <p class="text-text-secondary">
            Llegada {{ date(r.arrival_date) }} · Salida {{ date(r.departure_date) }}
          </p>
        </div>

        @if (r.review; as review) {
          <div class="space-y-2 rounded-lg border border-border p-4 text-center" data-testid="stay-review-done">
            <app-icon name="circle-check" [size]="32" class="text-success" />
            <p class="text-lg font-semibold">¡Gracias por tu calificación!</p>
            <p class="text-2xl text-warning" [attr.aria-label]="review.rating + ' de 5 estrellas'">
              {{ stars(review.rating) }}
            </p>
            @if (review.comment) {
              <p class="text-sm text-text-secondary">“{{ review.comment }}”</p>
            }
            <p class="text-sm text-text-secondary">Tu opinión llega solo al hotel y nos ayuda a mejorar.</p>
          </div>
        } @else {
          <form class="space-y-4" novalidate data-testid="stay-review-form" (submit)="submit($event)">
            <fieldset class="space-y-2 rounded-lg border border-border p-4">
              <legend class="px-1 font-medium">¿Cómo estuvo tu estadía?</legend>
              <div class="flex justify-center gap-1" role="radiogroup" aria-label="Calificación">
                @for (s of starValues; track s) {
                  <button
                    type="button"
                    class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    role="radio"
                    [attr.aria-checked]="s === rating()"
                    [attr.aria-label]="s + (s === 1 ? ' estrella' : ' estrellas')"
                    [attr.data-autofocus]="s === 1 ? '' : null"
                    [attr.data-testid]="'stay-review-star-' + s"
                    (click)="pick(s)"
                  >
                    <app-icon
                      name="star"
                      [size]="36"
                      [class]="s <= rating() ? 'text-warning fill-warning' : 'text-text-secondary'"
                    />
                  </button>
                }
              </div>
              <p class="text-center text-sm text-text-secondary">{{ ratingLabel() }}</p>
              @if (ratingError()) {
                <p class="text-center text-sm text-error" role="alert" data-testid="stay-review-rating-error">
                  Elige de 1 a 5 estrellas
                </p>
              }
            </fieldset>

            <app-textarea
              [formControl]="commentControl"
              [control]="commentControl"
              label="Cuéntanos más (opcional)"
              placeholder="¿Qué te gustó? ¿Qué podemos mejorar?"
              [rows]="4"
              [error]="commentError()"
            />

            @if (submitError(); as message) {
              <p class="rounded-lg bg-error/10 px-3 py-2 text-sm" role="alert" data-testid="stay-review-submit-error">
                {{ message }}
              </p>
            }

            <app-button
              type="submit"
              variant="primary"
              [fullWidth]="true"
              [loading]="saving()"
              data-testid="stay-review-submit"
            >
              <app-icon slot="icon" name="send" [size]="16" />
              Enviar calificación
            </app-button>
            <p class="text-center text-xs text-text-secondary">
              Tu calificación es privada: solo la ve el hotel.
            </p>
          </form>
        }
      } @else {
        <p class="text-text-secondary">Cargando tu estadía…</p>
      }
    </div>
  `,
})
export class HotelStayReviewComponent implements OnInit {
  private readonly service = inject(HotelBookingService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  private token = '';

  readonly starValues = [1, 2, 3, 4, 5];
  readonly info = signal<HotelStayReview | null>(null);
  readonly loadError = signal<string | null>(null);
  readonly retryable = signal(false);
  readonly rating = signal(0);
  readonly ratingError = signal(false);
  readonly submitError = signal<string | null>(null);
  readonly saving = signal(false);

  readonly commentControl = new FormControl<string>('', {
    nonNullable: true,
    validators: [Validators.maxLength(MAX_COMMENT)],
  });

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    this.load();
  }

  load(): void {
    this.loadError.set(null);
    this.info.set(null);
    this.service
      .getStayReview(this.token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (info) => this.info.set(info),
        error: (err: { status?: number }) => {
          // 404/410 are final (unknown or closed link); anything else can be retried.
          this.retryable.set(err?.status !== 404 && err?.status !== 410);
          this.loadError.set(
            apiMessage(err, 'No pudimos cargar tu estadía. Revisa tu conexión e inténtalo de nuevo.'),
          );
        },
      });
  }

  pick(value: number): void {
    this.rating.set(value);
    this.ratingError.set(false);
  }

  ratingLabel(): string {
    return ['Toca una estrella', 'Muy mala', 'Mala', 'Regular', 'Buena', 'Excelente'][this.rating()] ?? '';
  }

  commentError(): string | undefined {
    return this.commentControl.hasError('maxlength')
      ? `Escribe hasta ${MAX_COMMENT} caracteres.`
      : undefined;
  }

  /** Plain form (no FormGroup): Enter or the button submit here, without a page reload. */
  submit(event?: Event): void {
    event?.preventDefault();
    if (this.saving()) return;
    if (!this.rating()) {
      this.ratingError.set(true);
      return;
    }
    if (this.commentControl.invalid) {
      this.commentControl.markAsTouched();
      return;
    }
    this.submitError.set(null);
    this.saving.set(true);
    this.service
      .submitStayReview(this.token, {
        rating: this.rating(),
        comment: this.commentControl.value.trim() || null,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (review) => {
          this.saving.set(false);
          this.info.update((info) => (info ? { ...info, review } : info));
          this.toast.success('Gracias por calificar tu estadía');
        },
        error: (err: { status?: number }) => {
          this.saving.set(false);
          // Already rated (another tab): show what the hotel received.
          if (err?.status === 409) {
            this.load();
            return;
          }
          this.submitError.set(apiMessage(err, 'No pudimos enviar tu calificación. Inténtalo de nuevo.'));
        },
      });
  }

  date(value: string): string {
    return formatDateOnly(value);
  }

  stars(value: number): string {
    const full = Math.max(0, Math.min(5, Math.round(value)));
    return '★'.repeat(full) + '☆'.repeat(5 - full);
  }
}

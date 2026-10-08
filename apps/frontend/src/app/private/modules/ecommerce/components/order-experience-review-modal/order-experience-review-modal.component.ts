import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { TextareaComponent } from '../../../../../shared/components/textarea/textarea.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import { OrderReviewsService } from '../../services/order-reviews.service';
import {
  CreateOrderReviewDto,
  ORDER_REVIEW_QUICK_TAG_LABELS,
  OrderReview,
  OrderReviewQuickTag,
  OrderReviewSource,
} from '../../models/order-review.model';

@Component({
  selector: 'app-order-experience-review-modal',
  standalone: true,
  imports: [ReactiveFormsModule, ModalComponent, ButtonComponent, IconComponent, TextareaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      (cancel)="onDismiss()"
      title="Cuéntanos cómo fue tu experiencia de compra"
      size="md"
    >
      <div class="exp-body">
        <div class="star-picker" role="radiogroup" aria-label="Calificación">
          @for (s of stars; track s) {
            <button
              type="button"
              class="star-btn"
              role="radio"
              [attr.aria-checked]="s === rating()"
              [attr.aria-label]="s + (s === 1 ? ' estrella' : ' estrellas')"
              (click)="rating.set(s)"
            >
              <app-icon
                name="star"
                [size]="32"
                [class]="s <= rating() ? 'text-warning fill-warning' : 'text-gray-300'"
              />
            </button>
          }
        </div>

        <div class="chips" role="group" aria-label="Cómo fue tu compra">
          @for (tag of tags; track tag.value) {
            <button
              type="button"
              class="chip"
              [class.chip--active]="quickTag() === tag.value"
              [attr.aria-pressed]="quickTag() === tag.value"
              (click)="toggleTag(tag.value)"
            >
              {{ tag.label }}
            </button>
          }
        </div>

        <app-textarea
          [formControl]="commentControl"
          placeholder="Cuéntanos más (opcional)"
          [rows]="3"
          [control]="commentControl"
        />
      </div>

      <div slot="footer" class="exp-footer">
        <app-button variant="outline" (clicked)="onDismiss()">Ahora no</app-button>
        <app-button
          variant="primary"
          [disabled]="rating() === 0 || commentTooLong()"
          [loading]="submitting()"
          (clicked)="submit()"
        >
          Enviar calificación
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [
    `
      .exp-body {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
      }
      .star-picker {
        display: flex;
        justify-content: center;
        gap: 0.25rem;
      }
      .star-btn {
        background: none;
        border: 0;
        padding: 0.25rem;
        min-width: 44px;
        min-height: 44px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        border-radius: var(--radius-md);
      }
      .star-btn:focus-visible {
        outline: 2px solid var(--color-primary);
        outline-offset: 2px;
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        justify-content: center;
      }
      .chip {
        min-height: 44px;
        padding: 0.5rem 1rem;
        border-radius: 999px;
        border: 1px solid var(--color-border);
        background: var(--color-surface);
        color: var(--color-text-primary);
        font-size: 0.875rem;
        cursor: pointer;
      }
      .chip:focus-visible {
        outline: 2px solid var(--color-primary);
        outline-offset: 2px;
      }
      .chip--active {
        border-color: var(--color-primary);
        background: var(--color-primary);
        color: var(--color-on-primary, #fff);
      }
      .exp-footer {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
      }
    `,
  ],
})
export class OrderExperienceReviewModalComponent {
  private readonly reviews = inject(OrderReviewsService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model<boolean>(false);
  /** Uno de los dos: token público (guest) o orderId (cuenta). */
  readonly token = input<string | null>(null);
  readonly orderId = input<number | null>(null);
  readonly source = input<OrderReviewSource>('order_detail');

  readonly submitted = output<OrderReview>();
  readonly dismissed = output<void>();

  readonly stars = [1, 2, 3, 4, 5];
  readonly tags: { value: OrderReviewQuickTag; label: string }[] = (
    Object.keys(ORDER_REVIEW_QUICK_TAG_LABELS) as OrderReviewQuickTag[]
  ).map((value) => ({ value, label: ORDER_REVIEW_QUICK_TAG_LABELS[value] }));

  readonly rating = signal(0);
  readonly quickTag = signal<OrderReviewQuickTag | null>(null);
  readonly submitting = signal(false);
  readonly commentControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.maxLength(1000)],
  });
  readonly commentTooLong = signal(false);

  constructor() {
    this.commentControl.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((v) => this.commentTooLong.set(v.length > 1000));
  }

  toggleTag(tag: OrderReviewQuickTag): void {
    const next = this.quickTag() === tag ? null : tag;
    this.quickTag.set(next);
    if (next && this.commentControl.value.trim() === '') {
      this.commentControl.setValue(ORDER_REVIEW_QUICK_TAG_LABELS[next]);
    }
  }

  onDismiss(): void {
    if (this.submitting()) return;
    this.isOpen.set(false);
    this.dismissed.emit();
  }

  submit(): void {
    if (this.rating() === 0 || this.submitting() || this.commentTooLong()) return;
    const token = this.token();
    const orderId = this.orderId();
    if (!token && orderId == null) return;

    const comment = this.commentControl.value.trim();
    const dto: CreateOrderReviewDto = {
      rating: this.rating(),
      source: this.source(),
      ...(this.quickTag() ? { quick_tag: this.quickTag()! } : {}),
      ...(comment ? { comment } : {}),
    };

    const request$ = token
      ? this.reviews.createByToken(token, dto)
      : this.reviews.createByOrder(orderId as number, dto);

    this.submitting.set(true);
    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (review) => {
        this.submitting.set(false);
        this.toast.success('¡Gracias por tu calificación!');
        this.isOpen.set(false);
        this.submitted.emit(review);
        this.rating.set(0);
        this.quickTag.set(null);
        this.commentControl.reset('');
      },
      error: (err) => {
        this.submitting.set(false);
        this.toast.error(extractApiErrorMessage(err));
      },
    });
  }
}

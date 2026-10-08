import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { InputComponent } from '../../../../../shared/components/input/input.component';
import { TextareaComponent } from '../../../../../shared/components/textarea/textarea.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import { OrderReviewsService } from '../../services/order-reviews.service';
import {
  CreateOrderProductReviewDto,
  OrderReviewStatusItem,
} from '../../models/order-review.model';

interface ProductReviewFormControls {
  rating: FormControl<number>;
  title: FormControl<string>;
  comment: FormControl<string>;
}

@Component({
  selector: 'app-order-product-review-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    TextareaComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      title="Reseñar producto"
      size="md"
    >
      @if (item(); as it) {
        <div class="prv-body">
          <div class="prv-product">
            @if (it.image_url) {
              <img class="prv-thumb" [src]="it.image_url" [alt]="it.product_name" />
            } @else {
              <span class="prv-thumb prv-thumb--empty"><app-icon name="image" [size]="20" /></span>
            }
            <span class="prv-name">{{ it.product_name }}</span>
          </div>

          <div class="star-picker" role="radiogroup" aria-label="Calificación">
            @for (s of stars; track s) {
              <button
                type="button"
                class="star-btn"
                role="radio"
                [attr.aria-checked]="s === ratingControl.value"
                [attr.aria-label]="s + (s === 1 ? ' estrella' : ' estrellas')"
                (click)="ratingControl.setValue(s)"
              >
                <app-icon
                  name="star"
                  [size]="32"
                  [class]="s <= ratingValue() ? 'text-warning fill-warning' : 'text-gray-300'"
                />
              </button>
            }
          </div>

          <form [formGroup]="form" class="prv-form" (ngSubmit)="submit()">
            <app-input
              formControlName="title"
              label="Título (opcional)"
              placeholder="Resume tu opinión"
              [control]="titleControl"
            />
            <app-textarea
              formControlName="comment"
              label="Tu opinión"
              placeholder="Cuéntanos qué te pareció (mínimo 10 caracteres)"
              [required]="true"
              [rows]="4"
              [control]="commentControl"
            />
          </form>
        </div>
      }

      <div slot="footer" class="prv-footer">
        <app-button variant="outline" (clicked)="isOpen.set(false)">Cancelar</app-button>
        <app-button
          variant="primary"
          [disabled]="!canSubmit()"
          [loading]="submitting()"
          (clicked)="submit()"
        >
          Enviar reseña
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [
    `
      .prv-body {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .prv-product {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }
      .prv-thumb {
        width: 56px;
        height: 56px;
        border-radius: var(--radius-md);
        object-fit: cover;
        background: var(--color-surface);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .prv-name {
        font-weight: 600;
        font-size: 0.9375rem;
        color: var(--color-text-primary);
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
      .prv-form {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .prv-footer {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
      }
    `,
  ],
})
export class OrderProductReviewModalComponent {
  private readonly reviews = inject(OrderReviewsService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model<boolean>(false);
  readonly token = input<string | null>(null);
  readonly orderId = input<number | null>(null);
  readonly item = input<OrderReviewStatusItem | null>(null);

  readonly submitted = output<void>();

  readonly stars = [1, 2, 3, 4, 5];
  readonly submitting = signal(false);

  readonly form = new FormGroup<ProductReviewFormControls>({
    rating: new FormControl(0, { nonNullable: true, validators: [Validators.min(1), Validators.max(5)] }),
    title: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(255)] }),
    comment: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(10), Validators.maxLength(5000)],
    }),
  });

  // Puentes de estado del form hacia signals (zoneless).
  private readonly formValid = signal(false);
  readonly ratingValue = signal(0);
  readonly canSubmit = computed(() => this.formValid() && !this.submitting());

  constructor() {
    this.form.statusChanges.pipe(takeUntilDestroyed()).subscribe((s) => this.formValid.set(s === 'VALID'));
    this.form.controls.rating.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((v) => this.ratingValue.set(v));
  }

  get ratingControl(): FormControl<number> {
    return this.form.controls.rating;
  }
  get titleControl(): FormControl<string> {
    return this.form.controls.title;
  }
  get commentControl(): FormControl<string> {
    return this.form.controls.comment;
  }

  submit(): void {
    const it = this.item();
    const token = this.token();
    const orderId = this.orderId();
    if (!it || this.form.invalid || this.submitting()) return;
    if (!token && orderId == null) return;

    const v = this.form.getRawValue();
    const title = v.title.trim();
    const dto: CreateOrderProductReviewDto = {
      product_id: it.product_id,
      rating: v.rating,
      comment: v.comment.trim(),
      ...(title ? { title } : {}),
    };
    const request$ = token
      ? this.reviews.createProductReviewByToken(token, dto)
      : this.reviews.createProductReviewByOrder(orderId as number, dto);

    this.submitting.set(true);
    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.submitting.set(false);
        this.toast.success('Reseña enviada. Se publicará cuando la tienda la apruebe.');
        this.isOpen.set(false);
        this.submitted.emit();
        this.form.reset({ rating: 0, title: '', comment: '' });
      },
      error: (err) => {
        this.submitting.set(false);
        this.toast.error(extractApiErrorMessage(err));
      },
    });
  }
}

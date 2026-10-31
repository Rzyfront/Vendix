import { Component, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  TextareaComponent,
  ToastService,
} from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { CrmSegmentsService } from '../shared/crm-segments.service';
import { CrmSegment, SegmentPreview } from '../shared/crm-segments.interface';
import { formatDateOnly } from '../shared/crm.utils';
import { SegmentBuilderComponent } from './segment-builder.component';
import { GroupDraft, draftFromFilter, filterFromDraft, newGroup } from './segments.utils';

/**
 * Create, edit or duplicate a segment: name, rule builder and a count with a
 * sample of the matching customers before saving (contact data is masked by
 * the API).
 */
@Component({
  selector: 'app-crm-segment-form-modal',
  standalone: true,
  imports: [
    FormsModule,
    CurrencyPipe,
    ButtonComponent,
    IconComponent,
    InputComponent,
    ModalComponent,
    SegmentBuilderComponent,
    TextareaComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      [title]="title()"
      subtitle="Define las reglas y revisa a quién incluye antes de guardar."
      size="lg"
      [fullScreenOnMobile]="true"
    >
      @if (isOpen()) {
        <div class="flex flex-col gap-4">
          <app-input
            label="Nombre del segmento"
            placeholder="Ej.: Clientes VIP en riesgo"
            [maxlength]="120"
            [ngModel]="name()"
            (ngModelChange)="name.set($event)"
          ></app-input>
          <app-textarea
            label="Descripción (opcional)"
            [rows]="2"
            [ngModel]="description()"
            (ngModelChange)="description.set($event)"
          ></app-textarea>

          <div class="flex flex-col gap-2">
            <span class="text-sm font-medium text-[var(--color-text-primary)]">Reglas</span>
            @if (unsupported()) {
              <p class="rounded-xl border border-[var(--color-border)] p-3 text-sm text-[var(--color-text-secondary)]">
                Este segmento usa reglas que el constructor no puede editar. Puedes cambiar su nombre
                y descripción; las reglas se conservan tal como están.
              </p>
            } @else {
              <app-crm-segment-builder [(draft)]="draft"></app-crm-segment-builder>
            }
          </div>

          <div class="flex flex-col gap-3 rounded-2xl border border-[var(--color-border)] p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-sm font-medium text-[var(--color-text-primary)]">Vista previa</span>
              <app-button
                variant="outline"
                size="sm"
                [disabled]="!filter() || unsupported()"
                [loading]="previewing()"
                (clicked)="runPreview()"
              >
                <app-icon name="refresh-cw" [size]="14" slot="icon"></app-icon>
                Calcular conteo
              </app-button>
            </div>
            @if (previewError()) {
              <p class="text-sm text-[var(--color-error)]">{{ previewError() }}</p>
            } @else if (preview(); as result) {
              <p class="text-sm text-[var(--color-text-primary)]" aria-live="polite">
                <strong>{{ result.count }}</strong>
                {{ result.count === 1 ? 'cliente cumple' : 'clientes cumplen' }} estas reglas.
              </p>
              @if (result.sample.length) {
                <ul class="flex flex-col divide-y divide-[var(--color-border)]" role="list">
                  @for (customer of result.sample; track customer.id) {
                    <li class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 text-sm">
                      <span class="font-medium text-[var(--color-text-primary)]">
                        {{ customer.first_name }} {{ customer.last_name }}
                      </span>
                      <span class="text-xs text-[var(--color-text-secondary)]">
                        {{ customer.email || customer.phone || 'Sin contacto' }}
                      </span>
                      <span class="text-xs text-[var(--color-text-secondary)]">
                        {{ customer.orders_count }} compras · {{ +customer.total_spent | currency }}
                        @if (customer.last_order_at) {
                          · última {{ lastOrder(customer.last_order_at) }}
                        }
                      </span>
                    </li>
                  }
                </ul>
                @if (result.count > result.sample.length) {
                  <p class="text-xs text-[var(--color-text-muted)]">
                    Muestra de {{ result.sample.length }} de {{ result.count }}.
                  </p>
                }
              }
            } @else {
              <p class="text-sm text-[var(--color-text-secondary)]">
                {{ filter() || unsupported() ? 'Calcula el conteo para ver a quién incluye.' : 'Completa todas las reglas para calcular el conteo.' }}
              </p>
            }
          </div>
        </div>
      }

      <div slot="footer" class="flex flex-wrap justify-end gap-3">
        <app-button variant="outline" size="md" (clicked)="isOpen.set(false)">Cancelar</app-button>
        <app-button
          variant="primary"
          size="md"
          [disabled]="!canSave()"
          [loading]="saving()"
          (clicked)="save()"
        >
          Guardar segmento
        </app-button>
      </div>
    </app-modal>
  `,
})
export class SegmentFormModalComponent {
  private readonly api = inject(CrmSegmentsService);
  private readonly toast = inject(ToastService);

  readonly isOpen = model(false);
  /** Segment to edit or to copy; null creates a new one. */
  readonly segment = input<CrmSegment | null>(null);
  readonly duplicate = input(false);
  readonly saved = output<CrmSegment>();

  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly draft = signal<GroupDraft>(newGroup());
  protected readonly unsupported = signal(false);
  protected readonly preview = signal<SegmentPreview | null>(null);
  protected readonly previewError = signal<string | null>(null);
  protected readonly previewing = signal(false);
  protected readonly saving = signal(false);
  private previewToken = 0;

  protected readonly filter = computed(() => filterFromDraft(this.draft()));
  protected readonly editing = computed(() => !!this.segment() && !this.duplicate());
  protected readonly title = computed(() =>
    this.duplicate() ? 'Duplicar segmento' : this.segment() ? 'Editar segmento' : 'Nuevo segmento',
  );
  protected readonly canSave = computed(
    () => !!this.name().trim() && (this.unsupported() ? this.editing() : !!this.filter()),
  );
  protected readonly lastOrder = formatDateOnly;

  constructor() {
    effect(() => {
      if (!this.isOpen()) return;
      const segment = this.segment();
      const duplicate = this.duplicate();
      untracked(() => {
        this.preview.set(null);
        this.previewError.set(null);
        this.name.set(segment ? (duplicate ? `Copia de ${segment.name}`.slice(0, 120) : segment.name) : '');
        this.description.set(segment?.description ?? '');
        const loaded = segment ? draftFromFilter(segment.filter) : newGroup();
        this.unsupported.set(!loaded);
        this.draft.set(loaded ?? newGroup());
      });
    });
    // Any change to the rules invalidates the count the owner saw.
    effect(() => {
      this.filter();
      untracked(() => {
        this.previewToken += 1;
        this.preview.set(null);
        this.previewError.set(null);
        this.previewing.set(false);
      });
    });
  }

  async runPreview(): Promise<void> {
    const filter = this.filter();
    if (!filter || this.previewing()) return;
    const token = ++this.previewToken;
    this.previewing.set(true);
    this.previewError.set(null);
    try {
      const result = await firstValueFrom(this.api.previewSegment(filter));
      if (token === this.previewToken) this.preview.set(result);
    } catch (error) {
      if (token === this.previewToken) this.previewError.set(parseApiError(error).userMessage);
    } finally {
      if (token === this.previewToken) this.previewing.set(false);
    }
  }

  async save(): Promise<void> {
    if (!this.canSave() || this.saving()) return;
    this.saving.set(true);
    const segment = this.segment();
    const body = {
      name: this.name().trim(),
      description: this.description().trim() || null,
    };
    try {
      let result: CrmSegment;
      if (this.editing() && segment) {
        const filter = this.unsupported() ? null : this.filter();
        result = await firstValueFrom(
          this.api.updateSegment(segment.id, filter ? { ...body, filter } : body),
        );
      } else {
        const filter = this.filter();
        if (!filter) return;
        result = await firstValueFrom(this.api.createSegment({ ...body, filter }));
      }
      this.toast.success(this.editing() ? 'Segmento actualizado' : 'Segmento creado');
      this.saved.emit(result);
      this.isOpen.set(false);
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
    } finally {
      this.saving.set(false);
    }
  }
}

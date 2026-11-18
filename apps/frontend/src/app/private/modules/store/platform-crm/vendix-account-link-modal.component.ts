import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SpinnerComponent,
  TextareaComponent,
  ToastService,
} from '../../../../shared/components';
import { parseApiError } from '../../../../core/utils/parse-api-error';
import { PlatformCrmService } from './platform-crm.service';
import {
  PlatformCrmLinkView,
  PlatformOrganizationSearchItem,
} from './platform-crm.interface';

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY = 2;

/**
 * Modal "Enlazar con cuenta Vendix": busca la organización cliente por
 * nombre, slug o NIT, la selecciona y confirma el enlace.
 */
@Component({
  selector: 'app-vendix-account-link-modal',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    IconComponent,
    InputComponent,
    ModalComponent,
    SpinnerComponent,
    TextareaComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      title="Enlazar con cuenta Vendix"
      subtitle="Busca la organización que este cliente creó y paga. No se fusionan cuentas."
      size="md"
    >
      <div class="flex flex-col gap-4">
        <app-input
          label="Organización"
          placeholder="Nombre, slug o NIT"
          [maxlength]="100"
          [ngModel]="query()"
          (ngModelChange)="onQuery($event)"
        ></app-input>

        @if (searching()) {
          <div class="flex justify-center py-3"><app-spinner size="sm"></app-spinner></div>
        } @else if (query().trim().length >= minQuery) {
          <ul class="flex max-h-64 flex-col gap-2 overflow-y-auto" role="listbox" aria-label="Organizaciones">
            @for (org of results(); track org.id) {
              <li>
                <button
                  type="button"
                  role="option"
                  [attr.aria-selected]="selected()?.id === org.id"
                  [class]="optionClass(org)"
                  (click)="selected.set(org)"
                >
                  <span class="min-w-0">
                    <span class="block truncate font-semibold text-text-primary">{{ org.name }}</span>
                    <span class="block truncate text-xs text-text-secondary">{{ org.slug }}</span>
                  </span>
                  @if (selected()?.id === org.id) {
                    <app-icon name="check" [size]="16"></app-icon>
                  }
                </button>
              </li>
            } @empty {
              <li class="py-3 text-center text-sm text-text-secondary">Ninguna organización coincide.</li>
            }
          </ul>
        } @else {
          <p class="text-sm text-text-secondary">Escribe al menos {{ minQuery }} caracteres.</p>
        }

        <app-textarea
          label="Nota (opcional)"
          placeholder="Ej.: Cerró con el plan anual"
          [rows]="2"
          [ngModel]="note()"
          (ngModelChange)="note.set($event)"
        ></app-textarea>
      </div>

      <div slot="footer" class="flex flex-wrap justify-end gap-3">
        <app-button variant="outline" size="md" (clicked)="isOpen.set(false)">Cancelar</app-button>
        <app-button
          variant="primary"
          size="md"
          [disabled]="!canSubmit()"
          [loading]="saving()"
          (clicked)="submit()"
        >
          Enlazar
        </app-button>
      </div>
    </app-modal>
  `,
})
export class VendixAccountLinkModalComponent {
  private readonly service = inject(PlatformCrmService);
  private readonly toast = inject(ToastService);

  readonly isOpen = model(false);
  readonly customerId = input.required<number>();
  readonly linked = output<PlatformCrmLinkView>();

  protected readonly minQuery = MIN_QUERY;
  protected readonly query = signal('');
  protected readonly note = signal('');
  protected readonly results = signal<PlatformOrganizationSearchItem[]>([]);
  protected readonly selected = signal<PlatformOrganizationSearchItem | null>(null);
  protected readonly searching = signal(false);
  protected readonly saving = signal(false);
  protected readonly canSubmit = computed(
    () => !!this.selected() && !this.saving() && this.note().length <= 300,
  );

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private searchSeq = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearTimer());
    // Cada apertura empieza limpia.
    effect(() => {
      if (!this.isOpen()) return;
      untracked(() => {
        this.clearTimer();
        this.query.set('');
        this.note.set('');
        this.results.set([]);
        this.selected.set(null);
        this.searching.set(false);
      });
    });
  }

  protected onQuery(value: string): void {
    this.query.set(value ?? '');
    this.selected.set(null);
    this.clearTimer();
    const term = this.query().trim();
    if (term.length < MIN_QUERY) {
      this.searchSeq++;
      this.results.set([]);
      this.searching.set(false);
      return;
    }
    this.searching.set(true);
    this.searchTimer = setTimeout(() => void this.search(term), SEARCH_DEBOUNCE_MS);
  }

  private async search(term: string): Promise<void> {
    const seq = ++this.searchSeq;
    try {
      const rows = await firstValueFrom(this.service.searchOrganizations(term));
      if (seq === this.searchSeq) this.results.set(rows);
    } catch (error) {
      if (seq === this.searchSeq) {
        this.results.set([]);
        this.toast.error(parseApiError(error).userMessage);
      }
    } finally {
      if (seq === this.searchSeq) this.searching.set(false);
    }
  }

  protected async submit(): Promise<void> {
    const org = this.selected();
    if (!org || this.saving()) return;
    this.saving.set(true);
    try {
      const note = this.note().trim();
      const view = await firstValueFrom(
        this.service.link(this.customerId(), {
          organization_id: org.id,
          ...(note ? { note } : {}),
        }),
      );
      this.toast.success(`Enlazado con ${org.name}`);
      this.linked.emit(view);
      this.isOpen.set(false);
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
    } finally {
      this.saving.set(false);
    }
  }

  protected optionClass(org: PlatformOrganizationSearchItem): string {
    const base =
      'flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors';
    return this.selected()?.id === org.id
      ? `${base} border-primary bg-primary/10`
      : `${base} border-border bg-surface`;
  }

  private clearTimer(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = null;
  }
}

import { Component, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  BadgeComponent,
  ButtonComponent,
  IconComponent,
  ModalComponent,
  SpinnerComponent,
  ToastService,
} from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { CrmService } from '../shared/crm.service';
import { CrmNote, CrmOpportunity, personName } from '../shared/crm.interface';
import { formatDateOnly, formatDateTime } from '../shared/crm.utils';
import { CustomersService } from '../../services/customers.service';
import { Customer } from '../../models/customer.model';
import { CustomerDataSheetComponent } from '../../components/customer-data-sheet/customer-data-sheet.component';

const STATUS_LABELS: Record<CrmOpportunity['status'], string> = {
  open: 'Abierta',
  won: 'Ganada',
  lost: 'Perdida',
};

const NO_CUSTOMER_PERMISSION = 'No tienes permiso para ver los datos del cliente.';

/**
 * Opportunity detail: summary, full customer data, CRM notes and the
 * customer data sheet, so the seller keeps the context without leaving the
 * pipeline.
 */
@Component({
  selector: 'app-crm-opportunity-detail-modal',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    BadgeComponent,
    ButtonComponent,
    CurrencyPipe,
    IconComponent,
    ModalComponent,
    SpinnerComponent,
    CustomerDataSheetComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      [title]="opportunity()?.title ?? 'Oportunidad'"
      subtitle="Detalle de la oportunidad"
      size="xl"
      [fullScreenOnMobile]="true"
    >
      @if (opportunity(); as o) {
        <div class="flex flex-col gap-6">
          <!-- Resumen -->
          <section aria-labelledby="opp-summary">
            <h3 id="opp-summary" class="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
              <app-icon name="briefcase" [size]="16"></app-icon> Resumen
            </h3>
            <dl class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt class="text-xs text-[var(--color-text-muted)]">Etapa</dt>
                <dd class="mt-0.5 inline-flex items-center gap-2 font-medium">
                  <span class="h-2.5 w-2.5 rounded-full" [style.background]="stageColor()"></span>
                  {{ o.stage?.name ?? '—' }}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-[var(--color-text-muted)]">Estado</dt>
                <dd class="mt-0.5">
                  <app-badge [variant]="o.status === 'won' ? 'success' : o.status === 'lost' ? 'error' : 'info'" size="xs">
                    {{ statusLabel() }}
                  </app-badge>
                </dd>
              </div>
              <div>
                <dt class="text-xs text-[var(--color-text-muted)]">Valor</dt>
                <dd class="mt-0.5 font-medium">{{ o.amount !== null ? (+o.amount | currency) : 'Sin valor' }}</dd>
              </div>
              <div>
                <dt class="text-xs text-[var(--color-text-muted)]">Probabilidad</dt>
                <dd class="mt-0.5 font-medium">{{ o.probability !== null ? o.probability + ' %' : '—' }}</dd>
              </div>
              <div>
                <dt class="text-xs text-[var(--color-text-muted)]">Cierre esperado</dt>
                <dd class="mt-0.5 font-medium">{{ dateOnly(o.expected_close_date) || '—' }}</dd>
              </div>
              <div>
                <dt class="text-xs text-[var(--color-text-muted)]">Responsable</dt>
                <dd class="mt-0.5 font-medium">{{ name(o.owner) || 'Sin responsable' }}</dd>
              </div>
              <div>
                <dt class="text-xs text-[var(--color-text-muted)]">Cotización</dt>
                <dd class="mt-0.5 font-medium">{{ o.quotation?.quotation_number ?? '—' }}</dd>
              </div>
              <div>
                <dt class="text-xs text-[var(--color-text-muted)]">Creada</dt>
                <dd class="mt-0.5 font-medium">{{ dateTime(o.created_at) }}</dd>
              </div>
              <div>
                <dt class="text-xs text-[var(--color-text-muted)]">Actualizada</dt>
                <dd class="mt-0.5 font-medium">{{ dateTime(o.updated_at) }}</dd>
              </div>
              @if (o.status === 'lost' && o.lost_reason) {
                <div class="sm:col-span-2 lg:col-span-3">
                  <dt class="text-xs text-[var(--color-text-muted)]">Motivo de pérdida</dt>
                  <dd class="mt-0.5 font-medium text-[var(--color-error)]">{{ o.lost_reason }}</dd>
                </div>
              }
            </dl>
          </section>

          <!-- Cliente -->
          <section aria-labelledby="opp-customer" class="border-t border-[var(--color-border)] pt-4">
            <h3 id="opp-customer" class="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
              <app-icon name="user" [size]="16"></app-icon> Cliente
            </h3>
            @if (customerLoading()) {
              <div class="flex justify-center py-4"><app-spinner></app-spinner></div>
            } @else if (customerError(); as message) {
              <p class="text-sm text-[var(--color-text-secondary)]">{{ message }}</p>
            } @else if (customer(); as c) {
              <dl class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt class="text-xs text-[var(--color-text-muted)]">Nombre</dt>
                  <dd class="mt-0.5 font-medium">{{ customerName() }}</dd>
                </div>
                <div>
                  <dt class="text-xs text-[var(--color-text-muted)]">Documento</dt>
                  <dd class="mt-0.5 font-medium">{{ documentLabel() }}</dd>
                </div>
                <div>
                  <dt class="text-xs text-[var(--color-text-muted)]">Correo</dt>
                  <dd class="mt-0.5 break-all font-medium">{{ c.email || '—' }}</dd>
                </div>
                <div>
                  <dt class="text-xs text-[var(--color-text-muted)]">Teléfono</dt>
                  <dd class="mt-0.5 font-medium">{{ c.phone || '—' }}</dd>
                </div>
                <div class="sm:col-span-2">
                  <dt class="text-xs text-[var(--color-text-muted)]">Dirección</dt>
                  <dd class="mt-0.5 font-medium">{{ addressLabel() || '—' }}</dd>
                </div>
              </dl>
            } @else {
              <p class="text-sm text-[var(--color-text-secondary)]">Esta oportunidad no tiene cliente asociado.</p>
            }
            @if (customerId(); as id) {
              <a
                class="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
                [routerLink]="['/admin/customers', id]"
                (click)="isOpen.set(false)"
              >
                <app-icon name="external-link" [size]="14"></app-icon> Ver ficha del cliente
              </a>
            }
          </section>

          <!-- Notas -->
          @if (customerId()) {
            <section aria-labelledby="opp-notes" class="border-t border-[var(--color-border)] pt-4">
              <h3 id="opp-notes" class="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
                <app-icon name="sticky-note" [size]="16"></app-icon> Notas
              </h3>
              @if (canUpdateCustomer()) {
                <div class="mb-3 flex flex-col gap-2">
                  <textarea
                    class="min-h-[4.5rem] w-full rounded-lg border border-[var(--color-border)] bg-surface p-3 text-sm"
                    placeholder="Escribe una nota sobre este cliente..."
                    aria-label="Nueva nota"
                    maxlength="2000"
                    [ngModel]="noteDraft()"
                    (ngModelChange)="noteDraft.set($event)"
                  ></textarea>
                  <div class="flex justify-end">
                    <app-button
                      variant="outline"
                      size="sm"
                      [disabled]="!noteDraft().trim()"
                      [loading]="savingNote()"
                      (clicked)="addNote()"
                    >
                      Guardar nota
                    </app-button>
                  </div>
                </div>
              }
              @if (notesLoading()) {
                <div class="flex justify-center py-4"><app-spinner></app-spinner></div>
              } @else if (notesError(); as message) {
                <p class="text-sm text-[var(--color-text-secondary)]">{{ message }}</p>
              } @else {
                <ul class="flex flex-col gap-2" role="list">
                  @for (note of notes(); track note.id) {
                    <li class="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3">
                      <div class="mb-1 text-xs text-[var(--color-text-secondary)]">
                        {{ name(note.created_by) || 'Alguien del equipo' }} · {{ dateTime(note.created_at) }}
                      </div>
                      <p class="whitespace-pre-line text-sm text-[var(--color-text-primary)]">{{ note.body }}</p>
                    </li>
                  } @empty {
                    <li class="text-sm text-[var(--color-text-muted)]">Aún no hay notas.</li>
                  }
                </ul>
              }
            </section>

            <!-- Planilla de datos -->
            <section aria-labelledby="opp-sheet" class="border-t border-[var(--color-border)] pt-4">
              <h3 id="opp-sheet" class="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
                <app-icon name="clipboard-list" [size]="16"></app-icon> Planilla de datos
              </h3>
              <app-customer-data-sheet
                [customerId]="customerId()!"
                [editable]="canUpdateCustomer()"
                [compact]="true"
              ></app-customer-data-sheet>
            </section>
          }
        </div>
      }

      <div slot="footer" class="flex flex-wrap justify-end gap-3">
        <app-button variant="outline" size="md" (clicked)="isOpen.set(false)">Cerrar</app-button>
        @if (canManage()) {
          <app-button variant="danger" size="md" (clicked)="deleteRequested.emit()">
            <app-icon slot="icon" name="trash-2" [size]="16"></app-icon> Eliminar
          </app-button>
          <app-button variant="primary" size="md" (clicked)="editRequested.emit()">
            <app-icon slot="icon" name="pencil" [size]="16"></app-icon> Editar
          </app-button>
        }
      </div>
    </app-modal>
  `,
})
export class OpportunityDetailModalComponent {
  private readonly crm = inject(CrmService);
  private readonly customers = inject(CustomersService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthFacade);

  readonly isOpen = model(false);
  readonly opportunity = input<CrmOpportunity | null>(null);
  readonly canManage = input(false);
  readonly editRequested = output<void>();
  readonly deleteRequested = output<void>();

  protected readonly customer = signal<Customer | null>(null);
  protected readonly customerLoading = signal(false);
  protected readonly customerError = signal<string | null>(null);
  protected readonly notes = signal<CrmNote[]>([]);
  protected readonly notesLoading = signal(false);
  protected readonly notesError = signal<string | null>(null);
  protected readonly noteDraft = signal('');
  protected readonly savingNote = signal(false);

  protected readonly name = personName;
  protected readonly dateOnly = formatDateOnly;
  protected readonly dateTime = formatDateTime;
  protected readonly customerId = computed(() => this.opportunity()?.customer?.id ?? null);
  protected readonly canUpdateCustomer = computed(
    () => this.auth.isOwner() || this.auth.hasPermission('store:customers:update'),
  );
  protected readonly statusLabel = computed(() => {
    const o = this.opportunity();
    return o ? STATUS_LABELS[o.status] : '';
  });
  protected readonly stageColor = computed(() => {
    const stage = this.opportunity()?.stage;
    if (!stage) return 'var(--color-primary)';
    if (stage.color) return stage.color;
    if (stage.kind === 'won') return 'var(--color-success)';
    if (stage.kind === 'lost') return 'var(--color-error)';
    return 'var(--color-primary)';
  });
  protected readonly customerName = computed(() => {
    const c = this.customer();
    if (!c) return '';
    return c.legal_name || [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || '—';
  });
  protected readonly documentLabel = computed(() => {
    const c = this.customer();
    if (!c?.document_number) return '—';
    const dv = c.verification_digit ? `-${c.verification_digit}` : '';
    return [c.document_type, `${c.document_number}${dv}`].filter(Boolean).join(' ');
  });
  protected readonly addressLabel = computed(() => {
    const c = this.customer();
    const address = c?.billing_address ?? c?.addresses?.[0];
    if (!address) return '';
    return [address.address_line1, address.address_line2, address.city, address.state_province]
      .filter(Boolean)
      .join(', ');
  });

  private request = 0;

  constructor() {
    effect(() => {
      const open = this.isOpen();
      const id = this.customerId();
      untracked(() => {
        if (open && id) void this.loadCustomerContext(id);
      });
    });
  }

  async addNote(): Promise<void> {
    const id = this.customerId();
    const body = this.noteDraft().trim();
    if (!id || !body || this.savingNote()) return;
    this.savingNote.set(true);
    try {
      await firstValueFrom(this.crm.createNote(id, { body }));
      this.noteDraft.set('');
      this.notes.set(await firstValueFrom(this.crm.notes(id)));
      this.toast.success('Nota guardada');
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
    } finally {
      this.savingNote.set(false);
    }
  }

  private async loadCustomerContext(id: number): Promise<void> {
    const request = ++this.request;
    this.customer.set(null);
    this.notes.set([]);
    this.customerError.set(null);
    this.notesError.set(null);
    this.customerLoading.set(true);
    this.notesLoading.set(true);

    const loadCustomer = async () => {
      try {
        const customer = await firstValueFrom(this.customers.getCustomer(id));
        if (request === this.request) this.customer.set(customer);
      } catch (error) {
        if (request !== this.request) return;
        this.customerError.set(
          (error as { status?: number })?.status === 403
            ? NO_CUSTOMER_PERMISSION
            : parseApiError(error).userMessage,
        );
      } finally {
        if (request === this.request) this.customerLoading.set(false);
      }
    };
    const loadNotes = async () => {
      try {
        const notes = await firstValueFrom(this.crm.notes(id));
        if (request === this.request) this.notes.set(notes);
      } catch (error) {
        if (request !== this.request) return;
        this.notesError.set(
          (error as { status?: number })?.status === 403
            ? 'No tienes permiso para ver las notas del cliente.'
            : parseApiError(error).userMessage,
        );
      } finally {
        if (request === this.request) this.notesLoading.set(false);
      }
    };
    await Promise.all([loadCustomer(), loadNotes()]);
  }
}

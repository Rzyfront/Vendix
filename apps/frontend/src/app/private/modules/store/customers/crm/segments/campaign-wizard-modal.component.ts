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
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { CrmSegmentsService } from '../shared/crm-segments.service';
import {
  CampaignChannel,
  CampaignContentInput,
  CampaignEstimate,
  CrmCampaign,
  CrmSegment,
} from '../shared/crm-segments.interface';
import { fromLocalInput } from '../shared/crm.utils';
import {
  CAMPAIGN_CHANNEL_ICONS,
  CAMPAIGN_CHANNEL_LABELS,
  CAMPAIGN_PLACEHOLDERS,
  formatUsd,
} from './segments.utils';

type WizardStep = 'content' | 'review';

const CHANNELS: CampaignChannel[] = ['whatsapp', 'sms', 'email'];
const MAX_VARIABLES = 10;
const SMS_MAX = 1000;

/**
 * New campaign over a segment: channel and content, optional schedule, then a
 * review with recipients, exclusions and the USD cost that the owner must
 * confirm. The API recomputes the estimate on send and answers
 * CRM_CAMPAIGN_003 when it changed: the new cost is shown for a new
 * confirmation.
 */
@Component({
  selector: 'app-crm-campaign-wizard-modal',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    IconComponent,
    InputComponent,
    ModalComponent,
    TextareaComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      title="Nueva campaña"
      [subtitle]="segment() ? 'Segmento: ' + segment()!.name : ''"
      size="lg"
      [fullScreenOnMobile]="true"
    >
      @if (isOpen()) {
        <ol class="mb-4 flex items-center gap-2 text-xs font-semibold" aria-label="Pasos">
          <li [class]="step() === 'content' ? 'text-primary' : 'text-[var(--color-text-muted)]'">1. Contenido</li>
          <li aria-hidden="true">›</li>
          <li [class]="step() === 'review' ? 'text-primary' : 'text-[var(--color-text-muted)]'">2. Revisión y costo</li>
        </ol>

        @if (step() === 'content') {
          <div class="flex flex-col gap-4">
            <app-input
              label="Nombre de la campaña"
              placeholder="Ej.: Recompra de noviembre"
              [maxlength]="120"
              [ngModel]="name()"
              (ngModelChange)="name.set($event)"
            ></app-input>

            <div class="flex flex-col gap-1">
              <span class="text-sm font-medium text-[var(--color-text-primary)]">Canal</span>
              <div class="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Canal">
                @for (option of channels; track option) {
                  <button
                    type="button"
                    role="radio"
                    class="flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium"
                    [class]="
                      channel() === option
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-[var(--color-border)] bg-surface text-[var(--color-text-secondary)]'
                    "
                    [attr.aria-checked]="channel() === option"
                    (click)="channel.set(option)"
                  >
                    <app-icon [name]="icons[option]" [size]="16"></app-icon>
                    {{ labels[option] }}
                  </button>
                }
              </div>
            </div>

            @switch (channel()) {
              @case ('whatsapp') {
                <div class="flex flex-col gap-3 rounded-2xl border border-[var(--color-border)] p-3">
                  <p class="text-xs text-[var(--color-text-secondary)]">
                    WhatsApp solo permite plantillas de marketing aprobadas en tu cuenta de Meta, y solo
                    a clientes que aceptaron recibirlas.
                  </p>
                  <div class="grid gap-3 sm:grid-cols-3">
                    <div class="sm:col-span-2">
                      <app-input
                        label="Nombre de la plantilla"
                        placeholder="oferta_noviembre"
                        [maxlength]="120"
                        [ngModel]="templateName()"
                        (ngModelChange)="templateName.set($event)"
                      ></app-input>
                    </div>
                    <app-input
                      label="Idioma"
                      placeholder="es"
                      [maxlength]="10"
                      [ngModel]="templateLanguage()"
                      (ngModelChange)="templateLanguage.set($event)"
                    ></app-input>
                  </div>
                  @for (variable of variables(); track $index) {
                    <div class="flex items-end gap-2">
                      <div class="flex-1">
                        <app-input
                          [label]="'Variable ' + ($index + 1)"
                          placeholder="Ej.: {first_name}"
                          [maxlength]="200"
                          [ngModel]="variable"
                          (ngModelChange)="setVariable($index, $event)"
                        ></app-input>
                      </div>
                      <button
                        type="button"
                        class="mb-1 inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-border)]"
                        [attr.aria-label]="'Quitar variable ' + ($index + 1)"
                        (click)="removeVariable($index)"
                      >
                        <app-icon name="x" [size]="16"></app-icon>
                      </button>
                    </div>
                  }
                  <div>
                    <app-button
                      variant="outline"
                      size="sm"
                      [disabled]="variables().length >= maxVariables"
                      (clicked)="addVariable()"
                    >
                      <app-icon name="plus" [size]="14" slot="icon"></app-icon>
                      Agregar variable
                    </app-button>
                  </div>
                </div>
              }
              @case ('sms') {
                <div class="flex flex-col gap-1">
                  <app-textarea
                    label="Mensaje"
                    [rows]="4"
                    placeholder="Hola {first_name}, en {store_name} tenemos una oferta para ti."
                    [ngModel]="body()"
                    (ngModelChange)="setBody($event)"
                  ></app-textarea>
                  <span class="text-xs text-[var(--color-text-muted)]">{{ body().length }} / {{ smsMax }} caracteres</span>
                </div>
              }
              @case ('email') {
                <app-input
                  label="Asunto"
                  [maxlength]="200"
                  [ngModel]="subject()"
                  (ngModelChange)="subject.set($event)"
                ></app-input>
                <app-textarea
                  label="Mensaje"
                  [rows]="6"
                  placeholder="Hola {first_name}, ..."
                  [ngModel]="body()"
                  (ngModelChange)="setBody($event)"
                ></app-textarea>
              }
            }

            @if (channel() !== 'whatsapp') {
              <div class="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                <span>Marcadores:</span>
                @for (placeholder of placeholders; track placeholder) {
                  <button
                    type="button"
                    class="rounded-full border border-[var(--color-border)] bg-surface px-2 py-0.5"
                    (click)="insertPlaceholder(placeholder)"
                  >
                    {{ placeholder }}
                  </button>
                }
              </div>
            } @else {
              <p class="text-xs text-[var(--color-text-secondary)]">
                Las variables aceptan los marcadores {{ placeholders.join(', ') }}.
              </p>
            }

            <app-input
              label="Programar envío (opcional)"
              type="datetime-local"
              helperText="Déjalo vacío para enviar apenas confirmes el costo."
              [ngModel]="scheduledAt()"
              (ngModelChange)="scheduledAt.set($event)"
            ></app-input>
            @if (scheduleError()) {
              <p class="text-sm text-[var(--color-error)]">{{ scheduleError() }}</p>
            }
          </div>
        } @else {
          <div class="flex flex-col gap-4">
            @if (estimate(); as est) {
              <div class="grid gap-3 sm:grid-cols-2">
                <div class="rounded-2xl border border-[var(--color-border)] p-3">
                  <p class="text-xs text-[var(--color-text-secondary)]">Destinatarios</p>
                  <p class="text-2xl font-semibold text-[var(--color-text-primary)]">{{ est.recipients }}</p>
                  <p class="text-xs text-[var(--color-text-muted)]">de {{ est.segment_total }} en el segmento</p>
                </div>
                <div class="rounded-2xl border border-[var(--color-border)] p-3">
                  <p class="text-xs text-[var(--color-text-secondary)]">Costo estimado</p>
                  <p class="text-2xl font-semibold text-[var(--color-text-primary)]">{{ usd(est.estimated_cost) }}</p>
                  <p class="text-xs text-[var(--color-text-muted)]">
                    @if (est.channel === 'sms' && est.spend_remaining !== null) {
                      Saldo del tope de SMS: {{ usd(est.spend_remaining) }}
                    } @else if (est.channel === 'sms') {
                      Sin tope de SMS definido
                    } @else {
                      Valor en dólares (USD)
                    }
                  </p>
                </div>
              </div>

              <ul class="flex flex-col gap-1 text-sm text-[var(--color-text-secondary)]" role="list">
                <li>Excluidos por consentimiento: <strong>{{ est.excluded_no_consent }}</strong></li>
                <li>Excluidos sin {{ est.channel === 'email' ? 'correo' : 'teléfono' }}: <strong>{{ est.excluded_no_address }}</strong></li>
                <li>Excluidos por duplicado: <strong>{{ est.excluded_duplicate }}</strong></li>
              </ul>

              @if (est.recipients === 0) {
                <p class="rounded-xl bg-[var(--color-error)]/10 p-3 text-sm text-[var(--color-error)]" role="alert">
                  Ningún cliente del segmento puede recibir esta campaña.
                </p>
              }
              @if (est.exceeds_max_recipients) {
                <p class="rounded-xl bg-[var(--color-error)]/10 p-3 text-sm text-[var(--color-error)]" role="alert">
                  La campaña supera el máximo de {{ est.max_recipients }} destinatarios por envío. Acota el segmento.
                </p>
              }
              @if (est.exceeds_spend_limit) {
                <p class="rounded-xl bg-[var(--color-error)]/10 p-3 text-sm text-[var(--color-error)]" role="alert">
                  El costo supera lo que queda del tope mensual de SMS. Sube el tope en Integraciones → Canales o reduce el segmento.
                </p>
              }
              @if (est.channel === 'whatsapp' && est.template_verified === null) {
                <p class="rounded-xl bg-[var(--color-warning)]/10 p-3 text-sm text-[var(--color-text-primary)]">
                  No pudimos verificar la plantilla en tu cuenta; Meta la validará al enviar.
                </p>
              }
              @if (costChanged()) {
                <p class="rounded-xl bg-[var(--color-warning)]/10 p-3 text-sm text-[var(--color-text-primary)]" role="alert">
                  El costo cambió desde tu última revisión. Revisa la nueva estimación y vuelve a confirmarla.
                </p>
              }

              <label class="flex items-start gap-2 text-sm text-[var(--color-text-primary)]">
                <input
                  type="checkbox"
                  class="mt-1 h-4 w-4 accent-[var(--color-primary)]"
                  [disabled]="!canSend()"
                  [ngModel]="confirmed()"
                  (ngModelChange)="confirmed.set($event)"
                />
                <span>Confirmo el costo estimado de <strong>{{ usd(est.estimated_cost) }}</strong> para {{ est.recipients }} destinatarios.</span>
              </label>
            }
          </div>
        }

        @if (error()) {
          <p class="mt-3 text-sm text-[var(--color-error)]" role="alert">{{ error() }}</p>
        }
      }

      <div slot="footer" class="flex flex-wrap justify-end gap-3">
        @if (step() === 'content') {
          <app-button variant="outline" size="md" (clicked)="isOpen.set(false)">Cancelar</app-button>
          <app-button
            variant="primary"
            size="md"
            [disabled]="!contentValid()"
            [loading]="busy()"
            (clicked)="goToReview()"
          >
            Estimar costo
          </app-button>
        } @else {
          @if (draftId()) {
            <app-button variant="outline" size="md" [disabled]="busy()" (clicked)="discard()">Descartar campaña</app-button>
          } @else {
            <app-button variant="outline" size="md" [disabled]="busy()" (clicked)="step.set('content')">Volver</app-button>
          }
          @if (!draftId()) {
            <app-button variant="outline" size="md" [disabled]="busy() || !canSend()" (clicked)="saveDraft()">
              Guardar borrador
            </app-button>
          }
          <app-button
            variant="primary"
            size="md"
            [disabled]="!confirmed() || !canSend()"
            [loading]="busy()"
            (clicked)="confirmAndSend()"
          >
            {{ scheduledAt() ? 'Programar envío' : 'Enviar ahora' }}
          </app-button>
        }
      </div>
    </app-modal>
  `,
})
export class CampaignWizardModalComponent {
  private readonly api = inject(CrmSegmentsService);
  private readonly toast = inject(ToastService);

  readonly isOpen = model(false);
  readonly segment = input<CrmSegment | null>(null);
  /** Emits the campaign once created (as draft, scheduled or sending). */
  readonly created = output<CrmCampaign>();

  protected readonly channels = CHANNELS;
  protected readonly labels = CAMPAIGN_CHANNEL_LABELS;
  protected readonly icons = CAMPAIGN_CHANNEL_ICONS;
  protected readonly placeholders = CAMPAIGN_PLACEHOLDERS;
  protected readonly maxVariables = MAX_VARIABLES;
  protected readonly smsMax = SMS_MAX;
  protected readonly usd = formatUsd;

  protected readonly step = signal<WizardStep>('content');
  protected readonly name = signal('');
  protected readonly channel = signal<CampaignChannel>('whatsapp');
  protected readonly templateName = signal('');
  protected readonly templateLanguage = signal('es');
  protected readonly variables = signal<string[]>([]);
  protected readonly body = signal('');
  protected readonly subject = signal('');
  protected readonly scheduledAt = signal('');

  protected readonly estimate = signal<CampaignEstimate | null>(null);
  protected readonly confirmed = signal(false);
  protected readonly costChanged = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Campaign already created in this session: content is locked. */
  protected readonly draftId = signal<number | null>(null);

  protected readonly scheduleError = computed(() => {
    const value = this.scheduledAt();
    if (!value) return null;
    const iso = fromLocalInput(value);
    return !iso || new Date(iso).getTime() <= Date.now()
      ? 'La fecha de programación debe ser futura.'
      : null;
  });

  protected readonly contentValid = computed(() => {
    if (!this.name().trim() || this.scheduleError()) return false;
    switch (this.channel()) {
      case 'whatsapp':
        return /^[a-z0-9_]+$/.test(this.templateName().trim()) && !!this.templateLanguage().trim();
      case 'sms':
        return !!this.body().trim();
      case 'email':
        return !!this.subject().trim() && !!this.body().trim();
    }
  });

  /** The send button needs at least one recipient and no blocking limit. */
  protected readonly canSend = computed(() => {
    const est = this.estimate();
    return !!est && est.recipients > 0 && !est.exceeds_max_recipients && !est.exceeds_spend_limit;
  });

  constructor() {
    effect(() => {
      if (!this.isOpen()) return;
      this.segment();
      untracked(() => this.reset());
    });
    // A previous error does not apply to another channel.
    effect(() => {
      this.channel();
      untracked(() => this.error.set(null));
    });
  }

  protected setVariable(index: number, value: string): void {
    this.variables.update((list) => list.map((item, i) => (i === index ? value : item)));
  }

  protected addVariable(): void {
    this.variables.update((list) => (list.length < MAX_VARIABLES ? [...list, ''] : list));
  }

  protected removeVariable(index: number): void {
    this.variables.update((list) => list.filter((_, i) => i !== index));
  }

  protected setBody(value: string): void {
    this.body.set((value ?? '').slice(0, this.bodyLimit()));
  }

  private bodyLimit(): number {
    return this.channel() === 'sms' ? SMS_MAX : 5000;
  }

  protected insertPlaceholder(placeholder: string): void {
    this.body.update((text) => (text + placeholder).slice(0, this.bodyLimit()));
  }

  async goToReview(): Promise<void> {
    if (!this.contentValid() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const estimate = await firstValueFrom(this.api.estimateCampaign(this.content()));
      this.estimate.set(estimate);
      this.confirmed.set(false);
      this.costChanged.set(false);
      this.step.set('review');
    } catch (error) {
      this.error.set(parseApiError(error).userMessage);
    } finally {
      this.busy.set(false);
    }
  }

  async saveDraft(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const campaign = await this.createDraft();
      if (!campaign) return;
      this.toast.success('Campaña guardada como borrador');
      this.created.emit(campaign);
      this.isOpen.set(false);
    } catch (error) {
      this.error.set(parseApiError(error).userMessage);
    } finally {
      this.busy.set(false);
    }
  }

  async confirmAndSend(): Promise<void> {
    const confirmedCost = this.estimate()?.estimated_cost;
    if (!this.confirmed() || confirmedCost === undefined || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const campaign = await this.createDraft();
      if (!campaign) return;
      // Creating re-estimated: if the cost moved, ask again before sending.
      if (this.draftCostChanged(confirmedCost)) return;
      const sent = await firstValueFrom(this.api.sendCampaign(campaign.id, confirmedCost));
      this.toast.success(sent.status === 'scheduled' ? 'Campaña programada' : 'Envío iniciado');
      this.created.emit(sent);
      this.isOpen.set(false);
    } catch (error) {
      const parsed = parseApiError(error);
      const fresh = (parsed.details as { estimated_cost?: unknown } | null)?.estimated_cost;
      if (parsed.errorCode === 'CRM_CAMPAIGN_003' && typeof fresh === 'number') {
        this.estimate.update((est) => (est ? { ...est, estimated_cost: fresh } : est));
        this.confirmed.set(false);
        this.costChanged.set(true);
      } else {
        this.error.set(parsed.userMessage);
      }
    } finally {
      this.busy.set(false);
    }
  }

  async discard(): Promise<void> {
    const id = this.draftId();
    if (!id || this.busy()) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.cancelCampaign(id));
      this.toast.success('Campaña descartada');
      this.draftId.set(null);
      this.isOpen.set(false);
    } catch (error) {
      this.error.set(parseApiError(error).userMessage);
    } finally {
      this.busy.set(false);
    }
  }

  private lastCreated: CrmCampaign | null = null;
  private lastCreatedEstimate: CampaignEstimate | null = null;

  /** Creates the campaign once; later attempts reuse it. */
  private async createDraft(): Promise<CrmCampaign | null> {
    if (this.lastCreated) return this.lastCreated;
    const segment = this.segment();
    if (!segment) return null;
    const scheduled = fromLocalInput(this.scheduledAt());
    const created = await firstValueFrom(
      this.api.createCampaign({
        ...this.content(),
        name: this.name().trim(),
        ...(scheduled ? { scheduled_at: scheduled } : {}),
      }),
    );
    this.lastCreated = created;
    this.lastCreatedEstimate = created.estimate;
    this.draftId.set(created.id);
    return created;
  }

  /** True (and asks for a new confirmation) when the created campaign re-estimated a different cost. */
  private draftCostChanged(confirmedCost: number): boolean {
    const fresh = this.lastCreatedEstimate;
    this.lastCreatedEstimate = null;
    if (!fresh || Math.abs(fresh.estimated_cost - confirmedCost) <= 0.00005) return false;
    this.estimate.set(fresh);
    this.confirmed.set(false);
    this.costChanged.set(true);
    return true;
  }

  private content(): CampaignContentInput {
    const segmentId = this.segment()?.id ?? 0;
    const channel = this.channel();
    if (channel === 'whatsapp') {
      const variables = this.variables().map((v) => v.trim()).filter(Boolean);
      return {
        segment_id: segmentId,
        channel,
        template: {
          name: this.templateName().trim(),
          language: this.templateLanguage().trim(),
          ...(variables.length ? { variables } : {}),
        },
      };
    }
    return {
      segment_id: segmentId,
      channel,
      body: this.body().trim(),
      ...(channel === 'email' ? { subject: this.subject().trim() } : {}),
    };
  }

  private reset(): void {
    this.step.set('content');
    this.name.set('');
    this.channel.set('whatsapp');
    this.templateName.set('');
    this.templateLanguage.set('es');
    this.variables.set([]);
    this.body.set('');
    this.subject.set('');
    this.scheduledAt.set('');
    this.estimate.set(null);
    this.confirmed.set(false);
    this.costChanged.set(false);
    this.error.set(null);
    this.draftId.set(null);
    this.lastCreated = null;
    this.lastCreatedEstimate = null;
  }
}

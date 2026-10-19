import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  untracked,
} from '@angular/core';
import type { VexiProposal } from '../../../core/store/vexi/vexi.actions';
import { VexiVoiceConsentService } from '../../../core/services/vexi-voice-consent.service';
import {
  VoiceConsentApplied,
  VoiceConsentContext,
  voiceProposalIdentity,
} from '../../../core/services/vexi-voice-consent.model';

@Component({
  selector: 'app-vexi-voice-consent',
  standalone: true,
  providers: [VexiVoiceConsentService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (consent.enabled()) {
      <section
        class="voice-consent"
        aria-label="Consentimiento hablado dedicado"
      >
        @if (!consent.challenge()) {
          <button
            type="button"
            (click)="prepare()"
            [disabled]="
              proposal().applying ||
              consent.state() === 'preparing' ||
              consent.state() === 'submitting'
            "
          >
            Escuchar acción y obtener código de voz
          </button>
        } @else {
          <p>Para esta acción, di exactamente:</p>
          <strong class="voice-consent__phrase">{{
            consent.challenge()?.expected_phrase
          }}</strong>
          <p>
            El código vence en menos de un minuto. Un «sí» o el dictado normal
            no aprueban.
          </p>
          <button
            type="button"
            (pointerdown)="start($event)"
            (pointerup)="release($event)"
            (pointercancel)="
              consent.cancel(
                'Captura cancelada. Solicita otro código o usa Aprobar.'
              )
            "
            (keydown.space)="start($event)"
            (keyup.space)="release($event)"
            (keydown.enter)="start($event)"
            (keyup.enter)="release($event)"
            (blur)="captureBlur()"
            [disabled]="
              consent.state() !== 'ready' && consent.state() !== 'recording'
            "
            [attr.aria-pressed]="consent.state() === 'recording'"
          >
            {{
              consent.state() === 'recording'
                ? 'Suelta para enviar consentimiento'
                : 'Mantén para confirmar por voz'
            }}
          </button>
          <button
            type="button"
            (click)="consent.cancel('Código cancelado. Puedes usar Aprobar.')"
          >
            Cancelar código
          </button>
        }
        @if (consent.message()) {
          <p role="status">{{ consent.message() }}</p>
        }
      </section>
    }
  `,
  styles: [
    `
      .voice-consent {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding-top: 8px;
        color: var(--color-text-primary);
      }
      p {
        margin: 0;
        font-size: 0.8rem;
        line-height: 1.5;
      }
      .voice-consent__phrase {
        overflow-wrap: anywhere;
        font-size: 0.9rem;
      }
      button {
        min-height: 44px;
        border: 1px solid var(--color-border);
        border-radius: 10px;
        padding: 8px 12px;
        background: var(--color-surface);
        color: var(--color-text-primary);
        touch-action: none;
      }
      button:disabled {
        opacity: 0.5;
      }
      button:focus-visible {
        outline: 2px solid var(--color-primary);
        outline-offset: 2px;
      }
    `,
  ],
})
export class VexiVoiceConsentComponent {
  protected readonly consent = inject(VexiVoiceConsentService);
  private readonly destroyRef = inject(DestroyRef);
  readonly proposal = input.required<VexiProposal>();
  readonly context = input.required<VoiceConsentContext>();
  readonly applied = output<VoiceConsentApplied>();
  readonly busy = output<boolean>();
  private identity = '';
  constructor() {
    void this.consent.loadCapability();
    effect(() => {
      const identity = voiceProposalIdentity(this.proposal(), this.context());
      if (identity !== this.identity) {
        this.identity = identity;
        untracked(() => this.consent.cancel());
      }
    });
    effect(() => this.busy.emit(this.consent.state() === 'submitting'));
  }
  cancelForClick(): void {
    this.consent.cancel('', false);
  }
  protected prepare(): void {
    void this.consent.prepare(this.proposal(), this.context(), (result) => {
      if (!this.destroyRef.destroyed) this.applied.emit(result);
    });
  }
  protected start(event: Event): void {
    event.preventDefault();
    if ((event as KeyboardEvent).repeat) return;
    const pointer = event as PointerEvent;
    if (pointer.pointerId !== undefined)
      (event.currentTarget as HTMLElement).setPointerCapture?.(
        pointer.pointerId,
      );
    void this.consent.startCapture();
  }
  protected release(event: Event): void {
    event.preventDefault();
    void this.consent.releaseCapture();
  }
  protected captureBlur(): void {
    if (this.consent.state() === 'recording')
      this.consent.cancel(
        'La captura perdió el foco. Usa un código nuevo o Aprobar.',
      );
  }
}

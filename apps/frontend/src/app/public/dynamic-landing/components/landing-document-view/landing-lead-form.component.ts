import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { IconComponent } from '../../../../shared/components/icon/icon.component';
import type { CrmContactPayload } from '../../services/crm-landing.service';

/** Sending state the page owns (it knows which endpoint receives the lead). */
export interface LandingLeadState {
  sending: boolean;
  submitted: boolean;
  /** Server error to show; the form's own validation errors live here. */
  error: string;
}

export const IDLE_LEAD_STATE: LandingLeadState = { sending: false, submitted: false, error: '' };

/**
 * The landing lead form (former `#contactForm` template of
 * `StoreLandingComponent`). It validates and emits a valid payload; the page
 * sends it. `inert` draws it exactly the same for the editor preview, where
 * nothing is sent.
 */
@Component({
  selector: 'app-landing-lead-form',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="contacto" class="crm-contact-section max-w-xl mx-auto px-4 pb-20">
      <div class="crm-contact-card bg-white rounded-3xl p-7 sm:p-9 border border-slate-200/90 shadow-xl">
        <h3 class="text-xl font-bold text-slate-900 text-center mb-1.5">Envíanos un mensaje directo</h3>
        <p class="text-xs sm:text-sm text-slate-500 text-center mb-6">Déjanos tus datos y un asesor se pondrá en contacto contigo en breve.</p>

        <div class="space-y-4">
          <div>
            <label class="block text-xs font-semibold text-slate-700 mb-1.5">Nombre completo *</label>
            <input class="crm-field" type="text" placeholder="Tu nombre completo" maxlength="80"
                   [value]="name()" (input)="name.set(value($event))" />
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label class="block text-xs font-semibold text-slate-700 mb-1.5">Correo electrónico</label>
              <input class="crm-field" type="email" placeholder="nombre@ejemplo.com" maxlength="160"
                     [value]="email()" (input)="email.set(value($event))" />
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-700 mb-1.5">Teléfono / WhatsApp</label>
              <input class="crm-field" type="tel" placeholder="Ej. 300 123 4567" maxlength="30"
                     [value]="phone()" (input)="phone.set(value($event))" />
            </div>
          </div>

          <div>
            <label class="block text-xs font-semibold text-slate-700 mb-1.5">¿En qué podemos ayudarte? *</label>
            <textarea class="crm-field" rows="4" placeholder="Escribe aquí tu consulta o los productos de tu interés…" maxlength="1000"
                      [value]="message()" (input)="message.set(value($event))"></textarea>
          </div>

          @if (state().submitted) {
            <div class="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium text-center flex items-center justify-center gap-2">
              <app-icon name="check-circle" [size]="18" color="#059669" />
              <span>¡Gracias! Tu mensaje fue enviado con éxito. Te responderemos muy pronto.</span>
            </div>
          } @else {
            @if (shownError()) {
              <p class="crm-form-error text-center text-xs text-rose-600 font-semibold">{{ shownError() }}</p>
            }
            <button type="button"
                    class="crm-submit-btn w-full py-3.5 px-6 rounded-full text-white font-bold text-sm shadow-md transition-all duration-200 cursor-pointer flex items-center justify-center gap-2"
                    [disabled]="state().sending" (click)="submit()">
              @if (state().sending) {
                <app-icon name="loader" [size]="16" [spin]="true" color="white" />
                <span>Enviando mensaje…</span>
              } @else {
                <app-icon name="mail" [size]="16" color="white" />
                <span>Enviar mensaje</span>
              }
            </button>
          }
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      .crm-contact-section { margin: 0 auto; }
      .crm-contact-card { background: #ffffff; }
      .crm-field {
        width: 100%;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 11px 14px;
        font-size: 0.9rem;
        font-family: inherit;
        background: #f8fafc;
        box-sizing: border-box;
        transition: border-color 0.2s, background-color 0.2s, box-shadow 0.2s;
      }
      .crm-field:focus {
        outline: none;
        background: #ffffff;
        border-color: var(--crm-primary, #2563eb);
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
      }
      textarea.crm-field { resize: vertical; }
      .crm-submit-btn { background: var(--crm-primary, #2563eb); }
      .crm-submit-btn:hover:not(:disabled) {
        filter: brightness(1.08);
        transform: translateY(-1px);
        box-shadow: 0 10px 15px -3px rgba(37, 99, 235, 0.3);
      }
      .crm-submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    `,
  ],
})
export class LandingLeadFormComponent {
  readonly state = input<LandingLeadState>(IDLE_LEAD_STATE);
  /** Editor preview: validates like the public form but never emits. */
  readonly inert = input(false);
  readonly send = output<CrmContactPayload>();

  readonly name = signal('');
  readonly email = signal('');
  readonly phone = signal('');
  readonly message = signal('');
  private readonly validationError = signal('');

  /** A validation error wins over the last server error. */
  readonly shownError = computed(() => this.validationError() || this.state().error);

  value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  submit(): void {
    const name = this.name().trim();
    const message = this.message().trim();
    const email = this.email().trim();
    const phone = this.phone().trim();

    if (!name || !message) {
      this.validationError.set('Cuéntanos tu nombre y qué necesitas.');
      return;
    }
    if (!email && !phone) {
      this.validationError.set('Déjanos tu correo o tu teléfono para responderte.');
      return;
    }
    this.validationError.set('');
    if (this.inert()) {
      this.validationError.set('Vista previa: el formulario se envía en la página publicada.');
      return;
    }
    this.send.emit({
      first_name: name,
      message,
      ...(email && { email }),
      ...(phone && { phone }),
    });
  }
}

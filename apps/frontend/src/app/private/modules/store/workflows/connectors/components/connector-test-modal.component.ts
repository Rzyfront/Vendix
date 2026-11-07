import { Component, DestroyRef, effect, inject, input, model, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AlertBannerComponent,
  ButtonComponent,
  InputComponent,
  ModalComponent,
} from '../../../../../../shared/components/index';
import { toWorkflowError } from '../../utils/workflow-errors.util';
import {
  ConnectorTestResult,
  ConnectorView,
  WhatsappTestBody,
} from '../interfaces/connectors.interfaces';
import { ConnectorsApiService } from '../services/connectors-api.service';

/** "Probar" modal: runs the real test of a connector and shows what came back. */
@Component({
  selector: 'app-connector-test-modal',
  standalone: true,
  imports: [FormsModule, ModalComponent, ButtonComponent, InputComponent, AlertBannerComponent],
  template: `
    <app-modal [(isOpen)]="isOpen" [title]="'Probar ' + (connector()?.label ?? 'conector')" size="md">
      <div class="flex flex-col gap-4">
        @switch (connector()?.key) {
          @case ('email_out') {
            <p class="text-sm text-text-secondary">
              Enviamos un correo de prueba, con el diseño de tu tienda, a tu propio correo de
              usuario. Confirma que quieres enviarlo.
            </p>
          }
          @case ('whatsapp') {
            <p class="text-sm text-text-secondary">
              Se envía una plantilla aprobada por el canal de WhatsApp de tu tienda. Usa un número
              tuyo: el mensaje sale de verdad.
            </p>
            <app-input
              label="Teléfono (con indicativo)"
              [required]="true"
              placeholder="+57 300 123 4567"
              [ngModel]="phone()"
              (ngModelChange)="phone.set($event)"
            />
            <app-input
              label="Plantilla aprobada"
              [required]="true"
              placeholder="nombre_de_la_plantilla"
              helperText="Minúsculas, números y guion bajo, como en Meta."
              [ngModel]="template()"
              (ngModelChange)="template.set($event)"
            />
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <app-input
                label="Idioma"
                placeholder="es"
                [ngModel]="language()"
                (ngModelChange)="language.set($event)"
              />
              <app-input
                label="Parámetros"
                placeholder="Ana|Pedido 12"
                helperText="Separados por |"
                [ngModel]="params()"
                (ngModelChange)="params.set($event)"
              />
            </div>
          }
          @case ('dian') {
            <p class="text-sm text-text-secondary">
              Revisa la habilitación, el certificado y la resolución de facturación. No emite ninguna
              factura.
            </p>
          }
        }

        @if (errorMessage()) {
          <app-alert-banner variant="danger" icon="alert-circle">{{ errorMessage() }}</app-alert-banner>
        }

        @if (result(); as r) {
          <div role="status" class="flex flex-col gap-2">
            <app-alert-banner [variant]="r.ok ? 'success' : 'danger'" [icon]="r.ok ? 'check-circle' : 'alert-triangle'">
              {{ r.message }}
            </app-alert-banner>
            @if (r.simulated) {
              <p class="text-xs text-text-secondary">
                El servidor está en modo de pruebas y no entrega mensajes reales.
              </p>
            }
            @if (r.checks?.length) {
              <ul class="flex flex-col gap-1 text-sm">
                @for (check of r.checks; track check.key) {
                  <li class="flex items-start gap-2">
                    <span [class]="check.ok ? 'text-success' : 'text-error'" aria-hidden="true">
                      {{ check.ok ? '✓' : '✗' }}
                    </span>
                    <span class="text-text-primary">
                      {{ check.ok ? okLabel(check.key) : check.message }}
                    </span>
                  </li>
                }
              </ul>
            }
          </div>
        }
      </div>
      <div slot="footer" class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <app-button variant="outline" (clicked)="isOpen.set(false)">Cerrar</app-button>
        <app-button variant="primary" [loading]="busy()" [disabled]="!canRun()" (clicked)="run()">
          {{ runLabel() }}
        </app-button>
      </div>
    </app-modal>
  `,
})
export class ConnectorTestModalComponent {
  private readonly api = inject(ConnectorsApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model<boolean>(false);
  readonly connector = input<ConnectorView | null>(null);

  readonly phone = signal('');
  readonly template = signal('');
  readonly language = signal('es');
  readonly params = signal('');
  readonly busy = signal(false);
  readonly result = signal<ConnectorTestResult | null>(null);
  readonly errorMessage = signal('');

  constructor() {
    effect(() => {
      if (!this.isOpen()) return;
      untracked(() => {
        this.result.set(null);
        this.errorMessage.set('');
        this.busy.set(false);
      });
    });
  }

  canRun(): boolean {
    if (this.busy() || !this.connector()) return false;
    if (this.connector()?.key === 'whatsapp') {
      return this.phone().trim().length > 0 && this.template().trim().length > 0;
    }
    return true;
  }

  runLabel(): string {
    switch (this.connector()?.key) {
      case 'email_out':
        return 'Enviar correo de prueba';
      case 'whatsapp':
        return 'Enviar plantilla';
      default:
        return 'Revisar';
    }
  }

  okLabel(check: string): string {
    switch (check) {
      case 'enablement':
        return 'La DIAN habilitó la facturación.';
      case 'certificate':
        return 'El certificado digital está vigente.';
      case 'resolution':
        return 'Hay una resolución vigente con consecutivos.';
      default:
        return 'Correcto.';
    }
  }

  run(): void {
    const connector = this.connector();
    if (!connector || !this.canRun()) return;
    let body: WhatsappTestBody | undefined;
    if (connector.key === 'whatsapp') {
      const language = this.language().trim();
      const params = this.params().trim();
      body = {
        to: this.phone().trim(),
        template: this.template().trim(),
        ...(language ? { language } : {}),
        ...(params ? { params } : {}),
      };
    }
    this.busy.set(true);
    this.result.set(null);
    this.errorMessage.set('');
    this.api
      .test(connector.key, body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.busy.set(false);
          this.result.set(res);
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.errorMessage.set(toWorkflowError(error).message);
        },
      });
  }
}

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  ButtonComponent,
  DialogService,
  IconComponent,
  InputComponent,
  ModalComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { injectFocusFirstField } from '../../../shared/focus-first-field';
import { TraSummary, TraTestResult } from '../../interfaces/tra.interface';
import { LodgingTraService } from '../../services/lodging-tra.service';

/** Where the MinCIT sends the token to the RNT email. */
export const TRA_TOKEN_URL = 'https://pms.mincit.gov.co/token/';

/**
 * Hospitality Suite (H4.1) — "Token TRA": request it from the MinCIT, paste
 * it and test the connection. The token is stored encrypted; only its last
 * four characters come back.
 */
@Component({
  selector: 'app-tra-token-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, ModalComponent, InputComponent, ButtonComponent, IconComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="!$event && close()"
      (cancel)="close()"
      [canClose]="canClose"
      (opened)="reset(); focusFirstField()"
      [size]="'md'"
      [dialog]="true"
      title="Token TRA"
      subtitle="Conexión con la Tarjeta de Registro de Alojamiento del MinCIT"
    >
      <form id="tra-token-form" class="space-y-4" novalidate (ngSubmit)="onSubmit()">
        <ol class="list-decimal space-y-1 pl-5 text-sm text-text-secondary">
          <li>
            <a
              [href]="tokenUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="font-medium text-primary underline"
            >Solicitar token</a>
            con el RNT del hotel: el MinCIT lo envía al correo registrado en el RNT.
          </li>
          <li>Pega el token aquí y guarda: se prueba la conexión.</li>
        </ol>

        @if (summary()?.credential; as credential) {
          <p class="text-sm text-text-secondary" data-testid="tra-token-current">
            Token guardado: ••••{{ credential.hint }}.
            @if (credential.test_message) {
              <span [class]="credential.test_ok ? 'text-success' : 'text-warning'">
                {{ credential.test_message }}
              </span>
            }
          </p>
        }

        <div data-autofocus>
          <app-input
            [formControl]="tokenControl"
            [control]="tokenControl"
            [error]="tokenError()"
            [required]="true"
            type="password"
            label="Token TRA"
            placeholder="Pega aquí el token del correo"
            helperText="Se guarda cifrado. Pega uno nuevo cuando el MinCIT lo renueve."
            customWrapperClass="mt-0"
          ></app-input>
        </div>

        @if (result(); as test) {
          <p
            role="status"
            class="text-sm font-medium"
            [class.text-success]="test.ok"
            [class.text-warning]="!test.ok"
            data-testid="tra-token-result"
          >
            {{ test.message }}
          </p>
        }
      </form>

      <div slot="footer" class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <app-button variant="ghost" (clicked)="cancel()">Cerrar</app-button>
        @if (summary()?.credential) {
          <app-button variant="outline" [loading]="testing()" [disabled]="busy()" (clicked)="test()">
            <app-icon slot="icon" name="plug" [size]="16" />
            Probar conexión
          </app-button>
        }
        <app-button
          type="submit"
          form="tra-token-form"
          variant="primary"
          [loading]="saving()"
          [disabled]="busy()"
        >
          <app-icon slot="icon" name="save" [size]="16" />
          Guardar y probar
        </app-button>
      </div>
    </app-modal>
  `,
})
export class TraTokenModalComponent {
  private readonly traService = inject(LodgingTraService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly focusFirstField = injectFocusFirstField();

  readonly isOpen = input(false);
  readonly summary = input<TraSummary | null>(null);
  readonly closed = output<void>();
  /** Emitted after a save or a test, so the page reloads its summary. */
  readonly changed = output<void>();

  readonly tokenUrl = TRA_TOKEN_URL;
  readonly tokenControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(8)],
  });
  readonly saving = signal(false);
  readonly testing = signal(false);
  readonly result = signal<TraTestResult | null>(null);
  private readonly submitted = signal(false);

  busy(): boolean {
    return this.saving() || this.testing();
  }

  reset(): void {
    this.tokenControl.reset('');
    this.submitted.set(false);
    this.result.set(null);
  }

  tokenError(): string | undefined {
    if (!this.submitted() && !this.tokenControl.touched) return undefined;
    if (this.tokenControl.hasError('required')) return 'Pega el token que llegó al correo del RNT.';
    if (this.tokenControl.hasError('minlength')) return 'El token parece incompleto: cópialo entero.';
    return undefined;
  }

  readonly canClose = (): boolean | Promise<boolean> => {
    if (this.busy()) return false;
    if (!this.tokenControl.value.trim()) return true;
    return this.dialogService.confirm({
      title: '¿Descartar el token?',
      message: 'El token pegado no se guardará.',
      confirmText: 'Descartar',
      cancelText: 'Seguir editando',
      confirmVariant: 'danger',
    });
  };

  async cancel(): Promise<void> {
    if (await this.canClose()) this.close();
  }

  close(): void {
    if (this.busy()) return;
    this.closed.emit();
  }

  onSubmit(): void {
    if (this.busy()) return;
    this.submitted.set(true);
    this.tokenControl.markAsTouched();
    if (this.tokenControl.invalid) return;
    this.saving.set(true);
    this.traService
      .saveToken(this.tokenControl.value.trim())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.saving.set(false);
          this.tokenControl.reset('');
          this.submitted.set(false);
          this.result.set(result);
          this.toastService.success('Token TRA guardado');
          this.changed.emit();
        },
        error: (message: unknown) => {
          this.saving.set(false);
          this.toastService.error(typeof message === 'string' ? message : 'No se pudo guardar el token');
        },
      });
  }

  test(): void {
    if (this.busy()) return;
    this.testing.set(true);
    this.traService
      .testToken()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.testing.set(false);
          this.result.set(result);
          if (result.ok) this.toastService.success(result.message);
          else this.toastService.warning(result.message);
          this.changed.emit();
        },
        error: (message: unknown) => {
          this.testing.set(false);
          this.toastService.error(typeof message === 'string' ? message : 'No se pudo probar la conexión');
        },
      });
  }
}

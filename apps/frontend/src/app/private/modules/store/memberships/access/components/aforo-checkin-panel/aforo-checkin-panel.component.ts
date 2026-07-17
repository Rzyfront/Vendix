import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  ButtonComponent,
  CardComponent,
  IconComponent,
  InputButtonOption,
  InputButtonsComponent,
  InputComponent,
} from '../../../../../../../shared/components/index';
import {
  MembershipAccessEvent,
  MembershipAmbientAccessService,
} from '../../../../../../../core/services/membership-ambient-access.service';
import {
  AccessValidationResult,
  GYM_ACCESS_RESULT_COLORS,
  GYM_ACCESS_RESULT_LABELS,
  GymAccessResult,
  GymCredentialType,
} from '../../interfaces';
import { AforoQrScannerComponent } from '../aforo-qr-scanner/aforo-qr-scanner.component';

/** Normalized shape rendered by the result pill (QR/PIN or fingerprint). */
interface CheckinResultView {
  granted: boolean;
  label: string;
  color: string;
  name: string | null;
}

/**
 * "Ingreso" panel for the gym/aforo view. Lets an operator validate a member's
 * access credential by the selected method:
 *
 *  - QR: live camera scan (via `app-aforo-qr-scanner`) or a manual code fallback
 *    (HID reader / typing). Emits `validate` with the decoded code.
 *  - PIN: numeric entry, emits `validate` with the typed PIN.
 *  - Fingerprint (`external_ref`): NO input — the biometric reader publishes the
 *    decision over the ambient SSE stream. We arm on the last-seen event `.at`
 *    and surface the NEXT decision (discriminating stale events by `.at`).
 *
 * QR/PIN results are computed by the host page and passed back via `lastResult`.
 * Fingerprint results come straight from the ambient stream.
 *
 * Zoneless + signals (Angular 20).
 */
@Component({
  selector: 'app-aforo-checkin-panel',
  standalone: true,
  imports: [
    FormsModule,
    CardComponent,
    IconComponent,
    InputButtonsComponent,
    InputComponent,
    ButtonComponent,
    AforoQrScannerComponent,
  ],
  styleUrl: './aforo-checkin-panel.component.css',
  template: `
    <app-card [shadow]="'sm'" [responsivePadding]="true" [showHeader]="true">
      <div slot="header" class="ci-header">
        <span class="ci-header-icon">
          <app-icon name="log-in" [size]="18" />
        </span>
        <div class="ci-header-text">
          <h3>Ingreso</h3>
          <p>Valida una credencial para registrar el ingreso</p>
        </div>
      </div>

      <div class="ci-body">
        <!-- Method selector -->
        <app-input-buttons
          label="Método de ingreso"
          [options]="methodOptions"
          [ngModel]="method()"
          [ngModelOptions]="{ standalone: true }"
          (valueChange)="onMethod($event)"
        />

        <!-- QR -->
        @if (method() === 'qr') {
          <div class="ci-section">
            <app-button
              variant="primary"
              size="lg"
              [fullWidth]="true"
              [disabled]="actionInFlight()"
              (clicked)="openScanner()"
            >
              <app-icon slot="icon" name="camera" [size]="18" />
              Escanear con cámara
            </app-button>

            <div class="ci-manual">
              <span class="ci-eyebrow">O ingresa el código manualmente</span>
              <div class="ci-manual-row">
                <app-input
                  class="ci-manual-input"
                  placeholder="Código del QR / lector"
                  [disabled]="actionInFlight()"
                  [ngModel]="qrManual()"
                  [ngModelOptions]="{ standalone: true }"
                  (ngModelChange)="qrManual.set($event)"
                  (keyup.enter)="submitQrManual()"
                />
                <app-button
                  variant="outline"
                  [disabled]="actionInFlight() || !qrManual().trim()"
                  (clicked)="submitQrManual()"
                >
                  <app-icon slot="icon" name="log-in" [size]="16" />
                  Validar
                </app-button>
              </div>
            </div>
          </div>
        }

        <!-- PIN -->
        @if (method() === 'pin') {
          <div class="ci-section">
            <app-input
              type="number"
              label="PIN de acceso"
              placeholder="Ingresa el PIN"
              [disabled]="actionInFlight()"
              [ngModel]="pinValue()"
              [ngModelOptions]="{ standalone: true }"
              (ngModelChange)="pinValue.set($event)"
              (keyup.enter)="submitPin()"
            />
            <app-button
              variant="primary"
              [fullWidth]="true"
              [disabled]="actionInFlight() || !pinValue().trim()"
              (clicked)="submitPin()"
            >
              <app-icon slot="icon" name="log-in" [size]="16" />
              Validar
            </app-button>
          </div>
        }

        <!-- Fingerprint -->
        @if (method() === 'external_ref') {
          <div class="ci-section ci-finger">
            @if (fingerScanning()) {
              <div class="finger-scanner">
                <div class="finger-pulse">
                  <span class="finger-ring finger-ring-1"></span>
                  <span class="finger-ring finger-ring-2"></span>
                  <span class="finger-core">
                    <app-icon name="fingerprint" [size]="40" />
                    <span class="finger-scanline"></span>
                  </span>
                </div>
                <p class="finger-status">Leyendo huella…</p>
                <app-button variant="outline" (clicked)="cancelFinger()">
                  <app-icon slot="icon" name="x" [size]="16" />
                  Cancelar
                </app-button>
              </div>
            } @else {
              <div class="finger-idle">
                <span class="finger-idle-icon">
                  <app-icon name="fingerprint" [size]="32" />
                </span>
                <p class="finger-idle-text">
                  Coloca el dedo en el lector biométrico
                </p>
                <app-button
                  variant="primary"
                  [fullWidth]="true"
                  [disabled]="actionInFlight()"
                  (clicked)="startFinger()"
                >
                  <app-icon slot="icon" name="fingerprint" [size]="16" />
                  Iniciar lectura
                </app-button>
              </div>
            }
          </div>
        }

        <!-- Result -->
        @if (resultView(); as rv) {
          <div
            class="result-pill"
            [style.color]="rv.color"
            [style.background]="rv.color + '1a'"
            [style.border-color]="rv.color + '33'"
          >
            <app-icon
              [name]="rv.granted ? 'check-circle' : 'x-circle'"
              [size]="16"
            />
            <span class="result-label">{{ rv.label }}</span>
            @if (rv.name) {
              <span class="result-name">· {{ rv.name }}</span>
            }
          </div>
        }
      </div>
    </app-card>

    <app-aforo-qr-scanner
      [isOpen]="scannerOpen()"
      [continuous]="kiosk()"
      (scanned)="onQrScanned($event)"
      (closed)="scannerOpen.set(false)"
    />
  `,
})
export class AforoCheckinPanelComponent {
  private readonly ambient = inject(MembershipAmbientAccessService);

  /** True while the host is validating a credential (disables the controls). */
  readonly actionInFlight = input<boolean>(false);
  /** QR/PIN validation result computed by the host page. */
  readonly lastResult = input<AccessValidationResult | null>(null);
  /**
   * Kiosk mode (store setting `qr_kiosk_mode`). When true, the QR scanner is
   * auto-opened and kept scanning continuously (member after member) so an
   * unattended reception tablet grants access on each read.
   */
  readonly kiosk = input<boolean>(false);

  /** Emitted when the operator submits a credential to validate. */
  readonly validate = output<{
    credential_type: GymCredentialType;
    credential_value: string;
  }>();

  readonly methodOptions: InputButtonOption[] = [
    { value: 'qr', label: 'QR', icon: 'scan-line' },
    { value: 'pin', label: 'PIN', icon: 'hash' },
    { value: 'external_ref', label: 'Huella', icon: 'fingerprint' },
  ];

  readonly method = signal<GymCredentialType>('qr');
  readonly pinValue = signal('');
  readonly qrManual = signal('');
  readonly scannerOpen = signal(false);
  readonly fingerScanning = signal(false);
  /** `.at` of the ambient event present when the reader was armed. */
  readonly fingerArmedAt = signal<string | null>(null);
  readonly fingerResult = signal<MembershipAccessEvent | null>(null);

  /** Result to render: fingerprint stream for `external_ref`, else host result. */
  readonly resultView = computed<CheckinResultView | null>(() => {
    if (this.method() === 'external_ref') {
      const ev = this.fingerResult();
      if (!ev) return null;
      return {
        granted: ev.granted,
        label: this.resultLabel(ev.result),
        color: this.resultColor(ev.result),
        name: ev.customer_name,
      };
    }
    const r = this.lastResult();
    if (!r) return null;
    return {
      granted: r.granted,
      label: this.resultLabel(r.result),
      color: this.resultColor(r.result),
      name: null,
    };
  });

  constructor() {
    // Surface the NEXT ambient decision while a fingerprint read is armed.
    // Discriminate stale events by `.at` so a pre-existing event is ignored.
    effect(() => {
      const ev = this.ambient.lastEvent();
      if (this.method() !== 'external_ref' || !this.fingerScanning()) return;
      if (!ev || !ev.at) return;
      if (ev.at === this.fingerArmedAt()) return;
      this.fingerResult.set(ev);
      this.fingerScanning.set(false);
    });

    // Kiosk mode: keep the QR scanner open whenever the active method is QR so a
    // reception tablet scans member after member unattended. Reads kiosk()+
    // method() and writes scannerOpen — no cycle (it never reads scannerOpen).
    effect(() => {
      if (this.kiosk() && this.method() === 'qr') {
        this.scannerOpen.set(true);
      }
    });
  }

  onMethod(value: string): void {
    this.method.set(value as GymCredentialType);
    // Reset transient state so switching methods never leaks a scan/read.
    this.scannerOpen.set(false);
    this.fingerScanning.set(false);
    this.fingerResult.set(null);
    this.fingerArmedAt.set(null);
  }

  // ── QR ────────────────────────────────────────────────────────────────
  openScanner(): void {
    this.scannerOpen.set(true);
  }

  onQrScanned(code: string): void {
    // Kiosk mode keeps the overlay open (continuous loop); single-shot closes.
    if (!this.kiosk()) this.scannerOpen.set(false);
    const value = code.trim();
    if (!value) return;
    this.validate.emit({ credential_type: 'qr', credential_value: value });
  }

  submitQrManual(): void {
    const value = this.qrManual().trim();
    if (!value || this.actionInFlight()) return;
    this.validate.emit({ credential_type: 'qr', credential_value: value });
  }

  // ── PIN ───────────────────────────────────────────────────────────────
  submitPin(): void {
    const value = this.pinValue().trim();
    if (!value || this.actionInFlight()) return;
    this.validate.emit({ credential_type: 'pin', credential_value: value });
  }

  // ── Fingerprint (external_ref) ──────────────────────────────────────────
  startFinger(): void {
    this.ambient.connect();
    this.fingerResult.set(null);
    this.fingerArmedAt.set(this.ambient.lastEvent()?.at ?? '');
    this.fingerScanning.set(true);
  }

  cancelFinger(): void {
    this.fingerScanning.set(false);
  }

  private resultLabel(result: string): string {
    return GYM_ACCESS_RESULT_LABELS[result as GymAccessResult] ?? result;
  }

  private resultColor(result: string): string {
    return GYM_ACCESS_RESULT_COLORS[result as GymAccessResult] ?? '#6b7280';
  }
}

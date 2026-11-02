import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { parseApiError } from '../../../../../core/utils/parse-api-error';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  ToastService,
  ToggleComponent,
} from '../../../../../shared/components';
import {
  MetaAppReviewStatus,
  MetaWhatsappConfigView,
  UpdateMetaWhatsappConfigDto,
} from './interfaces/meta-whatsapp-config.interface';
import { MetaWhatsappConfigService } from './services/meta-whatsapp-config.service';

export const ENCRYPTION_KEY_MISSING_MESSAGE =
  'Falta la clave de cifrado en el servidor; los secretos no se guardaron';

export const VERIFY_TOKEN_WARNING =
  'Pégalo en Meta → WhatsApp → Configuración → Webhook antes de cerrar esta página';

interface MetaConfigFormControls {
  app_id: FormControl<string>;
  app_secret: FormControl<string>;
  whatsapp_config_id: FormControl<string>;
  verify_token: FormControl<string>;
  graph_version: FormControl<string>;
  app_review_status: FormControl<MetaAppReviewStatus>;
  allow_dev_signup: FormControl<boolean>;
}

/** Generates 32 random bytes as 64 hex chars, in the browser. */
export function generateVerifyTokenHex(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Super admin page: Integraciones → Meta / WhatsApp.
 * Secrets are never shown in clear; empty secret fields are never sent.
 */
@Component({
  selector: 'app-meta-whatsapp-config',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    DatePipe,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    ToggleComponent,
  ],
  templateUrl: './meta-whatsapp-config.component.html',
})
export class MetaWhatsappConfigComponent {
  private readonly service = inject(MetaWhatsappConfigService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthFacade);

  readonly verifyTokenWarning = VERIFY_TOKEN_WARNING;
  readonly webhookUrl = this.service.webhookUrl();

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly config = signal<MetaWhatsappConfigView | null>(null);
  /** Token generated in this session; shown once, cleared on save/reload. */
  readonly generatedToken = signal<string | null>(null);

  // Super admins bypass permission checks on the backend (role-based), so the
  // role also grants access here, mirroring that behavior.
  readonly canRead = computed(() => this.hasAccess('read'));
  readonly canWrite = computed(() => this.hasAccess('write'));

  readonly reviewOptions = [
    { value: 'pending', label: 'Pendiente' },
    { value: 'approved', label: 'Aprobada' },
    { value: 'rejected', label: 'Rechazada' },
  ];

  readonly form = new FormGroup<MetaConfigFormControls>({
    app_id: new FormControl('', { nonNullable: true }),
    app_secret: new FormControl('', { nonNullable: true }),
    whatsapp_config_id: new FormControl('', { nonNullable: true }),
    verify_token: new FormControl('', { nonNullable: true }),
    graph_version: new FormControl('', { nonNullable: true }),
    app_review_status: new FormControl<MetaAppReviewStatus>('pending', {
      nonNullable: true,
    }),
    allow_dev_signup: new FormControl(false, { nonNullable: true }),
  });

  constructor() {
    if (this.canRead()) {
      this.load();
    } else {
      this.loading.set(false);
    }
  }

  get appIdControl() {
    return this.form.controls.app_id;
  }
  get appSecretControl() {
    return this.form.controls.app_secret;
  }
  get configIdControl() {
    return this.form.controls.whatsapp_config_id;
  }
  get verifyTokenControl() {
    return this.form.controls.verify_token;
  }
  get graphVersionControl() {
    return this.form.controls.graph_version;
  }
  get reviewStatusControl() {
    return this.form.controls.app_review_status;
  }
  get devSignupControl() {
    return this.form.controls.allow_dev_signup;
  }

  load(): void {
    this.loading.set(true);
    this.service.getConfig().subscribe({
      next: (view) => {
        this.applyView(view);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.toast.error(parseApiError(err).userMessage);
      },
    });
  }

  generateVerifyToken(): void {
    const token = generateVerifyTokenHex();
    this.verifyTokenControl.setValue(token);
    this.verifyTokenControl.markAsDirty();
    this.generatedToken.set(token);
  }

  async copy(text: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.toast.success(`${label} copiado`);
    } catch {
      this.toast.error('No se pudo copiar al portapapeles');
    }
  }

  /** Builds the PATCH body: only changed fields, never empty secrets. */
  buildChanges(): UpdateMetaWhatsappConfigDto {
    const current = this.config();
    const v = this.form.getRawValue();
    const dto: UpdateMetaWhatsappConfigDto = {};

    const appId = v.app_id.trim();
    if (appId && appId !== (current?.app_id ?? '')) dto.app_id = appId;

    const configId = v.whatsapp_config_id.trim();
    if (configId && configId !== (current?.whatsapp_config_id ?? '')) {
      dto.whatsapp_config_id = configId;
    }

    const graph = v.graph_version.trim();
    if (graph && graph !== (current?.graph_version ?? '')) {
      dto.graph_version = graph;
    }

    if (v.app_review_status !== (current?.app_review_status ?? 'pending')) {
      dto.app_review_status = v.app_review_status;
    }
    if (v.allow_dev_signup !== (current?.allow_dev_signup ?? false)) {
      dto.allow_dev_signup = v.allow_dev_signup;
    }

    if (v.app_secret.trim()) dto.app_secret = v.app_secret.trim();
    if (v.verify_token.trim()) dto.verify_token = v.verify_token.trim();

    return dto;
  }

  save(): void {
    if (!this.canWrite() || this.saving()) return;
    const dto = this.buildChanges();
    if (Object.keys(dto).length === 0) {
      this.toast.info('No hay cambios para guardar');
      return;
    }

    this.saving.set(true);
    this.service.updateConfig(dto).subscribe({
      next: (view) => {
        this.saving.set(false);
        this.generatedToken.set(null);
        this.applyView(view);
        this.toast.success('Configuración Meta guardada');
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(this.errorMessage(err));
      },
    });
  }

  private errorMessage(err: unknown): string {
    const parsed = parseApiError(err);
    const raw = `${parsed.devMessage ?? ''} ${parsed.userMessage ?? ''}`;
    if (raw.includes('SOCIAL_CHANNEL_ENCRYPTION_KEY')) {
      return ENCRYPTION_KEY_MISSING_MESSAGE;
    }
    return parsed.userMessage;
  }

  private applyView(view: MetaWhatsappConfigView): void {
    this.config.set(view);
    this.form.reset({
      app_id: view.app_id ?? '',
      app_secret: '',
      whatsapp_config_id: view.whatsapp_config_id ?? '',
      verify_token: '',
      graph_version: view.graph_version ?? '',
      app_review_status: view.app_review_status ?? 'pending',
      allow_dev_signup: view.allow_dev_signup ?? false,
    });
  }

  private hasAccess(kind: 'read' | 'write'): boolean {
    return (
      this.auth.hasPermission(`superadmin:social_sales:config:${kind}`) ||
      this.auth.hasRole('super_admin')
    );
  }
}

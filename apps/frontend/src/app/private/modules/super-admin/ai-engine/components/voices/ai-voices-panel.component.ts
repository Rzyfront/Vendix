import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AiVoiceProfile, AiVoiceSpeechConfig } from '../../interfaces';
import { AiVoicesService } from '../../services/ai-voices.service';
import { AiVoiceProfileModalComponent } from './ai-voice-profile-modal.component';
import {
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  IconComponent,
  ItemListCardConfig,
  ResponsiveDataViewComponent,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../../shared/components/index';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';

const AGENT_LABELS: Record<string, string> = { vex: 'Vex', vexi: 'Vexi' };

/** Pestaña «Voces» (F8 T49): catálogo de voces de lectura de Vex y Vexi. */
@Component({
  selector: 'app-ai-voices-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonComponent,
    CardComponent,
    EmptyStateComponent,
    IconComponent,
    ResponsiveDataViewComponent,
    AiVoiceProfileModalComponent,
  ],
  template: `
    <div class="flex flex-col gap-4">
      <app-card [padding]="false" overflow="visible">
        <div
          class="p-2 md:px-6 md:py-4 border-b border-border flex flex-col lg:flex-row gap-4 lg:items-end justify-between"
        >
          <div class="min-w-0">
            <h3 class="text-lg font-semibold text-text-primary">Voces</h3>
            <p class="hidden sm:block text-xs text-text-secondary mt-0.5">
              Catálogo de voces de lectura. Cada agente elige la suya en su ficha.
            </p>
          </div>
          <app-button variant="primary" (clicked)="openCreate()">
            <app-icon slot="icon" name="plus" [size]="16"></app-icon>
            Registrar voz
          </app-button>
        </div>
        <div class="relative min-h-[240px] p-2 md:p-4">
          <app-responsive-data-view
            [columns]="columns"
            [data]="voices()"
            [actions]="actions"
            [cardConfig]="cardConfig"
            [loading]="isLoading()"
            (rowClick)="openEdit($event)"
          >
            @if (!isLoading() && voices().length === 0) {
              <div class="p-8 flex justify-center w-full">
                <app-empty-state
                  icon="volume-2"
                  title="Aún no hay voces registradas"
                  description="Registra la primera voz para que Vex o Vexi la usen al leer sus respuestas"
                  actionButtonText="Registrar voz"
                  [showActionButton]="true"
                  (actionClick)="openCreate()"
                ></app-empty-state>
              </div>
            }
          </app-responsive-data-view>
        </div>
      </app-card>
    </div>

    <app-ai-voice-profile-modal
      [isOpen]="modalOpen()"
      [voice]="editingVoice()"
      [configs]="configs()"
      (isOpenChange)="modalOpen.set($event)"
      (saved)="load()"
    ></app-ai-voice-profile-modal>
  `,
})
export class AiVoicesPanelComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private api = inject(AiVoicesService);
  private toast = inject(ToastService);

  readonly voices = signal<AiVoiceProfile[]>([]);
  readonly configs = signal<AiVoiceSpeechConfig[]>([]);
  readonly isLoading = signal(false);
  readonly modalOpen = signal(false);
  readonly editingVoice = signal<AiVoiceProfile | null>(null);
  /** Ids with a preview or a toggle in flight. */
  private readonly previewingIds = signal<ReadonlySet<number>>(new Set());
  private readonly togglingIds = signal<ReadonlySet<number>>(new Set());

  private audio: HTMLAudioElement | null = null;

  private formatStatus = (active: boolean): string =>
    active ? 'Activa' : 'Inactiva';
  private formatProvider = (config: AiVoiceProfile['config'] | null): string =>
    config ? `${config.provider} · ${config.model_id}` : '—';
  private formatAssigned = (agents: string[] | null): string =>
    agents && agents.length > 0
      ? agents.map((a) => AGENT_LABELS[a] ?? a).join(', ')
      : 'Sin asignar';

  readonly columns: TableColumn[] = [
    { key: 'name', label: 'Nombre', sortable: true, priority: 1 },
    {
      key: 'config',
      label: 'Proveedor',
      priority: 2,
      transform: (v: AiVoiceProfile['config'] | null) => this.formatProvider(v),
    },
    { key: 'voice_id', label: 'Id de voz', priority: 2 },
    { key: 'language', label: 'Idioma', priority: 3 },
    {
      key: 'is_active',
      label: 'Estado',
      priority: 1,
      badge: true,
      badgeConfig: { type: 'status', size: 'sm' },
      transform: (v: boolean) => this.formatStatus(v),
    },
    {
      key: 'assigned_agents',
      label: 'Asignada a',
      priority: 2,
      transform: (v: string[] | null) => this.formatAssigned(v),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'voice_id',
    badgeKey: 'is_active',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (v: boolean) => this.formatStatus(v),
    detailKeys: [
      {
        key: 'config',
        label: 'Proveedor',
        transform: (v: AiVoiceProfile['config'] | null) =>
          this.formatProvider(v),
      },
      { key: 'language', label: 'Idioma' },
      {
        key: 'assigned_agents',
        label: 'Asignada a',
        transform: (v: string[] | null) => this.formatAssigned(v),
      },
    ],
  };

  readonly actions: TableAction[] = [
    {
      label: (voice: AiVoiceProfile) =>
        this.previewingIds().has(voice.id) ? 'Cargando…' : 'Escuchar',
      icon: 'volume-2',
      action: (voice: AiVoiceProfile) => this.listen(voice),
      disabled: (voice: AiVoiceProfile) => this.previewingIds().has(voice.id),
      variant: 'success',
    },
    {
      label: 'Editar',
      icon: 'edit',
      action: (voice: AiVoiceProfile) => this.openEdit(voice),
      variant: 'info',
    },
    {
      label: (voice: AiVoiceProfile) =>
        voice.is_active ? 'Desactivar' : 'Activar',
      icon: (voice: AiVoiceProfile) => (voice.is_active ? 'eye-off' : 'eye'),
      action: (voice: AiVoiceProfile) => this.toggleActive(voice),
      disabled: (voice: AiVoiceProfile) => this.togglingIds().has(voice.id),
      variant: 'muted',
    },
  ];

  constructor() {
    this.destroyRef.onDestroy(() => this.stopAudio());
  }

  ngOnInit(): void {
    this.load();
    this.loadConfigs();
  }

  load(): void {
    this.isLoading.set(true);
    this.api
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.voices.set(list);
          this.isLoading.set(false);
        },
        error: (error) => {
          this.voices.set([]);
          this.isLoading.set(false);
          this.toast.error(extractApiErrorMessage(error));
        },
      });
  }

  private loadConfigs(): void {
    this.api
      .speechConfigs()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => this.configs.set(list),
        error: (error) => {
          this.configs.set([]);
          this.toast.error(extractApiErrorMessage(error));
        },
      });
  }

  openCreate(): void {
    this.editingVoice.set(null);
    this.loadConfigs();
    this.modalOpen.set(true);
  }

  openEdit(voice: AiVoiceProfile): void {
    this.editingVoice.set(voice);
    this.loadConfigs();
    this.modalOpen.set(true);
  }

  private withId(
    source: ReadonlySet<number>,
    id: number,
    present: boolean,
  ): ReadonlySet<number> {
    const next = new Set(source);
    if (present) next.add(id);
    else next.delete(id);
    return next;
  }

  listen(voice: AiVoiceProfile): void {
    if (this.previewingIds().has(voice.id)) return;
    this.stopAudio();
    this.previewingIds.update((s) => this.withId(s, voice.id, true));
    this.api
      .preview(voice.id, voice.sample_text ?? undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.previewingIds.update((s) => this.withId(s, voice.id, false));
          this.stopAudio();
          const audio = new Audio(
            `data:${result.contentType};base64,${result.audioBase64}`,
          );
          this.audio = audio;
          audio
            .play()
            .catch(() => this.toast.error('No se pudo reproducir la muestra'));
        },
        error: (error) => {
          this.previewingIds.update((s) => this.withId(s, voice.id, false));
          this.toast.error(extractApiErrorMessage(error));
        },
      });
  }

  toggleActive(voice: AiVoiceProfile): void {
    if (this.togglingIds().has(voice.id)) return;
    this.togglingIds.update((s) => this.withId(s, voice.id, true));
    this.api
      .update(voice.id, { is_active: !voice.is_active })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.togglingIds.update((s) => this.withId(s, voice.id, false));
          this.voices.update((list) =>
            list.map((v) => (v.id === updated.id ? updated : v)),
          );
          this.toast.success(
            updated.is_active ? 'Voz activada' : 'Voz desactivada',
          );
        },
        error: (error) => {
          this.togglingIds.update((s) => this.withId(s, voice.id, false));
          // Backend rejects deactivating an assigned voice: show its message.
          this.toast.error(extractApiErrorMessage(error));
        },
      });
  }

  private stopAudio(): void {
    if (!this.audio) return;
    this.audio.pause();
    this.audio.src = '';
    this.audio = null;
  }
}

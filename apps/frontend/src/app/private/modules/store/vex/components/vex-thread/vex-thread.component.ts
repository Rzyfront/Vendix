import {
  Component,
  ElementRef,
  computed,
  afterNextRender,
  effect,
  inject,
  Injector,
  viewChild,
} from '@angular/core';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { VexChatStore } from '../../state/vex-chat.store';
import { VexPresenceStore } from '../../state/vex-presence.store';
import { VEX_COPY } from '../../vex-copy';
import { VEXI_RESTART_LABEL } from '../../../../../../core/store/vexi/vexi-user-copy.utils';
import { VexBlockInteraction, VexUiBlock } from '../../models/vex.models';
import { VexMarkdownComponent } from '../vex-markdown/vex-markdown.component';
import { VexBlockTableComponent } from '../vex-blocks/vex-block-table.component';
import { VexBlockChartComponent } from '../vex-blocks/vex-block-chart.component';
import { VexBlockKpiComponent } from '../vex-blocks/vex-block-kpi.component';
import { VexBlockImageComponent } from '../vex-blocks/vex-block-image.component';
import { VexBlockFileComponent } from '../vex-blocks/vex-block-file.component';
import { VexToolTraceComponent } from '../vex-tool-trace/vex-tool-trace.component';
import { VexPlanCardComponent } from '../vex-plan-card/vex-plan-card.component';
import { VexFollowupChipComponent } from '../vex-followup-chip/vex-followup-chip.component';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';

@Component({
  selector: 'vendix-vex-thread',
  standalone: true,
  imports: [
    ButtonComponent,
    IconComponent,
    VexMarkdownComponent,
    VexBlockTableComponent,
    VexBlockChartComponent,
    VexBlockKpiComponent,
    VexBlockImageComponent,
    VexBlockFileComponent,
    VexToolTraceComponent,
    VexPlanCardComponent,
    VexFollowupChipComponent,
  ],
  template: `
    <div #scroller class="h-full overflow-y-auto" role="log" aria-live="polite">
      <div class="max-w-3xl mx-auto w-full px-4 py-4 flex flex-col gap-6">
        @if (store.loading_thread()) {
          <div
            class="flex items-center justify-center gap-2 py-8 text-[var(--color-text-secondary)]"
          >
            <app-icon name="loader-2" [size]="18" [spin]="true"></app-icon>
            <span class="text-sm">Abriendo conversación…</span>
          </div>
        }
        @for (message of messages(); track message.id) {
          @if (message.role === 'user') {
            <div class="flex flex-col items-end gap-1">
              <div
                class="max-w-[80%] rounded-2xl bg-[var(--color-surface)] border px-4 py-2 whitespace-pre-wrap leading-relaxed text-[var(--color-text-primary)]"
                [class]="message.send_failed ? 'border-[var(--color-error)]' : 'border-[var(--color-border)]'"
              >
                {{ message.content }}
              </div>
              @if (message.send_failed) {
                <div
                  class="flex items-center gap-2 flex-wrap justify-end text-sm text-[var(--color-error)]"
                  role="alert"
                >
                  <app-icon name="alert-triangle" [size]="14"></app-icon>
                  <span>No se envió</span>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    class="min-h-10 px-2 rounded-lg font-medium underline hover:no-underline focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
                    [disabled]="store.is_agent_typing()"
                    (click)="store.retrySend(message.id)"
                  >
                    Reintentar
                  </button>
                </div>
                @if (message.error) {
                  <p class="max-w-[80%] text-xs text-[var(--color-text-secondary)] text-right">
                    {{ message.error }}
                  </p>
                }
              }
            </div>
          } @else {
            <div
              class="flex items-start gap-3 min-w-0 rounded-2xl transition-colors"
              [class]="
                presence.speaking_message_id() === message.id
                  ? 'bg-primary/5 ring-2 ring-primary/20 p-2 -m-2'
                  : ''
              "
              [attr.aria-current]="presence.speaking_message_id() === message.id ? 'true' : null"
            >
              <img
                src="assets/vex/vexicon-96.webp"
                alt=""
                class="w-7 h-7 object-contain shrink-0"
              />
              <div class="flex-1 min-w-0 flex flex-col gap-3">
                @if (presence.speaking_message_id() === message.id) {
                  <p class="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-on-tint">
                    <app-icon name="volume-2" [size]="14" />
                    {{ copy.reading_aloud }}
                  </p>
                }
                @if (message.tool_steps?.length) {
                  <vendix-vex-tool-trace [steps]="message.tool_steps ?? []" />
                }
                @if (message.content) {
                  <vendix-vex-markdown [content]="message.content" />
                }
                @for (block of message.blocks ?? []; track block.block_id) {
                  @switch (block.kind) {
                    @case ('table') {
                      <vendix-vex-block-table
                        [block]="block"
                        (interaction)="onBlockInteraction(block, $event)"
                      />
                    }
                    @case ('chart') {
                      <vendix-vex-block-chart
                        [block]="block"
                        (interaction)="onBlockInteraction(block, $event)"
                      />
                    }
                    @case ('kpi') {
                      <vendix-vex-block-kpi [block]="block" />
                    }
                    @case ('image') {
                      <vendix-vex-block-image [block]="block" />
                    }
                    @case ('file') {
                      <vendix-vex-block-file [block]="block" />
                    }
                    @case ('markdown') {
                      <vendix-vex-markdown [content]="blockMarkdown(block)" />
                    }
                  }
                }
                @if (message.plan) {
                  <vendix-vex-plan-card
                    [plan]="message.plan"
                    [conversationId]="store.activeNumericId()"
                    [objectiveId]="store.active_objective()?.id"
                    (voiceApplied)="
                      store.acceptVoiceReceipt(
                        message.id,
                        message.plan.plan_id,
                        $event
                      )
                    "
                    [busy]="store.busy_plan_id() === message.plan.plan_id"
                    (approve)="
                      store.approvePlan(message.id, message.plan.plan_id)
                    "
                    (cancel)="
                      store.cancelPlan(message.id, message.plan.plan_id)
                    "
                    (stepApprove)="
                      store.approveStep(
                        message.id,
                        message.plan,
                        $event.step_id,
                        $event.confirmation_token
                      )
                    "
                  />
                }
                @if (!store.followups_muted()) {
                  @for (followup of message.followups ?? []; track followup.id) {
                    <vendix-vex-followup-chip
                      [followup]="followup"
                      [timezone]="timezone()"
                      [busy]="store.busy_followup_ids().has(followup.id)"
                      (save)="store.saveFollowup(message.id, followup.id, $event)"
                      (dismiss)="store.dismissFollowup(message.id, followup.id)"
                      (mute)="store.muteFollowups(true)"
                    />
                  }
                }
                @if (message.error) {
                  <p
                    class="rounded-xl border border-[var(--color-error)] bg-[rgba(var(--color-error-rgb),0.07)] px-3 py-2 text-sm text-[var(--color-error)]"
                    role="alert"
                  >
                    {{ message.error }}
                  </p>
                  @if (message.can_retry) {
                    <button
                      type="button"
                      class="self-start min-h-10 inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] px-3 text-sm text-[var(--color-text-primary)] hover:bg-[rgba(var(--color-text-primary-rgb),0.06)]"
                      [disabled]="store.is_agent_typing()"
                      (click)="store.retryAnswer()"
                    >
                      <app-icon name="rotate-cw" [size]="14"></app-icon>
                      Reintentar
                    </button>
                  }
                  @if (message.restart_suggested) {
                    <button
                      type="button"
                      class="self-start rounded-full border border-[var(--color-border)] px-3 py-1 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover,rgba(0,0,0,0.04))]"
                      (click)="store.newConversation()"
                    >
                      {{ restartLabel }}
                    </button>
                  }
                }
                @if (
                  message.streaming &&
                  (message.content || message.blocks?.length) &&
                  !message.error
                ) {
                  <p
                    class="inline-flex items-center gap-1.5 text-xs text-text-secondary"
                    aria-hidden="true"
                  >
                    <span class="inline-flex items-center gap-0.5">
                      <span class="w-1.5 h-1.5 rounded-full bg-text-secondary motion-safe:animate-pulse"></span>
                      <span class="w-1.5 h-1.5 rounded-full bg-text-secondary motion-safe:animate-pulse [animation-delay:150ms]"></span>
                      <span class="w-1.5 h-1.5 rounded-full bg-text-secondary motion-safe:animate-pulse [animation-delay:300ms]"></span>
                    </span>
                    {{ copy.still_writing }}
                  </p>
                }
                @if (
                  message.streaming &&
                  !message.content &&
                  !message.blocks?.length
                ) {
                  <div
                    class="flex items-center gap-1 py-1"
                    aria-label="Vex está escribiendo"
                  >
                    <span
                      class="w-2 h-2 rounded-full bg-[var(--color-text-secondary)] animate-bounce"
                    ></span>
                    <span
                      class="w-2 h-2 rounded-full bg-[var(--color-text-secondary)] animate-bounce [animation-delay:150ms]"
                    ></span>
                    <span
                      class="w-2 h-2 rounded-full bg-[var(--color-text-secondary)] animate-bounce [animation-delay:300ms]"
                    ></span>
                  </div>
                }
              </div>
            </div>
          }
        }
        @if (store.followups_muted()) {
          <div
            class="flex flex-wrap items-center justify-center gap-2 text-xs text-text-secondary"
          >
            <span>{{ followupCopy.muted_notice }}</span>
            <app-button variant="ghost" size="xsm" (clicked)="store.muteFollowups(false)">
              {{ followupCopy.unmute }}
            </app-button>
          </div>
        }
        @if (store.stream_progress()) {
          <p
            role="status"
            class="text-sm text-center text-[var(--color-text-secondary)]"
          >
            {{ store.stream_progress() }}
          </p>
        }
        @if (store.is_agent_typing()) {
          <div class="flex justify-center">
            <button
              type="button"
              class="min-h-10 inline-flex items-center gap-2 px-4 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              aria-label="Detener respuesta"
              (click)="store.stopStream()"
            >
              <app-icon name="x" [size]="16"></app-icon>
              Detener
            </button>
          </div>
        }
      </div>
    </div>
  `,
})
export class VexThreadComponent {
  readonly store = inject(VexChatStore);
  protected readonly presence = inject(VexPresenceStore);
  private readonly settings = inject(StoreSettingsFacade);
  /** Zone follow-up dates are shown and edited in. */
  protected readonly timezone = computed(() => this.settings.timezone());
  protected readonly copy = VEX_COPY.presence;
  protected readonly followupCopy = VEX_COPY.followup;
  protected readonly restartLabel = VEXI_RESTART_LABEL;
  private readonly injector = inject(Injector);
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  readonly messages = () => this.store.active_conversation()?.messages ?? [];

  constructor() {
    effect(() => {
      this.messages();
      this.store.is_agent_typing();
      afterNextRender(
        () => {
          const el = this.scroller()?.nativeElement;
          if (el) el.scrollTop = el.scrollHeight;
        },
        { injector: this.injector },
      );
    });
  }

  blockMarkdown(block: VexUiBlock): string {
    const content = block.data['content'] ?? block.data['text'];
    return typeof content === 'string' ? content : '';
  }

  onBlockInteraction(
    block: VexUiBlock,
    interaction: VexBlockInteraction,
  ): void {
    this.store.sendBlockInteraction(block.block_id, interaction);
  }
}

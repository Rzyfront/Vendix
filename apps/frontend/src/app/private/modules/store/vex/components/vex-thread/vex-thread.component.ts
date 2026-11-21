import {
  Component,
  ElementRef,
  computed,
  afterNextRender,
  effect,
  inject,
  Injector,
  signal,
  viewChild,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { SpinnerComponent } from '../../../../../../shared/components/spinner/spinner.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { VexChatStore } from '../../state/vex-chat.store';
import { VexPresenceStore } from '../../state/vex-presence.store';
import { VEX_COPY } from '../../vex-copy';
import { VEXI_RESTART_LABEL } from '../../../../../../core/store/vexi/vexi-user-copy.utils';
import { VexBlockInteraction, VexUiBlock } from '../../models/vex.models';
import { VexMarkdownComponent } from '../vex-markdown/vex-markdown.component';
import { VexBlockHostComponent } from '../vex-blocks/vex-block-host.component';
import { VexToolTraceComponent } from '../vex-tool-trace/vex-tool-trace.component';
import { VexPlanCardComponent } from '../vex-plan-card/vex-plan-card.component';
import { VexAttachmentViewerComponent } from '../vex-attachment-viewer/vex-attachment-viewer.component';
import { VexFollowupChipComponent } from '../vex-followup-chip/vex-followup-chip.component';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';

@Component({
  selector: 'vendix-vex-thread',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    ButtonComponent,
    SpinnerComponent,
    IconComponent,
    VexMarkdownComponent,
    VexBlockHostComponent,
    VexToolTraceComponent,
    VexPlanCardComponent,
    VexFollowupChipComponent,
    ModalComponent,
    VexAttachmentViewerComponent,
  ],
  template: `
    <div #scroller class="h-full overflow-y-auto" role="log" aria-live="polite">
      <div class="max-w-3xl mx-auto w-full px-4 py-4 flex flex-col gap-6">
        @if (store.loading_thread()) {
          <div class="flex justify-center py-8" role="status">
            <app-spinner size="sm" [text]="threadCopy.loading"></app-spinner>
          </div>
        }
        @if (divider_anchor() === top_anchor) {
          <ng-container *ngTemplateOutlet="compacted_divider" />
        }
        @for (message of messages(); track message.id) {
          @if (message.role === 'user') {
            <div class="flex flex-col items-end gap-1">
              <div
                class="max-w-xl rounded-2xl bg-surface border px-4 py-2 whitespace-pre-wrap leading-relaxed text-text-primary"
                [class]="message.send_failed ? 'border-error' : 'border-border'"
              >
                {{ message.content }}
              </div>
              @if (message.attachment_ids?.length) {
                <div class="flex flex-wrap justify-end gap-2">
                  @for (handle of message.attachment_ids; track handle) {
                    <button
                      type="button"
                      class="min-h-10 inline-flex items-center gap-2 px-3 rounded-xl border border-border bg-surface text-xs font-medium text-text-primary hover:bg-background"
                      [attr.aria-label]="attachmentCopy.chip"
                      (click)="openAttachment(handle)"
                    >
                      <app-icon name="file-text" [size]="14"></app-icon>
                      {{ attachmentCopy.default_name }}
                    </button>
                  }
                </div>
              }
              @if (message.send_failed) {
                <div
                  class="flex items-center gap-2 flex-wrap justify-end text-sm text-error"
                  role="alert"
                >
                  <app-icon name="alert-triangle" [size]="14"></app-icon>
                  <span>{{ threadCopy.send_failed }}</span>
                  <span aria-hidden="true">·</span>
                  <app-button
                    variant="ghost"
                    size="sm"
                    [disabled]="store.is_agent_typing()"
                    (clicked)="store.retrySend(message.id)"
                  >
                    {{ threadCopy.retry }}
                  </app-button>
                </div>
                @if (message.error) {
                  <p class="max-w-xl text-xs text-text-secondary text-right">
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
                  <vendix-vex-block-host
                    [block]="block"
                    (interaction)="onBlockInteraction(block, $event)"
                  />
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
                    class="rounded-xl border border-error bg-error/10 px-3 py-2 text-sm text-error"
                    role="alert"
                  >
                    {{ message.error }}
                  </p>
                  @if (message.can_retry) {
                    <app-button
                      class="self-start"
                      variant="outline"
                      size="sm"
                      [disabled]="store.is_agent_typing()"
                      (clicked)="store.retryAnswer()"
                    >
                      <app-icon slot="icon" name="rotate-cw" [size]="14"></app-icon>
                      {{ threadCopy.retry }}
                    </app-button>
                  }
                  @if (message.restart_suggested) {
                    <app-button
                      class="self-start"
                      variant="outline"
                      size="sm"
                      (clicked)="store.newConversation()"
                    >
                      {{ restartLabel }}
                    </app-button>
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
                    <span class="w-1.5 h-1.5 rounded-full bg-text-secondary motion-safe:animate-pulse"></span>
                    {{ copy.still_writing }}
                  </p>
                }
                @if (
                  message.streaming &&
                  !message.content &&
                  !message.blocks?.length
                ) {
                  <app-spinner
                    size="sm"
                    color="text-text-secondary"
                    [attr.aria-label]="threadCopy.writing"
                  ></app-spinner>
                }
              </div>
            </div>
          }
          @if (divider_anchor() === message.id) {
            <ng-container *ngTemplateOutlet="compacted_divider" />
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
            class="text-sm text-center text-text-secondary"
          >
            {{ store.stream_progress() }}
          </p>
        }
        @if (store.is_agent_typing()) {
          <div class="flex justify-center">
            <app-button
              variant="outline"
              size="sm"
              [ariaLabel]="threadCopy.stop_aria"
              (clicked)="store.stopStream()"
            >
              <app-icon slot="icon" name="x" [size]="16"></app-icon>
              {{ threadCopy.stop }}
            </app-button>
          </div>
        }
      </div>
    </div>
    <ng-template #compacted_divider>
      <div class="flex items-center gap-3 text-xs text-text-secondary" role="separator">
        <span class="flex-1 h-px bg-border" aria-hidden="true"></span>
        <span>{{ threadCopy.compacted }}</span>
        <app-button variant="ghost" size="xsm" (clicked)="summary_open.set(true)">
          {{ threadCopy.view_summary }}
        </app-button>
        <span class="flex-1 h-px bg-border" aria-hidden="true"></span>
      </div>
    </ng-template>
    <app-modal
      [(isOpen)]="summary_open"
      [title]="threadCopy.summary_title"
      size="md"
      [closeOnBackdrop]="true"
    >
      <p class="whitespace-pre-wrap leading-relaxed text-text-primary">
        {{ store.active_compaction()?.summary }}
      </p>
    </app-modal>
    @if (viewerHandle(); as handle) {
      <vendix-vex-attachment-viewer [handle]="handle" [(isOpen)]="viewerOpen" />
    }
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
  protected readonly threadCopy = VEX_COPY.thread;
  protected readonly restartLabel = VEXI_RESTART_LABEL;
  private readonly injector = inject(Injector);
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  protected readonly attachmentCopy = VEX_COPY.attachment_viewer;
  readonly viewerHandle = signal<string | null>(null);
  readonly viewerOpen = signal(false);

  openAttachment(handle: string): void {
    this.viewerHandle.set(handle);
    this.viewerOpen.set(true);
  }

  readonly messages = () => this.store.active_conversation()?.messages ?? [];

  protected readonly summary_open = signal(false);
  protected readonly top_anchor = '__top__';
  /**
   * Where the «Resumí la conversación anterior» divider goes: after the message
   * the summary covers up to, or at the top when that message is not loaded.
   */
  protected readonly divider_anchor = computed(() => {
    const compaction = this.store.active_compaction();
    if (!compaction) return null;
    const through = compaction.through_message_id;
    return through && this.messages().some((m) => m.id === through)
      ? through
      : this.top_anchor;
  });

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

  onBlockInteraction(
    block: VexUiBlock,
    interaction: VexBlockInteraction,
  ): void {
    this.store.sendBlockInteraction(block.block_id, interaction);
  }
}

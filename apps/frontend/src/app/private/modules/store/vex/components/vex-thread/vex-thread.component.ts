import {
  Component,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  Injector,
  viewChild,
} from '@angular/core';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { VexChatStore } from '../../state/vex-chat.store';
import { VexBlockInteraction, VexUiBlock } from '../../models/vex.models';
import { VexMarkdownComponent } from '../vex-markdown/vex-markdown.component';
import { VexBlockTableComponent } from '../vex-blocks/vex-block-table.component';
import { VexBlockChartComponent } from '../vex-blocks/vex-block-chart.component';
import { VexBlockKpiComponent } from '../vex-blocks/vex-block-kpi.component';
import { VexBlockImageComponent } from '../vex-blocks/vex-block-image.component';
import { VexBlockFileComponent } from '../vex-blocks/vex-block-file.component';
import { VexToolTraceComponent } from '../vex-tool-trace/vex-tool-trace.component';
import { VexPlanCardComponent } from '../vex-plan-card/vex-plan-card.component';

@Component({
  selector: 'vendix-vex-thread',
  standalone: true,
  imports: [
    IconComponent,
    VexMarkdownComponent,
    VexBlockTableComponent,
    VexBlockChartComponent,
    VexBlockKpiComponent,
    VexBlockImageComponent,
    VexBlockFileComponent,
    VexToolTraceComponent,
    VexPlanCardComponent,
  ],
  template: `
    <div
      #scroller
      class="h-full overflow-y-auto"
      role="log"
      aria-live="polite"
    >
      <div class="max-w-3xl mx-auto w-full px-4 py-4 flex flex-col gap-6">
        @if (store.loading_thread()) {
          <div class="flex items-center justify-center gap-2 py-8 text-[var(--color-text-secondary)]">
            <app-icon name="loader-2" [size]="18" [spin]="true"></app-icon>
            <span class="text-sm">Abriendo conversación…</span>
          </div>
        }
        @for (message of messages(); track message.id) {
          @if (message.role === 'user') {
            <div class="flex justify-end">
              <div
                class="max-w-[80%] rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] px-4 py-2 whitespace-pre-wrap leading-relaxed text-[var(--color-text-primary)]"
              >
                {{ message.content }}
              </div>
            </div>
          } @else {
            <div class="flex items-start gap-3 min-w-0">
              <img
                src="assets/vex/vexicon-96.webp"
                alt=""
                class="w-7 h-7 object-contain shrink-0"
              />
              <div class="flex-1 min-w-0 flex flex-col gap-3">
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
                    [busy]="store.busy_plan_id() === message.plan.plan_id"
                    (approve)="store.approvePlan(message.id, message.plan.plan_id)"
                    (cancel)="store.cancelPlan(message.id, message.plan.plan_id)"
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
                @if (message.error) {
                  <p
                    class="rounded-xl border border-[var(--color-error,#dc2626)] bg-[rgba(220,38,38,0.07)] px-3 py-2 text-sm text-[var(--color-error,#dc2626)]"
                    role="alert"
                  >
                    {{ message.error }}
                  </p>
                }
                @if (message.streaming && !message.content && !(message.blocks?.length)) {
                  <div class="flex items-center gap-1 py-1" aria-label="Vex está escribiendo">
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

  onBlockInteraction(block: VexUiBlock, interaction: VexBlockInteraction): void {
    this.store.sendBlockInteraction(block.block_id, interaction);
  }
}

import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AIFeatureFlags } from '../interfaces/subscription-admin.interface';
import { ToggleComponent, InputComponent, MultiSelectorComponent } from '../../../../../shared/components';

@Component({
  selector: 'app-ai-feature-matrix',
  standalone: true,
  imports: [FormsModule, ToggleComponent, InputComponent, MultiSelectorComponent],
  template: `
    <div class="space-y-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="flex items-center justify-between p-3 bg-surface rounded-lg border border-border">
          <span class="text-sm font-medium text-text-primary">Chat</span>
          <app-toggle [(ngModel)]="flags.chat_enabled" (ngModelChange)="emitChange()"></app-toggle>
        </div>
        <div class="flex items-center justify-between p-3 bg-surface rounded-lg border border-border">
          <span class="text-sm font-medium text-text-primary">Embeddings</span>
          <app-toggle [(ngModel)]="flags.embeddings_enabled" (ngModelChange)="emitChange()"></app-toggle>
        </div>
        <div class="flex items-center justify-between p-3 bg-surface rounded-lg border border-border">
          <span class="text-sm font-medium text-text-primary">Agent</span>
          <app-toggle [(ngModel)]="flags.agent_enabled" (ngModelChange)="emitChange()"></app-toggle>
        </div>
        <div class="flex items-center justify-between p-3 bg-surface rounded-lg border border-border">
          <span class="text-sm font-medium text-text-primary">RAG</span>
          <app-toggle [(ngModel)]="flags.rag_enabled" (ngModelChange)="emitChange()"></app-toggle>
        </div>
        <div class="flex items-center justify-between p-3 bg-surface rounded-lg border border-border">
          <span class="text-sm font-medium text-text-primary">Streaming</span>
          <app-toggle [(ngModel)]="flags.streaming_enabled" (ngModelChange)="emitChange()"></app-toggle>
        </div>
        <div class="flex items-center justify-between p-3 bg-surface rounded-lg border border-border">
          <span class="text-sm font-medium text-text-primary">Custom Tools</span>
          <app-toggle [(ngModel)]="flags.custom_tools_enabled" (ngModelChange)="emitChange()"></app-toggle>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <app-input
          label="Max Tokens/Month"
          type="number"
          [(ngModel)]="flags.max_tokens_per_month"
          (ngModelChange)="emitChange()"
        ></app-input>
        <app-input
          label="Max Conversations"
          type="number"
          [(ngModel)]="flags.max_conversations"
          (ngModelChange)="emitChange()"
        ></app-input>
      </div>

      <div>
        <label class="block text-sm font-medium text-text-primary mb-2">Allowed Models</label>
        <app-multi-selector
          [options]="modelOptions"
          [(ngModel)]="flags.allowed_models"
          (ngModelChange)="emitChange()"
          placeholder="Select models..."
        ></app-multi-selector>
      </div>
    </div>
  `,
})
export class AiFeatureMatrixComponent {
  flags: AIFeatureFlags = {
    chat_enabled: true,
    embeddings_enabled: true,
    agent_enabled: false,
    rag_enabled: true,
    streaming_enabled: true,
    max_tokens_per_month: 100000,
    max_conversations: 500,
    allowed_models: [],
    custom_tools_enabled: false,
  };

  readonly initialValue = input<AIFeatureFlags | undefined>(undefined);
  readonly valueChange = output<AIFeatureFlags>();

  readonly modelOptions = [
    { value: 'gpt-4', label: 'GPT-4' },
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
    { value: 'claude-3-opus', label: 'Claude 3 Opus' },
    { value: 'claude-3-sonnet', label: 'Claude 3 Sonnet' },
    { value: 'gemini-pro', label: 'Gemini Pro' },
  ];

  constructor() {
    const initial = this.initialValue();
    if (initial) {
      this.flags = { ...initial };
    }
  }

  emitChange(): void {
    this.valueChange.emit({ ...this.flags });
  }
}

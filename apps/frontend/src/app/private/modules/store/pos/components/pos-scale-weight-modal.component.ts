import {
  Component,
  EventEmitter,
  Input,
  Output,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../shared/components/input/input.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { PosScaleService } from '../services/pos-scale.service';
import { ScaleConnectionStatus } from '../../../../../core/models/store-settings.interface';

@Component({
  selector: 'app-pos-scale-weight-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    IconComponent,
  ],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      [title]="title"
      size="sm"
      [showCloseButton]="true"
      (isOpenChange)="onModalClose()"
    >
      <div class="scale-modal-body">
        <!-- Product info -->
        <p *ngIf="message" class="text-sm text-text-secondary mb-4 whitespace-pre-line">{{ message }}</p>

        <!-- Scale reading display -->
        <div *ngIf="connectionStatus === 'connected'" class="scale-reading-container">
          <div class="scale-reading-display">
            <span class="scale-reading-value">{{ currentWeight | number:'1.3-3' }}</span>
            <span class="scale-reading-unit">{{ weightUnit }}</span>
          </div>
          <div class="scale-status-indicator" [class.stable]="isStable" [class.unstable]="!isStable">
            <app-icon [name]="isStable ? 'check-circle' : 'loader'" [size]="16"></app-icon>
            <span>{{ isStable ? 'Lectura estable' : 'Estabilizando...' }}</span>
          </div>
        </div>

        <!-- Disconnected / error states -->
        <div *ngIf="connectionStatus !== 'connected'" class="scale-disconnected">
          <div class="disconnected-notice">
            <app-icon name="alert-triangle" [size]="20" class="text-warning"></app-icon>
            <span class="text-sm text-text-secondary">
              {{ connectionStatus === 'connecting' ? 'Conectando báscula...' : 'Báscula desconectada' }}
            </span>
          </div>

          <!-- Manual fallback input -->
          <div *ngIf="allowManualFallback && connectionStatus !== 'connecting'" class="manual-fallback">
            <label class="text-xs text-text-secondary mb-1 block">Peso manual:</label>
            <app-input
              [placeholder]="'Peso en ' + weightUnit"
              [(ngModel)]="manualWeight"
              (keyup.enter)="onConfirm()"
              type="number"
              step="0.001"
              min="0"
            ></app-input>
          </div>
        </div>
      </div>

      <div slot="footer" class="modal-footer flex justify-end gap-2 md:gap-4">
        <app-button variant="outline" (clicked)="onCancel()">Cancelar</app-button>
        <app-button
          variant="primary"
          (clicked)="onConfirm()"
          [disabled]="!canConfirm"
        >
          Confirmar
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [`
    .scale-modal-body {
      padding: 1rem 0;
    }

    .scale-reading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.75rem;
      padding: 1.5rem 0;
    }

    .scale-reading-display {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      padding: 1rem 2rem;
      border-radius: 12px;
      border: 2px solid var(--color-border);
      background: var(--color-muted);
    }

    .scale-reading-value {
      font-size: 2.5rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: var(--color-text-primary);
      line-height: 1;
    }

    .scale-reading-unit {
      font-size: 1.25rem;
      font-weight: 500;
      color: var(--color-text-secondary);
    }

    .scale-status-indicator {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      font-size: 0.8125rem;
      font-weight: 500;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
    }

    .scale-status-indicator.stable {
      color: var(--color-success, #22c55e);
      background: rgba(34, 197, 94, 0.1);
    }

    .scale-status-indicator.unstable {
      color: var(--color-warning, #f59e0b);
      background: rgba(245, 158, 11, 0.1);
    }

    .scale-disconnected {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      padding: 1rem 0;
    }

    .disconnected-notice {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      background: rgba(245, 158, 11, 0.08);
      border: 1px solid rgba(245, 158, 11, 0.2);
    }

    .manual-fallback {
      padding-top: 0.5rem;
    }
  `],
})
export class PosScaleWeightModalComponent implements OnInit, OnDestroy {
  @Input() title = 'Lectura de Báscula';
  @Input() message = '';
  @Input() weightUnit = 'kg';
  @Input() allowManualFallback = true;
  @Input() size: 'sm' | 'md' | 'lg' = 'sm';
  @Input() showCloseButton = true;
  @Input() customClasses = '';

  @Output() confirm = new EventEmitter<number>();
  @Output() cancel = new EventEmitter<void>();

  isOpen = true;
  currentWeight = 0;
  isStable = false;
  connectionStatus: ScaleConnectionStatus = 'disconnected';
  manualWeight = '';

  private destroy$ = new Subject<void>();

  constructor(private scaleService: PosScaleService) {}

  ngOnInit(): void {
    this.scaleService.weight$
      .pipe(takeUntil(this.destroy$))
      .subscribe(w => this.currentWeight = w);

    this.scaleService.stable$
      .pipe(takeUntil(this.destroy$))
      .subscribe(s => this.isStable = s);

    this.scaleService.status$
      .pipe(takeUntil(this.destroy$))
      .subscribe(st => this.connectionStatus = st);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get canConfirm(): boolean {
    if (this.connectionStatus === 'connected') {
      return this.isStable && this.currentWeight > 0;
    }
    if (this.allowManualFallback && this.manualWeight) {
      const val = parseFloat(this.manualWeight.replace(',', '.'));
      return !isNaN(val) && val > 0;
    }
    return false;
  }

  onConfirm(): void {
    if (!this.canConfirm) return;

    let weight: number;
    if (this.connectionStatus === 'connected') {
      weight = this.currentWeight;
    } else {
      weight = parseFloat(this.manualWeight.replace(',', '.'));
    }

    this.confirm.emit(weight);
    this.isOpen = false;
  }

  onCancel(): void {
    this.cancel.emit();
    this.isOpen = false;
  }

  onModalClose(): void {
    if (!this.isOpen) {
      this.cancel.emit();
    }
  }
}

import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { EnvironmentContextService } from '../../../core/services/environment-context.service';
import { AppEnvironment } from '../../../core/models/domain-config.interface';

@Component({
  selector: 'app-environment-indicator',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="environment-indicator" [ngClass]="environmentClass">
      <div class="indicator-content">
        <div class="environment-icon">
          <i [class]="environmentIcon"></i>
        </div>
        <div class="environment-info">
          <span class="environment-label">{{ environmentLabel }}</span>
          @if (context?.organizationSlug || context?.storeSlug) {
            <span class="environment-name">
              {{ context?.organizationSlug || context?.storeSlug }}
            </span>
          }
        </div>
        @if (showSwitchButton) {
          <div class="environment-actions">
            <button
              class="switch-btn"
              (click)="onSwitchEnvironment()"
              [disabled]="!canSwitch"
              title="Cambiar de entorno"
            >
              <i class="fas fa-exchange-alt"></i>
            </button>
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .environment-indicator {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 1000;
        border-radius: 8px;
        padding: 8px 12px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        backdrop-filter: blur(10px);
        transition: all 0.3s ease;
        min-width: 200px;
      }

      .environment-indicator.organization {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
      }

      .environment-indicator.store {
        background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
        color: white;
      }

      .environment-indicator.vendix {
        background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
        color: white;
      }

      .indicator-content {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .environment-icon {
        font-size: 16px;
        opacity: 0.9;
      }

      .environment-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .environment-label {
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .environment-name {
        font-size: 11px;
        opacity: 0.8;
        font-weight: 500;
      }

      .environment-actions {
        margin-left: 8px;
      }

      .switch-btn {
        background: rgba(255, 255, 255, 0.2);
        border: 1px solid rgba(255, 255, 255, 0.3);
        border-radius: 4px;
        padding: 4px 8px;
        color: white;
        cursor: pointer;
        transition: all 0.2s ease;
        font-size: 12px;
      }

      .switch-btn:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.3);
        transform: translateY(-1px);
      }

      .switch-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      @media (max-width: 768px) {
        .environment-indicator {
          top: 10px;
          right: 10px;
          min-width: 160px;
          padding: 6px 10px;
        }

        .environment-label {
          font-size: 11px;
        }

        .environment-name {
          font-size: 10px;
        }
      }
    `,
  ],
})
export class EnvironmentIndicatorComponent implements OnInit, OnDestroy {
  private environmentContextService = inject(EnvironmentContextService);
  private destroy$ = new Subject<void>();

  context: any = null;
  environmentClass = '';
  environmentIcon = 'fas fa-question';
  environmentLabel = 'Entorno Desconocido';
  showSwitchButton = false;
  canSwitch = false;

  ngOnInit(): void {
    this.loadEnvironmentContext();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadEnvironmentContext(): void {
    this.environmentContextService
      .getCurrentEnvironmentContext()
      .pipe(takeUntil(this.destroy$))
      .subscribe((context) => {
        this.context = context;
        this.updateEnvironmentDisplay(context);
      });
  }

  private updateEnvironmentDisplay(context: any): void {
    switch (context.currentEnvironment) {
      case AppEnvironment.ORG_ADMIN:
        this.environmentClass = 'organization';
        this.environmentIcon = 'fas fa-building';
        this.environmentLabel = 'Organización';
        this.showSwitchButton = context.canSwitchToStore;
        this.canSwitch = context.canSwitchToStore;
        break;

      case AppEnvironment.STORE_ADMIN:
        this.environmentClass = 'store';
        this.environmentIcon = 'fas fa-store';
        this.environmentLabel = 'Tienda';
        this.showSwitchButton = context.canSwitchToOrganization;
        this.canSwitch = context.canSwitchToOrganization;
        break;

      case AppEnvironment.VENDIX_ADMIN:
        this.environmentClass = 'vendix';
        this.environmentIcon = 'fas fa-crown';
        this.environmentLabel = 'Vendix Admin';
        this.showSwitchButton = false;
        this.canSwitch = false;
        break;

      default:
        this.environmentClass = '';
        this.environmentIcon = 'fas fa-question';
        this.environmentLabel = 'Entorno Desconocido';
        this.showSwitchButton = false;
        this.canSwitch = false;
    }
  }

  onSwitchEnvironment(): void {
    // Emitir evento para que el componente padre maneje el switch
    console.log('Switch environment requested', this.context);

    // Opcional: disparar un evento personalizado
    const event = new CustomEvent('switchEnvironment', {
      detail: { context: this.context },
    });
    window.dispatchEvent(event);
  }
}

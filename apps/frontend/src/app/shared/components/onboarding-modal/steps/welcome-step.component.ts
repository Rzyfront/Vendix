import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../index';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { OnboardingWizardService } from '../../../../core/services/onboarding-wizard.service';
import { ConfigFacade } from '../../../../core/store/config/config.facade';
import { AppConfig } from '../../../../core/services/app-config.service';
import { takeUntil } from 'rxjs';
import { Subject } from 'rxjs';

@Component({
  selector: 'app-welcome-step',
  standalone: true,
  imports: [CommonModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      /* ============================================
         MOBILE-FIRST WELCOME STEP DESIGN
         Inspired by modern mobile onboarding patterns
         ============================================ */

      :host {
        display: block;
        height: 100%;
      }

      .welcome-step {
        display: flex;
        flex-direction: column;
        height: 100%;
        max-height: 70vh;
        overflow: hidden;
      }

      /* Scrollable content area */
      .welcome-content {
        flex: 1;
        overflow-y: auto;
        padding: 0 0.5rem;
        -webkit-overflow-scrolling: touch;
      }

      /* Custom scrollbar for webkit browsers */
      .welcome-content::-webkit-scrollbar {
        width: 4px;
      }

      .welcome-content::-webkit-scrollbar-thumb {
        background: var(--color-border);
        border-radius: 10px;
      }

      /* ============================================
         HEADER SECTION
         ============================================ */

      .welcome-header {
        text-align: center;
        padding: 1rem 0;
      }

      .welcome-icon-wrapper {
        margin-bottom: 0.75rem;
      }

      .welcome-icon-bg {
        width: 56px;
        height: 56px;
        background: var(--color-primary-light);
        border-radius: 50%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        animation: welcomePop 0.6s ease-out;
      }

      @keyframes welcomePop {
        0% {
          transform: scale(0);
          opacity: 0;
        }
        50% {
          transform: scale(1.1);
        }
        100% {
          transform: scale(1);
          opacity: 1;
        }
      }

      .welcome-title {
        font-size: 1.5rem;
        font-weight: 700;
        color: var(--color-text-primary);
        margin: 0 0 0.25rem 0;
      }

      .welcome-greeting {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--color-text-secondary);
        margin-bottom: 0.5rem;
      }

      .welcome-subtitle {
        font-size: 0.75rem;
        color: var(--color-text-muted);
        line-height: 1.5;
        margin: 0;
        padding: 0 1rem;
      }

      /* ============================================
         CONTEXT INFO BOX
         ============================================ */

      .welcome-context {
        background: var(--color-primary-light);
        border: 1px solid color-mix(in srgb, var(--color-primary) 30%, transparent);
        border-radius: 0.75rem;
        padding: 0.75rem;
        margin: 1rem 0;
        display: flex;
        gap: 0.75rem;
        align-items: flex-start;
      }

      .context-icon-wrapper {
        flex-shrink: 0;
      }

      .context-content h3 {
        font-size: 0.875rem;
        font-weight: 700;
        color: var(--color-text-primary);
        margin: 0 0 0.25rem 0;
      }

      .context-content p {
        font-size: 0.6875rem;
        color: var(--color-text-secondary);
        line-height: 1.5;
        margin: 0;
      }

      /* ============================================
         BUSINESS TYPE CARDS
         ============================================ */

      .business-type-selector {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        margin-bottom: 1rem;
      }

      .business-type-option {
        background: var(--color-surface);
        border: 2px solid var(--color-border);
        border-radius: 1rem;
        padding: 1rem;
        cursor: pointer;
        transition: all 0.2s ease;
        text-align: left;
      }

      .business-type-option:hover {
        border-color: color-mix(in srgb, var(--color-primary) 50%, transparent);
      }

      .business-type-option:active {
        transform: scale(0.98);
      }

      .business-type-option.selected {
        border-color: var(--color-primary);
        background: var(--color-primary-light);
      }

      .option-header {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 0.75rem;
      }

      .option-icon-wrapper {
        width: 44px;
        height: 44px;
        border-radius: 0.75rem;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: transform 0.2s ease;
      }

      .option-icon-wrapper.store-icon {
        background: var(--color-primary-light);
      }

      .option-icon-wrapper.org-icon {
        background: color-mix(in srgb, var(--color-info) 15%, transparent);
      }

      .business-type-option:hover .option-icon-wrapper {
        transform: scale(1.1);
      }

      .option-text h4 {
        font-size: 0.875rem;
        font-weight: 700;
        color: var(--color-text-primary);
        margin: 0 0 0.125rem 0;
      }

      .option-text p {
        font-size: 0.625rem;
        color: var(--color-text-muted);
        margin: 0;
        line-height: 1.4;
      }

      /* Feature list */
      .feature-list {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }

      .feature-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.6875rem;
        color: var(--color-text-secondary);
      }

      .feature-icon {
        flex-shrink: 0;
      }

      /* ============================================
         FOOTER - Security Notice
         ============================================ */

      .welcome-footer {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        padding: 0.75rem 0;
      }

      .footer-text {
        font-size: 0.625rem;
        color: var(--color-text-muted);
        margin: 0;
      }

      /* ============================================
         DESKTOP RESPONSIVE ADJUSTMENTS
         ============================================ */

      @media (min-width: 768px) {
        .welcome-step {
          max-height: none;
        }

        .welcome-content {
          padding: 0 1rem;
        }

        .welcome-header {
          padding: 1.5rem 0;
        }

        .welcome-icon-bg {
          width: 64px;
          height: 64px;
        }

        .welcome-title {
          font-size: 1.75rem;
        }

        .welcome-greeting {
          font-size: 1rem;
        }

        .welcome-subtitle {
          font-size: 0.875rem;
          max-width: 400px;
          margin: 0 auto;
          padding: 0;
        }

        .welcome-context {
          padding: 1rem;
          max-width: 500px;
          margin: 1.5rem auto;
        }

        .context-content h3 {
          font-size: 1rem;
        }

        .context-content p {
          font-size: 0.75rem;
        }

        .business-type-selector {
          flex-direction: row;
          gap: 1rem;
          max-width: 700px;
          margin: 0 auto 1.5rem;
        }

        .business-type-option {
          flex: 1;
          padding: 1.25rem;
        }

        .option-icon-wrapper {
          width: 52px;
          height: 52px;
        }

        .option-text h4 {
          font-size: 1rem;
        }

        .option-text p {
          font-size: 0.75rem;
        }

        .feature-item {
          font-size: 0.75rem;
        }

        .welcome-footer {
          padding: 1rem 0;
        }

        .footer-text {
          font-size: 0.75rem;
        }

      }
    `,
  ],
  template: `
    <div class="welcome-step">
      <!-- Scrollable Content -->
      <div class="welcome-content">
        <!-- Welcome Header -->
        <div class="welcome-header">


          <h1 class="welcome-title">Bienvenido a Vendix</h1>

          <p class="welcome-greeting">
            ¡Hola, {{ userFirstName }}!
          </p>

          <p class="welcome-subtitle">
            Estás a punto de configurar tu negocio en menos de 5 minutos.
            Te guiaremos paso a paso.
          </p>
        </div>

        <!-- Context Information -->
        <div class="welcome-context">
          <div class="context-icon-wrapper">
            <app-icon
              name="info"
              size="20"
              [color]="primaryColor"
            ></app-icon>
          </div>
          <div class="context-content">
            <h3>¿Qué estás haciendo?</h3>
            <p>
              Configuraremos tu tienda, organización y preferencias para
              que puedas vender hoy mismo.
            </p>
          </div>
        </div>

        <!-- Business Type Selection -->
        <div class="business-type-selector">
          <!-- Single Store Option -->
          <button
            type="button"
            class="business-type-option"
            [class.selected]="selectedType === 'STORE'"
            (click)="onSelectType('STORE')"
          >
            <div class="option-header">
              <div class="option-icon-wrapper store-icon">
                <app-icon
                  name="store"
                  size="24"
                  [color]="primaryColor"
                ></app-icon>
              </div>
              <div class="option-text">
                <h4>Gestionar una tienda</h4>
                <p>Ideal para un solo negocio o punto de venta.</p>
              </div>
            </div>

            <div class="feature-list">
              <div class="feature-item">
                <app-icon
                  name="check-circle"
                  size="14"
                  class="feature-icon"
                  [color]="primaryColor"
                ></app-icon>
                <span>Configuración rápida y sencilla</span>
              </div>
              <div class="feature-item">
                <app-icon
                  name="check-circle"
                  size="14"
                  class="feature-icon"
                  [color]="primaryColor"
                ></app-icon>
                <span>Todo en 3 pasos básicos</span>
              </div>
            </div>
          </button>

          <!-- Organization Option -->
          <button
            type="button"
            class="business-type-option"
            [class.selected]="selectedType === 'ORGANIZATION'"
            (click)="onSelectType('ORGANIZATION')"
          >
            <div class="option-header">
              <div class="option-icon-wrapper org-icon">
                <app-icon
                  name="building"
                  size="24"
                  color="#3B82F6"
                ></app-icon>
              </div>
              <div class="option-text">
                <h4>Enfoque organizacional</h4>
                <p>Para múltiples tiendas, sucursales y escalabilidad.</p>
              </div>
            </div>

            <div class="feature-list">
              <div class="feature-item">
                <app-icon
                  name="check-circle"
                  size="14"
                  class="feature-icon"
                  [color]="primaryColor"
                ></app-icon>
                <span>Múltiples tiendas y sucursales</span>
              </div>
              <div class="feature-item">
                <app-icon
                  name="check-circle"
                  size="14"
                  class="feature-icon"
                  [color]="primaryColor"
                ></app-icon>
                <span>Reportes consolidados</span>
              </div>
            </div>
          </button>
        </div>

        <!-- Security Footer -->
        <div class="welcome-footer">
          <app-icon
            name="shield-check"
            size="14"
            [color]="primaryColor"
          ></app-icon>
          <p class="footer-text">
            Tus datos están seguros y puedes cambiarlos luego.
          </p>
        </div>
      </div>
    </div>
  `,
})
export class WelcomeStepComponent implements OnInit {
  @Input() userFirstName: string = 'Usuario';
  @Output() businessTypeSelected = new EventEmitter<{
    type: 'STORE' | 'ORGANIZATION';
  }>();
  @Output() selectionChanged = new EventEmitter<'STORE' | 'ORGANIZATION' | null>();
  @Output() skipSetup = new EventEmitter<void>();
  @Output() nextStep = new EventEmitter<void>();

  private destroy$ = new Subject<void>();
  primaryColor = '#7ed7a5';
  secondaryColor = '#2f6f4e';
  accentColor = '#06b6d4';

  /** Currently selected business type (for two-step selection UX) */
  selectedType: 'STORE' | 'ORGANIZATION' | null = null;

  constructor(
    private authFacade: AuthFacade,
    private wizardService: OnboardingWizardService,
    private configFacade: ConfigFacade,
  ) { }

  ngOnInit(): void {
    this.loadThemeColors();
    this.initializeWizardData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadThemeColors(): void {
    // Suscribirse a los colores del tema de la app
    this.configFacade.appConfig$
      .pipe(takeUntil(this.destroy$))
      .subscribe((config: AppConfig | null) => {
        if (config?.branding?.colors) {
          // Usar colores del branding dinámico si existen, sino usar los de Vendix
          this.primaryColor = config.branding.colors.primary || '#7ed7a5';
          this.secondaryColor = config.branding.colors.secondary || '#2f6f4e';
          this.accentColor = config.branding.colors.accent || '#06b6d4';
        }
      });
  }

  private initializeWizardData(): void {
    // Cargar datos iniciales del wizard
    this.wizardService.getWizardData();
  }

  /**
   * Select a business type and automatically proceed to next step
   */
  onSelectType(type: 'STORE' | 'ORGANIZATION'): void {
    this.selectedType = type;
    this.selectionChanged.emit(type);
    // Automatically advance when type is selected
    this.businessTypeSelected.emit({ type });
  }

  /**
   * Continue to next step after type selection
   */
  onContinue(): void {
    if (this.selectedType) {
      this.businessTypeSelected.emit({ type: this.selectedType });
      this.nextStep.emit();
    }
  }

  /**
   * Legacy method for backwards compatibility
   */
  selectBusinessType(type: 'STORE' | 'ORGANIZATION'): void {
    this.selectedType = type;
    this.onContinue();
  }

  onNextStep(): void {
    this.nextStep.emit();
  }

  onSkipSetup(): void {
    this.skipSetup.emit();
  }
}

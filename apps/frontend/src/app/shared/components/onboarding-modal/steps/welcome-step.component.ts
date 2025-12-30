import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent, IconComponent } from '../../index';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { OnboardingWizardService } from '../../../../core/services/onboarding-wizard.service';
import { ConfigFacade } from '../../../../core/store/config/config.facade';
import { AppConfig } from '../../../../core/services/app-config.service';
import { takeUntil } from 'rxjs';
import { Subject } from 'rxjs';

@Component({
  selector: 'app-welcome-step',
  standalone: true,
  imports: [CommonModule, ButtonComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .welcome-step {
        padding: 1rem 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .welcome-container {
        max-width: 100%;
        margin: 0 auto;
        padding: 0;
        text-align: center;
      }

      .welcome-header {
        margin-bottom: 1.5rem;
      }

      .welcome-icon-wrapper {
        margin-bottom: 1rem;
      }

      .welcome-icon-bg {
        width: 72px;
        height: 72px;
        background: linear-gradient(
          135deg,
          var(--color-primary) 0%,
          var(--color-secondary) 100%
        );
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto;
        box-shadow: var(--shadow-lg);
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

      .welcome-icon {
        color: var(--color-text-on-primary);
      }

      .welcome-title {
        font-size: var(--fs-2xl);
        font-weight: var(--fw-bold);
        color: var(--color-text-primary);
        margin-bottom: 0.5rem;
        background: linear-gradient(
          135deg,
          var(--color-primary) 0%,
          var(--color-secondary) 100%
        );
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .welcome-greeting {
        font-size: var(--fs-lg);
        font-weight: var(--fw-semibold);
        color: var(--color-text-primary);
        margin-bottom: 0.25rem;
      }

      .welcome-subtitle {
        font-size: var(--fs-base);
        color: var(--color-text-secondary);
        line-height: 1.5;
        margin-bottom: 1.5rem;
        max-width: 500px;
        margin-left: auto;
        margin-right: auto;
      }

      .welcome-context {
        background: var(--color-primary-light);
        border: 1px solid var(--color-primary);
        border-radius: var(--radius-lg);
        padding: 1rem;
        margin-bottom: 1.5rem;
        max-width: 600px;
        margin-left: auto;
        margin-right: auto;
      }

      .context-header {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
      }

      .context-icon {
        width: 32px;
        height: 32px;
        background: var(--color-surface);
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .context-icon-element {
        color: var(--color-primary);
      }

      .context-title {
        font-size: var(--fs-base);
        font-weight: var(--fw-semibold);
        color: var(--color-text-primary);
        margin: 0;
      }

      .context-text {
        font-size: var(--fs-sm);
        color: var(--color-text-secondary);
        line-height: 1.5;
      }

      .business-type-selector {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 1rem;
        margin-bottom: 1.5rem;
        max-width: 800px;
        margin-left: auto;
        margin-right: auto;
      }

      .business-type-option {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        padding: 1.25rem;
        cursor: pointer;
        transition: all var(--transition-fast) ease;
        position: relative;
        overflow: hidden;
      }

      .business-type-option::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 3px;
        background: var(--color-border);
        transition: all var(--transition-fast) ease;
      }

      .business-type-option:hover {
        border-color: var(--color-primary);
        transform: translateY(-2px);
        box-shadow: var(--shadow-md);
      }

      .business-type-option:hover::before {
        background: var(--color-primary);
      }

      .business-type-icon {
        width: 56px;
        height: 56px;
        background: var(--color-primary-light);
        border-radius: var(--radius-md);
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto 1rem;
        border: 1px solid var(--color-primary);
      }

      .type-icon-element {
        color: var(--color-primary);
      }

      .business-type-title {
        font-size: var(--fs-lg);
        font-weight: var(--fw-bold);
        color: var(--color-text-primary);
        margin-bottom: 0.5rem;
      }

      .business-type-description {
        font-size: var(--fs-sm);
        color: var(--color-text-secondary);
        line-height: 1.5;
        margin-bottom: 0.75rem;
      }

      .business-type-features {
        text-align: left;
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }

      .feature-item {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: var(--fs-xs);
        color: var(--color-text-primary);
      }

      .feature-icon {
        color: var(--color-primary);
        flex-shrink: 0;
      }

      .business-action {
        margin-top: 1rem;
      }

      .action-button {
        min-width: 180px;
        padding: 0.75rem 1.5rem;
      }

      .welcome-footer {
        margin-top: 1rem;
        padding: 0.75rem;
        background: var(--color-background);
        border-radius: var(--radius-md);
        border: 1px solid var(--color-border);
        max-width: 500px;
        margin-left: auto;
        margin-right: auto;
      }

      .footer-text {
        font-size: var(--fs-xs);
        color: var(--color-text-secondary);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.375rem;
      }

      .footer-icon {
        color: var(--color-primary);
      }

      @media (max-width: 768px) {
        .business-type-selector {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
  template: `
    <div class="welcome-step">
      <div class="welcome-container">
        <!-- Welcome Header -->
        <div class="welcome-header">
          <div class="welcome-icon-wrapper">
            <div class="welcome-icon-bg">
              <app-icon
                name="sparkles"
                size="64"
                class="welcome-icon"
                [color]="'#ffffff'"
              ></app-icon>
            </div>
          </div>

          <h1 class="welcome-title">¡Bienvenido a Vendix! 🎉</h1>

          <div class="welcome-greeting">
            ¡Hola, <span class="user-name">{{ userFirstName }}!</span>
          </div>

          <p class="welcome-subtitle">
            Estás a punto de configurar tu negocio en menos de 5 minutos. Te
            guiaremos paso a paso para que todo quede perfecto.
          </p>
        </div>

        <!-- Context Information -->
        <div class="welcome-context">
          <div class="context-header">
            <div class="context-icon">
              <app-icon
                name="info"
                size="20"
                class="context-icon-element"
                [color]="primaryColor"
              ></app-icon>
            </div>
            <h3 class="context-title">¿Qué estás haciendo?</h3>
          </div>
          <p class="context-text">
            Estás en el asistente de configuración inicial de Vendix. Aquí
            configuraremos tu tienda, organización y preferencias para que
            puedas empezar a vender hoy mismo.
          </p>
        </div>

        <!-- Business Type Selection -->
        <div class="business-type-selector">
          <!-- Single Store Option -->
          <div
            class="business-type-option"
            (click)="selectBusinessType('STORE')"
          >
            <div class="business-type-icon">
              <app-icon
                name="store"
                size="40"
                class="type-icon-element"
                [color]="primaryColor"
              ></app-icon>
            </div>

            <h3 class="business-type-title">Gestionar una tienda</h3>

            <p class="business-type-description">
              Perfecto si tienes un solo negocio o punto de venta. Configura
              todo lo necesario para empezar a vender rápidamente.
            </p>

            <div class="business-type-features">
              <div class="feature-item">
                <app-icon
                  name="check-circle"
                  size="16"
                  class="feature-icon"
                  [color]="primaryColor"
                ></app-icon>
                <span>Configuración rápida y sencilla</span>
              </div>
              <div class="feature-item">
                <app-icon
                  name="check-circle"
                  size="16"
                  class="feature-icon"
                  [color]="primaryColor"
                ></app-icon>
                <span>Todo en 3 pasos básicos</span>
              </div>
              <div class="feature-item">
                <app-icon
                  name="check-circle"
                  size="16"
                  class="feature-icon"
                  [color]="primaryColor"
                ></app-icon>
                <span>Funcionalidad completa de tienda</span>
              </div>
            </div>
          </div>

          <!-- Organization Option -->
          <div
            class="business-type-option"
            (click)="selectBusinessType('ORGANIZATION')"
          >
            <div class="business-type-icon">
              <app-icon
                name="building"
                size="40"
                class="type-icon-element"
                [color]="secondaryColor"
              ></app-icon>
            </div>

            <h3 class="business-type-title">Enfoque organizacional</h3>

            <p class="business-type-description">
              Ideal si tienes múltiples tiendas, sucursales o planeas escalar tu
              negocio. Gestiona todo desde un panel central.
            </p>

            <div class="business-type-features">
              <div class="feature-item">
                <app-icon
                  name="check-circle"
                  size="16"
                  class="feature-icon"
                  [color]="secondaryColor"
                ></app-icon>
                <span>Múltiples tiendas y sucursales</span>
              </div>
              <div class="feature-item">
                <app-icon
                  name="check-circle"
                  size="16"
                  class="feature-icon"
                  [color]="secondaryColor"
                ></app-icon>
                <span>Manejo de usuarios y roles</span>
              </div>
              <div class="feature-item">
                <app-icon
                  name="check-circle"
                  size="16"
                  class="feature-icon"
                  [color]="secondaryColor"
                ></app-icon>
                <span>Reportes consolidados</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Action Button -->
        <div class="business-action">
          <app-button
            variant="outline"
            size="lg"
            (clicked)="onSkipSetup()"
            class="action-button"
          >
            <app-icon name="arrow-right" size="20" slot="icon"></app-icon>
            Omitir configuración por ahora
          </app-button>
        </div>

        <!-- Footer -->
        <div class="welcome-footer">
          <p class="footer-text">
            <app-icon
              name="shield-check"
              size="16"
              class="footer-icon"
              [color]="primaryColor"
            ></app-icon>
            Tus datos están seguros y puedes cambiar tu configuración en
            cualquier momento
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
  @Output() skipSetup = new EventEmitter<void>();
  @Output() nextStep = new EventEmitter<void>();

  private destroy$ = new Subject<void>();
  primaryColor = '#7ed7a5';
  secondaryColor = '#2f6f4e';
  accentColor = '#06b6d4';

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

  selectBusinessType(type: 'STORE' | 'ORGANIZATION'): void {
    this.businessTypeSelected.emit({ type });
    this.nextStep.emit();
  }

  onNextStep(): void {
    this.nextStep.emit();
  }

  onSkipSetup(): void {
    this.skipSetup.emit();
  }
}

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
        padding: 2rem 0;
        min-height: 600px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .welcome-container {
        max-width: 900px;
        margin: 0 auto;
        padding: 0 1.5rem;
        text-align: center;
      }

      .welcome-header {
        margin-bottom: 3rem;
      }

      .welcome-icon-wrapper {
        margin-bottom: 2rem;
      }

      .welcome-icon-bg {
        width: 120px;
        height: 120px;
        background: linear-gradient(
          135deg,
          var(--color-primary, #7ed7a5) 0%,
          var(--color-secondary, #2f6f4e) 100%
        );
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto;
        box-shadow: 0 12px 40px rgba(126, 215, 165, 0.32);
        animation: welcomePop 0.8s ease-out;
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
        color: white;
      }

      .welcome-title {
        font-size: 2.5rem;
        font-weight: 700;
        color: #1f2937;
        margin-bottom: 1rem;
        background: linear-gradient(
          135deg,
          var(--color-primary, #7ed7a5) 0%,
          var(--color-secondary, #2f6f4e) 100%
        );
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .welcome-greeting {
        font-size: 1.5rem;
        font-weight: 600;
        color: var(--color-text-primary, #0f172a);
        margin-bottom: 0.5rem;
      }

      .welcome-subtitle {
        font-size: 1.125rem;
        color: var(--color-text-secondary, #94a3b8);
        line-height: 1.6;
        margin-bottom: 2rem;
        max-width: 600px;
        margin-left: auto;
        margin-right: auto;
      }

      .welcome-context {
        background: linear-gradient(
          135deg,
          rgba(126, 215, 165, 0.1) 0%,
          rgba(47, 111, 78, 0.05) 100%
        );
        border: 1px solid var(--color-primary, #7ed7a5);
        border-radius: 1rem;
        padding: 1.5rem;
        margin-bottom: 3rem;
      }

      .context-header {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        margin-bottom: 1rem;
      }

      .context-icon {
        width: 40px;
        height: 40px;
        background: var(--color-surface, #ffffff);
        border-radius: 0.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .context-icon-element {
        color: var(--color-primary, #7ed7a5);
      }

      .context-title {
        font-size: 1.125rem;
        font-weight: 600;
        color: var(--color-text-primary, #0f172a);
        margin: 0;
      }

      .context-text {
        font-size: 1rem;
        color: var(--color-text-secondary, #94a3b8);
        line-height: 1.6;
      }

      .business-type-selector {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 1.5rem;
        margin-bottom: 2rem;
      }

      .business-type-option {
        background: var(--color-surface, #ffffff);
        border: 2px solid var(--color-border, #e6edf3);
        border-radius: 1rem;
        padding: 2rem;
        cursor: pointer;
        transition: all 0.3s ease;
        position: relative;
        overflow: hidden;
      }

      .business-type-option::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 4px;
        background: var(--color-border, #e6edf3);
        transition: all 0.3s ease;
      }

      .business-type-option:hover {
        border-color: var(--color-primary, #7ed7a5);
        transform: translateY(-4px);
        box-shadow: 0 12px 24px rgba(126, 215, 165, 0.15);
      }

      .business-type-option:hover::before {
        background: var(--color-primary, #7ed7a5);
      }

      .business-type-icon {
        width: 80px;
        height: 80px;
        background: linear-gradient(
          135deg,
          rgba(126, 215, 165, 0.1) 0%,
          rgba(47, 111, 78, 0.2) 100%
        );
        border-radius: 1rem;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto 1.5rem;
        border: 1px solid var(--color-primary, #7ed7a5);
      }

      .type-icon-element {
        color: var(--color-primary, #7ed7a5);
      }

      .business-type-title {
        font-size: 1.5rem;
        font-weight: 700;
        color: var(--color-text-primary, #0f172a);
        margin-bottom: 0.75rem;
      }

      .business-type-description {
        font-size: 1rem;
        color: var(--color-text-secondary, #94a3b8);
        line-height: 1.6;
        margin-bottom: 1rem;
      }

      .business-type-features {
        text-align: left;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .feature-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.875rem;
        color: var(--color-text-primary, #0f172a);
      }

      .feature-icon {
        color: var(--color-primary, #7ed7a5);
        flex-shrink: 0;
      }

      .business-action {
        margin-top: 2rem;
      }

      .action-button {
        min-width: 200px;
        padding: 1rem 2rem;
      }

      .welcome-footer {
        margin-top: 2rem;
        padding: 1rem;
        background: var(--color-background, #f8fafc);
        border-radius: 0.75rem;
        border: 1px solid var(--color-border, #e6edf3);
      }

      .footer-text {
        font-size: 0.875rem;
        color: var(--color-text-secondary, #94a3b8);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
      }

      .footer-icon {
        color: var(--color-primary, #7ed7a5);
      }

      @media (max-width: 640px) {
        .welcome-container {
          padding: 0 1rem;
        }

        .welcome-title {
          font-size: 2rem;
        }

        .welcome-greeting {
          font-size: 1.25rem;
        }

        .business-type-selector {
          grid-template-columns: 1fr;
          gap: 1rem;
        }

        .business-type-option {
          padding: 1.5rem;
        }

        .business-type-icon {
          width: 64px;
          height: 64px;
        }

        .business-type-title {
          font-size: 1.25rem;
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
  ) {}

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

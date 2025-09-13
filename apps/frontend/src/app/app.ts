import { Component, OnInit, inject, Inject, PLATFORM_ID } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule, isPlatformBrowser } from '@angular/common';
// import { ThemeService } from './core/services/theme.service';
import { StoreService } from './core/services/store.service';
import { DomainDetectorService } from './core/services/domain-detector.service';
import { AppInitializerService } from './core/services/app-initializer.service';
import { AppEnvironment } from './core/models/domain-config.interface';
import { catchError, of } from 'rxjs';

// Import shared components
import { ButtonComponent } from './shared/components/button/button.component';
import { CardComponent } from './shared/components/card/card.component';
import { SpinnerComponent } from './shared/components/spinner/spinner.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, CommonModule, ButtonComponent, CardComponent, SpinnerComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  protected title = 'vendix';
  isLoading = true;
  error: string | null = null;
  private appInitialized = false;

  // private themeService = inject(ThemeService);
  private storeService = inject(StoreService);
  private domainDetector = inject(DomainDetectorService);
  private appInitializer = inject(AppInitializerService);

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  ngOnInit(): void {
    // Si ya se inicializó en APP_INITIALIZER, solo marcar como listo
    if (this.appInitializer.isAppInitialized()) {
      console.log('[APP] App already initialized via APP_INITIALIZER');
      this.isLoading = false;
      this.appInitialized = true;
      return;
    }

    // Fallback: inicializar manualmente si no se ejecutó APP_INITIALIZER
    console.log('[APP] Initializing app manually in ngOnInit');
    this.initializeApp();
  }
  async initializeApp(): Promise<void> {
    try {
      // Skip browser-specific initialization on server
      if (!isPlatformBrowser(this.platformId)) {
        this.isLoading = false;
        return;
      }

      // Detectar dominio y entorno
      const hostname = window.location.hostname;
      const port = window.location.port;
      const fullHostname = port ? `${hostname}:${port}` : hostname;
      
      const domainConfig = await this.domainDetector.detectDomain(fullHostname);
      
      // Manejar según el entorno detectado
      await this.handleDomainConfig(domainConfig);
    } catch (error) {
      console.error('Error initializing app:', error);
      this.error = 'Error loading configuration';
      this.isLoading = false;
    }
  }

  // Método eliminado: loadThemeBySubdomain

  private async handleDomainConfig(domainConfig: any): Promise<void> {
    console.log('[APP] Handling domain config:', domainConfig);
    
    try {
      // Si es una tienda, cargar por slug
      if (domainConfig.storeSlug) {
        console.log('[APP] Loading store by slug:', domainConfig.storeSlug);
        this.storeService.getStoreBySlug(domainConfig.storeSlug)
          .pipe(
            catchError(error => {
              console.error('Error loading store by slug:', error);
              this.error = 'Store not found';
              return of(null);
            })
          )
          .subscribe(store => {
            if (store) {
              this.storeService.setCurrentStore(store);
              console.log('[APP] Store loaded successfully');
            }
            this.isLoading = false;
          });
      } else {
        // Para otros entornos (Vendix, organización), no cargar tienda por ahora
        console.log('[APP] Domain config handled (no store to load):', domainConfig.environment);
        this.isLoading = false;
      }
    } catch (error) {
      console.error('[APP] Error handling domain config:', error);
      this.error = 'Error processing domain configuration';
      this.isLoading = false;
    }
  }
}

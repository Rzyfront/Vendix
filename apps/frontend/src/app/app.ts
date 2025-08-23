import { Component, OnInit, inject, Inject, PLATFORM_ID } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule, isPlatformBrowser } from '@angular/common';
// import { ThemeService } from './core/services/theme.service';
import { StoreService } from './core/services/store.service';
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

  // private themeService = inject(ThemeService);
  private storeService = inject(StoreService);

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  ngOnInit(): void {
    this.initializeApp();
  }
  async initializeApp(): Promise<void> {
    try {
      // Skip browser-specific initialization on server
      if (!isPlatformBrowser(this.platformId)) {
        this.isLoading = false;
        return;
      }

      // Solo cargar el store por dominio (sin storedTheme ni subdomain)
      const hostname = window.location.hostname;
      this.loadThemeByDomain(hostname);
    } catch (error) {
      console.error('Error initializing app:', error);
      this.error = 'Error loading store configuration';
      this.isLoading = false;
    }
  }

  // Método eliminado: loadThemeBySubdomain

  private loadThemeByDomain(domain: string): void {
    // First get store by domain
    this.storeService.getStoreByDomain(domain)
      .pipe(
        catchError(error => {
          console.error('Error loading store by domain:', error);
          this.error = 'Store not found';
          return of(null);
        })
      )
      .subscribe(store => {
        if (store) {
          this.storeService.setCurrentStore(store);
          // Aquí podrías cargar el tema si lo implementas en el futuro
        }
        this.isLoading = false;
      });
  }
}

import { Component, OnInit, inject, Inject, PLATFORM_ID } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ThemeService } from './core/services/theme.service';
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

  private themeService = inject(ThemeService);
  private storeService = inject(StoreService);

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  ngOnInit(): void {
    this.initializeApp();
  }
  async initializeApp(): Promise<void> {
    try {
      // Skip browser-specific initialization on server
      if (!isPlatformBrowser(this.platformId)) {
        this.themeService.resetToDefault();
        this.isLoading = false;
        return;
      }

      // Try to load stored theme first
      const storedTheme = this.themeService.loadStoredTheme();
      
      if (!storedTheme) {
        // Detect subdomain or custom domain
        const subdomain = this.themeService.extractSubdomain();
        const hostname = window.location.hostname;
        
        if (subdomain) {
          // Load theme by subdomain
          this.loadThemeBySubdomain(subdomain);
        } else if (this.themeService.isCustomDomain()) {
          // Load theme by custom domain
          this.loadThemeByDomain(hostname);
        } else {
          // Development or no specific store - use default theme
          this.themeService.resetToDefault();
          this.isLoading = false;
        }
      } else {
        this.isLoading = false;
      }
    } catch (error) {
      console.error('Error initializing app:', error);
      this.error = 'Error loading store configuration';
      this.themeService.resetToDefault();
      this.isLoading = false;
    }
  }

  private loadThemeBySubdomain(subdomain: string): void {
    this.themeService.loadThemeByStore(subdomain)
      .pipe(
        catchError(error => {
          console.error('Error loading theme:', error);
          this.error = 'Store not found or theme unavailable';
          this.themeService.resetToDefault();
          return of(null);
        })
      )
      .subscribe(theme => {
        if (theme) {
          this.themeService.applyTheme(theme);
        }
        this.isLoading = false;
      });
  }

  private loadThemeByDomain(domain: string): void {
    // First get store by domain, then load its theme
    this.storeService.getStoreByDomain(domain)
      .pipe(
        catchError(error => {
          console.error('Error loading store by domain:', error);
          this.error = 'Store not found';
          this.themeService.resetToDefault();
          return of(null);
        })
      )
      .subscribe(store => {
        if (store) {
          this.storeService.setCurrentStore(store);
          this.loadThemeBySubdomain(store.slug);
        } else {
          this.isLoading = false;
        }
      });
  }
}

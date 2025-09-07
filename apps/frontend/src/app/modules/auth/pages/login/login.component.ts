import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { AuthService } from '../../../../core/services/auth.service';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { InputComponent } from '../../../../shared/components/input/input.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule, 
    RouterModule, 
    ReactiveFormsModule,
    CardComponent, 
    InputComponent
  ],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent implements OnInit {
  loginForm: FormGroup;
  isLoading = false;
  errorMessage = '';

  // Branding colors from domain config
  brandingColors = {
    primary: '#7ED7A5',
    secondary: '#2F6F4E',
    accent: '#FFFFFF',
    background: '#F4F4F4',
    text: '#222222',
    border: '#B0B0B0'
  };

  constructor(
    private fb: FormBuilder,
    private authService: AuthService
  ) {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]]
    });
  }

  ngOnInit(): void {
    this.loadBrandingColors();
  }

  private loadBrandingColors(): void {
    try {
      const currentStore = localStorage.getItem('vendix_current_store');
      if (currentStore) {
        const storeData = JSON.parse(currentStore);
        
        if (storeData.domainConfig?.config?.branding) {
          const branding = storeData.domainConfig.config.branding;
          
          this.brandingColors = {
            primary: branding.primary_color || this.brandingColors.primary,
            secondary: branding.secondary_color || this.brandingColors.secondary,
            accent: branding.accent_color || this.brandingColors.accent,
            background: branding.background_color || this.brandingColors.background,
            text: branding.text_color || this.brandingColors.text,
            border: branding.border_color || this.brandingColors.border
          };
        }
      }
    } catch (error) {
      console.warn('Error loading branding colors:', error);
      // Keep default colors
    }
  }

  getBackgroundGradient(): string {
    return `linear-gradient(to bottom right, ${this.brandingColors.background}80, ${this.brandingColors.secondary}20)`;
  }
  onSubmit(): void {
    if (this.loginForm.valid && !this.isLoading) {
      this.isLoading = true;
      this.errorMessage = '';

      const loginData = this.loginForm.value;
      
      // Obtener información del store actual del localStorage
      const currentStore = localStorage.getItem('vendix_current_store');
      if (currentStore) {
        try {
          const storeData = JSON.parse(currentStore);
          
          // Verificar si hay un store específico (store_id no null)
          if (storeData.domainConfig?.store_id !== null && storeData.slug) {
            loginData.storeSlug = storeData.slug;
          } else if (storeData.organizations?.slug) {
            // Si no hay store específico, usar el slug de la organización
            loginData.organizationSlug = storeData.organizations.slug;
          }
        } catch (error) {
          console.warn('Error parsing current store data:', error);
        }
      }
      
      this.authService.login(loginData).subscribe({
        next: (response: any) => {
          this.isLoading = false;
          // Redirect based on user role
          this.authService.redirectAfterLogin();
        },
        error: (error: any) => {
          this.isLoading = false;
          this.errorMessage = error.error?.message || 'Error al iniciar sesión. Verifica tus credenciales.';
        }
      });
    } else {
      // Mark all fields as touched to show validation errors
      Object.keys(this.loginForm.controls).forEach(key => {
        this.loginForm.get(key)?.markAsTouched();
      });
    }
  }

  getFieldError(fieldName: string): string {
    const field = this.loginForm.get(fieldName);
    if (field?.errors && field?.touched) {
      if (field.errors['required']) {
        return `${fieldName === 'email' ? 'El email' : 'La contraseña'} es requerida`;
      }
      if (field.errors['email']) {
        return 'Debe ser un email válido';
      }
      if (field.errors['minlength']) {
        return 'La contraseña debe tener al menos 6 caracteres';
      }
    }
    return '';
  }

  hasFieldError(fieldName: string): boolean {
    const field = this.loginForm.get(fieldName);
    return !!(field?.errors && field?.touched);
  }
}

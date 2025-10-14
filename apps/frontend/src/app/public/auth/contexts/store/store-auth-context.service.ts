import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { AuthContext } from '../../models/auth-context.interface';

@Injectable({
  providedIn: 'root'
})
export class StoreAuthContextService {
  
  getAuthContext(): Observable<AuthContext> {
    return of({
      type: 'store',
      loginRoute: '/auth/store/login',
      registerRoute: '/auth/store/register',
      forgotPasswordRoute: '/auth/store/forgot-password',
      resetPasswordRoute: '/auth/store/reset-password',
      branding: {
        primaryColor: '#f59e0b',
        secondaryColor: '#d97706',
        companyName: 'Tienda'
      },
      features: {
        allowRegistration: false,
        allowSocialLogin: false,
        requireEmailVerification: false
      }
    });
  }

  getLoginFormConfig(): any {
    return {
      title: 'Iniciar Sesión en tu Tienda',
      subtitle: 'Accede al panel de administración de tu tienda',
      fields: [
        {
          name: 'email',
          type: 'email',
          label: 'Correo Electrónico',
          required: true,
          placeholder: 'admin@tienda.com'
        },
        {
          name: 'password', 
          type: 'password',
          label: 'Contraseña',
          required: true,
          placeholder: '••••••••'
        }
      ],
      submitText: 'Iniciar Sesión',
      links: [
        { text: '¿Olvidaste tu contraseña?', route: '/auth/store/forgot-password' }
      ]
    };
  }
}
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { AuthContext } from '../../models/auth-context.interface';

@Injectable({
  providedIn: 'root'
})
export class VendixAuthContextService {
  
  getAuthContext(): Observable<AuthContext> {
    return of({
      type: 'vendix',
      loginRoute: '/auth/vendix/login',
      registerRoute: '/auth/vendix/register',
      forgotPasswordRoute: '/auth/vendix/forgot-password',
      resetPasswordRoute: '/auth/vendix/reset-password',
      branding: {
        logo: '/assets/vlogo.png',
        primaryColor: '#3b82f6',
        secondaryColor: '#1e40af',
        companyName: 'Vendix'
      },
      features: {
        allowRegistration: true,
        allowSocialLogin: false,
        requireEmailVerification: true
      }
    });
  }

  getLoginFormConfig(): any {
    return {
      title: 'Iniciar Sesión en Vendix',
      subtitle: 'Accede a tu cuenta de administrador',
      fields: [
        {
          name: 'email',
          type: 'email',
          label: 'Correo Electrónico',
          required: true,
          placeholder: 'tu@email.com'
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
        { text: '¿Olvidaste tu contraseña?', route: '/auth/vendix/forgot-password' },
        { text: '¿No tienes cuenta?', route: '/auth/vendix/register' }
      ]
    };
  }
}
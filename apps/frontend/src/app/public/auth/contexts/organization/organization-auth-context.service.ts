import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { AuthContext } from '../../models/auth-context.interface';

@Injectable({
  providedIn: 'root'
})
export class OrganizationAuthContextService {
  
  getAuthContext(): Observable<AuthContext> {
    return of({
      type: 'organization',
      loginRoute: '/auth/organization/login',
      registerRoute: '/auth/organization/register',
      forgotPasswordRoute: '/auth/organization/forgot-password',
      resetPasswordRoute: '/auth/organization/reset-password',
      branding: {
        primaryColor: '#10b981',
        secondaryColor: '#059669',
        companyName: 'Organización'
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
      title: 'Iniciar Sesión en tu Organización',
      subtitle: 'Accede al panel de administración de tu organización',
      fields: [
        {
          name: 'email',
          type: 'email',
          label: 'Correo Electrónico',
          required: true,
          placeholder: 'admin@organizacion.com'
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
        { text: '¿Olvidaste tu contraseña?', route: '/auth/organization/forgot-password' },
        { text: 'Registrar Organización', route: '/auth/organization/register' }
      ]
    };
  }
}
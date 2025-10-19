import type { RouteConfig } from '../../core/services/app-config.service';

export const vendixLandingPublicRoutes: RouteConfig[] = [
  { path: '', component: 'VendixLandingComponent', layout: 'public', isPublic: true },
  {
    path: 'auth',
    isPublic: true,
    children: [
      { path: 'register', component: 'RegisterOwnerComponent', layout: 'auth', isPublic: true },
      { path: 'forgot-password', component: 'ForgotOwnerPasswordComponent', layout: 'auth', isPublic: true },
      { path: 'reset-password', component: 'ResetOwnerPasswordComponent', layout: 'auth', isPublic: true },
      { path: 'verify-email', component: 'EmailVerificationComponent', layout: 'auth', isPublic: true }
    ]
  }
];

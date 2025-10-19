import type { RouteConfig } from '../../core/services/app-config.service';

export const storeEcommercePublicRoutes: RouteConfig[] = [
  { path: '', component: 'StoreEcommerceComponent', layout: 'storefront', isPublic: true },
  {
    path: 'auth',
    isPublic: true,
    children: [
      { path: 'register', component: 'StoreAuthRegisterComponent', layout: 'auth', isPublic: true },
      { path: 'forgot-password', component: 'ForgotOwnerPasswordComponent', layout: 'auth', isPublic: true },
      { path: 'reset-password', component: 'ResetOwnerPasswordComponent', layout: 'auth', isPublic: true },
      { path: 'verify-email', component: 'EmailVerificationComponent', layout: 'auth', isPublic: true }
    ]
  }
];

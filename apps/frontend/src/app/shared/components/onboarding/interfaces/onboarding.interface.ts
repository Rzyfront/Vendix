export interface OnboardingStep {
  id: OnboardingStepId;
  title: string;
  description: string;
  icon: string;
  status: OnboardingStepStatus;
  isRequired: boolean;
  isCompleted: boolean;
}

export type OnboardingStepId = 'user' | 'organization' | 'store' | 'domain';

export type OnboardingStepStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'skipped';

export interface OnboardingState {
  isOpen: boolean;
  currentStep: OnboardingStepId;
  steps: OnboardingStep[];
  isCompleted: boolean;
  loading: boolean;
  error: string | null;
}

export interface OnboardingData {
  user: UserConfigData;
  organization: OrganizationConfigData;
  store: StoreConfigData;
  domain: DomainConfigData;
}

export interface UserConfigData {
  first_name: string;
  last_name: string;
  phone?: string;
  bio?: string;
}

export interface OrganizationConfigData {
  name: string;
  description?: string;
  industry?: string;
  website?: string;
  phone?: string;
  settings: {
    timezone: string;
    currency: string;
    language: string;
    date_format: string;
  };
  billing: {
    tax_id?: string;
    billing_email?: string;
  };
  address?: AddressData;
}

export interface StoreConfigData {
  name: string;
  description?: string;
  store_type: 'retail' | 'online' | 'hybrid';
  phone?: string;
  email?: string;
  settings: {
    timezone: string;
    currency: string;
    language: string;
    inventory_tracking: boolean;
    tax_calculation: boolean;
  };
  business_hours: BusinessHours;
  address?: AddressData;
}

export interface DomainConfigData {
  hostname: string;
  domain_type: 'primary' | 'secondary' | 'custom';
  is_active: boolean;
  ssl_enabled: boolean;
  settings: {
    branding: {
      primary_color?: string;
      secondary_color?: string;
      logo_url?: string;
    };
    features: {
      ecommerce: boolean;
      inventory: boolean;
      analytics: boolean;
    };
  };
}

export interface AddressData {
  street_address: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  address_type: 'business' | 'store' | 'billing';
  is_primary: boolean;
}

export interface BusinessHours {
  monday: { open: string; close: string } | { closed: true };
  tuesday: { open: string; close: string } | { closed: true };
  wednesday: { open: string; close: string } | { closed: true };
  thursday: { open: string; close: string } | { closed: true };
  friday: { open: string; close: string } | { closed: true };
  saturday: { open: string; close: string } | { closed: true };
  sunday: { open: string; close: string } | { closed: true };
}

export interface OnboardingCompleteRequest {
  organization_id: number;
  store_id: number;
  domain_id: number;
}

export interface OnboardingStatusResponse {
  onboarding_completed: boolean;
  current_step?: OnboardingStepId;
  completed_steps: OnboardingStepId[];
  organization?: {
    id: number;
    name: string;
  };
  store?: {
    id: number;
    name: string;
  };
  domain?: {
    id: number;
    hostname: string;
  };
}

// Eventos del componente
export interface OnboardingStepChangeEvent {
  step: OnboardingStepId;
  direction: 'next' | 'previous';
}

export interface OnboardingCompleteEvent {
  data: OnboardingCompleteRequest;
}

// Configuración por defecto
export const DEFAULT_ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'user',
    title: 'Configuración del Usuario',
    description: 'Completa tu perfil personal',
    icon: 'user',
    status: 'pending',
    isRequired: true,
    isCompleted: false,
  },
  {
    id: 'organization',
    title: 'Configuración de la Organización',
    description: 'Define los datos de tu empresa',
    icon: 'building',
    status: 'pending',
    isRequired: false,
    isCompleted: false,
  },
  {
    id: 'store',
    title: 'Configuración de la Tienda',
    description: 'Configura tu punto de venta',
    icon: 'store',
    status: 'pending',
    isRequired: false,
    isCompleted: false,
  },
  {
    id: 'domain',
    title: 'Configuración de la App',
    description: 'Personaliza tu dominio y acceso',
    icon: 'globe',
    status: 'pending',
    isRequired: false,
    isCompleted: false,
  },
];

export const DEFAULT_USER_CONFIG: UserConfigData = {
  first_name: '',
  last_name: '',
  phone: '',
  bio: '',
};

export const DEFAULT_ORGANIZATION_CONFIG: OrganizationConfigData = {
  name: '',
  description: '',
  industry: '',
  website: '',
  phone: '',
  settings: {
    timezone: 'America/New_York',
    currency: 'USD',
    language: 'es',
    date_format: 'DD/MM/YYYY',
  },
  billing: {
    tax_id: '',
    billing_email: '',
  },
};

export const DEFAULT_STORE_CONFIG: StoreConfigData = {
  name: '',
  description: '',
  store_type: 'retail',
  phone: '',
  email: '',
  settings: {
    timezone: 'America/New_York',
    currency: 'USD',
    language: 'es',
    inventory_tracking: true,
    tax_calculation: true,
  },
  business_hours: {
    monday: { open: '09:00', close: '18:00' },
    tuesday: { open: '09:00', close: '18:00' },
    wednesday: { open: '09:00', close: '18:00' },
    thursday: { open: '09:00', close: '18:00' },
    friday: { open: '09:00', close: '18:00' },
    saturday: { open: '10:00', close: '16:00' },
    sunday: { closed: true },
  },
};

export const DEFAULT_DOMAIN_CONFIG: DomainConfigData = {
  hostname: '',
  domain_type: 'primary',
  is_active: true,
  ssl_enabled: false,
  settings: {
    branding: {
      primary_color: '#007bff',
      secondary_color: '#6c757d',
      logo_url: '',
    },
    features: {
      ecommerce: true,
      inventory: true,
      analytics: true,
    },
  },
};

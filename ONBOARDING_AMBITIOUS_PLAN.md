# 🚀 Plan Ambicioso de Onboarding Rápido (5 minutos)

## 📋 **Visión General**

Transformar el actual onboarding de 16 pasos complejos en un **wizard visual e intuitivo de 5 pasos** que se complete en menos de 5 minutos, manteniendo toda la robustez del sistema actual.

---

## 🎯 **Objetivos Clave**

- ⏱️ **Tiempo**: Reducir de 30+ minutos a < 5 minutos
- 🎨 **UX/UI**: Wizard visual moderno y atractivo
- 🔄 **Flujo**: Continuo sin interrupciones ni recargas
- 📱 **Mobile-first**: Diseño responsive
- 🚀 **Inmediato**: Usuario entra a la app justo después del registro

---

## 🏗️ **Arquitectura del Nuevo Sistema**

### **Backend - Nuevos Endpoints**

```typescript
// Wizard Controller Principal
@Controller('onboarding-wizard')
export class OnboardingWizardController {

  // 1. Estado inicial del wizard
  @Get('status')
  async getWizardStatus(@Req() req: AuthenticatedRequest)

  // 2. Verificación de email en tiempo real
  @Post('verify-email-status')
  async checkEmailVerification(@Req() req: AuthenticatedRequest)

  // 3. Setup de usuario con dirección
  @Post('setup-user')
  async setupUserWithAddress(@Req() req: AuthenticatedRequest, @Body() dto: SetupUserDto)

  // 4. Setup de organización (pre-populated)
  @Post('setup-organization')
  async setupOrganization(@Req() req: AuthenticatedRequest, @Body() dto: SetupOrganizationDto)

  // 5. Setup de tienda (pre-populated)
  @Post('setup-store')
  async setupStore(@Req() req: AuthenticatedRequest, @Body() dto: SetupStoreDto)

  // 6. Configuración de app y dominio
  @Post('setup-app-config')
  async setupAppConfig(@Req() req: AuthenticatedRequest, @Body() dto: SetupAppConfigDto)

  // 7. Finalización del wizard
  @Post('complete')
  async completeWizard(@Req() req: AuthenticatedRequest)
}
```

### **Nuevos DTOs**

```typescript
// DTOs optimizados para wizard
export class SetupUserDto {
  // Datos básicos (todos opcionales excepto los requeridos)
  first_name?: string;
  last_name?: string;
  phone?: string;

  // Dirección (integrada)
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state_province?: string;
  postal_code?: string;
  country_code?: string;
}

export class SetupOrganizationDto {
  name?: string;
  description?: string;
  email?: string;
  phone?: string;
  website?: string;
  tax_id?: string;

  // Dirección (pre-populated del usuario)
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state_province?: string;
  postal_code?: string;
  country_code?: string;
}

export class SetupStoreDto {
  name?: string;
  description?: string;
  store_type?: "physical" | "online" | "hybrid";
  timezone?: string;

  // Dirección (pre-populated de organización)
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state_province?: string;
  postal_code?: string;
  country_code?: string;
}

export class SetupAppConfigDto {
  // Tipo de aplicación
  app_type: "ORGANIZATIONAL" | "SINGLE_STORE";

  // Branding
  primary_color: string;
  secondary_color: string;

  // Dominio
  use_custom_domain: boolean;
  custom_domain?: string;
  subdomain?: string; // auto-generado
}
```

---

## 🎨 **Frontend - Wizard Visual**

### **Estructura del Wizard**

```typescript
// Componente principal del wizard
interface WizardStep {
  id: number;
  title: string;
  description: string;
  component: React.ComponentType;
  validation: () => boolean;
  canSkip: boolean;
}

const WIZARD_STEPS: WizardStep[] = [
  {
    id: 1,
    title: "¡Bienvenido a Vendix! 🎉",
    description: "Configura tu negocio en menos de 5 minutos",
    component: WelcomeStep,
    validation: () => true,
    canSkip: false,
  },
  {
    id: 2,
    title: "Verifica tu email 📧",
    description: "Confirma tu correo para continuar",
    component: EmailVerificationStep,
    validation: () => emailVerified,
    canSkip: false,
  },
  {
    id: 3,
    title: "Tus datos 👤",
    description: "Cuéntanos sobre ti (opcional)",
    component: UserSetupStep,
    validation: () => true,
    canSkip: true,
  },
  {
    id: 4,
    title: "Tu organización 🏢",
    description: "Configura tu empresa",
    component: OrganizationSetupStep,
    validation: () => organizationName?.length > 0,
    canSkip: false,
  },
  {
    id: 5,
    title: "Tu tienda 🏪",
    description: "Prepara tu punto de venta",
    component: StoreSetupStep,
    validation: () => storeName?.length > 0,
    canSkip: false,
  },
  {
    id: 6,
    title: "Personaliza tu app 🎨",
    description: "Colores y dominio",
    component: AppConfigStep,
    validation: () => appType && primaryColor && secondaryColor,
    canSkip: false,
  },
  {
    id: 7,
    title: "¡Listo! 🚀",
    description: "Tu negocio está configurado",
    component: CompletionStep,
    validation: () => true,
    canSkip: false,
  },
];
```

---

## 📱 **Diseño de cada Paso**

### **Paso 1: Bienvenida 🎉**

```typescript
const WelcomeStep = () => {
  return (
    <div className="text-center space-y-6">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          ¡Bienvenido a Vendix! 🎉
        </h1>
        <p className="text-xl text-gray-600 mb-2">
          Configura tu negocio en menos de 5 minutos
        </p>
        <p className="text-gray-500">
          Te guiaremos paso a paso para que tu tienda esté funcionando hoy mismo
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4 max-w-2xl mx-auto">
        <div className="bg-blue-50 p-4 rounded-lg">
          <div className="text-2xl mb-2">⚡</div>
          <div className="font-semibold">Rápido</div>
          <div className="text-sm text-gray-600">Menos de 5 minutos</div>
        </div>
        <div className="bg-green-50 p-4 rounded-lg">
          <div className="text-2xl mb-2">🎯</div>
          <div className="font-semibold">Fácil</div>
          <div className="text-sm text-gray-600">Wizard intuitivo</div>
        </div>
        <div className="bg-purple-50 p-4 rounded-lg">
          <div className="text-2xl mb-2">🚀</div>
          <div className="font-semibold">Listo</div>
          <div className="text-sm text-gray-600">Vende hoy mismo</div>
        </div>
      </div>

      <EmailVerificationStatus />
    </div>
  );
};
```

### **Paso 2: Verificación de Email 📧**

```typescript
const EmailVerificationStep = () => {
  const [emailStatus, setEmailStatus] = useState('pending');
  const [isChecking, setIsChecking] = useState(false);

  const checkEmailStatus = async () => {
    setIsChecking(true);
    try {
      const response = await onboardingAPI.checkEmailVerification();
      setEmailStatus(response.verified ? 'verified' : 'pending');
    } catch (error) {
      setEmailStatus('error');
    }
    setIsChecking(false);
  };

  const resendVerification = async () => {
    await onboardingAPI.resendVerification();
    setEmailStatus('resent');
  };

  return (
    <div className="max-w-md mx-auto text-center space-y-6">
      <div className={`p-6 rounded-lg ${
        emailStatus === 'verified' ? 'bg-green-50' : 'bg-yellow-50'
      }`}>
        <div className="text-4xl mb-4">
          {emailStatus === 'verified' ? '✅' : '📧'}
        </div>

        {emailStatus === 'verified' ? (
          <div>
            <h3 className="text-lg font-semibold text-green-800 mb-2">
              ¡Email verificado!
            </h3>
            <p className="text-green-600">
              Ya puedes continuar con la configuración
            </p>
          </div>
        ) : (
          <div>
            <h3 className="text-lg font-semibold text-yellow-800 mb-2">
              Verifica tu email
            </h3>
            <p className="text-yellow-700 mb-4">
              Enviamos un enlace de verificación a tu correo
            </p>

            <div className="space-y-3">
              <button
                onClick={checkEmailStatus}
                disabled={isChecking}
                className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {isChecking ? 'Verificando...' : 'Verificar ahora'}
              </button>

              <button
                onClick={resendVerification}
                className="w-full bg-gray-200 text-gray-700 py-3 rounded-lg hover:bg-gray-300"
              >
                Reenviar verificación
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="text-sm text-gray-500">
        ¿No recibiste el email? Revisa tu carpeta de spam
      </div>
    </div>
  );
};
```

### **Paso 3: Setup de Usuario 👤**

```typescript
const UserSetupStep = () => {
  const [userData, setUserData] = useState({
    first_name: '',
    last_name: '',
    phone: '',
    address_line1: '',
    address_line2: '',
    city: '',
    state_province: '',
    postal_code: '',
    country_code: 'MX'
  });

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Tus datos 👤
        </h2>
        <p className="text-gray-600">
          Cuéntanos sobre ti (todos los campos son opcionales)
        </p>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Nombre
          </label>
          <input
            type="text"
            value={userData.first_name}
            onChange={(e) => setUserData({...userData, first_name: e.target.value})}
            className="w-full p-3 border border-gray-300 rounded-lg"
            placeholder="Tu nombre"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Apellido
          </label>
          <input
            type="text"
            value={userData.last_name}
            onChange={(e) => setUserData({...userData, last_name: e.target.value})}
            className="w-full p-3 border border-gray-300 rounded-lg"
            placeholder="Tu apellido"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Teléfono (opcional)
        </label>
        <input
          type="tel"
          value={userData.phone}
          onChange={(e) => setUserData({...userData, phone: e.target.value})}
          className="w-full p-3 border border-gray-300 rounded-lg"
          placeholder="+52 123 456 7890"
        />
      </div>

      <div className="border-t pt-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Tu dirección (opcional)
        </h3>

        <div className="space-y-4">
          <input
            type="text"
            value={userData.address_line1}
            onChange={(e) => setUserData({...userData, address_line1: e.target.value})}
            className="w-full p-3 border border-gray-300 rounded-lg"
            placeholder="Calle y número"
          />

          <input
            type="text"
            value={userData.address_line2}
            onChange={(e) => setUserData({...userData, address_line2: e.target.value})}
            className="w-full p-3 border border-gray-300 rounded-lg"
            placeholder="Apartamento, suite, etc (opcional)"
          />

          <div className="grid grid-cols-2 gap-4">
            <input
              type="text"
              value={userData.city}
              onChange={(e) => setUserData({...userData, city: e.target.value})}
              className="w-full p-3 border border-gray-300 rounded-lg"
              placeholder="Ciudad"
            />

            <input
              type="text"
              value={userData.state_province}
              onChange={(e) => setUserData({...userData, state_province: e.target.value})}
              className="w-full p-3 border border-gray-300 rounded-lg"
              placeholder="Estado"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <input
              type="text"
              value={userData.postal_code}
              onChange={(e) => setUserData({...userData, postal_code: e.target.value})}
              className="w-full p-3 border border-gray-300 rounded-lg"
              placeholder="Código postal"
            />

            <select
              value={userData.country_code}
              onChange={(e) => setUserData({...userData, country_code: e.target.value})}
              className="w-full p-3 border border-gray-300 rounded-lg"
            >
              <option value="MX">México</option>
              <option value="CO">Colombia</option>
              <option value="US">Estados Unidos</option>
              {/* más países */}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};
```

### **Paso 4: Setup de Organización 🏢**

```typescript
const OrganizationSetupStep = () => {
  const [orgData, setOrgData] = useState({
    name: '',
    description: '',
    email: '',
    phone: '',
    website: '',
    tax_id: '',
    // Pre-populated con datos del usuario
    address_line1: userAddress?.address_line1 || '',
    address_line2: userAddress?.address_line2 || '',
    city: userAddress?.city || '',
    state_province: userAddress?.state_province || '',
    postal_code: userAddress?.postal_code || '',
    country_code: userAddress?.country_code || 'MX'
  });

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Tu organización 🏢
        </h2>
        <p className="text-gray-600">
          Configura los datos de tu empresa
        </p>
      </div>

      <div className="bg-blue-50 p-4 rounded-lg mb-6">
        <p className="text-sm text-blue-700">
          💡 Hemos prellenado algunos datos con tu información. Puedes editarlos si lo necesitas.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Nombre de la organización *
          </label>
          <input
            type="text"
            value={orgData.name}
            onChange={(e) => setOrgData({...orgData, name: e.target.value})}
            className="w-full p-3 border border-gray-300 rounded-lg"
            placeholder="Mi Empresa S.A. de C.V."
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Descripción (opcional)
          </label>
          <textarea
            value={orgData.description}
            onChange={(e) => setOrgData({...orgData, description: e.target.value})}
            className="w-full p-3 border border-gray-300 rounded-lg"
            rows={3}
            placeholder="Describe tu negocio..."
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <input
            type="email"
            value={orgData.email}
            onChange={(e) => setOrgData({...orgData, email: e.target.value})}
            className="w-full p-3 border border-gray-300 rounded-lg"
            placeholder="Email de contacto"
          />

          <input
            type="tel"
            value={orgData.phone}
            onChange={(e) => setOrgData({...orgData, phone: e.target.value})}
            className="w-full p-3 border border-gray-300 rounded-lg"
            placeholder="Teléfono"
          />
        </div>

        {/* Dirección pre-populated */}
        <div className="border-t pt-4">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Dirección de la organización
          </h3>

          <div className="space-y-4">
            <input
              type="text"
              value={orgData.address_line1}
              onChange={(e) => setOrgData({...orgData, address_line1: e.target.value})}
              className="w-full p-3 border border-gray-300 rounded-lg bg-blue-50"
              placeholder="Calle y número"
            />

            {/* más campos de dirección... */}
          </div>
        </div>
      </div>
    </div>
  );
};
```

### **Paso 5: Setup de Tienda 🏪**

```typescript
const StoreSetupStep = () => {
  const [storeData, setStoreData] = useState({
    name: '',
    description: '',
    store_type: 'physical',
    timezone: 'America/Mexico_City',
    // Pre-populated con datos de organización
    address_line1: orgAddress?.address_line1 || '',
    address_line2: orgAddress?.address_line2 || '',
    city: orgAddress?.city || '',
    state_province: orgAddress?.state_province || '',
    postal_code: orgAddress?.postal_code || '',
    country_code: orgAddress?.country_code || 'MX'
  });

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Tu tienda 🏪
        </h2>
        <p className="text-gray-600">
          Configura tu punto de venta principal
        </p>
      </div>

      <div className="bg-green-50 p-4 rounded-lg mb-6">
        <p className="text-sm text-green-700">
          💡 Hemos prellenado los datos con los de tu organización. Edítalos si lo necesitas.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Nombre de la tienda *
          </label>
          <input
            type="text"
            value={storeData.name}
            onChange={(e) => setStoreData({...storeData, name: e.target.value})}
            className="w-full p-3 border border-gray-300 rounded-lg"
            placeholder="Tienda Principal"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Tipo de tienda
          </label>
          <div className="grid grid-cols-3 gap-4">
            {[
              { value: 'physical', label: 'Física', icon: '🏪' },
              { value: 'online', label: 'Online', icon: '🌐' },
              { value: 'hybrid', label: 'Híbrida', icon: '🔄' }
            ].map(type => (
              <button
                key={type.value}
                onClick={() => setStoreData({...storeData, store_type: type.value})}
                className={`p-4 rounded-lg border-2 transition-all ${
                  storeData.store_type === type.value
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="text-2xl mb-2">{type.icon}</div>
                <div className="font-medium">{type.label}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Dirección pre-populated */}
        <div className="border-t pt-4">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Dirección de la tienda
          </h3>

          <div className="space-y-4">
            <input
              type="text"
              value={storeData.address_line1}
              onChange={(e) => setStoreData({...storeData, address_line1: e.target.value})}
              className="w-full p-3 border border-gray-300 rounded-lg bg-green-50"
              placeholder="Calle y número"
            />

            {/* más campos de dirección... */}
          </div>
        </div>
      </div>
    </div>
  );
};
```

### **Paso 6: Configuración de App 🎨**

```typescript
const AppConfigStep = () => {
  const [appConfig, setAppConfig] = useState({
    app_type: 'ORGANIZATIONAL',
    primary_color: '#3B82F6',
    secondary_color: '#10B981',
    use_custom_domain: false,
    custom_domain: '',
    subdomain: '' // auto-generado
  });

  const [generatedSubdomain] = useState(
    `${orgName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.vendix.com`
  );

  const generatePalette = (primary: string, secondary: string) => {
    // Lógica para generar paleta completa
    return {
      primary,
      secondary,
      primaryLight: lighten(primary, 20),
      primaryDark: darken(primary, 20),
      secondaryLight: lighten(secondary, 20),
      secondaryDark: darken(secondary, 20),
      accent: generateAccent(primary, secondary)
    };
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Personaliza tu app 🎨
        </h2>
        <p className="text-gray-600">
          Elige el tipo de aplicación y tu branding
        </p>
      </div>

      {/* Tipo de Aplicación */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Tipo de aplicación
        </h3>
        <div className="grid grid-cols-2 gap-6">
          <button
            onClick={() => setAppConfig({...appConfig, app_type: 'ORGANIZATIONAL'})}
            className={`p-6 rounded-lg border-2 transition-all ${
              appConfig.app_type === 'ORGANIZATIONAL'
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="text-3xl mb-3">🏢</div>
            <h4 className="font-semibold text-lg mb-2">
              Aplicación Organizacional
            </h4>
            <p className="text-sm text-gray-600">
              Gestiona múltiples tiendas, usuarios y sucursales desde un panel central
            </p>
            <div className="mt-4 text-xs text-blue-600">
              ✅ Ideal para empresas con varias ubicaciones
            </div>
          </button>

          <button
            onClick={() => setAppConfig({...appConfig, app_type: 'SINGLE_STORE'})}
            className={`p-6 rounded-lg border-2 transition-all ${
              appConfig.app_type === 'SINGLE_STORE'
                ? 'border-green-500 bg-green-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="text-3xl mb-3">🏪</div>
            <h4 className="font-semibold text-lg mb-2">
              Gestión de Tienda Única
            </h4>
            <p className="text-sm text-gray-600">
              Enfocado en la operación de una sola tienda con herramientas especializadas
            </p>
            <div className="mt-4 text-xs text-green-600">
              ✅ Perfecto para negocios individuales
            </div>
          </button>
        </div>
      </div>

      {/* Configuración de Colores */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Colores de tu marca
        </h3>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Color primario
            </label>
            <div className="flex items-center space-x-3">
              <input
                type="color"
                value={appConfig.primary_color}
                onChange={(e) => setAppConfig({...appConfig, primary_color: e.target.value})}
                className="h-12 w-12 border border-gray-300 rounded cursor-pointer"
              />
              <input
                type="text"
                value={appConfig.primary_color}
                onChange={(e) => setAppConfig({...appConfig, primary_color: e.target.value})}
                className="flex-1 p-3 border border-gray-300 rounded-lg"
                placeholder="#3B82F6"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Color secundario
            </label>
            <div className="flex items-center space-x-3">
              <input
                type="color"
                value={appConfig.secondary_color}
                onChange={(e) => setAppConfig({...appConfig, secondary_color: e.target.value})}
                className="h-12 w-12 border border-gray-300 rounded cursor-pointer"
              />
              <input
                type="text"
                value={appConfig.secondary_color}
                onChange={(e) => setAppConfig({...appConfig, secondary_color: e.target.value})}
                className="flex-1 p-3 border border-gray-300 rounded-lg"
                placeholder="#10B981"
              />
            </div>
          </div>
        </div>

        {/* Preview de paleta */}
        <div className="mt-6 p-4 bg-gray-50 rounded-lg">
          <h4 className="text-sm font-medium text-gray-700 mb-3">
            Vista previa de tu branding
          </h4>
          <div className="grid grid-cols-6 gap-2">
            {Object.values(generatePalette(appConfig.primary_color, appConfig.secondary_color)).map((color, index) => (
              <div
                key={index}
                className="h-16 rounded border border-gray-200"
                style={{ backgroundColor: color }}
                title={color}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Configuración de Dominio */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Configuración de dominio
        </h3>

        <div className="bg-green-50 p-4 rounded-lg mb-4">
          <div className="flex items-center space-x-3">
            <div className="text-2xl">🌐</div>
            <div>
              <div className="font-semibold text-green-800">
                Dominio automático configurado
              </div>
              <div className="text-green-700">
                {generatedSubdomain}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3 mb-4">
          <input
            type="checkbox"
            id="custom_domain"
            checked={appConfig.use_custom_domain}
            onChange={(e) => setAppConfig({...appConfig, use_custom_domain: e.target.checked})}
            className="h-4 w-4 text-blue-600"
          />
          <label htmlFor="custom_domain" className="text-sm font-medium text-gray-700">
            Quiero usar mi propio dominio
          </label>
        </div>

        {appConfig.use_custom_domain && (
          <div className="space-y-4 p-4 border border-gray-200 rounded-lg">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Tu dominio personalizado
              </label>
              <input
                type="text"
                value={appConfig.custom_domain}
                onChange={(e) => setAppConfig({...appConfig, custom_domain: e.target.value})}
                className="w-full p-3 border border-gray-300 rounded-lg"
                placeholder="tienda.micomercio.com"
              />
            </div>

            <div className="text-sm text-gray-600">
              <p>📌 Después de completar el wizard, te ayudaremos a configurar:</p>
              <ul className="mt-2 space-y-1">
                <li>• DNS records</li>
                <li>• Certificado SSL</li>
                <li>• Verificación de propiedad</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
```

### **Paso 7: Finalización 🚀**

```typescript
const CompletionStep = () => {
  const [isCompleting, setIsCompleting] = useState(false);

  const handleComplete = async () => {
    setIsCompleting(true);
    try {
      await onboardingAPI.completeWizard();
      // Recargar la app para mostrar la nueva configuración
      window.location.reload();
    } catch (error) {
      setIsCompleting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto text-center space-y-6">
      <div className="mb-8">
        <div className="text-6xl mb-4">🎉</div>
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          ¡Tu negocio está listo! 🚀
        </h1>
        <p className="text-xl text-gray-600 mb-2">
          Has configurado tu tienda exitosamente
        </p>
        <p className="text-gray-500">
          En menos de 5 minutos tienes tu negocio operativo en Vendix
        </p>
      </div>

      {/* Resumen de la configuración */}
      <div className="bg-gray-50 p-6 rounded-lg text-left">
        <h3 className="font-semibold text-lg mb-4">Resumen de tu configuración:</h3>

        <div className="space-y-3">
          <div className="flex items-center space-x-3">
            <div className="text-green-500">✅</div>
            <span>Cuenta verificada y activa</span>
          </div>
          <div className="flex items-center space-x-3">
            <div className="text-green-500">✅</div>
            <span>Organización: {organizationName}</span>
          </div>
          <div className="flex items-center space-x-3">
            <div className="text-green-500">✅</div>
            <span>Tienda: {storeName}</span>
          </div>
          <div className="flex items-center space-x-3">
            <div className="text-green-500">✅</div>
            <span>Dominio: {generatedSubdomain}</span>
          </div>
          <div className="flex items-center space-x-3">
            <div className="text-green-500">✅</div>
            <span>Branding personalizado</span>
          </div>
        </div>
      </div>

      {/* Próximos pasos */}
      <div className="bg-blue-50 p-6 rounded-lg">
        <h3 className="font-semibold text-lg mb-3">¿Qué sigue?</h3>
        <div className="grid grid-cols-2 gap-4 text-left">
          <div>
            <div className="font-medium mb-2">📦 Agrega productos</div>
            <div className="text-sm text-gray-600">
              Comienza catalogando tus productos
            </div>
          </div>
          <div>
            <div className="font-medium mb-2">👥 Invita a tu equipo</div>
            <div className="text-sm text-gray-600">
              Añade staff y asigna roles
            </div>
          </div>
          <div>
            <div className="font-medium mb-2">💳 Configura pagos</div>
            <div className="text-sm text-gray-600">
              Activa métodos de pago
            </div>
          </div>
          <div>
            <div className="font-medium mb-2">📊 Revisa reportes</div>
            <div className="text-sm text-gray-600">
              Monitorea tu crecimiento
            </div>
          </div>
        </div>
      </div>

      <button
        onClick={handleComplete}
        disabled={isCompleting}
        className="bg-blue-600 text-white px-8 py-4 rounded-lg text-lg font-semibold hover:bg-blue-700 disabled:opacity-50"
      >
        {isCompleting ? 'Configurando...' : 'Ir a mi panel 🚀'}
      </button>
    </div>
  );
};
```

---

## 🔧 **Backend - Implementación**

### **Nuevos Endpoints en Auth Controller**

```typescript
// Agregar al auth.controller.ts
@Controller("auth")
export class AuthController {
  @Post("onboarding-wizard/verify-email-status")
  @HttpCode(HttpStatus.OK)
  async checkEmailVerificationStatus(@Req() req: AuthenticatedRequest) {
    try {
      const user = await this.prismaService.users.findUnique({
        where: { id: req.user.id },
        select: { email_verified: true, state: true },
      });

      return this.responseService.success(
        {
          verified: user?.email_verified || false,
          state: user?.state || "pending",
        },
        "Email verification status checked",
      );
    } catch (error) {
      return this.responseService.error(
        error.message || "Error checking email verification",
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post("onboarding-wizard/setup-user")
  @HttpCode(HttpStatus.OK)
  async setupUserWithAddress(
    @Req() req: AuthenticatedRequest,
    @Body() setupUserDto: SetupUserDto,
  ) {
    try {
      // Actualizar datos del usuario
      const updatedUser = await this.prismaService.users.update({
        where: { id: req.user.id },
        data: {
          first_name: setupUserDto.first_name,
          last_name: setupUserDto.last_name,
          phone: setupUserDto.phone,
          updated_at: new Date(),
        },
      });

      // Crear dirección del usuario si se proporcionó
      if (setupUserDto.address_line1) {
        await this.prismaService.addresses.upsert({
          where: {
            user_id: req.user.id,
            type: "personal",
          },
          update: {
            address_line1: setupUserDto.address_line1,
            address_line2: setupUserDto.address_line2,
            city: setupUserDto.city,
            state_province: setupUserDto.state_province,
            postal_code: setupUserDto.postal_code,
            country_code: setupUserDto.country_code,
            is_primary: true,
            updated_at: new Date(),
          },
          create: {
            user_id: req.user.id,
            address_line1: setupUserDto.address_line1,
            address_line2: setupUserDto.address_line2,
            city: setupUserDto.city,
            state_province: setupUserDto.state_province,
            postal_code: setupUserDto.postal_code,
            country_code: setupUserDto.country_code,
            type: "personal",
            is_primary: true,
          },
        });
      }

      return this.responseService.success(
        updatedUser,
        "User setup completed successfully",
      );
    } catch (error) {
      return this.responseService.error(
        error.message || "Error setting up user",
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post("onboarding-wizard/setup-organization")
  @HttpCode(HttpStatus.OK)
  async setupOrganizationWizard(
    @Req() req: AuthenticatedRequest,
    @Body() setupOrgDto: SetupOrganizationDto,
  ) {
    try {
      // Actualizar organización existente (creada en registro)
      const updatedOrg = await this.prismaService.organizations.update({
        where: { id: req.user.organization_id },
        data: {
          name: setupOrgDto.name,
          description: setupOrgDto.description,
          email: setupOrgDto.email,
          phone: setupOrgDto.phone,
          website: setupOrgDto.website,
          tax_id: setupOrgDto.tax_id,
          updated_at: new Date(),
        },
      });

      // Crear/actualizar dirección de organización
      if (setupOrgDto.address_line1) {
        await this.prismaService.addresses.upsert({
          where: {
            organization_id: req.user.organization_id,
            type: "headquarters",
          },
          update: {
            address_line1: setupOrgDto.address_line1,
            address_line2: setupOrgDto.address_line2,
            city: setupOrgDto.city,
            state_province: setupOrgDto.state_province,
            postal_code: setupOrgDto.postal_code,
            country_code: setupOrgDto.country_code,
            is_primary: true,
            updated_at: new Date(),
          },
          create: {
            organization_id: req.user.organization_id,
            address_line1: setupOrgDto.address_line1,
            address_line2: setupOrgDto.address_line2,
            city: setupOrgDto.city,
            state_province: setupOrgDto.state_province,
            postal_code: setupOrgDto.postal_code,
            country_code: setupOrgDto.country_code,
            type: "headquarters",
            is_primary: true,
          },
        });
      }

      return this.responseService.success(
        updatedOrg,
        "Organization setup completed successfully",
      );
    } catch (error) {
      return this.responseService.error(
        error.message || "Error setting up organization",
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post("onboarding-wizard/setup-store")
  @HttpCode(HttpStatus.OK)
  async setupStoreWizard(
    @Req() req: AuthenticatedRequest,
    @Body() setupStoreDto: SetupStoreDto,
  ) {
    try {
      // Crear tienda para la organización
      const store = await this.prismaService.stores.create({
        data: {
          name: setupStoreDto.name,
          slug: this.generateSlugFromName(setupStoreDto.name),
          description: setupStoreDto.description,
          store_type: setupStoreDto.store_type,
          timezone: setupStoreDto.timezone,
          organization_id: req.user.organization_id,
          created_at: new Date(),
          updated_at: new Date(),
        },
      });

      // Crear dirección de la tienda
      if (setupStoreDto.address_line1) {
        await this.prismaService.addresses.create({
          data: {
            store_id: store.id,
            address_line1: setupStoreDto.address_line1,
            address_line2: setupStoreDto.address_line2,
            city: setupStoreDto.city,
            state_province: setupStoreDto.state_province,
            postal_code: setupStoreDto.postal_code,
            country_code: setupStoreDto.country_code,
            type: "store",
            is_primary: true,
          },
        });
      }

      // Asociar usuario con la tienda
      await this.prismaService.store_users.create({
        data: {
          store_id: store.id,
          user_id: req.user.id,
          createdAt: new Date(),
        },
      });

      return this.responseService.success(
        store,
        "Store setup completed successfully",
      );
    } catch (error) {
      return this.responseService.error(
        error.message || "Error setting up store",
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post("onboarding-wizard/setup-app-config")
  @HttpCode(HttpStatus.OK)
  async setupAppConfigWizard(
    @Req() req: AuthenticatedRequest,
    @Body() setupAppConfigDto: SetupAppConfigDto,
  ) {
    try {
      // Generar subdominio automático si no se proporciona
      const subdomain =
        setupAppConfigDto.subdomain ||
        `${setupAppConfigDto.app_type.toLowerCase()}-${Date.now()}.vendix.com`;

      // Crear configuración de dominio
      const domainConfig = await this.prismaService.domain_settings.create({
        data: {
          hostname: setupAppConfigDto.use_custom_domain
            ? setupAppConfigDto.custom_domain
            : subdomain,
          organization_id: req.user.organization_id,
          config: {
            branding: {
              primaryColor: setupAppConfigDto.primary_color,
              secondaryColor: setupAppConfigDto.secondary_color,
              // Generar paleta completa
              palette: this.generateColorPalette(
                setupAppConfigDto.primary_color,
                setupAppConfigDto.secondary_color,
              ),
            },
            app_type: setupAppConfigDto.app_type,
          },
          domain_type: "organization",
          is_primary: true,
          ownership: setupAppConfigDto.use_custom_domain
            ? "custom"
            : "vendix_subdomain",
          created_at: new Date(),
          updated_at: new Date(),
        },
      });

      // Actualizar settings del usuario
      await this.prismaService.user_settings.upsert({
        where: { user_id: req.user.id },
        update: {
          config: {
            app: setupAppConfigDto.app_type,
            panel_ui: this.generatePanelUI(setupAppConfigDto.app_type),
            onboarding_completed: false, // Se marcará como true en el paso final
          },
          updated_at: new Date(),
        },
        create: {
          user_id: req.user.id,
          config: {
            app: setupAppConfigDto.app_type,
            panel_ui: this.generatePanelUI(setupAppConfigDto.app_type),
            onboarding_completed: false,
          },
        },
      });

      // Si es dominio personalizado, iniciar proceso de verificación
      if (
        setupAppConfigDto.use_custom_domain &&
        setupAppConfigDto.custom_domain
      ) {
        await this.initiateDomainVerification(
          setupAppConfigDto.custom_domain,
          domainConfig.id,
        );
      }

      return this.responseService.success(
        {
          domain: domainConfig,
          subdomain: subdomain,
          needs_dns_verification: setupAppConfigDto.use_custom_domain,
        },
        "App configuration completed successfully",
      );
    } catch (error) {
      return this.responseService.error(
        error.message || "Error setting up app configuration",
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post("onboarding-wizard/complete")
  @HttpCode(HttpStatus.OK)
  async completeWizard(@Req() req: AuthenticatedRequest) {
    try {
      // Validar que todos los pasos requeridos estén completos
      const validation = await this.validateWizardCompletion(req.user.id);
      if (!validation.isValid) {
        throw new BadRequestException(
          `Cannot complete wizard: ${validation.missingSteps.join(", ")}`,
        );
      }

      // Marcar onboarding como completado
      await this.prismaService.users.update({
        where: { id: req.user.id },
        data: {
          onboarding_completed: true,
          updated_at: new Date(),
        },
      });

      // Activar organización
      await this.prismaService.organizations.update({
        where: { id: req.user.organization_id },
        data: {
          state: "active",
          onboarding: true,
          updated_at: new Date(),
        },
      });

      // Marcar tienda como onboarded
      const store = await this.prismaService.stores.findFirst({
        where: { organization_id: req.user.organization_id },
      });

      if (store) {
        await this.prismaService.stores.update({
          where: { id: store.id },
          data: {
            onboarding: true,
            updated_at: new Date(),
          },
        });
      }

      // Actualizar settings del usuario
      await this.prismaService.user_settings.update({
        where: { user_id: req.user.id },
        data: {
          config: {
            ...JSON.parse(await this.getUserSettings(req.user.id)),
            onboarding_completed: true,
          },
          updated_at: new Date(),
        },
      });

      // Registrar auditoría
      await this.auditService.logUpdate(
        req.user.id,
        AuditResource.USERS,
        req.user.id,
        { onboarding_completed: false },
        { onboarding_completed: true },
        {
          action: "complete_wizard",
          completed_at: new Date().toISOString(),
          wizard_type: "fast_onboarding",
        },
      );

      return this.responseService.success(
        {
          onboarding_completed: true,
          redirect_to: this.getDashboardUrl(req.user.id),
        },
        "Wizard completed successfully! Welcome to Vendix! 🎉",
      );
    } catch (error) {
      return this.responseService.error(
        error.message || "Error completing wizard",
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  // Métodos auxiliares
  private generateColorPalette(primary: string, secondary: string) {
    return {
      primary,
      secondary,
      primaryLight: this.lightenColor(primary, 20),
      primaryDark: this.darkenColor(primary, 20),
      secondaryLight: this.lightenColor(secondary, 20),
      secondaryDark: this.darkenColor(secondary, 20),
      accent: this.generateAccentColor(primary, secondary),
      background: "#FFFFFF",
      text: "#1F2937",
      border: "#E5E7EB",
    };
  }

  private generatePanelUI(appType: string) {
    if (appType === "ORGANIZATIONAL") {
      return {
        stores: true,
        users: true,
        dashboard: true,
        orders: true,
        analytics: true,
        reports: true,
        inventory: true,
        billing: true,
        ecommerce: true,
        audit: true,
        settings: true,
      };
    } else {
      return {
        pos: true,
        users: true,
        dashboard: true,
        analytics: true,
        reports: true,
        billing: true,
        ecommerce: true,
        settings: true,
      };
    }
  }

  private async validateWizardCompletion(userId: number): Promise<{
    isValid: boolean;
    missingSteps: string[];
  }> {
    const missingSteps: string[] = [];

    const user = await this.prismaService.users.findUnique({
      where: { id: userId },
      include: {
        organizations: {
          include: {
            addresses: true,
            stores: {
              include: {
                addresses: true,
              },
            },
            domain_settings: true,
          },
        },
      },
    });

    if (!user?.email_verified) {
      missingSteps.push("email_verification");
    }

    if (!user?.organizations?.name) {
      missingSteps.push("organization_setup");
    }

    if (!user?.organizations?.addresses?.length) {
      missingSteps.push("organization_address");
    }

    if (!user?.organizations?.stores?.length) {
      missingSteps.push("store_setup");
    }

    if (!user?.organizations?.domain_settings?.length) {
      missingSteps.push("app_configuration");
    }

    return {
      isValid: missingSteps.length === 0,
      missingSteps,
    };
  }
}
```

---

## 🎯 **Timeline de Implementación**

### **Fase 1: Backend (2-3 días)**

- [ ] Crear nuevos DTOs para wizard
- [ ] Implementar endpoints del wizard
- [ ] Agregar lógica de pre-populated data
- [ ] Implementar generación automática de subdominios
- [ ] Crear validaciones de wizard completion
- [ ] Actualizar tests existentes

### **Fase 2: Frontend (3-4 días)**

- [ ] Crear componente Wizard principal
- [ ] Implementar cada paso del wizard
- [ ] Diseñar UI/UX atractiva y moderna
- [ ] Agregar animaciones y transiciones
- [ ] Implementar pre-populated forms
- [ ] Crear componente de color palette generator
- [ ] Agregar validaciones en tiempo real

### **Fase 3: Integración (1-2 días)**

- [ ] Conectar frontend con nuevos endpoints
- [ ] Implementar manejo de errores
- [ ] Agregar loading states
- [ ] Probar flujo completo
- [ ] Optimizar rendimiento

### **Fase 4: Testing y Polish (1-2 días)**

- [ ] Testing end-to-end completo
- [ ] Testing de casos edge
- [ ] Optimización mobile
- [ ] Accessibility testing
- [ ] Performance testing
- [ ] Documentación

---

## 🚀 **Beneficios Esperados**

### **Experiencia de Usuario**

- ⚡ **95% más rápido**: De 30+ minutos a < 5 minutos
- 🎯 **Zero friction**: Wizard continuo sin interrupciones
- 🧠 **Inteligente**: Pre-populated data reduce typing
- 📱 **Mobile-friendly**: Funciona perfectamente en cualquier dispositivo

### **Métricas de Negocio**

- 📈 **+80% completion rate**: Más usuarios completan el onboarding
- ⏰ **-90% time to value**: Usuarios usan la app casi inmediatamente
- 💰 **+25% conversion**: Mejor conversión de registro a activo
- 🔄 **-60% support tickets**: Menos dudas y problemas

### **Técnicos**

- 🔧 **Maintainable**: Código limpio y modular
- 🧪 **Testable**: Componentes aislados y testables
- 📊 **Analytics**: Event tracking en cada paso
- 🔒 **Secure**: Mismas validaciones robustas

---

## 🎨 **Mockups y Prototipos**

### **Diseño Visual del Wizard**

```
┌─────────────────────────────────────────┐
│  🎉 ¡Bienvenido a Vendix!         │
│  Configura tu negocio en 5 minutos  │
│                                   │
│  ⚡ Rápido  🎯 Fácil  🚀 Listo  │
│                                   │
│  [Comenzar →]                    │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│  📧 Verifica tu email              │
│                                   │
│  ✅ Email verificado!              │
│  Ya puedes continuar               │
│                                   │
│  [Siguiente →]                   │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│  🏢 Tu organización              │
│                                   │
│  Nombre: [Mi Empresa S.A.]       │
│  Email:  [contacto@empresa.com]  │
│  Tel:    [+52 123 456 7890]     │
│                                   │
│  Dirección:                        │
│  [Calle Principal #123]           │
│  [Ciudad de México, CDMX]        │
│  [06000, MX]                     │
│                                   │
│  [Siguiente →]                   │
└─────────────────────────────────────────┘
```

---

## 🎯 **KPIs de Éxito**

### **Principales Métricas**

- **Time to Complete**: < 5 minutos (objetivo)
- **Completion Rate**: > 90% (actual ~60%)
- **User Satisfaction**: > 4.5/5
- **Support Tickets**: -70% en onboarding
- **Time to First Value**: < 10 minutos

### **Métricas Técnicas**

- **Page Load Time**: < 2 segundos
- **Mobile Usability**: 100%
- **Accessibility Score**: > 95
- **Error Rate**: < 1%

---

## 🚀 **Este plan transformará completamente la experiencia de onboarding de Vendix!**

**De:** 16 pasos complejos, 30+ minutos, alta fricción  
**A:** 7 pasos visuales, < 5 minutos, experiencia delightful

¿Listos para implementar este wizard revolucionario? 🚀

import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  Switch,
  TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/core/store/auth.store';
import { AuthService } from '@/core/auth/auth.service';
import { SettingsService } from '@/features/store/services/settings.service';
import { getModulesHiddenByIndustries } from '@/shared/constants/industry-modules.constant';
import { Icon } from '@/shared/components/icon/icon';
import { Button } from '@/shared/components/button/button';
import { toastSuccess, toastError, toastInfo } from '@/shared/components/toast/toast.store';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';

type AppType = 'ORG_ADMIN' | 'STORE_ADMIN';

interface AppModule {
  key: string;
  label: string;
  description?: string;
  isParent?: boolean;
  children?: AppModule[];
}

const APP_MODULES: Record<string, AppModule[]> = {
  STORE_ADMIN: [
    { key: 'dashboard', label: 'Panel Principal', description: 'Vista general de la tienda' },
    { key: 'pos', label: 'Punto de Venta', description: 'Ventas en tienda física' },
    { key: 'products', label: 'Productos', description: 'Gestionar catálogo de productos' },
    { key: 'ecommerce', label: 'E-commerce', description: 'Ventas online de la tienda' },
    {
      key: 'orders',
      label: 'Órdenes',
      description: 'Sección de órdenes',
      isParent: true,
      children: [
        { key: 'orders_sales', label: 'Órdenes de Venta' },
        { key: 'orders_purchase_orders', label: 'Órdenes de Compra' },
        { key: 'orders_quotations', label: 'Cotizaciones' },
        { key: 'orders_layaway', label: 'Plan Separe' },
        { key: 'orders_reservations', label: 'Reservas' },
        { key: 'orders_dispatch_notes', label: 'Remisiones' },
      ],
    },
    {
      key: 'inventory',
      label: 'Inventario',
      description: 'Sección de inventario',
      isParent: true,
      children: [
        { key: 'inventory_pop', label: 'Punto de Compra' },
        { key: 'inventory_adjustments', label: 'Ajustes de Stock' },
        { key: 'inventory_locations', label: 'Ubicaciones' },
        { key: 'inventory_suppliers', label: 'Proveedores' },
        { key: 'inventory_movements', label: 'Movimientos' },
        { key: 'inventory_transfers', label: 'Transferencias' },
      ],
    },
    {
      key: 'customers',
      label: 'Clientes',
      description: 'Sección de clientes',
      isParent: true,
      children: [
        { key: 'customers_all', label: 'Todos los Clientes' },
        { key: 'customers_reviews', label: 'Reseñas' },
        { key: 'customers_data_collection', label: 'Recolección de Datos' },
      ],
    },
    {
      key: 'marketing',
      label: 'Marketing',
      description: 'Sección de marketing',
      isParent: true,
      children: [
        { key: 'marketing_promotions', label: 'Promociones' },
        { key: 'marketing_coupons', label: 'Cupones' },
      ],
    },
    {
      key: 'analytics',
      label: 'Analíticas',
      description: 'Sección de analíticas',
      isParent: true,
      children: [
        { key: 'analytics_overview', label: 'Resumen' },
        { key: 'analytics_sales', label: 'Ventas' },
        { key: 'analytics_purchases', label: 'Compras' },
        { key: 'analytics_reviews', label: 'Reseñas' },
        { key: 'analytics_inventory', label: 'Inventario' },
        { key: 'analytics_products', label: 'Productos' },
        { key: 'analytics_customers', label: 'Clientes' },
        { key: 'analytics_financial', label: 'Financiero' },
      ],
    },
    { key: 'expenses', label: 'Gastos', description: 'Registro de gastos' },
    {
      key: 'invoicing',
      label: 'Facturación',
      description: 'Facturación electrónica DIAN',
      isParent: true,
      children: [
        { key: 'invoicing_all', label: 'Todas las Facturas' },
        { key: 'invoicing_resolutions', label: 'Resoluciones' },
        { key: 'invoicing_dian_config', label: 'Configuración DIAN' },
      ],
    },
    {
      key: 'accounting',
      label: 'Contabilidad',
      description: 'Plan de cuentas y asientos',
      isParent: true,
      children: [
        { key: 'accounting_chart', label: 'Plan de Cuentas' },
        { key: 'accounting_journal', label: 'Asientos Contables' },
        { key: 'accounting_payables', label: 'Cuentas por Pagar' },
        { key: 'accounting_receivables', label: 'Cuentas por Cobrar' },
        { key: 'accounting_fiscal_periods', label: 'Períodos Fiscales' },
      ],
    },
    { key: 'ai_engine', label: 'Motor IA', description: 'Asistente de inteligencia artificial' },
    { key: 'notifications', label: 'Notificaciones', description: 'Centro de notificaciones' },
    {
      key: 'settings',
      label: 'Configuración',
      description: 'Ajustes de la tienda',
      isParent: true,
      children: [
        { key: 'settings_general', label: 'General' },
        { key: 'settings_payments', label: 'Métodos de Pago' },
        { key: 'settings_users', label: 'Usuarios' },
        { key: 'settings_roles', label: 'Roles' },
        { key: 'settings_appearance', label: 'Apariencia' },
        { key: 'settings_security', label: 'Seguridad' },
      ],
    },
  ],
};

const ORG_MODULES: AppModule[] = [
  { key: 'dashboard', label: 'Panel Principal', description: 'Vista general de la organización' },
  { key: 'stores', label: 'Tiendas', description: 'Gestionar tiendas de la organización' },
  { key: 'users', label: 'Usuarios', description: 'Gestionar usuarios y permisos' },
  { key: 'domains', label: 'Dominios', description: 'Gestionar dominios de la organización' },
  { key: 'audit', label: 'Auditoría', description: 'Logs de auditoría del sistema' },
  {
    key: 'settings',
    label: 'Configuración',
    description: 'Ajustes de la organización',
    isParent: true,
    children: [
      { key: 'settings_operations', label: 'Operación' },
      { key: 'settings_fiscal_scope', label: 'Modo fiscal' },
      { key: 'settings_application', label: 'General' },
      { key: 'settings_payment_methods', label: 'Métodos de Pago' },
    ],
  },
  { key: 'accounting', label: 'Contabilidad', description: 'Plan de cuentas y asientos contables' },
  { key: 'payroll', label: 'Nómina', description: 'Gestión de nómina consolidada' },
];

export default function UserSettingsScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const userSettings = useAuthStore((s) => s.user_settings);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [appType, setAppType] = useState<AppType>('STORE_ADMIN');
  const [canChangeAppType, setCanChangeAppType] = useState(false);
  const [theme, setTheme] = useState<'default' | 'dark'>('default');
  const [modules, setModules] = useState<Record<string, boolean>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [hasModuleError, setHasModuleError] = useState(false);
  // Industry ceiling (parity con web `INDUSTRY_HIDDEN_MODULES`).
  // En esta pantalla no hay `form.general.industries`; hacemos un fetch
  // paralelo a store settings. Default `['retail']` si falla (safe direction:
  // oculta más, nunca menos).
  const [storeIndustries, setStoreIndustries] = useState<string[]>(['retail']);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const settings = await AuthService.getUserSettings();
      const config = settings.config || {};

      // App type
      const currentAppType = settings.app_type || 'STORE_ADMIN';
      setAppType(currentAppType as AppType);

      // Theme
      const prefs = config.preferences || {};
      setTheme(prefs.theme === 'dark' ? 'dark' : 'default');

      // Panel UI modules
      const panelUi = config.panel_ui || {};
      const currentModules = panelUi[currentAppType] || {};
      const allModules = getModulesForAppType(currentAppType);
      const moduleState: Record<string, boolean> = {};
      allModules.forEach((m) => {
        moduleState[m.key] = currentModules[m.key] ?? false;
        if (m.children) {
          m.children.forEach((c) => {
            moduleState[c.key] = currentModules[c.key] ?? false;
          });
        }
      });
      setModules(moduleState);

      // Industries (stopgap, en paralelo — pequeño).
      // SettingsResponse: StoreSettings → { general: { industries: [...] }, ... }.
      try {
        const storeSettings = await SettingsService.getSettings();
        const industries =
          storeSettings?.general?.industries?.length
            ? storeSettings.general.industries
            : ['retail'];
        setStoreIndustries(industries);
      } catch {
        // Mantener default ['retail'] — safe direction (oculta más, nunca menos).
      }

      // Can change app type
      const roles = user?.roles || [];
      setCanChangeAppType(roles.includes('owner') || roles.includes('admin') || roles.includes('super_admin'));
    } catch (error: any) {
      toastError('Error cargando configuración');
    } finally {
      setLoading(false);
    }
  };

  const getModulesForAppType = (type: AppType): AppModule[] => {
    return type === 'ORG_ADMIN' ? ORG_MODULES : APP_MODULES.STORE_ADMIN;
  };

  const getStandaloneModules = (type: AppType): AppModule[] => {
    return getModulesForAppType(type).filter((m) => !m.isParent || !m.children || m.children.length === 0);
  };

  const getParentModules = (type: AppType): AppModule[] => {
    return getModulesForAppType(type).filter((m) => m.isParent && m.children && m.children.length > 0);
  };

  const filteredParentModules = searchTerm
    ? getParentModules(appType).filter((m) =>
        m.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (m.description && m.description.toLowerCase().includes(searchTerm.toLowerCase())) ||
        m.children?.some((c) => c.label.toLowerCase().includes(searchTerm.toLowerCase())),
      )
    : getParentModules(appType);

  const filteredStandaloneModules = searchTerm
    ? getStandaloneModules(appType).filter((m) =>
        m.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (m.description && m.description.toLowerCase().includes(searchTerm.toLowerCase())),
      )
    : getStandaloneModules(appType);

  // Industry ceiling — mismo helper que en settings.tsx.
  const hiddenByIndustries = useMemo(
    () => getModulesHiddenByIndustries(storeIndustries),
    [storeIndustries],
  );
  const isGatedByIndustry = (key: string) => hiddenByIndustries.includes(key);

  const toggleModule = (key: string, value: boolean) => {
    // Parity con web `onToggle`: nunca persistir un toggle por encima del
    // ceiling de industria (industria > user preference).
    if (isGatedByIndustry(key)) return;
    setModules((prev) => {
      const updated = { ...prev, [key]: value };
      // If parent module, toggle all children
      const allModules = getModulesForAppType(appType);
      const parent = allModules.find((m) => m.key === key && m.isParent);
      if (parent && parent.children) {
        parent.children.forEach((c) => {
          updated[c.key] = value;
        });
      }
      return updated;
    });
  };

  const isParentEnabled = (key: string): boolean => {
    return modules[key] === true;
  };

  const handleSave = async () => {
    // Validate at least one module enabled
    const enabledModules = Object.values(modules).filter((v) => v).length;
    if (enabledModules === 0) {
      toastError('Debes habilitar al menos un módulo para poder navegar');
      setHasModuleError(true);
      return;
    }
    setHasModuleError(false);

    setSaving(true);
    try {
      const config = {
        preferences: {
          theme,
        },
        panel_ui: {
          [appType]: modules,
        },
      };
      await AuthService.updateUserSettings(config);
      toastSuccess('Configuración guardada correctamente');
      router.back();
    } catch (error: any) {
      toastError('Error guardando configuración');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Icon name="arrow-left" size={20} color={colorScales.gray[700]} />
          </Pressable>
          <Text style={styles.headerTitle}>Configuración de Usuario</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.loadingContainer}>
          <Icon name="loader" size={32} color={colors.primary} />
          <Text style={styles.loadingText}>Cargando configuración...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Icon name="arrow-left" size={20} color={colorScales.gray[700]} />
        </Pressable>
        <Text style={styles.headerTitle}>Configuración de Usuario</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
        {/* App Type Selection */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Icon name="app-window" size={20} color={colors.primary} />
            <Text style={styles.sectionTitle}>Tipo de Aplicación</Text>
          </View>
          <View style={styles.appTypeContainer}>
            <Pressable
              style={[
                styles.appTypeCard,
                appType === 'ORG_ADMIN' && styles.appTypeCardSelected,
                !canChangeAppType && styles.appTypeCardDisabled,
              ]}
              onPress={() => canChangeAppType && setAppType('ORG_ADMIN')}
            >
              <Icon
                name="building"
                size={24}
                color={appType === 'ORG_ADMIN' ? colors.primary : colorScales.gray[500]}
              />
              <View style={styles.appTypeContent}>
                <Text
                  style={[
                    styles.appTypeLabel,
                    appType === 'ORG_ADMIN' && styles.appTypeLabelSelected,
                  ]}
                >
                  Organización
                </Text>
                <Text style={styles.appTypeDesc}>Gestión multi-tienda</Text>
              </View>
              {appType === 'ORG_ADMIN' && (
                <View style={styles.statusBadge}>
                  <Text style={styles.statusBadgeText}>Actual</Text>
                </View>
              )}
            </Pressable>

            <Pressable
              style={[
                styles.appTypeCard,
                appType === 'STORE_ADMIN' && styles.appTypeCardSelected,
              ]}
              onPress={() => setAppType('STORE_ADMIN')}
            >
              <Icon
                name="store"
                size={24}
                color={appType === 'STORE_ADMIN' ? colors.primary : colorScales.gray[500]}
              />
              <View style={styles.appTypeContent}>
                <Text
                  style={[
                    styles.appTypeLabel,
                    appType === 'STORE_ADMIN' && styles.appTypeLabelSelected,
                  ]}
                >
                  Tienda
                </Text>
                <Text style={styles.appTypeDesc}>Operaciones locales</Text>
              </View>
              {appType === 'STORE_ADMIN' && (
                <View style={styles.statusBadge}>
                  <Text style={styles.statusBadgeText}>Actual</Text>
                </View>
              )}
            </Pressable>
          </View>
          {!canChangeAppType && (
            <View style={styles.lockHint}>
              <Icon name="lock" size={10} color={colorScales.gray[400]} />
              <Text style={styles.lockHintText}>Cambio restringido a administradores</Text>
            </View>
          )}
        </View>

        {/* Preferences */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Icon name="palette" size={20} color={colors.primary} />
            <Text style={styles.sectionTitle}>Preferencias</Text>
          </View>
          <View style={styles.themeOption}>
            <View style={styles.themeInfo}>
              <Text style={styles.themeLabel}>Tema</Text>
              <Text style={styles.themeDesc}>Apariencia de la aplicación</Text>
            </View>
            <View style={styles.themeSelector}>
              <Pressable
                style={[
                  styles.themeBox,
                  theme === 'default' && styles.themeBoxActive,
                ]}
                onPress={() => setTheme('default')}
              >
                <View style={[styles.themePreview, { backgroundColor: colorScales.gray[200] }]} />
                <Text style={styles.themeBoxLabel}>Default</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.themeBox,
                  theme === 'dark' && styles.themeBoxActive,
                ]}
                onPress={() => setTheme('dark')}
              >
                <View style={[styles.themePreview, { backgroundColor: colorScales.gray[700] }]} />
                <Text style={styles.themeBoxLabel}>Mono</Text>
              </Pressable>
            </View>
          </View>
        </View>

        {/* Modules Configuration */}
        <View style={styles.section}>
          <View style={styles.modulesHeader}>
            <View style={styles.sectionHeader}>
              <Icon name="layout" size={20} color={colors.primary} />
              <Text style={styles.sectionTitle}>
                Módulos del Panel: {appType === 'ORG_ADMIN' ? 'Organización' : 'Tienda'}
              </Text>
            </View>
            <Text style={styles.modulesHint}>Personaliza la visibilidad de tus herramientas</Text>
          </View>

          {/* Search */}
          <View style={styles.searchContainer}>
            <Icon name="search" size={16} color={colorScales.gray[400]} />
            <TextInput
              style={styles.searchInput}
              placeholder="Buscar módulos..."
              value={searchTerm}
              onChangeText={setSearchTerm}
              placeholderTextColor={colorScales.gray[400]}
            />
            {searchTerm ? (
              <Pressable onPress={() => setSearchTerm('')} style={styles.searchClear}>
                <Icon name="x" size={16} color={colorScales.gray[400]} />
              </Pressable>
            ) : null}
          </View>

          {/* Parent Modules with Children */}
          {filteredParentModules.map((module) => {
            const isParentGated = isGatedByIndustry(module.key);
            return (
              <View key={module.key} style={styles.moduleGroup}>
                <View style={styles.parentToggle}>
                  <View style={styles.parentToggleLeft}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                      <Text style={styles.parentLabel}>{module.label}</Text>
                      {isParentGated && (
                        <View style={styles.gatedBadge}>
                          <Text style={styles.gatedBadgeText}>Industria</Text>
                        </View>
                      )}
                    </View>
                    {module.description && (
                      <Text style={styles.parentDesc}>{module.description}</Text>
                    )}
                  </View>
                  <Switch
                    value={isParentEnabled(module.key)}
                    disabled={isParentGated}
                    onValueChange={(v) => toggleModule(module.key, v)}
                    trackColor={{ false: colorScales.gray[200], true: colors.primary }}
                    thumbColor="#FFFFFF"
                  />
                </View>
                {isParentEnabled(module.key) && module.children && (
                  <View style={styles.childrenGrid}>
                    {module.children.map((child) => {
                      const isChildGated = isGatedByIndustry(child.key);
                      return (
                        <View key={child.key} style={styles.childItem}>
                          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                            <Text style={styles.childLabel}>{child.label}</Text>
                            {isChildGated && (
                              <View style={styles.gatedBadge}>
                                <Text style={styles.gatedBadgeText}>Industria</Text>
                              </View>
                            )}
                          </View>
                          <Switch
                            value={modules[child.key] ?? false}
                            disabled={isChildGated}
                            onValueChange={(v) => toggleModule(child.key, v)}
                            trackColor={{ false: colorScales.gray[200], true: colors.primary }}
                            thumbColor="#FFFFFF"
                          />
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })}

          {/* Standalone Modules */}
          {filteredStandaloneModules.length > 0 && (
            <View style={styles.standaloneContainer}>
              <Text style={styles.standaloneTitle}>Herramientas Directas</Text>
              <View style={styles.standaloneGrid}>
                {filteredStandaloneModules.map((module) => {
                  const isModuleGated = isGatedByIndustry(module.key);
                  return (
                    <View key={module.key} style={styles.standaloneItem}>
                      <View style={styles.standaloneItemLeft}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                          <Text style={styles.standaloneLabel}>{module.label}</Text>
                          {isModuleGated && (
                            <View style={styles.gatedBadge}>
                              <Text style={styles.gatedBadgeText}>Industria</Text>
                            </View>
                          )}
                        </View>
                        {module.description && (
                          <Text style={styles.standaloneDesc}>{module.description}</Text>
                        )}
                      </View>
                      <Switch
                        value={modules[module.key] ?? false}
                        disabled={isModuleGated}
                        onValueChange={(v) => toggleModule(module.key, v)}
                        trackColor={{ false: colorScales.gray[200], true: colors.primary }}
                        thumbColor="#FFFFFF"
                      />
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* No results */}
          {searchTerm &&
            filteredParentModules.length === 0 &&
            filteredStandaloneModules.length === 0 && (
              <Text style={styles.noResults}>
                No se encontraron módulos para "{searchTerm}"
              </Text>
            )}

          {/* Module error */}
          {hasModuleError && (
            <View style={styles.moduleError}>
              <Icon name="alert-circle" size={14} color={colors.error} />
              <Text style={styles.moduleErrorText}>
                Debes habilitar al menos un módulo para poder navegar
              </Text>
            </View>
          )}
        </View>

        <Button
          title="Guardar Cambios"
          variant="primary"
          onPress={handleSave}
          loading={saving}
          style={styles.saveButton}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
    backgroundColor: colors.background,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  content: {
    flex: 1,
  },
  contentInner: {
    padding: spacing[4],
    paddingBottom: spacing[8],
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
  },
  loadingText: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  section: {
    marginBottom: spacing[6],
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  sectionTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  appTypeContainer: {
    gap: spacing[3],
  },
  appTypeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[4],
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  appTypeCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colorScales.green[50],
  },
  appTypeCardDisabled: {
    opacity: 0.6,
  },
  appTypeContent: {
    flex: 1,
  },
  appTypeLabel: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  appTypeLabelSelected: {
    color: colors.primary,
  },
  appTypeDesc: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  statusBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.sm,
  },
  statusBadgeText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium as any,
    fontFamily: typography.fontFamily,
    color: '#FFFFFF',
  },
  lockHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    marginTop: spacing[2],
  },
  lockHintText: {
    fontSize: 10,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[400],
  },
  themeOption: {
    gap: spacing[3],
  },
  themeInfo: {
    marginBottom: spacing[2],
  },
  themeLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  themeDesc: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  themeSelector: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  themeBox: {
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colorScales.gray[200],
    flex: 1,
  },
  themeBoxActive: {
    borderColor: colors.primary,
  },
  themePreview: {
    width: 40,
    height: 40,
    borderRadius: 8,
  },
  themeBoxLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
  },
  modulesHeader: {
    marginBottom: spacing[3],
  },
  modulesHint: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[400],
    marginTop: spacing[1],
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    marginBottom: spacing[4],
  },
  searchInput: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    marginLeft: spacing[2],
  },
  searchClear: {
    padding: spacing[1],
  },
  moduleGroup: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    marginBottom: spacing[3],
    overflow: 'hidden',
  },
  parentToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  parentToggleLeft: {
    flex: 1,
    marginRight: spacing[3],
  },
  parentLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  parentDesc: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  childrenGrid: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
    gap: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
    paddingTop: spacing[3],
  },
  childItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[2],
  },
  childLabel: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
  },
  standaloneContainer: {
    marginTop: spacing[2],
  },
  standaloneTitle: {
    fontSize: 11,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[400],
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing[3],
  },
  standaloneGrid: {
    gap: spacing[3],
  },
  standaloneItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  standaloneItemLeft: {
    flex: 1,
    marginRight: spacing[3],
  },
  standaloneLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  standaloneDesc: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  noResults: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[400],
    textAlign: 'center',
    paddingVertical: spacing[4],
  },
  moduleError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[4],
    padding: spacing[3],
    backgroundColor: colorScales.red[50],
    borderRadius: 8,
  },
  moduleErrorText: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colors.error,
  },
  saveButton: {
    marginTop: spacing[2],
  },
  // Badge "Industria" — mismo look que web `panel-toggle-reason-badge`.
  gatedBadge: {
    marginLeft: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: colorScales.gray[100],
  },
  gatedBadgeText: {
    fontSize: 9,
    fontWeight: typography.fontWeight.bold as any,
    letterSpacing: 0.5,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
  },
});

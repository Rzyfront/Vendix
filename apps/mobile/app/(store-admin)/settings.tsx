import { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  ScrollView,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  StyleSheet,
  Switch,
  Modal as RNModal,
  TouchableOpacity,
  Animated,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Selector,
  type SelectorOption,
} from '@/shared/components/selector/selector';
import NotificationSoundSettings from '@/features/store/components/notification-sound-settings';
import { SettingsService } from '@/features/store/services/settings.service';
import { getModulesHiddenByIndustries } from '@/shared/constants/industry-modules.constant';
import type {
  StoreSettings,
  StoreUser,
  StoreRole,
  SettingsPaymentMethod,
  CreateStoreUserDto,
  UpdateStoreUserDto,
  CreateStoreRoleDto,
  UpdateStoreRoleDto,
  GeneralSettings,
  AppSettings,
  InventorySettings,
  OperationsSettings,
  DispatchSettings,
  NotificationsSettings,
  PosSettings,
  ScaleSettings,
  CashRegisterSettings,
  CustomerQueueSettings,
  ReceiptsSettings,
  RestaurantSettings,
  MembershipSettings,
} from '@/features/store/types';
import { Input } from '@/shared/components/input/input';
import { Button } from '@/shared/components/button/button';
import { Card } from '@/shared/components/card/card';
import { Badge } from '@/shared/components/badge/badge';
import { Avatar } from '@/shared/components/avatar/avatar';
import { Icon } from '@/shared/components/icon/icon';
import { StickyHeader } from '@/shared/components/sticky-header/sticky-header';
import { SearchBar } from '@/shared/components/search-bar/search-bar';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { Spinner } from '@/shared/components/spinner/spinner';
import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
import { Modal } from '@/shared/components/modal/modal';
import { ConfirmDialog } from '@/shared/components/confirm-dialog/confirm-dialog';
import { toastSuccess, toastError, toastInfo } from '@/shared/components/toast/toast.store';
import {
  colors,
  colorScales,
  spacing,
  borderRadius,
  typography,
} from '@/shared/theme';

type SettingsTab = 'general' | 'payments' | 'users' | 'roles' | 'appearance' | 'security';

const TABS: { key: SettingsTab; label: string }[] = [
  { key: 'general', label: 'General' },
  { key: 'payments', label: 'Pagos' },
  { key: 'users', label: 'Usuarios' },
  { key: 'roles', label: 'Roles' },
  { key: 'appearance', label: 'Apariencia' },
  { key: 'security', label: 'Seguridad' },
];

interface SectionHeaderProps {
  title: string;
  icon: string;
  colorType: 'blue' | 'pink' | 'green' | 'teal' | 'purple' | 'orange' | 'indigo';
}

function SectionHeader({ title, icon, colorType }: SectionHeaderProps) {
  const getColors = () => {
    switch (colorType) {
      case 'blue':   return { bg: '#EFF6FF', text: '#2563EB' };
      case 'pink':   return { bg: '#FDF2F8', text: '#DB2777' };
      case 'green':  return { bg: '#F0FDF4', text: '#2ecc71' };
      case 'teal':   return { bg: '#F0FDFA', text: '#0D9488' };
      case 'purple': return { bg: '#FAF5FF', text: '#9333EA' };
      case 'orange': return { bg: '#FFF7ED', text: '#EA580C' };
      case 'indigo': return { bg: '#EEF2FF', text: '#4F46E5' };
      default:       return { bg: '#F3F4F6', text: '#4B5563' };
    }
  };
  const scheme = getColors();
  return (
    <View style={sectionHeaderStyles.container}>
      <View style={[sectionHeaderStyles.iconContainer, { backgroundColor: scheme.bg }]}>
        <Icon name={icon} size={18} color={scheme.text} />
      </View>
      <Text style={sectionHeaderStyles.title}>{title}</Text>
    </View>
  );
}

const sectionHeaderStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10, // Web: border-radius: 10px (square-ish, not circle)
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827', // gray-900
    margin: 0,
  },
});

function AppToggle({
  value,
  disabled,
  onValueChange,
  trackColor,
  thumbColor,
}: {
  value: boolean;
  disabled?: boolean;
  onValueChange: (val: boolean) => void;
  trackColor?: any;
  thumbColor?: string;
}) {
  const animatedValue = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(animatedValue, {
      toValue: value ? 1 : 0,
      duration: 150,
      useNativeDriver: false,
    }).start();
  }, [value]);

  const translateX = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 20],
  });

  const backgroundColor = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['#E5E7EB', '#2ecc71'],
  });

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
    >
      <Animated.View
        style={{
          width: 44,
          height: 24,
          borderRadius: 12,
          backgroundColor,
          padding: 2,
          justifyContent: 'center',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <Animated.View
          style={{
            width: 20,
            height: 20,
            borderRadius: 10,
            backgroundColor: '#FFFFFF',
            transform: [{ translateX }],
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.15,
            shadowRadius: 1.5,
            elevation: 2,
          }}
        />
      </Animated.View>
    </TouchableOpacity>
  );
}

export type AppModule = {
  key: string;
  label: string;
  description?: string;
  isParent?: boolean;
  children?: AppModule[];
};

const STORE_ADMIN_MODULES: AppModule[] = [
    // M\u00f3dulos principales (standalone - sin hijos)
    {
      key: 'dashboard',
      label: 'Panel Principal',
      description: 'Vista general de la tienda',
    },
    {
      key: 'pos',
      label: 'Punto de Venta',
      description: 'Ventas en tienda f\u00edsica',
    },
    {
      key: 'products',
      label: 'Productos',
      description: 'Gestionar cat\u00e1logo de productos',
      isParent: true,
      children: [
        {
          key: 'products_list',
          label: 'Lista',
          description: 'Listado y gesti\u00f3n de productos',
        },
        {
          key: 'products_categories',
          label: 'Categor\u00edas',
          description: 'Gestionar categor\u00edas de productos',
        },
        {
          key: 'products_brands',
          label: 'Marcas',
          description: 'Gestionar marcas de productos',
        },
      ],
    },
    {
      key: 'ecommerce',
      label: 'E-commerce',
      description: 'Ventas online de la tienda',
    },

    // \u00d3rdenes (padre con hijos)
    {
      key: 'orders',
      label: '\u00d3rdenes',
      description: 'Secci\u00f3n de \u00f3rdenes',
      isParent: true,
      children: [
        {
          key: 'orders_sales',
          label: '\u00d3rdenes de Venta',
          description: '\u00d3rdenes de venta',
        },
        {
          key: 'orders_purchase_orders',
          label: '\u00d3rdenes de Compra',
          description: '\u00d3rdenes de compra a proveedores',
        },
        {
          key: 'orders_quotations',
          label: 'Cotizaciones',
          description: 'Cotizaciones y presupuestos para clientes',
        },
        {
          key: 'orders_layaway',
          label: 'Plan Separe',
          description: 'Planes de pago a cuotas con reserva de productos',
        },
        {
          key: 'orders_reservations',
          label: 'Reservas',
          description: 'Gesti\u00f3n de reservas y agendamiento de servicios',
        },
      ],
    },

    // Despacho (padre con hijos)
    {
      key: 'dispatch',
      label: 'Despacho',
      description: 'Gesti\u00f3n de despacho, rutas, env\u00edos y flota',
      isParent: true,
      children: [
        {
          key: 'orders_dispatch_notes',
          label: 'Remisiones',
          description: 'Notas de despacho / remisiones',
        },
        {
          key: 'orders_dispatch_routes',
          label: 'Planillas de Ruta',
          description: 'Rutas de despacho DSD con recaudo en ruta',
        },
        {
          key: 'settings_shipping',
          label: 'M\u00e9todos de Env\u00edo',
          description: 'Configuraci\u00f3n de m\u00e9todos y zonas de env\u00edo',
        },
        {
          key: 'dispatch_fleet',
          label: 'Flota',
          description: 'Veh\u00edculos y conductores de la flota',
        },
      ],
    },

    // Inventario (padre con hijos)
    {
      key: 'inventory',
      label: 'Inventario',
      description: 'Secci\u00f3n de inventario',
      isParent: true,
      children: [
        {
          key: 'inventory_pop',
          label: 'Punto de Compra',
          description: 'Punto de compra a proveedores',
        },
        {
          key: 'inventory_adjustments',
          label: 'Ajustes de Stock',
          description: 'Ajustes manuales de inventario',
        },
        {
          key: 'inventory_locations',
          label: 'Ubicaciones',
          description: 'Ubicaciones de almacenamiento',
        },
        {
          key: 'inventory_suppliers',
          label: 'Proveedores',
          description: 'Directorio de proveedores',
        },
        {
          key: 'inventory_movements',
          label: 'Movimientos',
          description: 'Historial de movimientos de inventario',
        },
        {
          key: 'inventory_transfers',
          label: 'Transferencias',
          description: 'Transferencias de inventario entre ubicaciones',
        },
        {
          key: 'inventory_serials',
          label: 'Números de Serie',
          description: 'Gestión y seguimiento de números de serie',
        },
      ],
    },

    // Clientes (padre con hijos)
    {
      key: 'customers',
      label: 'Clientes',
      description: 'Secci\u00f3n de clientes',
      isParent: true,
      children: [
        {
          key: 'customers_all',
          label: 'Todos los Clientes',
          description: 'Directorio completo de clientes',
        },
        {
          key: 'customers_reviews',
          label: 'Rese\u00f1as',
          description: 'Rese\u00f1as de clientes',
        },
        {
          key: 'customers_data_collection',
          label: 'Recolección de Datos',
          description: 'Campos personalizados y formularios de preconsulta',
        },
      ],
    },

    // Marketing (padre con hijos)
    {
      key: 'marketing',
      label: 'Marketing',
      description: 'Secci\u00f3n de marketing',
      isParent: true,
      children: [
        {
          key: 'marketing_promotions',
          label: 'Promociones',
          description: 'Promociones y descuentos',
        },
        {
          key: 'marketing_coupons',
          label: 'Cupones',
          description: 'Cupones de descuento',
        },
        {
          key: 'marketing_anuncios',
          label: 'Anuncios',
          description: 'Creatividades promocionales con IA',
        },
        {
          key: 'marketing_social_sales',
          label: 'Social Sales',
          description: 'WhatsApp, inbox social y automatización de ventas',
        },
      ],
    },

    // Anal\u00edticas (padre con hijos)
    {
      key: 'analytics',
      label: 'Anal\u00edticas',
      description: 'Secci\u00f3n de anal\u00edticas',
      isParent: true,
      children: [
        {
          key: 'analytics_overview',
          label: 'Resumen',
          description: 'Resumen general de anal\u00edticas',
        },
        {
          key: 'analytics_sales',
          label: 'Ventas',
          description: 'M\u00e9tricas de ventas',
        },
        {
          key: 'analytics_purchases',
          label: 'Compras',
          description: 'Órdenes de compra y proveedores',
        },
        {
          key: 'analytics_reviews',
          label: 'Reseñas',
          description: 'Opiniones y valoraciones de clientes',
        },
        {
          key: 'analytics_inventory',
          label: 'Anal\u00edticas de Inventario',
          description: 'An\u00e1lisis de inventario y rotaci\u00f3n',
        },
        {
          key: 'analytics_products',
          label: 'Anal\u00edticas de Productos',
          description: 'Desempe\u00f1o de productos y cat\u00e1logo',
        },
        {
          key: 'analytics_customers',
          label: 'Anal\u00edticas de Clientes',
          description: 'Resumen y segmentaci\u00f3n de clientes',
        },
        {
          key: 'analytics_financial',
          label: 'Financiero',
          description: 'P\u00e9rdidas y ganancias, m\u00e1rgenes financieros',
        },
      ],
    },

    // Gastos
    {
      key: 'expenses',
      label: 'Gastos',
      description: 'Secci\u00f3n de gastos',
    },

    // Restaurant Operations (Restaurant Suite — Fase I). Parent module
    // hidden by `INDUSTRY_HIDDEN_MODULES` for retail/manufacturing/service;
    // visible only when the store's industry includes `restaurant`.
    {
      key: 'restaurant_ops',
      label: 'Operaciones de Restaurante',
      description:
        'Recetas, producci\u00f3n, comandas (KDS), mesas y cartas',
      isParent: true,
      children: [
        {
          key: 'restaurant_ops_recipes',
          label: 'Recetas',
          description: 'Recetas (BOM) y sub-recetas de la tienda',
        },
        {
          key: 'restaurant_ops_production',
          label: 'Producci\u00f3n',
          description: '\u00d3rdenes de producci\u00f3n y stock en lote',
        },
        {
          key: 'restaurant_ops_kds',
          label: 'Comandas',
          description: 'Pantalla de cocina (KDS) y tickets en vivo',
        },
        {
          key: 'restaurant_ops_tables',
          label: 'Mesas',
          description: 'Mapa de mesas, sesiones y consumo en mesa',
        },
        {
          key: 'restaurant_ops_menus',
          label: 'Cartas',
          description: 'Cartas p\u00fablicas, secciones y ventanas',
        },
      ],
    },

    // Memberships (Membership Suite). Parent module hidden by
    // `INDUSTRY_HIDDEN_MODULES` for retail/restaurant/manufacturing;
    // visible only when the store's industry includes `gym` or `service`.
    {
      key: 'memberships',
      label: 'Zona Fit',
      description: 'Planes, socios y control de accesos de membres\u00edas',
      isParent: true,
      children: [
        {
          key: 'memberships_plans',
          label: 'Planes',
          description: 'Planes y tarifas de membres\u00eda',
        },
        {
          key: 'memberships_members',
          label: 'Miembros',
          description: 'Directorio y estado de miembros',
        },
        {
          key: 'memberships_access',
          label: 'Accesos',
          description: 'Control de accesos y check-in de socios',
        },
      ],
    },

    // Facturaci\u00f3n (padre con hijos)
    {
      key: 'invoicing',
      label: 'Facturaci\u00f3n',
      description: 'Emisi\u00f3n y gesti\u00f3n de facturas electr\u00f3nicas',
      isParent: true,
      children: [
        {
          key: 'invoicing_invoices',
          label: 'Facturas',
          description: 'Listado y gesti\u00f3n de facturas electr\u00f3nicas',
        },
        {
          key: 'invoicing_resolutions',
          label: 'Resoluciones',
          description: 'Resoluciones de facturaci\u00f3n DIAN',
        },
        {
          key: 'invoicing_dian_config',
          label: 'Configuraci\u00f3n DIAN',
          description:
            'Par\u00e1metros y credenciales para facturaci\u00f3n electr\u00f3nica DIAN',
        },
      ],
    },

    // Reportes
    {
      key: 'reports',
      label: 'Reportes',
      description: 'Reportes y análisis de datos del negocio',
    },

    // Contabilidad (padre con hijos)
    {
      key: 'accounting',
      label: 'Contabilidad',
      description: 'Plan de cuentas y asientos contables',
      isParent: true,
      children: [
        {
          key: 'accounting_journal_entries',
          label: 'Asientos Contables',
          description: 'Registro de asientos contables',
        },
        {
          key: 'accounting_chart_of_accounts',
          label: 'Plan de Cuentas',
          description: 'Estructura de cuentas contables',
        },
        {
          key: 'accounting_fiscal_periods',
          label: 'Periodos Fiscales',
          description: 'Gesti\u00f3n de periodos fiscales',
        },
        {
          key: 'accounting_account_mappings',
          label: 'Mapeo de Cuentas',
          description: 'Configuraci\u00f3n de cuentas contables por flujo',
        },
        {
          key: 'accounting_flows_dashboard',
          label: 'Flujos Contables',
          description: 'Dashboard de flujos contables autom\u00e1ticos',
        },
        {
          key: 'cartera_dashboard',
          label: 'Cartera',
          description: 'Dashboard de cartera con CxC y CxP',
        },
        {
          key: 'cartera_receivables',
          label: 'Cuentas por Cobrar',
          description: 'Gesti\u00f3n de cuentas por cobrar',
        },
        {
          key: 'cartera_payables',
          label: 'Cuentas por Pagar',
          description: 'Gesti\u00f3n de cuentas por pagar',
        },
        {
          key: 'cartera_aging',
          label: 'Cartera por Vencimiento',
          description: 'Reporte de antig\u00fcedad de cartera',
        },
        {
          key: 'accounting_withholding_tax',
          label: 'Retenciones',
          description:
            'Gesti\u00f3n de retenciones en la fuente y autoretenciones',
        },
        {
          key: 'accounting_exogenous',
          label: 'Info Ex\u00f3gena',
          description: 'Reportes de informaci\u00f3n ex\u00f3gena DIAN',
        },
        {
          key: 'taxes_ica',
          label: 'ICA Municipal',
          description: 'Impuesto de industria y comercio municipal',
        },
      ],
    },

    // N\u00f3mina (padre con hijos)
    {
      key: 'payroll',
      label: 'N\u00f3mina',
      description:
        'Gesti\u00f3n de empleados y liquidaci\u00f3n de n\u00f3mina',
      isParent: true,
      children: [
        {
          key: 'payroll_employees',
          label: 'Empleados',
          description: 'Directorio de empleados',
        },
        {
          key: 'payroll_runs',
          label: 'Per\u00edodos de N\u00f3mina',
          description: 'Per\u00edodos y corridas de n\u00f3mina',
        },
        {
          key: 'payroll_settlements',
          label: 'Liquidaciones',
          description: 'Liquidaci\u00f3n por terminaci\u00f3n de empleados',
        },
        {
          key: 'payroll_advances',
          label: 'Adelantos',
          description: 'Adelantos y pr\u00e9stamos a empleados',
        },
        {
          key: 'payroll_settings',
          label: 'Configuraci\u00f3n N\u00f3mina',
          description: 'Reglas y par\u00e1metros de n\u00f3mina',
        },
      ],
    },
    {
      key: 'fiscal_operations',
      label: 'Operaci\u00f3n fiscal',
      description: 'Obligaciones, declaraciones, evidencias y cierres',
      isParent: true,
      children: [
        {
          key: 'fiscal_dashboard',
          label: 'Dashboard fiscal',
          description: 'Resumen de riesgos y vencimientos fiscales',
        },
        {
          key: 'fiscal_obligations',
          label: 'Obligaciones fiscales',
          description: 'Calendario y estados de obligaciones',
        },
        {
          key: 'fiscal_declarations',
          label: 'Declaraciones fiscales',
          description: 'Borradores trazables de declaraciones',
        },
        {
          key: 'fiscal_close',
          label: 'Cierre fiscal',
          description: 'Checklist y control de cierre mensual',
        },
        {
          key: 'fiscal_audit',
          label: 'Auditoría fiscal',
          description:
            'Evidencias, soportes y eventos auditables de la operación fiscal',
        },
        {
          key: 'fiscal_rules',
          label: 'Reglas fiscales',
          description: 'Reglas efectivas por a\u00f1o y entidad fiscal',
        },
      ],
    },

    // Configuraci\u00f3n (padre con hijos)
    {
      key: 'settings',
      label: 'Configuraci\u00f3n',
      description: 'Secci\u00f3n de configuraci\u00f3n',
      isParent: true,
      children: [
        {
          key: 'settings_general',
          label: 'General',
          description: 'Configuraci\u00f3n general de la tienda',
        },
        {
          key: 'settings_payments',
          label: 'M\u00e9todos de Pago',
          description: 'M\u00e9todos de pago aceptados',
        },
        {
          key: 'settings_price_tiers',
          label: 'Precios y Tarifas',
          description:
            'Tarifas por tienda (mayorista, detal, por caja) para productos multi-tarifa',
        },
        {
          key: 'settings_appearance',
          label: 'Apariencia',
          description: 'Personalizaci\u00f3n visual',
        },
        {
          key: 'settings_security',
          label: 'Seguridad',
          description: 'Configuraci\u00f3n de seguridad',
        },
        {
          key: 'settings_domains',
          label: 'Dominios',
          description: 'Dominios de la tienda online',
        },
        {
          key: 'settings_legal_documents',
          label: 'Documentos Legales',
          description:
            'Gestionar t\u00e9rminos, privacidad y documentos legales',
        },
        {
          key: 'settings_users',
          label: 'Usuarios',
          description: 'Gestionar usuarios de la tienda',
        },
        {
          key: 'settings_roles',
          label: 'Roles',
          description: 'Gestionar roles y permisos de la tienda',
        },
        {
          key: 'settings_cash_registers',
          label: 'Caja Registradora',
          description: 'Gesti\u00f3n de cajas, sesiones y movimientos',
        },
      ],
    },
    // Ayuda (padre con hijos)
    {
      key: 'help',
      label: 'Ayuda',
      description: 'Secci\u00f3n de ayuda y soporte',
      isParent: true,
      children: [
        {
          key: 'help_support',
          label: 'Soporte',
          description: 'Acceso a la secci\u00f3n de soporte',
        },
        {
          key: 'help_pqrs',
          label: 'Mis Solicitudes',
          description:
            'Conversaciones y solicitudes radicadas por tus clientes desde la tienda',
        },
        {
          key: 'help_center',
          label: 'Centro de Ayuda',
          description: 'Art\u00edculos y gu\u00edas del centro de ayuda',
            },
      ],
    }
];

// ─── Shared Styles ─────────────────────────────────────────────────────────

const tabBarStyles = StyleSheet.create({
  container: {
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  scroll: {
    paddingHorizontal: spacing[4],
  },
  tabRow: {
    flexDirection: 'row',
    gap: spacing[1],
    paddingVertical: spacing[2],
  },
  tab: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
  },
  tabActive: {
    backgroundColor: colors.primary,
  },
  tabInactive: {
    backgroundColor: colorScales.gray[100],
  },
  tabTextActive: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.background,
  },
  tabTextInactive: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colorScales.gray[600],
  },
});

const sectionStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC', // Web: --color-surface / bg-background in responsive
  },
  content: {
    padding: 16,
    paddingBottom: 80,
    gap: 16,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF', // gray-400
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  flex1: {
    flex: 1,
  },
  footer: {
    padding: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  statsGridOverride: {
    paddingHorizontal: 0,
    paddingTop: 0,
    marginBottom: spacing[4],
  },
  fab: {
    position: 'absolute',
    bottom: spacing[6],
    right: spacing[6],
    width: 56,
    height: 56,
    borderRadius: borderRadius.full,
    backgroundColor: colorScales.green[600],
    alignItems: 'center',
    justifyContent: 'center',
    ...{ shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 5 },
  },
  listContent: {
    paddingBottom: spacing[24],
  },
});

const cardStyles = StyleSheet.create({
  card: {
    marginBottom: spacing[3],
  },
  cardBody: {
    padding: spacing[4],
    gap: spacing[2],
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
  },
  cardSubtitle: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
  },
  cardDetail: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[400],
    marginTop: spacing[1],
  },
  badgeRow: {
    flexDirection: 'row',
    gap: spacing[1],
    marginTop: spacing[2],
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing[2],
    marginTop: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
  },
  userHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  userInfo: {
    flex: 1,
    gap: spacing[0.5],
  },
  userName: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
  },
  userEmail: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#F3F4F6',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 12,
  },
  toggleLabel: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[700],
  },
  placeholderBox: {
    width: 80,
    height: 80,
    borderRadius: borderRadius.xl,
    backgroundColor: colorScales.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[3],
  },
  themeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  themeOptionLast: {
    borderBottomWidth: 0,
  },
  themeLabel: {
    fontSize: typography.fontSize.base,
    color: colorScales.gray[700],
  },
  securitySection: {
    marginBottom: spacing[4],
  },
});

// ─── Tab Bar ────────────────────────────────────────────────────────────────

function TabBar({
  activeTab,
  onTabChange,
}: {
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
}) {
  return (
    <View style={tabBarStyles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={tabBarStyles.scroll}
        contentContainerStyle={tabBarStyles.tabRow}
      >
        {TABS.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <Pressable
              key={tab.key}
              onPress={() => onTabChange(tab.key)}
              style={[tabBarStyles.tab, isActive ? tabBarStyles.tabActive : tabBarStyles.tabInactive]}
            >
              <Text style={isActive ? tabBarStyles.tabTextActive : tabBarStyles.tabTextInactive}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─── General Tab ────────────────────────────────────────────────────────────

function GeneralTab() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Partial<StoreSettings>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [activeSubTab, setActiveSubTab] = useState<string>('identity');

  const scrollViewRef = useRef<ScrollView>(null);
  const [offsets, setOffsets] = useState<Record<string, number>>({});
  const [isScrollingFromTab, setIsScrollingFromTab] = useState(false);

  const [showModulesModal, setShowModulesModal] = useState(false);
  const [devicePushEnabled, setDevicePushEnabled] = useState(false);
  const [showWeightUnit, setShowWeightUnit] = useState(false);
  const [showBaudRate, setShowBaudRate] = useState(false);
  const [showProtocol, setShowProtocol] = useState(false);
  const [showScheduleMode, setShowScheduleMode] = useState(false);
  const [subscriptions, setSubscriptions] = useState<Record<string, boolean>>({
    'new_order': true,
    'order_status': true,
    'low_stock': true,
    'new_customer': true,
    'payment_received': true,
    'new_review': true,
  });

  const { data: settings, isLoading } = useQuery({
    queryKey: ['store-settings'],
    queryFn: () => SettingsService.getSettings(),
  });

  const subTabs = [
    { key: 'identity', label: 'Identidad' },
    { key: 'branding', label: 'Marca' },
    { key: 'inventory', label: 'Inventario' },
    { key: 'operations', label: 'Operaciones' },
    { key: 'dispatch', label: 'Despacho' },
    { key: 'notifications', label: 'Alertas' },
    { key: 'pos', label: 'POS' },
    { key: 'receipts', label: 'Recibos' },
  ];

  if (settings?.general?.industries?.includes('restaurant')) {
    subTabs.push({ key: 'restaurant', label: 'Mesas' });
  }
  if (settings?.general?.industries?.includes('gym')) {
    subTabs.push({ key: 'membership', label: 'Zona Fit' });
  }

  const handleTabPress = (key: string) => {
    setActiveSubTab(key);
    setIsScrollingFromTab(true);
    const y = offsets[key];
    if (typeof y === 'number') {
      scrollViewRef.current?.scrollTo({ y: y - 10, animated: true });
    }
    setTimeout(() => {
      setIsScrollingFromTab(false);
    }, 600);
  };

  const handleScroll = (event: any) => {
    if (isScrollingFromTab) return;
    const scrollY = event.nativeEvent.contentOffset.y;
    let active = 'identity';
    for (const st of subTabs) {
      const y = offsets[st.key];
      if (typeof y === 'number' && scrollY >= y - 120) {
        active = st.key;
      }
    }
    if (active !== activeSubTab) {
      setActiveSubTab(active);
    }
  };

  useEffect(() => {
    if (settings) {
      setForm(settings);
    }
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: (data: Partial<StoreSettings>) => SettingsService.updateSettings(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['store-settings'] });
      toastSuccess('Configuración guardada');
    },
    onError: () => toastError('Error al guardar la configuración'),
  });

  const updateGeneralField = (key: keyof GeneralSettings & string, value: any) => {
    setForm((prev) => ({
      ...prev,
      general: {
        ...prev.general,
        [key]: value,
      } as GeneralSettings,
      ...(key === 'name' && {
        name: value,
        app: {
          ...prev.app,
          name: value,
        } as AppSettings,
      }),
    }));
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const updateAppField = (key: keyof AppSettings & string, value: any) => {
    setForm((prev) => ({
      ...prev,
      app: {
        ...prev.app,
        [key]: value,
      } as AppSettings,
    }));
  };

  const updateInventoryField = (key: keyof InventorySettings & string, value: any) => {
    setForm((prev) => ({
      ...prev,
      inventory: {
        ...prev.inventory,
        [key]: value,
      } as InventorySettings,
    }));
  };

  const updateOperationsField = (key: keyof OperationsSettings & string, value: any) => {
    setForm((prev) => ({
      ...prev,
      operations: {
        ...prev.operations,
        [key]: value,
      } as OperationsSettings,
    }));
  };

  const updateDispatchField = (key: keyof DispatchSettings & string, value: any) => {
    setForm((prev) => ({
      ...prev,
      dispatch: {
        ...prev.dispatch,
        [key]: value,
      } as DispatchSettings,
    }));
  };

  const updateNotificationsField = (key: keyof NotificationsSettings & string, value: any) => {
    setForm((prev) => ({
      ...prev,
      notifications: {
        ...prev.notifications,
        [key]: value,
      } as NotificationsSettings,
    }));
  };

  const updatePosField = (key: keyof PosSettings & string, value: any) => {
    setForm((prev) => ({
      ...prev,
      pos: {
        ...prev.pos,
        [key]: value,
      } as PosSettings,
    }));
  };

  const updatePosCashRegisterField = (key: keyof CashRegisterSettings & string, value: any) => {
    setForm((prev) => ({
      ...prev,
      pos: {
        ...prev.pos,
        cash_register: {
          ...prev.pos?.cash_register,
          [key]: value,
        } as CashRegisterSettings,
      } as PosSettings,
    }));
  };

  const updatePosCustomerQueueField = (key: keyof CustomerQueueSettings & string, value: any) => {
    setForm((prev) => ({
      ...prev,
      pos: {
        ...prev.pos,
        customer_queue: {
          ...prev.pos?.customer_queue,
          [key]: value,
        } as CustomerQueueSettings,
      } as PosSettings,
    }));
  };

  const updatePosScaleField = (key: keyof ScaleSettings & string, value: any) => {
    setForm((prev) => ({
      ...prev,
      pos: {
        ...prev.pos,
        scale: {
          ...prev.pos?.scale,
          [key]: value,
        } as ScaleSettings,
      } as PosSettings,
    }));
  };

  const updatePosBusinessHoursField = (dayKey: string, field: 'open' | 'close' | 'closed', value: any) => {
    setForm((prev) => ({
      ...prev,
      pos: {
        ...prev.pos,
        business_hours: {
          ...prev.pos?.business_hours,
          [dayKey]: {
            ...prev.pos?.business_hours?.[dayKey],
            [field]: value,
          },
        },
      } as PosSettings,
    }));
  };

  const updateReceiptsField = (key: keyof ReceiptsSettings & string, value: any) => {
    setForm((prev) => ({
      ...prev,
      receipts: {
        ...prev.receipts,
        [key]: value,
      } as ReceiptsSettings,
    }));
  };

  const updateRestaurantField = (key: keyof RestaurantSettings & string, value: any) => {
    setForm((prev) => ({
      ...prev,
      restaurant: {
        ...prev.restaurant,
        [key]: value,
      } as RestaurantSettings,
    }));
  };

  const updateMembershipField = (key: keyof MembershipSettings & string, value: any) => {
    setForm((prev) => ({
      ...prev,
      membership: {
        ...prev.membership,
        [key]: value,
      } as MembershipSettings,
    }));
  };

  const handleSubmit = () => {
    const newErrors: Record<string, string> = {};
    const storeName = form.general?.name || form.name;
    if (!storeName?.trim()) newErrors.name = 'El nombre es requerido';
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    const payload: Partial<StoreSettings> = {
      ...form,
      general: {
        ...form.general,
        name: storeName?.trim(),
      } as GeneralSettings,
    };
    updateMutation.mutate(payload);
  };

  const handleReset = () => {
    if (settings) {
      setForm(settings);
      setErrors({});
      toastInfo('Configuración restablecida');
    }
  };

  return (
    <View style={sectionStyles.container}>
      {/* ── Div 1: Título + botones (igual que el sticky header de la web) ── */}
      <StickyHeader
        title="Configuración General"
        style={{
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: 0,
          elevation: 0,
          shadowOpacity: 0,
        }}
        actions={[
          {
            label: 'Restablecer',
            onPress: handleReset,
            // Parity con web `app-button[variant="outline-danger"]`
            // (borde + label rojos, fondo transparente). Distinto de
            // `destructive` (sólido rojo) o `outline` (gris).
            variant: 'outline-danger',
            icon: 'rotate-ccw',
          },
          {
            label: 'Guardar',
            onPress: handleSubmit,
            variant: 'primary',
            loading: updateMutation.isPending,
            icon: 'save',
          },
        ]}
      />

      {/* ── Div 2: Barra de sub-tabs (igual que los scrollable-tabs de la web) ── */}
      <View style={styles.subTabsContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.subTabsScroll}
        >
          {subTabs.map((st) => {
            const isActive = st.key === activeSubTab;
            return (
              <Pressable
                key={st.key}
                onPress={() => handleTabPress(st.key)}
                style={[styles.subTabItem, isActive && styles.subTabItemActive]}
              >
                <Text style={[styles.subTabLabel, isActive && styles.subTabLabelActive]}>
                  {st.label}
                </Text>
                {/* Indicador de línea inferior activa, igual que ::after en la web */}
                <View style={[styles.subTabIndicator, isActive && styles.subTabIndicatorActive]} />
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {isLoading ? (
        <View style={sectionStyles.loader}>
          <Spinner />
        </View>
      ) : (
        <ScrollView
          ref={scrollViewRef}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onScroll={handleScroll}
          scrollEventThrottle={16}
          contentContainerStyle={sectionStyles.content}
          style={{ backgroundColor: '#F8FAFC' }}
        >
          {/* ── Identidad ── */}
          <View
            onLayout={(e) => setOffsets(prev => ({ ...prev, identity: e.nativeEvent.layout.y }))}
            style={styles.webSection}
          >
            <SectionHeader title="Identidad y General" icon="user" colorType="blue" />
            <View style={styles.sectionBody}>
              <Text style={sectionStyles.sectionTitle}>Información Básica</Text>
              <Input
                style={{ marginBottom: 16, marginTop: 8 }}
                label="Nombre de la Tienda"
                value={form.general?.name ?? form.name ?? ''}
                onChangeText={(v) => updateGeneralField('name', v)}
                error={errors.name}
                placeholder="Mi Tienda"
              />

              <Selector
                label="Tipo de Tienda"
                value={form.general?.store_type ?? null}
                onChange={(v) => updateGeneralField('store_type', v)}
                options={[
                  { value: 'physical', label: 'Tienda Física' },
                  { value: 'online', label: 'Tienda Online' },
                  { value: 'hybrid', label: 'Híbrida (Física + Online)' },
                  { value: 'popup', label: 'Tienda Pop-up' },
                  { value: 'kiosko', label: 'Kiosco' },
                ]}
                placeholder="Seleccionar..."
              />

              <Text style={[sectionStyles.sectionTitle, { marginTop: 24 }]}>Preferencias y Localización</Text>

              <Selector
                label="Moneda"
                value={form.general?.currency ?? null}
                onChange={(v) => updateGeneralField('currency', v)}
                options={['COP', 'MXN', 'USD', 'CLP', 'PEN', 'EUR'].map((cur) => ({
                  value: cur,
                  label: cur,
                }))}
                placeholder="Seleccionar..."
              />

              <Selector
                label="Zona Horaria"
                value={form.general?.timezone ?? null}
                onChange={(v) => updateGeneralField('timezone', v)}
                options={['America/Bogota', 'America/Mexico_City', 'America/Caracas', 'America/Santiago', 'America/Lima', 'America/New_York', 'UTC'].map((tz) => ({
                  value: tz,
                  label: tz,
                }))}
                placeholder="Seleccionar..."
              />

              {/* ── Tipos de Negocio (multi-selector) ── */}
              <Text style={[sectionStyles.sectionTitle, { marginTop: 24 }]}>Tipos de Negocio *</Text>
              <Text style={[styles.toggleDesc, { marginBottom: 10 }]}>
                Si tu negocio combina varias industrias, marca todas las que apliquen — los módulos visibles se calculan con la unión de reglas.
              </Text>
              <View style={styles.industriesGrid}>
                {[
                  { key: 'retail', label: 'Retail' },
                  { key: 'restaurant', label: 'Restaurante' },
                  { key: 'gym', label: 'Zona Fit' },
                  { key: 'services', label: 'Servicios' },
                  { key: 'pharmacy', label: 'Farmacia' },
                  { key: 'beauty', label: 'Belleza' },
                ].map((ind) => {
                  const selected = (form.general?.industries ?? []).includes(ind.key);
                  return (
                    <Pressable
                      key={ind.key}
                      onPress={() => {
                        const current = form.general?.industries ?? [];
                        const next = selected
                          ? current.filter((i) => i !== ind.key)
                          : [...current, ind.key];
                        updateGeneralField('industries', next);
                      }}
                      style={[styles.industryChip, selected && styles.industryChipActive]}
                    >
                      <Text style={[styles.industryChipLabel, selected && styles.industryChipLabelActive]}>
                        {ind.label}
                      </Text>
                      {selected && <Icon name="check" size={12} color="#2ecc71" />}
                    </Pressable>
                  );
                })}
              </View>

              {/* Info box contextual por tipo de tienda - Movido debajo de Tipos de Negocio */}
              {form.general?.store_type && (
                <View style={[
                  styles.infoBox,
                  form.general.store_type === 'online' ? styles.infoBoxPurple
                  : form.general.store_type === 'hybrid' ? styles.infoBoxGreen
                  : styles.infoBoxBlue,
                  { marginTop: 16 },
                ]}>
                  <Text style={styles.infoBoxText}>
                    {form.general.store_type === 'physical' &&
                      'Tienda Física: El módulo de Tienda en línea no estará disponible. Tendrás acceso al Punto de Venta y todos los módulos de gestión presencial.'}
                    {form.general.store_type === 'popup' &&
                      'Tienda Pop-up: El módulo de Tienda en línea no estará disponible. Tendrás acceso al Punto de Venta y módulos de gestión presencial.'}
                    {form.general.store_type === 'kiosko' &&
                      'Kiosco: El módulo de Tienda en línea no estará disponible. Tendrás acceso al Punto de Venta y todos los módulos de gestión presencial.'}
                    {form.general.store_type === 'online' &&
                      'Tienda Online: Los módulos de Punto de Venta y Caja Registradora no estarán disponibles. Tendrás acceso a la Tienda en línea y todos los módulos de comercio digital.'}
                    {form.general.store_type === 'hybrid' &&
                      'Híbrida: Todos los módulos estarán disponibles, incluyendo Punto de Venta, Tienda en línea y Caja Registradora.'}
                  </Text>
                </View>
              )}

              {/* ── Módulos de la Tienda ── */}
              <View style={[{ marginTop: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: '#FFFFFF', borderColor: '#E5E7EB', borderWidth: 1, borderRadius: 8 }]}>
                <View style={{ flex: 1, paddingRight: 16 }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#9CA3AF', textTransform: 'uppercase', marginBottom: 4 }}>
                    Módulos de la Tienda
                  </Text>
                  <Text style={{ fontSize: 11, color: '#6B7280', lineHeight: 16 }}>
                    Controla qué módulos ve el menú lateral de tu equipo.
                  </Text>
                </View>
                <TouchableOpacity
                  style={{ backgroundColor: '#FFFFFF', borderColor: '#D1D5DB', borderWidth: 1, borderRadius: 6, paddingVertical: 6, paddingHorizontal: 12 }}
                  onPress={() => setShowModulesModal(true)}
                >
                  <Text style={{ fontSize: 12, fontWeight: '500', color: '#374151' }}>Gestionar</Text>
                </TouchableOpacity>
              </View>
              <RNModal visible={showModulesModal} transparent={true} animationType="fade" onRequestClose={() => setShowModulesModal(false)}>
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
                  <View style={{ backgroundColor: '#fff', borderRadius: 8, width: '100%', maxWidth: 600, maxHeight: '90%', flexShrink: 1 }}>
                    <View style={{ padding: 16, flexShrink: 1 }}>

                  {/* Header (parity con web `<app-modal>`: título + subtítulo + X) */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#F3F4F6', paddingBottom: 12, marginBottom: 12 }}>
                    <View>
                      <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827' }}>Módulos de la Tienda</Text>
                      <Text style={{ fontSize: 13, color: '#4B5563', marginTop: 2 }}>STORE_ADMIN — visibilidad en el menú lateral</Text>
                    </View>
                    <TouchableOpacity onPress={() => setShowModulesModal(false)} style={{ padding: 4 }}>
                      <Ionicons name="close" size={24} color="#9CA3AF" />
                    </TouchableOpacity>
                  </View>

                  {/* Body scrollable (parity con web <app-modal>: descripción + lista
                      viven dentro del MISMO contenedor overflow-y-auto, así la
                      descripción scrollea con los módulos cuando el listado
                      excede el alto del modal) */}
                  <ScrollView style={{ flex: 1 }}>
                    <View style={{ marginBottom: 16 }}>
                      <Text style={{ fontSize: 13, color: '#6B7280', lineHeight: 20 }}>
                        Apaga un módulo para ocultarlo del menú lateral a <Text style={{ fontWeight: '700' }}>todos los usuarios</Text> de la tienda.
                      </Text>
                      <Text style={{ fontSize: 13, color: '#6B7280', lineHeight: 20, marginTop: 4 }}>
                        <Text style={{ fontWeight: '700' }}>Apagado</Text> = oculto para todos. <Text style={{ fontWeight: '700' }}>Ausente / encendido</Text> = permitido (segun la configuracion por usuario).
                      </Text>
                    </View>
                    {(() => {
                      // Industry ceiling: paridad con web `INDUSTRY_HIDDEN_MODULES`.
                      // Calculado una sola vez por render del modal (cheap, ~5 keys).
                      const hiddenByIndustries = getModulesHiddenByIndustries(
                        form.general?.industries ?? ['retail'],
                      );
                      return STORE_ADMIN_MODULES.map((mod) => {
                        const isOn = form.panel_ui?.[mod.key] !== false; // default true
                        const isGatedByIndustry = hiddenByIndustries.includes(mod.key);
                        return (
                          <View key={mod.key} style={{ backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 12, padding: 12 }}>
                            {/* Parent row */}
                            <View style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              backgroundColor: '#F9FAFB',
                              borderWidth: 1,
                              borderColor: '#F3F4F6',
                              borderRadius: 12,
                              padding: 10,
                            }}>
                              <View style={{ flex: 1, paddingRight: 16 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#111827' }}>{mod.label}</Text>
                                  {isGatedByIndustry && (
                                    <View style={{
                                      marginLeft: 6,
                                      paddingHorizontal: 6,
                                      paddingVertical: 2,
                                      borderRadius: 6,
                                      backgroundColor: '#F3F4F6',
                                    }}>
                                      <Text style={{
                                        fontSize: 9,
                                        fontWeight: '700',
                                        letterSpacing: 0.5,
                                        color: '#6B7280',
                                        textTransform: 'uppercase',
                                      }}>Industria</Text>
                                    </View>
                                  )}
                                </View>
                                {mod.description && <Text style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>{mod.description}</Text>}
                              </View>
                              <AppToggle
                                value={isOn}
                                disabled={isGatedByIndustry}
                                onValueChange={(val) => {
                                  // Gated toggles no son interactivos (parity con web `onToggle`).
                                  if (isGatedByIndustry) return;
                                  setForm((prev) => {
                                    const newPanelUi = { ...prev.panel_ui, [mod.key]: val };
                                    if (!val && mod.children) {
                                      mod.children.forEach(child => {
                                        newPanelUi[child.key] = false;
                                      });
                                    } else if (val && mod.children) {
                                        mod.children.forEach(child => {
                                            newPanelUi[child.key] = true;
                                        });
                                    }
                                    return { ...prev, panel_ui: newPanelUi };
                                  });
                                }}
                              />
                            </View>

                            {/* Children */}
                            {mod.children && mod.children.length > 0 && (
                              <View style={{ marginTop: 12, marginLeft: 12, borderLeftWidth: 1.5, borderLeftColor: '#111827' }}>
                                {mod.children.map(child => {
                                  const isChildOn = form.panel_ui?.[child.key] !== false;
                                  const isChildGatedByIndustry = hiddenByIndustries.includes(child.key);
                                  return (
                                    <View key={child.key} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, position: 'relative' }}>
                                      {/* Horizontal notch */}
                                      <View style={{ width: 16, height: 1.5, backgroundColor: '#111827', position: 'absolute', left: 0, top: '50%' }} />
                                      <View style={{
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        backgroundColor: '#F9FAFB',
                                        borderWidth: 1,
                                        borderColor: '#F3F4F6',
                                        borderRadius: 12,
                                        padding: 10,
                                        marginLeft: 16,
                                        flex: 1,
                                        opacity: (isOn && !isChildGatedByIndustry) ? 1 : 0.5,
                                      }}>
                                        <View style={{ flex: 1, paddingRight: 16 }}>
                                          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                                            <Text style={{ fontSize: 13, fontWeight: '700', color: '#374151' }}>{child.label}</Text>
                                            {isChildGatedByIndustry && (
                                              <View style={{
                                                marginLeft: 6,
                                                paddingHorizontal: 6,
                                                paddingVertical: 2,
                                                borderRadius: 6,
                                                backgroundColor: '#F3F4F6',
                                              }}>
                                                <Text style={{
                                                  fontSize: 9,
                                                  fontWeight: '700',
                                                  letterSpacing: 0.5,
                                                  color: '#6B7280',
                                                  textTransform: 'uppercase',
                                                }}>Industria</Text>
                                              </View>
                                            )}
                                          </View>
                                        </View>
                                        <AppToggle
                                          value={isChildOn && isOn}
                                          disabled={!isOn || isChildGatedByIndustry}
                                          onValueChange={(val) => {
                                            if (isChildGatedByIndustry) return;
                                            setForm((prev) => ({ ...prev, panel_ui: { ...prev.panel_ui, [child.key]: val } }));
                                          }}
                                        />
                                      </View>
                                    </View>
                                  );
                                })}
                              </View>
                            )}
                          </View>
                        );
                      });
                    })()}
                  
                    </ScrollView>
                    <Button title="Listo" onPress={() => setShowModulesModal(false)} fullWidth style={{ marginTop: 16 }} />
                  </View>
                </View>
              </View>
            </RNModal>

            </View>
          </View>

        {/* Marca */}
        <View onLayout={(e) => setOffsets(prev => ({ ...prev, branding: e.nativeEvent.layout.y }))} style={styles.webSection}>
          <SectionHeader title="Personalización" icon="palette" colorType="pink" />
          <View style={styles.sectionBody}>
            <Text style={{ fontSize: 12, color: '#6B7280', marginBottom: 16 }}>
              Configura el logo, favicon y colores de la app administrativa.
            </Text>

            <Text style={[styles.inputLabel, { marginTop: 0, marginBottom: 12 }]}>Recursos de Marca</Text>
            
            {/* Logo Upload Card */}
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              padding: 12,
              backgroundColor: '#F9FAFB',
              borderWidth: 1,
              borderColor: '#E5E7EB',
              borderRadius: 12,
              marginBottom: 12,
              minHeight: 76,
            }}>
              <View style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                backgroundColor: '#FFFFFF',
                borderWidth: 1,
                borderColor: '#E5E7EB',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                flexShrink: 0,
                padding: 4,
              }}>
                {form.app?.logo_url ? (
                  <Image source={{ uri: form.app.logo_url }} style={{ width: '100%', height: '100%', resizeMode: 'contain' }} />
                ) : (
                  <Ionicons name="image" size={18} color="#D1D5DB" />
                )}
              </View>
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                flex: 1,
                marginLeft: 12,
              }}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>Logo de la app</Text>
                  <Text style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }} numberOfLines={1}>PNG, JPG o SVG. Máx 2MB.</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <TouchableOpacity style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    borderColor: '#2ecc71',
                    borderWidth: 1,
                    borderRadius: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    backgroundColor: '#FFFFFF',
                  }}>
                    <Ionicons name="cloud-upload-outline" size={14} color="#2ecc71" />
                    <Text style={{ color: '#2ecc71', fontSize: 13, fontWeight: '600', marginLeft: 4 }}>
                      {form.app?.logo_url ? 'Cambiar' : 'Subir'}
                    </Text>
                  </TouchableOpacity>
                  {form.app?.logo_url && (
                    <TouchableOpacity style={{
                      borderWidth: 1,
                      borderColor: '#FEE2E2',
                      backgroundColor: '#FFFFFF',
                      borderRadius: 8,
                      width: 30,
                      height: 30,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginLeft: 6,
                    }}>
                      <Ionicons name="close" size={16} color="#DC2626" />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </View>

            {/* Favicon Upload Card */}
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              padding: 12,
              backgroundColor: '#F9FAFB',
              borderWidth: 1,
              borderColor: '#E5E7EB',
              borderRadius: 12,
              marginBottom: 24,
              minHeight: 76,
            }}>
              <View style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                backgroundColor: '#FFFFFF',
                borderWidth: 1,
                borderColor: '#E5E7EB',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                flexShrink: 0,
                padding: 4,
              }}>
                {form.app?.favicon_url ? (
                  <Image source={{ uri: form.app.favicon_url }} style={{ width: '100%', height: '100%', resizeMode: 'contain' }} />
                ) : (
                  <Ionicons name="sparkles" size={17} color="#D1D5DB" />
                )}
              </View>
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                flex: 1,
                marginLeft: 12,
              }}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>Favicon de la app</Text>
                  <Text style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }} numberOfLines={1}>PNG o ICO. Máx 1MB.</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <TouchableOpacity style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    borderColor: '#2ecc71',
                    borderWidth: 1,
                    borderRadius: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    backgroundColor: '#FFFFFF',
                  }}>
                    <Ionicons name="cloud-upload-outline" size={14} color="#2ecc71" />
                    <Text style={{ color: '#2ecc71', fontSize: 13, fontWeight: '600', marginLeft: 4 }}>
                      {form.app?.favicon_url ? 'Cambiar' : 'Subir'}
                    </Text>
                  </TouchableOpacity>
                  {form.app?.favicon_url && (
                    <TouchableOpacity style={{
                      borderWidth: 1,
                      borderColor: '#FEE2E2',
                      backgroundColor: '#FFFFFF',
                      borderRadius: 8,
                      width: 30,
                      height: 30,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginLeft: 6,
                    }}>
                      <Ionicons name="close" size={16} color="#DC2626" />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </View>

            <Text style={[styles.inputLabel, { marginTop: 12, marginBottom: 12 }]}>Colores de la Marca</Text>
            
            {/* Color cards grid */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {/* Primario */}
              <View style={{
                flexGrow: 1,
                flexShrink: 1,
                flexBasis: '47%',
                minWidth: 140,
                padding: 12,
                backgroundColor: '#F9FAFB',
                borderWidth: 1,
                borderColor: '#E5E7EB',
                borderRadius: 12,
              }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Primario</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 32, height: 32, borderRadius: 8, borderWidth: 2, borderColor: '#E5E7EB', backgroundColor: form.app?.primary_color || '#e93b01' }} />
                  <TextInput
                    style={{
                      flex: 1,
                      fontSize: 12,
                      fontFamily: 'monospace',
                      color: '#111827',
                      backgroundColor: '#FFFFFF',
                      borderWidth: 1,
                      borderColor: '#E5E7EB',
                      borderRadius: 8,
                      paddingHorizontal: 6,
                      paddingVertical: 4,
                      textAlign: 'center',
                      minHeight: 32,
                    }}
                    value={form.app?.primary_color}
                    onChangeText={(v) => updateAppField('primary_color', v)}
                    placeholder="#e93b01"
                    autoCapitalize="none"
                  />
                </View>
              </View>

              {/* Secundario */}
              <View style={{
                flexGrow: 1,
                flexShrink: 1,
                flexBasis: '47%',
                minWidth: 140,
                padding: 12,
                backgroundColor: '#F9FAFB',
                borderWidth: 1,
                borderColor: '#E5E7EB',
                borderRadius: 12,
              }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Secundario</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 32, height: 32, borderRadius: 8, borderWidth: 2, borderColor: '#E5E7EB', backgroundColor: form.app?.secondary_color || '#ab6d3b' }} />
                  <TextInput
                    style={{
                      flex: 1,
                      fontSize: 12,
                      fontFamily: 'monospace',
                      color: '#111827',
                      backgroundColor: '#FFFFFF',
                      borderWidth: 1,
                      borderColor: '#E5E7EB',
                      borderRadius: 8,
                      paddingHorizontal: 6,
                      paddingVertical: 4,
                      textAlign: 'center',
                      minHeight: 32,
                    }}
                    value={form.app?.secondary_color}
                    onChangeText={(v) => updateAppField('secondary_color', v)}
                    placeholder="#ab6d3b"
                    autoCapitalize="none"
                  />
                </View>
              </View>

              {/* Acento */}
              <View style={{
                flexGrow: 1,
                flexShrink: 1,
                flexBasis: '47%',
                minWidth: 140,
                padding: 12,
                backgroundColor: '#F9FAFB',
                borderWidth: 1,
                borderColor: '#E5E7EB',
                borderRadius: 12,
              }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Acento</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 32, height: 32, borderRadius: 8, borderWidth: 2, borderColor: '#E5E7EB', backgroundColor: form.app?.accent_color || '#e2a522' }} />
                  <TextInput
                    style={{
                      flex: 1,
                      fontSize: 12,
                      fontFamily: 'monospace',
                      color: '#111827',
                      backgroundColor: '#FFFFFF',
                      borderWidth: 1,
                      borderColor: '#E5E7EB',
                      borderRadius: 8,
                      paddingHorizontal: 6,
                      paddingVertical: 4,
                      textAlign: 'center',
                      minHeight: 32,
                    }}
                    value={form.app?.accent_color}
                    onChangeText={(v) => updateAppField('accent_color', v)}
                    placeholder="#e2a522"
                    autoCapitalize="none"
                  />
                </View>
              </View>
            </View>

            {/* Info help box */}
            <View style={{
              backgroundColor: '#EFF6FF',
              borderWidth: 1,
              borderColor: '#BFDBFE',
              padding: 16,
              borderRadius: 12,
              marginTop: 16
            }}>
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginBottom: 12 }}>
                <View style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  backgroundColor: '#DBEAFE',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <Ionicons name="help-circle" size={18} color="#2563EB" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: '#1E3A5F', marginBottom: 4 }}>
                    ¿No ves los cambios de personalización en tu tienda?
                  </Text>
                  <Text style={{ fontSize: 13, color: '#1D4ED8', lineHeight: 18 }}>
                    Estás navegando desde el dominio de Vendix. Los cambios de marca, colores y logotipo se aplican en el entorno personalizado de tu tienda. Visita tu app para ver cómo se ve tu marca.
                  </Text>
                </View>
              </View>
              <TouchableOpacity style={{
                backgroundColor: '#2563EB',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 8,
                alignSelf: 'flex-start',
                minHeight: 38,
              }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: '#FFFFFF' }}>Ir a mi app</Text>
                <Ionicons name="open-outline" size={14} color="#FFFFFF" style={{ marginLeft: 6 }} />
              </TouchableOpacity>
            </View>
          </View>
          </View>

        {/* Inventario */}
        <View onLayout={(e) => setOffsets(prev => ({ ...prev, inventory: e.nativeEvent.layout.y }))} style={styles.webSection}>
          <SectionHeader title="Inventario" icon="package" colorType="green" />
          <View style={styles.sectionBody}>
            <Text style={styles.sectionSubtitle}>Control de Stock</Text>
            
            <View style={{ marginBottom: 16 }}>
              <Text style={styles.inputLabel}>Umbral de Stock Bajo</Text>
              <TextInput
                style={styles.input}
                value={String(form.inventory?.low_stock_threshold ?? 20)}
                onChangeText={(v) => updateInventoryField('low_stock_threshold', Number(v) || 0)}
                keyboardType="numeric"
                placeholder="20"
              />
            </View>

            <Text style={styles.sectionSubtitle}>Comportamiento</Text>
            <Selector
              label="Acción sin stock"
              value={form.inventory?.out_of_stock_action ?? null}
              onChange={(v) => updateInventoryField('out_of_stock_action', v)}
              options={[
                { value: 'show', label: 'Mostrar con etiqueta sin stock' },
                { value: 'hide', label: 'Ocultar producto' },
                { value: 'disable', label: 'Desactivar compra' },
                { value: 'allow_backorder', label: 'Permitir reserva' },
              ]}
              placeholder="Seleccionar..."
            />

            <Text style={styles.sectionSubtitle}>Valoración de Inventario</Text>
            <Selector
              label="Método de costeo"
              value={form.inventory?.costing_method ?? null}
              onChange={(v) => updateInventoryField('costing_method', v)}
              options={[
                { value: 'cpp', label: 'CPP (Costo Promedio Ponderado)' },
                { value: 'fifo', label: 'PEPS (FIFO)' },
              ]}
              placeholder="Seleccionar..."
            />
            <Text style={{ fontSize: 12, color: '#EA580C', marginTop: 8, marginBottom: 16, lineHeight: 16 }}>
              Cambiar el método de costeo puede tener implicaciones contables. Consulte con su contador antes de modificar esta configuración.
            </Text>

            <Text style={styles.sectionSubtitle}>Alcance de Bodegas</Text>
            <Selector
              label="Origen de stock en el POS"
              value={form.inventory?.pos_stock_scope ?? null}
              onChange={(v) => updateInventoryField('pos_stock_scope', v)}
              options={[
                { value: 'main_location', label: 'Bodega Principal' },
                { value: 'all_locations', label: 'Todas las bodegas' },
              ]}
              placeholder="Seleccionar..."
            />
            <Text style={[styles.toggleDesc, { marginTop: 4 }]}>Determina de qué bodegas el POS descuenta inventario al vender.</Text>

            <Selector
              label="Origen de alertas de stock bajo"
              value={form.inventory?.low_stock_alerts_scope ?? null}
              onChange={(v) => updateInventoryField('low_stock_alerts_scope', v)}
              options={[
                { value: 'main_location', label: 'Bodega Principal' },
                { value: 'all_locations', label: 'Todas las bodegas' },
              ]}
              placeholder="Seleccionar..."
            />
            <Text style={[styles.toggleDesc, { marginTop: 4 }]}>Define qué bodegas se consideran al evaluar el umbral de stock bajo.</Text>
          </View>
        </View>

        <View onLayout={(e) => setOffsets(prev => ({ ...prev, operations: e.nativeEvent.layout.y }))} style={styles.webSection}>
          <SectionHeader title="Operaciones" icon="clock" colorType="teal" />
          <View style={styles.sectionBody}>
            <Text style={[styles.sectionSubtitle, { marginTop: 0 }]}>Tiempos de Preparación</Text>
            
            <View style={{ marginBottom: 16 }}>
              <Text style={styles.inputLabel}>Tiempo de preparación por defecto</Text>
              <TextInput
                style={styles.input}
                value={String(form.operations?.default_preparation_time_minutes ?? 15)}
                onChangeText={(v) => updateOperationsField('default_preparation_time_minutes', Number(v) || 0)}
                keyboardType="numeric"
                placeholder="15"
              />
              <Text style={{ fontSize: 11, color: '#6B7280', marginTop: 4 }}>
                minutos — usado cuando el producto no tiene tiempo definido
              </Text>
            </View>

            <Text style={styles.sectionSubtitle}>Cierre de día</Text>
            <View style={{ marginBottom: 16 }}>
              <Text style={styles.inputLabel}>Hora de cierre de tickets</Text>
              <TextInput
                style={styles.input}
                value={String(form.operations?.ticket_closing_hour ?? 3)}
                onChangeText={(v) => updateOperationsField('ticket_closing_hour', Number(v) || 0)}
                keyboardType="numeric"
                placeholder="3"
              />
              <Text style={{ fontSize: 11, color: '#6B7280', marginTop: 4 }}>
                hora (0-23) a la que el KDS limpia y reinicia los tickets del día
              </Text>
            </View>

          </View>
        </View>

        {/* Mesas */}
        {settings?.general?.industries?.includes('restaurant') && (
          <View onLayout={(e) => setOffsets(prev => ({ ...prev, restaurant: e.nativeEvent.layout.y }))} style={styles.webSection}>
            <SectionHeader title="Mesas" icon="restaurant" colorType="teal" />
            <View style={styles.sectionBody}>
              <Text style={[styles.inputLabel, { marginBottom: 8 }]}>Cobro en mesa</Text>
              <View style={styles.toggleRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.toggleLabel}>Habilitar cobro desde la mesa</Text>
                  <Text style={styles.toggleDesc}>
                    Permite cobrar la cuenta directamente desde la vista de la mesa. Si está desactivado, solo se muestra el estado del pago.
                  </Text>
                </View>
                <AppToggle
                  value={form.restaurant?.enable_table_checkout ?? false}
                  onValueChange={(v) => updateRestaurantField('enable_table_checkout', v)}
                />
              </View>
            </View>
          </View>
        )}

        {/* Despacho */}
        <View onLayout={(e) => setOffsets(prev => ({ ...prev, dispatch: e.nativeEvent.layout.y }))} style={styles.webSection}>
          <SectionHeader title="Despacho y Logística" icon="truck" colorType="teal" />
          <View style={styles.sectionBody}>
            <View style={styles.toggleRow}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.toggleLabel}>Marcar la orden como entregada en vivo (al liquidar cada parada)</Text>
                <Text style={styles.toggleDesc}>
                  Activado: la orden se marca «entregada» apenas se liquida cada parada de la ruta. Desactivado: la orden avanza sólo al cerrar/cuadrar la planilla.
                </Text>
              </View>
              <AppToggle
                value={form.dispatch?.order_state_update_mode === 'live'}
                onValueChange={(v) => updateDispatchField('order_state_update_mode', v ? 'live' : 'on_close')}
              />
            </View>
          </View>
        </View>

        {/* Alertas */}
        <View onLayout={(e) => setOffsets(prev => ({ ...prev, notifications: e.nativeEvent.layout.y }))} style={styles.webSection}>
          <SectionHeader title="Notificaciones" icon="bell" colorType="purple" />
          <View style={styles.sectionBody}>
            <Text style={[styles.sectionSubtitle, { marginTop: 0 }]}>Canales de Comunicación</Text>
            
            <View style={styles.toggleRow}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.toggleLabel}>Notificaciones por Email</Text>
                <Text style={styles.toggleDesc}>Alertas vía correo electrónico</Text>
              </View>
              <AppToggle
                value={form.notifications?.email_enabled ?? false}
                onValueChange={(v) => updateNotificationsField('email_enabled', v)}
              />
            </View>

            <View style={styles.toggleRow}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.toggleLabel}>Notificaciones por SMS</Text>
                <Text style={styles.toggleDesc}>Alertas vía mensaje de texto</Text>
              </View>
              <AppToggle
                value={form.notifications?.sms_enabled ?? false}
                onValueChange={(v) => updateNotificationsField('sms_enabled', v)}
              />
            </View>

            <Text style={styles.sectionSubtitle}>Notificaciones en la App</Text>

            <View style={styles.toggleRow}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.toggleLabel}>Notificaciones en dispositivo</Text>
                <Text style={styles.toggleDesc}>Activa para recibir alertas en tu dispositivo</Text>
              </View>
              <AppToggle
                value={devicePushEnabled}
                onValueChange={(v) => setDevicePushEnabled(v)}
              />
            </View>

            <Text style={{ fontSize: 12, color: '#6B7280', marginTop: 12, marginBottom: 8 }}>
              Elige qué notificaciones deseas recibir en tiempo real dentro de la aplicación.
            </Text>

            <View style={styles.toggleRow}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.toggleLabel}>Nuevas órdenes</Text>
                <Text style={styles.toggleDesc}>Recibir en la app</Text>
              </View>
              <AppToggle
                value={subscriptions.new_order}
                onValueChange={(v) => setSubscriptions(prev => ({ ...prev, new_order: v }))}
              />
            </View>

            <View style={styles.toggleRow}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.toggleLabel}>Cambios de estado de orden</Text>
                <Text style={styles.toggleDesc}>Recibir en la app</Text>
              </View>
              <AppToggle
                value={subscriptions.order_status}
                onValueChange={(v) => setSubscriptions(prev => ({ ...prev, order_status: v }))}
              />
            </View>

            <View style={styles.toggleRow}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.toggleLabel}>Stock bajo</Text>
                <Text style={styles.toggleDesc}>Recibir en la app</Text>
              </View>
              <AppToggle
                value={subscriptions.low_stock}
                onValueChange={(v) => setSubscriptions(prev => ({ ...prev, low_stock: v }))}
              />
            </View>

            <View style={styles.toggleRow}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.toggleLabel}>Nuevos clientes</Text>
                <Text style={styles.toggleDesc}>Recibir en la app</Text>
              </View>
              <AppToggle
                value={subscriptions.new_customer}
                onValueChange={(v) => setSubscriptions(prev => ({ ...prev, new_customer: v }))}
              />
            </View>

            <View style={styles.toggleRow}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.toggleLabel}>Pagos recibidos</Text>
                <Text style={styles.toggleDesc}>Recibir en la app</Text>
              </View>
              <AppToggle
                value={subscriptions.payment_received}
                onValueChange={(v) => setSubscriptions(prev => ({ ...prev, payment_received: v }))}
              />
            </View>

            <View style={styles.toggleRow}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.toggleLabel}>Nuevas reseñas</Text>
                <Text style={styles.toggleDesc}>Recibir en la app</Text>
              </View>
              <AppToggle
                value={subscriptions.new_review}
                onValueChange={(v) => setSubscriptions(prev => ({ ...prev, new_review: v }))}
              />
            </View>

            <Text style={styles.sectionSubtitle}>Sonido de notificaciones</Text>
            <Text style={{ fontSize: 12, color: '#6B7280', marginBottom: 12 }}>
              Reproduce un sonido cuando llega una nueva notificación.
            </Text>

            <View style={styles.toggleRow}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.toggleLabel}>Silenciar sonidos</Text>
                <Text style={styles.toggleDesc}>Desactiva la reproducción de cualquier sonido</Text>
              </View>
              <AppToggle
                value={form.notifications?.sound_muted ?? false}
                onValueChange={(v) => updateNotificationsField('sound_muted', v)}
              />
            </View>

            <View style={{ marginTop: 16 }}>
              <NotificationSoundSettings
                soundId={form.notifications?.sound_id}
                soundVolume={form.notifications?.sound_volume}
                muted={!!form.notifications?.sound_muted}
                onSoundIdChange={(v) => updateNotificationsField('sound_id', v)}
                onSoundVolumeChange={(v) => updateNotificationsField('sound_volume', v)}
              />
            </View>

            <Text style={styles.sectionSubtitle}>Alertas de Eventos</Text>
            
            {/* Stock Bajo Alert Toggle and Inputs */}
            <View style={{ marginBottom: 16 }}>
              <View style={styles.toggleRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.toggleLabel}>Stock Bajo</Text>
                  <Text style={styles.toggleDesc}>Notificar cuando el producto se agote</Text>
                </View>
                <AppToggle
                  value={form.notifications?.low_stock_alerts ?? false}
                  onValueChange={(v) => updateNotificationsField('low_stock_alerts', v)}
                />
              </View>

              {form.notifications?.low_stock_alerts && (
                <View style={{ borderLeftWidth: 2, borderLeftColor: '#FFEDD5', marginLeft: 4, paddingLeft: 12, marginTop: 12 }}>
                  {form.notifications?.email_enabled && (
                    <View style={{ marginBottom: 12 }}>
                      <Text style={styles.inputLabel}>Email de Alerta</Text>
                      <TextInput
                        style={styles.input}
                        value={form.notifications?.low_stock_alerts_email || ''}
                        onChangeText={(v) => updateNotificationsField('low_stock_alerts_email', v || null)}
                        placeholder="adelingtoro@gmail.com"
                        keyboardType="email-address"
                        autoCapitalize="none"
                      />
                    </View>
                  )}
                  {form.notifications?.sms_enabled && (
                    <View style={{ marginBottom: 12 }}>
                      <Text style={styles.inputLabel}>Teléfono de Alerta</Text>
                      <TextInput
                        style={styles.input}
                        value={form.notifications?.low_stock_alerts_phone || ''}
                        onChangeText={(v) => updateNotificationsField('low_stock_alerts_phone', v || null)}
                        placeholder="+57..."
                        keyboardType="phone-pad"
                        autoCapitalize="none"
                      />
                    </View>
                  )}
                </View>
              )}
            </View>

            {/* Nuevos Pedidos Alert Toggle and Inputs */}
            <View style={{ marginBottom: 16 }}>
              <View style={styles.toggleRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.toggleLabel}>Nuevos Pedidos</Text>
                  <Text style={styles.toggleDesc}>Notificar al recibir una nueva venta</Text>
                </View>
                <AppToggle
                  value={form.notifications?.new_order_alerts ?? false}
                  onValueChange={(v) => updateNotificationsField('new_order_alerts', v)}
                />
              </View>

              {form.notifications?.new_order_alerts && (
                <View style={{ borderLeftWidth: 2, borderLeftColor: '#DBEAFE', marginLeft: 4, paddingLeft: 12, marginTop: 12 }}>
                  {form.notifications?.email_enabled && (
                    <View style={{ marginBottom: 12 }}>
                      <Text style={styles.inputLabel}>Email de Notificación</Text>
                      <TextInput
                        style={styles.input}
                        value={form.notifications?.new_order_alerts_email || ''}
                        onChangeText={(v) => updateNotificationsField('new_order_alerts_email', v || null)}
                        placeholder="orders@store.com"
                        keyboardType="email-address"
                        autoCapitalize="none"
                      />
                    </View>
                  )}
                  {form.notifications?.sms_enabled && (
                    <View style={{ marginBottom: 12 }}>
                      <Text style={styles.inputLabel}>Teléfono de Notificación</Text>
                      <TextInput
                        style={styles.input}
                        value={form.notifications?.new_order_alerts_phone || ''}
                        onChangeText={(v) => updateNotificationsField('new_order_alerts_phone', v || null)}
                        placeholder="+57..."
                        keyboardType="phone-pad"
                        autoCapitalize="none"
                      />
                    </View>
                  )}
                </View>
              )}
            </View>

          </View>
        </View>

        {/* POS */}
        <View onLayout={(e) => setOffsets(prev => ({ ...prev, pos: e.nativeEvent.layout.y }))} style={styles.webSection}>
          <SectionHeader title="Punto de Venta (POS)" icon="monitor" colorType="orange" />
          <View style={styles.sectionBody}>
            <Text style={[styles.sectionSubtitle, { marginTop: 0 }]}>Ventas y Operación</Text>
              <View style={styles.toggleRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.toggleLabel}>Permitir Ventas Anónimas</Text>
                  <Text style={styles.toggleDesc}>Permite realizar ventas sin asociar un cliente.</Text>
                </View>
                <AppToggle
                  value={form.pos?.allow_anonymous_sales ?? false}
                  onValueChange={(v) => updatePosField('allow_anonymous_sales', v)}
                  trackColor={{ false: '#E5E7EB', true: '#2ecc71' }}
                  thumbColor="#fff"
                />
              </View>

              <View style={styles.toggleRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.toggleLabel}>Ventas Anónimas Predeterminadas</Text>
                  <Text style={styles.toggleDesc}>Iniciar checkout como cliente anónimo por defecto.</Text>
                </View>
                <AppToggle
                  value={form.pos?.anonymous_sales_as_default ?? false}
                  onValueChange={(v) => updatePosField('anonymous_sales_as_default', v)}
                  trackColor={{ false: '#E5E7EB', true: '#2ecc71' }}
                  thumbColor="#fff"
                />
              </View>

              <View style={styles.toggleRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.toggleLabel}>Permitir Editar Precios</Text>
                  <Text style={styles.toggleDesc}>Habilita cambiar el precio de catálogo en el carrito.</Text>
                </View>
                <AppToggle
                  value={form.pos?.allow_price_edit ?? false}
                  onValueChange={(v) => updatePosField('allow_price_edit', v)}
                  trackColor={{ false: '#E5E7EB', true: '#2ecc71' }}
                  thumbColor="#fff"
                />
              </View>

              <View style={styles.toggleRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.toggleLabel}>Permitir Descuentos</Text>
                  <Text style={styles.toggleDesc}>Habilita aplicar cupones o descuentos manuales en caja.</Text>
                </View>
                <AppToggle
                  value={form.pos?.allow_discount ?? false}
                  onValueChange={(v) => updatePosField('allow_discount', v)}
                  trackColor={{ false: '#E5E7EB', true: '#2ecc71' }}
                  thumbColor="#fff"
                />
              </View>

              <View style={{ marginBottom: 16 }}>
                <Text style={styles.inputLabel}>Descuento Máximo Autorizado (%)</Text>
                <TextInput
                  style={styles.input}
                  value={String(form.pos?.max_discount_percentage ?? 100)}
                  onChangeText={(v) => updatePosField('max_discount_percentage', Number(v) || 0)}
                  keyboardType="numeric"
                  placeholder="100"
                />
              </View>

              <Text style={styles.sectionSubtitle}>Caja Registradora</Text>

              <View style={styles.toggleRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.toggleLabel}>Activar Sesiones de Caja</Text>
                  <Text style={styles.toggleDesc}>Requiere apertura y cierre de turno para operar.</Text>
                </View>
                <AppToggle
                  value={form.pos?.cash_register?.enabled ?? false}
                  onValueChange={(v) => updatePosCashRegisterField('enabled', v)}
                  trackColor={{ false: '#E5E7EB', true: '#2ecc71' }}
                  thumbColor="#fff"
                />
              </View>

              <View style={styles.toggleRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.toggleLabel}>Requerir Sesión para Ventas</Text>
                  <Text style={styles.toggleDesc}>Bloquea el botón de pago si la caja no ha sido abierta.</Text>
                </View>
                <AppToggle
                  value={form.pos?.cash_register?.require_session_for_sales ?? false}
                  onValueChange={(v) => updatePosCashRegisterField('require_session_for_sales', v)}
                  trackColor={{ false: '#E5E7EB', true: '#2ecc71' }}
                  thumbColor="#fff"
                />
              </View>

              <View style={styles.toggleRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.toggleLabel}>Requerir Arqueo de Cierre</Text>
                  <Text style={styles.toggleDesc}>Obliga a contar el dinero físico al cerrar la sesión.</Text>
                </View>
                <AppToggle
                  value={form.pos?.cash_register?.require_closing_count ?? false}
                  onValueChange={(v) => updatePosCashRegisterField('require_closing_count', v)}
                  trackColor={{ false: '#E5E7EB', true: '#2ecc71' }}
                  thumbColor="#fff"
                />
              </View>

              <View style={styles.toggleRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.toggleLabel}>Registrar Pagos No Efectivo</Text>
                  <Text style={styles.toggleDesc}>Incluir tarjeta/transferencia en la sesión de caja.</Text>
                </View>
                <AppToggle
                  value={form.pos?.cash_register?.track_non_cash_payments ?? false}
                  onValueChange={(v) => updatePosCashRegisterField('track_non_cash_payments', v)}
                  trackColor={{ false: '#E5E7EB', true: '#2ecc71' }}
                  thumbColor="#fff"
                />
              </View>

              <View style={styles.toggleRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.toggleLabel}>Múltiples Sesiones por Usuario</Text>
                  <Text style={styles.toggleDesc}>Permitir abrir más de una caja por cajero al mismo tiempo.</Text>
                </View>
                <AppToggle
                  value={form.pos?.cash_register?.allow_multiple_sessions_per_user ?? false}
                  onValueChange={(v) => updatePosCashRegisterField('allow_multiple_sessions_per_user', v)}
                  trackColor={{ false: '#E5E7EB', true: '#2ecc71' }}
                  thumbColor="#fff"
                />
              </View>

              <View style={styles.toggleRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.toggleLabel}>Auto-crear Caja por Defecto</Text>
                  <Text style={styles.toggleDesc}>Crear &quot;Caja 1&quot; (POS-01) automáticamente al habilitar.</Text>
                </View>
                <AppToggle
                  value={form.pos?.cash_register?.auto_create_default_register ?? false}
                  onValueChange={(v) => updatePosCashRegisterField('auto_create_default_register', v)}
                  trackColor={{ false: '#E5E7EB', true: '#2ecc71' }}
                  thumbColor="#fff"
                />
              </View>

              <Text style={styles.sectionSubtitle}>Cola Virtual de Clientes</Text>
              <View style={styles.toggleRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.toggleLabel}>Habilitar Cola Virtual</Text>
                  <Text style={styles.toggleDesc}>Clientes se pre-registran escaneando QR en tienda.</Text>
                </View>
                <AppToggle
                  value={form.pos?.customer_queue?.enabled ?? false}
                  onValueChange={(v) => updatePosCustomerQueueField('enabled', v)}
                  trackColor={{ false: '#E5E7EB', true: '#2ecc71' }}
                  thumbColor="#fff"
                />
              </View>

              <View style={styles.toggleRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.toggleLabel}>Requerir Email en Cola</Text>
                  <Text style={styles.toggleDesc}>Email obligatorio en el formulario público de registro.</Text>
                </View>
                <AppToggle
                  value={form.pos?.customer_queue?.require_email ?? false}
                  onValueChange={(v) => updatePosCustomerQueueField('require_email', v)}
                  trackColor={{ false: '#E5E7EB', true: '#2ecc71' }}
                  thumbColor="#fff"
                />
              </View>

              {form.pos?.customer_queue?.enabled && (
                <View style={styles.subCard}>
                  <Text style={styles.subCardTitle}>Configuración de Cola</Text>
                  <View style={{ marginBottom: 16 }}>
                    <Text style={styles.inputLabel}>Expiración (horas)</Text>
                    <TextInput
                      style={styles.input}
                      value={String(form.pos?.customer_queue?.queue_expiry_hours ?? 2)}
                      onChangeText={(v) => updatePosCustomerQueueField('queue_expiry_hours', Number(v) || 2)}
                      keyboardType="numeric"
                      placeholder="2"
                    />
                  </View>
                  <View style={{ marginBottom: 16 }}>
                    <Text style={styles.inputLabel}>Tamaño máximo de cola (0 = sin límite)</Text>
                    <TextInput
                      style={styles.input}
                      value={String(form.pos?.customer_queue?.max_queue_size ?? 0)}
                      onChangeText={(v) => updatePosCustomerQueueField('max_queue_size', Number(v) || 0)}
                      keyboardType="numeric"
                      placeholder="0"
                    />
                  </View>
                </View>
              )}
          </View>
        </View>

        {/* Recibos */}
        <View onLayout={(e) => setOffsets(prev => ({ ...prev, receipts: e.nativeEvent.layout.y }))} style={styles.webSection}>
          <SectionHeader title="Recibos y Facturación" icon="file-text" colorType="indigo" />
          <View style={styles.sectionBody}>
              <View style={styles.toggleRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.toggleLabel}>Imprimir Recibo de Venta</Text>
                  <Text style={styles.toggleDesc}>Imprimir el ticket en la impresora de recibos local.</Text>
                </View>
                <AppToggle
                  value={form.receipts?.print_receipt ?? false}
                  onValueChange={(v) => updateReceiptsField('print_receipt', v)}
                  trackColor={{ false: '#E5E7EB', true: '#2ecc71' }}
                  thumbColor="#fff"
                />
              </View>

              <View style={styles.toggleRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.toggleLabel}>Enviar Recibo por Email</Text>
                  <Text style={styles.toggleDesc}>Enviar copia digital en PDF al correo del cliente.</Text>
                </View>
                <AppToggle
                  value={form.receipts?.email_receipt ?? false}
                  onValueChange={(v) => updateReceiptsField('email_receipt', v)}
                  trackColor={{ false: '#E5E7EB', true: '#2ecc71' }}
                  thumbColor="#fff"
                />
              </View>

              <View style={{ marginBottom: 16 }}>
                <Text style={styles.inputLabel}>Cabecera del Recibo</Text>
                <TextInput
                  style={[styles.input, { height: 60, paddingTop: 10 }]}
                  value={form.receipts?.receipt_header || ''}
                  onChangeText={(v) => updateReceiptsField('receipt_header', v)}
                  placeholder="Ej: ¡Gracias por su compra!"
                  multiline
                  numberOfLines={2}
                />
              </View>

              <View style={{ marginBottom: 16 }}>
                <Text style={styles.inputLabel}>Pie de Página del Recibo</Text>
                <TextInput
                  style={[styles.input, { height: 60, paddingTop: 10 }]}
                  value={form.receipts?.receipt_footer || ''}
                  onChangeText={(v) => updateReceiptsField('receipt_footer', v)}
                  placeholder="Ej: Resolución DIAN No. 12345..."
                  multiline
                  numberOfLines={2}
                />
              </View>
          </View>

        </View>


        {/* Zona Fit (Gimnasio) */}
        {settings?.general?.industries?.includes('gym') && (
          <View onLayout={(e) => setOffsets(prev => ({ ...prev, membership: e.nativeEvent.layout.y }))} style={styles.webSection}>
            <SectionHeader title="Zona Fit" icon="dumbbell" colorType="teal" />
              <View style={styles.sectionBody}>
                <View style={styles.toggleRow}>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={styles.toggleLabel}>Acceso en Segundo Plano</Text>
                    <Text style={styles.toggleDesc}>Permite validar accesos continuos por aforo en segundo plano.</Text>
                  </View>
                  <AppToggle
                    value={form.membership?.ambient_access_enabled ?? false}
                    onValueChange={(v) => updateMembershipField('ambient_access_enabled', v)}
                    trackColor={{ false: '#E5E7EB', true: '#2ecc71' }}
                    thumbColor="#fff"
                  />
                </View>

                <View style={styles.toggleRow}>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={styles.toggleLabel}>Control de Aforo</Text>
                    <Text style={styles.toggleDesc}>Habilitar límite máximo de personas permitidas en simultáneo.</Text>
                  </View>
                  <AppToggle
                    value={form.membership?.capacity_control_enabled ?? false}
                    onValueChange={(v) => updateMembershipField('capacity_control_enabled', v)}
                    trackColor={{ false: '#E5E7EB', true: '#2ecc71' }}
                    thumbColor="#fff"
                  />
                </View>

                <Input
                style={{ marginBottom: 16, marginTop: 8 }}
                  label="Aforo Máximo Autorizado"
                  value={String(form.membership?.max_capacity ?? 0)}
                  onChangeText={(v) => updateMembershipField('max_capacity', Number(v) || 0)}
                  keyboardType="numeric"
                  placeholder="100"
                />

                <View style={styles.toggleRow}>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={styles.toggleLabel}>Modo Molinete (Torniquete)</Text>
                    <Text style={styles.toggleDesc}>El control de aforo se rige de manera estricta por hardware.</Text>
                  </View>
                  <AppToggle
                    value={form.membership?.turnstile_mode ?? false}
                    onValueChange={(v) => updateMembershipField('turnstile_mode', v)}
                    trackColor={{ false: '#E5E7EB', true: '#2ecc71' }}
                    thumbColor="#fff"
                  />
                </View>
              </View>

          </View>
        )}
      </ScrollView>
      )}
      <View style={sectionStyles.footer}>
        <Button
          title="Guardar Cambios"
          onPress={handleSubmit}
          loading={updateMutation.isPending}
          fullWidth
        />
      </View>
    </View>
  );
}

// ─── Payments Tab ───────────────────────────────────────────────────────────

function PaymentsTab() {
  const queryClient = useQueryClient();
  const { data: methods, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['payment-methods'],
    queryFn: () => SettingsService.getPaymentMethods(),
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => SettingsService.togglePaymentMethod(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payment-methods'] });
    },
    onError: () => toastError('Error al cambiar estado del método de pago'),
  });

  if (isLoading) {
    return (
      <View style={sectionStyles.loader}>
        <Spinner />
      </View>
    );
  }

  return (
    <View style={sectionStyles.container}>
      <FlatList
        data={methods ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={sectionStyles.listContent}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
        ListHeaderComponent={
          <View style={sectionStyles.content}>
            <Text style={sectionStyles.sectionTitle}>Métodos de Pago</Text>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title="Sin métodos de pago"
            description="No hay métodos de pago configurados"
            icon="credit-card"
          />
        }
        renderItem={({ item }) => (
          <View style={[sectionStyles.content, { marginTop: 0 }]}>
            <Card style={cardStyles.card}>
              <Card.Body style={cardStyles.cardBody}>
                <View style={cardStyles.cardRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={cardStyles.cardTitle}>{item.name}</Text>
                    <Badge label={item.type} variant="info" size="sm" />
                  </View>
                  <AppToggle
                    value={item.enabled}
                    onValueChange={() => toggleMutation.mutate(item.id)}
                    trackColor={{
                      false: colorScales.gray[200],
                      true: colorScales.green[600],
                    }}
                    thumbColor={colors.background}
                  />
                </View>
              </Card.Body>
            </Card>
          </View>
        )}
      />
    </View>
  );
}

// ─── Users Tab ──────────────────────────────────────────────────────────────

function UsersTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingUser, setEditingUser] = useState<StoreUser | null>(null);
  const [showConfirmToggle, setShowConfirmToggle] = useState<StoreUser | null>(null);

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['settings-users', search],
    queryFn: () => SettingsService.getUsers({ search: search || undefined }),
  });

  const users = data?.data ?? [];
  const totalUsers = data?.pagination?.total ?? 0;
  const activeUsers = users.filter((u) => u.state === 'active').length;

  const toggleUserMutation = useMutation({
    mutationFn: (id: string) => SettingsService.toggleUserState(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-users'] });
      toastSuccess('Estado del usuario actualizado');
      setShowConfirmToggle(null);
    },
    onError: () => toastError('Error al cambiar estado'),
  });

  const handleSearch = useCallback((text: string) => {
    setSearch(text);
  }, []);

  const renderUser = useCallback(
    ({ item }: { item: StoreUser }) => {
      const fullName = `${item.first_name} ${item.last_name}`;
      return (
        <View style={sectionStyles.content} key={item.id}>
          <Card style={cardStyles.card}>
            <Card.Body style={cardStyles.cardBody}>
              <View style={cardStyles.userHeader}>
                <Avatar name={fullName} size="md" />
                <View style={cardStyles.userInfo}>
                  <Text style={cardStyles.userName} numberOfLines={1}>
                    {fullName}
                  </Text>
                  <Text style={cardStyles.userEmail} numberOfLines={1}>
                    {item.email}
                  </Text>
                </View>
              </View>
              <View style={cardStyles.badgeRow}>
                {item.role_name && <Badge label={item.role_name} variant="info" size="sm" />}
                <Badge
                  label={item.state === 'active' ? 'Activo' : 'Inactivo'}
                  variant={item.state === 'active' ? 'success' : 'default'}
                  size="sm"
                />
              </View>
              <View style={cardStyles.actionsRow}>
                <Button
                  title="Editar"
                  size="sm"
                  variant="outline"
                  onPress={() => setEditingUser(item)}
                />
                <Button
                  title={item.state === 'active' ? 'Desactivar' : 'Activar'}
                  size="sm"
                  variant={item.state === 'active' ? 'secondary' : 'primary'}
                  onPress={() => setShowConfirmToggle(item)}
                />
              </View>
            </Card.Body>
          </Card>
        </View>
      );
    },
    [],
  );

  return (
    <View style={sectionStyles.container}>
      <FlatList
        data={users}
        keyExtractor={(item) => item.id}
        renderItem={renderUser}
        contentContainerStyle={sectionStyles.listContent}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
        ListHeaderComponent={
          <View style={sectionStyles.content}>
            <StatsGrid
              style={sectionStyles.statsGridOverride}
              items={[
                {
                  label: 'Total Usuarios',
                  value: String(totalUsers),
                  icon: <Icon name="users" size={14} color={colorScales.green[600]} />,
                },
                {
                  label: 'Activos',
                  value: String(activeUsers),
                  icon: <Icon name="user-check" size={14} color={colorScales.green[600]} />,
                },
              ]}
            />
            <SearchBar
              value={search}
              onChangeText={handleSearch}
              onClear={() => handleSearch('')}
              placeholder="Buscar usuarios..."
            />
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <Spinner />
          ) : (
            <EmptyState
              title="Sin usuarios"
              description="No hay usuarios en esta tienda"
              icon="users"
            />
          )
        }
      />
      <Pressable onPress={() => setShowCreateModal(true)} style={sectionStyles.fab}>
        <Icon name="plus" size={24} color={colors.background} />
      </Pressable>

      <CreateUserModal
        visible={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />
      <EditUserModal
        visible={!!editingUser}
        user={editingUser}
        onClose={() => setEditingUser(null)}
      />
      <ConfirmDialog
        visible={!!showConfirmToggle}
        onClose={() => setShowConfirmToggle(null)}
        onConfirm={() => showConfirmToggle && toggleUserMutation.mutate(showConfirmToggle.id)}
        title={showConfirmToggle?.state === 'active' ? 'Desactivar usuario' : 'Activar usuario'}
        message={`¿Estás seguro de que deseas ${showConfirmToggle?.state === 'active' ? 'desactivar' : 'activar'} a ${showConfirmToggle?.first_name} ${showConfirmToggle?.last_name}?`}
        confirmLabel={showConfirmToggle?.state === 'active' ? 'Desactivar' : 'Activar'}
        loading={toggleUserMutation.isPending}
      />
    </View>
  );
}

function CreateUserModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [sendInvite, setSendInvite] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const createMutation = useMutation({
    mutationFn: (data: CreateStoreUserDto) => SettingsService.createUser(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-users'] });
      toastSuccess('Usuario creado exitosamente');
      onClose();
    },
    onError: () => toastError('Error al crear usuario'),
  });

  const handleSubmit = () => {
    const newErrors: Record<string, string> = {};
    if (!firstName.trim()) newErrors.firstName = 'El nombre es requerido';
    if (!lastName.trim()) newErrors.lastName = 'El apellido es requerido';
    if (!email.trim()) {
      newErrors.email = 'El email es requerido';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = 'Ingresa un email válido';
    }
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;
    createMutation.mutate({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email: email.trim(),
      send_invite: sendInvite,
    });
  };

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title="Crear Usuario"
      showFooter
      footer={
        <Button
          title="Crear Usuario"
          onPress={handleSubmit}
          loading={createMutation.isPending}
          fullWidth
        />
      }
    >
      <View style={sectionStyles.content}>
        <Input
                style={{ marginBottom: 16, marginTop: 8 }}
          label="Nombre *"
          value={firstName}
          onChangeText={setFirstName}
          error={errors.firstName}
          placeholder="Nombre"
        />
        <Input
                style={{ marginBottom: 16, marginTop: 8 }}
          label="Apellido *"
          value={lastName}
          onChangeText={setLastName}
          error={errors.lastName}
          placeholder="Apellido"
        />
        <Input
                style={{ marginBottom: 16, marginTop: 8 }}
          label="Email *"
          value={email}
          onChangeText={setEmail}
          error={errors.email}
          placeholder="usuario@ejemplo.com"
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <View style={cardStyles.toggleRow}>
          <Text style={cardStyles.toggleLabel}>Enviar invitación por email</Text>
          <AppToggle
            value={sendInvite}
            onValueChange={setSendInvite}
            trackColor={{
              false: colorScales.gray[200],
              true: colorScales.green[600],
            }}
            thumbColor={colors.background}
          />
        </View>
      </View>
    </Modal>
  );
}

function EditUserModal({
  visible,
  user,
  onClose,
}: {
  visible: boolean;
  user: StoreUser | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useState(() => {
    if (user) {
      setFirstName(user.first_name);
      setLastName(user.last_name);
      setEmail(user.email);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateStoreUserDto }) =>
      SettingsService.updateUser(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-users'] });
      toastSuccess('Usuario actualizado');
      onClose();
    },
    onError: () => toastError('Error al actualizar usuario'),
  });

  const handleSubmit = () => {
    if (!user) return;
    const newErrors: Record<string, string> = {};
    if (!firstName.trim()) newErrors.firstName = 'El nombre es requerido';
    if (!lastName.trim()) newErrors.lastName = 'El apellido es requerido';
    if (!email.trim()) newErrors.email = 'El email es requerido';
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;
    updateMutation.mutate({
      id: user.id,
      data: {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
      },
    });
  };

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title="Editar Usuario"
      showFooter
      footer={
        <Button
          title="Guardar Cambios"
          onPress={handleSubmit}
          loading={updateMutation.isPending}
          fullWidth
        />
      }
    >
      <View style={sectionStyles.content}>
        <Input
                style={{ marginBottom: 16, marginTop: 8 }}
          label="Nombre *"
          value={firstName}
          onChangeText={setFirstName}
          error={errors.firstName}
          placeholder="Nombre"
        />
        <Input
                style={{ marginBottom: 16, marginTop: 8 }}
          label="Apellido *"
          value={lastName}
          onChangeText={setLastName}
          error={errors.lastName}
          placeholder="Apellido"
        />
        <Input
                style={{ marginBottom: 16, marginTop: 8 }}
          label="Email *"
          value={email}
          onChangeText={setEmail}
          error={errors.email}
          placeholder="usuario@ejemplo.com"
          keyboardType="email-address"
          autoCapitalize="none"
        />
      </View>
    </Modal>
  );
}

// ─── Roles Tab ──────────────────────────────────────────────────────────────

function RolesTab() {
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingRole, setEditingRole] = useState<StoreRole | null>(null);
  const [deletingRole, setDeletingRole] = useState<StoreRole | null>(null);

  const { data: roles, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['settings-roles'],
    queryFn: () => SettingsService.getRoles(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => SettingsService.deleteRole(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-roles'] });
      toastSuccess('Rol eliminado');
      setDeletingRole(null);
    },
    onError: () => toastError('Error al eliminar rol'),
  });

  const renderRole = useCallback(
    ({ item }: { item: StoreRole }) => (
      <View style={sectionStyles.content} key={item.id}>
        <Card style={cardStyles.card}>
          <Card.Body style={cardStyles.cardBody}>
            <View style={cardStyles.cardRow}>
              <View style={{ flex: 1 }}>
                <Text style={cardStyles.cardTitle}>{item.name}</Text>
                {item.description && (
                  <Text style={cardStyles.cardSubtitle} numberOfLines={2}>
                    {item.description}
                  </Text>
                )}
                <Text style={cardStyles.cardDetail}>
                  {item.user_count} usuario{item.user_count !== 1 ? 's' : ''}
                </Text>
              </View>
              {item.is_default && (
                <Badge label="Predeterminado" variant="success" size="sm" />
              )}
            </View>
            <View style={cardStyles.actionsRow}>
              <Button
                title="Editar"
                size="sm"
                variant="outline"
                onPress={() => setEditingRole(item)}
              />
              {!item.is_default && (
                <Button
                  title="Eliminar"
                  size="sm"
                  variant="destructive"
                  onPress={() => setDeletingRole(item)}
                />
              )}
            </View>
          </Card.Body>
        </Card>
      </View>
    ),
    [],
  );

  return (
    <View style={sectionStyles.container}>
      <FlatList
        data={roles ?? []}
        keyExtractor={(item) => item.id}
        renderItem={renderRole}
        contentContainerStyle={sectionStyles.listContent}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
        ListHeaderComponent={
          <View style={sectionStyles.content}>
            <Text style={sectionStyles.sectionTitle}>Roles</Text>
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <Spinner />
          ) : (
            <EmptyState
              title="Sin roles"
              description="No hay roles configurados"
              icon="shield"
            />
          )
        }
      />
      <Pressable onPress={() => setShowCreateModal(true)} style={sectionStyles.fab}>
        <Icon name="plus" size={24} color={colors.background} />
      </Pressable>

      <CreateRoleModal
        visible={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />
      <EditRoleModal
        visible={!!editingRole}
        role={editingRole}
        onClose={() => setEditingRole(null)}
      />
      <ConfirmDialog
        visible={!!deletingRole}
        onClose={() => setDeletingRole(null)}
        onConfirm={() => deletingRole && deleteMutation.mutate(deletingRole.id)}
        title="Eliminar rol"
        message={`¿Estás seguro de que deseas eliminar el rol "${deletingRole?.name}"?`}
        confirmLabel="Eliminar"
        destructive
        loading={deleteMutation.isPending}
      />
    </View>
  );
}

function CreateRoleModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const createMutation = useMutation({
    mutationFn: (data: CreateStoreRoleDto) => SettingsService.createRole(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-roles'] });
      toastSuccess('Rol creado exitosamente');
      onClose();
    },
    onError: () => toastError('Error al crear rol'),
  });

  const handleSubmit = () => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = 'El nombre es requerido';
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;
    createMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
    });
  };

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title="Crear Rol"
      showFooter
      footer={
        <Button
          title="Crear Rol"
          onPress={handleSubmit}
          loading={createMutation.isPending}
          fullWidth
        />
      }
    >
      <View style={sectionStyles.content}>
        <Input
                style={{ marginBottom: 16, marginTop: 8 }}
          label="Nombre *"
          value={name}
          onChangeText={setName}
          error={errors.name}
          placeholder="Nombre del rol"
        />
        <Input
                style={{ marginBottom: 16, marginTop: 8 }}
          label="Descripción"
          value={description}
          onChangeText={setDescription}
          placeholder="Descripción del rol"
          multiline
          numberOfLines={3}
        />
      </View>
    </Modal>
  );
}

function EditRoleModal({
  visible,
  role,
  onClose,
}: {
  visible: boolean;
  role: StoreRole | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useState(() => {
    if (role) {
      setName(role.name);
      setDescription(role.description ?? '');
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateStoreRoleDto }) =>
      SettingsService.updateRole(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-roles'] });
      toastSuccess('Rol actualizado');
      onClose();
    },
    onError: () => toastError('Error al actualizar rol'),
  });

  const handleSubmit = () => {
    if (!role) return;
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = 'El nombre es requerido';
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;
    updateMutation.mutate({
      id: role.id,
      data: {
        name: name.trim(),
        description: description.trim() || undefined,
      },
    });
  };

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title="Editar Rol"
      showFooter
      footer={
        <Button
          title="Guardar Cambios"
          onPress={handleSubmit}
          loading={updateMutation.isPending}
          fullWidth
        />
      }
    >
      <View style={sectionStyles.content}>
        <Input
                style={{ marginBottom: 16, marginTop: 8 }}
          label="Nombre *"
          value={name}
          onChangeText={setName}
          error={errors.name}
          placeholder="Nombre del rol"
        />
        <Input
                style={{ marginBottom: 16, marginTop: 8 }}
          label="Descripción"
          value={description}
          onChangeText={setDescription}
          placeholder="Descripción del rol"
          multiline
          numberOfLines={3}
        />
      </View>
    </Modal>
  );
}

// ─── Appearance Tab ─────────────────────────────────────────────────────────

function AppearanceTab() {
  const [selectedTheme, setSelectedTheme] = useState<'light' | 'dark' | 'system'>('system');

  const themeOptions: { key: 'light' | 'dark' | 'system'; label: string }[] = [
    { key: 'light', label: 'Claro' },
    { key: 'dark', label: 'Oscuro' },
    { key: 'system', label: 'Sistema' },
  ];

  return (
    <View style={sectionStyles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={sectionStyles.content}
      >
        <Text style={sectionStyles.sectionTitle}>Logo</Text>
        <Card>
          <Card.Body>
            <View style={cardStyles.placeholderBox}>
              <Icon name="store" size={32} color={colorScales.gray[400]} />
            </View>
            <Button
              title="Cambiar Logo"
              variant="outline"
              fullWidth
              onPress={() => toastInfo('Función próximamente')}
            />
          </Card.Body>
        </Card>

        <Text style={sectionStyles.sectionTitle}>Tema</Text>
        <Card>
          <Card.Body>
            {themeOptions.map((option, index) => (
              <Pressable
                key={option.key}
                onPress={() => {
                  setSelectedTheme(option.key);
                  toastInfo('Función próximamente');
                }}
                style={[
                  cardStyles.themeOption,
                  index === themeOptions.length - 1 && cardStyles.themeOptionLast,
                ]}
              >
                <Text style={cardStyles.themeLabel}>{option.label}</Text>
                <AppToggle
                  value={selectedTheme === option.key}
                  onValueChange={() => {
                    setSelectedTheme(option.key);
                    toastInfo('Función próximamente');
                  }}
                  trackColor={{
                    false: colorScales.gray[200],
                    true: colorScales.green[600],
                  }}
                  thumbColor={colors.background}
                />
              </Pressable>
            ))}
          </Card.Body>
        </Card>
      </ScrollView>
    </View>
  );
}

// ─── Security Tab ───────────────────────────────────────────────────────────

function SecurityTab() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [twoFactor, setTwoFactor] = useState(false);

  const handleChangePassword = () => {
    const newErrors: Record<string, string> = {};
    if (!currentPassword) newErrors.currentPassword = 'Contraseña actual requerida';
    if (!newPassword) newErrors.newPassword = 'Nueva contraseña requerida';
    if (newPassword && newPassword.length < 8) newErrors.newPassword = 'Mínimo 8 caracteres';
    if (newPassword !== confirmPassword) newErrors.confirmPassword = 'Las contraseñas no coinciden';
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;
    toastSuccess('Contraseña actualizada');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  return (
    <View style={sectionStyles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={sectionStyles.content}
      >
        <Text style={sectionStyles.sectionTitle}>Cambiar Contraseña</Text>
        <Card>
          <Card.Body>
            <Input
                style={{ marginBottom: 16, marginTop: 8 }}
              label="Contraseña Actual"
              value={currentPassword}
              onChangeText={setCurrentPassword}
              error={errors.currentPassword}
              placeholder="••••••••"
              secureTextEntry
            />
            <Input
                style={{ marginBottom: 16, marginTop: 8 }}
              label="Nueva Contraseña"
              value={newPassword}
              onChangeText={setNewPassword}
              error={errors.newPassword}
              placeholder="••••••••"
              secureTextEntry
            />
            <Input
                style={{ marginBottom: 16, marginTop: 8 }}
              label="Confirmar Contraseña"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              error={errors.confirmPassword}
              placeholder="••••••••"
              secureTextEntry
            />
            <Button
              title="Actualizar Contraseña"
              onPress={handleChangePassword}
              fullWidth
            />
          </Card.Body>
        </Card>

        <Text style={sectionStyles.sectionTitle}>Seguridad Adicional</Text>
        <Card>
          <Card.Body>
            <View style={cardStyles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={cardStyles.cardTitle}>Autenticación de dos factores</Text>
                <Text style={cardStyles.cardSubtitle}>
                  Agrega una capa extra de seguridad a tu cuenta
                </Text>
              </View>
              <AppToggle
                value={twoFactor}
                onValueChange={() => {
                  setTwoFactor(!twoFactor);
                  toastInfo('Función próximamente');
                }}
                trackColor={{
                  false: colorScales.gray[200],
                  true: colorScales.green[600],
                }}
                thumbColor={colors.background}
              />
            </View>
          </Card.Body>
        </Card>

        <Text style={sectionStyles.sectionTitle}>Sesión Actual</Text>
        <Card>
          <Card.Body>
            <View style={cardStyles.toggleRow}>
              <View>
                <Text style={cardStyles.cardTitle}>Dispositivo actual</Text>
                <Text style={cardStyles.cardSubtitle}>App Móvil</Text>
              </View>
              <Badge label="Activo" variant="success" size="sm" />
            </View>
          </Card.Body>
        </Card>
      </ScrollView>
    </View>
  );
}

export default function SettingsScreen() {
  return (
    <View style={screenStyles.root}>
      <GeneralTab />
    </View>
  );
}

const screenStyles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F8FAFC', // Web surface grey
  },
});

const styles = StyleSheet.create({
  /* ── Missing from refactor ── */
  sectionSubtitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 12,
    marginTop: 24,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: '#F9FAFB',
    color: '#111827',
    fontSize: 14,
    marginBottom: 16,
  },
  /* ── Input label: matches web text-xs font-bold text-gray-400 uppercase ── */
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  /* ── Toggle row: matches web app-setting-toggle layout ── */
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#F3F4F6',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 12,
  },
  /* ── Toggle label: web .font-medium text-sm text-gray-700 ── */
  toggleLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#111827',
    lineHeight: 20,
  },
  /* ── Toggle description: web .text-xs text-gray-500 ── */
  toggleDesc: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
    lineHeight: 16,
    flexShrink: 1,
  },
  /* ── Web section: white card with border and shadow, no top SectionHeader padding ── */
  webSection: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
    overflow: 'hidden',
  },
  /* ── Section body (content inside webSection after header) ── */
  sectionBody: {
    padding: 16,
    gap: 0,
  },
  /* ── Sub-tabs: mismo estilo que la web (fondo surface, línea inferior activa) ── */
  subTabsContainer: {
    /* --color-surface de la web ≈ #F8FAFC — gris muy claro que da el efecto "flotante" */
    backgroundColor: '#F8FAFC',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(100,116,139,0.16)', /* rgba(--color-muted-rgb, 0.16) */
  },
  subTabsScroll: {
    paddingHorizontal: spacing[4],
    gap: 2,
    alignItems: 'flex-end',
  },
  subTabItem: {
    /* Igual que .sticky-header-tab de la web: transparente, sin borde de color */
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 0,
    backgroundColor: 'transparent',
    alignItems: 'center',
    position: 'relative',
  },
  subTabItemActive: {
    backgroundColor: 'transparent',
  },
  subTabLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colorScales.gray[500],
    opacity: 0.78,
  },
  subTabLabelActive: {
    color: colors.text.primary,
    opacity: 1,
  },
  /* Línea inferior — equivalente al ::after de .sticky-header-tab--active */
  subTabIndicator: {
    position: 'absolute',
    bottom: 0,
    left: 10,
    right: 10,
    height: 2,
    borderRadius: 99,
    backgroundColor: colors.primary,
    opacity: 0,
    transform: [{ scaleX: 0.35 }],
  },
  subTabIndicatorActive: {
    opacity: 1,
    transform: [{ scaleX: 1 }],
  },

  /* ── Industries multi-selector ── */
  industriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  industryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.card,
  },
  industryChipActive: {
    borderColor: colors.primary,
    backgroundColor: '#F0FDF4',
  },
  industryChipIcon: {
    fontSize: 14,
  },
  industryChipLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: colorScales.gray[600],
  },
  industryChipLabelActive: {
    color: colorScales.green[700],
    fontWeight: '600',
  },

  /* ── Store-type info box ── */
  infoBox: {
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
  },
  infoBoxBlue: {
    borderColor: '#BFDBFE',
    backgroundColor: '#EFF6FF',
  },
  infoBoxPurple: {
    borderColor: '#DDD6FE',
    backgroundColor: '#F5F3FF',
  },
  infoBoxGreen: {
    borderColor: '#A7F3D0',
    backgroundColor: '#ECFDF5',
  },
  infoBoxText: {
    fontSize: 12,
    lineHeight: 18,
    color: colorScales.gray[700],
  },

  /* ── Sub-card (expandible inside Card) ── */
  subCard: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    gap: 10,
  },
  subCardTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: colorScales.gray[400],
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },

  /* ── Card group title (sub-section inside a card) ── */
  cardGroupTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: colorScales.gray[400],
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
});

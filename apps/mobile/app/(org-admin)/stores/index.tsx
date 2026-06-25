import { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  RefreshControl,
  Modal as RNModal,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/core/store/auth.store';
import { performStoreSwitch } from '@/core/auth/store-switcher';
import { OrgStoreService } from '@/features/org/services/org-store.service';
import type { StoreListItem } from '@/core/models/org-admin/store.types';

import {
  SearchBar,
  ConfirmDialog,
  toastSuccess,
  toastError,
  EmptyState,
  StatsGrid,
} from '@/shared/components';
import { OrgCenteredModal } from '@/shared/components/org-centered-modal';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, spacing, typography, borderRadius, interFonts } from '@/shared/theme';

// ─── Store type labels & colors (aligned with web stores.component.ts) ────────
const storeTypeLabel: Record<string, string> = {
  physical: 'Física',
  PHYSICAL: 'Física',
  online: 'Online',
  ONLINE: 'Online',
  hybrid: 'Híbrida',
  HYBRID: 'Híbrida',
  popup: 'Temporal',
  POPUP: 'Temporal',
  kiosko: 'Kiosko',
  KIOSKO: 'Kiosko',
};

const storeTypeColor: Record<string, string> = {
  physical: '#22c55e',
  PHYSICAL: '#22c55e',
  online: '#3b82f6',
  ONLINE: '#3b82f6',
  hybrid: '#8b5cf6',
  HYBRID: '#8b5cf6',
  popup: '#f59e0b',
  POPUP: '#f59e0b',
  kiosko: '#ef4444',
  KIOSKO: '#ef4444',
};

const FILTER_TYPE_OPTIONS = [
  { value: '', label: 'Todos los Tipos' },
  { value: 'physical', label: 'Tienda Física' },
  { value: 'online', label: 'Tienda Online' },
  { value: 'hybrid', label: 'Tienda Híbrida' },
  { value: 'popup', label: 'Tienda Temporal' },
  { value: 'kiosko', label: 'Kiosko' },
];

const FILTER_STATE_OPTIONS = [
  { value: '', label: 'Todos los Estados' },
  { value: 'active', label: 'Activa' },
  { value: 'inactive', label: 'Inactiva' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatCompactNumber(num: number): string | number {
  if (!num) return 0;
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num;
}

function formatCurrency(amount: number): string {
  if (!amount) return '$ 0';
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `$ ${amount.toLocaleString()}`;
  }
}

// ─── Store Edit/Create Modal (web `app-store-edit-modal` parity) ────────────
// Espejo del `StoreEditModalComponent` web, en dos modos:
//   - mode="edit"   → title "Editar Tienda"   + botón "Actualizar Tienda"
//   - mode="create" → title "Nueva Tienda"    + botón "Crear Tienda"
//   - size="lg" (720px max), sección "Información de la Tienda" con grid 2-col
//   - footer Cancelar + acción primaria
//
// El web tiene secciones adicionales (Recursos de Marca con logo, Información
// de Dirección completa). Mobile las omite por ahora — son nice-to-have
// y no afectan el flow principal del usuario.
const STORE_TYPE_OPTIONS = [
  { value: 'physical', label: 'Tienda Física' },
  { value: 'online', label: 'Tienda Online' },
  { value: 'hybrid', label: 'Tienda Híbrida' },
  { value: 'popup', label: 'Tienda Temporal' },
  { value: 'kiosko', label: 'Kiosko' },
] as const;

// Auto-genera slug desde nombre (mismo patrón que `store-upsert-form.tsx`)
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function StoreEditModal({
  visible,
  onClose,
  onSubmit,
  store,
  loading,
  mode = 'edit',
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: {
    name: string;
    email: string;
    phone?: string;
    description?: string;
    is_active: boolean;
    store_type: string;
  }) => void;
  store: StoreListItem | null;
  loading: boolean;
  mode?: 'create' | 'edit';
}) {
  const isCreate = mode === 'create';
  const [name, setName] = useState(store?.name || '');
  const [email, setEmail] = useState((store as any)?.email || '');
  const [phone, setPhone] = useState((store as any)?.phone || '');
  const [description, setDescription] = useState((store as any)?.description || '');
  const [storeType, setStoreType] = useState(store?.store_type || 'physical');
  const [isActive, setIsActive] = useState<boolean>(store?.is_active ?? true);

  const [pickerOpen, setPickerOpen] = useState<null | 'type' | 'status'>(null);

  useMemo(() => {
    if (isCreate) {
      // Reset a vacío cada vez que se abre el modal de creación
      setName('');
      setEmail('');
      setPhone('');
      setDescription('');
      setStoreType('physical');
      setIsActive(true);
    } else if (store) {
      setName(store.name || '');
      setEmail((store as any).email || '');
      setPhone((store as any).phone || '');
      setDescription((store as any).description || '');
      setStoreType(store.store_type || 'physical');
      setIsActive(store.is_active ?? true);
    }
  }, [store, isCreate, visible]);

  const handleSave = () => {
    if (!name.trim() || !email.trim()) {
      toastError('Por favor completa los campos obligatorios (*).');
      return;
    }
    onSubmit({
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim() || undefined,
      description: description.trim() || undefined,
      is_active: isActive,
      store_type: storeType,
    });
  };

  return (
    <OrgCenteredModal
      visible={visible}
      onClose={onClose}
      title={isCreate ? 'Nueva Tienda' : 'Editar Tienda'}
      subtitle={
        isCreate
          ? 'Crea una nueva tienda para la organización'
          : 'Actualiza la información de la tienda seleccionada'
      }
      size="lg"
      footer={
        <View style={editStyles.footer}>
          <Pressable
            style={({ pressed }) => [editStyles.cancelBtn, pressed && { opacity: 0.75 }]}
            onPress={onClose}
            disabled={loading}
          >
            <Text style={editStyles.cancelBtnText}>Cancelar</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              editStyles.submitBtn,
              (loading || !name.trim() || !email.trim()) && editStyles.submitBtnDisabled,
              pressed && { opacity: 0.85 },
            ]}
            onPress={handleSave}
            disabled={loading || !name.trim() || !email.trim()}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={editStyles.submitBtnText}>
                {isCreate ? 'Crear Tienda' : 'Actualizar Tienda'}
              </Text>
            )}
          </Pressable>
        </View>
      }
    >
      <ScrollView style={editStyles.scroll} showsVerticalScrollIndicator={false}>
        <View style={editStyles.body}>
          {/* Sección "Información de la Tienda" — espejo del
              `<h3 class="text-lg font-medium text-text-primary mb-4">Información de la Tienda</h3>` web */}
          <View>
            <Text style={editStyles.sectionTitle}>Información de la Tienda</Text>
            <View style={editStyles.grid}>
              <View style={editStyles.gridItem}>
                <Text style={editStyles.fieldLabel}>Nombre de la Tienda *</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Mi Tienda"
                  placeholderTextColor={colorScales.gray[400]}
                  editable={!loading}
                  style={editStyles.input}
                />
              </View>

              <View style={editStyles.gridItem}>
                <Text style={editStyles.fieldLabel}>Tipo de Tienda</Text>
                <Pressable
                  style={({ pressed }) => [editStyles.selectTrigger, pressed && { opacity: 0.85 }]}
                  onPress={() => setPickerOpen('type')}
                  disabled={loading}
                >
                  <Text style={editStyles.selectTriggerText}>
                    {STORE_TYPE_OPTIONS.find((t) => t.value === storeType)?.label || storeType}
                  </Text>
                  <Icon name="chevron-down" size={16} color={colorScales.gray[400]} />
                </Pressable>
              </View>

              <View style={editStyles.gridItem}>
                <Text style={editStyles.fieldLabel}>Email *</Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="contacto@tienda.com"
                  placeholderTextColor={colorScales.gray[400]}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  editable={!loading}
                  style={editStyles.input}
                />
              </View>

              <View style={editStyles.gridItem}>
                <Text style={editStyles.fieldLabel}>Teléfono</Text>
                <TextInput
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="+57 (1) 000-0000"
                  placeholderTextColor={colorScales.gray[400]}
                  keyboardType="phone-pad"
                  editable={!loading}
                  style={editStyles.input}
                />
              </View>

              <View style={editStyles.gridItem}>
                <Text style={editStyles.fieldLabel}>Estado</Text>
                <Pressable
                  style={({ pressed }) => [editStyles.selectTrigger, pressed && { opacity: 0.85 }]}
                  onPress={() => setPickerOpen('status')}
                  disabled={loading}
                >
                  <Text style={editStyles.selectTriggerText}>
                    {isActive ? 'Activa' : 'Inactiva'}
                  </Text>
                  <Icon name="chevron-down" size={16} color={colorScales.gray[400]} />
                </Pressable>
              </View>

              {/* Slug read-only (espejo del web: el slug es identifier interno).
                  En create mode se auto-genera desde el nombre. */}
              <View style={editStyles.gridItem}>
                <Text style={editStyles.fieldLabel}>Slug</Text>
                <TextInput
                  value={isCreate ? generateSlug(name) : store?.slug || ''}
                  editable={false}
                  style={[editStyles.input, editStyles.inputDisabled]}
                />
                <Text style={editStyles.fieldHint}>
                  {isCreate
                    ? 'Se genera automáticamente desde el nombre.'
                    : 'El slug no es editable (identificador interno).'}
                </Text>
              </View>

              {/* Descripción full-width (espejo del `md:col-span-2` web) */}
              <View style={[editStyles.gridItem, editStyles.gridItemFull]}>
                <Text style={editStyles.fieldLabel}>Descripción</Text>
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Breve descripción de tu tienda"
                  placeholderTextColor={colorScales.gray[400]}
                  multiline
                  numberOfLines={3}
                  editable={!loading}
                  style={[editStyles.input, editStyles.textarea]}
                />
              </View>
            </View>
          </View>

          {/* ─── Store Info card (espejo del bg-gray-50 web) ────────────── */}
          {store ? (
            <View style={editStyles.infoCard}>
              <Text style={editStyles.infoCardTitle}>Información de la Tienda</Text>
              <View style={editStyles.infoGrid}>
                <View style={editStyles.infoItem}>
                  <Text style={editStyles.infoLabel}>ID</Text>
                  <Text style={editStyles.infoValue}>{store.id}</Text>
                </View>
                <View style={editStyles.infoItem}>
                  <Text style={editStyles.infoLabel}>Organización</Text>
                  <Text style={editStyles.infoValue}>
                    {(store as any).organizations?.name || 'N/A'}
                  </Text>
                </View>
                <View style={editStyles.infoItem}>
                  <Text style={editStyles.infoLabel}>Slug</Text>
                  <Text style={editStyles.infoValue}>/{store.slug}</Text>
                </View>
                <View style={editStyles.infoItem}>
                  <Text style={editStyles.infoLabel}>Usuarios</Text>
                  <Text style={editStyles.infoValue}>
                    {(store as any)._count?.store_users ?? 0}
                  </Text>
                </View>
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* Option pickers */}
      <RNModal visible={pickerOpen === 'type'} transparent animationType="fade" onRequestClose={() => setPickerOpen(null)} statusBarTranslucent>
        <Pressable style={editPickerStyles.backdrop} onPress={() => setPickerOpen(null)}>
          <Pressable style={editPickerStyles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={editPickerStyles.handle} />
            <Text style={editPickerStyles.title}>Seleccionar Tipo</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {STORE_TYPE_OPTIONS.map((opt) => {
                const typeActive = storeType === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    style={({ pressed }) => [
                      editPickerStyles.row,
                      typeActive && editPickerStyles.rowActive,
                      pressed && { opacity: 0.75 },
                    ]}
                    onPress={() => { setStoreType(opt.value); setPickerOpen(null); }}
                  >
                    <Text style={[editPickerStyles.rowLabel, typeActive && editPickerStyles.rowLabelActive]}>
                      {opt.label}
                    </Text>
                    {typeActive && <Icon name="check" size={16} color={colors.primary} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </RNModal>

      <RNModal visible={pickerOpen === 'status'} transparent animationType="fade" onRequestClose={() => setPickerOpen(null)} statusBarTranslucent>
        <Pressable style={editPickerStyles.backdrop} onPress={() => setPickerOpen(null)}>
          <Pressable style={editPickerStyles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={editPickerStyles.handle} />
            <Text style={editPickerStyles.title}>Seleccionar Estado</Text>
            <ScrollView style={{ maxHeight: 200 }}>
              {[
                { value: 'true', label: 'Activa' },
                { value: 'false', label: 'Inactiva' },
              ].map((opt) => {
                const activeOpt = String(isActive) === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    style={({ pressed }) => [
                      editPickerStyles.row,
                      activeOpt && editPickerStyles.rowActive,
                      pressed && { opacity: 0.75 },
                    ]}
                    onPress={() => { setIsActive(opt.value === 'true'); setPickerOpen(null); }}
                  >
                    <Text style={[editPickerStyles.rowLabel, activeOpt && editPickerStyles.rowLabelActive]}>
                      {opt.label}
                    </Text>
                    {activeOpt && <Icon name="check" size={16} color={colors.primary} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </RNModal>
    </OrgCenteredModal>
  );
}

// ─── Store Settings Modal (reemplaza /stores/[id]/settings) ──────────────────
// Mirror del antiguo `settings.tsx` route pero como modal centrado. Permite
// editar timezone + currency (General) y low stock threshold (Inventario) sin
// salir de la lista. Mismo patrón visual que `<StoreEditModal>`.
const TIMEZONE_OPTIONS = [
  { value: 'America/Bogota', label: 'Bogotá (UTC-5)' },
  { value: 'America/Medellin', label: 'Medellín (UTC-5)' },
  { value: 'America/Cali', label: 'Cali (UTC-5)' },
  { value: 'America/New_York', label: 'Nueva York (UTC-5)' },
  { value: 'America/Mexico_City', label: 'Ciudad de México (UTC-6)' },
  { value: 'Europe/Madrid', label: 'Madrid (UTC+1)' },
];

function StoreSettingsModal({
  visible,
  onClose,
  store,
  settings,
  onSubmit,
  loading,
}: {
  visible: boolean;
  onClose: () => void;
  store: StoreListItem | null;
  settings: any;
  onSubmit: (data: {
    timezone: string;
    currency: string;
    low_stock_threshold: number;
  }) => void;
  loading: boolean;
}) {
  const [timezone, setTimezone] = useState('America/Bogota');
  const [currency, setCurrency] = useState('COP');
  const [lowStockThreshold, setLowStockThreshold] = useState('10');
  const [tzPickerOpen, setTzPickerOpen] = useState(false);

  useMemo(() => {
    if (settings) {
      setTimezone(settings.timezone || 'America/Bogota');
      setCurrency(settings.currency || 'COP');
      setLowStockThreshold(String(settings.low_stock_threshold ?? 10));
    } else {
      setTimezone('America/Bogota');
      setCurrency('COP');
      setLowStockThreshold('10');
    }
  }, [settings, visible]);

  const handleSave = () => {
    onSubmit({
      timezone,
      currency: currency.trim().toUpperCase() || 'COP',
      low_stock_threshold: Number(lowStockThreshold) || 10,
    });
  };

  const currentTzLabel =
    TIMEZONE_OPTIONS.find((t) => t.value === timezone)?.label || timezone;

  return (
    <OrgCenteredModal
      visible={visible}
      onClose={onClose}
      title="Configuración de Tienda"
      subtitle={
        store ? `Ajustes operativos de "${store.name}"` : 'Ajustes operativos de la tienda'
      }
      size="lg"
      footer={
        <View style={editStyles.footer}>
          <Pressable
            style={({ pressed }) => [editStyles.cancelBtn, pressed && { opacity: 0.75 }]}
            onPress={onClose}
            disabled={loading}
          >
            <Text style={editStyles.cancelBtnText}>Cancelar</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              editStyles.submitBtn,
              loading && editStyles.submitBtnDisabled,
              pressed && { opacity: 0.85 },
            ]}
            onPress={handleSave}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={editStyles.submitBtnText}>Guardar Configuración</Text>
            )}
          </Pressable>
        </View>
      }
    >
      <ScrollView style={editStyles.scroll} showsVerticalScrollIndicator={false}>
        <View style={editStyles.body}>
          {/* ─── Sección General ─────────────────────────────────────── */}
          <View>
            <Text style={editStyles.sectionTitle}>General</Text>
            <View style={editStyles.grid}>
              <View style={[editStyles.gridItem, editStyles.gridItemFull]}>
                <Text style={editStyles.fieldLabel}>Zona Horaria</Text>
                <Pressable
                  style={({ pressed }) => [editStyles.selectTrigger, pressed && { opacity: 0.85 }]}
                  onPress={() => setTzPickerOpen(true)}
                  disabled={loading}
                >
                  <Text style={editStyles.selectTriggerText}>{currentTzLabel}</Text>
                  <Icon name="chevron-down" size={16} color={colorScales.gray[400]} />
                </Pressable>
              </View>

              <View style={editStyles.gridItem}>
                <Text style={editStyles.fieldLabel}>Moneda</Text>
                <TextInput
                  value={currency}
                  onChangeText={setCurrency}
                  placeholder="COP"
                  placeholderTextColor={colorScales.gray[400]}
                  autoCapitalize="characters"
                  editable={!loading}
                  style={editStyles.input}
                />
                <Text style={editStyles.fieldHint}>
                  Código de moneda (ej. COP, USD, EUR)
                </Text>
              </View>
            </View>
          </View>

          {/* ─── Sección Inventario ──────────────────────────────────── */}
          <View>
            <Text style={editStyles.sectionTitle}>Inventario</Text>
            <View style={editStyles.grid}>
              <View style={editStyles.gridItem}>
                <Text style={editStyles.fieldLabel}>Umbral de Stock Bajo</Text>
                <TextInput
                  value={lowStockThreshold}
                  onChangeText={setLowStockThreshold}
                  placeholder="10"
                  placeholderTextColor={colorScales.gray[400]}
                  keyboardType="number-pad"
                  editable={!loading}
                  style={editStyles.input}
                />
                <Text style={editStyles.fieldHint}>
                  Notificar cuando el stock baje de esta cantidad
                </Text>
              </View>
            </View>
          </View>

          {/* ─── Info card (espejo del bg-gray-50 web) ───────────────── */}
          {store ? (
            <View style={editStyles.infoCard}>
              <Text style={editStyles.infoCardTitle}>Información de la Tienda</Text>
              <View style={editStyles.infoGrid}>
                <View style={editStyles.infoItem}>
                  <Text style={editStyles.infoLabel}>ID</Text>
                  <Text style={editStyles.infoValue}>{store.id}</Text>
                </View>
                <View style={editStyles.infoItem}>
                  <Text style={editStyles.infoLabel}>Nombre</Text>
                  <Text style={editStyles.infoValue}>{store.name}</Text>
                </View>
                <View style={editStyles.infoItem}>
                  <Text style={editStyles.infoLabel}>Slug</Text>
                  <Text style={editStyles.infoValue}>/{store.slug}</Text>
                </View>
                <View style={editStyles.infoItem}>
                  <Text style={editStyles.infoLabel}>Tipo</Text>
                  <Text style={editStyles.infoValue}>
                    {STORE_TYPE_OPTIONS.find((t) => t.value === (store.store_type as string))?.label ||
                      store.store_type}
                  </Text>
                </View>
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* Timezone picker */}
      <RNModal
        visible={tzPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setTzPickerOpen(false)}
        statusBarTranslucent
      >
        <Pressable style={editPickerStyles.backdrop} onPress={() => setTzPickerOpen(false)}>
          <Pressable style={editPickerStyles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={editPickerStyles.handle} />
            <Text style={editPickerStyles.title}>Seleccionar Zona Horaria</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {TIMEZONE_OPTIONS.map((opt) => {
                const tzActive = timezone === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    style={({ pressed }) => [
                      editPickerStyles.row,
                      tzActive && editPickerStyles.rowActive,
                      pressed && { opacity: 0.75 },
                    ]}
                    onPress={() => { setTimezone(opt.value); setTzPickerOpen(false); }}
                  >
                    <Text style={[editPickerStyles.rowLabel, tzActive && editPickerStyles.rowLabelActive]}>
                      {opt.label}
                    </Text>
                    {tzActive && <Icon name="check" size={16} color={colors.primary} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </RNModal>
    </OrgCenteredModal>
  );
}

// ─── Web-style store card (mirrors item-list.component web) ──────────────────
function StoreCard({
  store,
  onTap,
  onEdit,
  onSettings,
  onDelete,
}: {
  store: StoreListItem;
  onTap: () => void;
  onEdit: () => void;
  onSettings: () => void;
  onDelete: () => void;
}) {
  const isActive = store.is_active;

  const primaryAddress =
    (store as any).addresses?.find((a: any) => a.is_primary) ||
    (store as any).addresses?.[0];
  const addressText = primaryAddress
    ? `${primaryAddress.city || ''}, ${
        primaryAddress.state_province || primaryAddress.state || ''
      }`.replace(/^,\s*/, '').replace(/,\s*$/, '') || null
    : null;

  const typeColor = storeTypeColor[store.store_type] || colorScales.gray[400];
  const typeLabel = storeTypeLabel[store.store_type] || store.store_type;
  const userCount = (store as any)._count?.store_users ?? 0;

  return (
    <Pressable
      style={({ pressed }) => [
        cardStyles.card,
        pressed && cardStyles.cardPressed,
      ]}
      onPress={onTap}
    >
      {/* ── Card Body ── */}
      <View style={cardStyles.body}>
        {/* Avatar */}
        <View style={[cardStyles.avatar, { backgroundColor: isActive ? '#dcfce7' : colorScales.gray[100] }]}>
          <Icon
            name="store"
            size={20}
            color={isActive ? '#047857' : colorScales.gray[400]}
          />
        </View>

        {/* Main content */}
        <View style={cardStyles.mainContent}>
          {/* Title row */}
          <View style={cardStyles.titleRow}>
            <View style={cardStyles.titleGroup}>
              <Text style={cardStyles.title} numberOfLines={1}>
                {store.name}
              </Text>
              {addressText ? (
                <Text style={cardStyles.subtitle} numberOfLines={1}>
                  {addressText}
                </Text>
              ) : (
                <Text style={cardStyles.subtitle} numberOfLines={1}>
                  /{store.slug}
                </Text>
              )}
            </View>
            {/* Status badge — mirrors web .status-badge-compact */}
            <View
              style={[
                cardStyles.statusBadge,
                isActive ? cardStyles.statusActive : cardStyles.statusInactive,
              ]}
            >
              <Text
                style={[
                  cardStyles.statusText,
                  isActive ? cardStyles.statusTextActive : cardStyles.statusTextInactive,
                ]}
              >
                {isActive ? 'Activa' : 'Inactiva'}
              </Text>
            </View>
          </View>

          {/* Detail grid — 3 columns: Slug | Tipo | Usuarios  */}
          <View style={cardStyles.detailGrid}>
            {/* Slug */}
            <View style={cardStyles.detailItem}>
              <Text style={cardStyles.detailLabel}>SLUG</Text>
              <Text style={cardStyles.detailValue} numberOfLines={1}>
                {store.slug}
              </Text>
            </View>
            {/* Tipo */}
            <View style={cardStyles.detailItem}>
              <Text style={cardStyles.detailLabel}>TIPO</Text>
              <Text style={[cardStyles.detailValue, { color: typeColor }]} numberOfLines={1}>
                {typeLabel}
              </Text>
            </View>
            {/* Usuarios */}
            <View style={cardStyles.detailItem}>
              <View style={cardStyles.detailLabelRow}>
                <Icon name="users" size={10} color={colorScales.gray[400]} />
                <Text style={cardStyles.detailLabel}>USUARIOS</Text>
              </View>
              <Text style={cardStyles.detailValue} numberOfLines={1}>
                {userCount}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* ── Card Footer ── */}
      <View style={cardStyles.footer}>
        <View style={cardStyles.footerSpacer} />
        <View style={cardStyles.footerActions}>
          {/* Edit — info/blue variant */}
          <Pressable
            style={({ pressed }) => [cardStyles.actionBtn, cardStyles.actionInfo, pressed && { opacity: 0.75 }]}
            onPress={onEdit}
            hitSlop={4}
          >
            <Icon name="edit" size={16} color="#3b82f6" />
          </Pressable>
          {/* Settings — secondary variant */}
          <Pressable
            style={({ pressed }) => [cardStyles.actionBtn, cardStyles.actionSecondary, pressed && { opacity: 0.75 }]}
            onPress={onSettings}
            hitSlop={4}
          >
            <Icon name="settings" size={16} color={colorScales.gray[700]} />
          </Pressable>
          {/* Delete — danger variant */}
          <Pressable
            style={({ pressed }) => [cardStyles.actionBtn, cardStyles.actionDanger, pressed && { opacity: 0.75 }]}
            onPress={onDelete}
            hitSlop={4}
          >
            <Icon name="trash-2" size={16} color="#ef4444" />
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

// Skeleton card for loading state
function SkeletonCard() {
  return (
    <View style={skeletonStyles.card}>
      <View style={skeletonStyles.body}>
        <View style={skeletonStyles.avatar} />
        <View style={skeletonStyles.titleGroup}>
          <View style={skeletonStyles.title} />
          <View style={skeletonStyles.subtitle} />
        </View>
        <View style={skeletonStyles.badge} />
      </View>
      <View style={skeletonStyles.grid}>
        <View style={skeletonStyles.detail} />
        <View style={skeletonStyles.detail} />
        <View style={skeletonStyles.detail} />
      </View>
      <View style={skeletonStyles.footer} />
    </View>
  );
}

const skeletonStyles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    padding: 12,
    gap: 12,
  },
  body: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colorScales.gray[100] },
  titleGroup: { flex: 1, gap: 6 },
  title: { height: 14, backgroundColor: colorScales.gray[100], borderRadius: 4, width: '60%' },
  subtitle: { height: 11, backgroundColor: colorScales.gray[100], borderRadius: 4, width: '40%' },
  badge: { width: 56, height: 22, backgroundColor: colorScales.gray[100], borderRadius: 99 },
  grid: { flexDirection: 'row', gap: 8 },
  detail: { flex: 1, height: 32, backgroundColor: colorScales.gray[100], borderRadius: 4 },
  footer: { height: 36, backgroundColor: colorScales.gray[50], borderRadius: 4 },
});

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    // Web: transition: all var(--transition-fast) ease; hover: border-primary, shadow-md, translateY(-1px)
    // Mobile equivalent: subtle shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  cardPressed: {
    borderColor: colors.primary,
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },

  // ── Body ──
  body: {
    flexDirection: 'row',
    padding: 12,
    gap: 12,
    alignItems: 'flex-start',
  },
  // Avatar — 44x44 circle, matches web .card-avatar
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  // Main content
  mainContent: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  // Title row
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  titleGroup: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
  },
  // card-title: font-size: var(--fs-base); font-weight: var(--fw-medium)
  title: {
    fontSize: 14,
    fontFamily: interFonts.semibold,
    color: colorScales.gray[900],
    lineHeight: 18,
  },
  // card-subtitle: font-size: var(--fs-sm); color: text-secondary
  subtitle: {
    fontSize: 11,
    color: '#64748b', // Slate-500
    marginTop: 2,
    fontFamily: interFonts.regular,
  },
  // Status badge — mirrors web .status-badge-compact
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 99,
    borderWidth: 1,
    marginLeft: 8,
    flexShrink: 0,
  },
  statusActive: {
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
    borderColor: 'rgba(34, 197, 94, 0.25)',
  },
  statusInactive: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderColor: 'rgba(245, 158, 11, 0.25)',
  },
  statusText: {
    fontSize: 10,
    fontFamily: interFonts.medium,
  },
  statusTextActive: { color: '#047857' },
  statusTextInactive: { color: '#92400e' },

  // Detail grid — 3 columns, mirrors web .card-details-grid
  detailGrid: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  detailItem: {
    flex: 1,
    flexDirection: 'column',
    gap: 2,
  },
  // .detail-label: 10px, bold, muted, uppercase, letter-spacing
  detailLabel: {
    fontSize: 9,
    fontFamily: interFonts.bold,
    color: '#94a3b8', // Slate-400
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  // .detail-value: font-size: var(--fs-sm); font-weight: bold; monospace
  detailValue: {
    fontSize: 13,
    fontFamily: interFonts.bold,
    color: colorScales.gray[900],
  },

  // ── Footer ── mirrors .card-footer
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 10,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
    marginTop: 0,
  },
  footerSpacer: { flex: 1 },
  footerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  // .footer-action-btn: 30x30, border-radius md
  actionBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  // action-info (edit)
  actionInfo: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
  },
  // action-secondary (settings)
  actionSecondary: {
    backgroundColor: colorScales.gray[100],
  },
  // action-danger (delete)
  actionDanger: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
});

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function StoresList() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  // ── Filters ──────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterState, setFilterState] = useState('');

  const [searchTimer, setSearchTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimer) clearTimeout(searchTimer);
    const t = setTimeout(() => setDebouncedSearch(value), 1000);
    setSearchTimer(t);
  };

  const hasFilters = !!(search || filterType || filterState);

  const queryParams = useMemo(() => {
    const params: Record<string, unknown> = { limit: 100 };
    if (debouncedSearch) params.search = debouncedSearch;
    if (filterType) params.store_type = filterType;
    if (filterState === 'active') params.is_active = true;
    if (filterState === 'inactive') params.is_active = false;
    return params;
  }, [debouncedSearch, filterType, filterState]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-stores-list', queryParams],
    queryFn: () => OrgStoreService.list(queryParams as any),
  });

  const { data: statsRaw } = useQuery({
    queryKey: ['org-stores-stats'],
    queryFn: () => OrgStoreService.stats(),
  });
  const statsData: any = (statsRaw as any)?.data || (statsRaw as any) || {};

  const stores: StoreListItem[] = data?.data ?? [];

  // ── Refresh ──────────────────────────────────────────────────────────────
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      refetch(),
      queryClient.invalidateQueries({ queryKey: ['org-stores-stats'] }),
    ]);
    setRefreshing(false);
  };

  // ── Switch environment dialog ────────────────────────────────────────────
  const [storeToSwitch, setStoreToSwitch] = useState<StoreListItem | null>(null);
  const [switching, setSwitching] = useState(false);

  const handleConfirmSwitch = async () => {
    if (!storeToSwitch) return;
    setSwitching(true);
    try {
      await performStoreSwitch({
        kind: 'STORE_ADMIN',
        storeSlug: storeToSwitch.slug,
        storeName: storeToSwitch.name,
      });
      setStoreToSwitch(null);
    } catch {
      // toastError ya emitido por performStoreSwitch
    } finally {
      setSwitching(false);
    }
  };

  // ── Options-dropdown twin modals (espejo del `<app-options-dropdown>` web) ──
  const [actionsModalOpen, setActionsModalOpen] = useState(false);
  const [filtersModalOpen, setFiltersModalOpen] = useState(false);

  // ── Delete ──────────────────────────────────────────────────────────────
  const [storeToDelete, setStoreToDelete] = useState<StoreListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const handleConfirmDelete = async () => {
    if (!storeToDelete) return;
    setDeleting(true);
    try {
      await OrgStoreService.remove(storeToDelete.id);
      queryClient.invalidateQueries({ queryKey: ['org-stores-list'] });
      queryClient.invalidateQueries({ queryKey: ['org-stores-stats'] });
      toastSuccess(`Tienda "${storeToDelete.name}" eliminada`);
      setStoreToDelete(null);
    } catch (error: any) {
      toastError(error?.response?.data?.message || error?.message || 'Error al eliminar la tienda');
    } finally {
      setDeleting(false);
    }
  };

  // ── Activate / deactivate ──────────────────────────────────────────────
  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      OrgStoreService.update(id, { is_active } as any),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['org-stores-list'] });
      queryClient.invalidateQueries({ queryKey: ['org-stores-stats'] });
      toastSuccess(
        vars.is_active ? 'Tienda activada exitosamente' : 'Tienda desactivada exitosamente',
      );
    },
    onError: (error: any, vars) => {
      toastError(
        error?.response?.data?.message ||
          error?.message ||
          `Error al ${vars.is_active ? 'activar' : 'desactivar'} la tienda`,
      );
    },
  });

  // ── Edit store modal (espejo web `app-store-edit-modal`) ─────────────
  const [editingStore, setEditingStore] = useState<StoreListItem | null>(null);
  const [creatingStore, setCreatingStore] = useState(false);

  const updateStoreMutation = useMutation({
    mutationFn: (vars: {
      id: string;
      data: {
        name: string;
        email: string;
        phone?: string;
        description?: string;
        is_active: boolean;
        store_type: string;
      };
    }) => OrgStoreService.update(vars.id, vars.data as any),
    onSuccess: () => {
      toastSuccess('Tienda actualizada exitosamente.');
      queryClient.invalidateQueries({ queryKey: ['org-stores-list'] });
      queryClient.invalidateQueries({ queryKey: ['org-stores-stats'] });
      setEditingStore(null);
    },
    onError: (error: any) => {
      toastError(error?.response?.data?.message || error?.message || 'Error al actualizar la tienda');
    },
  });

  const createStoreMutation = useMutation({
    mutationFn: (data: {
      name: string;
      email: string;
      phone?: string;
      description?: string;
      is_active: boolean;
      store_type: string;
    }) => OrgStoreService.create({
      name: data.name,
      slug: generateSlug(data.name),
      store_code: generateSlug(data.name).toUpperCase().replace(/-/g, '_'),
      store_type: data.store_type as any,
      email: data.email,
      phone: data.phone,
    } as any),
    onSuccess: () => {
      toastSuccess('Tienda creada exitosamente.');
      queryClient.invalidateQueries({ queryKey: ['org-stores-list'] });
      queryClient.invalidateQueries({ queryKey: ['org-stores-stats'] });
      setCreatingStore(false);
    },
    onError: (error: any) => {
      toastError(error?.response?.data?.message || error?.message || 'Error al crear la tienda');
    },
  });

  // ── Settings store modal (reemplaza navegación a /stores/[id]/settings) ──
  const [settingsStore, setSettingsStore] = useState<StoreListItem | null>(null);

  const { data: settingsData, isLoading: loadingSettings } = useQuery({
    queryKey: ['org-store-settings', settingsStore?.id],
    queryFn: () => OrgStoreService.getSettings(settingsStore!.id),
    enabled: !!settingsStore,
  });

  const updateSettingsMutation = useMutation({
    mutationFn: (vars: { id: string | number; data: { timezone: string; currency: string; low_stock_threshold: number } }) =>
      OrgStoreService.updateSettings(vars.id, { settings: vars.data }),
    onSuccess: () => {
      toastSuccess('Configuración guardada exitosamente.');
      queryClient.invalidateQueries({ queryKey: ['org-store-settings', settingsStore?.id] });
      setSettingsStore(null);
    },
    onError: (error: any) => {
      toastError(error?.response?.data?.message || error?.message || 'Error al guardar la configuración');
    },
  });

  // ── Stats ────────────────────────────────────────────────────────────────
  const totalStores = statsData.total_stores ?? stores.length;
  const activeStores = statsData.active_stores ?? stores.filter((s) => s.is_active).length;
  const totalOrders = statsData.total_orders ?? 0;
  const totalRevenue = statsData.total_revenue ?? 0;

  const statCards = [
    {
      label: 'Total Tiendas',
      value: totalStores,
      description: 'Registradas',
      icon: 'building',
      iconBg: '#dbeafe',
      iconColor: colorScales.blue[600],
    },
    {
      label: 'Activas',
      value: activeStores,
      description: 'En funcionamiento',
      icon: 'check-circle',
      iconBg: '#dcfce7',
      iconColor: colorScales.green[600],
    },
    {
      label: 'Total Pedidos',
      value: formatCompactNumber(totalOrders),
      description: 'Procesados',
      icon: 'shopping-cart',
      iconBg: '#fce7f3',
      iconColor: '#ec4899',
    },
    {
      label: 'Total Ganancias',
      value: formatCurrency(totalRevenue),
      description: 'Ingresos totales',
      icon: 'dollar-sign',
      iconBg: '#dbeafe',
      iconColor: colorScales.blue[600],
    },
  ];

  const handleClearFilters = () => {
    setSearch('');
    setDebouncedSearch('');
    setFilterType('');
    setFilterState('');
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
    >
      {/* ── Stats grid (espejo del `<app-stats>` web) ──────────────────────── */}
      <View style={styles.statsWrap}>
        <StatsGrid items={statCards} />
      </View>

      {/* ── Table card header: title + search + options-dropdown ──────────── */}
      <View style={styles.tableCard}>
        <View style={styles.tableHeader}>
          <View style={styles.tableTitleRow}>
            <Text style={styles.tableTitle}>
              Todas las tiendas ({stores.length})
            </Text>
          </View>

          {/* Search bar + 2 icon-only triggers (espejo del `<app-options-dropdown>`
              web mobile responsive: ambos icon-only 40x40, primary border, primary icon). */}
          <View style={styles.searchRow}>
            <View style={{ flex: 1 }}>
              <SearchBar
                value={search}
                onChangeText={handleSearchChange}
                placeholder="Buscar tiendas..."
                style={styles.searchInput}
                onClear={() => {
                  setSearch('');
                  setDebouncedSearch('');
                }}
              />
            </View>
            {/* Actions trigger (+ button) — abre modal con Nueva Tienda/Actualizar */}
            <Pressable
              style={styles.optionsTrigger}
              onPress={() => setActionsModalOpen(true)}
              accessibilityLabel="Abrir acciones"
            >
              <Icon name="plus" size={18} color={colors.primary} />
            </Pressable>
            {/* Filters trigger — abre modal con Tipo/Estado */}
            <Pressable
              style={styles.optionsTrigger}
              onPress={() => setFiltersModalOpen(true)}
              accessibilityLabel="Abrir filtros"
            >
              <Icon name="filter" size={16} color={colors.primary} />
              {hasFilters ? (
                <View style={styles.optionsTriggerBadge}>
                  <Text style={styles.optionsTriggerBadgeText}>
                    {(filterType ? 1 : 0) + (filterState ? 1 : 0)}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          </View>
        </View>

        {/* ── Card list ────────────────────────────────────────────────────── */}
        <View style={styles.cardList}>
          {/* Loading skeletons */}
          {isLoading && (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          )}

          {/* Empty — no stores */}
          {!isLoading && stores.length === 0 && !hasFilters && (
            <EmptyState
              icon="store"
              title="No hay tiendas"
              description="Crea tu primera tienda para empezar."
              actionLabel="Crear Tienda"
              onAction={() => setCreatingStore(true)}
            />
          )}

          {/* Empty — filters */}
          {!isLoading && stores.length === 0 && hasFilters && (
            <EmptyState
              icon="search"
              title="Sin resultados"
              description="No se encontraron tiendas con los filtros aplicados."
              actionLabel="Limpiar filtros"
              onAction={handleClearFilters}
              secondaryActionLabel="Crear Tienda"
              onSecondaryAction={() => setCreatingStore(true)}
            />
          )}

          {/* Store cards */}
          {!isLoading && stores.length > 0 &&
            stores.map((s) => (
              <StoreCard
                key={s.id}
                store={s}
                onTap={() => setStoreToSwitch(s)}
                onEdit={() => setEditingStore(s)}
                onSettings={() => setSettingsStore(s)}
                onDelete={() => setStoreToDelete(s)}
              />
            ))}
        </View>
      </View>

      {/* ── Confirm dialogs ─────────────────────────────────────────────────── */}
      <ConfirmDialog
        visible={storeToSwitch !== null}
        onClose={() => setStoreToSwitch(null)}
        onConfirm={handleConfirmSwitch}
        title="Cambiar entorno"
        message={
          storeToSwitch
            ? `¿Deseas ingresar al panel de administración de la tienda "${storeToSwitch.name}"?\n\nSerás redirigido al dashboard de STORE_ADMIN.`
            : ''
        }
        confirmLabel="Cambiar de entorno"
        cancelLabel="Cancelar"
        loading={switching}
      />

      <ConfirmDialog
        visible={storeToDelete !== null}
        onClose={() => setStoreToDelete(null)}
        onConfirm={handleConfirmDelete}
        title="Eliminar tienda"
        message={
          storeToDelete
            ? `¿Estás seguro de eliminar la tienda "${storeToDelete.name}"?\n\nEsta acción no se puede deshacer.`
            : ''
        }
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        destructive
        loading={deleting}
      />

      {/* Filters Modal — espejo del `<app-options-dropdown>` web mobile:
          un solo modal con Tipo + Estado, Aplicar/Limpiar. */}
      <OrgCenteredModal
        visible={filtersModalOpen}
        onClose={() => setFiltersModalOpen(false)}
        title="Filtros"
        subtitle={
          filterType || filterState
            ? `${(filterType ? 1 : 0) + (filterState ? 1 : 0)} filtro(s) activo(s)`
            : 'Mostrando todas las tiendas'
        }
        size="sm"
        footer={
          <View style={styles.filtersModalFooter}>
            <Pressable
              style={styles.filtersModalClearBtn}
              onPress={() => {
                setFilterType('');
                setFilterState('');
              }}
            >
              <Icon name="rotate-ccw" size={14} color={colorScales.gray[600]} />
              <Text style={styles.filtersModalClearText}>Limpiar</Text>
            </Pressable>
            <Pressable
              style={styles.filtersModalApplyBtn}
              onPress={() => setFiltersModalOpen(false)}
            >
              <Icon name="check" size={16} color="#FFFFFF" />
              <Text style={styles.filtersModalApplyText}>Aplicar</Text>
            </Pressable>
          </View>
        }
      >
        {/* Tipo — espejo de `<app-selector>` web */}
        <View style={styles.filtersModalSection}>
          <Text style={styles.filtersModalLabel}>Tipo</Text>
          <View style={styles.filtersModalOptions}>
            {FILTER_TYPE_OPTIONS.map((opt) => {
              const isActive = filterType === opt.value;
              return (
                <Pressable
                  key={opt.value || 'all-type'}
                  style={[styles.filtersModalOption, isActive && styles.filtersModalOptionActive]}
                  onPress={() => setFilterType(opt.value)}
                >
                  <Text style={[styles.filtersModalOptionText, isActive && styles.filtersModalOptionTextActive]}>
                    {opt.label}
                  </Text>
                  {isActive ? <Icon name="check" size={14} color={colors.primary} /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Estado — espejo de `<app-selector>` web */}
        <View style={styles.filtersModalSection}>
          <Text style={styles.filtersModalLabel}>Estado</Text>
          <View style={styles.filtersModalOptions}>
            {FILTER_STATE_OPTIONS.map((opt) => {
              const isActive = filterState === opt.value;
              return (
                <Pressable
                  key={opt.value || 'all-state'}
                  style={[styles.filtersModalOption, isActive && styles.filtersModalOptionActive]}
                  onPress={() => setFilterState(opt.value)}
                >
                  <Text style={[styles.filtersModalOptionText, isActive && styles.filtersModalOptionTextActive]}>
                    {opt.label}
                  </Text>
                  {isActive ? <Icon name="check" size={14} color={colors.primary} /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      </OrgCenteredModal>

      {/* Actions Modal — espejo del `<app-options-dropdown>` web con la lista
          de acciones globales (Nueva Tienda + Actualizar). */}
      <OrgCenteredModal
        visible={actionsModalOpen}
        onClose={() => setActionsModalOpen(false)}
        title="Acciones"
        subtitle="¿Qué quieres hacer con la lista de tiendas?"
        size="sm"
      >
        <View style={styles.actionsModalList}>
          <Pressable
            style={styles.actionsModalOption}
            onPress={() => {
              setActionsModalOpen(false);
              setCreatingStore(true);
            }}
          >
            <View style={[styles.actionsModalIconWrap, { backgroundColor: colors.primary + '15' }]}>
              <Icon name="plus" size={16} color={colors.primary} />
            </View>
            <View style={styles.actionsModalTextWrap}>
              <Text style={styles.actionsModalOptionTitle}>Nueva Tienda</Text>
              <Text style={styles.actionsModalOptionHint}>
                Crear una nueva tienda en la organización
              </Text>
            </View>
          </Pressable>

          <Pressable
            style={styles.actionsModalOption}
            onPress={() => {
              setActionsModalOpen(false);
              onRefresh();
            }}
          >
            <View style={[styles.actionsModalIconWrap, { backgroundColor: colorScales.gray[100] }]}>
              <Icon name="refresh-cw" size={16} color={colorScales.gray[700]} />
            </View>
            <View style={styles.actionsModalTextWrap}>
              <Text style={styles.actionsModalOptionTitle}>Actualizar</Text>
              <Text style={styles.actionsModalOptionHint}>
                Recargar la lista con los últimos cambios
              </Text>
            </View>
          </Pressable>
        </View>
      </OrgCenteredModal>

      {/* Edit Store Modal — espejo web `app-store-edit-modal` (paridad 1:1).
          Al tocar Edit en una tienda se abre este modal centrado (en lugar de
          navegar a `/(org-admin)/stores/edit`). */}
      <StoreEditModal
        visible={!!editingStore}
        mode="edit"
        store={editingStore}
        onClose={() => setEditingStore(null)}
        onSubmit={(data) => {
          if (editingStore) {
            updateStoreMutation.mutate({ id: editingStore.id, data });
          }
        }}
        loading={updateStoreMutation.isPending}
      />

      {/* Create Store Modal — mismo componente en modo `create`.
          Al tocar "Nueva Tienda" en el modal de acciones o en los empty
          states, se abre este modal centrado (en lugar de navegar a
          `/(org-admin)/stores/create`). */}
      <StoreEditModal
        visible={creatingStore}
        mode="create"
        store={null}
        onClose={() => setCreatingStore(false)}
        onSubmit={(data) => {
          createStoreMutation.mutate(data);
        }}
        loading={createStoreMutation.isPending}
      />

      {/* Settings Store Modal — reemplaza la navegación a
          `/(org-admin)/stores/[id]/settings`. Al tocar el botón de
          configuración (icono settings) en una tienda, se abre este modal
          centrado con los ajustes operativos de esa tienda. */}
      <StoreSettingsModal
        visible={!!settingsStore}
        store={settingsStore}
        settings={settingsData}
        onClose={() => setSettingsStore(null)}
        onSubmit={(data) => {
          if (settingsStore) {
            updateSettingsMutation.mutate({ id: settingsStore.id, data });
          }
        }}
        loading={updateSettingsMutation.isPending || loadingSettings}
      />
    </ScrollView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: '#f4f4f4',
  },
  content: {
    padding: spacing[4],
    paddingBottom: spacing[8],
    gap: spacing[4],
  },

  // ── Stats ── (espejo del `statsScroll` de users.tsx)
  statsWrap: { marginHorizontal: -spacing[4] },

  // ── Table card wrapper ──
  tableCard: {
    gap: spacing[3],
  },

  tableHeader: {
    backgroundColor: '#fff',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2],
    marginBottom: spacing[3],
  },
  tableTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[3],
  },
  tableTitle: {
    fontSize: typography.fontSize.lg,
    fontFamily: interFonts.semibold,
    color: colorScales.gray[900],
    flexShrink: 1,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  // Espejo del `.inputsearch-wrapper-modern` web mobile (40px, 12px radius).
  searchInput: {
    width: '100%',
    height: 40,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
  },
  // Espejo del `.options-dropdown-trigger` web mobile responsive
  // (icon-only 40x40, primary border, primary icon, 12px radius).
  optionsTrigger: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  optionsTriggerBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 4,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionsTriggerBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontFamily: interFonts.bold,
  },
  // ── Filters modal styles (espejo del `<app-options-dropdown>` web)
  filtersModalFooter: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  filtersModalClearBtn: {
    flex: 1,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
  },
  filtersModalClearText: {
    fontSize: typography.fontSize.base,
    fontFamily: interFonts.semibold,
    color: colorScales.gray[700],
  },
  filtersModalApplyBtn: {
    flex: 2,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    backgroundColor: colors.primary,
    borderRadius: borderRadius.xl,
  },
  filtersModalApplyText: {
    fontSize: typography.fontSize.base,
    fontFamily: interFonts.bold,
    color: '#FFFFFF',
  },
  filtersModalSection: {
    gap: spacing[2],
    marginBottom: spacing[4],
  },
  filtersModalLabel: {
    fontSize: typography.fontSize.xs,
    fontFamily: interFonts.semibold,
    color: colorScales.gray[600],
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  filtersModalOptions: {
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    backgroundColor: colors.card,
  },
  filtersModalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
    gap: spacing[2],
  },
  filtersModalOptionActive: {
    backgroundColor: colorScales.green[50],
  },
  filtersModalOptionText: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    fontFamily: interFonts.regular,
    color: colorScales.gray[700],
  },
  filtersModalOptionTextActive: {
    color: colors.primary,
    fontFamily: interFonts.semibold,
  },
  // ── Actions modal styles (espejo del `<app-options-dropdown>` web content)
  actionsModalList: {
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    backgroundColor: colors.card,
  },
  actionsModalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  actionsModalIconWrap: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  actionsModalTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  actionsModalOptionTitle: {
    fontSize: typography.fontSize.sm,
    fontFamily: interFonts.semibold,
    color: colorScales.gray[900],
  },
  actionsModalOptionHint: {
    fontSize: typography.fontSize.xs,
    fontFamily: interFonts.regular,
    color: colorScales.gray[500],
    marginTop: 2,
  },

  // ── Card list ──
  cardList: {
    gap: 12,
  },
});

// ─── Store Edit Modal styles ─────────────────────────────────────────────────
const editStyles = StyleSheet.create({
  scroll: {
    maxHeight: 520,
  },
  body: {
    gap: spacing[4],
  },
  sectionTitle: {
    fontSize: typography.fontSize.base,
    fontFamily: interFonts.medium,
    color: colorScales.gray[900],
    marginBottom: spacing[3],
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[4],
  },
  gridItem: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 220,
    gap: spacing[2],
  },
  gridItemFull: {
    flexBasis: '100%',
  },
  fieldLabel: {
    fontSize: typography.fontSize.sm,
    fontFamily: interFonts.medium,
    color: colorScales.gray[700],
  },
  input: {
    height: 44,
    paddingHorizontal: spacing[3],
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.md,
    fontSize: typography.fontSize.sm,
    fontFamily: interFonts.regular,
    color: colorScales.gray[900],
  },
  inputDisabled: {
    backgroundColor: colorScales.gray[50],
    color: colorScales.gray[500],
  },
  textarea: {
    height: 84,
    paddingTop: spacing[2],
    textAlignVertical: 'top',
  },
  fieldHint: {
    fontSize: typography.fontSize.xs,
    fontFamily: interFonts.regular,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  selectTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 44,
    paddingHorizontal: spacing[3],
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.md,
  },
  selectTriggerText: {
    fontSize: typography.fontSize.sm,
    fontFamily: interFonts.regular,
    color: colorScales.gray[900],
  },
  infoCard: {
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.md,
    padding: spacing[4],
    gap: spacing[3],
  },
  infoCardTitle: {
    fontSize: typography.fontSize.sm,
    fontFamily: interFonts.semibold,
    color: colorScales.gray[700],
  },
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
  },
  infoItem: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 180,
    flexDirection: 'row',
    gap: spacing[2],
  },
  infoLabel: {
    fontSize: typography.fontSize.xs,
    fontFamily: interFonts.medium,
    color: colorScales.gray[500],
  },
  infoValue: {
    fontSize: typography.fontSize.xs,
    fontFamily: interFonts.semibold,
    color: colorScales.gray[900],
    flexShrink: 1,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[3],
  },
  cancelBtn: {
    height: 40,
    paddingHorizontal: spacing[4],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    backgroundColor: colors.card,
  },
  cancelBtnText: {
    fontSize: typography.fontSize.sm,
    fontFamily: interFonts.semibold,
    color: colorScales.gray[700],
  },
  submitBtn: {
    height: 40,
    paddingHorizontal: spacing[5],
    minWidth: 140,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary,
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitBtnText: {
    fontSize: typography.fontSize.sm,
    fontFamily: interFonts.semibold,
    color: '#FFFFFF',
  },
});

const editPickerStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
    paddingBottom: spacing[6],
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colorScales.gray[300],
    alignSelf: 'center',
    marginBottom: spacing[3],
  },
  title: {
    fontSize: typography.fontSize.base,
    fontFamily: interFonts.semibold,
    color: colorScales.gray[900],
    marginBottom: spacing[3],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.md,
    marginBottom: 2,
  },
  rowActive: {
    backgroundColor: colorScales.green[50],
  },
  rowLabel: {
    fontSize: typography.fontSize.sm,
    fontFamily: interFonts.regular,
    color: colorScales.gray[700],
  },
  rowLabelActive: {
    color: colors.primary,
    fontFamily: interFonts.semibold,
  },
});

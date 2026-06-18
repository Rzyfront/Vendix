import { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  RefreshControl,
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/core/store/auth.store';
import { AuthService } from '@/core/auth/auth.service';
import { OrgStoreService } from '@/features/org/services/org-store.service';
import { getQueryClient } from '@/core/api/query-client';
import type { StoreListItem } from '@/core/models/org-admin/store.types';

import {
  SearchBar,
  ConfirmDialog,
  toastSuccess,
  toastError,
  EmptyState,
} from '@/shared/components';
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

// ─── Filter dropdown (bottom-sheet-style modal) ───────────────────────────────
interface FilterOption {
  value: string;
  label: string;
}

function FilterPickerModal({
  visible,
  title,
  options,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: FilterOption[];
  selected: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={filterPickerStyles.backdrop} onPress={onClose}>
        <Pressable style={filterPickerStyles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={filterPickerStyles.handle} />
          <Text style={filterPickerStyles.title}>{title}</Text>
          <ScrollView style={{ maxHeight: 360 }}>
            {options.map((opt) => {
              const isActive = selected === opt.value;
              return (
                <Pressable
                  key={opt.value || 'all'}
                  style={({ pressed }) => [
                    filterPickerStyles.row,
                    isActive && filterPickerStyles.rowActive,
                    pressed && { opacity: 0.75 },
                  ]}
                  onPress={() => {
                    onSelect(opt.value);
                    onClose();
                  }}
                >
                  <Text
                    style={[
                      filterPickerStyles.rowLabel,
                      isActive && filterPickerStyles.rowLabelActive,
                    ]}
                  >
                    {opt.label}
                  </Text>
                  {isActive && <Icon name="check" size={16} color={colors.primary} />}
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const filterPickerStyles = StyleSheet.create({
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

// ─── Filter chip (componente local) ──────────────────────────────────────────
function FilterChip({
  label,
  active,
  onPress,
  onClear,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  onClear?: () => void;
}) {
  return (
    <View
      style={[
        filterChipStyles.chip,
        active && filterChipStyles.chipActive,
      ]}
    >
      <Pressable
        style={filterChipStyles.labelArea}
        onPress={onPress}
        hitSlop={4}
      >
        <Text
          style={[
            filterChipStyles.label,
            active && filterChipStyles.labelActive,
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
        <Icon
          name="chevron-down"
          size={12}
          color={active ? colors.primary : colorScales.gray[500]}
        />
      </Pressable>
      {onClear && (
        <Pressable onPress={onClear} hitSlop={4} style={filterChipStyles.clearArea}>
          <Icon name="x" size={12} color={active ? colors.primary : colorScales.gray[500]} />
        </Pressable>
      )}
    </View>
  );
}

const filterChipStyles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingLeft: spacing[3],
    paddingRight: spacing[2],
    paddingVertical: 6,
    maxWidth: 200,
  },
  chipActive: {
    borderColor: colors.primary,
    backgroundColor: colorScales.green[50],
  },
  labelArea: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    flexShrink: 1,
  },
  label: {
    fontSize: typography.fontSize.xs,
    fontFamily: interFonts.regular,
    color: colorScales.gray[700],
    flexShrink: 1,
  },
  labelActive: {
    color: colors.primary,
    fontFamily: interFonts.semibold,
  },
  clearArea: {
    marginLeft: spacing[1],
    padding: 2,
  },
});

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
      await AuthService.switchEnvironment('STORE_ADMIN', storeToSwitch.slug);
      const qc = getQueryClient();
      await qc.cancelQueries();
      qc.clear();
      toastSuccess(`Cambiado a "${storeToSwitch.name}"`);
      setStoreToSwitch(null);
      router.replace('/(store-admin)/dashboard' as never);
    } catch (error: any) {
      toastError(error?.message || 'No se pudo cambiar al entorno de la tienda. Intenta de nuevo.');
    } finally {
      setSwitching(false);
    }
  };

  // ── Filter pickers ──────────────────────────────────────────────────────
  const [pickerOpen, setPickerOpen] = useState<null | 'type' | 'state'>(null);

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
      {/* ── Page header ────────────────────────────────────────────────────── */}
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <Text style={styles.pageTitle}>
            Organizaciones
          </Text>
          <Text style={styles.pageSubtitle}>Gestión de tiendas</Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.addBtn, pressed && styles.addBtnPressed]}
          onPress={() => router.push('/(org-admin)/stores/create' as never)}
        >
          <Icon name="plus" size={16} color="#fff" />
          <Text style={styles.addBtnText}>Nueva tienda</Text>
        </Pressable>
      </View>

      {/* ── Stats row (horizontal scroll like web) ─────────────────────────── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.statsRow}
        style={styles.statsScroll}
      >
        {statCards.map((card) => (
          <View key={card.label} style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: card.iconBg }]}>
              <Icon name={card.icon} size={18} color={card.iconColor} />
            </View>
            <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
              {card.value}
            </Text>
            <Text style={styles.statLabel} numberOfLines={1}>
              {card.label}
            </Text>
            <Text style={styles.statSub} numberOfLines={1}>
              {card.description}
            </Text>
          </View>
        ))}
      </ScrollView>

      {/* ── Table card header: title + search + filters ────────────────────── */}
      <View style={styles.tableCard}>
        <View style={styles.tableHeader}>
          <View style={styles.tableTitleRow}>
            <Text style={styles.tableTitle}>
              Todas las tiendas ({stores.length})
            </Text>
            <Pressable
              onPress={onRefresh}
              hitSlop={8}
              style={({ pressed }) => [styles.refreshBtn, pressed && { opacity: 0.6 }]}
            >
              <Icon name="refresh" size={16} color={colorScales.gray[500]} />
            </Pressable>
          </View>

          <View style={styles.searchRow}>
            <SearchBar
              style={styles.searchInput}
              placeholder="Buscar tiendas..."
              value={search}
              onChangeText={handleSearchChange}
              onClear={() => {
                setSearch('');
                setDebouncedSearch('');
              }}
              debounceMs={1000}
            />
          </View>

          <View style={styles.filterRow}>
            <FilterChip
              label={filterType ? storeTypeLabel[filterType] || filterType : 'Tipo'}
              active={!!filterType}
              onPress={() => setPickerOpen('type')}
              onClear={filterType ? () => setFilterType('') : undefined}
            />
            <FilterChip
              label={
                filterState === 'active'
                  ? 'Activa'
                  : filterState === 'inactive'
                    ? 'Inactiva'
                    : 'Estado'
              }
              active={!!filterState}
              onPress={() => setPickerOpen('state')}
              onClear={filterState ? () => setFilterState('') : undefined}
            />
            {hasFilters && (
              <Pressable
                onPress={handleClearFilters}
                hitSlop={6}
                style={({ pressed }) => [styles.clearAllBtn, pressed && { opacity: 0.7 }]}
              >
                <Icon name="x" size={12} color={colorScales.gray[600]} />
                <Text style={styles.clearAllText}>Limpiar</Text>
              </Pressable>
            )}
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
              onAction={() => router.push('/(org-admin)/stores/create' as never)}
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
              onSecondaryAction={() => router.push('/(org-admin)/stores/create' as never)}
            />
          )}

          {/* Store cards */}
          {!isLoading && stores.length > 0 &&
            stores.map((s) => (
              <StoreCard
                key={s.id}
                store={s}
                onTap={() => setStoreToSwitch(s)}
                onEdit={() => {
                  router.push(`/(org-admin)/stores/edit?id=${s.id}` as never);
                }}
                onSettings={() => {
                  router.push(`/(org-admin)/stores/${s.id}/settings` as never);
                }}
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

      <FilterPickerModal
        visible={pickerOpen === 'type'}
        title="Tipo de tienda"
        options={FILTER_TYPE_OPTIONS}
        selected={filterType}
        onSelect={setFilterType}
        onClose={() => setPickerOpen(null)}
      />
      <FilterPickerModal
        visible={pickerOpen === 'state'}
        title="Estado de la tienda"
        options={FILTER_STATE_OPTIONS}
        selected={filterState}
        onSelect={setFilterState}
        onClose={() => setPickerOpen(null)}
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

  // ── Page header ──
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pageHeaderText: { flex: 1 },
  pageTitle: {
    fontSize: typography.fontSize.xl,
    fontFamily: interFonts.bold,
    color: colorScales.gray[900],
  },
  pageSubtitle: {
    fontSize: typography.fontSize.sm,
    fontFamily: interFonts.regular,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: 999,
    gap: spacing[1],
  },
  addBtnPressed: { opacity: 0.85 },
  addBtnText: {
    color: '#fff',
    fontFamily: interFonts.semibold,
    fontSize: typography.fontSize.sm,
  },

  // ── Stats ──
  statsScroll: { marginHorizontal: -spacing[4] },
  statsRow: {
    flexDirection: 'row',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[1],
  },
  statCard: {
    width: 150,
    backgroundColor: '#fff',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    padding: spacing[3],
    alignItems: 'flex-start',
  },
  statIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[2],
  },
  statValue: {
    fontSize: typography.fontSize['2xl'],
    fontFamily: interFonts.bold,
    color: colorScales.gray[900],
  },
  statLabel: {
    fontSize: typography.fontSize.xs,
    fontFamily: interFonts.semibold,
    color: colorScales.gray[700],
    marginTop: 2,
  },
  statSub: {
    fontSize: typography.fontSize.xs,
    fontFamily: interFonts.regular,
    color: colorScales.gray[400],
  },

  // ── Table card wrapper ──
  tableCard: {
    // outer container for title/search/filter header + card list
  },

  tableHeader: {
    backgroundColor: '#fff',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
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
  refreshBtn: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colorScales.gray[50],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  searchRow: { marginBottom: spacing[3] },
  searchInput: { width: '100%' },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  clearAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
  },
  clearAllText: {
    fontSize: typography.fontSize.xs,
    fontFamily: interFonts.medium,
    color: colorScales.gray[600],
  },

  // ── Card list ──
  cardList: {
    gap: 12,
  },
});

import { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  Text,
  View,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { OrgAuditService } from '@/features/org/services/org-audit.service';
import { OrgStatsGrid } from '@/shared/components/org-stats-grid';
import { OrgListItem } from '@/shared/components/org-list-item';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { SearchBar } from '@/shared/components/search-bar/search-bar';
import { RowActionsMenu, type RowAction } from '@/shared/components/row-actions-menu/row-actions-menu';
import { Icon } from '@/shared/components/icon/icon';
import { Modal } from '@/shared/components/modal/modal';
import {
  AuditLogDetailModal,
  PaginationBar,
  SelectableFilterSheet,
} from '@/features/org/components/audit-shared';
import {
  AUDIT_ACTION_OPTIONS,
  AUDIT_RESOURCE_OPTIONS,
  formatAction,
  formatResource,
  formatUser,
  getActionColor,
  getActionIcon,
  getResourceIcon,
} from '@/features/org/components/audit-formatters';
import type {
  AuditLogAction,
  AuditLog,
  AuditLogResource,
  AuditQueryParams,
  AuditStats,
} from '@/core/models/org-admin/audit.types';
import { borderRadius, colorScales, colors, spacing, typography } from '@/shared/theme';
import { toastError, toastSuccess } from '@/shared/components/toast/toast.store';

/**
 * Auditoría · Registros de auditoría.
 *
 * Paridad con `logs.component.ts` (web):
 *   - 4-stat grid (Eventos / Seguridad / Usuarios / Configuración)
 *   - Filtros: Recurso, Acción, Desde, Hasta (open as BottomSheet / Modal)
 *   - Acciones del header: Actualizar, Exportar CSV
 *   - Cards con action badge color, resource label, user, IP, fecha
 *   - Paginación manual (10 por página)
 *   - Detalle con diff viewer cuando hay old_values / new_values
 */

const PAGE_SIZE = 10;
const DEFAULT_FILTERS = { resource: null, action: null, from: null, to: null } as {
  resource: AuditLogResource | null;
  action: AuditLogAction | null;
  from: string | null;
  to: string | null;
};

function auditStatsItems(stats: AuditStats | null | undefined) {
  const combined = stats?.logs_by_action_and_resource ?? {};
  const byAction = stats?.logs_by_action ?? {};
  const byResource = stats?.logs_by_resource ?? {};
  const sum = (rec: Record<string, number>, keys: string[]) =>
    keys.reduce((acc, k) => acc + (rec[k] || 0), 0);
  const sumCombined = (resources: string[]) =>
    resources.reduce(
      (acc, r) =>
        acc +
        (combined[`CREATE_${r}`] ?? 0) +
        (combined[`UPDATE_${r}`] ?? 0) +
        (combined[`DELETE_${r}`] ?? 0) +
        (combined[`PERMISSION_CHANGE_${r}`] ?? 0),
      0,
    );
  const authAction =
    sum(byAction, [
      'LOGIN',
      'LOGOUT',
      'LOGIN_FAILED',
      'ACCOUNT_LOCKED',
      'ACCOUNT_UNLOCKED',
      'SUSPICIOUS_ACTIVITY',
      'PASSWORD_RESET',
      'PASSWORD_CHANGE',
    ]) || sum(byResource, ['auth']);
  return [
    {
      label: 'Eventos',
      value: stats?.total_logs ?? 0,
      icon: 'history',
      color: colorScales.blue[600],
      subText: 'registros de auditoría',
    },
    {
      label: 'Seguridad',
      value: authAction,
      icon: 'shield-check',
      color: colorScales.red[600],
      subText: 'sesiones y alertas',
    },
    {
      label: 'Usuarios',
      value:
        sumCombined(['users', 'roles', 'permissions']) ||
        sum(byResource, ['users', 'roles', 'permissions']),
      icon: 'users',
      color: colorScales.green[600],
      subText: 'usuarios, roles y permisos',
    },
    {
      label: 'Configuración',
      value:
        sumCombined(['settings', 'domain_settings', 'organizations', 'stores']) ||
        sum(byResource, ['settings', 'domain_settings', 'organizations', 'stores']),
      icon: 'settings',
      color: colorScales.blue[700],
      subText: 'ajustes críticos',
    },
  ];
}

export default function AuditLogsScreen() {
  const queryClient = useQueryClient();

  // Filtros / paginación
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);

  // Modales
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [resourceSheetOpen, setResourceSheetOpen] = useState(false);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const [dateSheetOpen, setDateSheetOpen] = useState(false);
  const [selected, setSelected] = useState<AuditLog | null>(null);

  // ───── Queries ───────────────────────────────────────────────────────────
  const queryParams: AuditQueryParams = useMemo(
    () => ({
      offset: (page - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
      ...(filters.resource ? { resource: filters.resource } : {}),
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.from ? { from_date: filters.from } : {}),
      ...(filters.to ? { to_date: filters.to } : {}),
      ...(search ? { search } : {}),
    }),
    [page, filters, search],
  );

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-audit-logs', queryParams],
    queryFn: () => OrgAuditService.listLogs(queryParams as any),
  });

  const { data: stats } = useQuery({
    queryKey: ['org-audit-logs-stats'],
    queryFn: () => OrgAuditService.getStats(),
    staleTime: 60_000,
  });

  const logs = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const totalPages = data?.meta?.totalPages ?? Math.max(1, Math.ceil(total / PAGE_SIZE));

  const hasFilters =
    !!filters.resource || !!filters.action || !!filters.from || !!filters.to || !!search;

  // ───── Export CSV mutation ────────────────────────────────────────────────
  const exportMutation = useMutation({
    mutationFn: () => {
      const params: Record<string, string | undefined> = {
        resource: filters.resource ?? undefined,
        action: filters.action ?? undefined,
        from_date: filters.from ?? undefined,
        to_date: filters.to ?? undefined,
      };
      return OrgAuditService.exportLogsCsv(params);
    },
    onSuccess: async ({ filename, csv }) => {
      try {
        const fileUri = `${FileSystem.cacheDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(fileUri, csv, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        const available = await Sharing.isAvailableAsync();
        if (available) {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'text/csv',
            dialogTitle: 'Exportar logs de auditoría',
            UTI: 'public.comma-separated-values-text',
          });
          toastSuccess('CSV listo para compartir');
        } else {
          toastSuccess(`${filename} generado (${(csv.length / 1024).toFixed(1)} KB)`);
        }
      } catch (err) {
        // El archivo sí se generó; sólo falló el share.
        toastSuccess('Exportación generada');
      }
    },
    onError: () => toastError('No se pudo exportar el CSV'),
  });

  // ───── Handlers ──────────────────────────────────────────────────────────
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      refetch(),
      queryClient.invalidateQueries({ queryKey: ['org-audit-logs-stats'] }),
    ]);
    setRefreshing(false);
  };

  const clearFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setSearch('');
    setPage(1);
  };

  const rowActionsFor = (log: AuditLog): RowAction[] => [
    {
      key: 'view',
      label: 'Ver detalle',
      icon: 'eye',
      variant: 'info',
      onPress: () => setSelected(log),
    },
  ];

  // ───── Render ────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <FlatList<AuditLog>
        data={logs}
        keyExtractor={(l) => String(l.id)}
        ListHeaderComponent={
          <ListHeader
            stats={stats ?? null}
            count={total}
            search={search}
            onSearchChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            filters={filters}
            hasFilters={hasFilters}
            onOpenFilters={() => setFiltersOpen(true)}
            onOpenResource={() => setResourceSheetOpen(true)}
            onOpenAction={() => setActionSheetOpen(true)}
            onOpenDates={() => setDateSheetOpen(true)}
            onRefresh={onRefresh}
            onExport={() => exportMutation.mutate()}
            exporting={exportMutation.isPending}
            onClearFilters={clearFilters}
          />
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : hasFilters ? (
            <EmptyState
              icon="filter"
              title="No hay registros con estos filtros"
              description="Limpia los filtros o actualiza la lista para revisar nuevos eventos."
              actionLabel="Limpiar filtros"
              onAction={clearFilters}
            />
          ) : (
            <EmptyState
              icon="history"
              title="No hay registros de auditoría"
              description="Los eventos aparecerán aquí cuando se registren cambios auditables."
            />
          )
        }
        renderItem={({ item }) => (
          <OrgListItem
            key={item.id}
            title={formatAction(item.action)}
            subtitle={`${formatResource(item.resource)}${
              item.resource_id ? ` · #${item.resource_id}` : ''
            }`}
            description={`${formatUser(item)}${
              item.ip_address ? ` · ${item.ip_address}` : ''
            }`}
            leftIcon={getActionIcon(item.action)}
            leftIconColor={getActionColor(item.action)}
            rightBadge={{ label: formatAction(item.action), variant: 'primary' }}
            rightMeta={new Date(item.created_at).toLocaleString()}
            onPress={() => setSelected(item)}
            chevron={false}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListFooterComponent={
          <PaginationBar
            page={page}
            totalPages={totalPages}
            total={total}
            onChange={(p) => setPage(p)}
          />
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        contentContainerStyle={styles.listContent}
      />

      {/* Sheets / modales */}
      <FiltersModal
        visible={filtersOpen}
        filters={filters}
        onApply={(next) => {
          setFilters(next);
          setPage(1);
        }}
        onClose={() => setFiltersOpen(false)}
      />

      <SelectableFilterSheet
        visible={resourceSheetOpen}
        title="Filtrar por recurso"
        options={AUDIT_RESOURCE_OPTIONS.map((opt) => ({
          value: opt.value,
          label: opt.label,
          icon: getResourceIcon(opt.value),
        }))}
        selected={filters.resource}
        onSelect={(v) => {
          setFilters({ ...filters, resource: (v as AuditLogResource | null) ?? null });
          setPage(1);
        }}
        onClose={() => setResourceSheetOpen(false)}
      />

      <SelectableFilterSheet
        visible={actionSheetOpen}
        title="Filtrar por acción"
        options={AUDIT_ACTION_OPTIONS.map((opt) => ({
          value: opt.value,
          label: opt.label,
          icon: getActionIcon(opt.value),
          color: getActionColor(opt.value),
        }))}
        selected={filters.action}
        onSelect={(v) => {
          setFilters({ ...filters, action: (v as AuditLogAction | null) ?? null });
          setPage(1);
        }}
        onClose={() => setActionSheetOpen(false)}
      />

      <DateRangeModal
        visible={dateSheetOpen}
        from={filters.from}
        to={filters.to}
        onApply={(from, to) => {
          setFilters({ ...filters, from, to });
          setPage(1);
        }}
        onClose={() => setDateSheetOpen(false)}
      />

      <AuditLogDetailModal
        visible={!!selected}
        log={selected}
        formatAction={formatAction}
        formatResource={formatResource}
        getActionIcon={getActionIcon}
        getActionColor={getActionColor}
        formatUser={formatUser}
        onClose={() => setSelected(null)}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────────

interface ListHeaderProps {
  stats: AuditStats | null;
  count: number;
  search: string;
  onSearchChange: (v: string) => void;
  filters: typeof DEFAULT_FILTERS;
  hasFilters: boolean;
  onOpenFilters: () => void;
  onOpenResource: () => void;
  onOpenAction: () => void;
  onOpenDates: () => void;
  onRefresh: () => void;
  onExport: () => void;
  exporting: boolean;
  onClearFilters: () => void;
}

function ListHeader({
  stats,
  count,
  search,
  onSearchChange,
  filters,
  hasFilters,
  onOpenFilters,
  onOpenResource,
  onOpenAction,
  onOpenDates,
  onRefresh,
  onExport,
  exporting,
  onClearFilters,
}: ListHeaderProps) {
  return (
    <View>
      <View style={styles.statsWrap}>
        <OrgStatsGrid columns={2} stats={auditStatsItems(stats)} />
      </View>

      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.titleMain}>Registros de auditoría</Text>
          <Text style={styles.titleCount}>
            {count} {count === 1 ? 'evento' : 'eventos'}
          </Text>
        </View>
        <RowActionsMenu
          actions={[
            { key: 'refresh', label: 'Actualizar', icon: 'refresh-cw', variant: 'default', onPress: onRefresh },
            {
              key: 'export',
              label: exporting ? 'Exportando…' : 'Exportar CSV',
              icon: 'download',
              variant: 'primary',
              visible: !exporting,
              onPress: onExport,
            },
          ]}
          accessibilityLabel="Acciones de registros"
        />
      </View>

      <View style={styles.searchRow}>
        <View style={{ flex: 1 }}>
          <SearchBar
            value={search}
            onChangeText={onSearchChange}
            placeholder="Buscar registros…"
          />
        </View>
        <Pressable
          style={[styles.filterBtn, hasFilters && styles.filterBtnActive]}
          onPress={onOpenFilters}
        >
          <Icon
            name="sliders-horizontal"
            size={18}
            color={hasFilters ? '#FFFFFF' : colorScales.gray[700]}
          />
          {hasFilters ? <View style={styles.filterDot} /> : null}
        </Pressable>
      </View>

      {/* Chips de filtros activos */}
      {(filters.resource || filters.action || filters.from || filters.to) ? (
        <View style={styles.chipsRow}>
          {filters.resource ? (
            <FilterChip
              icon={getResourceIcon(filters.resource)}
              label={`Recurso: ${formatResource(filters.resource)}`}
              onClear={() => onSearchChange(search)}
            />
          ) : null}
          {filters.action ? (
            <FilterChip
              icon={getActionIcon(filters.action)}
              label={`Acción: ${formatAction(filters.action)}`}
              onClear={() => onSearchChange(search)}
            />
          ) : null}
          {(filters.from || filters.to) ? (
            <FilterChip
              icon="calendar"
              label={`${filters.from ?? '∞'} → ${filters.to ?? '∞'}`}
              onClear={() => onSearchChange(search)}
            />
          ) : null}
          <Pressable onPress={onClearFilters}>
            <Text style={styles.chipsClear}>Limpiar</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.quickFilters}>
        <QuickFilterBtn
          icon={getResourceIcon(filters.resource ?? ('users' as any))}
          label="Recurso"
          active={!!filters.resource}
          onPress={onOpenResource}
        />
        <QuickFilterBtn
          icon="activity"
          label="Acción"
          active={!!filters.action}
          onPress={onOpenAction}
        />
        <QuickFilterBtn
          icon="calendar"
          label="Fechas"
          active={!!(filters.from || filters.to)}
          onPress={onOpenDates}
        />
      </View>
    </View>
  );
}

function FilterChip({ icon, label, onClear }: { icon: string; label: string; onClear: () => void }) {
  return (
    <View style={styles.chip}>
      <Icon name={icon} size={12} color={colorScales.green[700]} />
      <Text style={styles.chipText} numberOfLines={1}>{label}</Text>
      <Pressable onPress={onClear} hitSlop={6}>
        <Icon name="x" size={12} color={colorScales.green[700]} />
      </Pressable>
    </View>
  );
}

function QuickFilterBtn({
  icon,
  label,
  active,
  onPress,
}: {
  icon: string;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.quickBtn, active && styles.quickBtnActive]}
      onPress={onPress}
    >
      <Icon name={icon} size={14} color={active ? '#FFFFFF' : colorScales.gray[700]} />
      <Text style={[styles.quickBtnText, active && styles.quickBtnTextActive]}>{label}</Text>
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal de filtros (compose Recurso + Acción + fechas)
// ─────────────────────────────────────────────────────────────────────────────

function FiltersModal({
  visible,
  filters,
  onApply,
  onClose,
}: {
  visible: boolean;
  filters: typeof DEFAULT_FILTERS;
  onApply: (f: typeof DEFAULT_FILTERS) => void;
  onClose: () => void;
}) {
  const [local, setLocal] = useState(filters);

  return (
    <Modal visible={visible} onClose={onClose} title="Filtros" showFooter>
      <Text style={styles.filtersIntro}>
        Combina filtros para reducir la lista. Toca Aplicar para recargar.
      </Text>
      <FilterRow label="Recurso" value={local.resource ? formatResource(local.resource) : 'Todos los recursos'} />
      <SelectableFilterSheet
        visible={false}
        title="Recurso"
        options={[]}
        onSelect={undefined as any}
        onClose={() => undefined}
      />
      <FilterRow label="Acción" value={local.action ? formatAction(local.action) : 'Todas las acciones'} />
      <FilterRow
        label="Desde"
        value={local.from ?? 'Sin fecha'}
        onPress={() =>
          Alert.prompt
            ? Alert.prompt('Fecha inicial', 'YYYY-MM-DD', (text) => setLocal({ ...local, from: text || null }))
            : setLocal({ ...local, from: new Date().toISOString().split('T')[0] })
        }
      />
      <FilterRow
        label="Hasta"
        value={local.to ?? 'Sin fecha'}
        onPress={() =>
          Alert.prompt
            ? Alert.prompt('Fecha final', 'YYYY-MM-DD', (text) => setLocal({ ...local, to: text || null }))
            : setLocal({ ...local, to: new Date().toISOString().split('T')[0] })
        }
      />

      <View style={styles.modalActions}>
        <Pressable
          style={[styles.modalBtn, styles.modalBtnSecondary]}
          onPress={() => {
            setLocal(DEFAULT_FILTERS);
            onApply(DEFAULT_FILTERS);
            onClose();
          }}
        >
          <Text style={styles.modalBtnSecondaryText}>Limpiar</Text>
        </Pressable>
        <Pressable
          style={[styles.modalBtn, styles.modalBtnPrimary]}
          onPress={() => {
            onApply(local);
            onClose();
          }}
        >
          <Text style={styles.modalBtnPrimaryText}>Aplicar</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function FilterRow({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  const Container: any = onPress ? Pressable : View;
  return (
    <Container onPress={onPress} style={styles.filterRow}>
      <Text style={styles.filterRowLabel}>{label}</Text>
      <Text style={styles.filterRowValue} numberOfLines={1}>{value}</Text>
      {onPress ? <Icon name="chevron-right" size={14} color={colorScales.gray[400]} /> : null}
    </Container>
  );
}

function DateRangeModal({
  visible,
  from,
  to,
  onApply,
  onClose,
}: {
  visible: boolean;
  from: string | null;
  to: string | null;
  onApply: (from: string | null, to: string | null) => void;
  onClose: () => void;
}) {
  const [localFrom, setLocalFrom] = useState(from ?? '');
  const [localTo, setLocalTo] = useState(to ?? '');

  return (
    <Modal visible={visible} onClose={onClose} title="Rango de fechas" showFooter>
      <FilterRow label="Desde" value={localFrom || 'Sin fecha'} onPress={() =>
        Alert.prompt('Fecha inicial', 'YYYY-MM-DD', (text) => setLocalFrom(text))
      } />
      <FilterRow label="Hasta" value={localTo || 'Sin fecha'} onPress={() =>
        Alert.prompt('Fecha final', 'YYYY-MM-DD', (text) => setLocalTo(text))
      } />
      <View style={styles.modalActions}>
        <Pressable
          style={[styles.modalBtn, styles.modalBtnSecondary]}
          onPress={() => {
            setLocalFrom('');
            setLocalTo('');
            onApply(null, null);
            onClose();
          }}
        >
          <Text style={styles.modalBtnSecondaryText}>Limpiar</Text>
        </Pressable>
        <Pressable
          style={[styles.modalBtn, styles.modalBtnPrimary]}
          onPress={() => {
            onApply(localFrom || null, localTo || null);
            onClose();
          }}
        >
          <Text style={styles.modalBtnPrimaryText}>Aplicar</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colorScales.gray[50] },
  loading: { paddingVertical: spacing[12], alignItems: 'center' },
  statsWrap: { marginBottom: spacing[3] },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[1],
    marginBottom: spacing[3],
  },
  titleMain: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  titleCount: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  filterBtn: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    position: 'relative',
  },
  filterBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colorScales.amber[400],
  },
  chipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[3],
    flexWrap: 'wrap',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[2],
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    backgroundColor: colorScales.green[100],
  },
  chipText: {
    fontSize: 11,
    color: colorScales.green[700],
    fontWeight: typography.fontWeight.semibold,
  },
  chipsClear: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: typography.fontWeight.semibold,
    marginLeft: spacing[2],
  },
  quickFilters: {
    flexDirection: 'row',
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  quickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.background,
  },
  quickBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  quickBtnText: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[700],
    fontWeight: typography.fontWeight.medium,
  },
  quickBtnTextActive: {
    color: '#FFFFFF',
    fontWeight: typography.fontWeight.semibold,
  },
  listContent: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
    paddingBottom: spacing[24],
  },
  separator: { height: spacing[1] },
  filtersIntro: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginBottom: spacing[4],
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  filterRowLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[700],
    width: 90,
  },
  filterRowValue: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[900],
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing[2],
    paddingTop: spacing[4],
  },
  modalBtn: {
    flex: 1,
    height: 44,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnPrimary: { backgroundColor: colors.primary },
  modalBtnPrimaryText: { color: '#FFFFFF', fontWeight: typography.fontWeight.semibold },
  modalBtnSecondary: { backgroundColor: colorScales.gray[100] },
  modalBtnSecondaryText: { color: colorScales.gray[700], fontWeight: typography.fontWeight.semibold },
});

import { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  Text,
  View,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { OrgAuditService } from '@/features/org/services/org-audit.service';
import { OrgStatsGrid } from '@/shared/components/org-stats-grid';
import { OrgResponsiveCard, type OrgCardAction } from '@/shared/components/org-responsive-card';
import { OrgOptionsDropdown, type OrgOptionsAction } from '@/shared/components/org-options-dropdown';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { SearchBar } from '@/shared/components/search-bar/search-bar';
import { Icon } from '@/shared/components/icon/icon';
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
 * Auditoría · Registros de auditoría (paridad visual con web).
 *
 * Layout mobile (espejo de `logs.component.html`):
 *   ┌──────────────────────────────────────────┐
 *   │ [stats grid sticky-top, scroll horiz.]   │
 *   ├──────────────────────────────────────────┤
 *   │ Registros de auditoría    [Acciones▾]    │ ← OrgOptionsDropdown
 *   │ 142 eventos                [Filtros 0▾]  │
 *   │ [🔎 SearchBar ───────────────────]       │
 *   ├──────────────────────────────────────────┤
 *   │ [OrgResponsiveCard × N]                  │
 *   │  - avatar + title-group + badge          │
 *   │  - details-grid 2-col                    │
 *   │  - footer con acciones + dropdown ⋮      │
 *   ├──────────────────────────────────────────┤
 *   │ [PaginationBar]                          │
 *   └──────────────────────────────────────────┘
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
  const [resourceSheetOpen, setResourceSheetOpen] = useState(false);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
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
  const activeFiltersCount = [
    filters.resource,
    filters.action,
    filters.from,
    filters.to,
  ].filter(Boolean).length;

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

  const actions: OrgOptionsAction[] = [
    {
      key: 'refresh',
      label: 'Actualizar',
      icon: 'refresh-cw',
      onPress: onRefresh,
    },
    {
      key: 'export',
      label: exportMutation.isPending ? 'Exportando…' : 'Exportar CSV',
      icon: 'download',
      variant: 'primary',
      disabled: exportMutation.isPending,
      onPress: () => exportMutation.mutate(),
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
            actions={actions}
            activeFiltersCount={activeFiltersCount}
            filters={filters}
            onOpenResource={() => setResourceSheetOpen(true)}
            onOpenAction={() => setActionSheetOpen(true)}
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
        renderItem={({ item }) => {
          const cardActions: OrgCardAction[] = [
            {
              key: 'view',
              label: 'Ver detalle',
              icon: 'eye',
              variant: 'primary',
              showInFooter: true,
              onPress: () => setSelected(item),
            },
          ];
          return (
            <OrgResponsiveCard
              title={formatUser(item)}
              subtitle={`${formatResource(item.resource)}${
                item.resource_id ? ` · #${item.resource_id}` : ''
              }`}
              leftIcon={getActionIcon(item.action)}
              leftIconColor={getActionColor(item.action)}
              badge={{ label: formatAction(item.action), variant: 'primary' }}
              details={[
                {
                  label: 'Acción',
                  value: formatAction(item.action),
                  icon: getActionIcon(item.action),
                  iconColor: getActionColor(item.action),
                },
                {
                  label: 'Fecha',
                  value: new Date(item.created_at).toLocaleString(),
                  icon: 'calendar',
                },
                {
                  label: 'IP',
                  value: item.ip_address ?? '—',
                  icon: 'globe',
                  monospace: true,
                },
                {
                  label: 'Recurso',
                  value: formatResource(item.resource),
                  icon: getResourceIcon(item.resource),
                },
              ]}
              footerLabel="Detalle"
              footerValue={formatAction(item.action)}
              actions={cardActions}
              onPress={() => setSelected(item)}
              chevron={false}
            />
          );
        }}
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
  actions: OrgOptionsAction[];
  activeFiltersCount: number;
  filters: typeof DEFAULT_FILTERS;
  onOpenResource: () => void;
  onOpenAction: () => void;
  onClearFilters: () => void;
}

function ListHeader({
  stats,
  count,
  search,
  onSearchChange,
  actions,
  activeFiltersCount,
  filters,
  onOpenResource,
  onOpenAction,
  onClearFilters,
}: ListHeaderProps) {
  return (
    <View>
      {/* Stats grid sticky-top (mirror of <app-stats> in web) */}
      <View style={styles.statsWrap}>
        <OrgStatsGrid stats={auditStatsItems(stats)} />
      </View>

      {/* Title row + Acciones/Filtros dropdown (mirror of <app-options-dropdown>) */}
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.titleMain}>Registros de auditoría</Text>
          <Text style={styles.titleCount}>
            {count} {count === 1 ? 'evento' : 'eventos'}
          </Text>
        </View>
        <OrgOptionsDropdown
          actions={actions}
          activeFiltersCount={activeFiltersCount}
          renderFiltersContent={({ onClose }) => (
            <View>
              <FilterSection
                label="Recurso"
                value={filters.resource ? formatResource(filters.resource) : 'Todos los recursos'}
                onPress={() => {
                  onClose();
                  setTimeout(onOpenResource, 200);
                }}
              />
              <FilterSection
                label="Acción"
                value={filters.action ? formatAction(filters.action) : 'Todas las acciones'}
                onPress={() => {
                  onClose();
                  setTimeout(onOpenAction, 200);
                }}
              />
              {activeFiltersCount > 0 ? (
                <Pressable onPress={onClearFilters} style={styles.clearAllRow}>
                  <Icon name="x" size={14} color={colors.error} />
                  <Text style={styles.clearAllText}>Limpiar todos los filtros</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        />
      </View>

      {/* Search bar */}
      <View style={styles.searchRow}>
        <SearchBar
          value={search}
          onChangeText={onSearchChange}
          placeholder="Buscar registros…"
        />
      </View>
    </View>
  );
}

function FilterSection({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.filterSection} onPress={onPress}>
      <View style={{ flex: 1 }}>
        <Text style={styles.filterLabel}>{label}</Text>
        <Text style={styles.filterValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
      <Icon name="chevron-right" size={16} color={colorScales.gray[400]} />
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colorScales.gray[50] },
  loading: { paddingVertical: spacing[12], alignItems: 'center' },
  statsWrap: {
    marginHorizontal: -spacing[4],
    marginBottom: spacing[3],
  },
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
    marginBottom: spacing[3],
  },
  separator: { height: spacing[1] },
  listContent: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
    paddingBottom: spacing[24],
  },
  filterSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  filterLabel: {
    fontSize: 10,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  filterValue: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[900],
    marginTop: 2,
    fontWeight: typography.fontWeight.medium,
  },
  clearAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[2],
  },
  clearAllText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.error,
  },
});

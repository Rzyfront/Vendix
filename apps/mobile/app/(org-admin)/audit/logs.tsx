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
import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
import { OrgResponsiveCard, type OrgCardAction } from '@/shared/components/org-responsive-card';
import { OrgOptionsDropdown, type OrgOptionsAction } from '@/shared/components/org-options-dropdown';
import { OrgCenteredModal } from '@/shared/components/org-centered-modal';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { Icon } from '@/shared/components/icon/icon';
import {
  AuditLogDetailModal,
  PaginationBar,
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
 * Layout mobile (espejo de `logs.component.html` + `md:static md:bg-transparent`):
 *   ┌──────────────────────────────────────────┐ ← sticky top-0 z-20
 *   │ [stats grid scroll horiz.]               │
 *   ├──────────────────────────────────────────┤ ← sticky top-[99px] z-10
 *   │ Registros de auditoría    [Acciones▾]    │
 *   │ 142 eventos                [Filtros 0▾]  │
 *   ├──────────────────────────────────────────┤
 *   │ [OrgResponsiveCard × N]                  │ ← scroll
 *   │  - avatar (square 80x80) + title-group   │
 *   │  - details-grid 3-col                    │
 *   │  - footer: 👁 [⋮]                        │
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
      iconColor: colorScales.blue[600],
      iconBg: colorScales.blue[600] + '15',
      description: 'registros de auditoría',
    },
    {
      label: 'Seguridad',
      value: authAction,
      icon: 'shield-check',
      iconColor: colorScales.red[600],
      iconBg: colorScales.red[600] + '15',
      description: 'sesiones y alertas',
    },
    {
      label: 'Usuarios',
      value:
        sumCombined(['users', 'roles', 'permissions']) ||
        sum(byResource, ['users', 'roles', 'permissions']),
      icon: 'users',
      iconColor: colorScales.green[600],
      iconBg: colorScales.green[600] + '15',
      description: 'usuarios, roles y permisos',
    },
    {
      label: 'Configuración',
      value:
        sumCombined(['settings', 'domain_settings', 'organizations', 'stores']) ||
        sum(byResource, ['settings', 'domain_settings', 'organizations', 'stores']),
      icon: 'settings',
      iconColor: colorScales.blue[700],
      iconBg: colorScales.blue[700] + '15',
      description: 'ajustes críticos',
    },
  ];
}

export default function AuditLogsScreen() {
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
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
    }),
    [page, filters],
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
    !!filters.resource || !!filters.action || !!filters.from || !!filters.to;
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
    setPage(1);
  };

  const actions: OrgOptionsAction[] = [
    { key: 'refresh', label: 'Actualizar', icon: 'refresh-cw', onPress: onRefresh },
    {
      key: 'export',
      label: exportMutation.isPending ? 'Exportando…' : 'Exportar CSV',
      icon: 'download',
      variant: 'primary',
      disabled: exportMutation.isPending,
      onPress: () => exportMutation.mutate(),
    },
  ];

  return (
    <View style={styles.root}>
      {/* Sticky top: stats grid (web: `stats-container sticky top-0 z-20`) */}
      <View style={styles.stickyStats}>
        <StatsGrid items={auditStatsItems(stats)} />
      </View>

      {/* Sticky below: title row + options dropdown (web: `sticky top-[99px] z-10`) */}
      <View style={styles.stickyTitleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.titleMain}>
            Registros de auditoría{' '}
            <Text style={styles.titleCount}>({total})</Text>
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
                }}
                onClear={() => {
                  setFilters({ ...filters, resource: null });
                  setPage(1);
                }}
                hasValue={!!filters.resource}
              />
              <FilterSection
                label="Acción"
                value={filters.action ? formatAction(filters.action) : 'Todas las acciones'}
                onPress={() => {
                  onClose();
                }}
                onClear={() => {
                  setFilters({ ...filters, action: null });
                  setPage(1);
                }}
                hasValue={!!filters.action}
              />
              {activeFiltersCount > 0 ? (
                <Pressable onPress={clearFilters} style={styles.clearAllRow}>
                  <Icon name="x" size={14} color={colors.error} />
                  <Text style={styles.clearAllText}>Limpiar todos los filtros</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        />
      </View>

      {/* Scrollable list */}
      <FlatList<AuditLog>
        data={logs}
        keyExtractor={(l) => String(l.id)}
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
          // Paridad con web `logs.component.ts cardConfig`:
          //   title        = formatAuditAction(action)         — ej. "Crear usuario"
          //   subtitle     = formatAuditResource(resource) + #id
          //   badge        = formatAuditAction(action) con color
          //   detail[0]    = Usuario (icon user)
          //   detail[1]    = Fecha
          //   detail[2]    = IP
          // Antes: el title era el usuario y "Acción" aparecía como detail, lo que
          // duplicaba info con el badge y enterraba lo más importante (la acción).
          return (
            <OrgResponsiveCard
              title={formatAction(item.action)}
              subtitle={`${formatResource(item.resource)}${
                item.resource_id ? ` · #${item.resource_id}` : ''
              }`}
              leftIcon={getActionIcon(item.action)}
              leftIconColor={getActionColor(item.action)}
              badge={{ label: formatAction(item.action), variant: 'primary' }}
              details={[
                {
                  label: 'Usuario',
                  value: formatUser(item),
                  icon: 'user',
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
        style={styles.flatList}
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

function FilterSection({
  label,
  value,
  onPress,
  onClear,
  hasValue,
}: {
  label: string;
  value: string;
  onPress: () => void;
  onClear?: () => void;
  hasValue?: boolean;
}) {
  return (
    <View style={styles.filterSection}>
      <Pressable style={styles.filterSectionMain} onPress={onPress}>
        <View style={{ flex: 1 }}>
          <Text style={styles.filterLabel}>{label}</Text>
          <Text style={styles.filterValue} numberOfLines={1}>
            {value}
          </Text>
        </View>
        <Icon name="chevron-right" size={16} color={colorScales.gray[400]} />
      </Pressable>
      {hasValue && onClear ? (
        <Pressable onPress={onClear} hitSlop={6} style={styles.filterClearBtn}>
          <Icon name="x" size={12} color={colors.error} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colorScales.gray[50] },
  loading: { paddingVertical: spacing[12], alignItems: 'center' },
  // Sticky stats: scroll horizontal, NO flex: 1 (altura fija al contenido)
  stickyStats: {
    backgroundColor: colorScales.gray[50],
    paddingBottom: spacing[2],
  },
  // Sticky title row: justo debajo de stats
  stickyTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  titleMain: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  titleCount: {
    fontWeight: typography.fontWeight.normal,
    color: colorScales.gray[500],
  },
  flatList: {
    flex: 1,
  },
  separator: { height: spacing[3] },
  listContent: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[24],
  },
  filterSection: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  filterSectionMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[2],
  },
  filterClearBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[2],
    borderRadius: borderRadius.md,
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

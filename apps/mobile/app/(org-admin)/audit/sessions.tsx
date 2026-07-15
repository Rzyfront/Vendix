import { useCallback, useMemo, useState } from 'react';
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
import { OrgAuditService } from '@/features/org/services/org-audit.service';
import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
import { OrgResponsiveCard, type OrgCardAction } from '@/shared/components/org-responsive-card';
import { OrgCenteredModal } from '@/shared/components/org-centered-modal';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { OrgDetailRow } from '@/shared/components/org-detail-row';
import { Icon } from '@/shared/components/icon/icon';
import { PaginationBar } from '@/features/org/components/audit-shared';
import {
  OptionsDropdown,
  type FilterConfig,
  type FilterValues,
} from '@/shared/components/options-dropdown';
import {
  formatSessionUser,
  getDeviceIcon,
  isSessionActive,
} from '@/features/org/components/audit-formatters';
import type { ActiveSession } from '@/core/models/org-admin/audit.types';
import { borderRadius, colorScales, colors, spacing, typography, interFonts } from '@/shared/theme';
import { toastError, toastSuccess } from '@/shared/components/toast/toast.store';

/**
 * Auditoría · Sesiones (paridad visual con web).
 *
 * Layout mobile (espejo del `sessions.component.ts` web):
 *   ┌──────────────────────────────────────────┐ ← Stats grid scroll horiz.
 *   ├──────────────────────────────────────────┤
 *   │ ┌──────────────────────────────────────┐ │
 *   │ │ Sesiones (N)                        │ │ ← tableCard
 *   │ │ [+] [⚙ Estado ▾]                    │ │
 *   │ ├──────────────────────────────────────┤ │
 *   │ │ [OrgResponsiveCard × N]              │ │
 *   │ └──────────────────────────────────────┘ │
 *   └──────────────────────────────────────────┘
 *
 * Paridad con el patrón aplicado a users/stores/domains/logs:
 *   - `tableCard` + `tableHeader` (1:1 con el `<app-card>` web)
 *   - 2 icon-only triggers (actions + filters, 40x40, primary border)
 *   - Filters → popover anclado al trigger (`<OptionsDropdown showActions={false}>`)
 *   - Actions → modal centrado (`<OrgCenteredModal>`)
 */

const PAGE_SIZE = 10;
type StatusFilter = 'all' | 'active' | 'inactive';
const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Todas las sesiones' },
  { value: 'active', label: 'Sólo sesiones activas' },
  { value: 'inactive', label: 'Sólo sesiones inactivas' },
];

// ─────────────────────────────────────────────────────────────────────────────
// ListHeader — espejo del patrón users/stores/domains/logs
// ─────────────────────────────────────────────────────────────────────────────

interface ListHeaderProps {
  count: number;
  activeCount: number;
  inactiveCount: number;
  onActionsPress: () => void;
  filterConfigs: FilterConfig[];
  filterValues: FilterValues;
  onFilterChange: (values: FilterValues) => void;
  onClearAllFilters: () => void;
  activeFilterCount: boolean;
}

function ListHeader({
  count,
  activeCount,
  inactiveCount,
  onActionsPress,
  filterConfigs,
  filterValues,
  onFilterChange,
  onClearAllFilters,
  activeFilterCount,
}: ListHeaderProps) {
  return (
    <View>
      {/* Stats — espejo del bloque `stats-container` web */}
      <View style={styles.statsWrap}>
        <StatsGrid
          items={[
            {
              label: 'Total Sesiones',
              value: count,
              icon: 'monitor',
              iconColor: colorScales.blue[600],
              iconBg: colorScales.blue[600] + '15',
              description: 'sesiones registradas',
            },
            {
              label: 'Activas',
              value: activeCount,
              icon: 'check-circle',
              iconColor: colorScales.green[600],
              iconBg: colorScales.green[600] + '15',
              description: 'sesiones activas',
            },
            {
              label: 'Inactivas',
              value: inactiveCount,
              icon: 'x-circle',
              iconColor: colorScales.red[600],
              iconBg: colorScales.red[600] + '15',
              description: 'sesiones terminadas',
            },
          ]}
        />
      </View>

      {/* ── Table card header (paridad 1:1 con users/stores/domains/logs) ─ */}
      <View style={styles.tableHeader}>
        <View style={styles.tableTitleRow}>
          <Text style={styles.tableTitle}>
            Sesiones{' '}
            <Text style={styles.tableTitleCount}>({count})</Text>
          </Text>
        </View>

        {/* 2 icon-only triggers en UNA sola línea. Sin search bar porque la
            web no incluye búsqueda para sesiones (los filtros son por status). */}
        <View style={styles.searchRow}>
          <View style={{ flex: 1 }} />
          {/* Actions trigger (+ button) — abre modal con Actualizar */}
          <Pressable
            style={({ pressed }) => [styles.optionsTrigger, pressed && { opacity: 0.85 }]}
            onPress={onActionsPress}
            accessibilityLabel="Abrir acciones"
          >
            <Icon name="plus" size={18} color={colors.primary} />
          </Pressable>
          {/* Filters trigger (espejo del `<app-options-dropdown>` web mobile).
              Popover anclado al trigger (NO modal/sheet centrado). */}
          <OptionsDropdown
            showActions={false}
            filters={filterConfigs}
            filterValues={filterValues}
            onFilterChange={onFilterChange}
            onClearAllFilters={onClearAllFilters}
          />
        </View>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function SessionsScreen() {
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<ActiveSession | null>(null);
  const [pendingTerminate, setPendingTerminate] = useState<ActiveSession | null>(null);
  const [actionsModalOpen, setActionsModalOpen] = useState(false);

  const queryParams = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      ...(status === 'active' || status === 'inactive' ? { status } : {}),
    }),
    [page, status],
  );

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-audit-sessions', queryParams],
    queryFn: () => OrgAuditService.listSessions(queryParams),
  });

  const sessions = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const totalPages = data?.meta?.totalPages ?? Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeCount = sessions.filter((s) => isSessionActive(s)).length;
  const inactiveCount = Math.max(total - activeCount, 0);

  // ───── Filter configs (espejo del form web) ──────────────────────
  const filterConfigs = useMemo<FilterConfig[]>(
    () => [
      {
        key: 'status',
        label: 'Estado',
        type: 'select',
        options: STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
      },
    ],
    [],
  );

  const filterValues = useMemo<FilterValues>(
    () => ({
      status: status || null,
    }),
    [status],
  );

  const handleFilterChange = useCallback((values: FilterValues) => {
    const next = (values.status as StatusFilter | null) ?? 'all';
    setStatus(next);
    setPage(1);
  }, []);

  const handleClearAllFilters = useCallback(() => {
    setStatus('all');
    setPage(1);
  }, []);

  const activeFilterCount = status !== 'all';

  // ───── Mutations ─────────────────────────────────────────────────
  const terminateMutation = useMutation({
    mutationFn: (id: string | number) => OrgAuditService.terminateSession(id),
    onSuccess: () => {
      toastSuccess('Sesión terminada');
      setPendingTerminate(null);
      setSelected(null);
      queryClient.invalidateQueries({ queryKey: ['org-audit-sessions'] });
    },
    onError: () => toastError('No se pudo terminar la sesión'),
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <View style={styles.root}>
      <FlatList<ActiveSession>
        data={sessions}
        keyExtractor={(s) => String(s.id)}
        ListHeaderComponent={
          <ListHeader
            count={total}
            activeCount={activeCount}
            inactiveCount={inactiveCount}
            onActionsPress={() => setActionsModalOpen(true)}
            filterConfigs={filterConfigs}
            filterValues={filterValues}
            onFilterChange={handleFilterChange}
            onClearAllFilters={handleClearAllFilters}
            activeFilterCount={activeFilterCount}
          />
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : status !== 'all' ? (
            <EmptyState
              icon="filter"
              title="Sin sesiones con este filtro"
              description="Cambia el filtro de estado para ver más sesiones."
              actionLabel="Mostrar todas"
              onAction={handleClearAllFilters}
            />
          ) : (
            <EmptyState
              icon="monitor"
              title="Sin sesiones registradas"
              description="Las sesiones de usuarios aparecerán aquí cuando inicien sesión."
            />
          )
        }
        renderItem={({ item }) => {
          const active = isSessionActive(item);
          const cardActions: OrgCardAction[] = [
            {
              key: 'view',
              label: 'Ver detalle',
              icon: 'eye',
              variant: 'primary',
              showInFooter: true,
              onPress: () => setSelected(item),
            },
            ...(active
              ? [
                  {
                    key: 'terminate',
                    label: 'Terminar',
                    icon: 'x-circle',
                    variant: 'danger' as const,
                    destructive: true,
                    onPress: () => setPendingTerminate(item),
                  },
                ]
              : []),
          ];
          return (
            <OrgResponsiveCard
              title={formatSessionUser(item)}
              subtitle={[
                getDeviceIcon(item.device) === 'smartphone' ? 'Móvil' : 'Escritorio',
                item.location ?? item.ip_address,
              ]
                .filter(Boolean)
                .join(' · ')}
              leftIcon={getDeviceIcon(item.device)}
              leftIconColor={active ? colorScales.green[500] : colorScales.gray[400]}
              badge={
                item.is_current
                  ? { label: 'Actual', variant: 'primary' }
                  : active
                    ? { label: 'Activa', variant: 'success' }
                    : { label: 'Inactiva', variant: 'muted' }
              }
              details={[
                { label: 'IP', value: item.ip_address ?? '—', icon: 'globe', monospace: true },
                {
                  label: 'Última actividad',
                  value: new Date(
                    item.last_active_at ?? item.last_activity ?? item.created_at,
                  ).toLocaleString(),
                  icon: 'clock',
                },
                {
                  label: 'Expira',
                  value: new Date(item.expires_at).toLocaleString(),
                  icon: 'hourglass',
                },
              ]}
              footerLabel="Estado"
              footerValue={
                item.is_current
                  ? 'Sesión actual'
                  : active
                    ? 'Sesión activa'
                    : 'Sesión inactiva'
              }
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

      {/* Detail modal — centrado (espejo de app-modal web) */}
      <OrgCenteredModal
        visible={!!selected}
        onClose={() => setSelected(null)}
        title="Detalle de sesión"
        size="md"
        footer={
          isSessionActive(selected ?? undefined as any) ? (
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalBtn, styles.modalBtnSecondary]}
                onPress={() => setSelected(null)}
              >
                <Text style={styles.modalBtnSecondaryText}>Cerrar</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, styles.modalBtnDanger]}
                onPress={() => selected && setPendingTerminate(selected)}
              >
                <Text style={styles.modalBtnDangerText}>Terminar sesión</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalBtn, styles.modalBtnSecondary, { flex: 1 }]}
                onPress={() => setSelected(null)}
              >
                <Text style={styles.modalBtnSecondaryText}>Cerrar</Text>
              </Pressable>
            </View>
          )
        }
      >
        {selected ? (
          <View>
            <View style={styles.detailHero}>
              <View
                style={[
                  styles.detailHeroIcon,
                  {
                    backgroundColor: isSessionActive(selected)
                      ? colorScales.green[100]
                      : colorScales.gray[100],
                  },
                ]}
              >
                <Icon
                  name={getDeviceIcon(selected.device)}
                  size={22}
                  color={
                    isSessionActive(selected)
                      ? colorScales.green[700]
                      : colorScales.gray[500]
                  }
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.detailHeroTitle}>{formatSessionUser(selected)}</Text>
                <Text style={styles.detailHeroSub}>
                  {selected.is_current
                    ? 'Sesión actual'
                    : isSessionActive(selected)
                      ? 'Sesión activa'
                      : 'Sesión inactiva'}
                </Text>
              </View>
            </View>

            <View style={styles.card}>
              <OrgDetailRow icon="user" label="Usuario" value={formatSessionUser(selected)} />
              {selected.users?.email ? (
                <OrgDetailRow icon="mail" label="Email" value={selected.users.email} />
              ) : null}
              <OrgDetailRow
                icon="globe"
                label="IP"
                value={selected.ip_address ?? 'N/A'}
                monospace
              />
              <OrgDetailRow
                icon="monitor"
                label="Dispositivo"
                value={selected.device ?? selected.user_agent ?? 'N/A'}
              />
              <OrgDetailRow
                icon="map-pin"
                label="Ubicación"
                value={selected.location ?? 'N/A'}
              />
              <OrgDetailRow
                icon="clock"
                label="Última actividad"
                value={
                  selected.last_active_at
                    ? new Date(selected.last_active_at).toLocaleString()
                    : selected.last_activity
                      ? new Date(selected.last_activity).toLocaleString()
                      : 'N/A'
                }
              />
              <OrgDetailRow
                icon="calendar"
                label="Creada"
                value={new Date(selected.created_at).toLocaleString()}
              />
              <OrgDetailRow
                icon="hourglass"
                label="Expira"
                value={new Date(selected.expires_at).toLocaleString()}
              />
            </View>
          </View>
        ) : null}
      </OrgCenteredModal>

      {/* Confirm terminate — centrado */}
      <OrgCenteredModal
        visible={!!pendingTerminate}
        onClose={() => !terminateMutation.isPending && setPendingTerminate(null)}
        title="Terminar sesión"
        size="sm"
        footer={
          <View style={styles.modalActions}>
            <Pressable
              style={[styles.modalBtn, styles.modalBtnSecondary]}
              disabled={terminateMutation.isPending}
              onPress={() => setPendingTerminate(null)}
            >
              <Text style={styles.modalBtnSecondaryText}>Cancelar</Text>
            </Pressable>
            <Pressable
              style={[
                styles.modalBtn,
                styles.modalBtnDanger,
                terminateMutation.isPending && styles.modalBtnDisabled,
              ]}
              disabled={terminateMutation.isPending}
              onPress={() => pendingTerminate && terminateMutation.mutate(pendingTerminate.id)}
            >
              <Text style={styles.modalBtnDangerText}>
                {terminateMutation.isPending ? 'Terminando…' : 'Sí, terminar'}
              </Text>
            </Pressable>
          </View>
        }
      >
        <Text style={styles.confirmText}>
          ¿Terminar la sesión de{' '}
          {pendingTerminate ? formatSessionUser(pendingTerminate) : ''}?
        </Text>
        <Text style={styles.confirmHint}>
          El usuario será desconectado y deberá volver a iniciar sesión.
        </Text>
      </OrgCenteredModal>

      {/* ── Actions Modal — espejo del patrón users/stores/domains/logs ── */}
      <OrgCenteredModal
        visible={actionsModalOpen}
        onClose={() => setActionsModalOpen(false)}
        title="Acciones"
        subtitle="¿Qué quieres hacer con la lista de sesiones?"
        size="sm"
      >
        <View style={styles.actionsModalList}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colorScales.gray[50],
    paddingHorizontal: spacing[4],
  },
  loading: { paddingVertical: spacing[12], alignItems: 'center' },
  separator: { height: spacing[3] },
  listContent: {
    paddingTop: spacing[2],
    paddingBottom: spacing[24],
  },

  // ── Stats wrap (mismo patrón users/stores/domains/logs) ─────────
  statsWrap: {
    marginHorizontal: -spacing[4],
    marginBottom: spacing[3],
  },

  // ── Table card header (paridad 1:1 con users/stores/domains/logs) ─
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
  tableTitleCount: {
    fontFamily: interFonts.regular,
    color: colorScales.gray[400],
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing[2],
  },
  // Espejo del `.options-dropdown-trigger` web mobile responsive.
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

  // ── Actions Modal (espejo del `<app-options-dropdown>` web) ────
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

  // ── Detail modal styles ─────────────────────────────────────
  detailHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginBottom: spacing[4],
  },
  detailHeroIcon: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailHeroTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  detailHeroSub: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  card: {
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[100],
    paddingHorizontal: spacing[3],
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing[2],
    justifyContent: 'flex-end',
  },
  modalBtn: {
    height: 40,
    paddingHorizontal: spacing[4],
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnSecondary: { backgroundColor: colorScales.gray[100] },
  modalBtnSecondaryText: { color: colorScales.gray[700], fontWeight: typography.fontWeight.semibold },
  modalBtnDanger: { backgroundColor: colorScales.red[600] },
  modalBtnDangerText: { color: '#FFFFFF', fontWeight: typography.fontWeight.semibold },
  modalBtnDisabled: { opacity: 0.6 },
  confirmText: {
    fontSize: typography.fontSize.base,
    color: colorScales.gray[800],
    marginBottom: spacing[2],
  },
  confirmHint: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginBottom: spacing[4],
  },
});
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
import { OrgAuditService } from '@/features/org/services/org-audit.service';
import { OrgStatsGrid } from '@/shared/components/org-stats-grid';
import {
  OrgResponsiveCard,
  type OrgCardAction,
} from '@/shared/components/org-responsive-card';
import {
  OrgOptionsDropdown,
  type OrgOptionsAction,
} from '@/shared/components/org-options-dropdown';
import { OrgCenteredModal } from '@/shared/components/org-centered-modal';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { OrgDetailRow } from '@/shared/components/org-detail-row';
import { Icon } from '@/shared/components/icon/icon';
import { PaginationBar } from '@/features/org/components/audit-shared';
import {
  formatSessionUser,
  getDeviceIcon,
  isSessionActive,
} from '@/features/org/components/audit-formatters';
import type { ActiveSession } from '@/core/models/org-admin/audit.types';
import { borderRadius, colorScales, colors, spacing, typography } from '@/shared/theme';
import { toastError, toastSuccess } from '@/shared/components/toast/toast.store';

/**
 * Auditoría · Sesiones (paridad visual con web).
 *
 * Layout: stats sticky top, title row sticky, cards scroll, modal centered.
 */

const PAGE_SIZE = 10;
type StatusFilter = 'all' | 'active' | 'inactive';

export default function SessionsScreen() {
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<ActiveSession | null>(null);
  const [pendingTerminate, setPendingTerminate] = useState<ActiveSession | null>(null);

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

  const activeFiltersCount = status === 'all' ? 0 : 1;
  const actions: OrgOptionsAction[] = [
    { key: 'refresh', label: 'Actualizar', icon: 'refresh-cw', onPress: onRefresh },
  ];

  return (
    <View style={styles.root}>
      {/* Sticky top: stats grid */}
      <View style={styles.stickyStats}>
        <OrgStatsGrid
          stats={[
            {
              label: 'Total Sesiones',
              value: total,
              icon: 'monitor',
              color: colorScales.blue[600],
              subText: 'sesiones registradas',
            },
            {
              label: 'Activas',
              value: activeCount,
              icon: 'check-circle',
              color: colorScales.green[600],
              subText: 'sesiones activas',
            },
            {
              label: 'Inactivas',
              value: inactiveCount,
              icon: 'x-circle',
              color: colorScales.red[600],
              subText: 'sesiones terminadas',
            },
          ]}
        />
      </View>

      {/* Sticky below: title row + options dropdown */}
      <View style={styles.stickyTitleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.titleMain}>
            Sesiones{' '}
            <Text style={styles.titleCount}>({total})</Text>
          </Text>
        </View>
        <OrgOptionsDropdown
          actions={actions}
          activeFiltersCount={activeFiltersCount}
          renderFiltersContent={() => (
            <View>
              <FilterSection
                label="Todas"
                value="Mostrar todas las sesiones"
                active={status === 'all'}
                onPress={() => {
                  setStatus('all');
                  setPage(1);
                }}
              />
              <FilterSection
                label="Activas"
                value="Sólo sesiones con is_active=true"
                active={status === 'active'}
                onPress={() => {
                  setStatus('active');
                  setPage(1);
                }}
              />
              <FilterSection
                label="Inactivas"
                value="Sólo sesiones terminadas o expiradas"
                active={status === 'inactive'}
                onPress={() => {
                  setStatus('inactive');
                  setPage(1);
                }}
              />
            </View>
          )}
        />
      </View>

      {/* Scrollable list */}
      <FlatList<ActiveSession>
        data={sessions}
        keyExtractor={(s) => String(s.id)}
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
              onAction={() => {
                setStatus('all');
                setPage(1);
              }}
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
                {
                  label: 'IP',
                  value: item.ip_address ?? '—',
                  icon: 'globe',
                  monospace: true,
                },
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
        style={styles.flatList}
      />

      {/* Detail modal — centered (espejo de app-modal web) */}
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

      {/* Confirm terminate — centered */}
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
    </View>
  );
}

function FilterSection({
  label,
  value,
  active,
  onPress,
}: {
  label: string;
  value: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.filterSection, active && styles.filterSectionActive]}
      onPress={onPress}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.filterLabel}>{label}</Text>
        <Text style={styles.filterValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
      {active ? (
        <Icon name="check" size={16} color={colorScales.green[600]} />
      ) : (
        <Icon name="chevron-right" size={16} color={colorScales.gray[400]} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colorScales.gray[50] },
  loading: { paddingVertical: spacing[12], alignItems: 'center' },
  stickyStats: {
    backgroundColor: colorScales.gray[50],
    paddingBottom: spacing[2],
  },
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
  flatList: { flex: 1 },
  separator: { height: spacing[3] },
  listContent: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[24],
  },
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
  filterSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  filterSectionActive: {
    backgroundColor: colorScales.green[50],
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
});

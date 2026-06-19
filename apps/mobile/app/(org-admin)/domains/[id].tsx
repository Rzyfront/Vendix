import { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, RefreshControl, Alert, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { OrgDomainsService } from '@/features/org/services/org-domains.service';
import type { Domain } from '@/core/models/org-admin/domains.types';
import { PENDING_PROVISIONING_STATUSES } from '@/core/models/org-admin/domains.types';
import {
  formatAppType,
  formatOwnership,
  formatSslStatus,
  formatStatus,
  getSslStatusColor,
  getStatusColor,
} from '@/features/org/components/domain-formatters';
import { DomainDeleteModal } from '@/features/org/components/domain-delete-modal';
import { DomainEditModal } from '@/features/org/components/domain-edit-modal';
import { DomainVerifyModal } from '@/features/org/components/domain-verify-modal';
import { Icon } from '@/shared/components/icon/icon';
import { Spinner } from '@/shared/components/spinner/spinner';
import { borderRadius, colorScales, colors, shadows, spacing, typography } from '@/shared/theme';
import { toastError, toastSuccess } from '@/shared/components/toast/toast.store';

/**
 * Pantalla de detalle de un dominio (ORG_ADMIN Dominios).
 *
 * Espejo del detail panel en `domains.component.ts` de la web:
 *   - Sticky header con hostname + badge de estado + botón "atrás".
 *   - Card principal con info de configuración (root, subdominio,
 *     ownership, app_type, tienda, fechas).
 *   - Card de estado de aprovisionamiento (SSL + CloudFront + verificaciones).
 *   - Acciones: Verificar DNS, Editar, Renovar SSL, Eliminar.
 *   - Polling cada 15s mientras el dominio esté en estado de aprovisionamiento.
 */
export default function DomainDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [verifyOpen, setVerifyOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data: domain, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['org-domain', id],
    queryFn: () => OrgDomainsService.get(id!),
    enabled: !!id,
    refetchInterval: (query) => {
      const d = query.state.data as Domain | undefined;
      return d && PENDING_PROVISIONING_STATUSES.has(d.status) ? 15000 : false;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => OrgDomainsService.remove(domain!.hostname),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-domains-list'] });
      queryClient.invalidateQueries({ queryKey: ['org-domains-stats'] });
      toastSuccess('Dominio eliminado');
      router.back();
    },
    onError: () => toastError('No se pudo eliminar el dominio'),
  });

  const renewSslMutation = useMutation({
    mutationFn: () => OrgDomainsService.renewSsl(domain!.id),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['org-domain', id] });
      if (r.renewed) {
        toastSuccess('Certificado SSL renovado');
      } else {
        toastError(r.message ?? 'No se pudo renovar el certificado');
      }
    },
    onError: () => toastError('Error al renovar SSL'),
  });

  if (isLoading || !domain) {
    return (
      <View style={styles.loadingContainer}>
        <Spinner size="large" />
      </View>
    );
  }

  const statusColor = getStatusColor(domain.status);
  const sslColor = domain.ssl_status ? getSslStatusColor(domain.ssl_status) : colorScales.gray[400];
  const canVerify =
    domain.ownership === 'CUSTOM_DOMAIN' || domain.ownership === 'CUSTOM_SUBDOMAIN';
  const canRenewSsl = !!domain.certificate_id && domain.status !== 'FAILED_CERTIFICATE';

  return (
    <View style={styles.root}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* Sticky header */}
        <View style={styles.stickyHeader}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Icon name="arrow-left" size={20} color={colorScales.gray[700]} />
          </Pressable>
          <View style={styles.headerInfo}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {domain.hostname}
            </Text>
            <View style={styles.headerSub}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Text style={styles.headerSubText}>{formatStatus(domain.status)}</Text>
              {domain.is_primary ? (
                <View style={styles.primaryPill}>
                  <Icon name="star" size={10} color={colorScales.amber[700]} />
                  <Text style={styles.primaryPillText}>Principal</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        {/* Config card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Configuración</Text>
          <View style={styles.infoGrid}>
            <InfoRow icon="layers" label="Dominio raíz" value={domain.root_domain} />
            {domain.subdomain ? (
              <InfoRow icon="git-branch" label="Subdominio" value={domain.subdomain} />
            ) : null}
            <InfoRow icon="tag" label="Propiedad" value={formatOwnership(domain.ownership)} />
            <InfoRow icon="app-window" label="App destino" value={formatAppType(domain.app_type)} />
            <InfoRow
              icon="building"
              label="Tienda"
              value={domain.store?.name ?? 'Organización (sin tienda)'}
            />
            {domain.verified_at ? (
              <InfoRow
                icon="check-circle"
                label="Verificado el"
                value={formatDateLong(domain.verified_at)}
              />
            ) : null}
            <InfoRow
              icon="calendar"
              label="Creado el"
              value={formatDateLong(domain.created_at)}
            />
            {domain.expires_at ? (
              <InfoRow icon="clock" label="Expira el" value={formatDateLong(domain.expires_at)} />
            ) : null}
          </View>
        </View>

        {/* Provisioning status card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Aprovisionamiento</Text>

          <ProvisionRow
            label="Estado del dominio"
            color={statusColor}
            value={formatStatus(domain.status)}
          />
          <ProvisionRow
            label="SSL"
            color={sslColor}
            value={domain.ssl_status ? formatSslStatus(domain.ssl_status) : 'Sin SSL'}
          />
          {domain.cloudfront_status ? (
            <ProvisionRow
              label="CloudFront"
              color={getStatusColor(domain.cloudfront_status as any)}
              value={domain.cloudfront_status}
            />
          ) : null}
          <ProvisionRow
            label="Propiedad verificada"
            color={domain.is_verified ? colors.success : colorScales.gray[400]}
            value={domain.is_verified ? 'Sí' : 'No'}
          />
          {domain.last_verified_at ? (
            <ProvisionRow
              label="Última verificación"
              color={colorScales.gray[500]}
              value={formatDateLong(domain.last_verified_at)}
            />
          ) : null}

          {domain.verification_records?.length ? (
            <View style={styles.dnsBlock}>
              <Text style={styles.dnsBlockTitle}>Registros DNS configurados</Text>
              <View style={styles.dnsTable}>
                <View style={[styles.dnsRow, styles.dnsHeaderRow]}>
                  <Text style={[styles.dnsCell, styles.dnsCellType]}>Tipo</Text>
                  <Text style={[styles.dnsCell, styles.dnsCellHost]}>Host</Text>
                  <Text style={[styles.dnsCell, styles.dnsCellValue]}>Valor</Text>
                </View>
                {domain.verification_records.map((r, i) => (
                  <View key={i} style={styles.dnsRow}>
                    <Text style={[styles.dnsCell, styles.dnsCellType, styles.mono]}>{r.type}</Text>
                    <Text style={[styles.dnsCell, styles.dnsCellHost, styles.mono]} numberOfLines={1}>
                      {r.host}
                    </Text>
                    <Text style={[styles.dnsCell, styles.dnsCellValue, styles.mono]} numberOfLines={2}>
                      {r.value}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </View>

        <View style={{ height: spacing[24] }} />
      </ScrollView>

      {/* Floating action bar */}
      <View style={styles.actionBar}>
        {canVerify ? (
          <ActionBtn
            icon="shield-check"
            label="Verificar"
            variant="primary"
            onPress={() => setVerifyOpen(true)}
            style={{ flex: 1 }}
          />
        ) : null}
        <ActionBtn
          icon="edit"
          label="Editar"
          variant="outline"
          onPress={() => setEditOpen(true)}
          style={{ flex: 1 }}
        />
        <ActionBtn
          icon="refresh-cw"
          label="SSL"
          variant="outline"
          onPress={() => {
            Alert.alert(
              'Renovar SSL',
              '¿Iniciar la renovación del certificado SSL ahora?',
              [
                { text: 'Cancelar', style: 'cancel' },
                {
                  text: 'Renovar',
                  onPress: () => renewSslMutation.mutate(),
                },
              ],
            );
          }}
          loading={renewSslMutation.isPending}
          disabled={!canRenewSsl}
          style={{ flex: 1 }}
        />
        <ActionBtn
          icon="trash-2"
          label="Eliminar"
          variant="destructive"
          onPress={() => setDeleteOpen(true)}
          style={{ flex: 1 }}
        />
      </View>

      <DomainVerifyModal
        visible={verifyOpen}
        domain={domain}
        onClose={() => setVerifyOpen(false)}
        onVerified={(verified) => {
          queryClient.setQueryData(['org-domain', id], verified);
          refetch();
        }}
      />
      <DomainEditModal
        visible={editOpen}
        domain={domain}
        onClose={() => setEditOpen(false)}
        onUpdated={(updated) => {
          queryClient.setQueryData(['org-domain', id], updated);
          queryClient.invalidateQueries({ queryKey: ['org-domains-list'] });
          toastSuccess('Dominio actualizado');
        }}
      />
      <DomainDeleteModal
        visible={deleteOpen}
        hostname={domain.hostname}
        isPrimary={domain.is_primary}
        loading={deleteMutation.isPending}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          if (!domain.is_primary) {
            deleteMutation.mutate();
          } else {
            setDeleteOpen(false);
          }
        }}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponentes
// ─────────────────────────────────────────────────────────────────────────────

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIcon}>
        <Icon name={icon} size={16} color={colorScales.gray[500]} />
      </View>
      <View style={styles.infoBody}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

function ProvisionRow({ label, color, value }: { label: string; color: string; value: string }) {
  return (
    <View style={styles.provisionRow}>
      <View style={styles.provisionLeft}>
        <View style={[styles.provisionDot, { backgroundColor: color }]} />
        <Text style={styles.provisionLabel}>{label}</Text>
      </View>
      <Text style={styles.provisionValue}>{value}</Text>
    </View>
  );
}

function ActionBtn({
  icon,
  label,
  variant,
  onPress,
  loading,
  disabled,
  style,
}: {
  icon: string;
  label: string;
  variant: 'primary' | 'outline' | 'destructive';
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  style?: any;
}) {
  const bg =
    variant === 'primary'
      ? colors.primary
      : variant === 'destructive'
      ? colors.error
      : colors.background;
  const fg = variant === 'outline' ? colorScales.gray[800] : '#FFFFFF';
  const borderColor = variant === 'outline' ? colorScales.gray[300] : bg;
  return (
    <Pressable
      style={[styles.actionBtn, { backgroundColor: bg, borderColor, opacity: disabled ? 0.5 : 1 }, style]}
      onPress={onPress}
      disabled={disabled || loading}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <>
          <Icon name={icon} size={14} color={fg} />
          <Text style={[styles.actionText, { color: fg }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDateLong(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-CO', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colorScales.gray[50] },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colorScales.gray[50],
  },
  stickyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
    gap: spacing[3],
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerInfo: { flex: 1 },
  headerTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  headerSub: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: 2,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  headerSubText: { fontSize: typography.fontSize.xs, color: colorScales.gray[600] },
  primaryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing[2],
    paddingVertical: 1,
    borderRadius: borderRadius.full,
    backgroundColor: colorScales.amber[100],
  },
  primaryPillText: {
    fontSize: 10,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.amber[700],
  },
  card: {
    backgroundColor: colors.background,
    padding: spacing[4],
    marginTop: spacing[2],
  },
  cardTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
    marginBottom: spacing[3],
  },
  infoGrid: { gap: spacing[3] },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  infoIcon: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.full,
    backgroundColor: colorScales.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoBody: { flex: 1 },
  infoLabel: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
  },
  infoValue: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
    marginTop: 1,
  },
  provisionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  provisionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  provisionDot: { width: 8, height: 8, borderRadius: 4 },
  provisionLabel: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[700],
  },
  provisionValue: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
  },
  dnsBlock: { marginTop: spacing[4] },
  dnsBlockTitle: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[600],
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: spacing[2],
  },
  dnsTable: {
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  dnsRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  dnsHeaderRow: { backgroundColor: colorScales.gray[50] },
  dnsCell: {
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[800],
  },
  dnsCellType: { width: 56 },
  dnsCellHost: { flex: 1 },
  dnsCellValue: { flex: 2 },
  mono: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  actionBar: {
    flexDirection: 'row',
    gap: spacing[2],
    padding: spacing[3],
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    ...shadows.md,
  },
  actionBtn: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  actionText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
  },
});

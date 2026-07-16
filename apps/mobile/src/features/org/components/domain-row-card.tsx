import { View, Text, StyleSheet } from 'react-native';
import { Card } from '@/shared/components/card/card';
import { Icon } from '@/shared/components/icon/icon';
import { RowActionsMenu, type RowAction } from '@/shared/components/row-actions-menu/row-actions-menu';
import {
  formatAppType,
  formatOwnership,
  formatSslStatus,
  formatStatus,
  getAppTypeColor,
  getOwnershipColor,
  getSslStatusColor,
  getStatusColor,
} from './domain-formatters';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import type { Domain } from '@/core/models/org-admin/domains.types';

interface DomainRowCardProps {
  domain: Domain;
  /** Acciones que se exponen en el menú 3 puntos. Si viene vacío, no se muestra el botón. */
  actions?: RowAction[];
}

/**
 * Card de dominio para la lista de ORG_ADMIN.
 *
 * Espejo del `cardConfig` de la web (ResponsiveDataView en mobile):
 *   - Title: hostname
 *   - Subtitle: store name (o "Organización" si null)
 *   - Status badge + Primario indicator al costado
 *   - Fila de badges inline: app_type + ownership + ssl_status
 *   - Footer con fecha de creación
 *   - Menú 3 puntos a la derecha con las acciones recibidas por props
 *
 * El componente es presentacional: la pantalla padre decide qué acciones
 * pasan según estado del dominio (e.g. "Provisionar" solo si
 * `canProvisionDomain(domain)`).
 */
export function DomainRowCard({ domain, actions = [] }: DomainRowCardProps) {
  const statusColor = getStatusColor(domain.status);
  const statusLabel = formatStatus(domain.status);
  const subtitle = domain.store?.name ?? 'Organización';

  return (
    <Card style={styles.card}>
      {/* Header: avatar + title + acciones */}
      <View style={styles.header}>
        <View style={[styles.avatar, { backgroundColor: statusColor + '15' }]}>
          <Icon name="globe" size={18} color={statusColor} />
        </View>
        <View style={styles.headerBody}>
          <View style={styles.headerTopRow}>
            <Text style={styles.hostname} numberOfLines={1}>
              {domain.hostname}
            </Text>
            {domain.is_primary ? (
              <View style={styles.primaryPill}>
                <Icon name="star" size={10} color={colorScales.amber[700]} />
                <Text style={styles.primaryPillText}>Pri</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.headerSubRow}>
            <Icon name="building" size={11} color={colorScales.gray[400]} />
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
        </View>
        {actions.length > 0 ? (
          <RowActionsMenu actions={actions} accessibilityLabel={`Acciones para ${domain.hostname}`} />
        ) : null}
      </View>

      {/* Status badge */}
      <View style={styles.statusRow}>
        <View style={[styles.statusBadge, { backgroundColor: statusColor + '15' }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
        {domain.is_verified ? (
          <View style={styles.verifiedPill}>
            <Icon name="check-circle-2" size={11} color={colors.success} />
            <Text style={styles.verifiedText}>Verificado</Text>
          </View>
        ) : null}
      </View>

      {/* Inline badges */}
      <View style={styles.badgesRow}>
        <InlineBadge label={formatAppType(domain.app_type)} color={getAppTypeColor(domain.app_type)} />
        <InlineBadge label={formatOwnership(domain.ownership)} color={getOwnershipColor(domain.ownership)} />
        {domain.ssl_status ? (
          <InlineBadge
            label={`SSL ${formatSslStatus(domain.ssl_status)}`}
            color={getSslStatusColor(domain.ssl_status)}
          />
        ) : null}
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Icon name="calendar" size={11} color={colorScales.gray[400]} />
        <Text style={styles.footerText}>
          Creado {formatDateShort(domain.created_at)}
        </Text>
        {domain.verified_at ? (
          <>
            <View style={styles.footerSep} />
            <Icon name="shield-check" size={11} color={colorScales.gray[400]} />
            <Text style={styles.footerText}>
              Verificado {formatDateShort(domain.verified_at)}
            </Text>
          </>
        ) : null}
      </View>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponentes
// ─────────────────────────────────────────────────────────────────────────────

function InlineBadge({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: color + '15' }]}>
      <View style={[styles.badgeDot, { backgroundColor: color }]} />
      <Text style={[styles.badgeText, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDateShort(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-CO', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing[3],
    padding: spacing[3],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBody: { flex: 1, minWidth: 0 },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  hostname: {
    flex: 1,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
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
  headerSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    marginTop: 2,
  },
  subtitle: {
    flex: 1,
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[3],
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
  },
  verifiedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    backgroundColor: colorScales.green[100],
  },
  verifiedText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colors.success,
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
    marginTop: spacing[3],
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: {
    fontSize: 11,
    fontWeight: typography.fontWeight.semibold,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing[3],
    paddingTop: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
  },
  footerText: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
  },
  footerSep: {
    width: 1,
    height: 10,
    backgroundColor: colorScales.gray[300],
    marginHorizontal: spacing[2],
  },
});

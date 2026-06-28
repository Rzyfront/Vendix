import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { OrgCenteredModal } from '@/shared/components/org-centered-modal';
import { Button } from '@/shared/components/button/button';
import { formatCurrency } from '@/shared/utils/currency';
import {
  CashRegisterService,
  type CashRegisterSession,
} from '../services/cash-register.service';

interface PosCashDetailModalProps {
  visible: boolean;
  onClose: () => void;
  session: CashRegisterSession | null;
}

const STATUS_META = {
  open: { label: 'Abierta', color: colorScales.blue[600] },
  closed: { label: 'Cerrada', color: colorScales.green[600] },
  suspended: { label: 'Suspendida', color: colorScales.amber[600] },
} as const;

function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-CO', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatTimeOnly(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return iso;
  }
}

function getMovementIcon(type: string): string {
  const icons: Record<string, string> = {
    opening_balance: 'unlock',
    closing_balance: 'lock',
    sale: 'shopping-cart',
    refund: 'rotate-ccw',
    cash_in: 'trending-up',
    cash_out: 'trending-down',
  };
  return icons[type] || 'circle';
}

function getMovementColor(type: string): string {
  const colorsMap: Record<string, string> = {
    opening_balance: '#10B981',
    closing_balance: '#10B981',
    sale: '#10B981',
    refund: colorScales.red[600],
    cash_in: colorScales.blue[600],
    cash_out: colorScales.amber[600],
  };
  return colorsMap[type] || colorScales.gray[600];
}

function getMovementBg(type: string): string {
  const bgsMap: Record<string, string> = {
    opening_balance: 'rgba(16, 185, 129, 0.1)',
    closing_balance: 'rgba(16, 185, 129, 0.1)',
    sale: 'rgba(16, 185, 129, 0.1)',
    refund: 'rgba(239, 68, 68, 0.1)',
    cash_in: 'rgba(59, 130, 246, 0.1)',
    cash_out: 'rgba(245, 158, 11, 0.1)',
  };
  return bgsMap[type] || colorScales.gray[100];
}

function getMovementLabel(type: string): string {
  const labels: Record<string, string> = {
    opening_balance: 'Apertura de caja',
    closing_balance: 'Cierre de caja',
    sale: 'Venta',
    refund: 'Reembolso',
    cash_in: 'Entrada de efectivo',
    cash_out: 'Salida de efectivo',
  };
  return labels[type] || type;
}

function isPositiveMovement(type: string): boolean {
  return ['opening_balance', 'closing_balance', 'sale', 'cash_in'].includes(type);
}

function renderMarkdown(text: string) {
  if (!text) return null;
  const lines = text.split('\n');
  return lines.map((line, idx) => {
    let cleanLine = line.trim();
    if (!cleanLine) return null;

    let isBullet = false;
    if (cleanLine.startsWith('* ') || cleanLine.startsWith('- ')) {
      isBullet = true;
      cleanLine = cleanLine.substring(2);
    }

    // Process bold (**text**)
    const parts = cleanLine.split('**');
    const nodes = parts.map((part, pIdx) => {
      const isBold = pIdx % 2 === 1;
      return (
        <Text key={pIdx} style={isBold ? { fontWeight: 'bold' } : undefined}>
          {part}
        </Text>
      );
    });

    if (isBullet) {
      return (
        <View key={idx} style={styles.markdownBulletRow}>
          <Text style={styles.markdownBulletDot}>•</Text>
          <Text style={styles.markdownBulletText}>{nodes}</Text>
        </View>
      );
    }

    return (
      <Text key={idx} style={styles.markdownParagraph}>
        {nodes}
      </Text>
    );
  });
}

/**
 * Modal "Detalle de Caja" — paridad con `pos-session-detail-modal.component.ts` web.
 *
 * Lee `getSession(id)` para obtener summary completo y `getMovements(id)` para
 * la lista. Muestra: header (cajero, fechas, estado), métricas (apertura,
 * ventas, entradas, salidas, esperado, diferencia), lista de movimientos.
 */
export function PosCashDetailModal({ visible, onClose, session }: PosCashDetailModalProps) {
  const sessionId = session?.id ?? null;

  const { data: fullSession, isLoading: loadingSession } = useQuery({
    queryKey: ['cash-session-detail', sessionId],
    queryFn: () => CashRegisterService.getSession(sessionId!),
    enabled: visible && sessionId != null,
  });

  const { data: movements = [], isLoading: loadingMovs } = useQuery({
    queryKey: ['cash-movements', sessionId],
    queryFn: () => CashRegisterService.getMovements(sessionId!),
    enabled: visible && sessionId != null,
  });

  const s = fullSession ?? session;
  const statusMeta = s ? STATUS_META[s.status] : null;

  const totalSales = useMemo(() => {
    return movements
      .filter((m) => m.type === 'sale')
      .reduce((sum, m) => sum + Number(m.amount), 0);
  }, [movements]);

  const totalRefunds = useMemo(() => {
    return movements
      .filter((m) => m.type === 'refund')
      .reduce((sum, m) => sum + Number(m.amount), 0);
  }, [movements]);

  return (
    <OrgCenteredModal
      visible={visible}
      onClose={onClose}
      title={s?.register?.name ?? 'Caja'}
      subtitle={s ? `Sesión #${s.id}` : undefined}
      size="lg"
      footer={
        <View style={{ alignItems: 'flex-end', width: '100%' }}>
          <Button
            title="Cerrar"
            variant="primary"
            size="md"
            style={{
              backgroundColor: '#0F2A1D', // Verde muy oscuro idéntico a la web
              borderRadius: borderRadius.lg,
              paddingHorizontal: spacing[6],
              height: 40,
            }}
            onPress={onClose}
          />
        </View>
      }
    >
      {loadingSession ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : !s ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>Sin información de la sesión</Text>
        </View>
      ) : (
        <>
          {/* Info session - styled as a card matching web session-header-details */}
          <View style={styles.sessionDetailsCard}>
            <View style={styles.sessionDetailsRow}>
              <View style={styles.sessionDetailsCol}>
                <Text style={styles.infoLabelText}>
                  Cajero:{' '}
                  <Text style={styles.infoValueText}>
                    {s.opened_by_user
                      ? `${s.opened_by_user.first_name} ${s.opened_by_user.last_name}`
                      : 'Vendix Demo'}
                  </Text>
                </Text>
                <Text style={[styles.infoLabelText, { marginTop: spacing[2] }]}>
                  Cierre:{' '}
                  <Text style={styles.infoValueText}>
                    {s.closed_at ? formatDateTime(s.closed_at) : '—'}
                  </Text>
                </Text>
              </View>
              <View style={styles.sessionDetailsCol}>
                <Text style={styles.infoLabelText}>
                  Apertura:{' '}
                  <Text style={styles.infoValueText}>
                    {formatDateTime(s.opened_at)}
                  </Text>
                </Text>
                <Text style={[styles.infoLabelText, { marginTop: spacing[2] }]}>
                  Diferencia:{' '}
                  <Text
                    style={[
                      styles.infoValueText,
                      s.difference != null && {
                        fontWeight: 'bold',
                        color: s.difference === 0
                          ? colorScales.green[600]
                          : s.difference > 0
                            ? colorScales.blue[600]
                            : colorScales.red[600],
                      },
                    ]}
                  >
                    {s.difference != null
                      ? `${s.difference > 0 ? '+' : ''}${formatCurrency(s.difference)}`
                      : '—'}
                  </Text>
                </Text>
              </View>
            </View>
          </View>

          {/* Metrics - matching web cards (Apertura, Ventas, Reembolsos, Movimientos) */}
          <View style={styles.metricsGrid}>
            <MetricBox
              label="Apertura"
              value={formatCurrency(s.opening_amount)}
              bg="#FFFFFF"
              borderColor={colorScales.gray[200]}
              textColor={colorScales.gray[600]}
            />
            <MetricBox
              label="Ventas"
              value={formatCurrency(totalSales)}
              bg="#ECFDF5"
              borderColor="#A7F3D0"
              textColor="#047857"
            />
            <MetricBox
              label="Reembolsos"
              value={formatCurrency(totalRefunds)}
              bg="#FEF2F2"
              borderColor="#FCA5A5"
              textColor="#B91C1C"
            />
            <MetricBox
              label="Movimientos"
              value={String(movements.length)}
              bg="#EFF6FF"
              borderColor="#BFDBFE"
              textColor="#1D4ED8"
            />
          </View>

          {/* AI Summary Section */}
          <View style={styles.aiSummaryContainer}>
            <View style={styles.aiSummaryHeader}>
              <Icon name="sparkles" size={16} color="#15803D" />
              <Text style={styles.aiSummaryHeaderText}>Resumen IA</Text>
            </View>
            <View style={styles.aiSummaryContent}>
              {s.ai_summary ? (
                renderMarkdown(s.ai_summary)
              ) : (
                <Text style={styles.aiNoSummaryText}>
                  No se genero resumen IA para esta sesion
                </Text>
              )}
            </View>
          </View>

          {/* Movimientos */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Movimientos</Text>
            {loadingMovs ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: spacing[3] }} />
            ) : movements.length === 0 ? (
              <Text style={styles.mutedText}>
                Aún no hay movimientos registrados.
              </Text>
            ) : (
              <View style={styles.movementsCard}>
                {movements.map((m, idx) => {
                  const iconName = getMovementIcon(m.type);
                  const iconColor = getMovementColor(m.type);
                  const iconBg = getMovementBg(m.type);
                  const labelText = getMovementLabel(m.type);
                  const isPositive = isPositiveMovement(m.type);
                  const isLast = idx === movements.length - 1;

                  const displayLabel = m.type === 'sale' && m.reference
                    ? `Venta — ${m.reference}`
                    : labelText;

                  const subtext = m.type === 'sale' && m.payment_method
                    ? `${formatTimeOnly(m.created_at)} · ${m.payment_method}`
                    : formatTimeOnly(m.created_at);

                  return (
                    <View
                      key={m.id}
                      style={[
                        styles.movRow,
                        isLast && { borderBottomWidth: 0 },
                      ]}
                    >
                      <View style={[styles.movIcon, { backgroundColor: iconBg }]}>
                        <Icon
                          name={iconName}
                          size={14}
                          color={iconColor}
                        />
                      </View>
                      <View style={styles.flex1}>
                        <Text style={styles.movLabel}>{displayLabel}</Text>
                        <Text style={styles.movTime}>{subtext}</Text>
                      </View>
                      <Text
                        style={[
                          styles.movAmount,
                          { color: iconColor },
                        ]}
                      >
                        {isPositive ? '+' : '−'}{formatCurrency(m.amount)}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </>
      )}
    </OrgCenteredModal>
  );
}

function MetricBox({
  label,
  value,
  bg,
  borderColor,
  textColor,
}: {
  label: string;
  value: string;
  bg: string;
  borderColor: string;
  textColor: string;
}) {
  return (
    <View style={[metricStyles.box, { backgroundColor: bg, borderColor: borderColor }]}>
      <Text style={[metricStyles.label, { color: textColor }]}>{label}</Text>
      <Text style={[metricStyles.value, { color: textColor }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const metricStyles = StyleSheet.create({
  box: {
    flexBasis: '48%',
    flexGrow: 1,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: 75,
  },
  label: {
    fontSize: 9,
    fontFamily: typography.fontFamily,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  value: {
    fontSize: typography.fontSize.lg,
    fontWeight: '700',
    fontFamily: typography.fontFamily,
    marginTop: 6,
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
  },
  flex1: { flex: 1 },
  loadingWrap: { paddingVertical: spacing[10], alignItems: 'center' },
  emptyBox: { padding: spacing[4], alignItems: 'center' },
  emptyText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    fontFamily: typography.fontFamily,
  },
  section: {
    marginTop: spacing[4],
    marginBottom: spacing[2],
  },
  sectionTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    marginBottom: spacing[2],
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
    marginTop: spacing[4],
  },
  mutedText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    fontFamily: typography.fontFamily,
    textAlign: 'center',
    paddingVertical: spacing[4],
  },
  movementsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    marginTop: spacing[2],
    overflow: 'hidden',
  },
  movRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3.5],
    paddingHorizontal: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  movIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  movLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
    fontFamily: typography.fontFamily,
  },
  movTime: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[400],
    fontFamily: typography.fontFamily,
    marginTop: 2,
  },
  movAmount: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    fontFamily: typography.fontFamily,
  },
  sessionDetailsCard: {
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.xl,
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colorScales.gray[100],
    marginTop: spacing[4],
  },
  sessionDetailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  sessionDetailsCol: {
    flex: 1,
  },
  infoLabelText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    fontFamily: typography.fontFamily,
  },
  infoValueText: {
    fontSize: typography.fontSize.sm,
    fontWeight: '500',
    color: colorScales.gray[900],
    fontFamily: typography.fontFamily,
  },
  aiSummaryContainer: {
    marginTop: spacing[4],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: '#D1FAE5',
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  aiSummaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    backgroundColor: '#F0FDF4',
    borderBottomWidth: 1,
    borderBottomColor: '#E6F4EA',
  },
  aiSummaryHeaderText: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600',
    fontFamily: typography.fontFamily,
    color: '#15803D',
  },
  aiSummaryContent: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
  },
  aiNoSummaryText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[400],
    fontFamily: typography.fontFamily,
    textAlign: 'center',
  },
  markdownParagraph: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[800],
    lineHeight: 20,
    marginBottom: spacing[2],
  },
  markdownBulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[1.5],
    marginBottom: spacing[1.5],
  },
  markdownBulletDot: {
    fontSize: typography.fontSize.sm,
    color: colorScales.green[600],
    lineHeight: 20,
  },
  markdownBulletText: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[800],
    lineHeight: 20,
  },
  statusPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusText: {
    fontSize: 10,
    fontWeight: typography.fontWeight.semibold,
    fontFamily: typography.fontFamily,
  },
});

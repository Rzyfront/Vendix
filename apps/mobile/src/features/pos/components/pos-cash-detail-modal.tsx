/**
 * Modal "Detalle de Caja" — paridad con `pos-session-detail-modal.component.ts` web.
 *
 * Muestra el estado completo de la sesión de caja activa (o de cualquier
 * sesión del histórico): métricas agregadas, lista cronológica de
 * movimientos y resumen IA generado por el backend.
 *
 * Lee `getSession(id)` (incluye `ai_summary`, `summary`, `opened_by_user`)
 * y `getMovements(id)` (lista cronológica). Display-only — sin mutaciones.
 *
 * NO usa `OrgCenteredModal` de parity — esa shared component no existe en
 * dev. Replica el chrome nativo RN Modal de `pos-cash-movement-modal.tsx`
 * (PR #7) y `pos-customer-modal.tsx`.
 */
import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { Button } from '@/shared/components/button/button';
import { formatCurrency } from '@/shared/utils/currency';
import {
  CashRegisterService,
  type CashRegisterSession,
  type CashRegisterMovement,
} from '../services/cash-register.service';

export interface PosCashDetailModalProps {
  visible: boolean;
  onClose: () => void;
  session: CashRegisterSession | null;
}

const STATUS_META = {
  open: { label: 'Abierta', color: colorScales.green[600], bg: colorScales.green[50] },
  closed: { label: 'Cerrada', color: colorScales.blue[600], bg: colorScales.blue[50] },
  suspended: { label: 'Suspendida', color: colorScales.amber[600], bg: colorScales.amber[50] },
} as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-CO', {
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

function formatTimeOnly(iso?: string | null): string {
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
    sale: 'banknote',
    refund: 'refresh',
    cash_in: 'plus',
    cash_out: 'minus',
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

/** Markdown minimalista: soporta `**bold**` y bullets `* ` / `- `. */
function renderMarkdown(text: string) {
  if (!text) return null;
  const lines = text.split('\n');
  return lines.map((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) return null;

    const isBullet = trimmed.startsWith('* ') || trimmed.startsWith('- ');
    const content = isBullet ? trimmed.substring(2) : trimmed;

    const parts = content.split('**');
    const nodes = parts.map((part, pIdx) => (
      <Text
        key={`${idx}-${pIdx}`}
        style={pIdx % 2 === 1 ? styles.markdownBold : undefined}
      >
        {part}
      </Text>
    ));

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

// ─── Component ──────────────────────────────────────────────────────────────

export const PosCashDetailModal: React.FC<PosCashDetailModalProps> = ({
  visible,
  onClose,
  session,
}) => {
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

  const totalSales = useMemo(
    () =>
      movements
        .filter((m) => m.type === 'sale')
        .reduce((sum, m) => sum + Number(m.amount), 0),
    [movements],
  );

  const totalRefunds = useMemo(
    () =>
      movements
        .filter((m) => m.type === 'refund')
        .reduce((sum, m) => sum + Number(m.amount), 0),
    [movements],
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={styles.container} onPress={(e) => e.stopPropagation()}>
            <View style={styles.surface}>
              {/* Header */}
              <View style={styles.header}>
                <View style={styles.headerLeft}>
                  <View style={styles.headerIcon}>
                    <Icon name="wallet" size={20} color={colors.primary} />
                  </View>
                  <View style={styles.headerTitles}>
                    <View style={styles.headerTitleRow}>
                      <Text style={styles.headerTitle} numberOfLines={1}>
                        {s?.register?.name ?? 'Caja'}
                      </Text>
                      {statusMeta && (
                        <View
                          style={[
                            styles.statusPill,
                            { backgroundColor: statusMeta.bg, borderColor: statusMeta.color },
                          ]}
                        >
                          <Text style={[styles.statusText, { color: statusMeta.color }]}>
                            {statusMeta.label}
                          </Text>
                        </View>
                      )}
                    </View>
                    {s && (
                      <Text style={styles.headerSubtitle}>Sesión #{s.id}</Text>
                    )}
                  </View>
                </View>
                <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={8}>
                  <Icon name="x" size={20} color={colorScales.gray[400]} />
                </Pressable>
              </View>

              {/* Content */}
              <ScrollView
                style={styles.content}
                contentContainerStyle={styles.contentInner}
                keyboardShouldPersistTaps="handled"
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
                    {/* Session details — 2 columns */}
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
                          <Text style={[styles.infoLabelText, styles.infoLabelSpacing]}>
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
                          <Text style={[styles.infoLabelText, styles.infoLabelSpacing]}>
                            Diferencia:{' '}
                            <Text
                              style={[
                                styles.infoValueText,
                                s.difference != null && {
                                  fontWeight: typography.fontWeight.bold as any,
                                  color:
                                    s.difference === 0
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

                    {/* Metrics grid */}
                    <View style={styles.metricsGrid}>
                      <MetricBox
                        label="Apertura"
                        value={formatCurrency(s.opening_amount)}
                        bg={colors.background}
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

                    {/* AI Summary */}
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
                            No se generó resumen IA para esta sesión.
                          </Text>
                        )}
                      </View>
                    </View>

                    {/* Movimientos */}
                    <View style={styles.section}>
                      <Text style={styles.sectionTitle}>Movimientos</Text>
                      {loadingMovs ? (
                        <ActivityIndicator
                          color={colors.primary}
                          style={styles.loadingMovs}
                        />
                      ) : movements.length === 0 ? (
                        <Text style={styles.mutedText}>
                          Aún no hay movimientos registrados.
                        </Text>
                      ) : (
                        <View style={styles.movementsCard}>
                          {movements.map((m: CashRegisterMovement, idx: number) => {
                            const iconName = getMovementIcon(m.type);
                            const iconColor = getMovementColor(m.type);
                            const iconBg = getMovementBg(m.type);
                            const labelText = getMovementLabel(m.type);
                            const isPositive = isPositiveMovement(m.type);
                            const isLast = idx === movements.length - 1;

                            const displayLabel =
                              m.type === 'sale' && m.reference
                                ? `Venta — ${m.reference}`
                                : labelText;

                            const subtext =
                              m.type === 'sale' && m.payment_method
                                ? `${formatTimeOnly(m.created_at)} · ${m.payment_method}`
                                : formatTimeOnly(m.created_at);

                            return (
                              <View
                                key={m.id}
                                style={[
                                  styles.movRow,
                                  isLast && styles.movRowLast,
                                ]}
                              >
                                <View
                                  style={[styles.movIcon, { backgroundColor: iconBg }]}
                                >
                                  <Icon name={iconName} size={14} color={iconColor} />
                                </View>
                                <View style={styles.flex1}>
                                  <Text style={styles.movLabel} numberOfLines={1}>
                                    {displayLabel}
                                  </Text>
                                  <Text style={styles.movTime} numberOfLines={1}>
                                    {subtext}
                                  </Text>
                                </View>
                                <Text style={[styles.movAmount, { color: iconColor }]}>
                                  {isPositive ? '+' : '−'}
                                  {formatCurrency(Number(m.amount))}
                                </Text>
                              </View>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  </>
                )}
              </ScrollView>

              {/* Footer */}
              <View style={styles.footer}>
                <Button
                  title="Cerrar"
                  variant="primary"
                  onPress={onClose}
                />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </View>
    </Modal>
  );
};

// ─── Sub-component: MetricBox ───────────────────────────────────────────────

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
    <View
      style={[
        metricStyles.box,
        { backgroundColor: bg, borderColor },
      ]}
    >
      <Text style={[metricStyles.label, { color: textColor }]}>{label}</Text>
      <Text
        style={[metricStyles.value, { color: textColor }]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

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
    fontWeight: typography.fontWeight.semibold as any,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  value: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    marginTop: 6,
  },
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[4],
  },
  container: {
    width: '100%',
    maxWidth: 500,
    maxHeight: '90%',
  },
  surface: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    flex: 1,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    backgroundColor: colorScales.blue[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitles: {
    flex: 1,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    flexWrap: 'wrap',
  },
  headerTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  headerSubtitle: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusText: {
    fontSize: 10,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
  },
  content: {
    maxHeight: 600,
  },
  contentInner: {
    padding: spacing[4],
    gap: spacing[2],
  },
  loadingWrap: {
    paddingVertical: spacing[10],
    alignItems: 'center',
  },
  loadingMovs: {
    marginTop: spacing[3],
  },
  emptyBox: {
    padding: spacing[4],
    alignItems: 'center',
  },
  emptyText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    fontFamily: typography.fontFamily,
  },
  flex1: {
    flex: 1,
  },
  sessionDetailsCard: {
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.xl,
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colorScales.gray[100],
    marginTop: spacing[2],
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
  infoLabelSpacing: {
    marginTop: spacing[2],
  },
  infoValueText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium as any,
    color: colorScales.gray[900],
    fontFamily: typography.fontFamily,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
    marginTop: spacing[4],
  },
  aiSummaryContainer: {
    marginTop: spacing[4],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: '#D1FAE5',
    backgroundColor: colors.background,
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
    fontWeight: typography.fontWeight.semibold as any,
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
  markdownBold: {
    fontWeight: typography.fontWeight.bold as any,
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
  section: {
    marginTop: spacing[4],
    marginBottom: spacing[2],
  },
  sectionTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    marginBottom: spacing[2],
  },
  mutedText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    fontFamily: typography.fontFamily,
    textAlign: 'center',
    paddingVertical: spacing[4],
  },
  movementsCard: {
    backgroundColor: colors.background,
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
  movRowLast: {
    borderBottomWidth: 0,
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
    fontWeight: typography.fontWeight.semibold as any,
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
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    padding: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
});
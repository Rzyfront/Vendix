/**
 * SocialSalesScreen — Marketing → Social Sales.
 *
 * Réplica funcional del viewport web `social-sales.component.ts`:
 * - StickyHeader con título + subtítulo + acción "Actualizar"
 * - Card 1: WhatsApp Business — estado + CTA Conectar / Desconectar
 * - Card 2: Disponibilidad de WhatsApp — alert success/warning según readiness
 * - Card 3: Canal conectado — 4-tile grid o empty state con borde dashed
 *
 * Toasts verbatim:
 *   - Conectar éxito:    'WhatsApp quedó conectado.'
 *   - Desconectar éxito: 'WhatsApp fue desconectado.'
 *   - Bloqueo readiness:  'WhatsApp no está disponible en este momento.'
 *
 * Notas de implementación:
 * - No existe Modal para este módulo (web no usa modal para esto).
 * - El flujo de "Conectar WhatsApp" en web usa window.FB.login() (Facebook SDK popup).
 *   En mobile, el flujo OAuth debe usar expo-auth-session (ASWebAuthenticationSession en iOS /
 *   Chrome Custom Tab en Android) con el OAuth URL construido desde readiness.app_id y
 *   readiness.whatsapp_config_id. Esa implementación de OAuth nativo es P1; la pantalla
 *   con el estado y los botones de Conectar/Desconectar se habilita desde P0.
 */
import { useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SocialSalesService } from '@/features/store/services/social-sales.service';
import { StickyHeader } from '@/shared/components/sticky-header/sticky-header';
import { Card } from '@/shared/components/card/card';
import { Icon } from '@/shared/components/icon/icon';
import { toastSuccess, toastError, toastWarning } from '@/shared/components/toast/toast.store';
import { colors, colorScales, spacing, borderRadius } from '@/shared/theme';
import type { MetaReadiness } from '@/features/store/types/social-sales.types';
// MetaReadiness tipa el `data` de readinessQuery.
// WhatsappChannel se infiere del servicio.

// ── constants ─────────────────────────────────────────────────────────────────

const LABELS = {
  title: 'Social Sales',
  subtitle: 'Conecta WhatsApp para iniciar ventas conversacionales.',
  actualizarLabel: 'Actualizar',
  whatsappBusiness: 'WhatsApp Business',
  disponibilidad: 'Disponibilidad de WhatsApp',
  canalConectado: 'Canal conectado',
  // Card 3 empty
  canalEmptyTitle: 'WhatsApp todavía no está conectado.',
  canalEmptyDesc: 'Conecta tu número de WhatsApp Business para comenzar a vender por chat.',
  // CTAs
  conectarWhatsapp: 'Conectar WhatsApp',
  desconectar: 'Desconectar',
  // Status badges
  connected: 'Conectado',
  disconnected: 'Desconectado',
  // Card 3 tiles
  tileCuenta: 'Cuenta',
  tileEstado: 'Estado',
  tileNumero: 'Número',
  tileConectado: 'Conectado',
  // Loading
  loadingChannel: 'Cargando estado del canal...',
  // Toasts
  toastConnected: 'WhatsApp quedó conectado.',
  toastDisconnected: 'WhatsApp fue desconectado.',
  toastUnavailable: 'WhatsApp no está disponible en este momento.',
  // Availability alerts
  availOk: 'WhatsApp está disponible para conectar.',
  availFail: 'WhatsApp no está disponible en este momento.',
  // Error banner fallback
  errorBannerFallback: 'No fue posible completar la operación.',
} as const;

// ── helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'No disponible';
  try {
    return new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return 'No disponible';
  }
}

function getChannelStatusLabel(status: string, connected: boolean): string {
  if (connected) return LABELS.connected;
  if (status === 'disconnected') return LABELS.disconnected;
  return status;
}

// ── sub-components ─────────────────────────────────────────────────────────────

function StatusBadge({ connected }: { connected: boolean }) {
  return (
    <View
      style={[
        styles.badge,
        connected ? styles.badgeSuccess : styles.badgeNeutral,
      ]}
    >
      <View
        style={[
          styles.badgeDot,
          connected ? styles.badgeDotSuccess : styles.badgeDotNeutral,
        ]}
      />
      <Text
        style={[
          styles.badgeText,
          connected ? styles.badgeTextSuccess : styles.badgeTextNeutral,
        ]}
      >
        {connected ? LABELS.connected : LABELS.disconnected}
      </Text>
    </View>
  );
}

function AlertBanner({
  variant,
  message,
  icon,
}: {
  variant: 'success' | 'warning' | 'danger' | 'info';
  message: string;
  icon: string;
}) {
  const bgMap = {
    success: colorScales.green[50],
    warning: colorScales.amber[50],
    danger: colorScales.red[50],
    info: colorScales.blue[50],
  };
  const borderMap = {
    success: colorScales.green[200],
    warning: colorScales.amber[200],
    danger: colorScales.red[200],
    info: colorScales.blue[200],
  };
  const textMap = {
    success: colorScales.green[800],
    warning: colorScales.amber[800],
    danger: colorScales.red[800],
    info: colorScales.blue[800],
  };
  return (
    <View
      style={[
        styles.alertBanner,
        { backgroundColor: bgMap[variant], borderColor: borderMap[variant] },
      ]}
    >
      <Icon name={icon} size={16} color={textMap[variant]} />
      <Text style={[styles.alertBannerText, { color: textMap[variant] }]}>
        {message}
      </Text>
    </View>
  );
}

interface MetricTileProps {
  label: string;
  value: string;
}
function MetricTile({ label, value }: MetricTileProps) {
  return (
    <View style={styles.metricTile}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

// ── main screen ───────────────────────────────────────────────────────────────

export default function SocialSalesScreen() {
  const queryClient = useQueryClient();

  // ── queries ──────────────────────────────────────────────────────────────

  const {
    data: readiness,
    isLoading: readinessLoading,
    isError: readinessError,
  } = useQuery({
    queryKey: ['social-sales-meta-readiness'],
    queryFn: () => SocialSalesService.getMetaReadiness(),
  });

  const {
    data: channel,
    isLoading: channelLoading,
    isError: channelError,
  } = useQuery({
    queryKey: ['social-sales-whatsapp-channel'],
    queryFn: () => SocialSalesService.getWhatsappChannel(),
  });

  const isLoading = readinessLoading || channelLoading;
  const hasError = readinessError || channelError;

  // ── mutations ─────────────────────────────────────────────────────────────

  /**
   * P1 (expo-auth-session): esta mutación sewireá el code del OAuth de Meta
   * una vez esté implementado el flujo de ASWebAuthenticationSession / Chrome Custom Tab.
   * Por ahora handleConectar() solo lanza toastWarning como guard.
   */
  const connectMutation = useMutation({
    mutationFn: (_dto: { code: string; waba_id: string; phone_number_id: string }) =>
      SocialSalesService.completeWhatsappEmbeddedSignup(_dto),
    onSuccess: () => {
      toastSuccess(LABELS.toastConnected);
      queryClient.invalidateQueries({ queryKey: ['social-sales-whatsapp-channel'] });
    },
    onError: (err: any) => {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        LABELS.errorBannerFallback;
      toastError(msg);
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => SocialSalesService.disconnectWhatsapp(),
    onSuccess: () => {
      toastSuccess(LABELS.toastDisconnected);
      queryClient.invalidateQueries({ queryKey: ['social-sales-whatsapp-channel'] });
    },
    onError: (err: any) => {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        LABELS.errorBannerFallback;
      toastError(msg);
    },
  });

  // ── handlers ─────────────────────────────────────────────────────────────

  const handleActualizar = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['social-sales-meta-readiness'] });
    queryClient.invalidateQueries({ queryKey: ['social-sales-whatsapp-channel'] });
  }, [queryClient]);

  const handleConectar = useCallback(() => {
    if (readiness && !readiness.can_start_signup) {
      toastWarning(LABELS.toastUnavailable);
      return;
    }
    // P0: el flujo OAuth de Meta (expo-auth-session) se implementa en P1.
    // Por ahora, botón "Conectar" muestra warning hasta que P1 esté listo.
    toastWarning(LABELS.toastUnavailable);
  }, [readiness]);

  const handleDesconectar = useCallback(() => {
    disconnectMutation.mutate();
  }, [disconnectMutation]);

  // ── derived state ─────────────────────────────────────────────────────────

  const canConnect = readiness?.can_start_signup === true && !channel?.connected;
  const isConnected = channel?.connected === true;
  const isConnecting = connectMutation.isPending;
  const isDisconnecting = disconnectMutation.isPending;

  // ── render helpers ────────────────────────────────────────────────────────

  const renderCard1WhatsAppBusiness = () => {
    return (
      <Card style={styles.card}>
        <Card.Body>
          {/* Icon tile */}
          <View style={styles.iconTile}>
            <View style={styles.iconTileBg}>
              <Icon name="message-circle" size={22} color={colorScales.green[700]} />
            </View>
          </View>

          {/* Title + badge */}
          <View style={styles.cardRow}>
            <Text style={styles.cardTitle}>{LABELS.whatsappBusiness}</Text>
            <StatusBadge connected={isConnected} />
          </View>

          {/* Helper text */}
          <Text style={styles.cardBodyText}>
            {isConnected
              ? 'Tu canal de WhatsApp está activo y conectado.'
              : 'Conecta tu WhatsApp Business para recibir pedidos y chatear con clientes.'}
          </Text>

          {/* CTA */}
          <View style={styles.cardActions}>
            {isConnected ? (
              <Pressable
                onPress={handleDesconectar}
                disabled={isDisconnecting}
                style={({ pressed }) => [
                  styles.btnOutlineDanger,
                  pressed && styles.btnPressed,
                  isDisconnecting && styles.btnDisabled,
                ]}
              >
                {isDisconnecting ? (
                  <ActivityIndicator size="small" color={colorScales.red[600]} />
                ) : (
                  <>
                    <Icon name="plug" size={16} color={colorScales.red[600]} />
                    <Text style={styles.btnOutlineDangerText}>{LABELS.desconectar}</Text>
                  </>
                )}
              </Pressable>
            ) : (
              <Pressable
                onPress={handleConectar}
                disabled={!canConnect || isConnecting}
                style={({ pressed }) => [
                  styles.btnPrimary,
                  pressed && styles.btnPressed,
                  (!canConnect || isConnecting) && styles.btnDisabled,
                ]}
              >
                {isConnecting ? (
                  <ActivityIndicator size="small" color={colors.card} />
                ) : (
                  <>
                    <Icon name="message-circle" size={16} color={colors.card} />
                    <Text style={styles.btnPrimaryText}>{LABELS.conectarWhatsapp}</Text>
                  </>
                )}
              </Pressable>
            )}
          </View>
        </Card.Body>
      </Card>
    );
  };

  const renderCard2Disponibilidad = () => {
    if (!readiness) return null; // hidden while loading

    return (
      <Card style={styles.card}>
        <Card.Body>
          <Text style={styles.cardTitle}>{LABELS.disponibilidad}</Text>
          {readiness.can_start_signup ? (
            <AlertBanner
              variant="success"
              message={LABELS.availOk}
              icon="check-circle"
            />
          ) : (
            <AlertBanner
              variant="warning"
              message={LABELS.availFail}
              icon="alert-triangle"
            />
          )}
        </Card.Body>
      </Card>
    );
  };

  const renderCard3CanalConectado = () => {
    if (channelLoading) {
      return (
        <Card style={styles.card}>
          <Card.Body style={styles.loadingBody}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.loadingText}>{LABELS.loadingChannel}</Text>
          </Card.Body>
        </Card>
      );
    }

    if (!channel?.connected) {
      return (
        <Card style={[styles.card, styles.cardDashed]}>
          <Card.Body>
            <View style={styles.emptyState}>
              <View style={styles.emptyIconBg}>
                <Icon name="plug" size={28} color={colorScales.gray[400]} />
              </View>
              <Text style={styles.emptyTitle}>{LABELS.canalEmptyTitle}</Text>
              <Text style={styles.emptyDesc}>{LABELS.canalEmptyDesc}</Text>
            </View>
          </Card.Body>
        </Card>
      );
    }

    // Connected — 4-tile grid
    return (
      <Card style={styles.card}>
        <Card.Body>
          <Text style={styles.cardTitle}>{LABELS.canalConectado}</Text>
          <View style={styles.metricsGrid}>
            <MetricTile label={LABELS.tileCuenta} value={channel.waba_id ?? '—'} />
            <MetricTile
              label={LABELS.tileEstado}
              value={getChannelStatusLabel(channel.status, channel.connected)}
            />
            <MetricTile
              label={LABELS.tileNumero}
              value={channel.display_phone_number ?? '—'}
            />
            <MetricTile
              label={LABELS.tileConectado}
              value={formatDate(channel.connected_at)}
            />
          </View>
        </Card.Body>
      </Card>
    );
  };

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <StickyHeader
        title={LABELS.title}
        subtitle={LABELS.subtitle}
        actions={[
          {
            label: LABELS.actualizarLabel,
            icon: 'refresh-cw',
            variant: 'outline',
            onPress: handleActualizar,
            loading: isLoading,
          },
        ]}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Error banner */}
        {hasError && (
          <AlertBanner
            variant="danger"
            message={
              channelError
                ? LABELS.errorBannerFallback
                : LABELS.errorBannerFallback
            }
            icon="alert-triangle"
          />
        )}

        {/* Card 1: WhatsApp Business */}
        {renderCard1WhatsAppBusiness()}

        {/* Card 2: Disponibilidad — solo visible si readiness cargó */}
        {readiness && renderCard2Disponibilidad()}

        {/* Card 3: Canal conectado */}
        {renderCard3CanalConectado()}
      </ScrollView>
    </View>
  );
}

// ── styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colorScales.gray[50],
  },
  scrollContent: {
    padding: spacing[4],
    gap: spacing[4],
    paddingBottom: spacing[8],
  },

  // ── Card ──────────────────────────────────────────────────────────────────
  card: {
    backgroundColor: colors.card,
  },
  cardDashed: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colorScales.gray[300],
    backgroundColor: 'transparent',
  },

  // ── Card 1 ───────────────────────────────────────────────────────────────
  iconTile: {
    marginBottom: spacing[3],
  },
  iconTileBg: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.lg,
    backgroundColor: colorScales.green[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[2],
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colorScales.gray[900],
  },
  cardBodyText: {
    fontSize: 14,
    color: colorScales.gray[500],
    marginBottom: spacing[3],
    lineHeight: 20,
  },
  cardActions: {
    flexDirection: 'row',
    gap: spacing[3],
    paddingTop: spacing[1],
  },

  // ── Buttons ──────────────────────────────────────────────────────────────
  btnPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    backgroundColor: colors.primary,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.md,
  },
  btnPrimaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.card,
  },
  btnOutlineDanger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderWidth: 1,
    borderColor: colorScales.red[300],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.md,
  },
  btnOutlineDangerText: {
    fontSize: 14,
    fontWeight: '600',
    color: colorScales.red[600],
  },
  btnPressed: {
    opacity: 0.85,
  },
  btnDisabled: {
    opacity: 0.5,
  },

  // ── Badge ───────────────────────────────────────────────────────────────
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.full,
  },
  badgeSuccess: {
    backgroundColor: colorScales.green[50],
    borderWidth: 1,
    borderColor: colorScales.green[200],
  },
  badgeNeutral: {
    backgroundColor: colorScales.gray[100],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeDotSuccess: {
    backgroundColor: colorScales.green[600],
  },
  badgeDotNeutral: {
    backgroundColor: colorScales.gray[500],
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '500',
  },
  badgeTextSuccess: {
    color: colorScales.green[800],
  },
  badgeTextNeutral: {
    color: colorScales.gray[600],
  },

  // ── Alert banner ─────────────────────────────────────────────────────────
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
  },
  alertBannerText: {
    fontSize: 13,
    flex: 1,
  },

  // ── Card 3: Metrics grid ────────────────────────────────────────────────
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing[3],
    gap: spacing[3],
  },

  // ── Metric tile ───────────────────────────────────────────────────────────
  metricTile: {
    width: '47%',
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing[1],
  },
  metricValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colorScales.gray[900],
  },

  // ── Loading ──────────────────────────────────────────────────────────────
  loadingBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  loadingText: {
    fontSize: 14,
    color: colorScales.gray[500],
  },

  // ── Empty state ──────────────────────────────────────────────────────────
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing[4],
  },
  emptyIconBg: {
    width: 56,
    height: 56,
    borderRadius: borderRadius.full,
    backgroundColor: colorScales.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[3],
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colorScales.gray[900],
    marginBottom: spacing[1],
  },
  emptyDesc: {
    fontSize: 13,
    color: colorScales.gray[500],
    textAlign: 'center',
    lineHeight: 18,
  },
});

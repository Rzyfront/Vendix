/**
 * Modal para cerrar la sesión de caja registradora activa.
 *
 * Modal centrado con resumen de la sesión (monto apertura, cajero, efectivo
 * esperado) + input de conteo real + notas opcionales. Al confirmar llama
 * `CashRegisterService.closeSession`, limpia `useCashRegisterStore` y refresca
 * la query `cash-session-active` para que el header badge vuelva a "Sin caja".
 */
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { Button } from '@/shared/components/button/button';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import {
  CashRegisterService,
  type CashRegisterSession,
  type CashSessionSummary,
  type CashSessionPendingOrder,
  type CashSessionPendingOrders,
  type CashSessionFinishPreview,
  type CashSessionCloseDecision,
} from '@/features/pos/services/cash-register.service';
import { useCashRegisterStore } from '@/features/pos/store/cash-register.store';

export interface PosCashCloseModalProps {
  visible: boolean;
  onClose: () => void;
  session: CashRegisterSession | null;
}

/**
 * Parsea texto de monto de forma estricta.
 *
 * Devuelve `null` si el texto no representa un número válido (vacío, contiene
 * caracteres no numéricos como letras o símbolos, etc.) — antes se coercía
 * silenciosamente a `0`, lo cual permitía cerrar una sesión de caja con un
 * conteo ficticio de 0 sin disparar ninguna validación visible al cashier.
 *
 * Acepta separadores de miles `.` o `,` como punto decimal (es-CO).
 */
const parseAmount = (text: string): number | null => {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const normalized = trimmed.replace(',', '.');
  // Solo dígitos, un único punto decimal opcional y signo negativo opcional
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
};

const formatCurrency = (n: number | null | undefined): string => {
  if (n == null) return '—';
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n);
};

function getErrorInfo(error: unknown): { status: number | null; code?: string } {
  const value = error as {
    response?: { status?: number; data?: { error_code?: string; message?: string } };
    statusCode?: number;
    errorCode?: string;
    message?: string;
    body?: { error_code?: string; message?: string };
  } | null;
  return {
    status: value?.response?.status ?? value?.statusCode ?? null,
    code: value?.response?.data?.error_code ?? value?.errorCode ?? value?.body?.error_code,
  };
}

const CASH_CLOSE_ERROR_MESSAGES: Record<string, string> = {
  CASH_SESSION_EXPECTED_STALE_001: 'El efectivo esperado cambió. Revisa el resumen actualizado y vuelve a contar.',
  CASH_SESSION_PENDING_001: 'Revisa las órdenes pendientes antes de cerrar la caja.',
  CASH_SESSION_PENDING_002: 'Las órdenes pendientes cambiaron. Actualiza la lista y revísala de nuevo.',
  CASH_SESSION_PENDING_003: 'Escribe el motivo para cerrar con órdenes pendientes.',
  CASH_SESSION_PENDING_004: 'No pudimos validar las órdenes de esta sesión. Actualiza la lista e intenta de nuevo.',
  CASH_SESSION_PENDING_005: 'Hay movimientos de venta o reembolso pendientes de registrar. Espera un momento y vuelve a intentar.',
  CASH_SESSION_PENDING_006: 'La caja ya está cerrada. Actualiza la sesión.',
};

function cashCloseErrorMessage(error: unknown, fallback: string): string {
  const info = getErrorInfo(error);
  if (info.code && CASH_CLOSE_ERROR_MESSAGES[info.code]) return CASH_CLOSE_ERROR_MESSAGES[info.code];
  if (info.status === 0) return 'No hay conexión con el servidor. Revisa tu conexión e inténtalo de nuevo.';
  if (info.status === 401) return 'Tu sesión venció. Inicia sesión de nuevo.';
  if (info.status === 403) return 'No tienes permiso para realizar esta acción.';
  return fallback;
}

const cashChangedByAtLeastTwoCents = (current: number, seen: number): boolean =>
  Math.abs(Math.round(current * 100) - Math.round(seen * 100)) >= 2;

export const PosCashCloseModal: React.FC<PosCashCloseModalProps> = ({
  visible,
  onClose,
  session,
}) => {
  const [actualText, setActualText] = useState('');
  const [notes, setNotes] = useState('');

  const queryClient = useQueryClient();
  const clearSession = useCashRegisterStore((s) => s.clearSession);

  const [pendingPage, setPendingPage] = useState(1);
  const [pendingExpanded, setPendingExpanded] = useState(false);
  const [selectedOrders, setSelectedOrders] = useState<Record<number, CashSessionPendingOrder>>({});
  const [preview, setPreview] = useState<CashSessionFinishPreview | null>(null);
  const [pendingCloseWarning, setPendingCloseWarning] = useState<{
    count: number;
    expectedSeen: number;
    fingerprint: string;
  } | null>(null);
  const [decisionReason, setDecisionReason] = useState('');
  const [expectedCountedAgainst, setExpectedCountedAgainst] = useState<number | null>(null);
  const [expectedChanged, setExpectedChanged] = useState(false);
  const [pendingChanged, setPendingChanged] = useState(false);
  const [seenPendingFingerprint, setSeenPendingFingerprint] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<'preview' | 'finish' | null>(null);
  const [isRefreshingClose, setIsRefreshingClose] = useState(false);
  const lastPendingFingerprint = useRef<string | null>(null);

  const cashSummaryQuery = useQuery({
    queryKey: ['cash-session-summary', session?.id],
    queryFn: () => CashRegisterService.getCashSummary(session!.id),
    enabled: visible && session != null,
    refetchInterval: visible ? 10_000 : false,
  });

  const pendingQuery = useQuery({
    queryKey: ['cash-session-pending-orders', session?.id, pendingPage],
    queryFn: () => CashRegisterService.getPendingOrders(session!.id, pendingPage),
    enabled: visible && session != null,
    refetchInterval: visible ? 10_000 : false,
  });

  const pendingOrders = pendingQuery.data;
  const selectedOrderList = useMemo(
    () => Object.values(selectedOrders),
    [selectedOrders],
  );
  const pendingPageCount = pendingOrders
    ? Math.max(1, Math.ceil(pendingOrders.count / pendingOrders.limit))
    : 1;
  const reason = decisionReason.trim();

  useEffect(() => {
    if (!visible) {
      setPendingPage(1);
      setPendingExpanded(false);
      setSelectedOrders({});
      setPreview(null);
      setPendingCloseWarning(null);
      setDecisionReason('');
      setExpectedCountedAgainst(null);
      setExpectedChanged(false);
      setPendingChanged(false);
      setSeenPendingFingerprint(null);
      lastPendingFingerprint.current = null;
      setActualText('');
      setNotes('');
      return;
    }

    setPendingPage(1);
    setSelectedOrders({});
    setPreview(null);
    setPendingCloseWarning(null);
    setDecisionReason('');
    setExpectedCountedAgainst(null);
    setExpectedChanged(false);
    setPendingChanged(false);
    setSeenPendingFingerprint(null);
    lastPendingFingerprint.current = null;
  }, [visible, session?.id]);

  useEffect(() => {
    const expectedNow = cashSummaryQuery.data?.expected_cash_total;
    if (expectedNow == null) return;
    if (expectedCountedAgainst == null) {
      setExpectedCountedAgainst(expectedNow);
      return;
    }
    if (cashChangedByAtLeastTwoCents(expectedNow, expectedCountedAgainst)) {
      setExpectedChanged(true);
    }
  }, [cashSummaryQuery.data?.expected_cash_total, expectedCountedAgainst]);

  useEffect(() => {
    const fingerprint = pendingOrders?.fingerprint;
    if (fingerprint == null) return;
    const previous = lastPendingFingerprint.current;
    lastPendingFingerprint.current = fingerprint;
    if (seenPendingFingerprint == null) {
      setSeenPendingFingerprint(fingerprint);
    } else if (previous != null && previous !== fingerprint) {
      setPendingChanged(true);
      setPreview(null);
      setSelectedOrders({});
    }
  }, [pendingOrders?.fingerprint, seenPendingFingerprint]);

  const { data: movements = [], isLoading: movementsLoading } = useQuery({
    queryKey: ['cash-registers', 'movements', session?.id],
    queryFn: () => CashRegisterService.getMovements(session!.id),
    enabled: visible && session != null,
  });

  // Sales-by-method aggregation for the summary block.
  const salesByMethod = useMemo(() => {
    const grouped = new Map<string, { count: number; total: number }>();
    for (const m of movements) {
      if (m.type !== 'sale') continue;
      const method = m.payment_method ?? 'otro';
      const entry = grouped.get(method) ?? { count: 0, total: 0 };
      entry.count += 1;
      // m.amount is a Prisma Decimal serialized as a JSON string; coerce so
      // the running total sums numerically instead of concatenating ("$ NaN").
      entry.total += Number(m.amount);
      grouped.set(method, entry);
    }
    return Array.from(grouped.entries()).map(([method, v]) => ({ method, ...v }));
  }, [movements]);

  const actual = parseAmount(actualText);
  const expected = cashSummaryQuery.data?.expected_cash_total ?? session?.expected_closing_amount ?? null;
  const difference = expected != null && actual != null ? actual - expected : null;
  // `actual == null` ⇒ texto inválido o vacío; el botón se mantiene deshabilitado.
  // `actual > 0` exige un conteo real (>= 1) — cerrar con 0 sería un conteo ficticio.
  const isValid = session != null && actual != null && actual > 0;

  const closeMutation = useMutation({
    mutationFn: (data: { expectedSeen: number; pendingDecision: CashSessionCloseDecision }) =>
      // `actual!` es seguro — el handler solo llama mutate tras validar el conteo.
      CashRegisterService.closeSession(
        session!.id,
        actual!,
        notes.trim() || undefined,
        data.expectedSeen,
        data.pendingDecision,
      ),
    onSuccess: () => {
      clearSession();
      queryClient.invalidateQueries({ queryKey: ['cash-session-active'] });
      queryClient.invalidateQueries({ queryKey: ['cash-session-summary', session?.id] });
      queryClient.invalidateQueries({ queryKey: ['cash-session-pending-orders', session?.id] });
      toastSuccess('Caja cerrada correctamente');
      handleClose();
    },
    onError: (err: any) => {
      const info = getErrorInfo(err);
      if (info.status === 409 || info.code?.includes('PENDING')) {
        queryClient.invalidateQueries({ queryKey: ['cash-session-summary', session?.id] });
        queryClient.invalidateQueries({ queryKey: ['cash-session-pending-orders', session?.id] });
        if (info.code?.includes('PENDING')) setPendingChanged(true);
        else {
          setExpectedChanged(true);
          setActualText('');
        }
        toastError(
          info.code?.includes('PENDING_001') || info.code?.includes('PENDING_004')
            ? 'El servidor exige revisar las órdenes pendientes para cerrar. Actualiza la app si no aparece la revisión.'
            : cashCloseErrorMessage(err, 'Cambió el efectivo o las órdenes. Revisa los datos actualizados y vuelve a intentar.'),
        );
        return;
      }
      toastError(cashCloseErrorMessage(err, 'No se pudo cerrar la caja. Inténtalo de nuevo.'));
    },
  });

  const canSubmitClose =
    isValid &&
    expectedCountedAgainst != null &&
    pendingOrders != null &&
    !pendingQuery.isError &&
    !cashSummaryQuery.isError &&
    !pendingQuery.isFetching &&
    !expectedChanged &&
    !pendingChanged &&
    pendingAction === null &&
    !isRefreshingClose &&
    !closeMutation.isPending;

  const confirmPendingClose = () => {
    const warning = pendingCloseWarning;
    if (!warning || closeMutation.isPending) return;
    setPendingCloseWarning(null);
    closeMutation.mutate({
      expectedSeen: warning.expectedSeen,
      pendingDecision: {
        pending_decision: 'override',
        pending_fingerprint: warning.fingerprint,
        override_reason: 'Cierre confirmado por el usuario desde el aviso de órdenes pendientes.',
      },
    });
  };

  const handleClose = useCallback(() => {
    setActualText('');
    setNotes('');
    onClose();
  }, [onClose]);

  const acknowledgeCashChange = () => {
    const freshExpected = cashSummaryQuery.data?.expected_cash_total;
    if (freshExpected == null) return;
    setExpectedCountedAgainst(freshExpected);
    setExpectedChanged(false);
    setActualText('');
  };

  const acknowledgePendingChange = () => {
    const fingerprint = pendingQuery.data?.fingerprint;
    if (!fingerprint) return;
    setSeenPendingFingerprint(fingerprint);
    lastPendingFingerprint.current = fingerprint;
    setPendingChanged(false);
  };

  const toggleOrderSelection = (order: CashSessionPendingOrder) => {
    setSelectedOrders((current) => {
      const next = { ...current };
      if (next[order.id]) {
        delete next[order.id];
        return next;
      }
      if (Object.keys(current).length >= 100) {
        toastError('Puedes revisar hasta 100 órdenes por lote.');
        return current;
      }
      if (order.version === null) {
        toastError('Esta orden no tiene una versión verificable. Actualiza la lista antes de continuar.');
        return current;
      }
      next[order.id] = order;
      return next;
    });
    setPreview(null);
  };

  const refreshBeforeClose = async () => {
    if (!session || !isValid || closeMutation.isPending || isRefreshingClose) return;
    if (expectedChanged || pendingChanged) {
      toastError('Revisa el efectivo y las órdenes actuales antes de cerrar.');
      return;
    }
    if (!pendingOrders || pendingQuery.isError || cashSummaryQuery.isError) {
      toastError('No pudimos verificar órdenes y efectivo. Actualiza la app o contacta al administrador; no se cerró la caja.');
      return;
    }

    setIsRefreshingClose(true);
    try {
      const [freshSummary, freshPending] = await Promise.all([
        CashRegisterService.getCashSummary(session.id),
        CashRegisterService.getPendingOrders(session.id, pendingPage),
      ]);
      queryClient.setQueryData(['cash-session-summary', session.id], freshSummary);
      queryClient.setQueryData(
        ['cash-session-pending-orders', session.id, pendingPage],
        freshPending,
      );

      if (expectedCountedAgainst == null) {
        setExpectedCountedAgainst(freshSummary.expected_cash_total);
        setExpectedChanged(true);
        setActualText('');
        toastError('Se actualizó el efectivo esperado. Revisa la cifra y vuelve a contar.');
        return;
      }
      if (cashChangedByAtLeastTwoCents(
        freshSummary.expected_cash_total,
        expectedCountedAgainst,
      )) {
        setExpectedChanged(true);
        setActualText('');
        toastError('El efectivo esperado cambió. Revisa la cifra y vuelve a contar antes de cerrar.');
        return;
      }

      if (
        seenPendingFingerprint == null ||
        freshPending.fingerprint !== seenPendingFingerprint
      ) {
        setPendingChanged(true);
        setPreview(null);
        setSelectedOrders({});
        toastError('Las órdenes pendientes cambiaron. Revisa la lista actual antes de cerrar.');
        return;
      }

      if (freshPending.count > 0) {
        setPendingCloseWarning({
          count: freshPending.count,
          expectedSeen: expectedCountedAgainst,
          fingerprint: freshPending.fingerprint,
        });
        return;
      }

      const pendingDecision: CashSessionCloseDecision = {
        pending_decision: 'resolved',
        pending_fingerprint: freshPending.fingerprint,
      };
      closeMutation.mutate({
        expectedSeen: expectedCountedAgainst,
        pendingDecision,
      });
    } catch (error) {
      const info = getErrorInfo(error);
      if (info.status === 409 || info.code?.includes('PENDING')) {
        setPendingChanged(true);
        setPreview(null);
        setSelectedOrders({});
        queryClient.invalidateQueries({ queryKey: ['cash-session-summary', session.id] });
        queryClient.invalidateQueries({ queryKey: ['cash-session-pending-orders', session.id] });
        toastError(
          info.code?.includes('PENDING_001') || info.code?.includes('PENDING_004')
            ? 'Este servidor requiere revisar pendientes. Actualiza la app para continuar con el cierre.'
            : cashCloseErrorMessage(error, 'Los datos cambiaron. Refrescamos el efectivo y las órdenes; revisa antes de cerrar.'),
        );
        return;
      }
      toastError(cashCloseErrorMessage(error, 'No pudimos actualizar el efectivo y las órdenes pendientes. La caja sigue abierta.'));
    } finally {
      setIsRefreshingClose(false);
    }
  };

  const previewSelectedOrders = async () => {
    if (!session || selectedOrderList.length === 0 || pendingAction) return;
    if (selectedOrderList.some((order) => order.version === null)) {
      toastError('Una orden no tiene versión verificable. Actualiza la lista antes de continuar.');
      return;
    }
    setPendingAction('preview');
    try {
      const result = await CashRegisterService.previewCashSessionFinish(
        session.id,
        selectedOrderList.map((order) => ({
          id: order.id,
          version: order.version ?? '',
          fingerprint: order.fingerprint,
        })),
      );
      setPreview(result);
    } catch (error) {
      const info = getErrorInfo(error);
      if (info.status === 409 || info.code?.includes('STALE')) {
        setPreview(null);
        setSelectedOrders({});
        setPendingChanged(true);
        queryClient.invalidateQueries({ queryKey: ['cash-session-pending-orders', session.id] });
        queryClient.invalidateQueries({ queryKey: ['cash-session-summary', session.id] });
        toastError('Las órdenes cambiaron. Actualizamos la lista y debes revisarla de nuevo.');
      } else {
        toastError(cashCloseErrorMessage(error, 'No pudimos revisar la elegibilidad de las órdenes.'));
      }
    } finally {
      setPendingAction(null);
    }
  };

  const finishEligibleOrders = async () => {
    if (!session || !preview || pendingAction || !reason) return;
    const eligible = preview.items.filter((item) => item.eligible);
    if (!eligible.length) return;
    if (eligible.some((item) => item.version === null)) {
      toastError('Una orden elegible no tiene versión verificable. Actualiza la lista antes de continuar.');
      return;
    }
    setPendingAction('finish');
    try {
      await CashRegisterService.finishCashSessionOrders(
        preview.session_id,
        eligible.map((item) => ({
          id: item.id,
          version: item.version ?? '',
          fingerprint: item.fingerprint,
        })),
        preview.eligible_fingerprint,
        reason,
      );
      setPreview(null);
      setSelectedOrders({});
      toastSuccess('Órdenes elegibles finalizadas. No se registró un cobro ni una entrega.');
      queryClient.invalidateQueries({ queryKey: ['cash-session-pending-orders', session.id] });
      queryClient.invalidateQueries({ queryKey: ['cash-session-summary', session.id] });
    } catch (error) {
      const info = getErrorInfo(error);
      if (info.status === 409 || info.code?.includes('STALE')) {
        setPreview(null);
        setSelectedOrders({});
        setPendingChanged(true);
        queryClient.invalidateQueries({ queryKey: ['cash-session-pending-orders', session.id] });
        queryClient.invalidateQueries({ queryKey: ['cash-session-summary', session.id] });
        toastError('Las órdenes cambiaron. Actualizamos la revisión; confirma la lista antes de continuar.');
      } else {
        toastError(cashCloseErrorMessage(error, 'No pudimos finalizar las órdenes elegibles.'));
      }
    } finally {
      setPendingAction(null);
    }
  };

  // Reset state whenever the modal is closed (defensive).
  useEffect(() => {
    if (!visible) {
      setActualText('');
      setNotes('');
    }
  }, [visible]);

  if (!session) {
    return (
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={onClose}
        statusBarTranslucent
      >
        <View style={styles.backdrop}>
          <View style={styles.container}>
            <View style={styles.surface}>
              <View style={styles.emptyBody}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.emptyText}>Sin sesión activa</Text>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  const cashierName = session.opened_by_user
    ? `${session.opened_by_user.first_name} ${session.opened_by_user.last_name ?? ''}`.trim()
    : 'Cajero';

  const diffBadge = (() => {
    if (difference == null) return null;
    if (difference === 0) {
      return { label: 'Cuadre exacto', color: colorScales.green[600], bg: colorScales.green[50] };
    }
    if (difference > 0) {
      return {
        label: `Sobrante: +${formatCurrency(difference)}`,
        color: colorScales.amber[700],
        bg: colorScales.amber[50],
      };
    }
    return {
      label: `Faltante: ${formatCurrency(difference)}`,
      color: colorScales.red[700],
      bg: colorScales.red[50],
    };
  })();

  return (
    <>
    <Modal
      visible={visible && pendingCloseWarning === null}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={handleClose}>
          <Pressable style={styles.container} onPress={(e) => e.stopPropagation()}>
            <View style={styles.surface}>
              <View style={styles.header}>
                <View style={styles.headerLeft}>
                  <View style={styles.headerIcon}>
                    <Icon name="wallet" size={20} color={colors.primary} />
                  </View>
                  <View>
                    <Text style={styles.headerTitle}>Cerrar Caja</Text>
                    <Text style={styles.headerSubtitle}>
                      {session.register?.name ?? `Sesión #${session.id}`}
                    </Text>
                  </View>
                </View>
                <Pressable
                  onPress={handleClose}
                  style={styles.closeBtn}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Cerrar ventana de cierre de caja"
                >
                  <Icon name="x" size={20} color={colorScales.gray[400]} />
                </Pressable>
              </View>

              <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
                <View style={styles.infoRow}>
                  <View style={styles.infoCard}>
                    <Text style={styles.infoLabel}>MONTO APERTURA</Text>
                    <Text style={styles.infoValue}>{formatCurrency(session.opening_amount)}</Text>
                  </View>
                  <View style={styles.infoCard}>
                    <Text style={styles.infoLabel}>CAJERO</Text>
                    <Text style={styles.infoValueSmall}>{cashierName}</Text>
                  </View>
                </View>

                {pendingQuery.isError && (
                  <View style={styles.pendingPanel}>
                    <Text
                      style={styles.pendingWarning}
                      accessibilityRole="alert"
                      accessibilityLiveRegion="assertive"
                    >
                      {getErrorInfo(pendingQuery.error).status === 404
                        ? 'Esta versión del servidor no puede verificar las órdenes pendientes. Actualiza la app o contacta al administrador; el cierre permanece bloqueado.'
                        : 'No pudimos verificar las órdenes pendientes. Reintenta o contacta al administrador; el cierre permanece bloqueado.'}
                    </Text>
                    <Button
                      title="Reintentar verificación"
                      variant="outline"
                      size="md"
                      style={{ minHeight: 44 }}
                      onPress={() => pendingQuery.refetch()}
                    />
                  </View>
                )}

                {pendingOrders && pendingOrders.count > 0 && (
                  <View
                    style={styles.pendingPanel}
                    accessible
                    accessibilityRole="summary"
                    accessibilityLabel={`${pendingOrders.count} órdenes pendientes de esta sesión. Saldo informativo ${formatCurrency(pendingOrders.balance_total)}. El saldo no se suma al efectivo esperado.`}
                  >
                    <Text style={styles.pendingTitle} accessibilityRole="header">
                      Órdenes pendientes de esta sesión
                    </Text>
                    <Text
                      style={styles.pendingSummary}
                      accessibilityLiveRegion="polite"
                      accessibilityRole="text"
                    >
                      {pendingOrders.count} {pendingOrders.count === 1 ? 'orden' : 'órdenes'} pendientes
                      {pendingOrders.balance_count > 0
                        ? ` · saldo informativo ${formatCurrency(pendingOrders.balance_total)}`
                        : ''}
                    </Text>
                    <Text style={styles.pendingNote}>
                      El saldo pendiente no se suma al efectivo esperado de la caja.
                    </Text>
                    {pendingChanged && (
                      <View>
                        <Text
                          style={styles.pendingWarning}
                          accessibilityRole="alert"
                          accessibilityLiveRegion="assertive"
                        >
                          Las órdenes cambiaron. Revisa la lista actual antes de continuar.
                        </Text>
                        <Button
                          title="Revisé las órdenes actuales"
                          variant="outline"
                          size="md"
                          style={{ minHeight: 44 }}
                          onPress={acknowledgePendingChange}
                        />
                      </View>
                    )}
                    {pendingOrders.count > 0 && (
                      <>
                        <Pressable
                          style={styles.pendingToggle}
                          accessibilityRole="button"
                          accessibilityLabel={pendingExpanded ? 'Ocultar órdenes pendientes' : 'Ver órdenes pendientes'}
                          accessibilityState={{ expanded: pendingExpanded }}
                          onPress={() => setPendingExpanded((expanded) => !expanded)}
                        >
                          <Text style={styles.pendingToggleText}>
                            {pendingExpanded ? 'Ocultar órdenes' : 'Ver órdenes pendientes'}
                          </Text>
                        </Pressable>
                        {pendingExpanded && (
                          <View>
                            {pendingOrders.data.map((order) => {
                              const selected = selectedOrders[order.id] != null;
                              return (
                                <View key={order.id} style={styles.pendingOrderRow}>
                                  <Pressable
                                    style={styles.orderCheckbox}
                                    accessibilityRole="checkbox"
                                    accessibilityLabel={`Seleccionar orden ${order.order_number}, estado ${order.state}`}
                                    accessibilityState={{
                                      checked: selected,
                                      disabled: order.version === null || pendingAction !== null,
                                    }}
                                    disabled={order.version === null || pendingAction !== null}
                                    onPress={() => toggleOrderSelection(order)}
                                  >
                                    <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
                                      {selected && <Text style={styles.checkboxMark}>✓</Text>}
                                    </View>
                                    <Text style={styles.checkboxLabel}>Seleccionar</Text>
                                  </Pressable>
                                  <View style={styles.pendingOrderDetails}>
                                    <Text style={styles.pendingOrderNumber}>{order.order_number}</Text>
                                    <Text style={styles.pendingOrderText}>Estado: {order.state}</Text>
                                    {order.reasons.includes('operational') && (
                                      <Text style={styles.pendingOrderReason}>Pendiente de completar</Text>
                                    )}
                                    {order.reasons.includes('balance') && (
                                      <Text style={styles.pendingOrderReason}>
                                        Saldo por cobrar: {formatCurrency(order.remaining_balance)}
                                      </Text>
                                    )}
                                    {order.version === null && (
                                      <Text style={styles.pendingWarning}>
                                        Esta orden no tiene una versión verificable y no se puede seleccionar.
                                      </Text>
                                    )}
                                  </View>
                                </View>
                              );
                            })}
                            {pendingOrders.count > pendingOrders.limit && (
                              <View style={styles.pagination}>
                                <Button
                                  title="Anterior"
                                  variant="outline"
                                  size="md"
                                  style={{ minHeight: 44 }}
                                  disabled={pendingPage <= 1 || pendingQuery.isFetching}
                                  onPress={() => setPendingPage((page) => Math.max(1, page - 1))}
                                />
                                <Text accessibilityLiveRegion="polite">
                                  Página {pendingPage} de {pendingPageCount}
                                </Text>
                                <Button
                                  title="Siguiente"
                                  variant="outline"
                                  size="md"
                                  style={{ minHeight: 44 }}
                                  disabled={pendingPage >= pendingPageCount || pendingQuery.isFetching}
                                  onPress={() => setPendingPage((page) => Math.min(pendingPageCount, page + 1))}
                                />
                              </View>
                            )}
                            {selectedOrderList.length > 0 && (
                              <View style={styles.pendingActions}>
                                <Text accessibilityLiveRegion="polite">
                                  {selectedOrderList.length} órdenes seleccionadas
                                </Text>
                                <Button
                                  title={pendingAction === 'preview' ? 'Revisando…' : 'Revisar elegibilidad'}
                                  variant="secondary"
                                  size="md"
                                  style={{ minHeight: 44 }}
                                  disabled={pendingAction !== null}
                                  loading={pendingAction === 'preview'}
                                  onPress={previewSelectedOrders}
                                />
                              </View>
                            )}
                          </View>
                        )}
                      </>
                    )}

                    {preview && (
                      <View style={styles.previewBlock}>
                        <Text style={styles.pendingTitle} accessibilityRole="header">
                          Revisión para completar órdenes
                        </Text>
                        <Text accessibilityLiveRegion="polite">
                          {preview.eligible} elegibles · {preview.ineligible} no elegibles
                        </Text>
                        <Text style={styles.pendingNote}>
                          Completar una orden no registra un cobro ni confirma una entrega.
                        </Text>
                        {preview.items.map((item) => (
                          <Text
                            key={item.id}
                            style={styles.previewItem}
                            accessibilityLabel={`${item.order_number}: ${item.eligible ? 'elegible para finalizar' : item.reasons.join(' ')}. ${item.effects.join(' ')}`}
                          >
                            {item.order_number}: {item.eligible ? 'Elegible para finalizar' : item.reasons.join(' ')}
                            {item.effects.length > 0 ? ` · ${item.effects.join(' · ')}` : ''}
                          </Text>
                        ))}
                        {preview.eligible > 0 && (
                          <Button
                            title={pendingAction === 'finish' ? 'Finalizando…' : `Finalizar ${preview.eligible} elegibles`}
                            variant="outline"
                            size="lg"
                            disabled={pendingAction !== null || !reason}
                            loading={pendingAction === 'finish'}
                            onPress={finishEligibleOrders}
                          />
                        )}
                      </View>
                    )}

                    {selectedOrderList.length > 0 && (
                      <View style={styles.field}>
                        <Text style={styles.sectionLabel}>
                          MOTIVO PARA FINALIZAR LAS ÓRDENES{' '}
                          <Text style={styles.required}>*</Text>
                        </Text>
                        <TextInput
                          style={styles.reasonInput}
                          value={decisionReason}
                          onChangeText={setDecisionReason}
                          placeholder="Escribe el motivo"
                          placeholderTextColor={colorScales.gray[400]}
                          maxLength={500}
                          multiline
                          accessibilityLabel="Motivo para finalizar las órdenes"
                          accessibilityHint="Campo obligatorio para finalizar órdenes o cerrar con pendientes"
                        />
                      </View>
                    )}
                  </View>
                )}

                <View style={styles.summaryBlock}>
                  <Text style={styles.sectionLabel}>RESUMEN DE CAJA</Text>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Apertura</Text>
                    <Text style={styles.summaryValue}>{formatCurrency(session.opening_amount)}</Text>
                  </View>
                  {movementsLoading ? (
                    <View style={styles.summaryLoading}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={styles.summaryLoadingText}>Cargando movimientos…</Text>
                    </View>
                  ) : (
                    salesByMethod.map((row) => (
                      <View key={row.method} style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>
                          Ventas · {row.method} ({row.count})
                        </Text>
                        <Text style={styles.summaryValuePositive}>
                          +{formatCurrency(row.total)}
                        </Text>
                      </View>
                    ))
                  )}
                  {cashSummaryQuery.isLoading ? (
                    <View style={styles.summaryLoading}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={styles.summaryLoadingText}>Actualizando efectivo…</Text>
                    </View>
                  ) : null}
                  {cashSummaryQuery.isError && (
                    <View>
                      <Text style={styles.pendingWarning} accessibilityRole="alert">
                        No pudimos actualizar el efectivo esperado. El cierre queda bloqueado hasta reintentar.
                      </Text>
                      <Button
                        title="Reintentar resumen de efectivo"
                        variant="outline"
                        size="md"
                        style={{ minHeight: 44 }}
                        onPress={() => cashSummaryQuery.refetch()}
                      />
                    </View>
                  )}
                  <View style={[styles.summaryRow, styles.summaryRowTotal]}>
                    <Text style={styles.summaryLabelTotal}>Efectivo esperado en caja</Text>
                    <Text style={styles.summaryValueTotal}>{formatCurrency(expected)}</Text>
                  </View>
                </View>

                {expectedChanged && (
                  <View style={styles.pendingWarning}>
                    <Text
                      style={styles.pendingWarningText}
                      accessibilityRole="alert"
                      accessibilityLiveRegion="assertive"
                    >
                      El efectivo esperado cambió mientras contabas. Revisa el nuevo valor y vuelve a contar.
                    </Text>
                    <Text style={styles.pendingWarningText}>
                      {formatCurrency(expectedCountedAgainst)} → {formatCurrency(cashSummaryQuery.data?.expected_cash_total)}
                    </Text>
                    <Button
                      title="Revisé el monto y volveré a contar"
                      variant="outline"
                      size="md"
                      style={{ minHeight: 44 }}
                      onPress={acknowledgeCashChange}
                    />
                  </View>
                )}

                <View style={styles.field}>
                  <Text style={styles.sectionLabel}>
                    CONTEO REAL DE EFECTIVO <Text style={styles.required}>*</Text>
                  </Text>
                  <TextInput
                    style={styles.actualInput}
                    value={actualText}
                    onChangeText={setActualText}
                    placeholder="0"
                    placeholderTextColor={colorScales.gray[400]}
                    keyboardType="decimal-pad"
                  />
                  {diffBadge && (
                    <View style={[styles.diffBadge, { backgroundColor: diffBadge.bg }]}>
                      <Text style={[styles.diffBadgeText, { color: diffBadge.color }]}>
                        {diffBadge.label}
                      </Text>
                    </View>
                  )}
                </View>

                <View style={styles.field}>
                  <Text style={styles.sectionLabel}>NOTAS DE CIERRE</Text>
                  <TextInput
                    style={styles.notesInput}
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="Opcional — comentarios sobre el cierre…"
                    placeholderTextColor={colorScales.gray[400]}
                    multiline
                    numberOfLines={3}
                    textAlignVertical="top"
                  />
                </View>
              </ScrollView>

              <View style={styles.footer}>
                <Pressable
                  style={styles.cancelBtn}
                  onPress={handleClose}
                  disabled={closeMutation.isPending}
                  accessibilityRole="button"
                  accessibilityLabel="Cancelar cierre de caja"
                >
                  <Text style={styles.cancelBtnText}>Cancelar</Text>
                </Pressable>
                <View style={styles.submitBtn}>
                  <Button
                    title={closeMutation.isPending ? 'Cerrando…' : isRefreshingClose ? 'Verificando…' : 'Cerrar caja'}
                    onPress={refreshBeforeClose}
                    disabled={!canSubmitClose || isRefreshingClose}
                    loading={closeMutation.isPending || isRefreshingClose}
                    size="lg"
                  />
                </View>
              </View>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
    <Modal
      visible={pendingCloseWarning !== null}
      transparent
      animationType="fade"
      onRequestClose={() => setPendingCloseWarning(null)}
      statusBarTranslucent
    >
      <View style={styles.confirmBackdrop}>
        <View style={styles.confirmSurface} accessibilityRole="alert">
          <Icon name="alert-triangle" size={64} color={colorScales.amber[600]} />
          <Text style={styles.confirmTitle}>Órdenes pendientes</Text>
          <Text style={styles.confirmText}>
            Hay {pendingCloseWarning?.count ?? 0}{' '}
            {(pendingCloseWarning?.count ?? 0) === 1 ? 'orden pendiente' : 'órdenes pendientes'} de esta sesión.
            Si cierras la caja, seguirán pendientes y no se sumarán al efectivo esperado.
          </Text>
          <Text style={styles.confirmText}>¿Deseas cerrar la caja de todas formas?</Text>
          <View style={styles.confirmActions}>
            <Button
              title="Volver"
              variant="outline"
              size="md"
              style={{ minHeight: 44, flex: 1 }}
              onPress={() => setPendingCloseWarning(null)}
            />
            <Button
              title="Cerrar caja"
              variant="primary"
              size="md"
              style={{ minHeight: 44, flex: 1 }}
              onPress={confirmPendingClose}
            />
          </View>
        </View>
      </View>
    </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  confirmBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[4],
  },
  confirmSurface: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[5],
    borderRadius: borderRadius.xl,
    backgroundColor: colors.background,
  },
  confirmTitle: {
    color: colorScales.gray[900],
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    textAlign: 'center',
  },
  confirmText: {
    color: colorScales.gray[700],
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    lineHeight: 22,
    textAlign: 'center',
  },
  confirmActions: {
    width: '100%',
    flexDirection: 'row',
    gap: spacing[2],
    marginTop: spacing[2],
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
    maxHeight: '85%',
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
  emptyBody: {
    padding: spacing[8],
    gap: spacing[3],
    alignItems: 'center',
  },
  emptyText: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
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
    borderRadius: borderRadius.full,
    backgroundColor: colorScales.red[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  headerSubtitle: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    maxHeight: 480,
  },
  infoRow: {
    flexDirection: 'row',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
  },
  infoCard: {
    flex: 1,
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    backgroundColor: colorScales.gray[50],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  infoLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    marginBottom: spacing[1],
  },
  infoValue: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  infoValueSmall: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  summaryBlock: {
    marginHorizontal: spacing[4],
    marginTop: spacing[4],
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    backgroundColor: colorScales.gray[50],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    gap: spacing[2],
  },
  sectionLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[600],
  },
  summaryValue: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  summaryValuePositive: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.green[700],
  },
  summaryRowTotal: {
    marginTop: spacing[2],
    paddingTop: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
  summaryLabelTotal: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  summaryValueTotal: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  summaryLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  summaryLoadingText: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  pendingPanel: {
    marginHorizontal: spacing[4],
    marginTop: spacing[4],
    padding: spacing[3],
    gap: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: colorScales.gray[50],
  },
  pendingWarning: {
    gap: spacing[1],
    padding: spacing[3],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.amber[300],
    backgroundColor: colorScales.amber[50],
  },
  pendingWarningText: {
    color: colorScales.amber[800],
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
  },
  pendingTitle: {
    color: colorScales.gray[900],
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
  },
  pendingSummary: {
    color: colorScales.gray[900],
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
  },
  pendingNote: {
    color: colorScales.gray[600],
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
  },
  pendingToggle: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing[2],
  },
  pendingToggleText: {
    color: colors.primary,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
  },
  pendingOrderRow: {
    flexDirection: 'column',
    gap: spacing[2],
    paddingVertical: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
  orderCheckbox: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 1,
    borderColor: colorScales.gray[400],
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  checkboxSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkboxMark: {
    color: colors.background,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold as any,
  },
  checkboxLabel: {
    flex: 1,
    color: colorScales.gray[800],
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
  },
  pendingOrderDetails: {
    gap: spacing[1],
    paddingLeft: spacing[1],
  },
  pendingOrderNumber: {
    color: colorScales.gray[900],
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
  },
  pendingOrderText: {
    color: colorScales.gray[700],
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
  },
  pendingOrderReason: {
    color: colorScales.gray[600],
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
  },
  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
    paddingVertical: spacing[2],
  },
  pendingActions: {
    gap: spacing[2],
    paddingTop: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
  previewBlock: {
    padding: spacing[3],
    gap: spacing[2],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.background,
  },
  previewItem: {
    color: colorScales.gray[700],
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
  },
  reasonInput: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    color: colorScales.gray[900],
    backgroundColor: colors.background,
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    textAlignVertical: 'top',
  },
  field: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[2],
    gap: spacing[2],
  },
  required: {
    color: colors.error,
  },
  actualInput: {
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    fontSize: typography.fontSize.xl,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    backgroundColor: colorScales.gray[50],
    textAlign: 'center',
    fontWeight: typography.fontWeight.semibold as any,
  },
  diffBadge: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
    alignItems: 'center',
  },
  diffBadgeText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
  },
  notesInput: {
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    backgroundColor: colorScales.gray[50],
    minHeight: 80,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    backgroundColor: colors.background,
    gap: spacing[3],
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: colorScales.gray[800],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3],
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: '#FFFFFF',
  },
  submitBtn: {
    flex: 1.4,
  },
});

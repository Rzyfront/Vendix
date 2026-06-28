import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  Animated,
  StyleSheet,
  Dimensions,
  type View as ViewType,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, spacing, typography, borderRadius, shadows } from '@/shared/theme';
import type { PosCustomer, PosMode } from '@/features/store/types';
import type { CashRegisterSession } from '../services/cash-register.service';

interface PosScreenHeaderProps {
  /** Modo actual del POS — controla título + badge. */
  mode: PosMode;
  /** Cliente seleccionado (muestra chip a la derecha). */
  customer: PosCustomer | null;
  /** Click en el chip de cliente (abre `PosCustomerModal`). */
  onOpenCustomer: () => void;
  /** Limpiar el cliente seleccionado. */
  onClearCustomer: () => void;
  /** Cambia el modo del POS. */
  onChangeMode: (mode: PosMode) => void;
  /** Total del carrito (mostrado en el badge del CTA si > 0). */
  cartItemCount?: number;
  /** Sesión de caja activa (null = no hay caja abierta). */
  cashSession?: CashRegisterSession | null;
  /** Si el feature de caja registradora está habilitado en la tienda. */
  showCashOpenButton?: boolean;
  /** Abrir modal de Abrir Caja (cuando no hay sesión). */
  onOpenCashRegister: () => void;
  /** Abrir modal de Detalle de Caja. */
  onOpenCashDetail: () => void;
  /** Abrir modal de Movimiento de Caja (+/−). */
  onOpenCashMovement: () => void;
  /** Abrir modal de Cerrar Caja. */
  onOpenCashClose: () => void;
}

// ── Mode metadata (paridad con `pos.component.ts` web) ────────────────────

interface ModeMeta {
  title: string;
  subtitle: string;
  badgeLabel: string;
  badgeVariant: 'primary' | 'warning' | 'success';
  primaryCta: string;
  primaryCtaIcon: string;
}

const MODE_META: Record<PosMode, ModeMeta> = {
  sale: {
    title: 'POS',
    subtitle: 'Punto de venta',
    badgeLabel: 'Punto de venta',
    badgeVariant: 'success',
    primaryCta: 'Cobrar',
    primaryCtaIcon: 'credit-card',
  },
  quotation: {
    title: 'Modo Cotización',
    subtitle: 'Crear cotización',
    badgeLabel: 'Crear cotización',
    badgeVariant: 'primary',
    primaryCta: 'Crear cotización',
    primaryCtaIcon: 'file-text',
  },
  layaway: {
    title: 'Modo Plan Separé',
    subtitle: 'Crear plan separé',
    badgeLabel: 'Crear plan separé',
    badgeVariant: 'warning',
    primaryCta: 'Crear plan separé',
    primaryCtaIcon: 'calendar-clock',
  },
};

const BADGE_COLORS = {
  primary: { bg: 'rgba(34, 197, 94, 0.12)', fg: colors.primary, border: 'rgba(34, 197, 94, 0.3)' },
  success: { bg: 'rgba(22, 163, 74, 0.12)', fg: colorScales.green[600], border: 'rgba(22, 163, 74, 0.3)' },
  warning: { bg: 'rgba(245, 158, 11, 0.12)', fg: colorScales.amber[600], border: 'rgba(245, 158, 11, 0.3)' },
} as const;

// Brand light green — paridad con Tailwind `bg-primary/20` del web.
// En el web `bg-primary/20` resuelve a `rgba(126, 215, 165, 0.2)` porque
// `primary.500 = #7ED7A5`. En mobile lo representamos con `primaryDark`.
const BRAND_LIGHT_GREEN = '#7ED7A5';
const BRAND_LIGHT_GREEN_22 = 'rgba(126, 215, 165, 0.22)'; // bg avatar primary/20
const BRAND_LIGHT_GREEN_18 = 'rgba(126, 215, 165, 0.18)'; // pressed state
const BRAND_LIGHT_GREEN_10 = 'rgba(126, 215, 165, 0.10)'; // gradient layer izq
const BRAND_LIGHT_GREEN_04 = 'rgba(126, 215, 165, 0.04)'; // gradient base

const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_MARGIN = 12;
// Paridad con web `w-72` (288px). En pantallas chicas (≤320px) dejamos 280px max
// para evitar que el dropdown se salga de la pantalla.
const DROPDOWN_WIDTH = Math.min(280, SCREEN_WIDTH - SCREEN_MARGIN * 2);
const DROPDOWN_GAP = 8;

/** Formato corto de hora para el header de la sesión (paridad web `date: 'shortTime'`). */
function formatCashTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('es-CO', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

/** Dispara haptic feedback ligero — usado en todas las interacciones del dropdown. */
function triggerHaptic(style: 'light' | 'medium' = 'light'): void {
  try {
    Haptics.impactAsync(
      style === 'light'
        ? Haptics.ImpactFeedbackStyle.Light
        : Haptics.ImpactFeedbackStyle.Medium,
    );
  } catch {
    // Haptics no disponible (web, simulator): silencioso.
  }
}

/**
 * Pulse dot animado — paridad con `animate-ping` de Tailwind en la web.
 * El anillo exterior crece y se desvanece en loop, mientras el dot interior
 * queda estático. Pulsa cada 1.4s (mismo timing que Tailwind por defecto).
 *
 * `size` controla el dot interior; el ping se expande 2.4× desde ahí.
 */
function CashPulseDot({
  color = colorScales.green[500],
  size = 10,
}: {
  color?: string;
  size?: number;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.parallel([
        Animated.timing(scale, {
          toValue: 2.4,
          duration: 1400,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 1400,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [scale, opacity]);

  const wrapStyle = { width: size, height: size };
  const pingStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
  };
  const dotStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
  };

  return (
    <View style={[pulseStyles.wrap, wrapStyle]}>
      <Animated.View
        style={[
          pulseStyles.ping,
          pingStyle,
          { backgroundColor: color, transform: [{ scale }], opacity },
        ]}
      />
      <View style={[pulseStyles.dot, dotStyle, { backgroundColor: color }]} />
    </View>
  );
}

const pulseStyles = StyleSheet.create({
  wrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ping: {
    position: 'absolute',
  },
  dot: {},
});

/**
 * Pressable premium — `active:scale-95` + opacity + Haptics.
 * Paridad con el feedback de la web (`active:scale-95 transition-all`).
 * Usa `Animated.spring` con bounciness 0 para que el rebote sea sutil.
 */
function ScalePressable({
  baseStyle,
  pressedStyle,
  onPress,
  onLongPress,
  children,
  haptic = 'light',
  hitSlop,
  disabled,
}: {
  baseStyle?: any;
  pressedStyle?: any;
  onPress?: () => void;
  onLongPress?: () => void;
  children: React.ReactNode;
  haptic?: 'light' | 'medium' | 'none';
  hitSlop?: number;
  disabled?: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = (toValue: number) => {
    Animated.spring(scale, {
      toValue,
      useNativeDriver: true,
      speed: 50,
      bounciness: 0,
    }).start();
  };

  const handlePressIn = () => {
    animateTo(0.95);
  };

  const handlePressOut = () => {
    animateTo(1);
  };

  const handlePress = () => {
    if (haptic !== 'none') triggerHaptic(haptic);
    onPress?.();
  };

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onLongPress={onLongPress}
        hitSlop={hitSlop}
        disabled={disabled}
        style={({ pressed }) => [
          baseStyle,
          pressed && (pressedStyle ?? { opacity: 0.85 }),
        ]}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

/**
 * Header específico del POS — paridad con el bloque inline del web
 * `pos.component.ts` (líneas 159-209):
 *
 * ```
 * [🛍 Vendix] POS                    [customer chip] [⋯ modes]
 *         [Punto de venta badge]
 * ```
 *
 * - **Logo tile**: 40×40, `bg-primary/10`, `shopping-bag` icon (espejo de
 *   `<div class="w-10 h-10 rounded-xl bg-primary/10">`).
 * - **Title**: varía por modo (`POS` / `Modo Cotización` / `Modo Plan Separé`).
 * - **Badge**: pill `xs` con variante `primary | warning | success`.
 * - **Customer chip**: avatar + nombre + email + X para limpiar — mismo
 *   patrón que el chip del header web (gradient `from-primary-light/50
 *   to-primary-light/30`).
 * - **Mode switcher**: ícono `more-horizontal` (⋮) que abre un popover con
 *   las 3 opciones — espejo del dropdown de modos del web.
 * - **iOS-blur**: aproximado con `rgba(255,255,255,0.92)` + `border-bottom`
 *   + `shadow-sm` (RN no soporta `backdrop-filter` cross-platform).
 *
 * @see `apps/frontend/src/app/private/modules/store/pos/pos.component.ts`
 */
export function PosScreenHeader({
  mode,
  customer,
  onOpenCustomer,
  onClearCustomer,
  onChangeMode,
  cartItemCount,
  cashSession,
  showCashOpenButton,
  onOpenCashRegister,
  onOpenCashDetail,
  onOpenCashMovement,
  onOpenCashClose,
}: PosScreenHeaderProps) {
  const insets = useSafeAreaInsets();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [triggerPos, setTriggerPos] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const triggerRef = useRef<ViewType>(null);

  const meta = MODE_META[mode];
  const badgeColors = BADGE_COLORS[meta.badgeVariant];

  const handleOpenDropdown = () => {
    const node = triggerRef.current;
    if (!node) return;
    if (dropdownOpen) {
      setDropdownOpen(false);
      return;
    }
    node.measureInWindow((x, y, width, height) => {
      setTriggerPos({ x, y, width, height });
      setDropdownOpen(true);
    });
  };

  const handleSelectMode = (next: PosMode) => {
    setDropdownOpen(false);
    setTimeout(() => onChangeMode(next), 120);
  };

  // Dropdown position (right-aligned, mirrors RowActionsMenu pattern)
  const dropdownPosition = (() => {
    if (!triggerPos) return null;
    let left = triggerPos.x + triggerPos.width - DROPDOWN_WIDTH;
    if (left < SCREEN_MARGIN) left = SCREEN_MARGIN;
    if (left + DROPDOWN_WIDTH > SCREEN_WIDTH - SCREEN_MARGIN) {
      left = SCREEN_WIDTH - DROPDOWN_WIDTH - SCREEN_MARGIN;
    }
    return { top: triggerPos.y + triggerPos.height + DROPDOWN_GAP, left };
  })();

  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing[2] }]}>
      {/* ── Left: Logo + Title + Badge ── */}
      <View style={styles.left}>
        <View style={styles.logoTile}>
          <Icon name="shopping-bag" size={20} color={colors.primary} />
        </View>
        <Pressable
          style={({ pressed }) => [styles.titleStack, pressed && { opacity: 0.75 }]}
          onPress={() => setModeMenuOpen(true)}
        >
          <Text style={styles.title} numberOfLines={1}>
            {meta.title}
          </Text>
          <View style={[styles.badge, { backgroundColor: badgeColors.bg, borderColor: badgeColors.border }]}>
            <Text style={[styles.badgeText, { color: badgeColors.fg }]} numberOfLines={1}>
              {meta.badgeLabel}
            </Text>
          </View>
        </Pressable>
      </View>

      {/* ── Right: Web-parity Compact Dropdown Trigger ── */}
      <View style={styles.right}>
        <Pressable
          ref={triggerRef}
          collapsable={false}
          onPress={() => {
            triggerHaptic('light');
            handleOpenDropdown();
          }}
          style={({ pressed }) => [
            styles.dropdownTrigger,
            pressed && { opacity: 0.85, transform: [{ scale: 0.96 }] },
            dropdownOpen && styles.dropdownTriggerActive,
          ]}
        >
          {/* Customer avatar if selected */}
          {customer && (
            <View style={styles.avatarPill}>
              <Icon name="user" size={12} color={colors.primary} />
            </View>
          )}

          {/* Cash register dot — verde pulsante si hay sesión abierta, ámbar
              si la feature está habilitada pero no hay sesión. */}
          {cashSession?.status === 'open' ? (
            // Paridad web: dot pulsante también en el trigger (no solo en la sección).
            <CashPulseDot color={colorScales.green[500]} size={8} />
          ) : showCashOpenButton ? (
            <View style={[styles.statusDot, { backgroundColor: colorScales.amber[400] }]} />
          ) : (
            <View style={[styles.statusDot, { backgroundColor: colorScales.green[500] }]} />
          )}

          {/* Chevron */}
          <Icon
            name="chevron-down"
            size={14}
            color={colorScales.gray[500]}
            strokeWidth={2.25}
            style={{ transform: [{ rotate: dropdownOpen ? '180deg' : '0deg' }] }}
          />
        </Pressable>
      </View>

      {/* ── Mode switcher popover ── */}
      <Modal
        visible={dropdownOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDropdownOpen(false)}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={() => setDropdownOpen(false)}>
          {dropdownPosition && (
            <Pressable
              style={[styles.dropdown, { top: dropdownPosition.top, left: dropdownPosition.left }]}
              onPress={(e) => e.stopPropagation()}
            >
              {/* 1. Customer Section (only if selected) — paridad con web:
                  bg gradient + border-b, clickable con feedback pressed. */}
              {customer && (
                <View style={styles.customerSection}>
                  {/* Gradient sutil del web `from-primary-light/50 to-primary-light/30`.
                      2 capas con alphas del brand light green (#7ed7a5). */}
                  <View style={styles.customerSectionGradientLayer} pointerEvents="none" />
                  <Pressable
                    style={({ pressed }) => [
                      styles.customerInfo,
                      pressed && styles.customerInfoPressed,
                    ]}
                    onPress={() => {
                      setDropdownOpen(false);
                      onOpenCustomer();
                    }}
                  >
                    <View style={styles.customerAvatarLarge}>
                      <Icon name="user" size={16} color={colors.primary} />
                    </View>
                    <View style={styles.customerText}>
                      <Text style={styles.customerNameLarge} numberOfLines={1}>
                        {customer.first_name} {customer.last_name}
                      </Text>
                      {customer.email ? (
                        <Text style={styles.customerEmailLarge} numberOfLines={1}>
                          {customer.email}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                  <Pressable
                    hitSlop={8}
                    onPress={() => {
                      onClearCustomer();
                    }}
                    style={({ pressed }) => [
                      styles.customerClearBtn,
                      pressed && styles.customerClearBtnPressed,
                    ]}
                  >
                    <Icon name="x" size={14} color={colorScales.gray[400]} />
                  </Pressable>
                </View>
              )}

              {/* 2. Schedule Section — clickable con feedback pressed (paridad web
                  `cursor-pointer hover:bg-surface/60`). */}
              <Pressable
                style={({ pressed }) => [
                  styles.scheduleSection,
                  pressed && styles.scheduleSectionPressed,
                ]}
                onPress={() => {
                  setDropdownOpen(false);
                  // Web abre `pos-schedule-modal.component` — placeholder.
                  // TODO: conectar cuando se cree el modal de horarios en mobile.
                  // toastInfo('Horarios (Próximamente)');
                }}
              >
                <View style={[styles.statusDotLarge, { backgroundColor: colorScales.green[500] }]} />
                <View style={styles.scheduleText}>
                  <Text style={styles.scheduleStatusText}>En servicio</Text>
                  <Text style={styles.scheduleHoursText}>08:00 – 20:00</Text>
                </View>
                <Icon name="clock" size={14} color={colorScales.green[500]} />
              </Pressable>

              {/* 3. Cash Register Section — paridad con `pos-header-dropdown.component.ts` web:
                   - Sesión ABIERTA → 3 botones (Detalle verde / +/− azul / Cerrar rojo)
                   - Sin sesión + feature habilitado → botón "Abrir caja" ámbar
                   - Sin sesión + feature deshabilitado → no se renderiza la sección */}
              {cashSession?.status === 'open' ? (
                <View style={styles.cashSection}>
                  <View style={styles.cashHeader}>
                    <CashPulseDot color={colorScales.green[500]} size={10} />
                    <Text style={styles.cashTitle} numberOfLines={1}>
                      {cashSession.register?.name || 'Caja Principal'}
                    </Text>
                    <Text style={styles.cashTime}>
                      {formatCashTime(cashSession.opened_at)}
                    </Text>
                  </View>
                  <View style={styles.cashActions}>
                    <ScalePressable
                      baseStyle={[styles.cashBtn, styles.cashBtnDetail]}
                      onPress={() => {
                        setDropdownOpen(false);
                        onOpenCashDetail();
                      }}
                    >
                      <Icon name="receipt" size={15} color={colorScales.green[700]} strokeWidth={2.25} />
                      <Text style={[styles.cashBtnText, { color: colorScales.green[700] }]}>
                        Detalle
                      </Text>
                    </ScalePressable>
                    <ScalePressable
                      baseStyle={[styles.cashBtn, styles.cashBtnMovement]}
                      onPress={() => {
                        setDropdownOpen(false);
                        onOpenCashMovement();
                      }}
                    >
                      <Icon name="wallet" size={15} color={colorScales.blue[600]} strokeWidth={2.25} />
                      <Text style={[styles.cashBtnText, { color: colorScales.blue[600] }]}>
                        Mov.
                      </Text>
                    </ScalePressable>
                    <ScalePressable
                      baseStyle={[styles.cashBtn, styles.cashBtnClose]}
                      onPress={() => {
                        setDropdownOpen(false);
                        onOpenCashClose();
                      }}
                    >
                      <Icon name="lock" size={15} color={colorScales.red[600]} strokeWidth={2.25} />
                      <Text style={[styles.cashBtnText, { color: colorScales.red[600] }]}>
                        Cerrar
                      </Text>
                    </ScalePressable>
                  </View>
                </View>
              ) : showCashOpenButton ? (
                <View style={styles.cashSection}>
                  <ScalePressable
                    baseStyle={styles.cashOpenBtn}
                    onPress={() => {
                      setDropdownOpen(false);
                      onOpenCashRegister();
                    }}
                  >
                    <Icon name="lock" size={15} color={colorScales.amber[700]} strokeWidth={2.25} />
                    <Text style={styles.cashOpenBtnText}>Abrir caja</Text>
                  </ScalePressable>
                </View>
              ) : null}
            </Pressable>
          )}
        </Pressable>
      </Modal>

      {/* ── Center Mode Switcher Modal ── */}
      <Modal
        visible={modeMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setModeMenuOpen(false)}
        statusBarTranslucent
      >
        <Pressable style={styles.modalOverlay} onPress={() => setModeMenuOpen(false)}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalHeaderTitle}>Seleccionar Modo POS</Text>
            </View>
            <View style={styles.modalList}>
              {(Object.keys(MODE_META) as PosMode[]).map((m) => {
                const mMeta = MODE_META[m];
                const isActive = m === mode;
                return (
                  <Pressable
                    key={m}
                    onPress={() => {
                      setModeMenuOpen(false);
                      onChangeMode(m);
                    }}
                    style={({ pressed }) => [
                      styles.modalItem,
                      pressed && styles.modalItemPressed,
                      isActive && styles.modalItemActive,
                    ]}
                  >
                    <Icon
                      name={mMeta.primaryCtaIcon}
                      size={18}
                      color={isActive ? colors.primary : colorScales.gray[700]}
                    />
                    <View style={styles.modalItemTextContainer}>
                      <Text
                        style={[
                          styles.modalItemLabel,
                          isActive && styles.modalItemLabelActive,
                        ]}
                      >
                        {mMeta.title}
                      </Text>
                      <Text style={styles.modalItemSublabel}>{mMeta.subtitle}</Text>
                    </View>
                    {isActive && <Icon name="check" size={16} color={colors.primary} />}
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
    gap: spacing[3],
    ...shadows.sm,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    flex: 1,
    minWidth: 0,
  },
  logoTile: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    backgroundColor: 'rgba(34, 197, 94, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  titleStack: {
    flexDirection: 'column',
    gap: 3,
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colors.text.primary,
    letterSpacing: -0.2,
    lineHeight: 20,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: typography.fontWeight.semibold,
    letterSpacing: 0.2,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    flexShrink: 0,
  },
  dropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    minHeight: 36,
  },
  // Wrapper invisible del trigger — web NO tiene elevation, solo border.
  // Mantenemos ScalePressable wrapper (para animación + haptic) pero sin
  // sombra ni halo extras que hacen al mobile verse "barato" vs web premium.
  dropdownTriggerWrapper: {
    borderRadius: borderRadius.xl,
    backgroundColor: 'transparent',
  },
  dropdownTriggerPressed: {
    opacity: 0.85,
  },
  dropdownTriggerActive: {
    backgroundColor: colorScales.gray[50],
    borderColor: colorScales.gray[300],
  },
  avatarPill: {
    width: 24,
    height: 24,
    borderRadius: 12,
    // Paridad web `bg-primary/20` = brand light green con 20% alpha.
    backgroundColor: BRAND_LIGHT_GREEN_22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
  },
  dropdown: {
    position: 'absolute',
    width: DROPDOWN_WIDTH,
    backgroundColor: colors.background,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    // Sombra premium — paridad con Tailwind `shadow-lg`:
    // `0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)`
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 10,
  },
  customerSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing[3],
    // Gradient del web `from-primary-light/50 to-primary-light/30`:
    // usa el brand light green con alpha BAJA (sutil).
    backgroundColor: BRAND_LIGHT_GREEN_04,
    overflow: 'hidden',
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  // Capa izquierda del "gradient" — más opacidad que se desvanece a la derecha.
  customerSectionGradientLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: '85%',
    backgroundColor: BRAND_LIGHT_GREEN_10,
  },
  customerInfoPressed: {
    backgroundColor: BRAND_LIGHT_GREEN_18,
  },
  customerClearBtnPressed: {
    backgroundColor: colorScales.gray[100],
  },
  scheduleSectionPressed: {
    backgroundColor: colorScales.gray[50],
  },
  customerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    flex: 1,
    minWidth: 0,
  },
  customerAvatarLarge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    // Paridad web `bg-primary/20` = brand light green con 20% alpha.
    backgroundColor: BRAND_LIGHT_GREEN_22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customerText: {
    flex: 1,
    minWidth: 0,
  },
  customerNameLarge: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
    lineHeight: 16,
    letterSpacing: -0.1,
  },
  customerEmailLarge: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    lineHeight: 14,
    marginTop: 2,
    letterSpacing: 0,
  },
  customerClearBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    // Paridad web `hover:bg-surface/60` — bg transparente que se oscurece
    // ligeramente al presionar.
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduleSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    padding: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  scheduleText: {
    flex: 1,
  },
  statusDotLarge: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  scheduleStatusText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.green[700],
    letterSpacing: -0.1,
  },
  scheduleHoursText: {
    fontSize: typography.fontSize.xs,
    color: colorScales.green[600] + 'cc',
    marginTop: 1,
    letterSpacing: 0,
  },
  cashSection: {
    padding: spacing[3],
    // El web NO tiene border-bottom en esta sección — solo customer y schedule.
    gap: spacing[2.5],
    // Sin tint — el web hereda el `bg-surface` puro del container.
    backgroundColor: colors.background,
  },
  cashHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  cashTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.green[700],
    flex: 1,
    letterSpacing: -0.1,
  },
  cashTime: {
    fontSize: typography.fontSize.xs,
    color: colorScales.green[600] + 'cc',
    fontWeight: typography.fontWeight.medium,
  },
  cashActions: {
    flexDirection: 'row',
    gap: spacing[1.5],
  },
  cashBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    minHeight: 38,
    paddingHorizontal: 4,
    borderRadius: borderRadius.md,
  },
  cashBtnDetail: {
    backgroundColor: 'rgba(22, 163, 74, 0.10)',
  },
  cashBtnMovement: {
    backgroundColor: 'rgba(37, 99, 235, 0.10)',
  },
  cashBtnClose: {
    backgroundColor: 'rgba(239, 68, 68, 0.10)',
  },
  cashBtnText: {
    fontSize: typography.fontSize.xs, // 12px — más pequeño
    fontWeight: typography.fontWeight.normal, // sin negrita (400)
    fontFamily: typography.fontFamily,
    letterSpacing: 0,
  },
  cashOpenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    width: '100%',
    minHeight: 38,
    borderRadius: borderRadius.md,
    backgroundColor: 'rgba(245, 158, 11, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.25)',
  },
  cashOpenBtnText: {
    fontSize: typography.fontSize.xs, // 12px — más pequeño
    fontWeight: typography.fontWeight.normal, // sin negrita
    fontFamily: typography.fontFamily,
    color: colorScales.amber[700],
    letterSpacing: 0,
  },
  modesSection: {
    padding: spacing[3],
    gap: 4,
  },
  modesSectionTitle: {
    fontSize: 10,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[2.5],
    borderRadius: borderRadius.md,
  },
  dropdownItemPressed: {
    backgroundColor: colorScales.gray[50],
  },
  dropdownItemActive: {
    backgroundColor: 'rgba(34, 197, 94, 0.05)',
  },
  dropdownItemLabel: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colorScales.gray[700],
  },
  dropdownItemLabelActive: {
    color: colors.primary,
    fontWeight: typography.fontWeight.semibold,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: Math.min(300, SCREEN_WIDTH - 32),
    backgroundColor: colors.background,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    ...shadows.lg,
    padding: spacing[4],
  },
  modalHeader: {
    paddingBottom: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
    marginBottom: spacing[2],
  },
  modalHeaderTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[800],
  },
  modalList: {
    gap: spacing[1.5],
  },
  modalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.lg,
  },
  modalItemPressed: {
    backgroundColor: colorScales.gray[50],
  },
  modalItemActive: {
    backgroundColor: 'rgba(34, 197, 94, 0.05)',
  },
  modalItemTextContainer: {
    flex: 1,
  },
  modalItemLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colorScales.gray[700],
  },
  modalItemLabelActive: {
    color: colors.primary,
    fontWeight: typography.fontWeight.semibold,
  },
  modalItemSublabel: {
    fontSize: 10,
    color: colorScales.gray[500],
    marginTop: 1,
  },
});
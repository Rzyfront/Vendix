import { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  FlatList,
  Modal,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/shared/components/icon/icon';
import { Spinner } from '@/shared/components/spinner/spinner';
import { colors, colorScales, spacing, borderRadius, typography, shadows } from '@/shared/theme';
import { NotificationsService, AppNotification } from '@/features/notifications/notifications.service';

interface NotificationsModalProps {
  visible: boolean;
  onClose: () => void;
  onNavigate: (route: string) => void;
}

const ICON_MAP: Record<string, string> = {
  new_order: 'shopping-cart',
  order_status_change: 'refresh-cw',
  low_stock: 'alert-triangle',
  new_customer: 'user-plus',
  payment_received: 'credit-card',
  layaway_payment_received: 'credit-card',
  layaway_payment_reminder: 'clock',
  layaway_overdue: 'alert-triangle',
  layaway_completed: 'check-circle',
  layaway_cancelled: 'x-circle',
  installment_reminder: 'clock',
  installment_overdue: 'alert-triangle',
  installment_paid: 'check-circle',
  credit_completed: 'trophy',
};

function getIconForType(type: string): string {
  return ICON_MAP[type] || 'bell';
}

function formatTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const diff = Date.now() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);

    if (minutes < 1) return 'Ahora';
    if (minutes < 60) return `hace ${minutes}m`;
    if (hours < 24) return `hace ${hours}h`;
    return date.toLocaleDateString('es', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

function getRouteForNotification(n: AppNotification): string | null {
  const d = n.data;
  switch (n.type) {
    case 'new_order':
    case 'order_status_change':
    case 'payment_received':
      return d?.order_id ? `/orders/${d.order_id}` : '/orders';
    case 'new_customer':
      return d?.customer_id ? `/customers/${d.customer_id}` : '/customers';
    case 'low_stock':
      return d?.product_id ? `/products/${d.product_id}` : '/products';
    case 'layaway_payment_received':
    case 'layaway_payment_reminder':
    case 'layaway_overdue':
    case 'layaway_completed':
    case 'layaway_cancelled':
      return d?.plan_id ? `/orders/layaway/${d.plan_id}` : '/orders/layaway';
    default:
      return null;
  }
}

export function NotificationsModal({ visible, onClose, onNavigate }: NotificationsModalProps) {
  const insets = useSafeAreaInsets();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [notifs, count] = await Promise.all([
        NotificationsService.getNotifications(1, 20),
        NotificationsService.getUnreadCount(),
      ]);
      setNotifications(notifs.data || []);
      setUnreadCount(count);
    } catch {
      setNotifications([]);
      setUnreadCount(0);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      loadData();
    }
  }, [visible, loadData]);

  const handleMarkAllRead = useCallback(async () => {
    try {
      await NotificationsService.markAllRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch {
      // Silently fail
    }
  }, []);

  const handleNotificationPress = useCallback(async (n: AppNotification) => {
    if (!n.is_read) {
      try {
        await NotificationsService.markRead(n.id);
        setNotifications((prev) =>
          prev.map((item) => (item.id === n.id ? { ...item, is_read: true } : item))
        );
        setUnreadCount((c) => Math.max(0, c - 1));
      } catch {
        // Silently fail
      }
    }
    onClose();
    const route = getRouteForNotification(n);
    if (route) {
      onNavigate(route);
    }
  }, [onClose, onNavigate]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <View
          style={[
            styles.modal,
            { paddingBottom: insets.bottom || spacing[4] },
          ]}
          onStartShouldSetResponder={() => true}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Notificaciones</Text>
            {unreadCount > 0 && (
              <Pressable onPress={handleMarkAllRead} hitSlop={8}>
                <Text style={styles.markAllText}>Marcar todo leído</Text>
              </Pressable>
            )}
          </View>

          {/* List */}
          {isLoading ? (
            <View style={styles.loading}>
              <Spinner size="md" />
            </View>
          ) : notifications.length > 0 ? (
            <FlatList
              data={notifications}
              keyExtractor={(item) => item.id.toString()}
              renderItem={({ item }) => (
                <Pressable
                  style={[styles.item, !item.is_read && styles.itemUnread]}
                  onPress={() => handleNotificationPress(item)}
                >
                  <View style={[styles.itemIcon, { backgroundColor: getItemBgColor(item.type) }]}>
                    <Icon name={getIconForType(item.type)} size={16} color={getItemIconColor(item.type)} />
                  </View>
                  <View style={styles.itemContent}>
                    <Text style={styles.itemTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={styles.itemBody} numberOfLines={2}>
                      {item.body}
                    </Text>
                    <Text style={styles.itemTime}>{formatTime(item.created_at)}</Text>
                  </View>
                  {!item.is_read && <View style={styles.unreadDot} />}
                </Pressable>
              )}
              showsVerticalScrollIndicator={false}
            />
          ) : (
            <View style={styles.empty}>
              <Icon name="bell" size={32} color={colorScales.gray[300]} />
              <Text style={styles.emptyText}>Sin notificaciones</Text>
            </View>
          )}
        </View>
      </Pressable>
    </Modal>
  );
}

function getItemBgColor(type: string): string {
  const map: Record<string, string> = {
    new_order: colorScales.green[50],
    order_status_change: colorScales.blue[50],
    low_stock: colorScales.amber[50],
    new_customer: colorScales.blue[50],
    payment_received: colorScales.green[50],
    layaway_payment_received: colorScales.green[50],
    layaway_payment_reminder: colorScales.amber[50],
    layaway_overdue: colorScales.red[50],
    layaway_completed: colorScales.green[50],
    layaway_cancelled: colorScales.gray[50],
    installment_reminder: colorScales.amber[50],
    installment_overdue: colorScales.red[50],
    installment_paid: colorScales.green[50],
    credit_completed: colorScales.green[50],
  };
  return map[type] || colorScales.gray[50];
}

function getItemIconColor(type: string): string {
  const map: Record<string, string> = {
    new_order: colorScales.green[600],
    order_status_change: colorScales.blue[600],
    low_stock: colorScales.amber[600],
    new_customer: colorScales.blue[600],
    payment_received: colorScales.green[600],
    layaway_payment_received: colorScales.green[600],
    layaway_payment_reminder: colorScales.amber[600],
    layaway_overdue: colorScales.red[600],
    layaway_completed: colorScales.green[600],
    layaway_cancelled: colorScales.gray[600],
    installment_reminder: colorScales.amber[600],
    installment_overdue: colorScales.red[600],
    installment_paid: colorScales.green[600],
    credit_completed: colorScales.green[600],
  };
  return map[type] || colorScales.gray[600];
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: colors.background,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    maxHeight: Dimensions.get('window').height * 0.7,
    ...shadows.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  headerTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold as any,
    color: colorScales.gray[900],
  },
  markAllText: {
    fontSize: typography.fontSize.sm,
    color: colors.primary,
    fontWeight: typography.fontWeight.medium as any,
  },
  loading: {
    padding: spacing[8],
    alignItems: 'center',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing[3],
    paddingHorizontal: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[50],
    gap: spacing[3],
  },
  itemUnread: {
    backgroundColor: colorScales.blue[50],
  },
  itemIcon: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  itemContent: {
    flex: 1,
  },
  itemTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium as any,
    color: colorScales.gray[900],
  },
  itemBody: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  itemTime: {
    fontSize: 10,
    color: colorScales.gray[400],
    marginTop: 4,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginTop: 8,
    flexShrink: 0,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[12],
    gap: spacing[3],
  },
  emptyText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
  },
});

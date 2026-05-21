import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  Modal as RNModal,
  TouchableWithoutFeedback,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/core/store/auth.store';
import { AuthService } from '@/core/auth/auth.service';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';

interface UserDropdownModalProps {
  visible: boolean;
  onClose: () => void;
}

interface MenuOption {
  label: string;
  icon: string;
  action: () => void;
  type?: 'default' | 'danger';
  condition?: () => boolean;
  badge?: number;
}

export function UserDropdownModal({ visible, onClose }: UserDropdownModalProps) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const userSettings = useAuthStore((s) => s.user_settings);
  const defaultPanelUi = useAuthStore((s) => s.default_panel_ui);
  const [isProcessing, setIsProcessing] = useState(false);

  const userInitials = user
    ? `${user.first_name?.[0] || ''}${user.last_name?.[0] || ''}`.toUpperCase() || 'U'
    : 'U';

  const userName = user
    ? `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Usuario'
    : 'Usuario';

  const userEmail = user?.email || 'user@example.com';

  const userRole = user?.roles?.includes('super_admin')
    ? 'Super Administrador'
    : user?.roles?.includes('admin')
    ? 'Administrador'
    : user?.roles?.includes('owner')
    ? 'Dueño'
    : user?.roles?.[0] || 'Usuario';

  // Calculate new modules count
  const newModuleCount = (() => {
    if (!defaultPanelUi || !userSettings?.config?.panel_ui) return 0;
    let count = 0;
    const editableTypes = ['ORG_ADMIN', 'STORE_ADMIN'];
    for (const appType of editableTypes) {
      const userKeys = userSettings.config.panel_ui[appType] || {};
      const defaultKeys = defaultPanelUi[appType] || {};
      for (const key of Object.keys(defaultKeys)) {
        if (!userKeys.hasOwnProperty(key)) {
          count++;
        }
      }
    }
    return count;
  })();

  const handleLogout = async () => {
    setIsProcessing(true);
    try {
      await AuthService.logout();
      onClose();
      router.replace('/(auth)/login' as never);
    } catch (error) {
      // Error handled in service
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGoToProfile = () => {
    onClose();
    router.push('/(store-admin)/profile' as never);
  };

  const handleGoToSettings = () => {
    onClose();
    router.push('/(store-admin)/user-settings' as never);
  };

  const handleGoToOrganization = () => {
    onClose();
    router.push('/(org-admin)/dashboard' as never);
  };

  const canSwitchToOrganization = () => {
    return user?.roles?.includes('owner') || user?.roles?.includes('admin') || user?.roles?.includes('super_admin');
  };

  const menuOptions: MenuOption[] = [
    {
      label: 'Mi Perfil',
      icon: 'user',
      action: handleGoToProfile,
    },
    {
      label: 'Configuración de usuario',
      icon: 'user-cog',
      action: handleGoToSettings,
      badge: newModuleCount > 0 ? newModuleCount : undefined,
    },
    {
      label: 'Administrar Organización',
      icon: 'building',
      action: handleGoToOrganization,
      condition: canSwitchToOrganization,
    },
    {
      label: 'Cerrar Sesión',
      icon: 'logout',
      action: handleLogout,
      type: 'danger',
    },
  ];

  const visibleOptions = menuOptions.filter(
    (option) => !option.condition || option.condition(),
  );

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={styles.dropdown}>
              {/* User Header */}
              <View style={styles.header}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{userInitials}</Text>
                </View>
                <View style={styles.headerInfo}>
                  <Text style={styles.headerName} numberOfLines={1}>{userName}</Text>
                  <Text style={styles.headerEmail} numberOfLines={1}>{userEmail}</Text>
                </View>
              </View>

              {/* New Modules Banner */}
              {newModuleCount > 0 && (
                <View style={styles.banner}>
                  <Icon name="info" size={16} color="#F97316" />
                  <Text style={styles.bannerText}>
                    Tienes <Text style={styles.bannerBold}>{newModuleCount}</Text>{' '}
                    {newModuleCount === 1 ? 'módulo nuevo disponible' : 'módulos nuevos disponibles'}.
                    Actívalos en <Text style={styles.bannerBold}>Configuración</Text>.
                  </Text>
                </View>
              )}

              {/* Menu Options */}
              <ScrollView style={styles.menuContainer} showsVerticalScrollIndicator={false}>
                {visibleOptions.map((option, index) => {
                  const isLastDanger = option.type === 'danger' && index === visibleOptions.length - 1;
                  const showSeparator = option.type === 'danger' && index > 0;

                  return (
                    <Pressable
                      key={index}
                      onPress={option.action}
                      style={({ pressed }) => [
                        styles.menuItem,
                        showSeparator && styles.menuItemSeparator,
                        pressed && styles.menuItemPressed,
                      ]}
                    >
                      <Icon
                        name={option.icon}
                        size={18}
                        color={option.type === 'danger' ? colors.error : colorScales.gray[500]}
                      />
                      <Text
                        style={[
                          styles.menuLabel,
                          option.type === 'danger' && styles.menuLabelDanger,
                        ]}
                        numberOfLines={1}
                      >
                        {option.label}
                      </Text>
                      {option.badge && option.badge > 0 && (
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>{option.badge}</Text>
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 60,
    paddingRight: 16,
  },
  dropdown: {
    width: 280,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#F0FDF4',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: '#FFFFFF',
  },
  headerInfo: {
    flex: 1,
  },
  headerName: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    marginBottom: 2,
  },
  headerEmail: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    margin: 8,
    padding: 10,
    backgroundColor: 'rgba(249, 115, 22, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.25)',
    borderRadius: 8,
  },
  bannerText: {
    flex: 1,
    fontSize: 11,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[600],
    lineHeight: 16,
  },
  bannerBold: {
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.gray[900],
  },
  menuContainer: {
    maxHeight: 300,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  menuItemSeparator: {
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
    marginTop: 4,
    paddingTop: 12,
  },
  menuItemPressed: {
    backgroundColor: colorScales.gray[50],
  },
  menuLabel: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
    fontWeight: typography.fontWeight.medium as any,
  },
  menuLabelDanger: {
    color: colors.error,
  },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: '#FFFFFF',
  },
});

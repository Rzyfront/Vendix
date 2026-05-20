import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/core/store/auth.store';
import { AuthService } from '@/core/auth/auth.service';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { Modal } from '@/shared/components/modal/modal';

interface UserDropdownModalProps {
  visible: boolean;
  onClose: () => void;
}

interface MenuOption {
  label: string;
  icon: string;
  action: () => void;
  type?: 'default' | 'danger';
}

export function UserDropdownModal({ visible, onClose }: UserDropdownModalProps) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
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

  const menuOptions: MenuOption[] = [
    {
      label: 'Cerrar Sesión',
      icon: 'log-out',
      action: handleLogout,
      type: 'danger',
    },
  ];

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      showHeader={false}
      showCloseButton={false}
    >
      <View style={styles.container}>
        {/* User Header */}
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{userInitials}</Text>
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userName}>{userName}</Text>
            <Text style={styles.userEmail}>{userEmail}</Text>
            <Text style={styles.userRole}>{userRole}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        {/* Menu Options */}
        <ScrollView style={styles.menuContainer}>
          {menuOptions.map((option, index) => (
            <Pressable
              key={index}
              onPress={option.action}
              style={({ pressed }) => [
                styles.menuItem,
                option.type === 'danger' && styles.menuItemDanger,
                pressed && styles.menuItemPressed,
              ]}
            >
              <Icon
                name={option.icon}
                size={20}
                color={option.type === 'danger' ? colors.error : colorScales.gray[700]}
              />
              <Text
                style={[
                  styles.menuLabel,
                  option.type === 'danger' && styles.menuLabelDanger,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
    backgroundColor: colors.primary,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[3],
  },
  avatarText: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: '#FFFFFF',
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: '#FFFFFF',
    marginBottom: 2,
  },
  userEmail: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: 'rgba(255, 255, 255, 0.8)',
    marginBottom: 2,
  },
  userRole: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  divider: {
    height: 1,
    backgroundColor: colorScales.gray[200],
  },
  menuContainer: {
    flex: 1,
    paddingVertical: spacing[2],
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    gap: spacing[3],
  },
  menuItemDanger: {
    marginTop: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
  menuItemPressed: {
    backgroundColor: colorScales.gray[50],
  },
  menuLabel: {
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
    fontWeight: typography.fontWeight.medium as any,
  },
  menuLabelDanger: {
    color: colors.error,
  },
});

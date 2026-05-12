import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, typography, spacing } from '@/shared/theme';

interface HeaderProps {
  title: string;
  onMenuPress: () => void;
  rightAction?: React.ReactNode;
  showBack?: boolean;
}

export function Header({ title, onMenuPress, rightAction, showBack = false }: HeaderProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.row}>
        {showBack ? (
          <Pressable
            onPress={() => router.back()}
            hitSlop={8}
            style={styles.iconButton}
          >
            <Icon name="arrow-left" size={22} color={colors.text.primary} />
          </Pressable>
        ) : (
          <Pressable
            onPress={onMenuPress}
            hitSlop={8}
            style={styles.iconButton}
          >
            <Icon name="list" size={22} color={colors.text.primary} />
          </Pressable>
        )}
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {rightAction ? (
          <View style={styles.rightAction}>{rightAction}</View>
        ) : (
          <View style={styles.rightSpacer} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    height: 56,
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -spacing[2],
  },
  title: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
    flex: 1,
    textAlign: 'center',
  },
  rightAction: {
    width: 40,
    alignItems: 'flex-end',
  },
  rightSpacer: {
    width: 40,
  },
});

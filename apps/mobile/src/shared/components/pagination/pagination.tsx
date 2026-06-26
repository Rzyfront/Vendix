import { Pressable, Text, View, StyleSheet, type ViewStyle } from 'react-native';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  info?: string;
  style?: ViewStyle;
}

function buildPageList(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: (number | 'ellipsis')[] = [];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  pages.push(1);
  if (start > 2) pages.push('ellipsis');
  for (let p = start; p <= end; p++) pages.push(p);
  if (end < total - 1) pages.push('ellipsis');
  pages.push(total);

  return pages;
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
  info,
  style,
}: PaginationProps) {
  if (totalPages <= 1 && !info) return null;

  const pages = buildPageList(page, totalPages);

  return (
    <View style={[styles.wrapper, style]}>
      {info && <Text style={styles.info}>{info}</Text>}
      <View style={styles.row}>
        <Pressable
          onPress={() => onPageChange(page - 1)}
          disabled={page <= 1}
          hitSlop={8}
          style={({ pressed }) => [
            styles.navButton,
            pressed && styles.navButtonPressed,
            page <= 1 && styles.disabled,
          ]}
        >
          <Icon name="chevron-left" size={18} color={page <= 1 ? colors.text.muted : colors.text.primary} />
        </Pressable>

        {pages.map((p, i) =>
          p === 'ellipsis' ? (
            <Text key={`e-${i}`} style={styles.ellipsis}>
              …
            </Text>
          ) : (
            <Pressable
              key={p}
              onPress={() => onPageChange(p)}
              hitSlop={8}
              style={({ pressed }) => [
                styles.pageButton,
                p === page && styles.pageButtonActive,
                pressed && p !== page && styles.pageButtonPressed,
              ]}
            >
              <Text
                style={[
                  styles.pageLabel,
                  p === page && styles.pageLabelActive,
                ]}
              >
                {p}
              </Text>
            </Pressable>
          ),
        )}

        <Pressable
          onPress={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          hitSlop={8}
          style={({ pressed }) => [
            styles.navButton,
            pressed && styles.navButtonPressed,
            page >= totalPages && styles.disabled,
          ]}
        >
          <Icon
            name="chevron-right"
            size={18}
            color={page >= totalPages ? colors.text.muted : colors.text.primary}
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    paddingVertical: spacing[3],
    gap: spacing[2],
  },
  info: {
    fontSize: typography.fontSize.sm,
    color: colors.text.muted,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  navButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.md,
  },
  navButtonPressed: {
    backgroundColor: colorScales.gray[100],
  },
  pageButton: {
    minWidth: 36,
    height: 36,
    paddingHorizontal: spacing[2],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.md,
  },
  pageButtonActive: {
    backgroundColor: colors.primary,
  },
  pageButtonPressed: {
    backgroundColor: colorScales.gray[100],
  },
  pageLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: '500',
    color: colors.text.primary,
  },
  pageLabelActive: {
    color: colors.background,
  },
  ellipsis: {
    fontSize: typography.fontSize.base,
    color: colors.text.muted,
    paddingHorizontal: spacing[2],
  },
  disabled: {
    opacity: 0.4,
  },
});

export type { PaginationProps };
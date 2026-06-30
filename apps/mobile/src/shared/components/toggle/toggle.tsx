import { useRef, useEffect } from 'react';
import { Pressable, Text, View, StyleSheet, Animated, type ViewStyle } from 'react-native';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';

interface ToggleProps {
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label?: string;
  description?: string;
  style?: ViewStyle;
}

const TRACK_WIDTH = 44;
const TRACK_HEIGHT = 26;
const THUMB_SIZE = 20;
const TRACK_PADDING = 3;

export function Toggle({
  value,
  onChange,
  disabled = false,
  label,
  description,
  style,
}: ToggleProps) {
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: value ? 1 : 0,
      duration: 160,
      useNativeDriver: false,
    }).start();
  }, [value, anim]);

  const translateX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [TRACK_PADDING, TRACK_WIDTH - THUMB_SIZE - TRACK_PADDING],
  });

  const trackColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [colorScales.gray[300], colors.primary],
  });

  if (label || description) {
    return (
      <Pressable
        onPress={() => !disabled && onChange(!value)}
        disabled={disabled}
        style={({ pressed }) => [
          styles.row,
          pressed && styles.rowPressed,
          disabled && styles.disabled,
          style,
        ]}
      >
        <View style={styles.body}>
          {label && <Text style={styles.label}>{label}</Text>}
          {description && <Text style={styles.description}>{description}</Text>}
        </View>
        <View style={styles.trackContainer}>
          <Animated.View style={[styles.track, { backgroundColor: trackColor }]} />
          <Animated.View
            style={[
              styles.thumb,
              {
                transform: [{ translateX }],
              },
            ]}
          />
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={() => !disabled && onChange(!value)}
      disabled={disabled}
      style={[styles.switchOnly, disabled && styles.disabled, style]}
    >
      <Animated.View style={[styles.track, { backgroundColor: trackColor }]} />
      <Animated.View
        style={[
          styles.thumb,
          {
            transform: [{ translateX }],
          },
        ]}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[2],
    gap: spacing[3],
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
  },
  rowPressed: {
    opacity: 0.7,
  },
  body: {
    flex: 1,
  },
  label: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[700],
    fontWeight: '600',
  },
  description: {
    fontSize: 10,
    color: colorScales.gray[500],
    marginTop: 2,
    lineHeight: 12,
  },
  trackContainer: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    justifyContent: 'center',
  },
  track: {
    position: 'absolute',
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
  },
  thumb: {
    position: 'absolute',
    top: TRACK_PADDING,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: '#FFFFFF',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  switchOnly: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
});

export type { ToggleProps };
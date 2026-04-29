import { View, Text, StyleSheet, type ViewStyle, type ViewProps } from 'react-native';
import { colors, spacing, borderRadius, shadows, colorScales } from '@/shared/theme';

interface CardProps extends ViewProps {
  children: React.ReactNode;
  style?: ViewStyle;
}

interface CardHeaderProps extends ViewProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  style?: ViewStyle;
}

interface CardBodyProps extends ViewProps {
  children: React.ReactNode;
  style?: ViewStyle;
}

interface CardFooterProps extends ViewProps {
  children: React.ReactNode;
  style?: ViewStyle;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colorScales.gray[100],
    ...shadows.sm,
  },
  header: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerContent: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: colorScales.gray[900],
  },
  subtitle: {
    fontSize: 14,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  body: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
  },
  footer: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
  },
});

function Card({ children, style, ...props }: CardProps) {
  return (
    <View style={[styles.card, style]} {...props}>
      {children}
    </View>
  );
}

function CardHeader({ title, subtitle, right, style, ...props }: CardHeaderProps) {
  return (
    <View style={[styles.header, style]} {...props}>
      <View style={styles.headerRow}>
        <View style={styles.headerContent}>
          <Text style={styles.title}>{title}</Text>
          {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        </View>
        {right && <View>{right}</View>}
      </View>
    </View>
  );
}

function CardBody({ children, style, ...props }: CardBodyProps) {
  return (
    <View style={[styles.body, style]} {...props}>
      {children}
    </View>
  );
}

function CardFooter({ children, style, ...props }: CardFooterProps) {
  return (
    <View style={[styles.footer, style]} {...props}>
      {children}
    </View>
  );
}

Card.Header = CardHeader;
Card.Body = CardBody;
Card.Footer = CardFooter;

export { Card };

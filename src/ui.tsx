/** Small shared UI primitives, so the flow files stay about the API. */

import React, {useState} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';

export const theme = {
  background: '#0C0A10',
  surface: '#17141D',
  surfaceAlt: '#221D2B',
  border: '#332C3F',
  primary: '#7526C9',
  primaryText: '#EDE4F8',
  accent: '#B368F7',
  text: '#F5F2F8',
  muted: '#A79FB2',
  error: '#FF6B6B',
  errorSurface: '#3A1620',
} as const;

export function Header({title, body}: {title: string; body: string}) {
  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>{title}</Text>
      <Text style={styles.bodyMuted}>{body}</Text>
    </View>
  );
}

export function SectionCard({
  title,
  children,
  style,
}: {
  title: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.card, style]}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  secureTextEntry,
  maxLength,
  autoCapitalize = 'none',
  editable = true,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  secureTextEntry?: boolean;
  maxLength?: number;
  autoCapitalize?: 'none' | 'characters' | 'words' | 'sentences';
  editable?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, !editable && styles.inputDisabled]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.muted}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        editable={editable}
      />
    </View>
  );
}

export type ButtonKind = 'primary' | 'secondary' | 'ghost';

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({pressed}) => [
        styles.button,
        kind === 'primary' && styles.buttonPrimary,
        kind === 'secondary' && styles.buttonSecondary,
        kind === 'ghost' && styles.buttonGhost,
        pressed && styles.buttonPressed,
        disabled && styles.buttonDisabled,
        style,
      ]}>
      <Text
        style={[
          styles.buttonLabel,
          kind !== 'primary' && styles.buttonLabelQuiet,
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Full-screen body for a `Modal`. A Modal is its own native tree, so it needs
 * its own inset provider or its content slides under the status bar.
 */
export function ModalScreen({children}: {children: React.ReactNode}) {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        {children}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

export function Row({children}: {children: React.ReactNode}) {
  return <View style={styles.row}>{children}</View>;
}

export function KeyValueRow({label, value}: {label: string; value: string}) {
  return (
    <View style={styles.kvRow}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={styles.kvValue} selectable>
        {value}
      </Text>
    </View>
  );
}

export function Note({children}: {children: React.ReactNode}) {
  return <Text style={styles.note}>{children}</Text>;
}

export function StatusBanner({
  message,
  error,
}: {
  message?: string | null;
  error?: string | null;
}) {
  if (!message && !error) {
    return null;
  }
  const isError = Boolean(error);
  return (
    <View style={[styles.banner, isError && styles.bannerError]}>
      <Text style={[styles.bannerText, isError && styles.bannerTextError]}>
        {isError ? error : message}
      </Text>
    </View>
  );
}

export function LastResponsePanel({value}: {value: string}) {
  return (
    <SectionCard title="Last response">
      <ScrollView
        horizontal
        style={styles.responseBox}
        contentContainerStyle={styles.responseContent}>
        <Text style={styles.mono} selectable>
          {value}
        </Text>
      </ScrollView>
    </SectionCard>
  );
}

/** Minimal select: a pressable row that opens a modal list of options. */
export function Select<T>({
  label,
  value,
  options,
  optionLabel,
  onChange,
  placeholder = 'Select…',
  disabled,
}: {
  label: string;
  value: T | null;
  options: readonly T[];
  optionLabel: (option: T) => string;
  onChange: (option: T) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        disabled={disabled || options.length === 0}
        onPress={() => setOpen(true)}
        style={[styles.input, styles.selectInput]}>
        <Text style={value === null ? styles.selectPlaceholder : styles.text}>
          {value === null
            ? options.length === 0
              ? 'No options loaded'
              : placeholder
            : optionLabel(value)}
        </Text>
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalScrim} onPress={() => setOpen(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.cardTitle}>{label}</Text>
            <ScrollView style={styles.modalList}>
              {options.map((option, index) => (
                <Pressable
                  key={`${index}-${optionLabel(option)}`}
                  accessibilityRole="button"
                  onPress={() => {
                    onChange(option);
                    setOpen(false);
                  }}
                  style={styles.modalOption}>
                  <Text style={styles.text}>{optionLabel(option)}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Button label="Cancel" kind="ghost" onPress={() => setOpen(false)} />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

export function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{checked: value}}
      onPress={() => onChange(!value)}
      style={styles.toggle}>
      <View style={[styles.toggleBox, value && styles.toggleBoxOn]}>
        {value ? <Text style={styles.toggleMark}>✓</Text> : null}
      </View>
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

export function BusyOverlay({visible}: {visible: boolean}) {
  if (!visible) {
    return null;
  }
  return (
    <View style={styles.busy} pointerEvents="auto">
      <ActivityIndicator size="large" color={theme.accent} />
    </View>
  );
}

/** PIN prompt used before any signing operation. */
export function PinPrompt({
  visible,
  pinLength,
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  pinLength: number;
  onCancel: () => void;
  onSubmit: (pin: string) => void;
}) {
  const [pin, setPin] = useState('');
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}>
      <View style={styles.modalScrim}>
        <View style={styles.modalSheet}>
          <Text style={styles.cardTitle}>Enter wallet PIN</Text>
          <Field
            label={`${pinLength}-digit PIN`}
            value={pin}
            onChangeText={text => setPin(text.replace(/\D/g, ''))}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={pinLength}
          />
          <Row>
            <Button
              label="Cancel"
              kind="ghost"
              style={styles.flex}
              onPress={() => {
                setPin('');
                onCancel();
              }}
            />
            <Button
              label="Sign"
              style={styles.flex}
              onPress={() => {
                const entered = pin;
                setPin('');
                onSubmit(entered);
              }}
            />
          </Row>
        </View>
      </View>
    </Modal>
  );
}

export const styles = StyleSheet.create({
  flex: {flex: 1},
  screen: {flex: 1, backgroundColor: theme.background},
  scroll: {padding: 16, paddingBottom: 48},
  webviewHeader: {paddingHorizontal: 16, paddingBottom: 8},
  header: {marginBottom: 16},
  headerTitle: {
    color: theme.text,
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  text: {color: theme.text, fontSize: 15},
  bodyMuted: {color: theme.muted, fontSize: 14, lineHeight: 20},
  note: {color: theme.muted, fontSize: 13, lineHeight: 19, marginBottom: 8},
  card: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  cardTitle: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  field: {marginBottom: 12},
  label: {color: theme.muted, fontSize: 12, marginBottom: 6},
  input: {
    backgroundColor: theme.surfaceAlt,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.text,
    fontSize: 15,
  },
  inputDisabled: {opacity: 0.6},
  selectInput: {justifyContent: 'center', minHeight: 44},
  selectPlaceholder: {color: theme.muted, fontSize: 15},
  button: {
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonPrimary: {backgroundColor: theme.primary},
  buttonSecondary: {
    backgroundColor: theme.surfaceAlt,
    borderColor: theme.border,
    borderWidth: 1,
  },
  buttonGhost: {backgroundColor: 'transparent'},
  buttonPressed: {opacity: 0.75},
  buttonDisabled: {opacity: 0.4},
  buttonLabel: {color: theme.primaryText, fontSize: 15, fontWeight: '600'},
  buttonLabelQuiet: {color: theme.text},
  row: {flexDirection: 'row', gap: 12},
  kvRow: {flexDirection: 'row', marginBottom: 8, gap: 12},
  kvLabel: {color: theme.muted, fontSize: 13, width: 120},
  kvValue: {color: theme.text, fontSize: 13, flex: 1},
  banner: {
    backgroundColor: theme.surfaceAlt,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  bannerError: {backgroundColor: theme.errorSurface},
  bannerText: {color: theme.text, fontSize: 14, lineHeight: 20},
  bannerTextError: {color: theme.error},
  responseBox: {
    backgroundColor: theme.surfaceAlt,
    borderRadius: 10,
    maxHeight: 320,
  },
  responseContent: {padding: 12},
  mono: {
    color: theme.text,
    fontSize: 12,
    fontFamily: 'Courier',
    lineHeight: 17,
  },
  busy: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: '#00000099',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalScrim: {
    flex: 1,
    backgroundColor: '#000000AA',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalSheet: {
    width: '100%',
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
  },
  modalList: {maxHeight: 320},
  modalOption: {paddingVertical: 12},
  toggle: {flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12},
  toggleBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleBoxOn: {backgroundColor: theme.primary, borderColor: theme.primary},
  toggleMark: {color: theme.primaryText, fontSize: 14, fontWeight: '700'},
  progressTrack: {
    height: 4,
    backgroundColor: theme.surfaceAlt,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {height: 4, backgroundColor: theme.primary},
  currencyTile: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  currencyTileSelected: {borderColor: theme.primary},
  currencyTileDisabled: {opacity: 0.45},
  currencyLabel: {color: theme.text, fontSize: 15, fontWeight: '600'},
  currencyMeta: {color: theme.muted, fontSize: 13, marginTop: 4},
  currencyFootnote: {color: theme.error, fontSize: 12, marginTop: 4},
  walletActions: {flexDirection: 'row', gap: 12, marginBottom: 16},
  listItem: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  listItemActive: {borderColor: theme.primary},
  wizardHeader: {padding: 16, paddingBottom: 0},
  wizardFooter: {flexDirection: 'row', gap: 12, padding: 16},
});

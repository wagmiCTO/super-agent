/**
 * A sheet from the bottom, as the design draws one: a scrim, a grab bar,
 * a title and whatever the moment needs under it. `ConfirmSheet` is the
 * one-question kind — a line of words and two buttons — used before a
 * tap against no signal and before a reversal; `Sheet` is the frame for
 * anything longer, like a position's exits.
 */
import { Modal, Pressable, ScrollView, View } from 'react-native';

import { Button } from '@/ui/button';
import { Text } from '@/ui/text';
import { useTheme } from '@/theme';

export function Sheet({ open, title, onClose, children, testID = 'sheet' }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode; testID?: string }) {
  const theme = useTheme();
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable testID={`${testID}-scrim`} onPress={onClose} style={{ flex: 1, backgroundColor: theme.color.scrim, justifyContent: 'flex-end' }}>
        <Pressable
          testID={testID}
          onPress={() => undefined}
          style={{
            maxHeight: '88%',
            backgroundColor: theme.color.paper,
            borderTopLeftRadius: theme.radius.rXl,
            borderTopRightRadius: theme.radius.rXl,
            paddingHorizontal: theme.space.s5,
            paddingTop: theme.space.s5,
            paddingBottom: theme.space.s6,
            ...(theme.shadow.lift ? { boxShadow: theme.shadow.lift } : null),
          }}
        >
          <View style={{ width: 36, height: 4, borderRadius: 999, backgroundColor: theme.color.line, alignSelf: 'center', marginBottom: theme.space.s3 }} />
          {title ? <Text variant="h2" style={{ fontSize: theme.type.tLg, marginBottom: theme.space.s3 }}>{title}</Text> : null}
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: theme.space.s3 }}>
            {children}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function ConfirmSheet({
  open,
  title,
  body,
  confirm,
  cancel = 'Not now',
  onConfirm,
  onCancel,
  testID = 'sheet',
}: {
  open: boolean;
  title: string;
  body: string;
  confirm: string;
  cancel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable testID={`${testID}-scrim`} onPress={onCancel} style={{ flex: 1, backgroundColor: theme.color.scrim, justifyContent: 'flex-end' }}>
        <Pressable
          testID={testID}
          onPress={() => undefined}
          style={{
            backgroundColor: theme.color.paper,
            borderTopLeftRadius: theme.radius.rXl,
            borderTopRightRadius: theme.radius.rXl,
            paddingHorizontal: theme.space.s5,
            paddingTop: theme.space.s5,
            paddingBottom: theme.space.s6,
            gap: theme.space.s3,
            ...(theme.shadow.lift ? { boxShadow: theme.shadow.lift } : null),
          }}
        >
          <View style={{ width: 36, height: 4, borderRadius: 999, backgroundColor: theme.color.line, alignSelf: 'center' }} />
          <Text variant="h2" style={{ fontSize: theme.type.tLg }}>{title}</Text>
          <Text variant="body">{body}</Text>
          <Button testID={`${testID}-confirm`} title={confirm} onPress={onConfirm} />
          <Button testID={`${testID}-cancel`} title={cancel} variant="outline" onPress={onCancel} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

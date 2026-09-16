/**
 * A sheet from the bottom, as the design draws one: a scrim, a grab bar,
 * a title, a line of words and the buttons. Used for the one question the
 * app asks before a tap — opening against no signal — and nothing else.
 */
import { Modal, Pressable, View } from 'react-native';

import { Button } from '@/ui/button';
import { Text } from '@/ui/text';
import { useTheme } from '@/theme';

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

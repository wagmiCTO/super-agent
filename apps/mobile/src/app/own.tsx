/**
 * Your own strategy — the design's screen for a promise the intro makes:
 * "then your own to build". Until it exists: what it will be, a field for
 * the draft, and one button. The draft is kept, so the words are not lost
 * between now and then, and once the button is pressed the screen says so
 * and offers the way back.
 */
import { useEffect, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';

import { loadOwnDraft, saveOwnDraft } from '@/strategy/own-store';
import { Button } from '@/ui/button';
import { OwnScene } from '@/ui/illustration';
import { useTop } from '@/ui/inset';
import { StubHeader, back } from '@/ui/stub';
import { Card, Screen } from '@/ui/surface';
import { Text } from '@/ui/text';
import { face, useTheme } from '@/theme';

const EXAMPLE = 'Buy Bitcoin when it drops 2% in an hour, sell after 30 minutes or at −1%…';

export default function OwnStrategyScreen() {
  const theme = useTheme();
  const top = useTop();
  const [text, setText] = useState('');
  const [listed, setListed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    loadOwnDraft().then((d) => {
      if (!alive) return;
      setText(d.text);
      setListed(d.listed);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Written as it is typed: a draft that needs a Save button is one that
  // gets lost to a swipe back.
  const edit = (next: string) => {
    setText(next);
    void saveOwnDraft({ text: next, listed });
  };
  const notify = () => {
    setListed(true);
    void saveOwnDraft({ text, listed: true });
  };

  return (
    <Screen testID="own">
      <View style={{ flex: 1, paddingTop: top, paddingBottom: theme.space.s6, gap: theme.space.s4 }}>
        <StubHeader title="Your strategy" badge="COMING SOON" />
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: theme.space.s5, paddingBottom: theme.space.s4 }} keyboardShouldPersistTaps="handled">
          <OwnScene />
          <View style={{ gap: theme.space.s3 }}>
            <Text variant="h1" testID="own-title">Build your own strategy</Text>
            <Text variant="body">
              Describe it in words. The system turns it into rules, tests it on real prices, and runs it inside your limits. Others can follow it; you climb their boards.
            </Text>
          </View>
          {listed ? (
            <Card testID="own-listed" style={{ backgroundColor: theme.color.soft, borderColor: 'transparent', gap: theme.space.s1 }}>
              <Text variant="bodyStrong" style={{ fontFamily: face(theme, 'display', 700) }}>You are on the list</Text>
              <Text variant="small">{text.trim() ? 'We ping you when it opens. Your draft is saved.' : 'We ping you when it opens.'}</Text>
            </Card>
          ) : (
            <TextInput
              testID="own-draft"
              value={text}
              onChangeText={edit}
              editable={ready}
              multiline
              placeholder={EXAMPLE}
              placeholderTextColor={theme.color.muted}
              textAlignVertical="top"
              style={{
                minHeight: 96,
                padding: theme.space.s4,
                borderRadius: theme.radius.rLg,
                borderWidth: theme.size.bw,
                borderColor: theme.color.line,
                backgroundColor: theme.color.cardBg,
                fontFamily: face(theme, 'display', 400),
                fontSize: theme.type.tMd,
                lineHeight: theme.type.tMd * 1.45,
                color: theme.color.ink,
              }}
            />
          )}
        </ScrollView>
        {listed ? (
          <Button testID="own-back" title="Back to lobby" onPress={back} />
        ) : (
          <Button testID="own-notify" title="Notify me when it opens" onPress={notify} />
        )}
      </View>
    </Screen>
  );
}

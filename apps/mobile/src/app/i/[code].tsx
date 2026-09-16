/**
 * /i/<code> — where an invite link lands.
 *
 * It keeps the code and steps out of the way: the visitor sees the promo and
 * makes a passkey like anyone else, and the code is claimed the moment there
 * is a wallet to attribute to it. Nothing here asks them to do anything —
 * a link that opens a form is a link that gets closed.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { savePendingInvite } from '@/invite/pending';
import { Splash } from '@/ui/splash';

export default function InviteLink() {
  const { code } = useLocalSearchParams<{ code: string }>();
  useEffect(() => {
    const go = () => router.replace('/');
    if (!code) {
      go();
      return;
    }
    void savePendingInvite(String(code)).then(go);
  }, [code]);
  return <Splash note="Opening your invite…" />;
}

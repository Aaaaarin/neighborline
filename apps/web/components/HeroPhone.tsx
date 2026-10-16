'use client';

import { useState } from 'react';
import type { ThreadView } from '@/lib/types';
import { RequesterPhone } from './stage/RequesterPhone';

/** Mrs. Lan's phone at the moment the money lands — the landing page's hero image, but real UI. */
export function HeroPhone({ thread }: { thread: ThreadView }) {
  const [translated, setTranslated] = useState(true);
  return (
    <RequesterPhone
      label="Mrs. Lan’s phone, the moment the money arrives"
      thread={thread}
      lang="vi"
      translated={translated}
      onToggleTranslated={() => setTranslated((v) => !v)}
      warm
    />
  );
}

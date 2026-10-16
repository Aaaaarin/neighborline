'use client';

import type { Lang } from '@neighborline/core';
import { ChevronLeft, Mic } from 'lucide-react';
import type { ThreadView } from '@/lib/types';
import { dirOf, ui } from '@/lib/i18n';
import { cx } from '@/lib/format';
import { PhoneFrame } from '../PhoneFrame';
import { RequesterThread } from '../RequesterThread';

export function LineAvatar({ className }: { className?: string }) {
  return (
    <span className={cx('grid size-10 shrink-0 place-items-center rounded-full bg-ink text-raised', className)} aria-hidden>
      <svg width="22" height="10" viewBox="0 0 30 14">
        <path d="M1 7h17" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="24" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="2.4" />
      </svg>
    </span>
  );
}

export function RequesterPhone({
  label,
  thread,
  lang,
  translated,
  onToggleTranslated,
  warm,
  sms = false,
  contactLabel,
  onConfirm,
  onFix,
  busy,
  idleHint,
}: {
  label: string;
  thread: ThreadView | null;
  lang: Lang;
  translated: boolean;
  onToggleTranslated: () => void;
  warm: boolean;
  sms?: boolean;
  contactLabel?: string;
  onConfirm?: () => void;
  onFix?: () => void;
  busy?: boolean;
  idleHint?: React.ReactNode;
}) {
  const t = ui(lang);
  return (
    <PhoneFrame label={label} battery={sms ? 81 : 23} offline={!sms} warm={warm} time="7:42">
      <div className={cx('flex shrink-0 items-center gap-2.5 border-b px-3 pb-2.5 pt-1 transition-colors duration-1000', warm ? 'border-lamp/40' : 'border-rule')}>
        <ChevronLeft size={22} className="text-ink-3" aria-hidden />
        <LineAvatar />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.95rem] font-semibold leading-tight text-ink">Neighborline</p>
          <p className="truncate text-[0.74rem] leading-tight text-ink-3" lang={lang} dir={dirOf(lang)}>
            {sms ? contactLabel : t.lineSub}
          </p>
        </div>
        {lang !== 'en' && (
          <button
            type="button"
            role="switch"
            aria-checked={translated}
            onClick={onToggleTranslated}
            className={cx(
              'flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[0.75rem] font-semibold transition-colors',
              translated ? 'border-ink bg-ink text-raised' : 'border-rule-strong text-ink-2',
            )}
          >
            <span lang={lang}>{t.translated}</span>
            <span aria-hidden>{translated ? 'EN' : '·'}</span>
            <span className="sr-only">Show English translation</span>
          </button>
        )}
      </div>
      <RequesterThread
        messages={thread?.messages ?? []}
        lang={lang}
        translated={translated}
        awaitingConfirmation={!!thread?.awaitingConfirmation}
        onConfirm={onConfirm}
        onFix={onFix}
        busy={busy}
        emptyHint={idleHint}
      />
      <div className="flex shrink-0 items-center gap-2 px-3 pb-6 pt-1" aria-hidden>
        <div className="flex h-10 flex-1 items-center rounded-full border border-rule bg-raised px-4 text-[0.85rem] text-ink-3" lang={lang} dir={dirOf(lang)}>
          {t.composer}
        </div>
        <span className="grid size-10 place-items-center rounded-full bg-frost-ink text-raised">
          <Mic size={18} />
        </span>
      </div>
    </PhoneFrame>
  );
}

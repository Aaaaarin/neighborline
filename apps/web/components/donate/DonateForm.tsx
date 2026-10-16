'use client';

import { Check, LoaderCircle } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { cx, money } from '@/lib/format';

type Freq = 'once' | 'monthly';
const ONCE = [2_500, 5_000, 15_000];
const MONTHLY = [1_000, 2_500, 5_000];
const HINT: Record<Freq, Record<number, string>> = {
  once: {
    2_500: 'A cab to dialysis and back, with some left over',
    5_000: 'Groceries for a family of four for a few days',
    15_000: 'A space heater and groceries — what Mrs. Lan asked for',
  },
  monthly: {
    1_000: '$120 a year: two insulin copays',
    2_500: '$300 a year: two families through an outage',
    5_000: '$600 a year: a week of groceries for six families',
  },
};

/* ---- PayPal JS SDK (two namespaces: one-time capture, and subscriptions which need vault=true) ---- */
type PayPalNs = {
  Buttons: (opts: Record<string, unknown>) => { render: (el: HTMLElement) => Promise<void>; close: () => Promise<void>; isEligible: () => boolean };
};
declare global {
  interface Window {
    paypal_oneoff?: PayPalNs;
    paypal_sub?: PayPalNs;
  }
}

function loadSdk(clientId: string, ns: 'paypal_oneoff' | 'paypal_sub'): Promise<PayPalNs> {
  if (window[ns]) return Promise.resolve(window[ns]!);
  const params =
    ns === 'paypal_oneoff'
      ? `client-id=${clientId}&currency=USD&intent=capture&components=buttons,messages&enable-funding=venmo,paylater`
      : `client-id=${clientId}&currency=USD&vault=true&intent=subscription&components=buttons`;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://www.paypal.com/sdk/js?${params}`;
    s.dataset.namespace = ns;
    s.async = true;
    s.onload = () => (window[ns] ? resolve(window[ns]!) : reject(new Error('PayPal SDK missing')));
    s.onerror = () => reject(new Error('PayPal SDK failed to load'));
    document.head.appendChild(s);
  });
}

export function DonateForm({ clientId }: { clientId: string | null }) {
  const [freq, setFreq] = useState<Freq>('once');
  const [amount, setAmount] = useState(5_000);
  const [custom, setCustom] = useState('');
  const [done, setDone] = useState<{ amountCents: number; freq: Freq; simulated: boolean; id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sdkState, setSdkState] = useState<'idle' | 'loading' | 'ready' | 'failed'>(clientId ? 'loading' : 'idle');
  const buttonsRef = useRef<HTMLDivElement>(null);
  const customId = useId();

  const presets = freq === 'once' ? ONCE : MONTHLY;
  const customCents = Math.round(Number(custom.replace(/[^0-9.]/g, '')) * 100);
  const cents = custom ? customCents : amount;
  const valid = Number.isInteger(cents) && cents >= 100 && cents <= (freq === 'once' ? 1_000_000 : 100_000);

  // Render PayPal Smart Buttons when an SDK client id is configured.
  useEffect(() => {
    if (!clientId || !valid || !buttonsRef.current) return;
    let instance: ReturnType<PayPalNs['Buttons']> | null = null;
    let cancelled = false;
    setSdkState('loading');
    const el = buttonsRef.current;
    loadSdk(clientId, freq === 'once' ? 'paypal_oneoff' : 'paypal_sub')
      .then(async (paypal) => {
        if (cancelled) return;
        el.innerHTML = '';
        if (freq === 'once') {
          instance = paypal.Buttons({
            style: { layout: 'vertical', shape: 'pill', color: 'black', label: 'donate', height: 48 },
            createOrder: async () => (await api.createOrder(cents)).orderId,
            onApprove: async (data: { orderID: string }) => {
              const c = await api.captureOrder(data.orderID);
              setDone({ amountCents: c.amountCents, freq: 'once', simulated: c.simulated, id: c.captureId });
            },
            onError: () => setError('PayPal couldn’t finish the payment. Nothing was charged; try again.'),
          });
        } else {
          const plan = await api.subscriptionPlan(cents);
          if (!plan.planId) throw new Error('no plan');
          instance = paypal.Buttons({
            style: { layout: 'vertical', shape: 'pill', color: 'black', label: 'subscribe', height: 48 },
            createSubscription: (_d: unknown, actions: { subscription: { create: (o: { plan_id: string }) => Promise<string> } }) =>
              actions.subscription.create({ plan_id: plan.planId! }),
            onApprove: async (data: { subscriptionID: string }) => {
              await api.subscriptionActivated(data.subscriptionID, cents);
              setDone({ amountCents: cents, freq: 'monthly', simulated: false, id: data.subscriptionID });
            },
          });
        }
        await instance.render(el);
        if (!cancelled) setSdkState('ready');
      })
      .catch(() => !cancelled && setSdkState('failed'));
    return () => {
      cancelled = true;
      void instance?.close().catch(() => {});
    };
  }, [clientId, freq, cents, valid]);

  const simulate = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      if (freq === 'once') {
        const o = await api.createOrder(cents);
        const c = await api.captureOrder(o.orderId);
        setDone({ amountCents: c.amountCents, freq, simulated: true, id: c.captureId });
      } else {
        await api.subscriptionPlan(cents);
        const id = `SIM-SUB-${Date.now().toString(36).toUpperCase()}`;
        await api.subscriptionActivated(id, cents);
        setDone({ amountCents: cents, freq, simulated: true, id });
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The gift didn’t go through. Nothing was charged; try again.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="rounded-[24px] border border-lamp bg-lamp-wash p-6 sm:p-8 animate-rise" role="status">
        <span className="grid size-11 place-items-center rounded-full bg-lamp text-ink" aria-hidden>
          <Check size={22} strokeWidth={2.6} />
        </span>
        <h2 className="mt-4 text-h4 text-ink">
          Thank you. {money(done.amountCents)}
          {done.freq === 'monthly' ? ' a month' : ''} is in the fund.
        </h2>
        <p className="mt-2 text-ink-2">
          Cascadia Community Fund will email your receipt. You’ll see your gift reflected in the next transparency report — never your name.
        </p>
        <p className="mt-3 text-[0.85rem] text-ink-2">
          Reference <span className="id-text text-ink">{done.id}</span>
          {done.simulated && ' · simulated, no real money moved'}
        </p>
        <button type="button" onClick={() => setDone(null)} className="mt-5 min-h-11 font-semibold text-ink underline underline-offset-4">
          Give again
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-[24px] border border-rule bg-raised p-5 sm:p-8">
      <fieldset>
        <legend className="sr-only">How often</legend>
        <div className="grid grid-cols-2 rounded-full bg-sunk p-1">
          {(['once', 'monthly'] as Freq[]).map((f) => (
            <label key={f} className={cx('flex min-h-11 cursor-pointer items-center justify-center rounded-full text-[0.95rem] font-medium has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-ink', freq === f ? 'bg-ink text-raised' : 'text-ink-2')}>
              <input
                type="radio"
                name="freq"
                className="sr-only"
                checked={freq === f}
                onChange={() => {
                  setFreq(f);
                  setAmount(f === 'once' ? 5_000 : 2_500);
                  setCustom('');
                }}
              />
              {f === 'once' ? 'Give once' : 'Give monthly'}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-6">
        <legend className="text-[0.95rem] font-semibold text-ink">Amount</legend>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {presets.map((p) => (
            <label
              key={p}
              className={cx(
                'flex min-h-14 cursor-pointer items-center justify-center rounded-2xl border text-[1.15rem] font-semibold has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-ink',
                !custom && amount === p ? 'border-ink bg-ink text-raised' : 'border-rule-strong text-ink hover:bg-sunk',
              )}
            >
              <input type="radio" name="amount" className="sr-only" checked={!custom && amount === p} onChange={() => (setAmount(p), setCustom(''))} />
              {money(p)}
            </label>
          ))}
        </div>
        <p className="mt-2 min-h-6 text-[0.9rem] text-ink-2" aria-live="polite">
          {!custom && HINT[freq][amount]}
        </p>
        <label htmlFor={customId} className="mt-2 block text-[0.9rem] text-ink-2">
          Or another amount
        </label>
        <div className="mt-1 flex h-12 items-center rounded-xl border border-rule-strong bg-paper px-3 focus-within:outline-3 focus-within:outline-ink">
          <span className="text-ink-3" aria-hidden>
            $
          </span>
          <input
            id={customId}
            inputMode="decimal"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="75"
            className="h-full w-full bg-transparent px-1.5 text-[1.05rem] text-ink outline-none placeholder:text-ink-3"
            aria-invalid={custom ? !valid : undefined}
          />
          {freq === 'monthly' && <span className="text-[0.9rem] text-ink-3">/month</span>}
        </div>
        {custom && !valid && <p className="mt-1 text-[0.85rem] text-signal">Enter an amount from $1 to {freq === 'once' ? '$10,000' : '$1,000 a month'}.</p>}
      </fieldset>

      <div className="mt-6">
        {clientId && sdkState !== 'failed' ? (
          <>
            <div ref={buttonsRef} className="min-h-[52px]" aria-busy={sdkState === 'loading'} />
            {sdkState === 'loading' && <p className="text-[0.85rem] text-ink-3">Loading PayPal…</p>}
            {freq === 'once' && valid && <div className="mt-3" data-pp-message data-pp-amount={(cents / 100).toFixed(2)} data-pp-placement="payment" />}
          </>
        ) : (
          <div className="rounded-2xl border border-dashed border-rule-strong p-4">
            <p className="text-[0.85rem] font-semibold text-ink">{sdkState === 'failed' ? 'PayPal didn’t load — simulated instead' : 'Sandbox not configured — simulated'}</p>
            <p className="mt-1 text-[0.85rem] leading-snug text-ink-2">
              With <span className="id-text">NEXT_PUBLIC_PAYPAL_CLIENT_ID</span> set, this is where PayPal, Venmo and Pay Later buttons appear{freq === 'monthly' ? ', plus a PayPal subscription' : ''}. This button walks the same server path and records a simulated gift.
            </p>
            <button
              type="button"
              onClick={() => void simulate()}
              disabled={!valid || busy}
              className="mt-3 flex h-13 w-full items-center justify-center gap-2 rounded-full bg-ink text-[1.05rem] font-semibold text-raised disabled:opacity-50"
            >
              {busy && <LoaderCircle size={18} className="animate-spin" aria-hidden />}
              Give {valid ? money(cents) : ''}
              {freq === 'monthly' ? ' a month' : ''} (simulated)
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className="mt-3 text-[0.9rem] text-signal">
            {error}
          </p>
        )}
      </div>
      <p className="mt-5 text-[0.85rem] leading-snug text-ink-3">
        Tax-deductible through our fiscal sponsor, Cascadia Community Fund (501(c)(3)). Monthly gifts can be cancelled any time from your PayPal account.
      </p>
    </div>
  );
}

/**
 * A tiny TwiML builder: just the verbs the phone line uses (twilio.com/docs/voice/twiml).
 * Everything is escaped; no caller text ever reaches the XML unescaped.
 */
export type TwimlNode = string & { readonly __twiml: true };

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function el(name: string, attrs: Record<string, string | number | boolean | undefined>, children?: string): TwimlNode {
  const a = Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${esc(String(v))}"`)
    .join('');
  return (children === undefined || children === '' ? `<${name}${a}/>` : `<${name}${a}>${children}</${name}>`) as TwimlNode;
}

export const say = (text: string, opts: { voice?: string; language?: string } = {}): TwimlNode =>
  el('Say', { voice: opts.voice, language: opts.language }, esc(text));

export const play = (url: string): TwimlNode => el('Play', {}, esc(url));

export const pause = (seconds = 1): TwimlNode => el('Pause', { length: seconds });

export const redirect = (url: string): TwimlNode => el('Redirect', { method: 'POST' }, esc(url));

export const hangup = (): TwimlNode => el('Hangup', {});

export const record = (opts: {
  action: string;
  recordingStatusCallback: string;
  maxLength: number;
  timeout?: number;
}): TwimlNode =>
  el('Record', {
    action: opts.action,
    method: 'POST',
    maxLength: opts.maxLength,
    timeout: opts.timeout ?? 5,
    playBeep: 'true',
    trim: 'trim-silence',
    finishOnKey: '#',
    recordingStatusCallback: opts.recordingStatusCallback,
    recordingStatusCallbackMethod: 'POST',
    recordingStatusCallbackEvent: 'completed',
  });

/** <Gather input="dtmf"> around the prompt, so a caller can press a key while it is still speaking. */
export const gatherDigits = (opts: { action: string; numDigits?: number; timeout?: number }, ...prompt: TwimlNode[]): TwimlNode =>
  el('Gather', { input: 'dtmf', action: opts.action, method: 'POST', numDigits: opts.numDigits ?? 1, timeout: opts.timeout ?? 8, actionOnEmptyResult: 'false' }, prompt.join(''));

export const response = (...nodes: TwimlNode[]): string => `<?xml version="1.0" encoding="UTF-8"?><Response>${nodes.join('')}</Response>`;

/** Twilio expects TwiML as text/xml. */
export const twimlResponse = (xml: string, status = 200): Response =>
  new Response(xml, { status, headers: { 'content-type': 'text/xml; charset=utf-8', 'cache-control': 'no-store' } });

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type RecState = 'idle' | 'starting' | 'recording' | 'denied' | 'unsupported';

/** MediaRecorder with a live input level (0..1) for the meter. */
export function useRecorder() {
  const [state, setState] = useState<RecState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const raf = useRef<number | null>(null);
  const started = useRef(0);
  const resolveStop = useRef<((b: Blob | null) => void) | null>(null);

  const cleanup = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setLevel(0);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async () => {
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setState('unsupported');
      return false;
    }
    setState('starting');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      stream.current = s;
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m));
      const r = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = () => {
        const blob = chunks.current.length ? new Blob(chunks.current, { type: r.mimeType || 'audio/webm' }) : null;
        cleanup();
        setState('idle');
        resolveStop.current?.(blob);
        resolveStop.current = null;
      };
      r.start(250);
      rec.current = r;
      started.current = performance.now();
      setSeconds(0);
      setState('recording');
      // level meter
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(s);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      const loop = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
        setSeconds(Math.floor((performance.now() - started.current) / 1000));
        raf.current = requestAnimationFrame(loop);
      };
      loop();
      return true;
    } catch {
      cleanup();
      setState('denied');
      return false;
    }
  }, [cleanup]);

  const stop = useCallback(() => {
    return new Promise<Blob | null>((resolve) => {
      const r = rec.current;
      if (!r || r.state === 'inactive') return resolve(null);
      resolveStop.current = resolve;
      r.stop();
    });
  }, []);

  return { state, seconds, level, start, stop };
}

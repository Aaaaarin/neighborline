/** Structured JSON logs (one object per line) with PII redacted (core.redactDeep). */
import { redactDeep } from '@neighborline/core';

export type Level = 'info' | 'warn' | 'error';
export type Logger = (level: Level, event: string, data?: Record<string, unknown>) => void;

export const jsonLogger: Logger = (level, event, data = {}) => {
  const line = JSON.stringify({ t: new Date().toISOString(), level, svc: 'approver', event, ...redactDeep(data) });
  (level === 'info' ? process.stdout : process.stderr).write(line + '\n');
};

export const silentLogger: Logger = () => {};

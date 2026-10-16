import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { sha256Hex } from '@neighborline/core';
import { getScenario } from '../fixtures/scenarios.js';
import { createFixtureLLM } from '../fixtures/responders.js';
import { AnthropicLLM } from './anthropic.js';
import { createProviders } from './create.js';
import { FallbackLLM } from './fallback.js';
import { FixtureSTT, fixtureAudioBytes } from './fixture-audio.js';
import { ScriptedLLM } from './fixture-llm.js';
import { dropNulls, toStrictSchema, zodToLlmJsonSchema } from './json-schema.js';
import { OpenAILLM } from './openai-llm.js';
import { OpenAISTT, OpenAITTS } from './openai-audio.js';
import { ProviderError } from './base.js';
import type { Logger } from './types.js';

const quiet = (): Logger & { warnings: string[] } => {
  const warnings: string[] = [];
  return { warnings, info: () => {}, warn: (m) => void warnings.push(m), error: () => {} };
};

describe('createProviders', () => {
  it('defaults to fixtures with zero credentials', () => {
    const p = createProviders({}, quiet());
    expect([p.mode, p.llm.id, p.stt.id, p.tts.id]).toEqual(['fixture', 'fixture', 'fixture-stt', 'fixture-tts']);
  });

  it('AI_MODE=fixture ignores keys', () => {
    expect(createProviders({ AI_MODE: 'fixture', ANTHROPIC_API_KEY: 'k' }, quiet()).llm.id).toBe('fixture');
  });

  it('live + anthropic key → Claude (model from env, default Sonnet)', () => {
    expect(createProviders({ AI_MODE: 'live', ANTHROPIC_API_KEY: 'k' }, quiet()).llm.id).toBe('anthropic:claude-sonnet-5-5');
    expect(createProviders({ AI_MODE: 'live', ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'claude-haiku-5-5' }, quiet()).llm.id).toBe('anthropic:claude-haiku-5-5');
  });

  it('live + LLM_PROVIDER=openai → OpenAI; OpenAI key also enables STT/TTS', () => {
    const p = createProviders({ AI_MODE: 'live', LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'k' }, quiet());
    expect([p.llm.id, p.stt.id, p.tts.id]).toEqual(['openai:gpt-5.4-mini', 'openai:gpt-4o-transcribe', 'openai:gpt-4o-mini-tts']);
  });

  it('falls back to the other provider when the requested one has no key (warns)', () => {
    const log = quiet();
    const p = createProviders({ AI_MODE: 'live', LLM_PROVIDER: 'anthropic', OPENAI_API_KEY: 'k' }, log);
    expect(p.llm.id).toBe('openai:gpt-5.4-mini');
    expect(log.warnings[0]).toContain('LLM_PROVIDER=anthropic has no API key');
  });

  it('live with no keys → fixtures, with a logged warning', () => {
    const log = quiet();
    const p = createProviders({ AI_MODE: 'live' }, log);
    expect([p.mode, p.llm.id, p.stt.id]).toEqual(['live', 'fixture', 'fixture-stt']);
    expect(log.warnings.join('\n')).toMatch(/no ANTHROPIC_API_KEY \/ OPENAI_API_KEY[\s\S]*no OPENAI_API_KEY/);
  });

  it('AI_FALLBACK=fixture wraps the live model', () => {
    expect(createProviders({ AI_MODE: 'live', ANTHROPIC_API_KEY: 'k', AI_FALLBACK: 'fixture' }, quiet()).llm.id).toBe('anthropic:claude-sonnet-5-5→fixture');
  });
});

const Sample = z.object({ name: z.string().min(1).max(10), tags: z.array(z.string()).max(3), nested: z.object({ n: z.number().int().min(0) }).optional() });

describe('JSON Schema for structured output', () => {
  it('Claude strict tools: closed objects, unsupported keywords moved to descriptions', () => {
    const s = toStrictSchema(zodToLlmJsonSchema(Sample), 'anthropic');
    expect(s).toMatchObject({ type: 'object', additionalProperties: false, required: ['name', 'tags'] });
    const props = s.properties as Record<string, Record<string, unknown>>;
    expect(props.name).toEqual({ type: 'string', description: '{minLength: 1, maxLength: 10}' });
    expect(props.nested).toMatchObject({ additionalProperties: false, required: ['n'] });
  });

  it('OpenAI strict: every property required, optional ones nullable', () => {
    const s = toStrictSchema(zodToLlmJsonSchema(Sample), 'openai');
    expect(s.required).toEqual(['name', 'tags', 'nested']);
    const nested = (s.properties as Record<string, Record<string, unknown>>).nested;
    expect(nested?.anyOf).toEqual([expect.objectContaining({ type: 'object' }), { type: 'null' }]);
    expect(dropNulls({ name: 'a', nested: null, tags: [] })).toEqual({ name: 'a', tags: [] });
  });
});

describe('AnthropicLLM (fake client)', () => {
  it('forces one strict tool call and returns its input as JSON', async () => {
    const seen: Record<string, unknown>[] = [];
    const client = {
      messages: {
        create: async (body: Record<string, unknown>) => {
          seen.push(body);
          return { model: 'claude-sonnet-5-5', stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'tool_use', id: 't1', name: 'Sample', input: { name: 'a', tags: [] } }] };
        },
      },
    };
    const llm = new AnthropicLLM({ apiKey: 'k', client: client as never });
    const r = await llm.generateStructured({ system: 's', messages: [{ role: 'user', content: 'u' }], schema: Sample, schemaName: 'Sample' });
    expect(r.value).toEqual({ name: 'a', tags: [] });
    expect(seen[0]).toMatchObject({ model: 'claude-sonnet-5-5', system: 's', tool_choice: { type: 'tool', name: 'Sample', disable_parallel_tool_use: true } });
    expect((seen[0]?.tools as Array<Record<string, unknown>>)[0]).toMatchObject({ name: 'Sample', strict: true, input_schema: { type: 'object', additionalProperties: false } });
  });

  it('wraps SDK errors in ProviderError', async () => {
    const client = { messages: { create: async () => { throw new Error('529 overloaded'); } } };
    const llm = new AnthropicLLM({ apiKey: 'k', client: client as never });
    await expect(llm.generateText({ system: 's', messages: [] })).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('OpenAILLM (fake client)', () => {
  it('uses json_schema strict structured outputs and drops nulls', async () => {
    const seen: Record<string, unknown>[] = [];
    const client = {
      chat: { completions: { create: async (body: Record<string, unknown>) => {
        seen.push(body);
        return { model: 'gpt-5.4-mini', usage: { prompt_tokens: 3, completion_tokens: 4 }, choices: [{ message: { content: '{"name":"a","tags":[],"nested":null}', refusal: null } }] };
      } } },
    };
    const llm = new OpenAILLM({ apiKey: 'k', client: client as never });
    const r = await llm.generateStructured({ system: 's', messages: [{ role: 'user', content: 'u' }], schema: Sample, schemaName: 'Sample' });
    expect(r.value).toEqual({ name: 'a', tags: [] });
    expect(seen[0]).toMatchObject({ response_format: { type: 'json_schema', json_schema: { name: 'Sample', strict: true } }, max_completion_tokens: 4096 });
    expect((seen[0]?.messages as unknown[])[0]).toEqual({ role: 'system', content: 's' });
  });
});

describe('OpenAI audio (fake client)', () => {
  it('gpt-4o-transcribe: json + logprobs → confidence; language from hint', async () => {
    const seen: Record<string, unknown>[] = [];
    const client = { audio: { transcriptions: { create: async (body: Record<string, unknown>) => {
      seen.push(body);
      return { text: ' Xin chào ', logprobs: [{ logprob: -0.1 }, { logprob: -0.3 }], usage: { type: 'duration', seconds: 12.5 } };
    } } } };
    const stt = new OpenAISTT({ apiKey: 'k', client: client as never });
    const r = await stt.transcribe({ audio: new Uint8Array([1, 2, 3]), mimeType: 'audio/webm;codecs=opus', langHint: 'vi' });
    expect(r).toMatchObject({ text: 'Xin chào', lang: 'vi', langSource: 'hint', durationSec: 12.5, confidence: 0.819 });
    expect(seen[0]).toMatchObject({ model: 'gpt-4o-transcribe', response_format: 'json', include: ['logprobs'], language: 'vi' });
    expect((seen[0]?.file as File).name).toBe('request.webm');
  });

  it('whisper-1: verbose_json language name → code', async () => {
    const client = { audio: { transcriptions: { create: async () => ({ text: 'Bonjou', language: 'haitian creole', duration: 3 }) } } };
    const r = await new OpenAISTT({ apiKey: 'k', model: 'whisper-1', client: client as never }).transcribe({ audio: new Uint8Array([1]), mimeType: 'audio/mpeg' });
    expect(r).toMatchObject({ lang: 'ht', langSource: 'provider', durationSec: 3 });
  });

  it('gpt-4o-mini-tts with delivery instructions → mp3 bytes', async () => {
    const seen: Record<string, unknown>[] = [];
    const client = { audio: { speech: { create: async (body: Record<string, unknown>) => {
      seen.push(body);
      return new Response(new Uint8Array([9, 9]));
    } } } };
    const r = await new OpenAITTS({ apiKey: 'k', client: client as never }).speak({ text: 'Đã gửi $150', lang: 'vi' });
    expect(r).toMatchObject({ mimeType: 'audio/mpeg', audio: new Uint8Array([9, 9]) });
    expect(seen[0]).toMatchObject({ model: 'gpt-4o-mini-tts', voice: 'coral', response_format: 'mp3' });
    expect(String(seen[0]?.instructions)).toContain('Vietnamese');
  });
});

describe('FixtureSTT', () => {
  const bytes = new Uint8Array([7, 7, 7]);
  it('matches by sha256 manifest, marker, fixture id, filename, then default', async () => {
    const stt = new FixtureSTT({ audioIndex: { [sha256Hex(bytes)]: 'rosa_es' }, defaultScenarioId: 'lan_vi' });
    const m = async (args: Parameters<FixtureSTT['transcribe']>[0]) => (await stt.transcribe(args)).fixture;
    expect(await m({ audio: bytes, mimeType: 'audio/mpeg' })).toEqual({ id: 'rosa_es', matchedBy: 'sha256' });
    expect(await m({ audio: fixtureAudioBytes('jean_ht'), mimeType: 'audio/webm' })).toEqual({ id: 'jean_ht', matchedBy: 'marker' });
    expect(await m({ audio: new Uint8Array([1]), mimeType: 'x', fixtureHint: { fixtureId: 'walter_en' } })).toEqual({ id: 'walter_en', matchedBy: 'fixtureId' });
    expect(await m({ audio: new Uint8Array([1]), mimeType: 'x', fixtureHint: { filename: 'audio/inject_en.mp3' } })).toEqual({ id: 'inject_en', matchedBy: 'filename' });
    expect(await m({ audio: new Uint8Array([1]), mimeType: 'x' })).toEqual({ id: 'lan_vi', matchedBy: 'default' });
    expect((await stt.transcribe({ audio: bytes, mimeType: 'x' })).text).toBe(getScenario('rosa_es').transcript);
  });
  it('throws when nothing matches and there is no default', async () => {
    await expect(new FixtureSTT({ defaultScenarioId: null }).transcribe({ audio: new Uint8Array([1]), mimeType: 'x' })).rejects.toThrow('does not match');
  });
});

describe('FallbackLLM', () => {
  it('answers from fixtures when the live model errors', async () => {
    const broken = new ScriptedLLM([]);
    const llm = new FallbackLLM(broken, createFixtureLLM());
    const r = await llm.generateJson({ system: 's', messages: [{ role: 'user', content: '<text>\nhola\n</text>' }], jsonSchema: {}, schemaName: 'BackTranslation' });
    expect(r.json).toEqual({ english: 'hola' });
    expect(r.model).toBe('fixture (fallback)');
  });
});

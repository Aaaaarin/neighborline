/**
 * Starts what the demo talks to: fake PayPal (in-process, unless you point it at the sandbox) and the
 * `neighborline-payouts-mcp` server as a real stdio subprocess, connected with the official MCP TypeScript client.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createFakePayPal, type FakePayPal } from '@neighborline/fake-paypal';

export type ServerFrom = 'source' | 'built';

export interface StackOptions {
  /** HMAC secret shared by the approval service and the MCP server (never by the agent). */
  approvalSecret: string;
  /** `fake` (default): in-process fake PayPal. `sandbox`: PAYPAL_CLIENT_ID/SECRET from env. */
  paypal?: 'fake' | 'sandbox';
  /** Run the server from TypeScript source (default) or from the package's built dist/. */
  serverFrom?: ServerFrom;
  /** Fake PayPal: time from PENDING to final item status. */
  processingDelayMs?: number;
  /** Override the server command entirely, e.g. "npx -y neighborline-payouts-mcp". Env: MCP_SERVER_COMMAND. */
  serverCommand?: string;
}

export interface ToolResult {
  isError: boolean;
  text: string;
  data: any;
}

export interface Stack {
  client: Client;
  fake: FakePayPal | undefined;
  /** Lines the server wrote to stderr (its `[audit]` log and startup line). */
  serverLog: string[];
  call(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  close(): Promise<void>;
}

function serverCommand(from: ServerFrom, override?: string): { command: string; args: string[]; cwd: string } {
  const pkgDir = dirname(createRequire(import.meta.url).resolve('@neighborline/paypal/package.json'));
  if (override) {
    const [command, ...args] = override.split(/\s+/).filter(Boolean);
    return { command: command!, args, cwd: process.cwd() };
  }
  if (from === 'built') {
    const bin = join(pkgDir, 'dist', 'mcp', 'bin.js');
    if (!existsSync(bin)) throw new Error(`${bin} is missing: run \`pnpm --filter @neighborline/paypal build\` first`);
    return { command: process.execPath, args: [bin], cwd: pkgDir };
  }
  // `--import tsx` resolves from cwd, and tsx is a dev dependency of the paypal package.
  return { command: process.execPath, args: ['--import', 'tsx', join(pkgDir, 'src', 'mcp', 'bin.ts')], cwd: pkgDir };
}

export async function startStack(opts: StackOptions): Promise<Stack> {
  const mode = opts.paypal ?? 'fake';
  const fake = mode === 'fake' ? await createFakePayPal({ processingDelayMs: opts.processingDelayMs ?? 900, autoProcess: true }) : undefined;
  const { command, args, cwd } = serverCommand(opts.serverFrom ?? 'source', opts.serverCommand ?? process.env.MCP_SERVER_COMMAND);

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/^(ANTHROPIC|OPENAI)_/.test(k)) env[k] = v; // the server never needs model keys
  Object.assign(env, { PAYPAL_MODE: mode, NEIGHBORLINE_APPROVAL_SECRET: opts.approvalSecret }, fake ? { FAKE_PAYPAL_URL: fake.url } : {});

  const transport = new StdioClientTransport({ command, args, cwd, env, stderr: 'pipe' });
  const serverLog: string[] = [];
  transport.stderr?.on('data', (d: Buffer) => serverLog.push(...String(d).split('\n').filter(Boolean)));
  const client = new Client({ name: 'neighborline-mcp-agent-demo', version: '0.1.0' });
  try {
    await client.connect(transport);
  } catch (err) {
    await fake?.close();
    throw new Error(`could not start the MCP server (${command} ${args.join(' ')}): ${(err as Error).message}\n${serverLog.join('\n')}`);
  }

  return {
    client,
    fake,
    serverLog,
    async call(name, args) {
      const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ type: string; text?: string }>; structuredContent?: unknown };
      return { isError: Boolean(r.isError), text: r.content.map((c) => c.text ?? '').join('\n'), data: r.structuredContent };
    },
    async close() {
      await client.close();
      await fake?.close();
    },
  };
}

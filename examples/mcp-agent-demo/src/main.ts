#!/usr/bin/env node
/**
 * MCP agent demo: an AI agent pays a neighbor through `neighborline-payouts-mcp`.
 *
 *   pnpm --filter @neighborline/example-mcp-agent-demo demo                       # scripted, no keys
 *   pnpm --filter @neighborline/example-mcp-agent-demo demo -- --typewriter 40   # paced for screen recording
 *   pnpm --filter @neighborline/example-mcp-agent-demo demo:llm -- anthropic     # needs ANTHROPIC_API_KEY
 *
 * Flags: --scripted | --llm [anthropic|openai]   --model <id>   --approve auto|prompt   --tamper
 *        --typewriter [cps]   --pause <ms>   --verbose   --no-color   --json <file>
 *        --paypal fake|sandbox   --server source|built   (or MCP_SERVER_COMMAND="npx -y neighborline-payouts-mcp")
 */
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { DemoApprovalService } from './approval-service.js';
import { runLlm, UsageError, type Provider } from './llm.js';
import { runScripted } from './scripted.js';
import { startStack, type ServerFrom } from './stack.js';
import { Transcript } from './transcript.js';

// `pnpm demo -- --flag` passes the `--` through; drop it so the flags are still parsed.
const argv = process.argv.slice(2);
if (argv.includes('--')) argv.splice(argv.indexOf('--'), 1);
const { values, positionals } = parseArgs({
  args: argv,
  allowPositionals: true,
  options: {
    scripted: { type: 'boolean' },
    llm: { type: 'boolean' },
    model: { type: 'string' },
    approve: { type: 'string', default: 'auto' },
    tamper: { type: 'boolean' },
    typewriter: { type: 'string' },
    pause: { type: 'string' },
    verbose: { type: 'boolean' },
    'no-color': { type: 'boolean' },
    json: { type: 'string' },
    paypal: { type: 'string', default: 'fake' },
    server: { type: 'string', default: 'source' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help) {
  console.log((await import('node:fs')).readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]!.replace(/^#!.*\n\/\*\*?/, '').replace(/^ \* ?/gm, ''));
  process.exit(0);
}

const mode = values.llm ? 'llm' : 'scripted';
const provider: Provider = (positionals[0] as Provider | undefined) ?? (process.env.ANTHROPIC_API_KEY ? 'anthropic' : process.env.OPENAI_API_KEY ? 'openai' : 'anthropic');
const paypal = values.paypal === 'sandbox' ? 'sandbox' : 'fake';
// `--typewriter` alone → 45 characters per second, a comfortable reading pace on video.
const typewriterArg = argv.includes('--typewriter') ? (values.typewriter && /^\d+$/.test(values.typewriter) ? Number(values.typewriter) : 45) : 0;
const t = new Transcript({
  cps: typewriterArg,
  pauseMs: values.pause ? Number(values.pause) : typewriterArg ? 450 : 0,
  color: !values['no-color'] && !process.env.NO_COLOR && (process.stdout.isTTY === true || Boolean(process.env.FORCE_COLOR)),
  verbose: Boolean(values.verbose),
  write: (s) => process.stdout.write(s),
});

if (mode === 'llm') {
  const key = provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
  if (!process.env[key]) {
    console.error(`--llm ${provider} needs ${key}. Without a key, run the scripted demo: pnpm --filter @neighborline/example-mcp-agent-demo demo`);
    process.exit(1);
  }
}

// The approval secret is shared by the approval service and the MCP server only. The agent never gets it.
const approvalSecret = randomBytes(32).toString('base64url');
const senderBatchId = paypal === 'fake' ? 'nl_demo_lan_0001' : `nl_demo_${randomBytes(6).toString('hex')}`;

const stack = await startStack({ approvalSecret, paypal, serverFrom: values.server as ServerFrom });
try {
  const info = stack.client.getServerVersion();
  const { tools } = await stack.client.listTools();
  await t.emit({
    kind: 'banner',
    text: `MCP client → ${info?.name ?? 'neighborline-payouts'} v${info?.version ?? '?'} (stdio) · ${paypal === 'fake' ? 'fake PayPal' : 'PayPal sandbox'} · ${mode === 'llm' ? `${provider} agent` : 'scripted agent'}`,
    detail: `${tools.length} tools: ${tools.map((x) => x.name).join(', ')}`,
  });
  const approvals = new DemoApprovalService(approvalSecret);
  if (mode === 'llm') await runLlm(stack, approvals, t, { provider, ...(values.model ? { model: values.model } : {}), senderBatchId, approve: values.approve === 'prompt' ? 'prompt' : 'auto' });
  else await runScripted(stack, approvals, t, { senderBatchId, tamper: Boolean(values.tamper) });
  if (values.verbose) for (const line of stack.serverLog) process.stderr.write(`${line}\n`);
  if (values.json) t.save(values.json, { mode, provider: mode === 'llm' ? provider : null, paypal, server: `${info?.name} v${info?.version}`, tools: tools.map((x) => x.name) });
} catch (err) {
  process.exitCode = 1;
  if (err instanceof UsageError) console.error(`\n${err.message}`);
  else throw err;
} finally {
  await stack.close();
}

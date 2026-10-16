#!/usr/bin/env node
// End-to-end check of the *published shape*: pack the package, install the tarball into a clean project outside the
// workspace, and use it the way a stranger would. Against tools/fake-paypal, so no credentials are needed.
//
//   pnpm --filter @neighborline/paypal pack:smoke              # project in /tmp/x (wiped first)
//   node scripts/pack-smoke.mjs --dir /some/empty/dir
//
// Checks: every subpath imports from the tarball under plain Node (no TypeScript loader); `tsc` with
// moduleResolution nodenext resolves the types of every subpath; a payout batch reaches SUCCESS in fake PayPal; the
// `neighborline-payouts-mcp` bin starts over stdio, refuses a payout without a token and pays with two signatures.
// Needs network access to the npm registry (for @modelcontextprotocol/sdk, zod and typescript).
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(PKG, '..', '..');
const dirIdx = process.argv.indexOf('--dir');
const DIR = dirIdx > -1 ? process.argv[dirIdx + 1] : '/tmp/x';
const sh = (cmd, args, cwd = DIR) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

rmSync(DIR, { recursive: true, force: true });
mkdirSync(join(DIR, 'tarball'), { recursive: true });
sh('node', [join(PKG, 'scripts', 'pack-check.mjs'), '--keep', join(DIR, 'tarball')], PKG);
const tgz = readdirSync(join(DIR, 'tarball')).find((f) => f.endsWith('.tgz'));

writeFileSync(join(DIR, 'package.json'), JSON.stringify({ name: 'nl-paypal-smoke', private: true, type: 'module' }, null, 2));
sh('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', `./tarball/${tgz}`, 'typescript@5']);

// 1. Types: every subpath resolves under nodenext, with strict mode.
writeFileSync(
  join(DIR, 'types.ts'),
  `import { createPayPal, toPayPalValue, type CreateBatchInput, VERSION } from '@neighborline/paypal';
import { signApprovalToken, createHmacApprovalVerifier, type ApprovalVerifier } from '@neighborline/paypal/approval';
import { parseWebhookEvent, applyItemStatus, type WebhookEvent } from '@neighborline/paypal/webhooks';
import { createPayoutsMcpServer, type AuditEntry } from '@neighborline/paypal/mcp';
const v: ApprovalVerifier = createHmacApprovalVerifier('x'.repeat(32));
const b: CreateBatchInput = { senderBatchId: 's', items: [{ senderItemId: 'i', amountCents: 100, receiver: 'a@b.c', recipientType: 'EMAIL' }] };
const s: string = toPayPalValue(15000) + VERSION + signApprovalToken('x'.repeat(32), { approvalId: 'a', batch: b, approvers: ['p', 'q'] });
const e: (raw: string) => WebhookEvent = parseWebhookEvent;
const a: AuditEntry | undefined = undefined;
void [v, s, e, a, applyItemStatus('PENDING', 'SUCCESS').status, createPayoutsMcpServer({ paypal: createPayPal({ clientId: 'c', clientSecret: 's', baseUrl: 'https://api-m.sandbox.paypal.com' }) })];
`,
);
writeFileSync(join(DIR, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext', target: 'es2022', strict: true, noEmit: true, skipLibCheck: false, types: [] }, files: ['types.ts'] }, null, 2));
sh(join(DIR, 'node_modules', '.bin', 'tsc'), ['-p', '.']);
console.log('[smoke] types resolve for ., ./approval, ./webhooks, ./mcp (nodenext, strict, skipLibCheck off)');

// 2. Runtime against fake PayPal, and the MCP bin over stdio.
const port = await freePort();
const fake = spawn(process.execPath, ['--import', 'tsx', join(REPO, 'tools', 'fake-paypal', 'src', 'main.ts')], {
  cwd: join(REPO, 'tools', 'fake-paypal'),
  env: { ...process.env, FAKE_PAYPAL_PORT: String(port), FAKE_PAYPAL_PROCESSING_DELAY_MS: '300' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve, reject) => {
  fake.stdout.on('data', (d) => String(d).includes('listening') && resolve());
  fake.on('exit', (c) => reject(new Error(`fake-paypal exited ${c}`)));
});

writeFileSync(
  join(DIR, 'smoke.mjs'),
  `import assert from 'node:assert/strict';
import { createPayPal, VERSION } from '@neighborline/paypal';
import { signApprovalToken, readApprovalToken } from '@neighborline/paypal/approval';
import { parseWebhookEvent, applyItemStatus } from '@neighborline/paypal/webhooks';
import { createPayoutsMcpServer } from '@neighborline/paypal/mcp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const FAKE = process.env.FAKE_PAYPAL_URL;
const paypal = createPayPal({ clientId: 'smoke', clientSecret: 'smoke', baseUrl: FAKE });
const batch = await paypal.payouts.createBatch({
  senderBatchId: 'smoke_' + Date.now(),
  items: [{ senderItemId: 'req_lan', amountCents: 15000, wallet: 'VENMO', recipientType: 'USER_HANDLE', receiver: '@lan-nguyen', note: 'from your neighbors', purpose: 'NON_GOODS_OR_SERVICES' }],
});
let items = [];
for (let i = 0; i < 40 && items[0]?.status !== 'SUCCESS'; i++) { await new Promise((r) => setTimeout(r, 100)); items = await paypal.payouts.listAllItems(batch.batchId); }
assert.equal(items[0].status, 'SUCCESS');
assert.equal(items[0].amountCents, 15000);
console.log('[smoke] library: batch', batch.batchId, '→', items[0].status, items[0].amountCents, 'cents');
assert.equal(applyItemStatus('SUCCESS', 'ONHOLD').status, 'SUCCESS');
assert.equal(typeof parseWebhookEvent, 'function');
assert.equal(typeof createPayoutsMcpServer, 'function');

const SECRET = 'smoke-approval-secret-at-least-32-characters';
const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(new StdioClientTransport({
  command: 'npx', args: ['--no-install', 'neighborline-payouts-mcp'],
  env: { ...process.env, PAYPAL_MODE: 'fake', FAKE_PAYPAL_URL: FAKE, NEIGHBORLINE_APPROVAL_SECRET: SECRET },
  stderr: 'ignore',
}));
assert.equal(client.getServerVersion()?.version, VERSION);
const { tools } = await client.listTools();
assert.equal(tools.length, 6);
const args = { sender_batch_id: 'smoke_mcp_' + Date.now(), items: [{ sender_item_id: 'req_rosa', amount_cents: 12000, receiver: 'rosa@example.com', recipient_type: 'EMAIL' }] };
const refused = await client.callTool({ name: 'create_payout_batch', arguments: args });
assert.equal(refused.isError, true);
assert.match(refused.content[0].text, /^Refused: no approval_token/);
const token = signApprovalToken(SECRET, { approvalId: 'appr_smoke', approvers: ['org_ana', 'org_ben'], batch: { senderBatchId: args.sender_batch_id, items: [{ senderItemId: 'req_rosa', amountCents: 12000, receiver: 'rosa@example.com', recipientType: 'EMAIL' }] } });
assert.deepEqual(readApprovalToken(token).approvers, ['org_ana', 'org_ben']);
const paid = await client.callTool({ name: 'create_payout_batch', arguments: { ...args, approval_token: token } });
assert.equal(paid.isError ?? false, false, paid.content[0].text);
console.log('[smoke] mcp bin v' + VERSION + ': ' + tools.length + ' tools; no token → refused; two signatures → batch', paid.structuredContent.batchId, paid.structuredContent.status);
await client.close();
`,
);
try {
  execFileSync(process.execPath, ['smoke.mjs'], { cwd: DIR, stdio: 'inherit', env: { ...process.env, FAKE_PAYPAL_URL: `http://127.0.0.1:${port}` } });
  console.log(`[smoke] OK: ${tgz} installs and works from a clean project (${DIR})`);
} finally {
  fake.kill('SIGTERM');
}

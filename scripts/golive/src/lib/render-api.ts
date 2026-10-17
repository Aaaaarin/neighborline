/**
 * The slice of Render's public REST API (https://api.render.com/v1, `Authorization: Bearer <RENDER_API_KEY>`) that
 * deploy-render needs. Endpoints from Render's OpenAPI spec (api-docs.render.com/openapi/render-public-api-1.json,
 * read Oct 17 2026): owners, services (list by name), env-vars (list, PUT one key, DELETE one key), deploys (create:
 * 201 deploy or 202 queued; get; list), env-groups, blueprints (list, validate). There is NO endpoint that creates a
 * Blueprint from a repo, so the first apply is a dashboard click (docs/GOLIVE.md).
 * List endpoints return `[{cursor, <resource>}]`.
 */
export const RENDER_API = 'https://api.render.com/v1';

export class RenderApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: unknown,
  ) {
    super(`Render API ${path} → ${status}: ${typeof body === 'object' && body && 'message' in body ? String((body as { message: unknown }).message) : JSON.stringify(body)?.slice(0, 200)}`);
  }
}

export interface RenderService {
  id: string;
  name: string;
  type: string;
  ownerId?: string;
  repo?: string;
  branch?: string;
  suspended?: string;
  dashboardUrl?: string;
  serviceDetails?: { url?: string; plan?: string; region?: string };
}

export interface RenderDeploy {
  id: string;
  status: string;
  commit?: { id?: string; message?: string };
  createdAt?: string;
  finishedAt?: string;
}

/** Terminal deploy statuses; everything else (created, queued, build_in_progress, update_in_progress, pre_deploy_in_progress) is still moving. */
export const DEPLOY_OK = new Set(['live']);
export const DEPLOY_BAD = new Set(['build_failed', 'update_failed', 'canceled', 'pre_deploy_failed', 'deactivated']);

export class RenderApi {
  private readonly base: string;
  constructor(
    private readonly apiKey: string,
    opts: { baseUrl?: string; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {},
  ) {
    this.base = (opts.baseUrl ?? RENDER_API).replace(/\/+$/, '');
    this.f = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }
  private readonly f: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  async req<T>(method: string, path: string, body?: unknown, extra: { form?: FormData; okEmpty?: boolean } = {}): Promise<{ status: number; data: T }> {
    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = { authorization: `Bearer ${this.apiKey}`, accept: 'application/json' };
      if (body !== undefined) headers['content-type'] = 'application/json';
      const res = await this.f(`${this.base}${path}`, { method, headers, body: extra.form ?? (body === undefined ? null : JSON.stringify(body)), signal: AbortSignal.timeout(30_000) });
      const text = await res.text();
      const data = (text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : undefined) as T;
      if (res.ok) return { status: res.status, data };
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        const ra = Number(res.headers.get('retry-after'));
        await this.sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      throw new RenderApiError(res.status, path.split('?')[0]!, data);
    }
  }

  /** Follow `cursor` pagination of a list endpoint; unwraps `[{cursor, <key>}]`. */
  async list<T>(path: string, key: string, max = 500): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | undefined;
    for (;;) {
      const sep = path.includes('?') ? '&' : '?';
      const { data } = await this.req<Array<Record<string, unknown> & { cursor?: string }>>('GET', `${path}${sep}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      const page = Array.isArray(data) ? data : [];
      for (const row of page) out.push((row[key] ?? row) as T);
      if (page.length < 100 || out.length >= max) return out;
      cursor = page.at(-1)?.cursor;
      if (!cursor) return out;
    }
  }

  owners() {
    return this.list<{ id: string; name: string; email?: string; type?: string }>('/owners', 'owner');
  }

  async servicesByName(name: string): Promise<RenderService[]> {
    return (await this.list<RenderService>(`/services?name=${encodeURIComponent(name)}`, 'service')).filter((s) => s.name === name);
  }

  blueprints() {
    return this.list<{ id: string; name: string; status?: string; repo?: string; branch?: string }>('/blueprints', 'blueprint');
  }

  /** POST /blueprints/validate (multipart: ownerId + the render.yaml file). */
  async validateBlueprint(ownerId: string, yaml: string): Promise<{ valid: boolean; errors?: unknown; plan?: unknown }> {
    const form = new FormData();
    form.set('ownerId', ownerId);
    form.set('file', new Blob([yaml], { type: 'application/yaml' }), 'render.yaml');
    return (await this.req<{ valid: boolean; errors?: unknown; plan?: unknown }>('POST', '/blueprints/validate', undefined, { form })).data;
  }

  async envVars(serviceId: string): Promise<Record<string, string>> {
    const rows = await this.list<{ key: string; value: string }>(`/services/${serviceId}/env-vars`, 'envVar');
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async putEnvVar(serviceId: string, key: string, value: string): Promise<void> {
    await this.req('PUT', `/services/${serviceId}/env-vars/${encodeURIComponent(key)}`, { value });
  }

  async deleteEnvVar(serviceId: string, key: string): Promise<void> {
    await this.req('DELETE', `/services/${serviceId}/env-vars/${encodeURIComponent(key)}`);
  }

  /** 201 with the deploy, or 202 "queued" with no body: then the newest deploy is the one. */
  async triggerDeploy(serviceId: string): Promise<RenderDeploy | null> {
    const r = await this.req<RenderDeploy | undefined>('POST', `/services/${serviceId}/deploys`, { clearCache: 'do_not_clear' });
    if (r.data && typeof r.data === 'object' && 'id' in r.data) return r.data;
    return (await this.deploys(serviceId, 1))[0] ?? null;
  }

  async deploys(serviceId: string, limit = 5): Promise<RenderDeploy[]> {
    const { data } = await this.req<Array<{ deploy: RenderDeploy }>>('GET', `/services/${serviceId}/deploys?limit=${limit}`);
    return (Array.isArray(data) ? data : []).map((x) => x.deploy);
  }

  async deploy(serviceId: string, deployId: string): Promise<RenderDeploy> {
    return (await this.req<RenderDeploy>('GET', `/services/${serviceId}/deploys/${deployId}`)).data;
  }

  /** An env group's values (e.g. the generated NEIGHBORLINE_INTERNAL_SECRET for the signed smoke test). */
  async envGroupVars(name: string): Promise<Record<string, string> | null> {
    const groups = (await this.list<{ id: string; name: string }>(`/env-groups?name=${encodeURIComponent(name)}`, 'envGroup')).filter((g) => g.name === name);
    if (!groups[0]) return null;
    const { data } = await this.req<{ envVars?: Array<{ key: string; value: string }> }>('GET', `/env-groups/${groups[0].id}`);
    return Object.fromEntries((data.envVars ?? []).map((v) => [v.key, v.value]));
  }
}

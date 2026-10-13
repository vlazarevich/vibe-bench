import { z } from 'zod';
import type pg from 'pg';
import { CatalogModel, ModelCatalog } from '../../../../packages/contracts/src/model-catalog.ts';
const RemoteModel = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  model_creator: z.object({ name: z.string() }),
  parameters: z.object({ total: z.number().nonnegative() }).nullish(),
  context_window_tokens: z.number().int().positive().nullish(),
  licensing: z.object({ is_open_weights: z.boolean() }).nullish(),
  openrouter_api_id: z.string().nullish(),
  modalities: z
    .object({ input: z.record(z.string(), z.boolean()), output: z.record(z.string(), z.boolean()) })
    .nullish(),
});
const RemotePage = z.object({
  tier: z.enum(['free', 'pro', 'commercial']),
  pagination: z.object({ page: z.number().int(), total_pages: z.number().int().nonnegative(), has_more: z.boolean() }),
  data: z.array(RemoteModel).max(1000),
});
export function normalizeModel(value: z.infer<typeof RemoteModel>): CatalogModel {
  const size = value.parameters?.total ?? null;
  return CatalogModel.parse({
    id: value.id,
    name: value.name,
    slug: value.slug,
    family: value.model_creator.name,
    license: value.licensing ? (value.licensing.is_open_weights ? 'open' : 'closed') : 'unknown',
    modelClass:
      size === null
        ? null
        : size < 4
          ? 'XS'
          : size < 12
            ? 'S'
            : size < 40
              ? 'M'
              : size < 100
                ? 'L'
                : size < 400
                  ? 'XL'
                  : 'XXL',
    parametersBillions: size,
    contextWindow: value.context_window_tokens ?? null,
    aliases: value.openrouter_api_id ? [value.openrouter_api_id] : [],
    modalities: value.modalities
      ? [
          ...new Set(
            [...Object.entries(value.modalities.input), ...Object.entries(value.modalities.output)]
              .filter(([, present]) => present)
              .map(([name]) => name),
          ),
        ]
      : [],
  });
}
/** Server-only credential, durable daily cache, one refresh per app, bounded pages/bytes/time. */
export function modelCatalog(
  pool: pg.Pool,
  key = process.env.ARTIFICIAL_ANALYSIS_API_KEY,
  transport: typeof fetch = fetch,
) {
  let pending: Promise<ModelCatalog> | undefined;
  let retryAt = 0;
  let lastError: string | null = null;
  async function read(): Promise<ModelCatalog> {
    const rows = await pool.query('SELECT fetched_at,tier,models FROM model_catalog WHERE singleton');
    const cached = z
      .object({ fetched_at: z.date(), tier: z.string(), models: z.array(CatalogModel) })
      .optional()
      .parse(rows.rows[0]);
    const base = {
      fetchedAt: cached?.fetched_at.toISOString() ?? null,
      tier: cached?.tier ?? null,
      models: cached?.models ?? [],
    };
    if (!key)
      return {
        ...base,
        status: cached ? 'ready' : 'unconfigured',
        message: 'Set ARTIFICIAL_ANALYSIS_API_KEY on the dashboard to load model metadata.',
      };
    if (cached && Date.now() - cached.fetched_at.getTime() < 86_400_000)
      return {
        ...base,
        status: 'ready',
        message:
          cached.tier === 'free'
            ? 'Artificial Analysis Free provides model names and families. License and parameter size require Pro.'
            : null,
      };
    if (Date.now() < retryAt) return { ...base, status: 'unavailable', message: lastError };
    try {
      let endpoint = 'https://artificialanalysis.ai/api/v2/language/models';
      const get = async (page: number) =>
        transport(`${endpoint}?page=${page}`, { headers: { 'x-api-key': key }, signal: AbortSignal.timeout(15_000) });
      let response = await get(1);
      if (response.status === 403) {
        endpoint += '/free';
        response = await get(1);
      }
      const models: CatalogModel[] = [];
      let tier = '';
      for (let page = 1; page <= 30; page++) {
        if (!response.ok) throw new Error(`Artificial Analysis returned HTTP ${response.status}.`);
        const raw = await response.text();
        if (Buffer.byteLength(raw) > 5_000_000)
          throw new Error('Artificial Analysis response exceeded the size limit.');
        const parsed = RemotePage.parse(JSON.parse(raw));
        if (parsed.pagination.page !== page) throw new Error('Artificial Analysis returned an unexpected page.');
        tier = parsed.tier;
        models.push(...parsed.data.map(normalizeModel));
        if (!parsed.pagination.has_more) break;
        if (page === 30) throw new Error('Artificial Analysis exceeded the page limit.');
        response = await get(page + 1);
      }
      if (new Set(models.map((model) => model.id)).size !== models.length)
        throw new Error('Artificial Analysis returned duplicate model identities.');
      const fetchedAt = new Date().toISOString();
      await pool.query(
        `INSERT INTO model_catalog(singleton,fetched_at,tier,models) VALUES(true,$1,$2,$3) ON CONFLICT(singleton) DO UPDATE SET fetched_at=$1,tier=$2,models=$3`,
        [fetchedAt, tier, JSON.stringify(models)],
      );
      lastError = null;
      return {
        status: 'ready',
        fetchedAt,
        tier,
        models,
        message:
          tier === 'free'
            ? 'Artificial Analysis Free provides model names and families. License and parameter size require Pro.'
            : null,
      };
    } catch (error) {
      retryAt = Date.now() + 300_000;
      lastError =
        error instanceof z.ZodError || error instanceof SyntaxError
          ? 'Artificial Analysis returned an unsupported response.'
          : error instanceof Error && error.message.startsWith('Artificial Analysis')
            ? error.message
            : 'Artificial Analysis is unavailable. Cached metadata is retained.';
      return { ...base, status: 'unavailable', message: lastError };
    }
  }
  return () =>
    (pending ??= read().finally(() => {
      pending = undefined;
    }));
}

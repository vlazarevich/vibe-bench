import { z } from 'zod';
export const ModelClass = z.enum(['XXL', 'XL', 'L', 'M', 'S', 'XS']);
export const CatalogModel = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    family: z.string(),
    license: z.enum(['open', 'closed', 'unknown']),
    modelClass: ModelClass.nullable(),
    parametersBillions: z.number().nonnegative().nullable(),
    contextWindow: z.number().int().positive().nullable(),
    aliases: z.array(z.string()),
    modalities: z.array(z.string()),
  })
  .strict();
export type CatalogModel = z.infer<typeof CatalogModel>;
export const ModelCatalog = z
  .object({
    status: z.enum(['ready', 'unconfigured', 'unavailable']),
    fetchedAt: z.iso.datetime().nullable(),
    tier: z.string().nullable(),
    models: z.array(CatalogModel),
    message: z.string().nullable(),
  })
  .strict();
export type ModelCatalog = z.infer<typeof ModelCatalog>;
/** Match exact provider IDs/names only. Ambiguous reasoning variants remain unknown. */
export function matchCatalogModel(model: string, catalog: CatalogModel[]) {
  const name = model.toLowerCase();
  const exact = catalog.filter((item) =>
    [item.slug, item.name, ...item.aliases].some((alias) => alias.toLowerCase() === name),
  );
  if (exact.length === 1) return exact[0];
  const unqualified = name.split('/').at(-1);
  const matches = catalog.filter((item) =>
    [item.slug, item.name, ...item.aliases].some((alias) => alias.toLowerCase() === unqualified),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

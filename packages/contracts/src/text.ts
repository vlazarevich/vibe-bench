import { z } from 'zod';

export const Text = z.string().refine((value) => !/[\0\uD800-\uDFFF]/u.test(value), 'Use valid Unicode text without NUL characters');

import type { ItemResponseEnvelope, ListResponseEnvelope } from "./types";

/**
 * Wraps a page of results into a standardised list envelope with pagination metadata.
 *
 * `has_more` is `true` when there are results beyond `offset + data.length`.
 *
 * @example
 * ```ts
 * return c.json(listResponse(rows, total, query.limit, query.offset));
 * // { data: [...], meta: { total: 42, limit: 20, offset: 0, has_more: true } }
 * ```
 */
export const listResponse = <T>(
	data: T[],
	total: number,
	limit: number,
	offset: number,
): ListResponseEnvelope<T> => ({
	data,
	meta: {
		total,
		limit,
		offset,
		has_more: offset + data.length < total,
	},
});

/**
 * Wraps a single item in a `{ data }` envelope for consistency with `listResponse`.
 *
 * @example
 * ```ts
 * return c.json(itemResponse(user));
 * // { data: { id: "abc", name: "Alice" } }
 * ```
 */
export const itemResponse = <T>(data: T): ItemResponseEnvelope<T> => ({
	data,
});

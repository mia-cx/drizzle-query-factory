/** @format */

import { and, sql, type SQL, type Table } from "drizzle-orm";
import { parseListQuery } from "./parse-list-query";
import { listResponse } from "./responses";
import type {
	ListQueryResult,
	ListResponseEnvelope,
	ParsedListQuery,
	RunListQueryEnvelopeOptions,
	RunListQueryRowsOptions,
} from "./types";

const composeWhere = (
	baseWhere: SQL | undefined,
	queryWhere: SQL | undefined,
): SQL | undefined => {
	if (baseWhere && queryWhere) return and(baseWhere, queryWhere);
	return baseWhere ?? queryWhere;
};

/** Resolves the `ParsedListQuery` from either the pre-parsed or raw-input variant. */
const resolveQuery = (opts: Record<string, any>): ParsedListQuery => {
	if ("query" in opts) return opts.query as ParsedListQuery;
	return parseListQuery(opts.input, opts.config);
};

/**
 * Executes a paginated list query against a Drizzle table, composing
 * `baseWhere` with parsed query-param filters from `parseListQuery`.
 *
 * Accepts either a pre-parsed `query` (from `parseListQuery`) or raw
 * `input` + `config` to parse internally — pick whichever suits the route.
 *
 * **Modes:**
 * - `"rows"` (default) — returns `{ rows, total, has_more }`
 * - `"envelope"` — returns `ListResponseEnvelope<T>` directly
 *
 * **Count behavior:**
 * - `count: true` (default) — runs rows + parallel `count(*)` for exact total
 * - `count: false` — single query only; metadata is heuristic:
 *   - `total = offset + rows.length` (lower-bound, not exact)
 *   - `has_more = rows.length === limit`
 *
 * @example
 * ```ts
 * // Pre-parsed (when you need intermediate access):
 * const query = parseListQuery(c.req.raw, config);
 * const result = await runListQuery({ db, table: features, query });
 *
 * // Raw-input convenience (parses for you):
 * const envelope = await runListQuery({
 *   db, table: features, input: c.req.raw, config: featureListConfig,
 *   mode: "envelope",
 * });
 * return c.json(envelope);
 * ```
 */
export async function runListQuery<TTable extends Table>(
	opts: RunListQueryRowsOptions<TTable>,
): Promise<ListQueryResult<TTable["$inferSelect"]>>;
export async function runListQuery<TTable extends Table>(
	opts: RunListQueryEnvelopeOptions<TTable>,
): Promise<ListResponseEnvelope<TTable["$inferSelect"]>>;
export async function runListQuery<TTable extends Table>(
	opts:
		| RunListQueryRowsOptions<TTable>
		| RunListQueryEnvelopeOptions<TTable>,
): Promise<
	| ListQueryResult<TTable["$inferSelect"]>
	| ListResponseEnvelope<TTable["$inferSelect"]>
> {
	const query = resolveQuery(opts);
	const { db, table, baseWhere, count: shouldCount = true } = opts;
	const mode = "mode" in opts && opts.mode === "envelope" ? "envelope" : "rows";
	const finalWhere = composeWhere(baseWhere, query.where);

	if (shouldCount) {
		const [rows, countResult] = await Promise.all([
			db
				.select()
				.from(table)
				.where(finalWhere)
				.orderBy(query.orderBy)
				.limit(query.limit)
				.offset(query.offset),
			db
				.select({ total: sql<number>`count(*)` })
				.from(table)
				.where(finalWhere),
		]);

		const total = countResult[0]?.total ?? 0;
		const has_more = query.offset + rows.length < total;

		if (mode === "envelope") {
			return listResponse(rows, total, query.limit, query.offset);
		}
		return { rows, total, has_more };
	}

	const rows = await db
		.select()
		.from(table)
		.where(finalWhere)
		.orderBy(query.orderBy)
		.limit(query.limit)
		.offset(query.offset);

	const total = query.offset + rows.length;
	const has_more = rows.length === query.limit;

	if (mode === "envelope") {
		return {
			data: rows,
			meta: { total, limit: query.limit, offset: query.offset, has_more },
		};
	}
	return { rows, total, has_more };
}

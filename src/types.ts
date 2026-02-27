import type { Column, SQL } from "drizzle-orm";

/**
 * Accepted input types for `parseListQuery`.
 *
 * Supports the standard Web API types shared by Hono, SvelteKit, and other
 * frameworks so the same config works everywhere without adapter code.
 *
 * - `Request`  — extracts the URL, then its searchParams
 * - `URL`      — uses `.searchParams` directly
 * - `URLSearchParams` — used as-is
 * - `Record<string, string>` — converted via `new URLSearchParams(record)`
 */
export type QueryInput =
	| URLSearchParams
	| Request
	| URL
	| Record<string, string>;

/** Comparison operator applied to a column filter. */
export type FilterOp = "eq" | "like" | "gt" | "gte" | "lt" | "lte" | "in";

/**
 * Maps a query-string parameter to a Drizzle column and operator.
 *
 * @example
 * ```ts
 * // ?status=LISTED  →  eq(resources.status, "LISTED")
 * { column: resources.status }
 *
 * // ?title=hello    →  like(resources.title, "%hello%")
 * { column: resources.title, op: "like" }
 *
 * // ?min_age=18     →  gte(users.age, 18)
 * { column: users.age, op: "gte", parse: (v) => parseInt(v, 10) }
 * ```
 */
export type ColumnFilter = {
	/** The Drizzle column to compare against. */
	column: Column;
	/** Comparison operator. Defaults to `"eq"`. */
	op?: FilterOp;
	/**
	 * Optional coercion from the raw string value to the column's expected type.
	 * Called once per value (or once per comma-separated item when `op` is `"in"`).
	 * Defaults to identity (string passthrough).
	 */
	parse?: (value: string) => unknown;
};

/**
 * A consumer-defined filter that receives the raw query-param value and
 * returns an arbitrary Drizzle `SQL` condition — or `undefined` to skip.
 *
 * Useful for logic that can't be expressed as a single column comparison:
 * permission sub-queries, joins, composite conditions, etc.
 *
 * @example
 * ```ts
 * const customFilters = {
 *   scope: (value) =>
 *     value === "mine"
 *       ? sql`${resources.ownerId} = ${currentUserId}`
 *       : undefined,
 * };
 * ```
 */
export type CustomFilter = (value: string) => SQL | undefined;

/**
 * Declarative configuration for `parseListQuery`.
 *
 * Every key in `filters` and `sortable` acts as an allowlist entry —
 * query params that don't match any key are silently ignored.
 */
export type ListQueryConfig = {
	/** Query-param name → column filter. Only these params produce WHERE clauses. */
	filters: Record<string, ColumnFilter>;
	/** Optional app-specific filters that return raw SQL. */
	customFilters?: Record<string, CustomFilter>;
	/** Allowed sort keys → Drizzle columns. Unknown sort keys fall back to `defaultSort`. */
	sortable: Record<string, Column>;
	/** Fallback sort when no `sort` param is given or the key is invalid. */
	defaultSort: { key: string; dir: "asc" | "desc" };
	/** Page size when `limit` is absent or invalid. Default: `20`. */
	defaultLimit?: number;
	/** Upper bound for `limit`. Values above this are clamped. Default: `100`. */
	maxLimit?: number;
};

/**
 * The output of `parseListQuery` — ready to spread into a Drizzle query.
 *
 * `where` is `undefined` when no filters matched, so you can safely
 * pass it to `.where()` (Drizzle treats `undefined` as "no condition").
 */
export type ParsedListQuery = {
	/** AND of all matched filter conditions, or `undefined` if none matched. */
	where: SQL | undefined;
	/** Sort expression (column + direction). */
	orderBy: SQL;
	/** Clamped page size in the range `[1, maxLimit]`. */
	limit: number;
	/** Clamped offset, always `>= 0`. */
	offset: number;
};

/** Pagination metadata included in list responses. */
export type ListResponseMeta = {
	total: number;
	limit: number;
	offset: number;
	has_more: boolean;
};

/** Standardized envelope for paginated list endpoints. */
export type ListResponseEnvelope<T> = {
	data: T[];
	meta: ListResponseMeta;
};

/** Standardized envelope for single-item endpoints. */
export type ItemResponseEnvelope<T> = {
	data: T;
};

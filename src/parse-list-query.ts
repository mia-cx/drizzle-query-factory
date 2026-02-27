/** @format */

import { and, asc, desc, type SQL } from "drizzle-orm";
import { applyOperator } from "./operators";
import type { ListQueryConfig, ParsedListQuery, QueryInput } from "./types";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Params consumed by the factory itself — never forwarded to filters. */
const RESERVED_PARAMS = new Set(["sort", "order", "limit", "offset"]);

/**
 * Normalises any supported `QueryInput` into `URLSearchParams`.
 *
 * Resolution order:
 *  1. `URLSearchParams` — returned as-is
 *  2. `URL`             — `.searchParams`
 *  3. `Request`         — `new URL(req.url).searchParams`
 *  4. `Record`          — `new URLSearchParams(record)`
 */
const resolveParams = (input: QueryInput): URLSearchParams => {
	if (input instanceof URLSearchParams) return input;
	if (input instanceof URL) return input.searchParams;
	if (input instanceof Request) return new URL(input.url).searchParams;
	return new URLSearchParams(input);
};

/** Parses a string to int, clamping to `[min, max]` or returning `fallback` on NaN / null. */
const parseIntClamped = (
	raw: string | null,
	min: number,
	max: number,
	fallback: number,
): number => {
	if (raw === null) return fallback;
	const parsed = parseInt(raw, 10);
	if (Number.isNaN(parsed)) return fallback;
	return Math.max(min, Math.min(max, parsed));
};

/**
 * Parses query parameters into a `ParsedListQuery` that can be spread
 * directly into a Drizzle `.where()` / `.orderBy()` / `.limit()` / `.offset()` chain.
 *
 * **Filters** — Each non-reserved param is matched against `config.filters` (column-based)
 * and then `config.customFilters` (arbitrary SQL). All matched conditions are AND-ed.
 * Unknown params are silently ignored (allowlist-only).
 *
 * **Sorting** — `?sort=<key>&order=asc|desc`. Invalid sort keys or order values
 * fall back to `config.defaultSort` instead of throwing.
 *
 * **Pagination** — `?limit=<n>&offset=<n>`. Limit is clamped to `[1, maxLimit]`,
 * offset to `>= 0`. Non-numeric values fall back to defaults.
 *
 * The returned `where` is `undefined` when no filters matched, so it composes
 * safely with auth conditions: `and(authWhere, query.where)`.
 *
 * @example
 * ```ts
 * // Hono
 * const query = parseListQuery(c.req.raw, config);
 *
 * // SvelteKit
 * const query = parseListQuery(event.url, config);
 *
 * // Plain object (tests)
 * const query = parseListQuery({ status: "active", limit: "10" }, config);
 * ```
 */
export const parseListQuery = (
	input: QueryInput,
	config: ListQueryConfig,
): ParsedListQuery => {
	const params = resolveParams(input);
	const conditions: SQL[] = [];
	const defaultLimit = config.defaultLimit ?? DEFAULT_LIMIT;
	const maxLimit = config.maxLimit ?? MAX_LIMIT;

	for (const [key, rawValue] of params.entries()) {
		if (RESERVED_PARAMS.has(key)) continue;
		if (!rawValue) continue;

		const columnFilter = config.filters[key];
		if (columnFilter) {
			const op = columnFilter.op ?? "eq";
			const parse = columnFilter.parse ?? ((v: string) => v);

			let value: unknown;
			if (op === "in") {
				value = rawValue.split(",").map(parse);
			} else {
				value = parse(rawValue);
			}

			conditions.push(
				applyOperator(op, columnFilter.column, value),
			);
			continue;
		}

		const customFilter = config.customFilters?.[key];
		if (customFilter) {
			const result = customFilter(rawValue);
			if (result) conditions.push(result);
		}
	}

	const where = conditions.length > 0 ? and(...conditions) : undefined;

	// --- sorting (invalid key/order → fallback to defaults) ---

	const sortKey = params.get("sort");
	const sortDir = params.get("order");

	const resolvedSortKey =
		sortKey && sortKey in config.sortable ?
			sortKey
		:	config.defaultSort.key;
	const resolvedSortDir =
		sortDir === "asc" || sortDir === "desc" ?
			sortDir
		:	config.defaultSort.dir;

	const sortColumn = config.sortable[resolvedSortKey]!;
	const orderBy =
		resolvedSortDir === "asc" ? asc(sortColumn) : desc(sortColumn);

	// --- pagination (clamped, never throws) ---

	const limit = parseIntClamped(
		params.get("limit"),
		1,
		maxLimit,
		defaultLimit,
	);
	const offset = parseIntClamped(params.get("offset"), 0, Infinity, 0);

	return { where, orderBy, limit, offset };
};

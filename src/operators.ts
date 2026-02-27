/** @format */

import {
	eq,
	like,
	gt,
	gte,
	lt,
	lte,
	inArray,
	type SQL,
	type Column,
} from "drizzle-orm";
import type { FilterOp } from "./types";

type OperatorFn = (column: Column, value: unknown) => SQL;

/**
 * Maps each `FilterOp` to its Drizzle comparison function.
 *
 * `like` wraps the value in `%…%` for a contains search.
 * `in` coerces non-array values into a single-element array for `inArray`.
 */
const operatorMap: Record<FilterOp, OperatorFn> = {
	eq: (col, val) => eq(col, val),
	like: (col, val) => like(col, `%${String(val)}%`),
	gt: (col, val) => gt(col, val),
	gte: (col, val) => gte(col, val),
	lt: (col, val) => lt(col, val),
	lte: (col, val) => lte(col, val),
	in: (col, val) => {
		const arr = Array.isArray(val) ? val : [val];
		return inArray(col, arr);
	},
};

/**
 * Resolves a `FilterOp` + column + value into a Drizzle `SQL` condition.
 *
 * This is the low-level building block used by `parseListQuery`; exported
 * for consumers who need to build conditions outside the query-param flow.
 */
export const applyOperator = (
	op: FilterOp,
	column: Column,
	value: unknown,
): SQL => {
	const fn = operatorMap[op];
	return fn(column, value);
};

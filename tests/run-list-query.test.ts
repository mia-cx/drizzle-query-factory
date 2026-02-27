/** @format */

import { describe, expect, it, vi } from "vitest";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { runListQuery } from "../src/run-list-query";
import type { ParsedListQuery } from "../src/types";

const features = sqliteTable("features", {
	id: text("id").primaryKey(),
	slug: text("slug").notNull(),
	active: integer("active", { mode: "boolean" }).notNull(),
	createdAt: integer("created_at").notNull(),
});

/**
 * Creates a mock Drizzle db that chains `.select().from().where().orderBy().limit().offset()`
 * and returns configurable row data and optional count result.
 */
const createMockDb = (opts: { rows: unknown[]; total?: number }) => {
	let callIndex = 0;

	const makeChain = (result: unknown[]) => {
		const chain: Record<string, any> = {};
		chain.from = vi.fn().mockReturnValue(chain);
		chain.where = vi.fn().mockReturnValue(chain);
		chain.orderBy = vi.fn().mockReturnValue(chain);
		chain.limit = vi.fn().mockReturnValue(chain);
		chain.offset = vi.fn().mockReturnValue(chain);
		chain.then = (resolve: any) => resolve(result);
		return chain;
	};

	const db = {
		select: vi.fn((...args: any[]) => {
			callIndex++;
			if (args.length > 0 && args[0]?.total !== undefined) {
				return makeChain([{ total: opts.total ?? opts.rows.length }]);
			}
			return makeChain(opts.rows);
		}),
	};

	return db;
};

const baseQuery: ParsedListQuery = {
	where: undefined,
	orderBy: desc(features.createdAt),
	limit: 20,
	offset: 0,
};

describe("runListQuery", () => {
	describe("where composition", () => {
		it("uses only query.where when no baseWhere", async () => {
			const qWhere = eq(features.active, true);
			const db = createMockDb({ rows: [], total: 0 });

			await runListQuery({
				db: db as any,
				table: features,
				query: { ...baseQuery, where: qWhere },
			});

			const rowsChain = db.select.mock.results[0].value;
			expect(rowsChain.where).toHaveBeenCalled();
			const whereArg = rowsChain.where.mock.calls[0][0];
			expect(whereArg).toBe(qWhere);
		});

		it("uses only baseWhere when query.where is undefined", async () => {
			const bWhere = eq(features.slug, "dark-mode");
			const db = createMockDb({ rows: [], total: 0 });

			await runListQuery({
				db: db as any,
				table: features,
				query: baseQuery,
				baseWhere: bWhere,
			});

			const rowsChain = db.select.mock.results[0].value;
			const whereArg = rowsChain.where.mock.calls[0][0];
			expect(whereArg).toBe(bWhere);
		});

		it("combines baseWhere and query.where with AND", async () => {
			const bWhere = eq(features.slug, "dark-mode");
			const qWhere = eq(features.active, true);
			const db = createMockDb({ rows: [], total: 0 });

			await runListQuery({
				db: db as any,
				table: features,
				query: { ...baseQuery, where: qWhere },
				baseWhere: bWhere,
			});

			const rowsChain = db.select.mock.results[0].value;
			const whereArg = rowsChain.where.mock.calls[0][0];
			const expected = and(bWhere, qWhere);
			expect(whereArg?.queryChunks).toEqual(expected?.queryChunks);
		});

		it("passes undefined where when neither baseWhere nor query.where", async () => {
			const db = createMockDb({ rows: [], total: 0 });

			await runListQuery({
				db: db as any,
				table: features,
				query: baseQuery,
			});

			const rowsChain = db.select.mock.results[0].value;
			const whereArg = rowsChain.where.mock.calls[0][0];
			expect(whereArg).toBeUndefined();
		});
	});

	describe("rows mode (default)", () => {
		it("returns { rows, total, has_more } by default", async () => {
			const mockRows = [
				{ id: "1", slug: "a", active: true, createdAt: 100 },
				{ id: "2", slug: "b", active: true, createdAt: 200 },
			];
			const db = createMockDb({ rows: mockRows, total: 5 });

			const result = await runListQuery({
				db: db as any,
				table: features,
				query: { ...baseQuery, limit: 2, offset: 0 },
			});

			expect(result).toHaveProperty("rows");
			expect(result).toHaveProperty("total", 5);
			expect(result).toHaveProperty("has_more", true);
			expect((result as any).data).toBeUndefined();
		});

		it("sets has_more to false when no more rows", async () => {
			const mockRows = [
				{ id: "1", slug: "a", active: true, createdAt: 100 },
			];
			const db = createMockDb({ rows: mockRows, total: 1 });

			const result = await runListQuery({
				db: db as any,
				table: features,
				query: { ...baseQuery, limit: 20, offset: 0 },
			});

			expect(result.has_more).toBe(false);
		});

		it("applies orderBy, limit, offset to the query chain", async () => {
			const db = createMockDb({ rows: [], total: 0 });
			const orderBy = asc(features.slug);

			await runListQuery({
				db: db as any,
				table: features,
				query: { ...baseQuery, orderBy, limit: 10, offset: 5 },
			});

			const rowsChain = db.select.mock.results[0].value;
			expect(rowsChain.orderBy).toHaveBeenCalledWith(orderBy);
			expect(rowsChain.limit).toHaveBeenCalledWith(10);
			expect(rowsChain.offset).toHaveBeenCalledWith(5);
		});
	});

	describe("envelope mode", () => {
		it("returns ListResponseEnvelope shape", async () => {
			const mockRows = [
				{ id: "1", slug: "a", active: true, createdAt: 100 },
			];
			const db = createMockDb({ rows: mockRows, total: 3 });

			const result = await runListQuery({
				db: db as any,
				table: features,
				query: { ...baseQuery, limit: 1, offset: 0 },
				mode: "envelope",
			});

			expect(result).toHaveProperty("data");
			expect(result).toHaveProperty("meta");
			expect((result as any).meta.total).toBe(3);
			expect((result as any).meta.limit).toBe(1);
			expect((result as any).meta.offset).toBe(0);
			expect((result as any).meta.has_more).toBe(true);
		});

		it("sets has_more false in envelope when at end", async () => {
			const mockRows = [
				{ id: "1", slug: "a", active: true, createdAt: 100 },
			];
			const db = createMockDb({ rows: mockRows, total: 1 });

			const result = await runListQuery({
				db: db as any,
				table: features,
				query: { ...baseQuery, limit: 20, offset: 0 },
				mode: "envelope",
			});

			expect((result as any).meta.has_more).toBe(false);
		});
	});

	describe("count: false (heuristic mode)", () => {
		it("makes a single query (no count(*))", async () => {
			const db = createMockDb({ rows: [{ id: "1", slug: "a", active: true, createdAt: 100 }] });

			await runListQuery({
				db: db as any,
				table: features,
				query: { ...baseQuery, limit: 20, offset: 0 },
				count: false,
			});

			expect(db.select).toHaveBeenCalledTimes(1);
			expect(db.select).toHaveBeenCalledWith();
		});

		it("computes heuristic total as offset + rows.length", async () => {
			const mockRows = [
				{ id: "1", slug: "a", active: true, createdAt: 100 },
				{ id: "2", slug: "b", active: true, createdAt: 200 },
			];
			const db = createMockDb({ rows: mockRows });

			const result = await runListQuery({
				db: db as any,
				table: features,
				query: { ...baseQuery, limit: 20, offset: 10 },
				count: false,
			});

			expect(result.total).toBe(12);
		});

		it("sets has_more true when rows.length === limit", async () => {
			const mockRows = Array.from({ length: 5 }, (_, i) => ({
				id: String(i),
				slug: `s-${i}`,
				active: true,
				createdAt: i,
			}));
			const db = createMockDb({ rows: mockRows });

			const result = await runListQuery({
				db: db as any,
				table: features,
				query: { ...baseQuery, limit: 5, offset: 0 },
				count: false,
			});

			expect(result.has_more).toBe(true);
		});

		it("sets has_more false when rows.length < limit", async () => {
			const mockRows = [
				{ id: "1", slug: "a", active: true, createdAt: 100 },
			];
			const db = createMockDb({ rows: mockRows });

			const result = await runListQuery({
				db: db as any,
				table: features,
				query: { ...baseQuery, limit: 20, offset: 0 },
				count: false,
			});

			expect(result.has_more).toBe(false);
		});

		it("works with envelope mode and count: false", async () => {
			const mockRows = Array.from({ length: 3 }, (_, i) => ({
				id: String(i),
				slug: `s-${i}`,
				active: true,
				createdAt: i,
			}));
			const db = createMockDb({ rows: mockRows });

			const result = await runListQuery({
				db: db as any,
				table: features,
				query: { ...baseQuery, limit: 3, offset: 5 },
				count: false,
				mode: "envelope",
			});

			expect(result).toHaveProperty("data");
			expect(result).toHaveProperty("meta");
			expect((result as any).meta.total).toBe(8);
			expect((result as any).meta.has_more).toBe(true);
		});
	});

	describe("count: true (default)", () => {
		it("makes two parallel queries (rows + count)", async () => {
			const db = createMockDb({ rows: [], total: 0 });

			await runListQuery({
				db: db as any,
				table: features,
				query: baseQuery,
				count: true,
			});

			expect(db.select).toHaveBeenCalledTimes(2);
		});

		it("falls back to 0 when count result is empty", async () => {
			const mockDb = {
				select: vi.fn((...args: any[]) => {
					const chain: Record<string, any> = {};
					chain.from = vi.fn().mockReturnValue(chain);
					chain.where = vi.fn().mockReturnValue(chain);
					chain.orderBy = vi.fn().mockReturnValue(chain);
					chain.limit = vi.fn().mockReturnValue(chain);
					chain.offset = vi.fn().mockReturnValue(chain);
					if (args.length > 0 && args[0]?.total !== undefined) {
						chain.then = (resolve: any) => resolve([]);
					} else {
						chain.then = (resolve: any) => resolve([]);
					}
					return chain;
				}),
			};

			const result = await runListQuery({
				db: mockDb as any,
				table: features,
				query: baseQuery,
			});

			expect(result.total).toBe(0);
			expect(result.rows).toEqual([]);
		});
	});

	describe("raw-input overload (input + config)", () => {
		const config = {
			filters: {
				slug: { column: features.slug },
			},
			sortable: {
				created_at: features.createdAt,
			},
			defaultSort: { key: "created_at" as const, dir: "desc" as const },
		};

		it("parses raw URLSearchParams and executes the query", async () => {
			const mockRows = [
				{ id: "1", slug: "dark-mode", active: true, createdAt: 100 },
			];
			const db = createMockDb({ rows: mockRows, total: 1 });

			const result = await runListQuery({
				db: db as any,
				table: features,
				input: new URLSearchParams({ slug: "dark-mode" }),
				config,
				mode: "rows",
			});

			expect(result.rows).toEqual(mockRows);
			expect(result.total).toBe(1);
			expect(result.has_more).toBe(false);
		});

		it("parses raw Record<string, string> input", async () => {
			const db = createMockDb({ rows: [], total: 0 });

			const result = await runListQuery({
				db: db as any,
				table: features,
				input: { slug: "dark-mode", limit: "5" },
				config,
			});

			expect(result.rows).toEqual([]);
			const chain = db.select.mock.results[0].value;
			expect(chain.limit).toHaveBeenCalledWith(5);
		});

		it("works with envelope mode and raw input", async () => {
			const mockRows = [
				{ id: "1", slug: "a", active: true, createdAt: 100 },
			];
			const db = createMockDb({ rows: mockRows, total: 3 });

			const result = await runListQuery({
				db: db as any,
				table: features,
				input: new URLSearchParams({}),
				config,
				mode: "envelope",
			});

			expect(result).toHaveProperty("data");
			expect(result).toHaveProperty("meta");
			expect((result as any).meta.total).toBe(3);
		});

		it("composes baseWhere with parsed query filters", async () => {
			const db = createMockDb({ rows: [], total: 0 });

			await runListQuery({
				db: db as any,
				table: features,
				input: new URLSearchParams({ slug: "dark-mode" }),
				config,
				baseWhere: eq(features.active, true),
			});

			const chain = db.select.mock.results[0].value;
			const whereArg = chain.where.mock.calls[0][0];
			expect(whereArg).toBeDefined();
			expect(whereArg?.queryChunks).toBeDefined();
		});
	});
});

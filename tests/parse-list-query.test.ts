/** @format */

import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { parseListQuery } from "../src/parse-list-query";
import type { ListQueryConfig } from "../src/types";

const resources = sqliteTable("resources", {
	id: text("id").primaryKey(),
	title: text("title"),
	status: text("status").notNull(),
	type: text("type").notNull(),
	ownerId: text("owner_id").notNull(),
	createdAt: integer("created_at").notNull(),
	updatedAt: integer("updated_at").notNull(),
});

const config: ListQueryConfig = {
	filters: {
		status: { column: resources.status },
		type: { column: resources.type },
		owner_id: { column: resources.ownerId },
		title: { column: resources.title, op: "like" },
		min_created: {
			column: resources.createdAt,
			op: "gte",
			parse: (v) => parseInt(v, 10),
		},
	},
	sortable: {
		created_at: resources.createdAt,
		updated_at: resources.updatedAt,
		title: resources.title,
	},
	defaultSort: { key: "created_at", dir: "desc" },
};

const params = (obj: Record<string, string>) => new URLSearchParams(obj);

describe("parseListQuery", () => {
	describe("filters", () => {
		it("returns undefined where when no filters provided", () => {
			const result = parseListQuery(params({}), config);
			expect(result.where).toBeUndefined();
		});

		it("applies an eq filter", () => {
			const result = parseListQuery(
				params({ status: "LISTED" }),
				config,
			);
			expect(result.where).toBeDefined();
		});

		it("applies a like filter", () => {
			const result = parseListQuery(
				params({ title: "hello" }),
				config,
			);
			expect(result.where).toBeDefined();
		});

		it("applies a filter with parse function", () => {
			const result = parseListQuery(
				params({ min_created: "1700000000" }),
				config,
			);
			expect(result.where).toBeDefined();
		});

		it("combines multiple filters with AND", () => {
			const result = parseListQuery(
				params({ status: "LISTED", type: "post" }),
				config,
			);
			expect(result.where).toBeDefined();
		});

		it("ignores unknown filter params", () => {
			const result = parseListQuery(
				params({ unknown_param: "value" }),
				config,
			);
			expect(result.where).toBeUndefined();
		});

		it("ignores reserved params (sort, order, limit, offset)", () => {
			const result = parseListQuery(
				params({
					sort: "title",
					order: "asc",
					limit: "10",
					offset: "5",
				}),
				config,
			);
			expect(result.where).toBeUndefined();
		});

		it("ignores empty values", () => {
			const result = parseListQuery(
				params({ status: "" }),
				config,
			);
			expect(result.where).toBeUndefined();
		});
	});

	describe("custom filters", () => {
		it("applies a custom filter function", () => {
			const customConfig: ListQueryConfig = {
				...config,
				customFilters: {
					scope: (value) =>
						value === "mine" ?
							sql`${resources.ownerId} = 'user-1'`
						:	undefined,
				},
			};

			const result = parseListQuery(
				params({ scope: "mine" }),
				customConfig,
			);
			expect(result.where).toBeDefined();
		});

		it("skips custom filter when it returns undefined", () => {
			const customConfig: ListQueryConfig = {
				...config,
				customFilters: {
					scope: (value) =>
						value === "mine" ?
							sql`${resources.ownerId} = 'user-1'`
						:	undefined,
				},
			};

			const result = parseListQuery(
				params({ scope: "all" }),
				customConfig,
			);
			expect(result.where).toBeUndefined();
		});

		it("combines column filters and custom filters", () => {
			const customConfig: ListQueryConfig = {
				...config,
				customFilters: {
					scope: () =>
						sql`${resources.ownerId} = 'user-1'`,
				},
			};

			const result = parseListQuery(
				params({ status: "LISTED", scope: "mine" }),
				customConfig,
			);
			expect(result.where).toBeDefined();
		});
	});

	describe("sorting", () => {
		it("uses default sort when no sort param provided", () => {
			const result = parseListQuery(params({}), config);
			expect(result.orderBy).toBeDefined();
		});

		it("applies a valid sort key", () => {
			const result = parseListQuery(
				params({ sort: "title", order: "asc" }),
				config,
			);
			expect(result.orderBy).toBeDefined();
		});

		it("falls back to default sort on unknown sort key", () => {
			const result = parseListQuery(
				params({ sort: "nonexistent" }),
				config,
			);
			expect(result.orderBy).toBeDefined();
		});

		it("falls back to default order on invalid order value", () => {
			const result = parseListQuery(
				params({ sort: "title", order: "invalid" }),
				config,
			);
			expect(result.orderBy).toBeDefined();
		});
	});

	describe("input types", () => {
		it("accepts a plain Record<string, string>", () => {
			const result = parseListQuery(
				{ status: "LISTED", limit: "5" },
				config,
			);
			expect(result.where).toBeDefined();
			expect(result.limit).toBe(5);
		});

		it("accepts a URL object", () => {
			const url = new URL(
				"https://api.vesta.cx/resources?status=LISTED&sort=title&order=asc",
			);
			const result = parseListQuery(url, config);
			expect(result.where).toBeDefined();
		});

		it("accepts a Request object", () => {
			const req = new Request(
				"https://api.vesta.cx/resources?type=post&limit=10",
			);
			const result = parseListQuery(req, config);
			expect(result.where).toBeDefined();
			expect(result.limit).toBe(10);
		});

		it("accepts URLSearchParams (backwards compatible)", () => {
			const result = parseListQuery(
				new URLSearchParams({ status: "LISTED" }),
				config,
			);
			expect(result.where).toBeDefined();
		});
	});

	describe("pagination", () => {
		it("uses default limit and offset=0 when not specified", () => {
			const result = parseListQuery(params({}), config);
			expect(result.limit).toBe(20);
			expect(result.offset).toBe(0);
		});

		it("parses valid limit and offset", () => {
			const result = parseListQuery(
				params({ limit: "10", offset: "50" }),
				config,
			);
			expect(result.limit).toBe(10);
			expect(result.offset).toBe(50);
		});

		it("clamps limit to maxLimit (default 100)", () => {
			const result = parseListQuery(
				params({ limit: "500" }),
				config,
			);
			expect(result.limit).toBe(100);
		});

		it("clamps limit minimum to 1", () => {
			const result = parseListQuery(
				params({ limit: "0" }),
				config,
			);
			expect(result.limit).toBe(1);
		});

		it("clamps negative limit to 1", () => {
			const result = parseListQuery(
				params({ limit: "-5" }),
				config,
			);
			expect(result.limit).toBe(1);
		});

		it("falls back to default on non-numeric limit", () => {
			const result = parseListQuery(
				params({ limit: "abc" }),
				config,
			);
			expect(result.limit).toBe(20);
		});

		it("clamps negative offset to 0", () => {
			const result = parseListQuery(
				params({ offset: "-10" }),
				config,
			);
			expect(result.offset).toBe(0);
		});

		it("uses custom defaultLimit and maxLimit", () => {
			const customConfig: ListQueryConfig = {
				...config,
				defaultLimit: 50,
				maxLimit: 200,
			};

			const result = parseListQuery(params({}), customConfig);
			expect(result.limit).toBe(50);

			const clamped = parseListQuery(
				params({ limit: "300" }),
				customConfig,
			);
			expect(clamped.limit).toBe(200);
		});

		it("falls back to defaultLimit when limit is empty string", () => {
			const result = parseListQuery(
				params({ limit: "" }),
				config,
			);
			expect(result.limit).toBe(20);
		});

		it("truncates decimal limit values (parseInt behavior)", () => {
			const result = parseListQuery(
				params({ limit: "10.7" }),
				config,
			);
			expect(result.limit).toBe(10);
		});

		it("falls back to 0 when offset is empty string", () => {
			const result = parseListQuery(
				params({ offset: "" }),
				config,
			);
			expect(result.offset).toBe(0);
		});

		it("truncates decimal offset values (parseInt behavior)", () => {
			const result = parseListQuery(
				params({ offset: "25.3" }),
				config,
			);
			expect(result.offset).toBe(25);
		});
	});

	describe("in operator with comma-separated values", () => {
		it("splits comma-separated values for 'in' operator", () => {
			const configWithIn: ListQueryConfig = {
				...config,
				filters: {
					status: {
						column: resources.status,
						op: "in",
					},
				},
			};
			const result = parseListQuery(
				params({ status: "LISTED,UNLISTED,DRAFT" }),
				configWithIn,
			);
			expect(result.where).toBeDefined();
		});

		it("applies parse function to each comma-separated value for 'in' operator", () => {
			const configWithInParse: ListQueryConfig = {
				...config,
				filters: {
					min_created: {
						column: resources.createdAt,
						op: "in",
						parse: (v) => parseInt(v, 10),
					},
				},
			};
			const result = parseListQuery(
				params({
					min_created:
						"1700000000,1800000000,1900000000",
				}),
				configWithInParse,
			);
			expect(result.where).toBeDefined();
		});

		it("handles single value with 'in' operator", () => {
			const configWithIn: ListQueryConfig = {
				...config,
				filters: {
					type: {
						column: resources.type,
						op: "in",
					},
				},
			};
			const result = parseListQuery(
				params({ type: "post" }),
				configWithIn,
			);
			expect(result.where).toBeDefined();
		});
	});

	describe("sorting edge cases", () => {
		it("falls back to default when sort param is empty string", () => {
			const result = parseListQuery(
				params({ sort: "", order: "asc" }),
				config,
			);
			expect(result.orderBy).toBeDefined();
		});

		it("falls back to default when order param is empty string", () => {
			const result = parseListQuery(
				params({ sort: "title", order: "" }),
				config,
			);
			expect(result.orderBy).toBeDefined();
		});

		it("falls back to default order when order is empty even with valid sort key", () => {
			const result = parseListQuery(
				params({ sort: "created_at", order: "" }),
				config,
			);
			expect(result.orderBy).toBeDefined();
		});
	});

	describe("duplicate query params", () => {
		it("processes multiple values for same param key (all create conditions)", () => {
			const configWithIn: ListQueryConfig = {
				...config,
				filters: {
					status: {
						column: resources.status,
						op: "in",
					},
				},
			};

			const searchParams = new URLSearchParams();
			searchParams.append("status", "LISTED");
			searchParams.append("status", "UNLISTED");

			const result = parseListQuery(
				searchParams,
				configWithIn,
			);
			expect(result.where).toBeDefined();
		});
	});
});

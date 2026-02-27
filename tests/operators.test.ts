import { describe, expect, it } from "vitest";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { applyOperator } from "../src/operators";

const testTable = sqliteTable("test", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	age: integer("age").notNull(),
	status: text("status").notNull(),
});

describe("applyOperator", () => {
	it("returns an eq condition", () => {
		const result = applyOperator("eq", testTable.status, "active");
		expect(result).toBeDefined();
	});

	it("returns a like condition", () => {
		const result = applyOperator("like", testTable.name, "foo");
		expect(result).toBeDefined();
	});

	it("returns gt/gte/lt/lte conditions", () => {
		expect(applyOperator("gt", testTable.age, 18)).toBeDefined();
		expect(applyOperator("gte", testTable.age, 18)).toBeDefined();
		expect(applyOperator("lt", testTable.age, 65)).toBeDefined();
		expect(applyOperator("lte", testTable.age, 65)).toBeDefined();
	});

	it("returns an inArray condition for arrays", () => {
		const result = applyOperator("in", testTable.status, [
			"active",
			"pending",
		]);
		expect(result).toBeDefined();
	});

	it("wraps a non-array value in an array for 'in'", () => {
		const result = applyOperator("in", testTable.status, "active");
		expect(result).toBeDefined();
	});
});

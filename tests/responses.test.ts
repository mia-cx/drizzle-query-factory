import { describe, expect, it } from "vitest";
import { listResponse, itemResponse } from "../src/responses";

describe("listResponse", () => {
	it("returns data and meta with has_more=true when more results exist", () => {
		const result = listResponse([1, 2, 3], 10, 3, 0);
		expect(result).toEqual({
			data: [1, 2, 3],
			meta: { total: 10, limit: 3, offset: 0, has_more: true },
		});
	});

	it("returns has_more=false when all results are shown", () => {
		const result = listResponse([1, 2, 3], 3, 20, 0);
		expect(result).toEqual({
			data: [1, 2, 3],
			meta: { total: 3, limit: 20, offset: 0, has_more: false },
		});
	});

	it("handles offset pagination", () => {
		const result = listResponse([4, 5], 5, 3, 3);
		expect(result).toEqual({
			data: [4, 5],
			meta: { total: 5, limit: 3, offset: 3, has_more: false },
		});
	});

	it("returns has_more=true for middle pages", () => {
		const result = listResponse([4, 5, 6], 10, 3, 3);
		expect(result).toEqual({
			data: [4, 5, 6],
			meta: { total: 10, limit: 3, offset: 3, has_more: true },
		});
	});

	it("handles empty data", () => {
		const result = listResponse([], 0, 20, 0);
		expect(result).toEqual({
			data: [],
			meta: { total: 0, limit: 20, offset: 0, has_more: false },
		});
	});
});

describe("itemResponse", () => {
	it("wraps data in an envelope", () => {
		const result = itemResponse({ id: "1", name: "test" });
		expect(result).toEqual({ data: { id: "1", name: "test" } });
	});
});

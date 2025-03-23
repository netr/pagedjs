import Chunker from "./chunker";

describe("Chunker", () => {

	it("should create a page area", async () => {
		const chunker = new Chunker(undefined);
		chunker.setup();
		expect(chunker.pagesArea.classList).toContain("pagedjs_pages");
	});

});

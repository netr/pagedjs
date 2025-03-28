import * as cut from "./event-emitter";

describe("EventEmitter", () => {

	class A extends cut.EventEmitter<{ test(arg: number): void }> {
		public doit() {
			this.emit("test", 42);
		}
	}

	it("can be used as a superclass", async () => {
		const obj = new A();

		let got: number | undefined;
		const fun = (n: number) => got = n;

		obj.on("test", fun);
		obj.doit();
		obj.off("test", fun);

		expect(got).toBe(42);
	});

	it("can use once", async () => {
		const obj = new A();

		let got: number | undefined;
		const fun = (n: number) => got = n;

		obj.once("test", fun);
		obj.doit();

		expect(got).toBe(42);
	});

});

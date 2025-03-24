import Sheet from "./sheet";
import type { SheetHooks } from "./sheet";
import baseStyles from "./base";
import Hook from "../utils/hook";
import request from "../utils/request";

export type PolisherHooks = SheetHooks;

class Polisher {
	private readonly inserted: HTMLStyleElement[] = [];
	private sheets: Sheet[] = [];
	private base?: HTMLStyleElement;
	private styleEl?: HTMLStyleElement;
	public styleSheet?: CSSStyleSheet;

	// TODO: these seem unused and the type is uncertain.
	private width?: string | number;
	private height?: string | number;
	private orientation?: string | number;

	public readonly hooks: PolisherHooks = {
		onUrl: new Hook(this),
		onAtPage: new Hook(this),
		onAtMedia: new Hook(this),
		onRule: new Hook(this),
		onDeclaration: new Hook(this),
		onSelector: new Hook(this),
		onPseudoSelector: new Hook(this),

		onContent: new Hook(this),
		onImport: new Hook(this),

		beforeTreeParse: new Hook(this),
		beforeTreeWalk: new Hook(this),
		afterTreeWalk: new Hook(this),
	};

	public constructor(setup = true) {
		if (setup) {
			this.setup();
		}
	}

	public setup() {
		this.base = this.insert(baseStyles);
		this.styleEl = document.createElement("style");
		document.head.appendChild(this.styleEl);
		this.styleSheet = this.styleEl.sheet;
		return this.styleSheet;
	}

	public async add(...args: (string | Record<string, string>)[]) {
		const fetched: Promise<string>[] = [];
		const urls: string[] = [];

		for (const arg of args) {
			let f: Promise<string>;

			if (typeof arg === "object") {
				for (const url in arg) {
					f = new Promise(function(resolve) {
						urls.push(url);
						resolve(arg[url]);
					});
					// TODO: fetched and urls must have the same cardinality, so this should happen here:
					//
					// fetched.push(f);
				}
			} else {
				urls.push(arg);
				f = request(arg).then((response) => {
					return response.text();
				});
			}


			fetched.push(f);
		}

		return await Promise.all(fetched)
			.then(async (originals) => {
				let text = "";
				for (let index = 0; index < originals.length; index++) {
					text = await this.convertViaSheet(originals[index], urls[index]);
					this.insert(text);
				}
				return text;
			});
	}

	private async convertViaSheet(cssStr: string, href: string) {
		const sheet = new Sheet(href, this.hooks);
		await sheet.parse(cssStr);

		// Insert the imported sheets first
		for (const url of sheet.imported) {
			const str = await request(url).then((response) => {
				return response.text();
			});
			const text = await this.convertViaSheet(str, url);
			this.insert(text);
		}

		this.sheets.push(sheet);

		if (typeof sheet.width !== "undefined") {
			this.width = sheet.width;
		}
		if (typeof sheet.height !== "undefined") {
			this.height = sheet.height;
		}
		if (typeof sheet.orientation !== "undefined") {
			this.orientation = sheet.orientation;
		}
		return sheet.toString();
	}

	private insert(text: string){
		const head = document.querySelector("head");
		const style = document.createElement("style");
		style.setAttribute("data-pagedjs-inserted-styles", "true");

		style.appendChild(document.createTextNode(text));

		head.appendChild(style);

		this.inserted.push(style);
		return style;
	}

	public destroy() {
		this.styleEl.remove();
		this.inserted.forEach((s) => {
			s.remove();
		});
		this.sheets = [];
	}
}

export default Polisher;

import Hook from "../utils/hook";
import Chunker from "../chunker/chunker";
import type { ChunkerOptions } from "../chunker/chunker";
import type Page from "../chunker/page";
import Polisher from "../polisher/polisher";
import type { NamedPageSize } from "../polisher/sizes";

import { EventEmitter } from "../utils/event-emitter";
import { initializeHandlers, registerHandlers } from "../utils/handlers";
import type { Handlers } from "../utils/handlers";

export type PreviewerHooks = {
	beforePreview: Hook<[HTMLElement | DocumentFragment, Element]>,
	afterPreview: Hook<[Page[]]>,
};

export type PreviewerOptions = ChunkerOptions;

// TODO: injecting data into another class should be avoided.
export interface PreviewChunker extends Chunker {
	performance?: number;
	size?: Previewer["size"];
}

// TODO: this class should probably not make assumptions about the at-pages module.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AtPageModel = Record<string, any>;

interface PreviewerEventMap extends HandlersEventMap {
	rendering(chunker: PreviewChunker): void;
	page(page: Page): void;
	rendered(chunker: PreviewChunker): void;
}

interface HandlersEventMap {
	size(size: NamedPageSize): void;
	atpages(atpages: AtPageModel[]): void;
}

class Previewer extends EventEmitter<PreviewerEventMap> {
	// Process styles
	private readonly polisher = new Polisher(false);
	private readonly chunker: PreviewChunker;
	private size: NamedPageSize & { format?: undefined, orientation?: undefined } = {
		width: {
			value: 8.5,
			unit: "in"
		},
		height: {
			value: 11,
			unit: "in"
		},
		format: undefined,
		orientation: undefined
	};
	private handlers?: Handlers<HandlersEventMap>;
	private atpages?: AtPageModel[];

	public readonly hooks: PreviewerHooks;

	public constructor(private readonly settings: PreviewerOptions = {}) {
		super();

		// Chunk contents
		this.chunker = new Chunker(undefined, undefined, this.settings);

		// Hooks
		this.hooks = {
			beforePreview: new Hook(this),
			afterPreview: new Hook(this),
		};

		this.chunker.on("page", (page) => {
			this.emit("page", page);
		});

		this.chunker.on("rendering", () => {
			this.emit("rendering", this.chunker);
		});
	}

	private initializeHandlers() {
		const handlers = initializeHandlers<HandlersEventMap>(this.chunker, this.polisher, this);

		handlers.on("size", (size) => {
			this.size = size;
			this.emit("size", size);
		});

		handlers.on("atpages", (atpages) => {
			this.atpages = atpages;
			this.emit("atpages", atpages);
		});

		return handlers;
	}

	private registerHandlers(...args: Parameters<typeof registerHandlers>[0][]) {
		return registerHandlers(...args);
	}

	private getParams(name: string) {
		let param: string | undefined;
		// TODO: this used to be window.location, but URL takes a string.
		const url = new URL(window.location.href);
		const params = new URLSearchParams(url.search);
		for(const [k, v] of params.entries()) {
			if(k === name) {
				param = v;
			}
		}

		return param;
	}

	private wrapContent() {
		// Wrap body in template tag
		const body = document.querySelector<HTMLBodyElement>("body");

		// Check if a template exists
		let template = body.querySelector<HTMLTemplateElement>(":scope > template[data-ref='pagedjs-content']");

		if (!template) {
			// Otherwise create one
			template = document.createElement("template");
			template.dataset.ref = "pagedjs-content";
			template.innerHTML = body.innerHTML;
			body.innerHTML = "";
			body.appendChild(template);
		}

		return template.content;
	}

	private removeStyles(doc = document): (string | Record<string, string>)[] {
		// Get all stylesheets
		const stylesheets = Array.from(doc.querySelectorAll("link[rel='stylesheet']:not([data-pagedjs-ignore], [media~='screen'])"));
		// Get inline styles
		const inlineStyles = Array.from(doc.querySelectorAll("style:not([data-pagedjs-inserted-styles], [data-pagedjs-ignore], [media~='screen'])"));
		const elements = [...stylesheets, ...inlineStyles];
		return elements
			// preserve order
			.sort(function (element1, element2) {
				const position = element1.compareDocumentPosition(element2);
				if (position === Node.DOCUMENT_POSITION_PRECEDING) {
					return 1;
				} else if (position === Node.DOCUMENT_POSITION_FOLLOWING) {
					return -1;
				}
				return 0;
			})
			// extract the href
			.map((element) => {
				if (element.nodeName === "STYLE") {
					const obj = {};
					obj[window.location.href] = element.textContent;
					element.remove();
					return obj;
				}
				if (element.nodeName === "LINK") {
					element.remove();
					return (element as HTMLLinkElement).href;
				}
				// ignore
				console.warn(`Unable to process: ${element}, ignoring.`);
			});
	}

	public async preview(content: HTMLElement | DocumentFragment, stylesheets: (string | Record<string, string>)[], renderTo: Element) {

		await this.hooks.beforePreview.trigger(content, renderTo);

		if (!content) {
			content = this.wrapContent();
		}

		if (!stylesheets) {
			stylesheets = this.removeStyles();
		}

		this.polisher.setup();

		this.handlers = this.initializeHandlers();

		await this.polisher.add(...stylesheets);

		const startTime = performance.now();

		// Render flow
		const flow = await this.chunker.flow(content, renderTo);

		const endTime = performance.now();

		flow.performance = (endTime - startTime);
		flow.size = this.size;

		this.emit("rendered", flow);

		await this.hooks.afterPreview.trigger(flow.pages);

		return flow;
	}
}

export default Previewer;

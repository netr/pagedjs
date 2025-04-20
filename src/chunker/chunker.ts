import type BreakToken from "./breaktoken";
import Page from "./page";
import type { PageHooks, PageOptions } from "./page";
import ContentParser from "./parser";
import { EventEmitter } from "../utils/event-emitter";
import Hook from "../utils/hook";
import Queue from "../utils/queue";

const MAX_PAGES = null;
const MAX_LAYOUTS = false;

const TEMPLATE = `
<div class="pagedjs_page">
	<div class="pagedjs_sheet">
		<div class="pagedjs_bleed pagedjs_bleed-top">
			<div class="pagedjs_marks-crop"></div>
			<div class="pagedjs_marks-middle">
				<div class="pagedjs_marks-cross"></div>
			</div>
			<div class="pagedjs_marks-crop"></div>
		</div>
		<div class="pagedjs_bleed pagedjs_bleed-bottom">
			<div class="pagedjs_marks-crop"></div>
			<div class="pagedjs_marks-middle">
				<div class="pagedjs_marks-cross"></div>
			</div>		<div class="pagedjs_marks-crop"></div>
		</div>
		<div class="pagedjs_bleed pagedjs_bleed-left">
			<div class="pagedjs_marks-crop"></div>
			<div class="pagedjs_marks-middle">
				<div class="pagedjs_marks-cross"></div>
			</div>		<div class="pagedjs_marks-crop"></div>
		</div>
		<div class="pagedjs_bleed pagedjs_bleed-right">
			<div class="pagedjs_marks-crop"></div>
			<div class="pagedjs_marks-middle">
				<div class="pagedjs_marks-cross"></div>
			</div>
			<div class="pagedjs_marks-crop"></div>
		</div>
		<div class="pagedjs_pagebox">
			<div class="pagedjs_margin-top-left-corner-holder">
				<div class="pagedjs_margin pagedjs_margin-top-left-corner"><div class="pagedjs_margin-content"></div></div>
			</div>
			<div class="pagedjs_margin-top">
				<div class="pagedjs_margin pagedjs_margin-top-left"><div class="pagedjs_margin-content"></div></div>
				<div class="pagedjs_margin pagedjs_margin-top-center"><div class="pagedjs_margin-content"></div></div>
				<div class="pagedjs_margin pagedjs_margin-top-right"><div class="pagedjs_margin-content"></div></div>
			</div>
			<div class="pagedjs_margin-top-right-corner-holder">
				<div class="pagedjs_margin pagedjs_margin-top-right-corner"><div class="pagedjs_margin-content"></div></div>
			</div>
			<div class="pagedjs_margin-right">
				<div class="pagedjs_margin pagedjs_margin-right-top"><div class="pagedjs_margin-content"></div></div>
				<div class="pagedjs_margin pagedjs_margin-right-middle"><div class="pagedjs_margin-content"></div></div>
				<div class="pagedjs_margin pagedjs_margin-right-bottom"><div class="pagedjs_margin-content"></div></div>
			</div>
			<div class="pagedjs_margin-left">
				<div class="pagedjs_margin pagedjs_margin-left-top"><div class="pagedjs_margin-content"></div></div>
				<div class="pagedjs_margin pagedjs_margin-left-middle"><div class="pagedjs_margin-content"></div></div>
				<div class="pagedjs_margin pagedjs_margin-left-bottom"><div class="pagedjs_margin-content"></div></div>
			</div>
			<div class="pagedjs_margin-bottom-left-corner-holder">
				<div class="pagedjs_margin pagedjs_margin-bottom-left-corner"><div class="pagedjs_margin-content"></div></div>
			</div>
			<div class="pagedjs_margin-bottom">
				<div class="pagedjs_margin pagedjs_margin-bottom-left"><div class="pagedjs_margin-content"></div></div>
				<div class="pagedjs_margin pagedjs_margin-bottom-center"><div class="pagedjs_margin-content"></div></div>
				<div class="pagedjs_margin pagedjs_margin-bottom-right"><div class="pagedjs_margin-content"></div></div>
			</div>
			<div class="pagedjs_margin-bottom-right-corner-holder">
				<div class="pagedjs_margin pagedjs_margin-bottom-right-corner"><div class="pagedjs_margin-content"></div></div>
			</div>
			<div class="pagedjs_area">
				<div class="pagedjs_page_content"></div>
				<div class="pagedjs_footnote_area">
					<div class="pagedjs_footnote_content pagedjs_footnote_empty">
						<div class="pagedjs_footnote_inner_content"></div>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>`;

export type ChunkerHooks = PageHooks & {
	beforeParsed: Hook<[HTMLElement | DocumentFragment | undefined, Chunker]>,
	filter: Hook<[HTMLElement | DocumentFragment]>,
	afterParsed: Hook<[HTMLElement | DocumentFragment, Chunker]>,
	beforePageLayout: Hook<[Page, HTMLElement | DocumentFragment | undefined, BreakToken | undefined, Chunker]>,
	afterPageLayout: Hook<[HTMLElement, Page, BreakToken | undefined, Chunker]>,
	finalizePage: Hook<[HTMLElement, Page, undefined, Chunker]>,
	afterRendered: Hook<[Page[], Chunker]>,
};

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ChunkerOptions extends PageOptions {}

interface ChunkerEventMap {
	rendering(content: HTMLElement | DocumentFragment): void;
	page(page: Page): void;
	renderedPage(page: Page): void;
	rendered(pages: Page[]): void;
}

/**
 * Chop up text into flows
 * @class
 */
class Chunker extends EventEmitter<ChunkerEventMap> {
	public readonly hooks: ChunkerHooks = {
		beforeParsed: new Hook(this),
		filter: new Hook(this),
		afterParsed: new Hook(this),
		beforePageLayout: new Hook(this),
		onPageLayout: new Hook(this),
		layout: new Hook(this),
		renderNode: new Hook(this),
		layoutNode: new Hook(this),
		onOverflow: new Hook(this),
		afterOverflowRemoved: new Hook(this),
		afterOverflowAdded: new Hook(this),
		onBreakToken: new Hook(),
		beforeRenderResult: new Hook(this),
		afterPageLayout: new Hook(this),
		finalizePage: new Hook(this),
		afterRendered: new Hook(this),
	};
	private pageTemplate?: HTMLTemplateElement;
	private total = 0;
	private readonly q = new Queue<[], (IteratorResult<BreakToken | false> & { canceled?: boolean }) | void>(this);
	private stopped = false;
	private rendered = false;
	private readonly modifiedRules: Record<string, Record<string, CSSStyleRule[]>> = {};
	private readonly charsPerBreak: number[] = [];
	private source?: HTMLElement | DocumentFragment;
	private breakToken?: BreakToken;
	private isDebugEnabled = true; // Set to true to enable debug logs

	public pages: Page[] = [];
	public pagesArea: HTMLDivElement | undefined;

	public constructor(content: HTMLElement | undefined, renderTo?: Element, public readonly settings?: ChunkerOptions) {
		super();

		if (content) {
			this.flow(content, renderTo);
		}
	}

	public setup(renderTo?: Element) {
		this.pagesArea = document.createElement("div");
		this.pagesArea.classList.add("pagedjs_pages");

		if (renderTo) {
			renderTo.appendChild(this.pagesArea);
		} else {
			document.querySelector("body").appendChild(this.pagesArea);
		}

		this.pageTemplate = document.createElement("template");
		this.pageTemplate.innerHTML = TEMPLATE;

	}

	private readonly rulesToDisable: (string | Record<string, string>)[] = [
		"breakInside",
		"overflow",
		"overflowX",
		"overflowY",
	];

	private recordRulesToDisable() {
		for (const i in document.styleSheets) {
			const sheet = document.styleSheets[i];
			for (const j in sheet.cssRules) {
				const rule = sheet.cssRules.item(parseInt(j));
				if (rule && rule instanceof CSSStyleRule) {
					for (const k in this.rulesToDisable) {
						const disable = this.rulesToDisable[k];
						let attribName = disable;
						let skip = false;
						if (typeof attribName === "object") {
							attribName = Object.keys(attribName)[0];
							const value = disable[attribName];
							skip = !rule.style[attribName] || rule.style[attribName] !== value;
						}
						else {
							skip = !rule.style[attribName];
						}

						if (!skip) {
							// TODO: this used to be initialized with []
							this.modifiedRules[attribName] ??= {};
							this.modifiedRules[attribName][rule.style[attribName]] ??= [];
							this.modifiedRules[attribName][rule.style[attribName]].push(rule);
						}
					}
				}
			}
		}
	}

	private disableRules(rendered: HTMLElement | DocumentFragment) {
		for (const i in this.modifiedRules) {
			for (const j in this.modifiedRules[i]) {
				for (const k in this.modifiedRules[i][j]) {
					const rule = this.modifiedRules[i][j][k];
					rule.style[i] = "";
					const nodes = rendered.querySelectorAll<HTMLElement>(rule.selectorText);
					nodes.forEach((node) => {
						const attribName = i.substring(0, 1).toUpperCase() + i.substring(1);
						node.dataset[`original${attribName}`] = j;
					});
				}
			}
		}
	}

	private enableRules(rendered: HTMLElement | DocumentFragment) {
		for (const i in this.modifiedRules) {
			for (const j in this.modifiedRules[i]) {
				for (const k in this.modifiedRules[i][j]) {
					const rule = this.modifiedRules[i][j][k];
					rule.style[i] = j;
					const nodes = rendered.querySelectorAll<HTMLElement>(rule.selectorText);
					nodes.forEach((node) => {
						const attribName = i.substring(0, 1).toUpperCase() + i.substring(2);
						delete(node.dataset[`original${attribName}`]);
					});
				}
			}
		}
	}

	public async flow(content: HTMLElement | DocumentFragment | undefined, renderTo: Element | undefined) {
		// eslint-disable-next-line no-console
		console.log("📝 FLOW: Starting flow", { contentExists: !!content, renderToExists: !!renderTo });
		
		await this.hooks.beforeParsed.trigger(content, this);
		// eslint-disable-next-line no-console
		console.log("📝 FLOW: After beforeParsed hook");

		if (content) {
			// eslint-disable-next-line no-console
			console.log("📝 FLOW: Disabling rules for content");
			this.recordRulesToDisable();
			this.disableRules(content);
		}

		const parsed = new ContentParser(content).dom;
		// eslint-disable-next-line no-console
		console.log("📝 FLOW: Content parsed", { 
			parsedExists: !!parsed, 
			childNodeCount: parsed?.childNodes?.length 
		});

		this.hooks.filter.triggerSync(parsed);
		// eslint-disable-next-line no-console
		console.log("📝 FLOW: After filter hook");

		this.source = parsed;
		this.breakToken = undefined;
		// eslint-disable-next-line no-console
		console.log("📝 FLOW: Source set, breakToken reset");

		if (this.pagesArea && this.pageTemplate) {
			// eslint-disable-next-line no-console
			console.log("📝 FLOW: Clearing queue and removing pages");
			this.q.clear();
			this.removePages();
		} else {
			// eslint-disable-next-line no-console
			console.log("📝 FLOW: Setting up pagesArea and pageTemplate");
			this.setup(renderTo);
		}

		this.emit("rendering", parsed);
		// eslint-disable-next-line no-console
		console.log("📝 FLOW: Emitted 'rendering' event");

		await this.hooks.afterParsed.trigger(parsed, this);
		// eslint-disable-next-line no-console
		console.log("📝 FLOW: After afterParsed hook");

		await this.loadFonts();
		// eslint-disable-next-line no-console
		console.log("📝 FLOW: Fonts loaded");

		// eslint-disable-next-line no-console
		console.log("📝 FLOW: Starting initial render");
		let rendered = await this.render(parsed, this.breakToken);
		// eslint-disable-next-line no-console
		console.log("📝 FLOW: Initial render complete", { 
			canceled: rendered.canceled, 
			done: rendered.done,
			totalPages: this.total
		});
		
		let retryCount = 0;
		while (rendered.canceled) {
			retryCount++;
			// eslint-disable-next-line no-console
			console.log("📝 FLOW: Render was canceled, restarting", { retryCount });
			this.start();
			rendered = await this.render(parsed, this.breakToken);
			// eslint-disable-next-line no-console
			console.log("📝 FLOW: Re-render complete", { 
				canceled: rendered.canceled, 
				done: rendered.done,
				totalPages: this.total,
				retryCount
			});
		}

		this.rendered = true;
		this.pagesArea.style.setProperty("--pagedjs-page-count", String(this.total));
		// eslint-disable-next-line no-console
		console.log("📝 FLOW: Flow complete, final pages:", this.total);

		await this.hooks.afterRendered.trigger(this.pages, this);
		// eslint-disable-next-line no-console
		console.log("📝 FLOW: After afterRendered hook");

		this.emit("rendered", this.pages);
		// eslint-disable-next-line no-console
		console.log("📝 FLOW: Emitted 'rendered' event");

		this.enableRules(content);
		// eslint-disable-next-line no-console
		console.log("📝 FLOW: Rules re-enabled");

		return this;
	}

	private async render(parsed: HTMLElement | DocumentFragment, startAt: BreakToken | undefined) {
		// eslint-disable-next-line no-console
		console.log("📝 RENDER: Starting render process", { hasStartToken: !!startAt });
		const renderer = this.layout(parsed, startAt);

		let done = false;
		let result: { value?: BreakToken | false, done?: boolean, canceled?: boolean };

		let loops = 0;
		while (!done) {
			// eslint-disable-next-line no-console
			console.log("📝 RENDER: Loop iteration", { loops, total: this.total });
			result = await this.q.enqueue(() => this.renderAsync(renderer));
			// eslint-disable-next-line no-console
			console.log("📝 RENDER: Got result from renderAsync", { 
				done: result.done, 
				canceled: result.canceled,
				hasValue: !!result.value,
				valueType: result.value === false ? "false" : (result.value ? "BreakToken" : "undefined")
			});
			done = result.done;
			if(MAX_LAYOUTS) {
				loops += 1;
				if (loops >= MAX_LAYOUTS) {
					// eslint-disable-next-line no-console
					console.log("📝 RENDER: Reached MAX_LAYOUTS, stopping at", loops);
					this.stop();
					break;
				}
			}
		}

		// eslint-disable-next-line no-console
		console.log("📝 RENDER: Render complete", { 
			done: result.done, 
			canceled: result.canceled,
			totalPages: this.total
		});
		return result;
	}

	private start() {
		this.rendered = false;
		this.stopped = false;
	}

	private stop() {
		this.stopped = true;
	}

	private async renderAsync(renderer: AsyncIterator<BreakToken | false>) {
		// eslint-disable-next-line no-console
		console.log("📝 RENDER_ASYNC: Starting renderAsync");
		
		if (this.stopped) {
			// eslint-disable-next-line no-console
			console.log("📝 RENDER_ASYNC: Stopped flag is true, canceling");
			return { done: true, value: undefined, canceled: true };
		}
		
		// eslint-disable-next-line no-console
		console.log("📝 RENDER_ASYNC: Awaiting renderer.next()");
		const result = await renderer.next();
		// eslint-disable-next-line no-console
		console.log("📝 RENDER_ASYNC: Got result from renderer", { 
			done: result.done, 
			hasValue: !!result.value,
			valueType: result.value === false ? "false" : (result.value ? "BreakToken" : "undefined")
		});
		
		if (this.stopped) {
			// eslint-disable-next-line no-console
			console.log("📝 RENDER_ASYNC: Stopped flag set during execution, canceling");
			return { done: true, value: undefined, canceled: true };
		} else {
			return result;
		}
	}

	private async handleBreaks(node: Text | HTMLElement | DocumentFragment, force?: boolean) {
		// eslint-disable-next-line no-console
		console.log("📝 HANDLE_BREAKS: Starting", { 
			nodeType: node ? (node.nodeType || "unknown") : "no node", 
			force: !!force,
			currentPage: this.total + 1
		});
		
		const currentPage = this.total + 1;
		const currentPosition = currentPage % 2 === 0 ? "left" : "right";
		// TODO: Recto and Verso should reverse for rtl languages
		const currentSide = currentPage % 2 === 0 ? "verso" : "recto";

		if (currentPage === 1) {
			// eslint-disable-next-line no-console
			console.log("📝 HANDLE_BREAKS: First page, no breaks needed");
			return;
		}

		let previousBreakAfter: string | undefined;
		if (node &&
				"dataset" in node &&
				typeof node.dataset.previousBreakAfter !== "undefined") {
			previousBreakAfter = node.dataset.previousBreakAfter;
			// eslint-disable-next-line no-console
			console.log("📝 HANDLE_BREAKS: Found previousBreakAfter", { previousBreakAfter });
		}

		let breakBefore: string | undefined;
		if (node &&
				"dataset" in node &&
				typeof node.dataset.breakBefore !== "undefined") {
			breakBefore = node.dataset.breakBefore;
			// eslint-disable-next-line no-console
			console.log("📝 HANDLE_BREAKS: Found breakBefore", { breakBefore });
		}

		let page: Page | undefined;
		let breakReason = "none";
		
		if (force) {
			breakReason = "force=true";
			page = this.addPage(true);
		} else if( previousBreakAfter &&
				(previousBreakAfter === "left" || previousBreakAfter === "right") &&
				previousBreakAfter !== currentPosition) {
			breakReason = "previousBreakAfter position mismatch";
			page = this.addPage(true);
		} else if( previousBreakAfter &&
				(previousBreakAfter === "verso" || previousBreakAfter === "recto") &&
				previousBreakAfter !== currentSide) {
			breakReason = "previousBreakAfter side mismatch";
			page = this.addPage(true);
		} else if( breakBefore &&
				(breakBefore === "left" || breakBefore === "right") &&
				breakBefore !== currentPosition) {
			breakReason = "breakBefore position mismatch";
			page = this.addPage(true);
		} else if( breakBefore &&
				(breakBefore === "verso" || breakBefore === "recto") &&
				breakBefore !== currentSide) {
			breakReason = "breakBefore side mismatch";
			page = this.addPage(true);
		}

		// eslint-disable-next-line no-console
		console.log("📝 HANDLE_BREAKS: Break decision", { 
			addPage: !!page, 
			breakReason,
			totalPages: this.total
		});

		if (page) {
			// eslint-disable-next-line no-console
			console.log("📝 HANDLE_BREAKS: Processing added page", { pageId: page.id });
			await this.hooks.beforePageLayout.trigger(page, undefined, undefined, this);
			this.emit("page", page);
			// await this.hooks.layout.trigger(page.element, page, undefined, this);
			await this.hooks.afterPageLayout.trigger(page.element, page, undefined, this);
			await this.hooks.finalizePage.trigger(page.element, page, undefined, this);
			this.emit("renderedPage", page);
			// eslint-disable-next-line no-console
			console.log("📝 HANDLE_BREAKS: Page processed", { pageId: page.id });
		}
	}

	private async *layout(content: HTMLElement | DocumentFragment, startAt: BreakToken | undefined) {
		// eslint-disable-next-line no-console
		console.log("📝 LAYOUT: Starting layout generator", { hasStartAt: !!startAt, totalPages: this.total });

		let breakToken: BreakToken | undefined | false = startAt ?? false;
		let page: Page | undefined;
		let prevPage: HTMLElement | undefined;

		// before entering while loop
		// eslint-disable-next-line no-console
		console.log("📝 LAYOUT: Enter while loop condition", {
			canContinue: breakToken !== undefined && (MAX_PAGES ? this.total < MAX_PAGES : true),
			breakToken,
			breakTokenType: breakToken === false ? "false" : (breakToken ? "BreakToken" : "undefined"),
			totalPages: this.total,
			maxPages: MAX_PAGES
		});

		while ((breakToken !== undefined) && (MAX_PAGES ? this.total < MAX_PAGES : true)) {
			// eslint-disable-next-line no-console
			console.log("📝 LAYOUT: New layout iteration", { 
				totalPages: this.total,
				hasBreakToken: !!breakToken, 
				breakTokenType: breakToken === false ? "false" : (breakToken ? "BreakToken" : "undefined")
			});

			let range: Range | undefined;
			if (page && page.area.firstElementChild && page.area.firstElementChild.childElementCount) {
				range = document.createRange();
				range.selectNode(page.area.firstElementChild.childNodes[0]);
				range.setEndAfter(page.area.firstElementChild.lastChild);
			}

			const emptyBody = !range || !range.getBoundingClientRect().height;
			const emptyFootnotes = !page || !page.footnotesArea.firstElementChild || !page.footnotesArea.firstElementChild.childElementCount || !page.footnotesArea.firstElementChild.firstElementChild.getBoundingClientRect().height;
			const emptyPage = emptyBody && emptyFootnotes;
			const prevNumPages = this.total;

			// eslint-disable-next-line no-console
			console.log("📝 LAYOUT: Page state check", { 
				emptyBody, 
				emptyFootnotes, 
				emptyPage, 
				prevNumPages,
				shouldProcessBreaks: !page || !emptyPage
			});

			if (!page || !emptyPage) {
				if (breakToken) {
					if (breakToken.overflow.length && breakToken.overflow[0].node) {
						// eslint-disable-next-line no-console
						console.log("📝 LAYOUT: Handling breaks for overflow node");
						// Overflow.
						await this.handleBreaks(breakToken.overflow[0].node);
					}
					else {
						// eslint-disable-next-line no-console
						console.log("📝 LAYOUT: Handling breaks for breakToken node");
						await this.handleBreaks(breakToken.node);
					}
				} else {
					// eslint-disable-next-line no-console
					console.log("📝 LAYOUT: Handling breaks for first content child");
					await this.handleBreaks(content.firstChild as HTMLElement);
				}
			}

			const addedExtra = this.total != prevNumPages;
			// eslint-disable-next-line no-console
			console.log("📝 LAYOUT: After handleBreaks", { addedExtra, currentTotal: this.total });

			// Don't add a page if we have a forced break now and we just
			// did a break due to overflow but have nothing displayed on
			// the current page, unless there's overflow and we're finished.
			if (!page || addedExtra || !emptyPage) {
				// eslint-disable-next-line no-console
				console.log("📝 LAYOUT: Adding new page");
				this.addPage();
			} else {
				// eslint-disable-next-line no-console
				console.log("📝 LAYOUT: Not adding new page", { reason: "page exists and is empty without added extra pages" });
			}

			page = this.pages[this.total - 1];
			// eslint-disable-next-line no-console
			console.log("📝 LAYOUT: Current page", { pageIndex: this.total - 1, pageId: page.id });

			await this.hooks.beforePageLayout.trigger(page, content, breakToken || undefined, this);
			this.emit("page", page);

			// eslint-disable-next-line no-console
			console.log("📝 LAYOUT: Laying out content on page", { pageId: page.id });
			// Layout content in the page, starting from the breakToken.
			breakToken = await page.layout(content, breakToken || undefined, prevPage);
			// eslint-disable-next-line no-console
			console.log("📝 LAYOUT: Page layout complete", { 
				pageId: page.id, 
				hasBreakToken: !!breakToken,
				breakTokenType: (breakToken === undefined || !breakToken) ? "false" : (breakToken ? "BreakToken" : "undefined")
			});

			await this.hooks.afterPageLayout.trigger(page.element, page, breakToken, this);
			await this.hooks.finalizePage.trigger(page.element, page, undefined, this);
			this.emit("renderedPage", page);

			prevPage = page.wrapper;

			this.recoredCharLength(page.wrapper.textContent.length);
			
			// eslint-disable-next-line no-console
			console.log("📝 LAYOUT: Yielding breakToken", { 
				hasBreakToken: !!breakToken,
				breakTokenType: (breakToken === undefined || !breakToken) ? "false" : (breakToken ? "BreakToken" : "undefined"),
				totalPages: this.total
			});
			yield breakToken;
			console.log("📝 LAYOUT: After yield", { 
				breakToken,
				breakTokenType: breakToken !== undefined ? breakToken : (breakToken ? "BreakToken" : "undefined")
			  });
		}

		// new: log exit of loop just before completion
		// eslint-disable-next-line no-console
		console.log("📝 LAYOUT: Exiting while loop", {
			breakToken,
			breakTokenType: breakToken === false ? "false" : (breakToken ? "BreakToken" : "undefined"),
			totalPages: this.total,
			maxPages: MAX_PAGES,
			exitCondition: breakToken === undefined ? "breakToken undefined" : (MAX_PAGES && this.total >= MAX_PAGES ? "reached MAX_PAGES" : "unknown")
		});

		// eslint-disable-next-line no-console
		console.log("📝 LAYOUT: Layout generator complete", { 
			reason: breakToken === undefined ? "breakToken is undefined" : (MAX_PAGES && this.total >= MAX_PAGES ? "reached MAX_PAGES" : "unknown"),
			totalPages: this.total
		});
	}

	private recoredCharLength(length: number) {
		if (length === 0) {
			return;
		}

		this.charsPerBreak.push(length);

		// Keep the length of the last few breaks
		if (this.charsPerBreak.length > 4) {
			this.charsPerBreak.shift();
		}
	}

	private removePages(fromIndex=0) {
		// eslint-disable-next-line no-console
		console.log("📝 REMOVE_PAGES: Starting removal", { 
			fromIndex, 
			totalPagesBefore: this.total, 
			pagesLength: this.pages.length 
		});

		if (fromIndex >= this.pages.length) {
			// eslint-disable-next-line no-console
			console.log("📝 REMOVE_PAGES: fromIndex >= pages.length, nothing to remove");
			return;
		}

		// Remove pages
		// eslint-disable-next-line no-console
		console.log("📝 REMOVE_PAGES: Removing pages from index", fromIndex);
		for (let i = fromIndex; i < this.pages.length; i++) {
			// eslint-disable-next-line no-console
			console.log("📝 REMOVE_PAGES: Destroying page", { pageIndex: i, pageId: this.pages[i].id });
			this.pages[i].destroy();
		}

		if (fromIndex > 0) {
			// eslint-disable-next-line no-console
			console.log("📝 REMOVE_PAGES: Splicing pages array from index", fromIndex);
			this.pages.splice(fromIndex);
		} else {
			// eslint-disable-next-line no-console
			console.log("📝 REMOVE_PAGES: Resetting pages array");
			this.pages = [];
		}

		this.total = this.pages.length;
		// eslint-disable-next-line no-console
		console.log("📝 REMOVE_PAGES: Removal complete", { totalPagesAfter: this.total });
	}

	private addPage(blank?: boolean) {
		// eslint-disable-next-line no-console
		console.log("📝 ADD_PAGE: Adding new page", { totalPagesBefore: this.total, isBlank: !!blank });
		
		const lastPage = this.pages[this.pages.length - 1];
		// Create a new page from the template
		const page = new Page(this.pagesArea, this.pageTemplate, blank, this.hooks, this.settings);

		this.pages.push(page);

		// Create the pages
		page.create(undefined, lastPage && lastPage.element);

		page.index(this.total);
		
		// eslint-disable-next-line no-console
		console.log("📝 ADD_PAGE: Page created", { pageId: page.id, pageIndex: this.total - 1 });

		if (!blank) {
			// Listen for page overflow
			page.onOverflow((overflowToken) => {
				// eslint-disable-next-line no-console
				console.warn("📝 OVERFLOW: Page overflow detected", { pageId: page.id, hasOverflowToken: !!overflowToken });

				// Only reflow while rendering
				if (this.rendered) {
					// eslint-disable-next-line no-console
					console.log("📝 OVERFLOW: Already rendered, ignoring overflow");
					return;
				}

				const index = this.pages.indexOf(page) + 1;
				// eslint-disable-next-line no-console
				console.log("📝 OVERFLOW: Stopping render to handle overflow", { pageIndex: index, totalPages: this.total });

				// Stop the rendering
				this.stop();

				// Set the breakToken to resume at
				this.breakToken = overflowToken;

				// Remove pages
				this.removePages(index);
				
				// eslint-disable-next-line no-console
				console.log("📝 OVERFLOW: Pages removed after overflow", { remainingPages: this.pages.length });

				if (this.rendered) {
					this.rendered = false;
					// eslint-disable-next-line no-console
					console.log("📝 OVERFLOW: Re-rendering after overflow");

					this.q.enqueue(async () => {
						this.start();
						await this.render(this.source, this.breakToken);
						this.rendered = true;
					});
				}
			});
		}

		this.total = this.pages.length;
		// eslint-disable-next-line no-console
		console.log("📝 ADD_PAGE: Page added successfully", { totalPagesAfter: this.total });

		return page;
	}

	public async clonePage(originalPage: Page) {
		const lastPage = this.pages[this.pages.length - 1];

		const page = new Page(this.pagesArea, this.pageTemplate, false, this.hooks);

		this.pages.push(page);

		// Create the pages
		page.create(undefined, lastPage && lastPage.element);

		page.index(this.total);

		await this.hooks.beforePageLayout.trigger(page, undefined, undefined, this);
		this.emit("page", page);

		for (const className of originalPage.element.classList) {
			if (className !== "pagedjs_left_page" && className !== "pagedjs_right_page") {
				page.element.classList.add(className);
			}
		}

		await this.hooks.afterPageLayout.trigger(page.element, page, undefined, this);
		await this.hooks.finalizePage.trigger(page.element, page, undefined, this);
		this.emit("renderedPage", page);
	}

	private async loadFonts() {
		try {
			const fontPromises: Promise<string>[] = [];
			(document.fonts ?? []).forEach((fontFace: FontFace) => {
				if (fontFace.status !== "loaded") {
					const fontLoaded = fontFace.load().then(() => {
						return fontFace.family;
					}, () => {
						console.warn("Failed to preload font-family:", fontFace.family);
						return fontFace.family;
					});
					fontPromises.push(fontLoaded);
				}
			});

			return await Promise.all(fontPromises);
		} catch(err) {
			console.warn(err);
			return [];
		}
	}

	public destroy() {
		this.pagesArea.remove();
		this.pageTemplate.remove();
	}

}

export default Chunker;

import EventEmitter from "event-emitter";
import type { Emitter } from "event-emitter";

import BreakToken from "./breaktoken";
import Layout from "./layout";
import type { LayoutHooks, LayoutOptions } from "./layout";

export type PageHooks = LayoutHooks;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface PageOptions extends LayoutOptions {}

/**
 * Render a page
 * @class
 */
// Due to EventEmitter:
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
class Page {
	public width?: number;
	public height?: number;
	public element?: HTMLElement;
	public pagebox?: HTMLDivElement;
	public area?: HTMLDivElement;
	public footnotesArea?: HTMLDivElement;
	public wrapper?: HTMLDivElement;
	public id?: string;
	public name?: string;
	private position?: number;
	public startToken?: BreakToken;
	public endToken?: BreakToken;
	private layoutMethod?: Layout;
	private listening = false;
	private ro?: ResizeObserver;
	private _onOverflow?: (token: BreakToken) => void;
	private _onUnderflow?: (token: BreakToken) => void;
	private _onScroll?: () => void;

	public constructor(
		private readonly pagesArea: HTMLDivElement,
		private readonly pageTemplate: HTMLTemplateElement,
		private readonly blank: boolean,
		private readonly hooks: PageHooks,
		private readonly settings: PageOptions = {}) {}

	public create(_unusedTemplate: undefined, after: Element) {
		const clone = document.importNode(this.pageTemplate.content, true);

		let page: HTMLElement | undefined;
		let index: number | undefined;
		if (after) {
			this.pagesArea.insertBefore(clone, after.nextElementSibling);
			index = Array.prototype.indexOf.call(this.pagesArea.children, after.nextElementSibling);
			page = this.pagesArea.children[index] as HTMLElement;
		} else {
			this.pagesArea.appendChild(clone);
			page = this.pagesArea.lastChild as HTMLElement;
		}

		const pagebox = page.querySelector<HTMLDivElement>(".pagedjs_pagebox");
		const area = page.querySelector<HTMLDivElement>(".pagedjs_page_content");
		const footnotesArea = page.querySelector<HTMLDivElement>(".pagedjs_footnote_area");


		const size = area.getBoundingClientRect();

		area.style.columnWidth = Math.round(size.width) + "px";
		area.style.columnGap = "calc(var(--pagedjs-margin-right) + var(--pagedjs-margin-left) + var(--pagedjs-bleed-right) + var(--pagedjs-bleed-left) + var(--pagedjs-column-gap-offset))";

		this.width = Math.round(size.width);
		this.height = Math.round(size.height);

		this.element = page;
		this.pagebox = pagebox;
		this.area = area;
		this.footnotesArea = footnotesArea;

		return page;
	}

	private createWrapper() {
		const wrapper = document.createElement("div");

		this.area.appendChild(wrapper);

		this.wrapper = wrapper;

		return wrapper;
	}

	public index(pgnum: number) {
		this.position = pgnum;

		const page = this.element;

		const index = pgnum + 1;

		const id = `page-${index}`;

		this.id = id;

		page.dataset.pageNumber = String(index);
		page.setAttribute("id", id);

		if (this.name) {
			page.classList.add("pagedjs_" + this.name + "_page");
		}

		if (this.blank) {
			page.classList.add("pagedjs_blank_page");
		}

		if (pgnum === 0) {
			page.classList.add("pagedjs_first_page");
		}

		if (pgnum % 2 !== 1) {
			page.classList.remove("pagedjs_left_page");
			page.classList.add("pagedjs_right_page");
		} else {
			page.classList.remove("pagedjs_right_page");
			page.classList.add("pagedjs_left_page");
		}
	}

	public async layout(contents: HTMLElement | DocumentFragment, breakToken?: BreakToken, prevPage?: HTMLElement) {

		this.clear();

		this.startToken = breakToken;

		this.layoutMethod = new Layout(this.area, this.hooks, this.settings);

		const renderResult = await this.layoutMethod.renderTo(this.wrapper, contents, breakToken, prevPage);
		const newBreakToken = renderResult.breakToken;

		if (breakToken && newBreakToken && breakToken.equals(newBreakToken)) {
			return;
		}

		this.addListeners(contents);

		this.endToken = newBreakToken;

		return newBreakToken;
	}

	public async append(contents: HTMLElement, breakToken: BreakToken) {

		if (!this.layoutMethod) {
			return this.layout(contents, breakToken);
		}

		const renderResult = await this.layoutMethod.renderTo(this.wrapper, contents, breakToken);
		const newBreakToken = renderResult.breakToken;

		this.endToken = newBreakToken;

		return newBreakToken;
	}

	public getByParent(ref: string, entries: HTMLElement[]) {
		for (let i = 0; i < entries.length; i++) {
			const e = entries[i];
			if (e.dataset.ref === ref) {
				return e;
			}
		}
	}

	public onOverflow(func: (token: BreakToken) => void) {
		this._onOverflow = func;
	}

	public onUnderflow(func: (token: BreakToken) => void) {
		this._onUnderflow = func;
	}

	private clear() {
		this.removeListeners();
		this.wrapper?.remove();
		this.createWrapper();
	}

	private addListeners(contents: HTMLElement | DocumentFragment) {
		if (typeof ResizeObserver !== "undefined") {
			this.addResizeObserver(contents);
		} else {
			this.element.addEventListener("overflow", this._checkOverflowAfterResize, false);
			this.element.addEventListener("underflow", this._checkOverflowAfterResize, false);
		}
		// TODO: fall back to mutation observer?

		this._onScroll = function () {
			if (this.listening) {
				this.element.scrollLeft = 0;
			}
		}.bind(this);

		// Keep scroll left from changing
		this.element.addEventListener("scroll", this._onScroll);

		this.listening = true;

		return true;
	}

	private removeListeners() {
		this.listening = false;

		if (typeof ResizeObserver !== "undefined" && this.ro) {
			this.ro.disconnect();
		} else if (this.element) {
			this.element.removeEventListener("overflow", this._checkOverflowAfterResize, false);
			this.element.removeEventListener("underflow", this._checkOverflowAfterResize, false);
		}

		this.element?.removeEventListener("scroll", this._onScroll);

	}

	private addResizeObserver(contents: HTMLElement | DocumentFragment) {
		const wrapper = this.wrapper;
		let prevHeight = wrapper.getBoundingClientRect().height;
		this.ro = new ResizeObserver(entries => {

			if (!this.listening) {
				return;
			}
			requestAnimationFrame(() => {
				for (const entry of entries) {
					const cr = entry.contentRect;

					if (cr.height > prevHeight) {
						this.checkOverflowAfterResize(contents);
						prevHeight = wrapper.getBoundingClientRect().height;
					} else if (cr.height < prevHeight) { // TODO: calc line height && (prevHeight - cr.height) >= 22
						this.checkUnderflowAfterResize(contents);
						prevHeight = cr.height;
					}
				}
			});
		});

		this.ro.observe(wrapper);
	}

	private readonly _checkOverflowAfterResize = this.checkOverflowAfterResize.bind(this);
	private checkOverflowAfterResize(contents: HTMLElement | DocumentFragment) {
		if (!this.listening || !this.layoutMethod) {
			return;
		}

		const newBreakToken = this.layoutMethod.findBreakToken(this.wrapper, contents, undefined, this.startToken);

		if (newBreakToken) {
			this.endToken = newBreakToken;
			this._onOverflow?.(newBreakToken);
		}
	}

	private checkUnderflowAfterResize(contents: HTMLElement | DocumentFragment) {
		if (!this.listening || !this.layoutMethod) {
			return;
		}

		const endToken = this.layoutMethod.findEndToken(this.wrapper, contents);

		if (endToken) {
			this._onUnderflow?.(endToken);
		}
	}


	public destroy() {
		this.removeListeners();

		this.element.remove();

		this.element = undefined;
		this.wrapper = undefined;
	}
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unsafe-declaration-merging
declare interface Page extends Emitter {}

EventEmitter(Page.prototype);


export default Page;

import { getBoundingClientRect } from "../utils/utils.js";
import {
	child,
	cloneNode,
	findElement,
	hasContent,
	indexOf,
	indexOfTextNode,
	isContainer,
	isElement,
	isHTMLElement,
	isText,
	letters,
	needsBreakBefore,
	needsPageBreak,
	needsPreviousBreakAfter,
	nodeAfter,
	nodeBefore,
	parentOf,
	prevValidNode,
	rebuildTree,
	replaceOrAppendElement,
	validNode,
	walk,
	words
} from "../utils/dom.js";
import BreakToken from "./breaktoken";
import RenderResult from "./renderresult";
import EventEmitter from "event-emitter";
import type { Emitter } from "event-emitter";
import Hook from "../utils/hook.js";
import Overflow from "./overflow";

const MAX_CHARS_PER_BREAK = 1500;

export type LayoutHooks = Record<
	"onPageLayout" |
	"layout" |
	"renderNode" |
	"layoutNode" |
	"beforeOverflow" |
	"onOverflow" |
	"afterOverflowRemoved" |
	"afterOverflowAdded" |
	"onBreakToken" |
	"beforeRenderResult", Hook>;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface LayoutOptions {
	hyphenGlyph?: string;
	maxChars?: number;
}

interface LayoutOverflow extends Overflow {
	ancestor?: HTMLElement;
	content?: DocumentFragment;
}

interface LayoutHTMLElement extends HTMLElement {
	indexOfRefs?: Record<string, HTMLElement>;
}

/**
 * Layout
 * @class
 */
// Due to EventEmitter:
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
class Layout {
	private readonly bounds: DOMRect;
	private readonly gap: number;
	private readonly maxChars: number;
	private forceRenderBreak = false;
	private temporaryIndex = 0;
	private failed?: boolean;

	public constructor(
		private readonly element: HTMLElement,
		private readonly hooks?: LayoutHooks,
		private readonly settings: LayoutOptions = {}) {
		this.bounds = this.element.getBoundingClientRect();
		const parentBounds = this.element.offsetParent?.getBoundingClientRect() ?? { left: 0 };
		const gap = parseFloat(window.getComputedStyle(this.element).columnGap);

		if (gap) {
			const leftMargin = this.bounds.left - parentBounds.left;
			this.gap = gap - leftMargin;
		} else {
			this.gap = 0;
		}

		if (hooks) {
			this.hooks = hooks;
		} else {
			this.hooks = {
				onPageLayout: new Hook(),
				layout: new Hook(),
				renderNode: new Hook(),
				layoutNode: new Hook(),
				onOverflow: new Hook(),
				afterOverflowRemoved: new Hook(),
				afterOverflowAdded: new Hook(),
				onBreakToken: new Hook(),
				beforeRenderResult: new Hook(),
			};
		}

		this.maxChars = this.settings.maxChars || MAX_CHARS_PER_BREAK;
	}

	public async renderTo(wrapper: HTMLDivElement, source: HTMLElement | DocumentFragment, breakToken?: BreakToken, prevPage: HTMLElement | null = null, bounds = this.bounds) {
		const start = this.getStart(source, breakToken);
		let firstDivisible = source;

		while (firstDivisible.children.length === 1) {
			firstDivisible = firstDivisible.children[0] as HTMLElement;
		}

		let walker = walk(start, source);
		const prevBreakToken = breakToken ?? new BreakToken(start);

		this.hooks.onPageLayout.trigger(wrapper, prevBreakToken, this);

		// Add overflow, and check that it doesn't have overflow itself.
		this.addOverflowToPage(wrapper, breakToken, prevPage);

		// Footnotes may change the bounds.
		bounds = this.element.getBoundingClientRect();

		let newBreakToken = this.findBreakToken(wrapper, source, bounds, prevBreakToken, start);

		if (prevBreakToken.isFinished()) {
			if (newBreakToken) {
				newBreakToken.setFinished();
			}
			return new RenderResult(newBreakToken);
		}

		let hasRenderedContent = !!wrapper.childNodes.length;

		let forcedBreakQueue: HTMLElement[] = [];
		if (prevBreakToken) {
			forcedBreakQueue = prevBreakToken.getForcedBreakQueue();
		}

		let done = false;

		while (!done && !newBreakToken) {
			const next = walker.next();
			const node = next.value;
			done = next.done;

			if (node) {
				this.hooks.layoutNode.trigger(node);

				// Footnotes may change the bounds.
				bounds = this.element.getBoundingClientRect();

				// Check if the rendered element has a break set
				// Remember the node but don't apply the break until we have laid
				// out the rest of any parent content - this lets a table or divs
				// side by side still add content to this page before we start a new
				// one.
				if (isHTMLElement(node) && this.shouldBreak(node) && hasRenderedContent) {
					forcedBreakQueue.push(node);
				}

				if (!forcedBreakQueue.length && isHTMLElement(node) && node.dataset.page) {
					const named = node.dataset.page;
					const page = this.element.closest(".pagedjs_page");
					page.classList.add("pagejs_named_page");
					page.classList.add("pagedjs_" + named + "_page");
					if (!node.dataset.splitFrom) {
						page.classList.add("pagedjs_" + named + "_first_page");
					}
				}
			}

			// Check whether we have overflow when we've completed laying out a top
			// level element. This lets it have multiple children overflowing and
			// allows us to move all of the overflows onto the next page together.
			if (forcedBreakQueue.length || !node || !node.parentElement) {
				this.hooks.layout.trigger(wrapper, this);

				const imgs = wrapper.querySelectorAll<HTMLImageElement>("img");
				if (imgs.length) {
					await this.waitForImages(imgs);
				}

				newBreakToken = this.findBreakToken(wrapper, source, bounds, prevBreakToken, node);

				if (newBreakToken && node === undefined) {
					// We have run out of content. Do add the overflow to a new page but
					// don't repeat the whole thing again.
					newBreakToken.setFinished();
				}

				if (forcedBreakQueue.length) {
					if (newBreakToken) {
						newBreakToken.setForcedBreakQueue(forcedBreakQueue);
					}
					else {
						// TODO: forcedBreakQueue was being passed in, but ignored.
						newBreakToken = this.breakAt(forcedBreakQueue.shift());
					}
				}

				if (newBreakToken && newBreakToken.equals(prevBreakToken)) {
					this.failed = true;
					return new RenderResult(undefined, "Unable to layout item: " + node);
				}

				if (!node || newBreakToken) {
					return new RenderResult(newBreakToken);
				}
			}

			// Should the Node be a shallow or deep clone?
			const shallow = isContainer(node);

			this.append(node as Text | HTMLElement, wrapper, source, breakToken, shallow);
			bounds = this.element.getBoundingClientRect();

			// Check whether layout has content yet.
			if (!hasRenderedContent) {
				hasRenderedContent = hasContent(node);
			}

			// Skip to the next node if a deep clone was rendered.
			if (!shallow) {
				walker = walk(nodeAfter(node, source), source);
			}
		}

		this.hooks.beforeRenderResult.trigger(newBreakToken, wrapper, this);
		return new RenderResult(newBreakToken);
	}

	private breakAt(node: HTMLElement) {
		let newBreakToken = new BreakToken(node);
		const breakHooks = this.hooks.onBreakToken.triggerSync(newBreakToken, undefined, node, this);
		breakHooks.forEach((newToken) => {
			if (typeof newToken !== "undefined") {
				newBreakToken = newToken;
			}
		});

		return newBreakToken;
	}

	private shouldBreak(node: HTMLElement, limiter?: HTMLElement) {
		const previousNode = nodeBefore(node, limiter);
		const parentNode = node.parentNode as HTMLElement;
		const parentBreakBefore = needsBreakBefore(node) && parentNode && !previousNode && needsBreakBefore(parentNode);
		let doubleBreakBefore: boolean | undefined;

		if (parentBreakBefore) {
			doubleBreakBefore = node.dataset.breakBefore === parentNode.dataset.breakBefore;
		}

		return !doubleBreakBefore && needsBreakBefore(node) || needsPreviousBreakAfter(node) || needsPageBreak(node, previousNode);
	}

	public forceBreak() {
		this.forceRenderBreak = true;
	}

	private getStart(source: HTMLElement | DocumentFragment, breakToken?: BreakToken) {
		let start: Text | HTMLElement | undefined;
		const node = breakToken?.node;
		const finished = breakToken?.finished;

		if (node) {
			start = node;
		} else {
			start = source.firstChild as HTMLElement;
		}

		return finished ? undefined : start;
	}

	/**
	 * Merge items from source into dest which don't yet exist in dest.
	 *
	 * @param dest
	 *   A destination DOM node tree.
	 * @param source
	 *   A source DOM node tree.
	 */
	private addOverflowNodes(dest: HTMLElement | DocumentFragment, source: DocumentFragment | Element) {
		// Since we are modifying source as we go, we need to remember what
		Array.from(source.childNodes).forEach((item) => {
			if (isText(item)) {
				// If we get to a text node, we assume for now an earlier element
				// would have prevented duplication.
				dest.append(item);
			} else {
				const match = findElement(item as Element, dest);
				if (match) {
					this.addOverflowNodes(match, item as Element);
				} else {
					dest.appendChild(item);
				}
			}
		});
	}

	/**
	 * Add overflow to new page.
	 *
	 * @param dest
	 *   The page content being built.
	 * @param breakToken
	 *   The current break cotent.
	 * @param alreadyRendered
	 *   The content that has already been rendered.
	 */
	private addOverflowToPage(dest: LayoutHTMLElement, breakToken: BreakToken, alreadyRendered: HTMLElement) {
		if (!breakToken || !breakToken.overflow.length) {
			return;
		}

		let fragment: DocumentFragment | undefined;

		(breakToken.overflow as LayoutOverflow[]).forEach((overflow) => {
			// A handy way to dump the contents of a fragment.
			// console.log([].map.call(overflow.content.children, e => e.outerHTML).join("\n"));

			fragment = rebuildTree(overflow.node as Text | HTMLElement, fragment, alreadyRendered);
			// Find the parent to which overflow.content should be added.
			// Overflow.content can be a much shallower start than
			// overflow.node, if the range end was outside of the range
			// start part of the tree. For this reason, we use a match against
			// the parent element of overflow.content if it exists, or fall back
			// to overflow.node's parent element.
			const addTo = overflow.ancestor ? findElement(overflow.ancestor, fragment) : fragment;
			this.addOverflowNodes(addTo, overflow.content);
		});

		// Record refs.
		Array.from(fragment.querySelectorAll<HTMLElement>("[data-ref]")).forEach(ref => {
			const refId = ref.dataset.ref;
			if (!dest.querySelector(`[data-ref="${refId}"]`)) {
				dest.indexOfRefs ??= {};
				dest.indexOfRefs[refId] = ref;
			}
		});

		const tags = [ "overflow-tagged", "overflow-partial", "range-start-overflow", "range-end-overflow" ];
		tags.forEach((tag) => {
			const camel = tag.replace(/(?:^\w|[A-Z]|\b\w)/g, function (word, index) {
				return index == 0 ? word.toLowerCase() : word.toUpperCase();
			}).replace(/[-\s]+/g, "");
			const instances = fragment.querySelectorAll<HTMLElement>(`[data-${tag}]`);
			instances.forEach((instance) => {
				delete instance.dataset[camel];
			});
		});

		dest.appendChild(fragment);

		this.hooks.afterOverflowAdded.trigger(dest);
	}

	/**
	 * Add text to new page.
	 *
	 * @param node
	 *   The node being appended to the destination.
	 * @param dest
	 *   The destination to which content is being added.
	 * @param source
	 *   The source DOM
	 * @param breakToken
	 *   The current breakToken.
	 * @param shallow
	 *	 Whether to do a shallow copy of the node.
	 * @param rebuild
	 *   Whether to rebuild parents.
	 *
	 * @returns The cloned node.
	 */
	private append(node: Text | HTMLElement, dest: LayoutHTMLElement, source: HTMLElement | DocumentFragment, breakToken: BreakToken, shallow = true, rebuild = true) {

		let clone = cloneNode(node, !shallow);

		if (node.parentNode && isElement(node.parentNode)) {
			let parent = findElement(node.parentNode, dest);
			if (parent) {
				replaceOrAppendElement(parent, clone);
			} else if (rebuild) {
				const fragment = rebuildTree(node.parentElement, undefined, source);
				parent = findElement(node.parentNode, fragment);
				replaceOrAppendElement(parent, clone);
				dest.appendChild(fragment);
			} else {
				dest.appendChild(clone);
			}

		} else {
			dest.appendChild(clone);
		}

		if (isHTMLElement(clone) && clone.dataset.ref) {
			dest.indexOfRefs ??= {};
			dest.indexOfRefs[clone.dataset.ref] = clone;
		}

		const nodeHooks = this.hooks.renderNode.triggerSync(clone, node, this);
		nodeHooks.forEach((newNode) => {
			if (typeof newNode != "undefined") {
				clone = newNode;
			}
		});

		return clone;
	}

	private rebuildTableFromBreakToken(breakToken: BreakToken, dest: HTMLElement, source: HTMLElement) {
		if (!breakToken || !breakToken.node) {
			return;
		}
		const node = breakToken.node;
		let td = isElement(node) ? node.closest("td") : node.parentElement.closest("td");
		if (td) {
			const rendered = findElement(td, dest, true);
			if (!rendered) {
				return;
			}
			while ((td = td.nextElementSibling as typeof td)) {
				this.append(td, dest, source, null, true);
			}
		}
	}

	private async waitForImages(imgs: Iterable<HTMLImageElement>) {
		const results = Array.from(imgs).map(async (img) => {
			return this.awaitImageLoaded(img);
		});
		await Promise.all(results);
	}

	private async awaitImageLoaded(image: HTMLImageElement) {
		return new Promise(resolve => {
			if (!image.complete) {
				image.onload = function () {
					const { width } = window.getComputedStyle(image);
					resolve(width);
				};
				image.onerror = function () {
					const { width } = window.getComputedStyle(image);
					resolve(width);
				};
			} else {
				const { width } = window.getComputedStyle(image);
				resolve(width);
			}
		});
	}

	private avoidBreakInside(node: Text | HTMLElement, limiter: HTMLElement) {
		let breakNode: HTMLElement | undefined;

		while (node.parentNode) {
			if (node === limiter) {
				break;
			}

			if (isElement(node) && node.dataset.originalBreakInside === "avoid") {
				breakNode = node;
				break;
			}

			node = node.parentNode as HTMLElement;
		}
		return breakNode;
	}

	private createOverflow(overflow: Range, rendered: HTMLElement, source: HTMLElement | DocumentFragment) {
		const container = overflow.startContainer;
		let offset = overflow.startOffset;
		let node: Text | HTMLElement | DocumentFragment | undefined;
		let topLevel = false;
		const hyphen = this.settings.hyphenGlyph ?? "\u2011";

		if (isElement(container)) {
			let temp: Text | HTMLElement | null | undefined;
			if (container.nodeName === "INPUT") {
				temp = container as HTMLElement;
			} else {
				temp = child(container, offset) as Text | HTMLElement | null;
			}

			if (isElement(temp)) {
				let renderedNode = findElement(temp, rendered);

				if (!renderedNode) {
					// Find closest element with data-ref
					let prevNode = prevValidNode(temp);
					if (!isElement(prevNode)) {
						prevNode = prevNode.parentElement;
					}
					renderedNode = findElement(prevNode, rendered);
					// Check if temp is the last rendered node at its level.
					if (!temp.nextSibling) {
						// We need to ensure that the previous sibling of temp is fully rendered.
						const renderedNodeFromSource = findElement(renderedNode, source);
						const walker = document.createTreeWalker(renderedNodeFromSource, NodeFilter.SHOW_ELEMENT);
						const lastChildOfRenderedNodeFromSource = walker.lastChild() as Element;
						const lastChildOfRenderedNodeMatchingFromRendered = findElement(lastChildOfRenderedNodeFromSource, rendered);
						// Check if we found that the last child in source
						if (!lastChildOfRenderedNodeMatchingFromRendered) {
							// Pending content to be rendered before virtual break token
							return;
						}
						// Otherwise we will return a break token as per below
					}
					// renderedNode is actually the last unbroken box that does not overflow.
					// Break Token is therefore the next sibling of renderedNode within source node.
					node = findElement(renderedNode, source).nextSibling as Text | HTMLElement | null;
					offset = 0;
				} else {
					node = findElement(renderedNode, source);
					offset = 0;
				}
			} else {
				let renderedNode: HTMLElement | DocumentFragment | undefined;
				let parent: HTMLElement | DocumentFragment | undefined;
				if (container === rendered) {
					parent = renderedNode = source;
					topLevel = true;
				}
				else {
					renderedNode = findElement(container, rendered);

					if (!renderedNode) {
						renderedNode = findElement(prevValidNode(container) as Element | null, rendered);
					}

					parent = findElement(renderedNode, source);
				}
				const index = indexOfTextNode(temp, parent, hyphen);
				// No seperation for the first textNode of an element
				if (index === 0) {
					node = parent;
					offset = 0;
				} else {
					node = child(parent, index) as Text | HTMLElement | null;
					offset = 0;
				}
			}
		} else {
			let renderedNode = findElement(container.parentNode as Element, rendered);

			if (!renderedNode) {
				renderedNode = findElement(prevValidNode(container.parentNode) as Element | null, rendered);
			}

			const parent = findElement(renderedNode, source);
			const index = indexOfTextNode(container, parent, hyphen);

			if (index === -1) {
				return;
			}

			node = child(parent, index) as HTMLElement | Text;

			offset += node.textContent.indexOf(container.textContent);
		}

		if (!node) {
			return;
		}

		return new Overflow(
			node,
			offset,
			overflow.getBoundingClientRect().height,
			overflow,
			topLevel
		);

	}

	private lastChildCheck(parentElement: HTMLElement, rootElement: LayoutHTMLElement) {
		if (parentElement.childElementCount) {
			this.lastChildCheck(parentElement.lastElementChild as HTMLElement, rootElement);
		}

		const refId = parentElement.dataset.ref;

		// A table row, math element or paragraph from which all content has been removed
		// can itself also be removed. It will be added on the next page.
		if (parentElement.dataset.overflowTagged && parentElement.textContent.trim() === "") {
			parentElement.parentNode.removeChild(parentElement);
		}
		else if (refId && !rootElement.indexOfRefs[refId]) {
			rootElement.indexOfRefs[refId] = parentElement;
		}
	}

	private processOverflowResult(ranges: Range[], rendered: LayoutHTMLElement, source: HTMLElement | DocumentFragment, bounds: DOMRect, prevBreakToken: BreakToken, node: HTMLElement, extract: boolean) {
		let breakToken: BreakToken | undefined;
		let breakLetter: string | undefined;

		ranges.forEach((overflowRange) => {

			const overflowHooks = this.hooks.onOverflow.triggerSync(overflowRange, rendered, bounds, this);
			overflowHooks.forEach((newOverflow) => {
				if (typeof newOverflow != "undefined") {
					overflowRange = newOverflow;
				}
			});

			const overflow = this.createOverflow(overflowRange, rendered, source) as LayoutOverflow;
			if (!breakToken) {
				breakToken = new BreakToken(node, [overflow]);
			} else {
				breakToken.overflow.push(overflow);
			}

			// breakToken is nullable
			const breakHooks = this.hooks.onBreakToken.triggerSync(breakToken, overflowRange, rendered, this);
			breakHooks.forEach((newToken) => {
				if (typeof newToken !== "undefined") {
					breakToken = newToken;
				}
			});

			// Stop removal if we are in a loop
			if (breakToken.equals(prevBreakToken)) {
				return;
			}

			if (overflow?.node && overflow?.offset && overflow?.node?.textContent) {
				breakLetter = overflow.node.textContent.charAt(overflow.offset);
			} else {
				breakLetter = undefined;
			}

			if (overflow?.node && extract) {
				overflow.ancestor = findElement(overflow.range.commonAncestorContainer as Element, source);
				overflow.content = this.removeOverflow(overflowRange, breakLetter);
			}
		});

		// For each overflow that is removed, see if we have an empty td that can be removed.
		// Also check that the data-ref is set so we get all the split-froms and tos. If a copy
		// of a node wasn't shallow, the indexOfRefs entry won't be there yet.
		//
		// TODO: it's strange that this loop isn't using the ranges.
		ranges.forEach(() => {
			this.lastChildCheck(rendered, rendered);
		});

		// And then see if the last element has been completely removed and not split.
		if (rendered.indexOfRefs && extract && breakToken.overflow.length) {
			const firstOverflow = breakToken.overflow[0] as LayoutOverflow | undefined;
			if (firstOverflow?.node && firstOverflow.content) {
				// Remove data-refs in the overflow from the index.
				Array.from(firstOverflow.content.querySelectorAll<HTMLElement>("[data-ref]")).forEach(ref => {
					const refId = ref.dataset.ref;
					if (!rendered.querySelector(`[data-ref="${refId}"]`)) {
						delete(rendered.indexOfRefs[refId]);
					}
				});
			}
		}

		(breakToken.overflow as LayoutOverflow[]).forEach((overflow) => {
			this.hooks.afterOverflowRemoved.trigger(overflow.content, rendered, this);
		});


		return breakToken;
	}

	public findBreakToken(rendered: HTMLElement, source: HTMLElement | DocumentFragment, bounds = this.bounds, prevBreakToken: BreakToken, node = null, extract = true) {
		let breakToken: BreakToken | undefined;
		const overflow: Range[] = [];

		let overflowResult = this.findOverflow(rendered, bounds);
		while (overflowResult) {
			// Check whether overflow already added - multiple overflows might result in the
			// same range via avoid break rules.
			let existing = false;
			overflow.forEach((item) => {
				if (
					item.startContainer == overflowResult.startContainer &&
					item.endContainer == overflowResult.endContainer) {
					if (item.startOffset >= overflowResult.startOffset &&
						item.endOffset <= overflowResult.endOffset) {
						item.setStart(overflowResult.startContainer, overflowResult.startOffset);
						existing = true;
					}
					if (item.endOffset > overflowResult.endOffset &&
						item.startOffset == overflowResult.startOffset) {
						item.setEnd(overflowResult.endContainer, overflowResult.endOffset);
						existing = true;
					}
				}
			});
			if (!existing) {
				overflow.push(overflowResult);
			}
			overflowResult = this.findOverflow(rendered, bounds);
		}

		if (overflow.length) {
			breakToken = this.processOverflowResult(overflow, rendered, source, bounds, prevBreakToken, node, extract);
		}
		return breakToken;
	}

	/**
	 * Does the element exceed the bounds?
	 *
	 * @param element
	 *   The element being constrained.
	 * @param bounds
	 *   The bounding element.
	 *
	 * @returns Whether the element is within bounds.
	 */
	private hasOverflow(element: HTMLElement, bounds = this.bounds) {
		let constrainingElement = element.parentNode as HTMLElement; // this gets the element, instead of the wrapper for the width workaround
		if (constrainingElement.classList.contains("pagedjs_page_content")) {
			constrainingElement = element;
		}
		const { width, height } = element.getBoundingClientRect();
		const scrollWidth = constrainingElement ? constrainingElement.scrollWidth : 0;
		const scrollHeight = constrainingElement ? constrainingElement.scrollHeight : 0;
		return (Math.max(Math.ceil(width), scrollWidth) > Math.ceil(bounds.width)) ||
			Math.max(Math.ceil(height), scrollHeight) > Math.ceil(bounds.height);
	}

	/**
	 * Sums padding, borders and margins for bottom/right of parent elements.
	 *
	 * Assumes no margin collapsing because we're considering overflow
	 * on a page.
	 *
	 * This and callers need to be extended to handle right-to-left text and
	 * flow but I'll get LTR going first in the hope that it will simplify
	 * the task of getting RTL sorted later. Need test cases too.
	 */
	private getAncestorPaddingBorderAndMarginSums(element: HTMLElement) {
		const attribs = [
			"padding-top",
			"padding-right",
			"padding-bottom",
			"padding-left",
			"border-top-width",
			"border-right-width",
			"border-bottom-width",
			"border-left-width",
			"margin-top",
			"margin-right",
			"margin-bottom",
			"margin-left",
		];
		const result = {};
		attribs.forEach(attrib => result[attrib] = 0);

		while (element &&
			!element.classList.contains("pagedjs_page_content") &&
			!element.classList.contains("pagedjs_footnote_inner_content")) {
			const style = window.getComputedStyle(element);
			attribs.forEach(attrib => result[attrib] += parseInt(style[attrib]));
			element = element.parentElement;
		}

		return result;
	}

	/**
	 * Checks whether an element is within a table and gets any THEAD sizes.
	 */
	private getAncestorTheadSizes(element: HTMLElement) {
		let result = 0;

		while (element &&
			!element.classList.contains("pagedjs_page_content") &&
			!element.classList.contains("pagedjs_footnote_inner_content")) {
			if (element.tagName === "TABLE") {
				element.childNodes.forEach(node => {
					if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === "THEAD") {
						const style = getComputedStyle(node as HTMLElement);
						result += parseInt(style.height);
					}
				});
			}
			element = element.parentElement;
		}

		return result;
	}

	/**
	 * Adds temporary data-split-to/from attribute where needed.
	 *
	 * @param element
	 *   The deepest child, from which to start.
	 */
	private addTemporarySplit(element: HTMLElement, isTo = true) {
		this.temporaryIndex++;
		const name = isTo ? "data-split-to" : "data-split-from";
		while (element &&
			!element.classList.contains("pagedjs_page_content") &&
			!element.classList.contains("pagedjs_footnote_inner_content")) {

			if (!element.getAttribute(name)) {
				element.setAttribute(name, "temp-" + this.temporaryIndex);
			}

			element = element.parentElement;
		}
	}

	/**
	 * Removes temporary data-split-to/from attribute where added.
	 *
	 * @param element
	 *   The deepest child, from which to start.
	 * @param isTo
	 *   Whether a split-to or -from was added.
	 */
	private deleteTemporarySplit(element: HTMLElement, isTo = true) {
		const name = isTo ? "data-split-to" : "data-split-from";
		while (element &&
			!element.classList.contains("pagedjs_page_content") &&
			!element.classList.contains("pagedjs_footnote_inner_content")) {

			const value = element.getAttribute(name);
			if (value === "temp-" + this.temporaryIndex) {
				element.removeAttribute(name);
			}

			element = element.parentElement;
		}
	}

	/**
	 * Returns the first child that overflows the bounds.
	 *
	 * There may be no children that overflow (the height might be extended
	 * by a sibling). In this case, this function returns NULL.
	 *
	 * @param node
	 *   The parent node of the children we are searching.
	 * @param bounds
	 *   The bounds of the page area.
	 * @returns
	 *   The first overflowing child within the node.
	 */
	private firstOverflowingChild(node: Node, bounds: DOMRect): ChildNode | null | undefined {
		const bLeft = Math.ceil(bounds.left);
		const bRight = Math.floor(bounds.right);
		const bTop = Math.ceil(bounds.top);
		const bBottom = Math.floor(bounds.bottom);
		let result = undefined;
		let skipRange = false;
		let parentBottomPaddingBorder = 0, parentBottomMargin = 0;

		if (isElement(node)) {
			const result = this.getAncestorPaddingBorderAndMarginSums(node as HTMLElement);
			parentBottomPaddingBorder = result["border-bottom-width"];
			parentBottomMargin = result["margin-bottom"];
		}

		for (const child of node.childNodes as NodeListOf<HTMLElement>) {
			if (child.tagName === "COLGROUP") {
				continue;
			}

			const pos = getBoundingClientRect(child);
			let bottomMargin = 0;

			if (isElement(child)) {
				const styles = window.getComputedStyle(child);

				bottomMargin = parseInt(styles["margin-bottom"]);

				if (child.dataset.rangeStartOverflow !== undefined) {
					skipRange = true;
					result = null;
					// Don't continue. The start may also be the end.
				}

				if (child.dataset.rangeEndOverflow !== undefined) {
					skipRange = false;
					result = undefined;
					continue;
				}

				if (child.dataset.overflowTagged !== undefined) {
					continue;
				}

			}
			else {
				bottomMargin = parentBottomMargin;
			}

			if (skipRange) {
				continue;
			}

			const left = Math.ceil(pos.left);
			const right = Math.floor(pos.right);
			const top = Math.ceil(pos.top);
			const bottom = Math.floor(pos.bottom + bottomMargin +
				(node.lastChild == child ? parentBottomPaddingBorder : 0));

			if (!(pos.height + bottomMargin)) {
				continue;
			}

			if (left < bLeft || right > bRight || top < bTop || bottom > bBottom) {
				return child;
			}
		}

		return result;
	}

	private removeHeightConstraint(element: Text | HTMLElement) {
		const pageBox = element.parentElement.closest(".pagedjs_page") as HTMLElement;
		pageBox.style.setProperty("--pagedjs-pagebox-height", "5000px");
		this.addTemporarySplit(element.parentElement, false);
	}

	private restoreHeightConstraint(element: Text | HTMLElement) {
		const pageBox = element.parentElement.closest(".pagedjs_page") as HTMLElement;
		this.deleteTemporarySplit(element.parentElement, false);
		pageBox.style.removeProperty("--pagedjs-pagebox-height");
	}

	private getUnconstrainedElementHeight(element: Text | HTMLElement, includeAncestors = true, includeTableHead = true) {
		this.removeHeightConstraint(element);
		let unconstrainedHeight = getBoundingClientRect(element).height;
		if (includeAncestors) {
			const extra = this.getAncestorPaddingBorderAndMarginSums(element.parentElement);
			["top", "bottom"].forEach(direction => {
				unconstrainedHeight += extra[`padding-${direction}`] +
					extra[`border-${direction}-width`] +
					extra[`margin-${direction}`];
			});
		}
		if (includeTableHead) {
			unconstrainedHeight += this.getAncestorTheadSizes(element.parentElement);
		}
		this.restoreHeightConstraint(element);
		return unconstrainedHeight;
	}

	private getRange(rangeStart: Node, offset: number, rangeEnd?: Node) {
		const range = document.createRange();
		if (isText(rangeStart)) {
			range.setStart(rangeStart, offset);
		} else {
			range.selectNode(rangeStart);
		}

		// Additional nodes may have been added that will overflow further beyond
		// node. Include them in the range.
		range.setEndAfter(rangeEnd ?? rangeStart);
		return range;
	}

	private startOfNewOverflow(node: Text | HTMLElement, rendered: HTMLElement, bounds: DOMRect): [Text | HTMLElement | null, boolean] {
		let childNode: ChildNode | undefined;
		let done = false;
		let prev: Text | HTMLElement | null = null;
		let anyOverflowFound = false;
		const topNode = node;

		do {
			prev = node;
			do {
				let parentBottomPaddingBorder: number | undefined;
				let parentBottomMargin: number | undefined;
				childNode = this.firstOverflowingChild(node, bounds);
				if (childNode) {
					anyOverflowFound = true;
				} else if (childNode === undefined) {
					// The overflow isn't caused by children. It could be caused by:
					// * a sibling div / td / element with height that stretches this
					//   element
					// * margin / padding on this element
					// In the former case, we want to ignore this node and take the
					// sibling. In the later case, we want to move this node.
					let intrinsicBottom = 0, intrinsicRight = 0;
					let childBounds = getBoundingClientRect(node);
					if (isElement(node)) {
						// Assume that any height is the result of matching the
						// height of surrounding content if there's no content.
						const result = this.getAncestorPaddingBorderAndMarginSums(node);
						parentBottomPaddingBorder = result["border-bottom-width"] + result["padding-bottom"];
						parentBottomMargin = result["margin-bottom"];

						if (node.childNodes.length) {
							const lastChild = node.lastChild;
							if (
								(isText(lastChild) && !node.dataset.overflowTagged) ||
								(!isText(lastChild) && !(lastChild as HTMLElement).dataset.overflowTagged)
							) {
								childBounds = getBoundingClientRect(lastChild);
								intrinsicRight = childBounds.right;
								intrinsicBottom = childBounds.bottom;
							}
						}
						else {
							// Do we count this node even though it has no children?
							// Seems to only be needed for BR.
							if (node instanceof HTMLBRElement) {
								intrinsicRight = childBounds.right;
								intrinsicBottom = childBounds.bottom;
							}
						}

					} else {
						intrinsicRight = childBounds.right;
						intrinsicBottom = childBounds.bottom;

						const result = this.getAncestorPaddingBorderAndMarginSums(node.parentElement);
						parentBottomPaddingBorder = result["border-bottom-width"];
						parentBottomMargin = result["margin-bottom"];
					}
					intrinsicBottom += parentBottomPaddingBorder + parentBottomMargin;
					if (intrinsicBottom <= bounds.bottom &&
						intrinsicRight <= bounds.right) {
						let ascended: boolean | undefined;
						do {
							ascended = false;
							do {
								node = node.nextElementSibling as HTMLElement | null;
							} while (node && node.dataset.overflowTagged);
							if (!node && rendered !== prev) {
								ascended = true;
								prev = node = prev.parentElement;
							}
						} while (ascended && node && node !== topNode);
						if (!node || node == topNode) {
							return [null, false];
						}
					} else {
						// Node is causing the overflow via padding and margin or text content.
						done = true;
					}
				} else {
					// childNode is null. Overflowing children have been ignored and no other
					// overflowing children were found. Check the node's next sibling or one of
					// an ancestor.
					do {
						while (!node.nextElementSibling) {
							if (node == rendered) {
								return [null, false];
							}
							node = node.parentElement;
						}
						do {
							node = node.nextElementSibling as HTMLElement;
						} while (node.nextElementSibling && node.dataset.overflowTagged);
					} while (node.dataset.overflowTagged);
				}
			} while (node && !childNode && !done);

			if (node) {
				node = childNode as HTMLElement;
			}
		} while (node && !done);

		return [prev, anyOverflowFound];
	}

	private tagAndCreateOverflowRange(startOfOverflow: Text | HTMLElement, rangeStart: Text | HTMLElement, rangeEnd: Text | HTMLElement, bounds: DOMRect, rendered: HTMLElement) {
		let offset = 0;
		const start = bounds.left;
		const end = bounds.right;
		const vStart = bounds.top;
		const vEnd = bounds.bottom;

		if (isText(rangeStart) && rangeStart.textContent.trim().length) {
			offset = this.textBreak(rangeStart, start, end, vStart, vEnd);
			if (offset === undefined) {
				// Adding split-to changed the CSS and meant we don't need to
				// split this node.
				let next = rangeStart as Text | HTMLElement;
				while (!next.nextElementSibling) {
					next = next.parentElement;
					if (next === rendered) {
						return;
					}
				}
				startOfOverflow = rangeStart = next.nextElementSibling as HTMLElement;
			}
		}

		let previousElement = nodeBefore(rangeStart, rendered, true) as HTMLElement | null;
		let shouldContinue = true;
		let newRangeStart = rangeStart;
		while (!offset && previousElement && shouldContinue && (
			(isText(newRangeStart) && (
				newRangeStart.parentElement.dataset.previousBreakAfter == "avoid" ||
				newRangeStart.parentElement.dataset.breakBefore == "avoid"
			)) ||
			(!isText(newRangeStart) && (
				newRangeStart.dataset.previousBreakAfter == "avoid" ||
				newRangeStart.dataset.breakBefore == "avoid"
			)))) {
			// We are trying to avoid putting a break at newRangeStart.
			// See if we can move some of the content above into the overflow.
			const newPreviousElement = nodeBefore(previousElement, rendered, true);
			// Don't go back into stuff already rendered.
			if (!isHTMLElement(newPreviousElement) || newPreviousElement.dataset.splitFrom) {
				shouldContinue = false;
			}
			else {
				newRangeStart = previousElement;
				previousElement = newPreviousElement;
			}
		}

		if (shouldContinue) {
			// We found earlier content that doesn't want to avoid having a break after it.
			// newRangeStart is the next node (new overflow start).
			rangeStart = newRangeStart;
		}

		// Set the start of the range and record on node or the previous element
		// that overflow was moved.
		let position = rangeStart;
		const range = this.getRange(rangeStart, offset, rangeEnd);
		if (isText(rangeStart)) {
			rangeStart.parentElement.dataset.splitTo = rangeStart.parentElement.dataset.ref;
			rangeStart.parentElement.dataset.rangeStartOverflow = "true";
			rangeStart.parentElement.dataset.overflowTagged = "true";
			position = rangeStart.parentElement;
		} else {
			rangeStart.dataset.rangeStartOverflow = "true";
		}

		rangeEnd ??= rangeStart;
		if (isElement(rangeEnd)) {
			if (rangeStart.parentElement.closest(`[data-ref="${rangeEnd.dataset.ref}"]`)) {
				const nextNode = nodeAfter(rangeEnd);
				if (isHTMLElement(nextNode)) {
					nextNode.dataset.rangeEndOverflow = "true";
					nextNode.dataset.overflowTagged = "true";
				}
			}
			else {
				rangeEnd.dataset.rangeEndOverflow = "true";
				rangeEnd.dataset.overflowTagged = "true";
			}
		}
		else {
			rangeEnd.parentElement.dataset.rangeEndOverflow = "true";
		}

		// Add splitTo
		while (position !== rendered) {
			if (position.previousSibling) {
				position.parentElement.dataset.splitTo = position.parentElement.dataset.ref;
			}
			position = position.parentElement;
		}

		// Tag ancestors in the range so we don't generate additional ranges
		// that then cause problems when removing the ranges.
		position = rangeStart;
		while (position.parentElement !== range.commonAncestorContainer) {
			position = position.parentElement;
			position.dataset.overflowTagged = "true";
		}

		if (isElement(position)) {
			let stopAt = rangeEnd;
			while (stopAt.parentElement !== range.commonAncestorContainer) {
				stopAt = stopAt.parentElement;
			}

			while (position !== stopAt) {
				position = position.nextSibling as HTMLElement;
				if (isElement(position)) {
					position.dataset.overflowTagged = "true";
				}
			}
		}
		else {
			position = position.parentElement;
		}
		while (!position.nextElementSibling && position !== rendered) {
			position = position.parentElement;
			position.dataset.overflowTagged = "true";
		}

		return range;
	}

	private rowspanNeedsBreakAt(tableRowNode: Node, rendered: HTMLElement) {
		if (tableRowNode.nodeName !== "TR") {
			return;
		}

		const tableRow = tableRowNode as HTMLTableRowElement;
		const table = parentOf(tableRow, "TABLE", rendered) as HTMLTableElement;
		if (!table) {
			return;
		}

		const rowspan = table.querySelector("[colspan]");
		if (!rowspan) {
			return;
		}

		let columnCount = 0;
		for (const cell of Array.from(table.rows[0].cells)) {
			columnCount += parseInt(cell.getAttribute("colspan") || "1");
		}
		if (tableRow.cells.length !== columnCount) {
			let previousRow = tableRow;
			let previousRowColumnCount: number | undefined;
			while (previousRow !== null) {
				previousRowColumnCount = 0;
				for (const cell of Array.from(previousRow.cells)) {
					previousRowColumnCount += parseInt(cell.getAttribute("colspan") || "1");
				}
				if (previousRowColumnCount === columnCount) {
					break;
				}
				previousRow = previousRow.previousElementSibling as HTMLTableRowElement;
			}
			if (previousRowColumnCount === columnCount) {
				return previousRow;
			}
		}
	}

	public findOverflow(rendered: HTMLElement, bounds: DOMRect) {

		if (!this.hasOverflow(rendered, bounds) || rendered.dataset.overflowTagged) {
			return;
		}

		// The pattern here is:
		// Round the bounds towards the smaller rectangle (round up top & left and
		// round down bottom and right) and round the content towards the larger
		// rectangle (round down top and left and round up bottom and right). Then
		// use > and < to check if bounds are exceeded. That way portions of pixels
		// will be correctly handled - you can't render a fraction of a pixel so
		// bounds should have any fraction treated like that pixel isn't available
		// and content should have any fraction of a pixel treated like the whole
		// pixel is required.
		const end = bounds.right;
		const vEnd = bounds.bottom;

		// Find the deepest element that is the first in set of siblings with
		// overflow. There may be others. We just take the first we find and
		// are called again to check for additional instances.
		let node: Text | HTMLElement | null = rendered;

		while (isText(node)) {
			node = node.nextElementSibling as HTMLElement;
		}

		const [startOfOverflow, anyOverflowFound] = this.startOfNewOverflow(node, rendered, bounds);

		if (!anyOverflowFound) {
			return;
		}

		const startOfOverflowIsText = isText(startOfOverflow);
		if (startOfOverflowIsText && startOfOverflow.parentElement.dataset.overflowTagged ||
			(!startOfOverflowIsText && startOfOverflow.dataset.overflowTagged)) {
			return;
		}

		// The node we finished on may be within something asking not to have its
		// contents split. It - or a parent - may also have to be split because
		// the content is just too big for the page.
		// Resolve those requirements, deciding on a node that will be split in
		// the following way:
		// 1) Prefer the smallest node we can (start with the one we ended on).
		//    While going back up the ancestors, check that subsequent children
		//    of the ancestor are all entirely in overflow too. If they are, we
		//    can take a range starting at our initial node and going to the end
		//    of the ancestor's children.

		node = startOfOverflow;

		let check = startOfOverflow;
		let rangeStart = check = startOfOverflow;
		let visibleSiblings = false;
		let rangeEnd = rendered.lastElementChild as HTMLElement;

		do {
			const checkBounds = getBoundingClientRect(check);
			const hasOverflow = (checkBounds.bottom > vEnd || checkBounds.right > end);

			let rowspanNeedsBreakAt: HTMLTableRowElement | undefined;

			if (hasOverflow && this.avoidBreakInside(check, rendered)) {
				rowspanNeedsBreakAt = this.rowspanNeedsBreakAt(check, rendered);
				if (rowspanNeedsBreakAt) {
					// No question - break earlier.
					rangeStart = rowspanNeedsBreakAt;
					rangeEnd = rendered.lastChild as HTMLElement;
					break;
				}
				else {
					// If there is an element with overflow and it is within a
					// break-inside: avoid, we take the whole container, provided that it
					// will fit on a page by itself. But calculating whether it will fit
					// by itself is non-trivial. If it is within a dom structure, the
					// space available will be reduced by the containers. We can use the
					// current container (that will get duplicated) but there might be
					// subtle differences in styling due to the split-from class being
					// added. We therefore temporary add the split-from to the current
					// structure and find out how much space we need for the whole thing.
					//
					// To calculate whether we must split the element, we need to know its
					// unconstrained height. If it has been wrapped into another column
					// by .pagedjs_pagebox's display:grid, we need to temporarily lengthen
					// the current column to get the maximum width it would take. Go from
					// check's parent to simplify handling where check is a text node.
					let unconstrainedHeight: number | undefined;
					if (checkBounds.width > bounds.width) {
						unconstrainedHeight = this.getUnconstrainedElementHeight(check);
					}
					else {
						unconstrainedHeight = checkBounds.height;
					}

					const mustSplit = (unconstrainedHeight > bounds.height);

					if (!mustSplit) {
						// Move the whole thing.
						rangeStart = check;
					}
				}
			}

			let sibling = check;
			let siblingBounds: DOMRect | undefined;
			do {
				sibling = sibling.nextSibling as HTMLElement | null;
				siblingBounds = sibling ? getBoundingClientRect(sibling) : undefined;
			} while (sibling && !siblingBounds?.height);

			if (sibling && siblingBounds?.height && !rowspanNeedsBreakAt) {

				// Is the sibling entirely in overflow? If yes, so must all following
				// siblings be - add them to this range; they can't have anything we
				// want to keep on this page.
				if ((siblingBounds.left > end || siblingBounds.top > vEnd) && !visibleSiblings) {
					if (!rowspanNeedsBreakAt) {
						rangeEnd = check.parentElement.lastChild as HTMLElement;
					}
				} else {
					visibleSiblings = true;
					rangeEnd = undefined;
				}
			}

			// Get the columns widths and make them attributes so removal of
			// overflow doesn't do strange things - they may be affecting
			// widths on this page.
			//
			// TODO: why can we assume the child node has a width property?
			Array.from(check.parentElement.children as Iterable<HTMLElement & { width?: string }>).forEach((childNode) => {
				const style = getComputedStyle(childNode);
				childNode.width = style.width;
			});

			if (isElement(check) && Array.from(check.classList).filter(value => ["region-content", "pagedjs_page_content"].includes(value)).length) {
				break;
			}
			check = check.parentElement;
		} while (check && check !== rendered);

		return this.tagAndCreateOverflowRange(startOfOverflow, rangeStart, rangeEnd, bounds, rendered);
	}

	public findEndToken(rendered: HTMLElement, source: HTMLElement | DocumentFragment) {
		if (rendered.childNodes.length === 0) {
			return;
		}

		let lastChild = rendered.lastChild as Node | null;

		while (lastChild && lastChild.lastChild) {
			if (!validNode(lastChild)) {
				// Only get elements with refs
				lastChild = lastChild.previousSibling;
			} else if (!validNode(lastChild.lastChild)) {
				// Deal with invalid dom items
				lastChild = prevValidNode(lastChild.lastChild);
				break;
			} else {
				lastChild = lastChild.lastChild;
			}
		}

		let lastNodeIndex: number | undefined;
		if (isText(lastChild)) {

			if ((lastChild.parentNode as HTMLElement).dataset.ref) {
				lastNodeIndex = indexOf(lastChild);
				lastChild = lastChild.parentNode;
			} else {
				lastChild = lastChild.previousSibling;
			}
		}

		let original = findElement(lastChild as HTMLElement, source) as Node | null;

		if (lastNodeIndex) {
			original = original.childNodes[lastNodeIndex];
		}

		const after = nodeAfter(original);

		return this.breakAt(after as HTMLElement);
	}

	private textBreak(node: Node, _start: number, end: number, _vStart: number, vEnd: number) {
		const wordwalker = words(node);
		let offset: number | undefined;

		// Margin bottom is needed when the node is in a block level element
		// such as a table, grid or flex, where margins don't collapse.
		// Temporarily add data-split-to as this may change margins too
		// (It always does in current code but let's not assume that).
		// With the split-to set, margin might be removed, resulting in us
		// not actually needing to split this text. In that case, the return
		// result will be undefined and the split should be done at the next
		// node. In this case we also keep the data-split-to=foo so the
		// styling that removes the need for the overflow remains active.
		// "Margin" includes bottom padding and border in this calculation.

		this.addTemporarySplit(node.parentElement);

		const parentAdditionsData = this.getAncestorPaddingBorderAndMarginSums(node.parentElement);
		const parentAdditions = parentAdditionsData["padding-bottom"] +
			parentAdditionsData["border-bottom-width"] + parentAdditionsData["margin-bottom"];

		let done = false;
		while (!done) {
			const next = wordwalker.next();
			const word = next.value;
			done = next.done;

			if (!word) {
				break;
			}

			let pos = getBoundingClientRect(word);

			const left = Math.floor(pos.left);
			const top = pos.top;
			let right = Math.floor(pos.right);
			let bottom = pos.bottom;

			if (left > end || top > (vEnd - parentAdditions)) {
				offset = word.startOffset;
				break;
			}

			// The bounds won't be exceeded so we need >= rather than >.
			// Also below for the letters.
			if (right > end || bottom > (vEnd - parentAdditions)) {
				const letterwalker = letters(word);
				let doneLetter = false;

				while (!doneLetter) {
					// Note that the letter walker continues to walk beyond the end of the word, until the end of the
					// text node.
					const nextLetter = letterwalker.next();
					const letter = nextLetter.value;
					doneLetter = nextLetter.done;

					if (!letter) {
						break;
					}

					pos = getBoundingClientRect(letter);
					right = pos.right;
					bottom = pos.bottom;

					if (right > end || bottom > (vEnd - parentAdditions)) {
						offset = letter.startOffset;
						done = true;

						break;
					}
				}
			}
		}

		// See comment above the addTemporarySplit call above for the offset ==
		// undefined part of why we may leave the temporary split-to attribute in
		// place. This should be overridden though if a break is to be avoided.
		// In that case,
		if (offset != undefined) {
			this.deleteTemporarySplit(node.parentElement);
		}

		// Don't get tricked into doing a split by whitespace at the start of a string.
		if (node.textContent.substring(0, offset).trim() === "") {
			return 0;
		}

		return offset;
	}

	private removeOverflow(overflow: Range, breakLetter: string) {
		const { startContainer } = overflow;
		const extracted = overflow.extractContents();

		this.hyphenateAtBreak(startContainer, breakLetter);

		return extracted;
	}

	private hyphenateAtBreak(startContainer: Node, breakLetter: string) {
		if (isText(startContainer)) {
			const startText = startContainer.textContent;
			const prevLetter = startText[startText.length - 1];

			// Add a hyphen if previous character is a letter or soft hyphen
			if (
				(breakLetter && /^\w|\u00AD$/.test(prevLetter) && /^\w|\u00AD$/.test(breakLetter)) ||
				(!breakLetter && prevLetter && /^\w|\u00AD$/.test(prevLetter))
			) {
				(startContainer.parentNode as HTMLElement).classList.add("pagedjs_hyphen");
				startContainer.textContent += this.settings.hyphenGlyph || "\u2011";
			}
		}
	}
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unsafe-declaration-merging
declare interface Layout extends Emitter {}

EventEmitter(Layout.prototype);

export default Layout;

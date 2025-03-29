import csstree from "css-tree";

import Handler from "../handler";
import type { HooksInterface } from "../handler";
import type BreakToken from "../../chunker/breaktoken";
import type Chunker from "../../chunker/chunker";
import type Page from "../../chunker/page";
import Layout from "../../chunker/layout";
import type Polisher from "../../polisher/polisher";
import type { RuleContext } from "../../polisher/sheet";
import { isContainer, isElement, isHTMLElement, isText, walk } from "../../utils/dom";

interface Footnote {
	selector: string;
	policy: string;
	display: string;
}

class Footnotes extends Handler implements HooksInterface<Chunker["hooks"] & Polisher["hooks"]> {
	private readonly footnotes: Record<string, Footnote> = {};
	private readonly needsLayout: (HTMLElement | DocumentFragment)[] = [];
	private overflow: HTMLElement[] = [];

	onDeclaration(declaration: csstree.Declaration, dItem: csstree.ListItem<csstree.CssNode>, dList: csstree.List<csstree.CssNode>, rule: RuleContext) {
		const property = declaration.property;
		if (property === "float") {
			const identifier: csstree.Identifier | undefined = "children" in declaration.value
				? declaration.value.children.first() as csstree.Identifier
				: undefined;
			const location = identifier?.name;
			if (location === "footnote") {
				const selector = csstree.generate(rule.ruleNode.prelude);
				this.footnotes[selector] = {
					selector,
					policy: "auto",
					display: "block"
				};
				dList.remove(dItem);
			}
		}
		if (property === "footnote-policy") {
			const identifier: csstree.Identifier | undefined = "children" in declaration.value
				? declaration.value.children.first() as csstree.Identifier
				: undefined;
			const policy = identifier?.name;
			if (policy) {
				const selector = csstree.generate(rule.ruleNode.prelude);
				const note = this.footnotes[selector];
				if (note) {
					note.policy = policy;
				}
			}
		}
		if (property === "footnote-display") {
			const identifier: csstree.Identifier | undefined = "children" in declaration.value
				? declaration.value.children.first() as csstree.Identifier
				: undefined;
			const display = identifier?.name;
			const selector = csstree.generate(rule.ruleNode.prelude);
			if (display && this.footnotes[selector]) {
				const note = this.footnotes[selector];
				if (note) {
					note.display = display;
				}
			}
		}
	}

	onPseudoSelector(pseudoNode: csstree.PseudoElementSelector, _pItem: csstree.ListItem<csstree.CssNode>, _pList: csstree.List<csstree.CssNode>, _selector: {} & object, rule: RuleContext) {
		const name = pseudoNode.name;
		if (name === "footnote-marker") {
			// switch ::footnote-marker to [data-footnote-marker]::before
			const prelude = rule.ruleNode.prelude as csstree.AtrulePrelude;
			const newPrelude = new csstree.List<csstree.CssNode>();

			// Can't get remove to work, so just copying everything else
			(prelude.children.first() as csstree.SelectorList).children.each((node) => {
				if (node.type !== "PseudoElementSelector") {
					newPrelude.appendData(node);
				}
			});

			// Add our data call
			newPrelude.appendData({
				type: "AttributeSelector",
				name: {
					type: "Identifier",
					name: "data-footnote-marker",
				},
				flags: null,
				loc: null,
				matcher: null,
				value: null
			} satisfies csstree.AttributeSelector);

			// Add new pseudo element
			newPrelude.appendData({
				type: "PseudoElementSelector",
				name: "marker",
				loc: null,
				children: null
			} satisfies csstree.PseudoElementSelector);

			(prelude.children.first() as csstree.SelectorList).children = newPrelude;
		}

		if (name === "footnote-call") {
			// switch ::footnote-call to [data-footnote-call]::after

			const prelude = rule.ruleNode.prelude as csstree.AtrulePrelude;
			const newPrelude = new csstree.List<csstree.CssNode>();

			// Can't get remove to work, so just copying everything else
			(prelude.children.first() as csstree.SelectorList).children.each((node) => {
				if (node.type !== "PseudoElementSelector") {
					newPrelude.appendData(node);
				}
			});

			// Add our data call
			newPrelude.appendData({
				type: "AttributeSelector",
				name: {
					type: "Identifier",
					name: "data-footnote-call",
				},
				flags: null,
				loc: null,
				matcher: null,
				value: null
			} satisfies csstree.AttributeSelector);

			// Add new pseudo element
			newPrelude.appendData({
				type: "PseudoElementSelector",
				name: "after",
				loc: null,
				children: null
			} satisfies csstree.PseudoElementSelector);

			(prelude.children.first() as csstree.SelectorList).children = newPrelude;
		}
	}

	afterParsed(parsed: HTMLElement) {
		this.processFootnotes(parsed, this.footnotes);
	}

	private processFootnotes(parsed: HTMLElement, notes: Record<string, Footnote>) {
		for (const n in notes) {
			// Find elements
			const elements = parsed.querySelectorAll<HTMLElement>(n);
			const note = notes[n];
			for (const element of elements) {
				// Add note type
				element.setAttribute("data-note", "footnote");
				element.setAttribute("data-break-before", "avoid");
				element.setAttribute("data-note-policy", note.policy || "auto");
				element.setAttribute("data-note-display", note.display || "block");
				// Mark all parents
				this.processFootnoteContainer(element);
			}
		}
	}

	private processFootnoteContainer(node: HTMLElement) {
		// Find the container
		let element = node.parentElement;
		let prevElement = element;
		// Walk up the dom until we find a container element
		while (element) {
			if (isContainer(element)) {
				// Add flag to the previous non-container element that will render with children
				prevElement.setAttribute("data-has-notes", "true");
				break;
			}

			prevElement = element;
			element = element.parentElement;

			// If no containers were found and there are no further parents flag the last element
			if (!element) {
				prevElement.setAttribute("data-has-notes", "true");
			}
		}
	}

	renderNode(node: Text | HTMLElement) {
		if (isElement(node)) {
			// Get all notes

			// Ingnore html element nodes, like mathml
			if (!node.dataset) {
				return;
			}

			let notes: HTMLElement[] | NodeListOf<HTMLElement> | undefined;

			if (node.dataset.note === "footnote") {
				notes = [node];
			} else if (node.dataset.hasNotes || node.querySelectorAll("[data-note='footnote']")) {
				notes = node.querySelectorAll<HTMLElement>("[data-note='footnote']");
			}

			if (notes && notes.length) {
				this.findVisibleFootnotes(notes, node);
			}
		}
	}

	private findVisibleFootnotes(notes: HTMLElement[] | NodeListOf<HTMLElement>, node: HTMLElement) {
		const area = node.closest(".pagedjs_page_content");
		const size = area.getBoundingClientRect();
		const right = size.left + size.width;

		for (const currentNote of notes) {
			const bounds = currentNote.getBoundingClientRect();
			const left = bounds.left;

			if (left < right) {
				// Add call for the note
				this.moveFootnote(currentNote, node.closest(".pagedjs_area"), true);
			}
		}
	}

	private recalcFootnotesHeight(node: HTMLElement, noteContent: HTMLElement, pageArea: HTMLElement, noteCall: HTMLElement, needsNoteCall: boolean) {
		// Remove empty class
		if (noteContent.classList.contains("pagedjs_footnote_empty")) {
			noteContent.classList.remove("pagedjs_footnote_empty");
		}

		// Get note content size
		const height = noteContent.scrollHeight;

		// Check the noteCall is still on screen
		const area = pageArea.querySelector(".pagedjs_page_content");
		const size = area.getBoundingClientRect();
		const right = size.left + size.width;

		// TODO: add a max height in CSS

		// Check element sizes
		const noteCallBounds = noteCall && noteCall.getBoundingClientRect();
		const noteArea = pageArea.querySelector(".pagedjs_footnote_area");
		const noteAreaBounds = noteArea.getBoundingClientRect();

		// Get the @footnote margins
		const noteContentMargins = this.marginsHeight(noteContent);
		const noteContentPadding = this.paddingHeight(noteContent);
		const noteContentBorders = this.borderHeight(noteContent);
		const total = noteContentMargins + noteContentPadding + noteContentBorders;

		// Get the top of the @footnote area
		let notAreaTop = Math.floor(noteAreaBounds.top);
		// If the height isn't set yet, remove the margins from the top
		if (noteAreaBounds.height === 0) {
			notAreaTop -= this.marginsHeight(noteContent, false);
			notAreaTop -= this.paddingHeight(noteContent, false);
			notAreaTop -= this.borderHeight(noteContent, false);
		}
		// Determine the note call position and offset per policy
		const notePolicy = node.dataset.notePolicy;
		let noteCallPosition = 0;
		let noteCallOffset = 0;
		if (noteCall) {
			// Get the correct line bottom for super or sub styled callouts
			const prevSibling = noteCall.previousSibling;
			const range = new Range();
			if (prevSibling) {
				range.setStartBefore(prevSibling);
			} else {
				range.setStartBefore(noteCall);
			}
			range.setEndAfter(noteCall);
			const rangeBounds = range.getBoundingClientRect();
			noteCallPosition = rangeBounds.bottom;
			if (!notePolicy || notePolicy === "auto") {
				noteCallOffset = Math.ceil(rangeBounds.bottom);
			} else if (notePolicy === "line") {
				noteCallOffset = Math.ceil(rangeBounds.top);
			} else if (notePolicy === "block") {
				// Check that there is a previous element on the page
				const parentParagraph = noteCall.closest("p").previousElementSibling;
				if (parentParagraph) {
					noteCallOffset = Math.ceil(
						parentParagraph.getBoundingClientRect().bottom
					);
				} else {
					noteCallOffset = Math.ceil(rangeBounds.bottom);
				}
			}
		}

		const contentDelta = height + total - noteAreaBounds.height;
		// Space between the top of the footnotes area and the bottom of the footnote call
		const noteDelta = noteCallPosition ? notAreaTop - noteCallPosition : 0;
		// Space needed for the force a break for the policy of the footnote
		const notePolicyDelta = noteCallPosition ? Math.floor(noteAreaBounds.top) - noteCallOffset : 0;
		const hasNotes = noteArea.querySelector("[data-note='footnote']");
		if (needsNoteCall && noteCallBounds.left > right) {
			// Note is offscreen and will be chunked to the next page on overflow
			node.remove();
		} else if (!hasNotes && needsNoteCall && total > noteDelta) {
			// No space to add even the footnote area
			pageArea.style.setProperty("--pagedjs-footnotes-height", "0px");
			// Add a wrapper as this div is removed later
			const wrapperDiv = document.createElement("div");
			wrapperDiv.appendChild(node);
			// Push to the layout queue for the next page
			this.needsLayout.push(wrapperDiv);
		} else if (!needsNoteCall) {
			// Call was previously added, force adding footnote
			pageArea.style.setProperty(
				"--pagedjs-footnotes-height",
				`${height + total}px`
			);
		} else if (noteCallPosition < noteAreaBounds.top - contentDelta) {
			// the current note content will fit without pushing the call to the next page
			pageArea.style.setProperty(
				"--pagedjs-footnotes-height",
				`${height + noteContentMargins + noteContentBorders}px`
			);
		} else if (notePolicyDelta > 0) {
			// set height to just before note call
			pageArea.style.setProperty(
				"--pagedjs-footnotes-height",
				`${noteAreaBounds.height + notePolicyDelta}px`
			);
			const noteInnerContent = noteContent.querySelector<HTMLElement>(".pagedjs_footnote_inner_content");
			noteInnerContent.style.height =
				noteAreaBounds.height + notePolicyDelta - total + "px";
		}
	}

	private moveFootnote(node: Node, pageArea: HTMLElement, needsNoteCall: boolean) {
		const noteArea = pageArea.querySelector<HTMLElement>(".pagedjs_footnote_area");
		const noteContent = noteArea.querySelector<HTMLElement>(".pagedjs_footnote_content");
		const noteInnerContent = noteContent.querySelector<HTMLElement>(".pagedjs_footnote_inner_content");

		if (!isHTMLElement(node)) {
			return;
		}

		// Add call for the note but only if it's not overflow.
		// If it is overflow, the parentElement will be null.
		let noteCall: HTMLElement | undefined;
		if (needsNoteCall) {
			if (node.parentElement) {
				noteCall = this.createFootnoteCall(node);
			}
			else {
				const ref = node.dataset.ref;
				noteCall = pageArea.querySelector(`[data-ref="${ref}"]`);
			}
		}

		// Remove the break before attribute for future layout
		node.removeAttribute("data-break-before");

		// Check if note already exists for overflow
		const existing = noteInnerContent.querySelector(`[data-ref="${node.dataset.ref}"]`);
		if (existing) {
			// Remove the note from the flow but no need to render it again
			node.remove();
			return;
		}

		// Add the note node
		noteInnerContent.appendChild(node);

		// Add marker
		node.dataset.footnoteMarker = node.dataset.ref;

		// Add Id
		node.id = `note-${node.dataset.ref}`;

		this.recalcFootnotesHeight(node, noteContent, pageArea, noteCall, needsNoteCall);
	}

	private createFootnoteCall(node) {
		const parentElement = node.parentElement;
		const footnoteCall = document.createElement("a");
		for (const className of node.classList) {
			footnoteCall.classList.add(`${className}`);
		}

		footnoteCall.dataset.footnoteCall = node.dataset.ref;
		footnoteCall.dataset.ref = node.dataset.ref;

		// Increment for counters
		footnoteCall.dataset.dataCounterFootnoteIncrement = "1";

		// Add link
		footnoteCall.href = `#note-${node.dataset.ref}`;

		parentElement.insertBefore(footnoteCall, node);

		return footnoteCall;
	}

	afterPageLayout(pageElement: HTMLElement, page: Page, breakToken: BreakToken | undefined, chunker: Chunker) {
		const pageArea = pageElement.querySelector<HTMLElement>(".pagedjs_area");
		const noteArea = page.footnotesArea;
		const noteContent = noteArea.querySelector<HTMLElement>(".pagedjs_footnote_content");
		const noteInnerContent = noteArea.querySelector<HTMLElement>(".pagedjs_footnote_inner_content");

		const noteContentBounds = noteContent.getBoundingClientRect();
		const { width } = noteContentBounds;

		noteInnerContent.style.columnWidth = Math.round(width) + "px";
		noteInnerContent.style.columnGap = "calc(var(--pagedjs-margin-right) + var(--pagedjs-margin-left))";

		// Get overflow
		const layout = new Layout(noteArea, undefined, chunker.settings);
		const overflow = layout.findOverflow(noteInnerContent, noteContentBounds);

		if (overflow) {
			const { startContainer, startOffset } = overflow;
			const footnoteContainer = isHTMLElement(startContainer) ?
				startContainer.closest("[data-footnote-marker]") :
				startContainer.parentElement.closest("[data-footnote-marker]");
			let notEntireNote = (!footnoteContainer || startOffset);
			if (!notEntireNote) {
				let pos = startContainer;
				while (pos && pos !== footnoteContainer) {
					pos = pos.previousSibling || pos.parentNode;
					if (isText(pos)) {
						notEntireNote = true;
						break;
					}
				}
			}

			let extracted: DocumentFragment | undefined;
			if (notEntireNote) {
				// Assuming overflow is not multipart.
				extracted = overflow.extractContents();

				const splitChild = extracted.firstElementChild as HTMLElement | undefined;

				// Add any DOM structure above this node, but remove any text
				// content from it.
				// Assumes the footnote content is not anything complicated enough
				// to need the more complicated handling that we do for the main
				// content.
				const parentRange = document.createRange();
				parentRange.selectNode(footnoteContainer);
				parentRange.setEndAfter(footnoteContainer);
				const cloned = parentRange.cloneContents();
				const walker = walk(cloned.firstChild, cloned);

				let toDelete: Element | undefined;
				let replacePos: Element | undefined;
				let pos: HTMLElement | undefined;
				let done = false;
				while (!done) {
					if (isElement(pos)) {
						if (pos.dataset.ref == splitChild?.dataset.ref) {
							replacePos = pos;
						}

						if (pos.dataset.footnoteMarker) {
							// Make sure counter isn't incremented and no new marker id rendered.
							pos.dataset.splitFrom = "true";
							delete(pos.dataset.footnoteMarker);
						}
					}

					const next = walker.next();
					pos = next.value as HTMLElement | undefined;
					done = next.done;

					if (toDelete) {
						toDelete.remove();
						toDelete = undefined;
					}
					if (isText(pos)) {
						toDelete = pos;
						replacePos = pos.parentElement;
					}
				}

				if (splitChild) {
					splitChild.dataset.splitFrom = splitChild.dataset.ref;
					replacePos.parentNode.replaceChild(extracted, replacePos);
				}
				else {
					replacePos.appendChild(extracted);
				}

				extracted = cloned;

				this.handleAlignment(noteInnerContent.lastElementChild as HTMLElement);
			}
			else {
				// Adjust the range to take the entire footnote.
				const range = document.createRange();
				range.selectNode(footnoteContainer);
				range.setEndAfter(footnoteContainer);
				extracted = range.extractContents();
			}

			this.needsLayout.push(extracted);

			noteContent.style.removeProperty("height");
			noteInnerContent.style.removeProperty("height");

			const noteInnerContentBounds = noteInnerContent.getBoundingClientRect();
			const { height } = noteInnerContentBounds;

			// Get the @footnote margins
			const noteContentMargins = this.marginsHeight(noteContent);
			const noteContentPadding = this.paddingHeight(noteContent);
			const noteContentBorders = this.borderHeight(noteContent);
			pageArea.style.setProperty(
				"--pagedjs-footnotes-height",
				`${height + noteContentMargins + noteContentBorders + noteContentPadding}px`
			);

			// Hide footnote content if empty
			if (noteInnerContent.childNodes.length === 0) {
				noteContent.classList.add("pagedjs_footnote_empty");
			}

			if (!breakToken) {
				chunker.clonePage(page);
			} else {
				// TODO: this was assuming breakToken.overflow was a single overflow, but it's an array.
				//       No spec tests has anything in overflow.
				const firstOverflowNode = breakToken.overflow[0]?.node;
				let previousBreakAfter: string | undefined;
				if (
					isHTMLElement(firstOverflowNode) &&
					typeof firstOverflowNode.dataset.previousBreakAfter !== "undefined"
				) {
					previousBreakAfter = firstOverflowNode.dataset.previousBreakAfter;
				}

				let breakBefore: string | undefined;
				if (
					isHTMLElement(firstOverflowNode) &&
					typeof firstOverflowNode.dataset.breakBefore !== "undefined"
				) {
					breakBefore = firstOverflowNode.dataset.breakBefore;
				}

				if (breakBefore || previousBreakAfter) {
					chunker.clonePage(page);
				}
			}
		}
		noteInnerContent.style.height = "auto";
	}

	private handleAlignment(node: HTMLElement) {
		const styles = window.getComputedStyle(node);
		const alignLast = styles["text-align-last"];
		node.dataset.lastSplitElement = "true";
		if (alignLast === "auto") {
			node.dataset.alignLastSplitElement = "justify";
		} else {
			node.dataset.alignLastSplitElement = alignLast;
		}
	}

	beforePageLayout(page: Page) {
		while (this.needsLayout.length) {
			const fragment = this.needsLayout.shift();

			Array.from(fragment.childNodes).forEach((node) => {
				this.moveFootnote(
					node,
					page.element.querySelector(".pagedjs_area"),
					false
				);
			});
		}
	}

	afterOverflowRemoved(removed: HTMLElement | DocumentFragment, rendered: HTMLElement) {
		// Find the page area
		const area = rendered.closest(".pagedjs_area");
		if (!area) {
			return;
		}

		// Get any rendered footnotes
		const notes = area.querySelectorAll<HTMLElement>(".pagedjs_footnote_area [data-note='footnote']");
		for (const note of notes) {
			// Check if the call for that footnote has been removed with the overflow
			const call = removed.querySelector(`[data-footnote-call="${note.dataset.ref}"]`);
			if (call) {
				note.remove();
				this.overflow.push(note);
			}
		}
		// Hide footnote content if empty
		const noteInnerContent = area.querySelector(".pagedjs_footnote_inner_content");
		if (noteInnerContent && noteInnerContent.childNodes.length === 0) {
			noteInnerContent.parentElement.classList.add("pagedjs_footnote_empty");
		}
	}

	afterOverflowAdded(rendered: HTMLElement) {
		const notes = rendered.querySelectorAll<HTMLElement>("[data-note='footnote']");
		if (notes?.length) {
			this.findVisibleFootnotes(notes, rendered);
		}

		const area = rendered.closest<HTMLElement>(".pagedjs_area");
		const noteContent = area.querySelector<HTMLElement>(".pagedjs_footnote_content");
		const notesInnerContent = area.querySelector<HTMLElement>(".pagedjs_footnote_inner_content");

		if (this.overflow.length) {
			this.overflow.forEach((item) => {
				notesInnerContent.appendChild(item);
				const call = rendered.querySelector<HTMLElement>(`[data-ref="${item.dataset["ref"]}"]`);
				this.recalcFootnotesHeight(item, noteContent, area, call, false);
			});

			this.overflow = [];
		}
	}

	private marginsHeight(element: HTMLElement, total=true) {
		const styles = window.getComputedStyle(element);
		const marginTop = parseInt(styles.marginTop);
		const marginBottom = parseInt(styles.marginBottom);
		let margin = 0;
		if (marginTop) {
			margin += marginTop;
		}
		if (marginBottom && total) {
			margin += marginBottom;
		}
		return margin;
	}

	private paddingHeight(element: HTMLElement, total=true) {
		const styles = window.getComputedStyle(element);
		const paddingTop = parseInt(styles.paddingTop);
		const paddingBottom = parseInt(styles.paddingBottom);
		let padding = 0;
		if (paddingTop) {
			padding += paddingTop;
		}
		if (paddingBottom && total) {
			padding += paddingBottom;
		}
		return padding;
	}

	private borderHeight(element: HTMLElement, total=true) {
		const styles = window.getComputedStyle(element);
		const borderTop = parseInt(styles.borderTop);
		const borderBottom = parseInt(styles.borderBottom);
		let borders = 0;
		if (borderTop) {
			borders += borderTop;
		}
		if (borderBottom && total) {
			borders += borderBottom;
		}
		return borders;
	}
}

export default Footnotes;

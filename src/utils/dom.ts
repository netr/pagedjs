import { getBoundingClientRect } from "./utils.js";

export function isElement(node: Node | undefined | null): node is Element {
	return node && node.nodeType === Node.ELEMENT_NODE;
}

export function isHTMLElement(node: Node | undefined | null): node is HTMLElement {
	return isElement(node) && node instanceof HTMLElement;
}

export function isText(node: Node | undefined | null): node is Text {
	return node && node.nodeType === Node.TEXT_NODE;
}

export function* walk(start: Node, limiter: Node) {
	let node = start;

	while (node) {

		yield node;

		if (node.childNodes.length) {
			node = node.firstChild;
		} else if (node.nextSibling) {
			if (limiter && node === limiter) {
				node = undefined;
				break;
			}
			node = node.nextSibling;
		} else {
			while (node) {
				node = node.parentNode;
				if (limiter && node === limiter) {
					node = undefined;
					break;
				}
				if (node && node.nextSibling) {
					node = node.nextSibling;
					break;
				}

			}
		}
	}
}

export function nodeAfter(node: Node, limiter?: Node, descend = false): Node | null {
	if (limiter && node === limiter) {
		return null;
	}
	if (descend && node.childNodes.length) {
		let child = node.firstChild as Node | null;
		if (isIgnorable(child)) {
			child = nextSignificantNode(child);
		}
		if (child) {
			return child;
		}
	}
	let significantNode = nextSignificantNode(node);
	if (significantNode) {
		return significantNode;
	}
	if (node.parentNode) {
		while ((node = node.parentNode)) {
			if (limiter && node === limiter) {
				return null;
			}
			significantNode = nextSignificantNode(node);
			if (significantNode) {
				return significantNode;
			}
		}
	}
}

function findLastSignificantDescendant(node: Node) {
	let done = false;

	while (!done) {
		let child = node.lastChild as Node | null;
		if (child && isIgnorable(child)) {
			child = previousSignificantNode(child);
		}
		if (child && isElement(child)) {
			node = child;
		}
		else {
			done = true;
		}
	}

	return node;
}

export function nodeBefore(node: Node, limiter: Node, descend = false): Node | null {
	do {
		if (limiter && node === limiter) {
			return null;
		}

		let significantNode = previousSignificantNode(node);
		if (significantNode) {
			if (descend) {
				significantNode = findLastSignificantDescendant(significantNode);
			}
			return significantNode;
		}

		node = node.parentNode;
	} while (node);
}

export function elementAfter<T extends Element = Element>(node: Node, limiter: Node, descend = false) {
	let after = nodeAfter(node, limiter, descend);

	while (after && after.nodeType !== Node.ELEMENT_NODE) {
		after = nodeAfter(after, limiter, descend);
	}

	return after as T | null;
}

export function elementBefore<T extends Element = Element>(node: Node, limiter: Node, descend = false) {
	let before = nodeBefore(node, limiter, descend);

	while (before && before.nodeType !== Node.ELEMENT_NODE) {
		before = nodeBefore(before, limiter, descend);
	}

	return before as T | null;
}

export function displayedElementAfter(node: Node, limiter: Node, descend = false) {
	let after = elementAfter<HTMLElement>(node, limiter, descend);

	while (after && after.dataset.undisplayed) {
		after = elementAfter(after, limiter, descend);
	}

	return after;
}

export function displayedElementBefore(node: Node, limiter: Node, descend = false) {
	let before = elementBefore<HTMLElement>(node, limiter, descend);

	while (before && before.dataset.undisplayed) {
		before = elementBefore(before, limiter, descend);
	}

	return before;
}

export function stackChildren(currentNode: Element, stacked?: Element[]) {
	const stack = stacked ?? [];

	stack.unshift(currentNode);

	const children = currentNode.children;
	for (let i = 0, length = children.length; i < length; i++) {
		stackChildren(children[i], stack);
	}

	return stack;
}

function copyWidth(originalElement: HTMLElement, destElement: HTMLElement) {
	const originalStyle = getComputedStyle(originalElement);
	const bounds = getBoundingClientRect(originalElement);
	const width = originalStyle.width ? parseInt(originalStyle.width) : bounds.width;
	if (width) {
		destElement.style.width = width + "px";
	}
}

export function rebuildTableRow(node: HTMLTableRowElement, alreadyRendered: Element | DocumentFragment, existingChildren: number) {
	let currentCol = 0, maxCols = 0, nextInitialColumn = 0;
	const rebuilt = node.cloneNode(false) as HTMLTableRowElement;
	const initialColumns = Array.from(node.children);

	// Find the max number of columns.
	let earlierRow = node.parentElement.children[0];
	while (earlierRow && earlierRow !== node) {
		if (earlierRow.children.length > maxCols) {
			maxCols = earlierRow.children.length;
		}
		earlierRow = earlierRow.nextElementSibling;
	}

	if (!maxCols) {
		const existing = findElement(node, alreadyRendered);
		maxCols = existing?.children.length || 0;
	}

	// The next td to use in each tr.
	// Doesn't take account of rowspans above that might make extra columns.
	const rowOffsets = Array(maxCols).fill(0);

	// Duplicate rowspans and our initial columns.
	while (currentCol < maxCols) {
		let earlierRow = node.parentElement.children[0];
		let rowspan: number | undefined;
		let column: HTMLTableCellElement;
		// Find the nth column we'll duplicate (rowspan) or use.
		while (earlierRow && earlierRow !== node) {
			if (rowspan == undefined) {
				column = earlierRow.children[currentCol - rowOffsets[nextInitialColumn]] as HTMLTableCellElement;
				if (column && column.rowSpan !== undefined && column.rowSpan > 1) {
					rowspan = column.rowSpan;
				}
			}
			// If rowspan === 0 the entire remainder of the table row is used.
			if (rowspan) {
				// Tracking how many rows in the overflow.
				if (rowspan < 2) {
					rowspan = undefined;
				}
				else {
					rowspan--;
				}
			}
			earlierRow = earlierRow.nextElementSibling;
		}

		let destColumn: HTMLTableCellElement | undefined;
		if (rowspan) {
			if (!existingChildren) {
				destColumn = column.cloneNode(false) as HTMLTableCellElement;
				// Adjust rowspan value.
				destColumn.rowSpan = !column.rowSpan ? 0 : rowspan;
			}
		} else {
			// Fill the gap with the initial columns (if exists).
			destColumn = column = initialColumns[nextInitialColumn++]?.cloneNode(false) as HTMLTableCellElement;
		}
		if (column && destColumn) {
			if (alreadyRendered) {
				const existing = findElement(column, alreadyRendered);
				if (existing) {
					column = existing as HTMLTableCellElement;
				}
			}
			copyWidth(column, destColumn);
			if (destColumn) {
				rebuilt.appendChild(destColumn);
			}
		}
		currentCol++;
	}
	return rebuilt;
}

export function rebuildTree(node: Text | HTMLElement, fragment?: DocumentFragment, alreadyRendered?: Element | DocumentFragment) {
	const ancestors: HTMLElement[] = [];
	let added: Element[] | undefined = [];
	let dupSiblings = false;
	const freshPage = !fragment;
	let numListItems = 0;

	if (!fragment) {
		fragment = document.createDocumentFragment();
	}

	// Gather all ancestors
	let element = node;

	if (!isText(node)) {
		ancestors.unshift(node);
		if (node.tagName === "LI") {
			numListItems++;
		}
	}
	while (element.parentNode && isElement(element.parentNode)) {
		ancestors.unshift(element.parentNode as HTMLElement);
		if (element.parentNode.tagName === "LI") {
			numListItems++;
		}
		element = element.parentNode as HTMLElement;
	}

	for (const subject of ancestors) {
		let container: Element | DocumentFragment;
		if (added.length) {
			container = added[added.length - 1];
		} else {
			container = fragment;
		}

		let parent: HTMLElement | undefined;
		if (subject.nodeName === "TR") {
			parent = findElement(subject, container);
			if (!parent) {
				parent = rebuildTableRow(subject as HTMLTableRowElement, alreadyRendered, container.childElementCount);
				container.appendChild(parent);
			}
		}
		else if (dupSiblings) {
			let sibling: HTMLElement | undefined = subject.parentElement ? subject.parentElement.children[0] as HTMLElement : subject;

			while (sibling) {
				const existing = findElement(sibling, container);
				let siblingClone: HTMLElement | undefined;
				if (!existing) {
					siblingClone = cloneNodeAncestor(sibling);
					if (alreadyRendered) {
						const originalElement = findElement(sibling, alreadyRendered);
						if (originalElement) {
							copyWidth(originalElement, siblingClone);
						}
					}
					container.appendChild(siblingClone);
				}

				if (sibling == subject) {
					parent = siblingClone || existing;
				}
				sibling = sibling.nextElementSibling as HTMLElement | undefined;
			}
		} else {
			parent = findElement(subject, container);
			if (!parent) {
				parent = cloneNodeAncestor(subject);
				if (alreadyRendered) {
					const originalElement = findElement(subject, alreadyRendered);
					if (originalElement) {
						copyWidth(originalElement, parent);

						// Colgroup to clone?
						Array.from(originalElement.children).forEach(child => {
							if (child.tagName === "COLGROUP") {
								parent.append(child.cloneNode(true));
							}
						});
					}
				}
				container.appendChild(parent);
			}
		}

		if (subject.previousElementSibling?.nodeName === "THEAD") {
			// Clone the THEAD too.
			let sibling = subject.previousElementSibling;

			const existing = findElement(sibling, container);
			let siblingClone: Element | undefined;
			if (!existing) {
				siblingClone = cloneNodeAncestor(sibling, true);
				if (alreadyRendered) {
					let originalElement = findElement(sibling, alreadyRendered);
					if (originalElement) {
						const walker = walk(siblingClone, siblingClone);
						let done = false;
						while (!done) {
							const next = walker.next();
							const pos = next.value as HTMLElement | undefined;
							done = next.done;

							if (isElement(pos)) {
								originalElement = findElement(pos, alreadyRendered);
								copyWidth(originalElement, pos);

								// I've tried to make the THEAD invisible; this is the best
								// I could achieve. It gets a zero height but still somehow
								// affects the container height by a couple of pixels in my
								// testing. :(
								// Next step is to change the "true" below to use a custom
								// attribute that lets you control whether the header is shown.
								//
								// eslint-disable-next-line no-constant-condition
								if (true) {
									pos.style.visibility = "collapse";
									pos.style.marginTop = "0px";
									pos.style.marginBottom = "0px";
									pos.style.paddingTop = "0px";
									pos.style.paddingBottom = "0px";
									pos.style.borderTop = "0px";
									pos.style.borderBottom = "0px";
									pos.style.lineHeight = "0px";
									pos.style.opacity = "0";
								}
							}
						}
					}
				}
				container.insertBefore(siblingClone, container.firstChild);
			}

			if (sibling === subject) {
				// TODO: siblingClone is never falsish.
				parent = siblingClone as HTMLElement ?? existing;
			}
			sibling = sibling.nextElementSibling;
		}

		const split = inIndexOfRefs(subject, alreadyRendered);
		if (split) {
			setSplit(split, parent);
		}

		dupSiblings = (subject.dataset.clonesiblings === "true" ||
			["grid", "flex", "table-row"].indexOf(subject.style.display) > -1);
		added.push(parent);

		if (subject.tagName === "LI") {
			numListItems--;
		}

		if (freshPage && (isText(node) || numListItems)) {
			// Flag the first node on the page so we can suppress list styles on
			// a continued item and list item numbers except the list one
			// if an item number should be printed.
			parent.dataset.suppressListStyle = "true";
		}
	}

	added = undefined;
	return fragment;
}

function setSplit(orig: HTMLElement, clone: HTMLElement) {
	if (orig.dataset.splitTo) {
		clone.setAttribute("data-split-from", clone.getAttribute("data-ref"));
	}

	// This will let us split a table with multiple columns correctly.
	orig.setAttribute("data-split-to", clone.getAttribute("data-ref"));
}

function cloneNodeAncestor<T extends Element>(node: T, deep=false): T {
	const result = node.cloneNode(deep) as T;

	if (result.hasAttribute("id")) {
		const dataID = result.getAttribute("id");
		result.setAttribute("data-id", dataID);
		result.removeAttribute("id");
	}

	// This is handled by css :not, but also tidied up here
	if (result.hasAttribute("data-break-before")) {
		result.removeAttribute("data-break-before");
	}

	if (result.hasAttribute("data-previous-break-after")) {
		result.removeAttribute("data-previous-break-after");
	}

	return result;
}

export function rebuildAncestors(node: HTMLElement) {
	const ancestors: HTMLElement[] = [];
	let added: HTMLElement[] = [];

	const fragment = document.createDocumentFragment();

	// Gather all ancestors
	let element = node;
	while (element.parentNode && element.parentNode.nodeType === Node.ELEMENT_NODE) {
		ancestors.unshift(element.parentNode as HTMLElement);
		element = element.parentNode as HTMLElement;
	}

	for (const ancestor of ancestors) {
		const parent = ancestor.cloneNode(false) as HTMLElement;

		parent.setAttribute("data-split-from", parent.getAttribute("data-ref"));

		if (parent.hasAttribute("id")) {
			const dataID = parent.getAttribute("id");
			parent.setAttribute("data-id", dataID);
			parent.removeAttribute("id");
		}

		// This is handled by css :not, but also tidied up here
		if (parent.hasAttribute("data-break-before")) {
			parent.removeAttribute("data-break-before");
		}

		if (parent.hasAttribute("data-previous-break-after")) {
			parent.removeAttribute("data-previous-break-after");
		}

		if (added.length) {
			const container = added[added.length-1];
			container.appendChild(parent);
		} else {
			fragment.appendChild(parent);
		}
		added.push(parent);

		// rebuild table rows
		if (parent.nodeName === "TD" && ancestor.parentElement.contains(ancestor)) {
			let td: HTMLElement | undefined = ancestor;
			let prev = parent;
			while ((td = td.previousElementSibling as HTMLElement | undefined)) {
				const sib = td.cloneNode(false) as HTMLElement;
				parent.parentElement.insertBefore(sib, prev);
				prev = sib;
			}

		}
	}

	added = undefined;
	return fragment;
}

export function needsBreakBefore(node: Node | undefined) {
	if( isHTMLElement(node) &&
			typeof node.dataset.breakBefore !== "undefined" &&
			(node.dataset.breakBefore === "always" ||
			 node.dataset.breakBefore === "page" ||
			 node.dataset.breakBefore === "left" ||
			 node.dataset.breakBefore === "right" ||
			 node.dataset.breakBefore === "recto" ||
			 node.dataset.breakBefore === "verso")
		 ) {
		return true;
	}

	return false;
}

export function needsBreakAfter(node: Node | undefined) {
	if( isHTMLElement(node) &&
			typeof node.dataset.breakAfter !== "undefined" &&
			(node.dataset.breakAfter === "always" ||
			 node.dataset.breakAfter === "page" ||
			 node.dataset.breakAfter === "left" ||
			 node.dataset.breakAfter === "right" ||
			 node.dataset.breakAfter === "recto" ||
			 node.dataset.breakAfter === "verso")
		 ) {
		return true;
	}

	return false;
}

export function needsPreviousBreakAfter(node: Node | undefined) {
	if( isHTMLElement(node) &&
			typeof node.dataset.previousBreakAfter !== "undefined" &&
			(node.dataset.previousBreakAfter === "always" ||
			 node.dataset.previousBreakAfter === "page" ||
			 node.dataset.previousBreakAfter === "left" ||
			 node.dataset.previousBreakAfter === "right" ||
			 node.dataset.previousBreakAfter === "recto" ||
			 node.dataset.previousBreakAfter === "verso")
		 ) {
		return true;
	}

	return false;
}

export function needsPageBreak(node: Node | undefined, previousSignificantNode: Node | undefined) {
	if (typeof node === "undefined" || !previousSignificantNode || isIgnorable(node)) {
		return false;
	}
	if (isHTMLElement(node) && node.dataset.undisplayed) {
		return false;
	}
	let previousSignificantNodePage = isHTMLElement(previousSignificantNode) ? previousSignificantNode.dataset.page : undefined;
	if (typeof previousSignificantNodePage === "undefined") {
		const nodeWithNamedPage = getNodeWithNamedPage(previousSignificantNode);
		if (nodeWithNamedPage) {
			previousSignificantNodePage = nodeWithNamedPage.dataset.page;
		}
	}
	let currentNodePage = isHTMLElement(node) ? node.dataset.page : undefined;
	if (typeof currentNodePage === "undefined") {
		const nodeWithNamedPage = getNodeWithNamedPage(node, previousSignificantNode);
		if (nodeWithNamedPage) {
			currentNodePage = nodeWithNamedPage.dataset.page;
		}
	}
	return currentNodePage !== previousSignificantNodePage;
}

export function *words(node: Node) {
	const currentText = node.nodeValue;
	const max = currentText.length;
	let currentOffset = 0;

	let range: Range | undefined;
	const significantWhitespaces = node.parentElement && node.parentElement.nodeName === "PRE";

	while (currentOffset < max) {
		const currentLetter = currentText[currentOffset];
		if (/^[\S\u202F\u00A0]$/.test(currentLetter) || significantWhitespaces) {
			if (!range) {
				range = document.createRange();
				range.setStart(node, currentOffset);
			}
		} else {
			if (range) {
				range.setEnd(node, currentOffset);
				yield range;
				range = undefined;
			}
		}

		currentOffset += 1;
	}

	if (range) {
		range.setEnd(node, currentOffset);
		yield range;
	}
}

export function *letters(wordRange: Range) {
	const currentText = wordRange.startContainer as Text;
	const max = currentText.length;
	let currentOffset = wordRange.startOffset;

	while (currentOffset < max) {
		 const range = document.createRange();
		 range.setStart(currentText, currentOffset);
		 range.setEnd(currentText, currentOffset+1);

		 yield range;

		 currentOffset += 1;
	}
}

export function isContainer(node: Node) {
	if (!isHTMLElement(node)) {
		return true;
	}

	if (node.style && node.style.display === "none") {
		return false;
	}

	switch (node.tagName) {
		// Inline
		case "A":
		case "ABBR":
		case "ACRONYM":
		case "B":
		case "BDO":
		case "BIG":
		case "BR":
		case "BUTTON":
		case "CITE":
		case "CODE":
		case "DFN":
		case "EM":
		case "I":
		case "IMG":
		case "INPUT":
		case "KBD":
		case "LABEL":
		case "MAP":
		case "OBJECT":
		case "Q":
		case "SAMP":
		case "SCRIPT":
		case "SELECT":
		case "SMALL":
		case "SPAN":
		case "STRONG":
		case "SUB":
		case "SUP":
		case "TEXTAREA":
		case "TIME":
		case "TT":
		case "VAR":
		case "P":
		case "H1":
		case "H2":
		case "H3":
		case "H4":
		case "H5":
		case "H6":
		case "FIGCAPTION":
		case "BLOCKQUOTE":
		case "PRE":
		case "LI":
		case "TD":
		case "DT":
		case "DD":
		case "VIDEO":
		case "CANVAS":
			return false;
		default:
			return true;
	}
}

export function cloneNode<T extends Node>(n: T, deep = false) {
	return n.cloneNode(deep) as T;
}

export function inIndexOfRefs(node: Element, doc: (Element | DocumentFragment) & { indexOfRefs?: Record<string, HTMLElement> }) {
	if (!doc || !doc.indexOfRefs) return;
	const ref = node.getAttribute("data-ref");
	return doc.indexOfRefs[ref];
}

export function replaceOrAppendElement(parentNode: Element, child: Text | Element) {
	if (!isText(child)) {
		const childRef = child.getAttribute("data-ref");
		for (let index = 0; index < parentNode.children.length; index++) {
			if (parentNode.children[index].getAttribute("data-ref") == childRef) {
				parentNode.replaceChild(child, parentNode.childNodes[index]);
				return;
			}
		}
	}

	parentNode.appendChild(child);
}

export function findElement(node: Element, doc?: (Element | DocumentFragment) & { indexOfRefs?: Record<string, HTMLElement> }, forceQuery?: boolean) {
	if (!doc) return;
	const ref = node.getAttribute("data-ref");
	return findRef(ref, doc, forceQuery);
}

export function findRef(ref: string, doc: (Element | DocumentFragment) & { indexOfRefs?: Record<string, HTMLElement> }, forceQuery?: boolean) {
	if (!forceQuery && doc.indexOfRefs && doc.indexOfRefs[ref]) {
		return doc.indexOfRefs[ref];
	} else {
		return doc.querySelector<HTMLElement>(`[data-ref='${ref}']`);
	}
}

export function validNode(node: Node): node is Text | HTMLElement {
	if (isText(node)) {
		return true;
	}

	if (isHTMLElement(node) && node.dataset.ref) {
		return true;
	}

	return false;
}

export function prevValidNode(node: Node) {
	while (!validNode(node)) {
		if (node.previousSibling) {
			node = node.previousSibling;
		} else {
			node = node.parentNode;
		}

		if (!node) {
			break;
		}
	}

	return node as Text | HTMLElement | null;
}

export function nextValidNode(node: Node) {
	while (!validNode(node)) {
		if (node.nextSibling) {
			node = node.nextSibling;
		} else {
			node = node.parentNode.nextSibling;
		}

		if (!node) {
			break;
		}
	}

	return node as Text | HTMLElement | null;
}


export function indexOf(node: Node) {
	const parent = node.parentNode;
	if (!parent) {
		return 0;
	}
	return Array.prototype.indexOf.call(parent.childNodes, node);
}

export function child(node: Node, index: number) {
	return node.childNodes[index];
}

export function isVisible(node: Node) {
	if (isElement(node) && window.getComputedStyle(node).display !== "none") {
		return true;
	} else if (isText(node) &&
			hasTextContent(node) &&
			window.getComputedStyle(node.parentNode as Element).display !== "none") {
		return true;
	}
	return false;
}

export function hasContent(node: Node) {
	if (isElement(node)) {
		return true;
	} else if (isText(node) &&
			node.textContent.trim().length) {
		return true;
	}
	return false;
}

export function hasTextContent(node: Node) {
	if (isElement(node)) {
		for (const child of node.childNodes) {
			if (isText(child) && child.textContent.trim().length) {
				return true;
			}
		}
	} else if (isText(node) && node.textContent.trim().length) {
		return true;
	}
	return false;
}

export function indexOfTextNode(node: Node, parent: HTMLElement | DocumentFragment, hyphen: string) {
	if (!isText(node)) {
		return -1;
	}

	// Use previous element's dataref to match if possible. Matching the text
	// will potentially return the wrong node.
	if (node.previousSibling) {
		const matchingNode = parent.querySelector(`[data-ref='${(node.previousSibling as HTMLElement).dataset.ref}']`);
		return Array.prototype.indexOf.call(parent.childNodes, matchingNode) + 1;
	}

	let nodeTextContent = node.textContent;
	// Remove hyphenation if necessary.
	if (nodeTextContent.substring(nodeTextContent.length - hyphen.length) === hyphen) {
		nodeTextContent = nodeTextContent.substring(0, nodeTextContent.length - hyphen.length);
	}
	let index = -1;
	for (let i = 0; i < parent.childNodes.length; i++) {
		const child = parent.childNodes[i];
		if (child.nodeType === Node.TEXT_NODE) {
			const text = parent.childNodes[i].textContent;
			if (text.includes(nodeTextContent)) {
				index = i;
				break;
			}
		}
	}

	return index;
}


/**
 * Throughout, whitespace is defined as one of the characters
 *  "\t" TAB \u0009
 *  "\n" LF  \u000A
 *  "\r" CR  \u000D
 *  " "  SPC \u0020
 *
 * This does not use Javascript's "\s" because that includes non-breaking
 * spaces (and also some other characters).
 */

/**
 * Determine if a node should be ignored by the iterator functions.
 * taken from https://developer.mozilla.org/en-US/docs/Web/API/Document_Object_Model/Whitespace#Whitespace_helper_functions
 *
 * @param node An object implementing the DOM1 |Node| interface.
 * @return true if the node is:
 *  1) A |Text| node that is all whitespace
 *  2) A |Comment| node
 *  and otherwise false.
 */
export function isIgnorable(node: Node) {
	return (node.nodeType === Node.COMMENT_NODE) ||
		((node.nodeType === Node.TEXT_NODE) && isAllWhitespace(node));
}

/**
 * Determine whether a node's text content is entirely whitespace.
 *
 * @param node  A node implementing the |CharacterData| interface (i.e., a |Text|, |Comment|, or |CDATASection| node
 * @return true if all of the text content of |nod| is whitespace, otherwise false.
 */
export function isAllWhitespace(node: Node) {
	return !(/[^\t\n\r ]/.test(node.textContent));
}

/**
 * Version of |previousSibling| that skips nodes that are entirely
 * whitespace or comments.  (Normally |previousSibling| is a property
 * of all DOM nodes that gives the sibling node, the node that is
 * a child of the same parent, that occurs immediately before the
 * reference node.)
 *
 * @param sib  The reference node.
 * @return Either:
 *  1) The closest previous sibling to |sib| that is not ignorable according to |is_ignorable|, or
 *  2) null if no such node exists.
 */
export function previousSignificantNode(sib: Node): Node | null {
	while ((sib = sib.previousSibling)) {
		if (!isIgnorable(sib)) return sib;
	}
	return null;
}

function getNodeWithNamedPage(node: Node, limiter?: Node) {
	if (isHTMLElement(node) && node.dataset.page) {
		return node;
	}
	if (node.parentNode) {
		while ((node = node.parentNode)) {
			if (limiter && node === limiter) {
				return;
			}
			if (isHTMLElement(node) && node.dataset.page) {
				return node;
			}
		}
	}
	return null;
}

export function breakInsideAvoidParentNode(node: Node) {
	while ((node = node.parentNode)) {
		if (isHTMLElement(node) && node.dataset.breakInside === "avoid") {
			return node;
		}
	}
	return null;
}

/**
 * Find a parent with a given node name.
 * @param node - initial Node
 * @param nodeName - node name (eg. "TD", "TABLE", "STRONG"...)
 * @param limiter - go up to the parent until there's no more parent or the current node is equals to the limiter
 * @returns Either:
 *  1) The closest parent for a the given node name, or
 *  2) undefined if no such node exists.
 */
export function parentOf(node: Node, nodeName: string, limiter: Node): Node | undefined {
	if (limiter && node === limiter) {
		return;
	}
	if (node.parentNode) {
		while ((node = node.parentNode)) {
			if (limiter && node === limiter) {
				return undefined;
			}
			if (node.nodeName === nodeName) {
				return node;
			}
		}
	}
}

/**
 * Version of |nextSibling| that skips nodes that are entirely
 * whitespace or comments.
 *
 * @param sib - The reference node.
 * @return Either:
 *  1) The closest next sibling to |sib| that is not ignorable according to |is_ignorable|, or
 *  2) null if no such node exists.
 */
export function nextSignificantNode(sib: Node): Node | null {
	while ((sib = sib.nextSibling)) {
		if (!isIgnorable(sib)) return sib;
	}
	return null;
}

export function filterTree(content: Node, func?: (node: Node) => number, what?: number) {
	const treeWalker = document.createTreeWalker(
		content || this.dom,
		what ?? NodeFilter.SHOW_ALL,
		func ? { acceptNode: func } : null,
	);

	let node = treeWalker.nextNode();
	while(node) {
		const current = node;
		node = treeWalker.nextNode();
		current.parentNode.removeChild(current);
	}
}

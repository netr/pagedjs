import csstree from "css-tree";

import Handler from "../handler";
import type { HooksInterface } from "../handler";
import type Chunker from "../../chunker/chunker";
import type Page from "../../chunker/page";
import type Polisher from "../../polisher/polisher";
import type { RuleContext } from "../../polisher/sheet";
import { displayedElementAfter, displayedElementBefore, needsPageBreak } from "../../utils/dom";

interface Breaker {
	property: string;
	value: string;
	selector: string;
	name?: string;
}

interface BreakPage extends Page {
	splitFrom?: string;
	splitTo?: string;
	breakBefore?: string;
	breakAfter?: string;
	previousBreakAfter?: string;
}

class Breaks extends Handler implements HooksInterface<Chunker["hooks"] & Polisher["hooks"]> {
	private readonly breaks: Record<string, Breaker[]> = {};

	onDeclaration(declaration: csstree.Declaration, dItem: csstree.ListItem<csstree.CssNode>, dList: csstree.List<csstree.CssNode>, rule: RuleContext) {
		let property = declaration.property;

		if (property === "page") {
			const children = (declaration.value as csstree.Value).children.first() as csstree.Identifier;
			const value = children.name;
			const selector = csstree.generate(rule.ruleNode.prelude);
			const name = value;

			const breaker: Breaker = {
				property,
				value,
				selector,
				name,
			};

			selector.split(",").forEach((s) => {
				this.breaks[s] ??= [];
				this.breaks[s].push(breaker);
			});

			dList.remove(dItem);
		}

		if (property === "break-before" ||
				property === "break-after" ||
				property === "page-break-before" ||
				property === "page-break-after"
		) {
			const child = (declaration.value as csstree.Value).children.first() as csstree.Identifier;
			const value = child.name;
			const selector = csstree.generate(rule.ruleNode.prelude);

			if (property === "page-break-before") {
				property = "break-before";
			} else if (property === "page-break-after") {
				property = "break-after";
			}

			const breaker: Breaker = {
				property: property,
				value: value,
				selector: selector
			};

			selector.split(",").forEach((s) => {
				this.breaks[s] ??= [];
				this.breaks[s].push(breaker);
			});

			// Remove from CSS -- handle right / left in module
			dList.remove(dItem);
		}
	}

	afterParsed(parsed: HTMLElement | DocumentFragment) {
		this.processBreaks(parsed, this.breaks);
	}

	private processBreaks(parsed: HTMLElement | DocumentFragment, breaks: Record<string, Breaker[]>) {
		for (const b in breaks) {
			// Find elements
			const elements = parsed.querySelectorAll(b);
			// Add break data
			for (let i = 0; i < elements.length; i++) {
				for (const prop of breaks[b]) {

					if (prop.property === "break-after") {
						const nodeAfter = displayedElementAfter(elements[i], parsed);

						elements[i].setAttribute("data-break-after", prop.value);

						if (nodeAfter) {
							nodeAfter.setAttribute("data-previous-break-after", prop.value);
						}
					} else if (prop.property === "break-before") {
						const nodeBefore = displayedElementBefore(elements[i], parsed, true);

						// Breaks are only allowed between siblings, not between a box and its container.
						// If we cannot find a node before we should not break!
						// https://drafts.csswg.org/css-break-3/#break-propagation
						if (nodeBefore) {
							if (prop.value === "page" && needsPageBreak(elements[i], nodeBefore)) {
								// we ignore this explicit page break because an implicit page break is already needed
								continue;
							}
							elements[i].setAttribute("data-break-before", prop.value);
							nodeBefore.setAttribute("data-next-break-before", prop.value);
						}
					} else if (prop.property === "page") {
						elements[i].setAttribute("data-page", prop.value);

						const nodeAfter = displayedElementAfter(elements[i], parsed);

						if (nodeAfter) {
							nodeAfter.setAttribute("data-after-page", prop.value);
						}
					} else {
						elements[i].setAttribute("data-" + prop.property, prop.value);
					}
				}
			}
		}
	}

	private addBreakAttributes(pageElement: HTMLElement, page: BreakPage) {
		const before = pageElement.querySelector<HTMLElement>("[data-break-before]");
		const after = pageElement.querySelector<HTMLElement>("[data-break-after]");
		const previousBreakAfter = pageElement.querySelector<HTMLElement>("[data-previous-break-after]");

		if (before) {
			if (before.dataset.splitFrom) {
				page.splitFrom = before.dataset.splitFrom;
				pageElement.setAttribute("data-split-from", before.dataset.splitFrom);
			} else if (before.dataset.breakBefore && before.dataset.breakBefore !== "avoid") {
				page.breakBefore = before.dataset.breakBefore;
				pageElement.setAttribute("data-break-before", before.dataset.breakBefore);
			}
		}

		if (after && after.dataset) {
			if (after.dataset.splitTo) {
				page.splitTo = after.dataset.splitTo;
				pageElement.setAttribute("data-split-to", after.dataset.splitTo);
			} else if (after.dataset.breakAfter && after.dataset.breakAfter !== "avoid") {
				page.breakAfter = after.dataset.breakAfter;
				pageElement.setAttribute("data-break-after", after.dataset.breakAfter);
			}
		}

		if (previousBreakAfter && previousBreakAfter.dataset) {
			if (previousBreakAfter.dataset.previousBreakAfter && previousBreakAfter.dataset.previousBreakAfter !== "avoid") {
				page.previousBreakAfter = previousBreakAfter.dataset.previousBreakAfter;
			}
		}
	}

	afterPageLayout(pageElement: HTMLElement, page: Page) {
		this.addBreakAttributes(pageElement, page as BreakPage);
	}
}

export default Breaks;

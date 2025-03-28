import { calculateSpecificity } from "clear-cut";
import csstree from "css-tree";

import Handler from "../handler";
import type { HooksInterface } from "../handler";
import type Chunker from "../../chunker/chunker";
import type Polisher from "../../polisher/polisher";
import type { RuleContext } from "../../polisher/sheet";
import { cleanSelector } from "../../utils/css";

interface DisplayRule {
	value: string;
	selector: string;
	specificity: number;
	important: string | boolean;
}

class UndisplayedFilter extends Handler implements HooksInterface<Chunker["hooks"] & Polisher["hooks"]> {
	private readonly displayRules: Record<string, DisplayRule> = {};

	onDeclaration(declaration: csstree.Declaration, _dItem: csstree.ListItem<csstree.CssNode>, _dList: csstree.List<csstree.CssNode>, rule: RuleContext) {
		if (declaration.property === "display") {
			const selector = csstree.generate(rule.ruleNode.prelude);
			const value = ((declaration.value as csstree.Value).children.first() as csstree.Identifier).name;

			selector.split(",").forEach((s) => {
				this.displayRules[s] = {
					value: value,
					selector: s,
					specificity: calculateSpecificity(s),
					important: declaration.important,
				};
			});
		}
	}

	filter(content: HTMLElement | DocumentFragment) {
		const { matches, selectors } = this.sortDisplayedSelectors(content, this.displayRules);

		// Find matching elements that have display styles
		for (let i = 0; i < matches.length; i++) {
			const element = matches[i];
			const selector = selectors[i];
			const displayValue = selector[selector.length-1].value;
			if (this.removable(element) && displayValue === "none") {
				element.dataset.undisplayed = "undisplayed";
			}
		}

		// Find elements that have inline styles
		const styledElements = content.querySelectorAll<HTMLElement>("[style]");
		for (let i = 0; i < styledElements.length; i++) {
			const element = styledElements[i];
			if (this.removable(element)) {
				element.dataset.undisplayed = "undisplayed";
			}
		}
	}

	private sorter(a: DisplayRule, b: DisplayRule) {
		if (a.important && !b.important) {
			return 1;
		}

		if (b.important && !a.important) {
			return -1;
		}

		return a.specificity - b.specificity;
	}

	private sortDisplayedSelectors(content: HTMLElement | DocumentFragment, displayRules: Record<string, DisplayRule>) {
		const matches = [];
		const selectors = [];
		for (const d in displayRules) {
			const displayItem = displayRules[d];
			const selector = displayItem.selector;
			let query: ArrayLike<HTMLElement> = [];
			try {
				try {
					query = content.querySelectorAll<HTMLElement>(selector);
					// eslint-disable-next-line @typescript-eslint/no-unused-vars
				} catch (_e) {
					query = content.querySelectorAll<HTMLElement>(cleanSelector(selector));
				}
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
			} catch (_e) {
				query = [];
			}
			const elements = Array.from(query);
			for (const e of elements) {
				if (matches.includes(e)) {
					const index = matches.indexOf(e);
					selectors[index].push(displayItem);
					selectors[index] = selectors[index].sort(this.sorter);
				} else {
					matches.push(e);
					selectors.push([displayItem]);
				}
			}
		}

		return { matches, selectors };
	}

	private removable(element: HTMLElement) {
		if (element.style &&
				element.style.display !== "" &&
				element.style.display !== "none") {
			return false;
		}

		return true;
	}
}

export default UndisplayedFilter;

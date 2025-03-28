import csstree from "css-tree";

import Handler from "../handler";
import type { HooksInterface } from "../handler";
import type Chunker from "../../chunker/chunker";
import type Polisher from "../../polisher/polisher";
import type Sheet from "../../polisher/sheet";
import type { RuleContext } from "../../polisher/sheet";

interface RunningSelector {
	identifier: string;
	value: string;
	selector: string;
	first?: HTMLElement;
}

interface RunningElement {
	func: string;
	args: string[];
	value: string;
	style: "first"; // we only handle first for now
	selector: string;
	fullSelector: string;
}

class RunningHeaders extends Handler implements HooksInterface<Chunker["hooks"] & Polisher["hooks"]> {
	private readonly runningSelectors: Record<string, RunningSelector> = {};
	private orderedSelectors: string[] | undefined;
	private readonly elements: Record<string, RunningElement> = {};

	onDeclaration(declaration: csstree.Declaration, _dItem: csstree.ListItem<csstree.CssNode>, _dList: csstree.List<csstree.CssNode>, rule: RuleContext) {
		if (declaration.property === "position") {
			const selector = csstree.generate(rule.ruleNode.prelude);
			const identifier = ((declaration.value as csstree.Value).children.first() as csstree.Identifier).name;

			if (identifier === "running") {
				let value: string | undefined;
				csstree.walk(declaration, {
					visit: "Function",
					enter: (node) => {
						value = (node.children.first() as csstree.Identifier).name;
					}
				});

				this.runningSelectors[value] = {
					identifier: identifier,
					value: value,
					selector: selector
				};
			}
		}

		if (declaration.property === "content") {

			csstree.walk(declaration, {
				visit: "Function",
				enter: (funcNode) => {

					if (funcNode.name.indexOf("element") > -1) {

						const selector = csstree.generate(rule.ruleNode.prelude);

						const func = funcNode.name;

						const value = (funcNode.children.first() as csstree.Identifier).name;

						const args = [value];

						selector.split(",").forEach((s) => {
							// remove before / after
							s = s.replace(/::after|::before/, "");

							this.elements[s] = {
								func,
								args,
								value,
								style: "first",
								selector: s,
								fullSelector: selector
							};
						});
					}

				}
			});
		}
	}

	afterParsed(fragment: HTMLElement | DocumentFragment | undefined) {
		for (const name of Object.keys(this.runningSelectors)) {
			const set = this.runningSelectors[name];
			const selected = Array.from(fragment.querySelectorAll<HTMLElement>(set.selector));

			if (set.identifier === "running") {
				for (const header of selected) {
					header.style.display = "none";
				}
			}

		}
	}

	afterPageLayout(fragment: HTMLElement) {
		for (const name of Object.keys(this.runningSelectors)) {
			const set = this.runningSelectors[name];
			const selected = fragment.querySelector<HTMLElement>(set.selector);
			if (selected) {
				// let cssVar;
				if (set.identifier === "running") {
					// cssVar = selected.textContent.replace(/\\([\s\S])|(["|'])/g,"\\$1$2");
					// this.styleSheet.insertRule(`:root { --string-${name}: "${cssVar}"; }`, this.styleSheet.cssRules.length);
					// fragment.style.setProperty(`--string-${name}`, `"${cssVar}"`);
					set.first = selected;
				} else {
					console.warn(set.value + "needs css replacement");
				}
			}
		}

		// move elements
		if (!this.orderedSelectors) {
			this.orderedSelectors = this.orderSelectors(this.elements);
		}

		for (const selector of this.orderedSelectors) {
			if (selector) {

				const el = this.elements[selector];
				const selected = fragment.querySelector<HTMLElement>(selector);
				if (selected) {
					const running = this.runningSelectors[el.args[0]];
					if (running && running.first) {
						selected.innerHTML = ""; // Clear node
						// selected.classList.add("pagedjs_clear-after"); // Clear ::after
						const clone = running.first.cloneNode(true) as HTMLElement;
						clone.style.display = null;
						selected.appendChild(clone);
					}
				}
			}
		}
	}

	/**
	* Assign a weight to @page selector classes
	* 1) page
	* 2) left & right
	* 3) blank
	* 4) first & nth
	* 5) named page
	* 6) named left & right
	* 7) named first & nth
	* @param s selector string
	* @return weight
	*/
	private pageWeight(s: string): number {
		let weight = 1;
		const selector = s.split(" ");
		const parts = selector.length && selector[0].split(".");

		parts.shift(); // remove empty first part

		switch (parts.length) {
			case 4:
				if (/^pagedjs_[\w-]+_first_page$/.test(parts[3])) {
					weight = 7;
				} else if (parts[3] === "pagedjs_left_page" || parts[3] === "pagedjs_right_page") {
					weight = 6;
				}
				break;
			case 3:
				if (parts[1] === "pagedjs_named_page") {
					if (parts[2].indexOf(":nth-of-type") > -1) {
						weight = 7;
					} else {
						weight = 5;
					}
				}
				break;
			case 2:
				if (parts[1] === "pagedjs_first_page") {
					weight = 4;
				} else if (parts[1] === "pagedjs_blank_page") {
					weight = 3;
				} else if (parts[1] === "pagedjs_left_page" || parts[1] === "pagedjs_right_page") {
					weight = 2;
				}
				break;
			default:
				if (parts[0].indexOf(":nth-of-type") > -1) {
					weight = 4;
				} else {
					weight = 1;
				}
		}

		return weight;
	}

	/**
	* Orders the selectors based on weight
	*
	* Does not try to deduplicate base on specifity of the selector
	* Previous matched selector will just be overwritten
	* @param obj selectors object
	* @return orderedSelectors
	*/
	private orderSelectors(obj: Record<string, RunningElement>): string[] {
		const selectors = Object.keys(obj);
		const weighted = {
			1: [],
			2: [],
			3: [],
			4: [],
			5: [],
			6: [],
			7: []
		};

		for (const s of selectors) {
			const w = this.pageWeight(s);
			weighted[w].unshift(s);
		}

		let orderedSelectors = [];

		for (let i = 1; i <= 7; i++) {
			orderedSelectors = orderedSelectors.concat(weighted[i]);
		}

		return orderedSelectors;
	}

	beforeTreeParse(text: string, sheet: Sheet) {
		// element(x) is parsed as image element selector, so update element to element-ident
		sheet.text = text.replace(/element[\s]*\(([^|^#)]*)\)/g, "element-ident($1)");
	}
}

export default RunningHeaders;

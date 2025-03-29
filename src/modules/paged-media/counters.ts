import csstree from "css-tree";

import Handler from "../handler";
import type { HooksInterface } from "../handler";
import type Chunker from "../../chunker/chunker";
import type Polisher from "../../polisher/polisher";
import type { RuleContext } from "../../polisher/sheet";
import type { HandlerCaller, NoHooks } from "../../utils/handlers";

interface CounterChange {
	selector: string;
	number: string | number;
}

interface Counter {
	name: string;
	increments: Record<string, CounterChange>;
	resets: Record<string, CounterChange>;
}

class Counters extends Handler implements HooksInterface<Chunker["hooks"] & Polisher["hooks"]> {
	private readonly styleSheet: CSSStyleSheet;
	private readonly counters: Record<string, Counter> = {};
	private readonly resetCountersMap = new Map<string, string>();

	public constructor(chunker: Chunker, polisher: Polisher, caller: HandlerCaller<NoHooks>) {
		super(chunker, polisher, caller);

		this.styleSheet = polisher.styleSheet;
	}

	onDeclaration(declaration: csstree.Declaration, dItem: csstree.ListItem<csstree.CssNode>, dList: csstree.List<csstree.CssNode>, rule: RuleContext) {
		const property = declaration.property;

		if (property === "counter-increment") {
			this.handleIncrement(declaration, rule);
			// clean up empty declaration
			let hasProperities = false;
			(declaration.value as csstree.Value).children.forEach((data) => {
				if (data.type && data.type !== "WhiteSpace") {
					hasProperities = true;
				}
			});
			if (!hasProperities) {
				dList.remove(dItem);
			}
		} else if (property === "counter-reset") {
			this.handleReset(declaration, rule);
			// clean up empty declaration
			let hasProperities = false;
			(declaration.value as csstree.Value).children.forEach((data) => {
				if (data.type && data.type !== "WhiteSpace") {
					hasProperities = true;
				}
			});
			if (!hasProperities) {
				dList.remove(dItem);
			}
		}
	}

	afterParsed(parsed: HTMLElement | DocumentFragment) {
		this.processCounters(parsed, this.counters);
		this.scopeCounters(this.counters);
	}

	private addCounter(name: string) {
		if (name in this.counters) {
			return this.counters[name];
		}

		this.counters[name] = {
			name,
			increments: {},
			resets: {}
		};

		return this.counters[name];
	}

	private handleIncrement(declaration: csstree.Declaration, rule: RuleContext) {
		const increments: CounterChange[] = [];
		const children = (declaration.value as csstree.Value).children;

		children.forEach((data, item) => {
			if (data.type && data.type === "Identifier") {
				const name = data.name;

				if (name === "page" || name.indexOf("target-counter-") === 0) {
					return;
				}

				let whitespace: csstree.ListItem<csstree.CssNode> | undefined;
				if (item.next && item.next.data.type === "WhiteSpace") {
					whitespace = item.next;
				}

				let number: csstree.ListItem<csstree.NumberNode> | undefined;
				let value: number | undefined;
				if (whitespace && whitespace.next && whitespace.next.data.type === "Number") {
					number = whitespace.next as csstree.ListItem<csstree.NumberNode>;
					value = parseInt(number.data.value);
				}

				const selector = csstree.generate(rule.ruleNode.prelude);

				let counter: Counter | undefined;
				if (!(name in this.counters)) {
					counter = this.addCounter(name);
				} else {
					counter = this.counters[name];
				}
				const increment = {
					selector: selector,
					number: value || 1
				};
				counter.increments[selector] = increment;
				increments.push(increment);

				// Remove the parsed resets
				children.remove(item);
				if (whitespace) {
					children.remove(whitespace);
				}
				if (number) {
					children.remove(number);
				}
			}
		});

		return increments;
	}

	private handleReset(declaration: csstree.Declaration, rule: RuleContext) {
		const children = (declaration.value as csstree.Value).children;

		children.forEach((data, item) => {
			if (data.type && data.type === "Identifier") {
				const name = data.name;
				let whitespace: csstree.ListItem<csstree.CssNode> | undefined;
				if (item.next && item.next.data.type === "WhiteSpace") {
					whitespace = item.next;
				}

				let number: csstree.ListItem<csstree.CssNode> | undefined;
				let value: string | number | undefined;
				if (whitespace && whitespace.next) {
					if (whitespace.next.data.type === "Number") {
						// The counter reset value is specified using a number. E.g. counter-reset: c2 5;
						number = whitespace.next;
						value = parseInt((number.data as csstree.NumberNode).value);
					} else if (whitespace.next.data.type === "Function" && whitespace.next.data.name === "var") {
						// The counter reset value is specified using a CSS variable (custom property).
						// E.g. counter-reset: c2 var(--my-variable);
						// See https://developer.mozilla.org/en-US/docs/Web/CSS/var
						number = whitespace.next;
						// Use the variable name (e.g. '--my-variable') as value for now. The actual value is resolved later by the
						// processCounterResets function.
						// TODO: this used children.head, which doesn't exist.
						value = (whitespace.next.data.children.first() as csstree.Identifier).name;
					}
				}

				const prelude = rule.ruleNode.prelude;

				let selector: string | undefined;
				if (rule.ruleNode.type === "Atrule" && rule.ruleNode.name === "page") {
					selector = ".pagedjs_page";
				} else {
					selector = csstree.generate(prelude || rule.ruleNode);
				}

				if (name === "footnote") {
					this.addFootnoteMarkerCounter((declaration.value as csstree.Value).children);
				}

				let counter: Counter | undefined;
				if (!(name in this.counters)) {
					counter = this.addCounter(name);
				} else {
					counter = this.counters[name];
				}

				const reset = {
					selector: selector,
					number: value || 0
				};

				counter.resets[selector] = reset;

				if (selector !== ".pagedjs_page") {
					// Remove the parsed resets
					children.remove(item);
					if (whitespace) {
						children.remove(whitespace);
					}
					if (number) {
						children.remove(number);
					}
				}
			}
		});
	}

	private processCounters(parsed: HTMLElement | DocumentFragment, counters: Record<string, Counter>) {
		for (const c in counters) {
			const counter = this.counters[c];
			this.processCounterIncrements(parsed, counter);
			this.processCounterResets(parsed, counter);
			if (c !== "page") {
				this.addCounterValues(parsed, counter);
			}
		}
	}

	private scopeCounters(counters: Record<string, Counter>) {
		const countersArray = [];
		for (const c in counters) {
			if (c !== "page") {
				countersArray.push(`${counters[c].name} 0`);
			}
		}
		// Add to pages to allow cross page scope
		this.insertRule(`.pagedjs_pages { counter-reset: ${countersArray.join(" ")} page 0 pages var(--pagedjs-page-count) footnote var(--pagedjs-footnotes-count) footnote-marker var(--pagedjs-footnotes-count)}`);
	}

	private insertRule(rule: string) {
		this.styleSheet.insertRule(rule, this.styleSheet.cssRules.length);
	}

	private processCounterIncrements(parsed: HTMLElement | DocumentFragment, counter: Counter) {
		for (const increment of Object.values(counter.increments)) {
			// Find elements for increments
			const incrementElements = parsed.querySelectorAll(increment.selector);
			// Add counter data
			for (let i = 0; i < incrementElements.length; i++) {
				incrementElements[i].setAttribute("data-counter-"+ counter.name +"-increment", String(increment.number));
				if (incrementElements[i].getAttribute("data-counter-increment")) {
					incrementElements[i].setAttribute("data-counter-increment", incrementElements[i].getAttribute("data-counter-increment") + " " + counter.name);
				} else {
					incrementElements[i].setAttribute("data-counter-increment", counter.name);
				}
			}
		}
	}

	private processCounterResets(parsed: HTMLElement | DocumentFragment, counter: Counter) {
		for (const reset of Object.values(counter.resets)) {
			// Find elements for resets
			const resetElements = parsed.querySelectorAll<HTMLElement>(reset.selector);
			// Add counter data
			for (let i = 0; i < resetElements.length; i++) {
				let value = reset.number;
				if (typeof value === "string" && value.startsWith("--")) {
					// The value is specified using a CSS variable (custom property).
					// FIXME: We get the variable value only from the inline style of the element because at this point the
					// element is detached and thus using:
					//
					//		getComputedStyle(resetElements[i]).getPropertyValue(value)
					//
					// always returns an empty string. We could try to temporarily attach the element to get its computed style,
					// but for now using the inline style is enough for us.
					value = resetElements[i].style.getPropertyValue(value) || 0;
				}
				resetElements[i].setAttribute("data-counter-"+ counter.name +"-reset", String(value));
				if (resetElements[i].getAttribute("data-counter-reset")) {
					resetElements[i].setAttribute("data-counter-reset", resetElements[i].getAttribute("data-counter-reset") + " " + counter.name);
				} else {
					resetElements[i].setAttribute("data-counter-reset", counter.name);
				}
			}
		}
	}

	private addCounterValues(parsed: HTMLElement | DocumentFragment, counter: Counter) {
		const counterName = counter.name;

		if (counterName === "page" || counterName === "footnote") {
			return;
		}

		const elements = parsed.querySelectorAll<HTMLElement>("[data-counter-"+ counterName +"-reset], [data-counter-"+ counterName +"-increment]");
		let count = 0;

		for (const element of elements) {
			const incrementArray = [];

			if (element.hasAttribute("data-counter-"+ counterName +"-reset")) {
				const reset = element.getAttribute("data-counter-"+ counterName +"-reset");
				const resetValue = parseInt(reset);

				// Use negative increment value inplace of reset
				const resetDelta = resetValue - count;
				incrementArray.push(`${counterName} ${resetDelta}`);

				count = resetValue;
			}

			if (element.hasAttribute("data-counter-"+ counterName +"-increment")) {

				const increment = element.getAttribute("data-counter-"+ counterName +"-increment");
				const incrementValue = parseInt(increment);

				count += incrementValue;

				element.setAttribute("data-counter-"+counterName+"-value", String(count));

				incrementArray.push(`${counterName} ${incrementValue}`);
			}

			if (incrementArray.length > 0) {
				this.incrementCounterForElement(element, incrementArray);
			}

		}
	}

	private addFootnoteMarkerCounter(list: csstree.List<csstree.CssNode>) {
		const markers = [];
		// TODO: this was trying to walk `list` directly`.
		list.forEach(node => csstree.walk(node, {
			visit: "Identifier",
			enter: (identNode) => {
				markers.push(identNode.name);
			}
		}));

		// Already added
		// TODO: this had a spelling error: "footnote-maker"
		if (markers.includes("footnote-marker")) {
			return;
		}

		list.insertData({
			type: "WhiteSpace",
			value: " "
		} satisfies csstree.WhiteSpace);

		list.insertData({
			type: "Identifier",
			name: "footnote-marker"
		} satisfies csstree.Identifier);

		list.insertData({
			type: "WhiteSpace",
			value: " "
		} satisfies csstree.WhiteSpace);

		list.insertData({
			type: "Number",
			// TODO: this was a number.
			value: "0"
		} satisfies csstree.NumberNode);
	}

	private incrementCounterForElement(element: HTMLElement, incrementArray: string[]) {
		if (!element || !incrementArray || incrementArray.length === 0) return;

		const ref = element.dataset.ref;
		const increments = Array.from(this.styleSheet.cssRules).filter((rule: CSSStyleRule) => {
			return rule.selectorText === `[data-ref="${element.dataset.ref}"]:not([data-split-from])`
						 && rule.style[0] === "counter-increment";
		}).map((rule: CSSStyleRule) => rule.style.counterIncrement);

		// Merge the current increments by summing the values because we generate both a decrement and an increment when the
		// element resets and increments the counter at the same time. E.g. ['c1 -7', 'c1 1'] should lead to 'c1 -6'.
		increments.push(this.mergeIncrements(
			incrementArray,
			(prev, next) => String((parseInt(prev) || 0) + (parseInt(next) || 0))));

		// Keep the last value for each counter when merging with the previous increments. E.g. ['c1 -7 c2 3', 'c1 1']
		// should lead to 'c1 1 c2 3'.
		const counterIncrement = this.mergeIncrements(increments, (prev, next) => next);
		this.insertRule(`[data-ref="${ref}"]:not([data-split-from]) { counter-increment: ${counterIncrement} }`);
	}

	/**
	 * Merge multiple values of a counter-increment CSS rule, using the specified operator.
	 *
	 * @param incrementArray the values to merge, e.g. ['c1 1', 'c1 -7 c2 1']
	 * @param operator the function used to merge counter values (e.g. keep the last value of a counter or sum
	 *					the counter values)
	 * @return the merged value of the counter-increment CSS rule
	 */
	private mergeIncrements(incrementArray: string[], operator: (a: string, b: string) => string) {
		const increments: Record<string, string> = {};
		incrementArray.forEach(increment => {
			const values = increment.split(" ");
			for (let i = 0; i < values.length; i+=2) {
				increments[values[i]] = operator(increments[values[i]], values[i + 1]);
			}
		});

		return Object.entries(increments).map(([key, value]) => `${key} ${value}`).join(" ");
	}

	afterPageLayout(pageElement: HTMLElement) {
		const resets: string[] = [];

		const pgreset = pageElement.querySelectorAll<HTMLElement>("[data-counter-page-reset]:not([data-split-from])");
		pgreset.forEach((reset) => {
			const ref = reset.dataset && reset.dataset.ref;
			if (ref && this.resetCountersMap.has(ref)) {
				// ignoring, the counter-reset directive has already been taken into account.
			} else {
				if (ref) {
					this.resetCountersMap.set(ref, "");
				}
				const value = reset.dataset.counterPageReset;
				resets.push(`page ${value}`);
			}
		});

		const notereset = pageElement.querySelectorAll<HTMLElement>("[data-counter-footnote-reset]:not([data-split-from])");
		notereset.forEach((reset) => {
			const value = reset.dataset.counterFootnoteReset;
			resets.push(`footnote ${value}`);
			resets.push(`footnote-marker ${value}`);
		});

		if (resets.length) {
			this.styleSheet.insertRule(`[data-page-number="${pageElement.dataset.pageNumber}"] { counter-increment: none; counter-reset: ${resets.join(" ")} }`, this.styleSheet.cssRules.length);
		}
	}

}

export default Counters;

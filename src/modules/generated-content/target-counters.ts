import csstree from "css-tree";

import Handler from "../handler";
import type { HooksInterface } from "../handler";
import type BreakToken from "../../chunker/breaktoken";
import type Chunker from "../../chunker/chunker";
import type Page from "../../chunker/page";
import type Polisher from "../../polisher/polisher";
import type { RuleContext } from "../../polisher/sheet";
import {attr, querySelectorEscape, UUID} from "../../utils/utils";
import type { HandlerCaller, NoHooks } from "../../utils/handlers";

interface CounterTarget {
	func: string;
	args: string[];
	value: string;
	counter: string;
	style: string;
	selector: string;
	fullSelector: string;
	variable: string;
}

class TargetCounters extends Handler implements HooksInterface<Chunker["hooks"] & Polisher["hooks"]> {
	private readonly styleSheet: CSSStyleSheet;
	private readonly counterTargets: Record<string, CounterTarget> = {};

	public constructor(chunker: Chunker, polisher: Polisher, caller: HandlerCaller<NoHooks>) {
		super(chunker, polisher, caller);

		this.styleSheet = polisher.styleSheet;
	}

	onContent(funcNode: csstree.FunctionNode, _fItem: csstree.ListItem<csstree.CssNode>, _fList: csstree.List<csstree.CssNode>, _declaration: {} & object, rule: RuleContext) {
		if (funcNode.name === "target-counter") {
			const selector = csstree.generate(rule.ruleNode.prelude);

			// TODO: is this the right type?
			const first = funcNode.children.first() as csstree.FunctionNode;
			const func = first.name;

			const value = csstree.generate(funcNode);

			const args: string[] = [];

			first.children.forEach((child) => {
				if (child.type === "Identifier") {

					args.push(child.name);
				}
			});

			let counter: string | undefined;
			let style: string | undefined;
			let styleIdentifier: csstree.Identifier | undefined;

			funcNode.children.forEach((child) => {
				if (child.type === "Identifier") {
					if (!counter) {
						counter = child.name;
					} else if (!style) {
						styleIdentifier = csstree.clone(child) as csstree.Identifier;
						style = child.name;
					}
				}
			});

			const variable = "target-counter-" + UUID();

			selector.split(",").forEach((s) => {
				this.counterTargets[s] = {
					func: func,
					args: args,
					value: value,
					counter: counter,
					style: style,
					selector: s,
					fullSelector: selector,
					variable: variable
				};
			});

			// Replace with counter
			funcNode.name = "counter";
			funcNode.children = new csstree.List();
			funcNode.children.appendData({
				type: "Identifier",
				name: variable
			});

			if (styleIdentifier) {
				funcNode.children.appendData({type: "Operator", loc: null, value: ","});
				funcNode.children.appendData(styleIdentifier);
			}
		}
	}

	afterPageLayout(_fragment: HTMLElement, _page: Page, _breakToken: BreakToken | undefined, chunker: Chunker) {
		Object.keys(this.counterTargets).forEach((name) => {
			const target = this.counterTargets[name];
			const split = target.selector.split(/::?/g);
			const query = split[0];

			const queried = chunker.pagesArea.querySelectorAll(query + ":not([data-" + target.variable + "])");

			queried.forEach((selected) => {
				// TODO: handle func other than attr
				if (target.func !== "attr") {
					return;
				}
				const val = attr(selected, target.args);
				const element = chunker.pagesArea.querySelector(querySelectorEscape(val));

				if (element) {
					const selector = UUID();
					selected.setAttribute("data-" + target.variable, selector);
					// TODO: handle other counter types (by query)
					let pseudo = "";
					if (split.length > 1) {
						pseudo += "::" + split[1];
					}
					if (target.counter === "page") {
						const pages = chunker.pagesArea.querySelectorAll(".pagedjs_page");
						let pg = 0;
						for (let i = 0; i < pages.length; i++) {
							const page = pages[i];
							const styles = window.getComputedStyle(page);
							const reset = styles["counter-reset"].replace("page", "").trim();
							const increment = styles["counter-increment"].replace("page", "").trim();

							if (reset !== "none") {
								pg = parseInt(reset);
							}
							if (increment !== "none") {
								pg += parseInt(increment);
							}

							if (page.contains(element)){
								break;
							}
						}
						this.styleSheet.insertRule(`[data-${target.variable}="${selector}"]${pseudo} { counter-reset: ${target.variable} ${pg}; }`, this.styleSheet.cssRules.length);
					} else {
						const value = element.getAttribute(`data-counter-${target.counter}-value`);
						if (value) {
							this.styleSheet.insertRule(`[data-${target.variable}="${selector}"]${pseudo} { counter-reset: ${target.variable} ${target.variable} ${parseInt(value)}; }`, this.styleSheet.cssRules.length);
						}
					}

					// force redraw
					const el = document.querySelector<HTMLElement>(`[data-${target.variable}="${selector}"]`);
					if (el) {
						el.style.display = "none";
						el.style.removeProperty("display");
					}
				}
			});
		});
	}
}

export default TargetCounters;

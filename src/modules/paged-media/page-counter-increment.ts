import csstree from "css-tree";

import Handler from "../handler";
import type { HooksInterface } from "../handler";
import type Chunker from "../../chunker/chunker";
import type Polisher from "../../polisher/polisher";
import type { RuleContext } from "../../polisher/sheet";
import type { HandlerCaller, NoHooks } from "../../utils/handlers";

interface Increment {
	selector: string;
	number: number;
}

class PageCounterIncrement extends Handler implements HooksInterface<Chunker["hooks"] & Polisher["hooks"]> {
	private readonly styleSheet: CSSStyleSheet;
	private readonly pageCounter = {
		name: "page",
		increments: {} as Record<string, Increment>,
	};

	public constructor(chunker: Chunker, polisher: Polisher, caller: HandlerCaller<NoHooks>) {
		super(chunker, polisher, caller);

		this.styleSheet = polisher.styleSheet;
	}

	onDeclaration(declaration: csstree.Declaration, dItem: csstree.ListItem<csstree.CssNode>, dList: csstree.List<csstree.CssNode>, rule: RuleContext) {
		const property = declaration.property;

		if (property === "counter-increment") {
			const inc = this.handleIncrement(declaration, rule);
			if (inc) {
				dList.remove(dItem);
			}
		}
	}

	afterParsed() {
		for (const inc in this.pageCounter.increments) {
			const increment = this.pageCounter.increments[inc];
			this.insertRule(`${increment.selector} { --pagedjs-page-counter-increment: ${increment.number} }`);
		}
	}

	handleIncrement(declaration: csstree.Declaration, rule: RuleContext) {
		const value = declaration.value as csstree.Value;
		const identifier = value.children.first() as csstree.Identifier;
		const number = value.children.getSize() > 1 ? parseInt((value.children.last() as csstree.NumberNode).value) : 1;
		const name = identifier?.name;

		if (name && name.indexOf("target-counter-") === 0) {
			return;
		}
		// A counter named page is automatically created and incremented by 1 on every page of the document,
		// unless the counter-increment property in the page context explicitly specifies a different increment for the page counter.
		// https://www.w3.org/TR/css-page-3/#page-based-counters
		if (name !== "page") {
			return;
		}
		// the counter-increment property is not defined on the page context (i.e. @page rule), ignoring...
		if (rule.ruleNode.type === "Atrule" && rule.ruleNode.name === "page") {
			return;
		}
		const selector = csstree.generate(rule.ruleNode.prelude);
		return this.pageCounter.increments[selector] = {
			selector,
			number
		};
	}

	private insertRule(rule: string) {
		this.styleSheet.insertRule(rule, this.styleSheet.cssRules.length);
	}
}

export default PageCounterIncrement;

import csstree from "css-tree";

import Handler from "../handler";
import type { HooksInterface } from "../handler";
import type Chunker from "../../chunker/chunker";
import type Polisher from "../../polisher/polisher";
import type { HandlerCaller, NoHooks } from "../../utils/handlers";
import {UUID} from "../../utils/utils";

class NthOfType extends Handler implements HooksInterface<Chunker["hooks"] & Polisher["hooks"]> {
	private readonly styleSheet: CSSStyleSheet;
	private readonly selectors: Record<string, [string, string]> = {};

	public constructor(chunker: Chunker, polisher: Polisher, caller: HandlerCaller<NoHooks>) {
		super(chunker, polisher, caller);

		this.styleSheet = polisher.styleSheet;
	}

	onRule(ruleNode: csstree.Rule, ruleItem: csstree.ListItem<csstree.CssNode>, rulelist: csstree.List<csstree.CssNode>) {
		const selector = csstree.generate(ruleNode.prelude);
		if (selector.match(/:(first|last|nth)-of-type/)) {
			const declarations = csstree.generate(ruleNode.block).replace(/[{}]/g,"");
			const uuid = "nth-of-type-" + UUID();

			selector.split(",").forEach((s) => {
				if (!this.selectors[s]) {
					this.selectors[s] = [uuid, declarations];
				} else {
					this.selectors[s][1] = `${this.selectors[s][1]};${declarations}` ;
				}
			});

			rulelist.remove(ruleItem);
		}
	}

	afterParsed(parsed: HTMLElement | DocumentFragment) {
		this.processSelectors(parsed, this.selectors);
	}

	processSelectors(parsed: HTMLElement | DocumentFragment, selectors: NthOfType["selectors"]) {
		// add the new attributes to matching elements
		for (const s in selectors) {
			const elements = parsed.querySelectorAll(s);

			for (let i = 0; i < elements.length; i++) {
				let dataNthOfType = elements[i].getAttribute("data-nth-of-type");

				if (dataNthOfType && dataNthOfType != "") {
					dataNthOfType = `${dataNthOfType},${selectors[s][0]}`;
					elements[i].setAttribute("data-nth-of-type", dataNthOfType);
				} else {
					elements[i].setAttribute("data-nth-of-type", selectors[s][0]);
				}
			}

			const rule = `*[data-nth-of-type*='${selectors[s][0]}'] { ${selectors[s][1]}; }`;
			this.styleSheet.insertRule(rule, this.styleSheet.cssRules.length);
		}
	}
}




export default NthOfType;

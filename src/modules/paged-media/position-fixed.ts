import csstree from "css-tree";

import Handler from "../handler";
import type { HooksInterface } from "../handler";
import type Chunker from "../../chunker/chunker";
import type Polisher from "../../polisher/polisher";
import type { RuleContext } from "../../polisher/sheet";

class PositionFixed extends Handler implements HooksInterface<Chunker["hooks"] & Polisher["hooks"]> {
	private readonly fixedElementsSelector: string[] = [];
	private readonly fixedElements: HTMLElement[] = [];

	onDeclaration(declaration: csstree.Declaration, dItem: csstree.ListItem<csstree.CssNode>, dList: csstree.List<csstree.CssNode>, rule: RuleContext) {
		if (declaration.property === "position" && ((declaration.value as csstree.Value).children.first() as csstree.Identifier).name === "fixed") {
			const selector = csstree.generate(rule.ruleNode.prelude);
			this.fixedElementsSelector.push(selector);
			dList.remove(dItem);
		}
	}

	afterParsed(fragment: HTMLElement | DocumentFragment) {
		this.fixedElementsSelector.forEach(fixedEl => {
			fragment.querySelectorAll<HTMLElement>(`${fixedEl}`).forEach(el => {
				el.style.setProperty("position", "absolute");
				this.fixedElements.push(el);
				el.remove();
			});
		});
	}

	afterPageLayout(pageElement: HTMLElement) {
		this.fixedElements.forEach(el => {
			const clone = el.cloneNode(true) as HTMLElement;
			pageElement.querySelector(".pagedjs_pagebox").insertAdjacentElement("afterbegin", clone);
		});
	}
}





export default PositionFixed;

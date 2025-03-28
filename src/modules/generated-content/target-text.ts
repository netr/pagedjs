import csstree from "css-tree";

import Handler from "../handler";
import type { HooksInterface } from "../handler";
import type Chunker from "../../chunker/chunker";
import type Polisher from "../../polisher/polisher";
import type { RuleContext } from "../../polisher/sheet";
import { cleanPseudoContent } from "../../utils/css";
import type { HandlerCaller, NoHooks } from "../../utils/handlers";
import { UUID, attr, querySelectorEscape } from "../../utils/utils";

interface TextTarget {
	func: string;
	args: string[];
	value: string;
	style: string;
	selector: string;
	fullSelector: string;
	variable: string;
}

class TargetText extends Handler implements HooksInterface<Chunker["hooks"] & Polisher["hooks"]> {
	private readonly styleSheet: CSSStyleSheet;
	private readonly textTargets: Record<string, TextTarget> = {};
	private beforeContent = "";
	private afterContent = "";
	// TODO: this was initialized with {}, though it's used as a string.
	private selector = "";

	public constructor(chunker: Chunker, polisher: Polisher, caller: HandlerCaller<NoHooks>) {
		super(chunker, polisher, caller);

		this.styleSheet = polisher.styleSheet;
	}

	onContent(funcNode: csstree.FunctionNode, _fItem: csstree.ListItem<csstree.CssNode>, _fList: csstree.List<csstree.CssNode>, _declaration: {} & object, rule: RuleContext) {
		if (funcNode.name === "target-text") {
			this.selector = csstree.generate(rule.ruleNode.prelude);

			// TODO: is this the right type?
			const first = funcNode.children.first() as csstree.FunctionNode;
			const last = funcNode.children.last() as csstree.FunctionNode;
			const func = first.name;

			const value = csstree.generate(funcNode);

			const args: string[] = [];

			first.children.forEach(child => {
				if (child.type === "Identifier") {
					args.push(child.name);
				}
			});

			let style: string | undefined;
			if (last !== first) {
				style = last.name;
			}

			const variable = "--pagedjs-" + UUID();

			this.selector.split(",").forEach(s => {
				this.textTargets[s] = {
					func: func,
					args: args,
					value: value,
					style: style || "content",
					selector: s,
					fullSelector: this.selector,
					variable: variable
				};
			});

			// Replace with variable
			funcNode.name = "var";
			funcNode.children = new csstree.List();
			funcNode.children.appendData({
				type: "Identifier",
				name: variable
			});
		}
	}

	//   parse this on the ONCONTENT : get all before and after and replace the value with a variable
	onPseudoSelector(pseudoNode: csstree.PseudoElementSelector, _pItem: csstree.ListItem<csstree.CssNode>, _pList: csstree.List<csstree.CssNode>, _selector: {} & object, rule: RuleContext) {
		// console.log(pseudoNode);
		// console.log(rule);

		rule.ruleNode.block.children.forEach((properties: csstree.Declaration) => {
			if (pseudoNode.name === "before" && properties.property === "content") {
				// let beforeVariable = "--pagedjs-" + UUID();

				const contenu = (properties.value as csstree.Value).children;
				contenu.forEach(prop => {
					if (prop.type === "String") {
						this.beforeContent = prop.value;
					}
				});
			} else if (pseudoNode.name === "after" && properties.property === "content") {
				(properties.value as csstree.Value).children.forEach(prop => {
					if (prop.type === "String") {
						this.afterContent = prop.value;
					}
				});
			}
		});
	}

	afterParsed(fragment: HTMLElement) {
		Object.keys(this.textTargets).forEach(name => {
			const target = this.textTargets[name];
			const split = target.selector.split(/::?/g);
			const query = split[0];
			const queried = fragment.querySelectorAll<HTMLElement>(query);
			let textContent: string | undefined;
			queried.forEach((selected) => {
				const val = attr(selected, target.args);
				const element = fragment.querySelector(querySelectorEscape(val));
				if (element) {
					// content & first-letter & before & after refactorized
					if (target.style) {
						this.selector = UUID();
						selected.setAttribute("data-target-text", this.selector);

						let psuedo = "";
						if (split.length > 1) {
							psuedo += "::" + split[1];
						}

						if (target.style === "before" || target.style === "after") {
							const pseudoType = `${target.style}Content`;
							textContent = cleanPseudoContent(this[pseudoType]);
						} else {
							textContent = cleanPseudoContent(element.textContent, " ");
						}
						textContent = target.style === "first-letter" ? textContent.charAt(0) : textContent;
						this.styleSheet.insertRule(`[data-target-text="${this.selector}"]${psuedo} { ${target.variable}: "${textContent}" }`);
					} else {
						console.warn("missed target", val);
					}
				}
			});
		});
	}
}

export default TargetText;

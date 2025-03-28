import csstree from "css-tree";

import Handler from "../handler";
import type { HooksInterface } from "../handler";
import type Chunker from "../../chunker/chunker";
import type Polisher from "../../polisher/polisher";
import type { RuleContext } from "../../polisher/sheet";
import { cleanPseudoContent } from "../../utils/css";

interface StringSetSelector {
	identifier: string;
	func: string;
	value: string;
	selector: string;
}

class StringSets extends Handler implements HooksInterface<Chunker["hooks"] & Polisher["hooks"]> {
	private readonly stringSetSelectors: Record<string, StringSetSelector> = {};
	private type: string | undefined;
	// pageLastString = last string variable defined on the page
	private pageLastString: Record<string, string> | undefined;

	onDeclaration(declaration: csstree.Declaration, dItem: csstree.ListItem<csstree.CssNode>, dList: csstree.List<csstree.CssNode>, rule: RuleContext) {
		if (declaration.property === "string-set") {
			const selector = csstree.generate(rule.ruleNode.prelude);

			const identifiers: string[] = [];
			const functions: string[] = [];
			const values: string[] = [];

			(declaration.value as csstree.Value).children.forEach((child) => {
				if (child.type === "Identifier") {
					identifiers.push(child.name);
				}
				if (child.type === "Function") {
					functions.push(child.name);
					child.children.forEach((subchild) => {
						if (subchild.type === "Identifier") {
							values.push(subchild.name);
						}
					});
				}
			});

			identifiers.forEach((identifier, index) => {
				const func = functions[index];
				const value = values[index];
				this.stringSetSelectors[identifier] = {
					identifier,
					func,
					value,
					selector
				};
			});

		}
	}

	onContent(funcNode: csstree.FunctionNode) {

		if (funcNode.name === "string") {
			const identifier = funcNode.children && (funcNode.children.first() as csstree.Identifier).name;
			this.type = (funcNode.children.last() as csstree.Identifier).name;
			funcNode.name = "var";
			funcNode.children = new csstree.List();


			if(this.type === "first" || this.type === "last" || this.type === "start" || this.type === "first-except"){
				funcNode.children.append(
					funcNode.children.createItem({
						type: "Identifier",
						loc: null,
						name: "--pagedjs-string-" + this.type + "-" + identifier
					})
				);
			}else{
				funcNode.children.append(
					funcNode.children.createItem({
						type: "Identifier",
						loc: null,
						name: "--pagedjs-string-first-" + identifier
					})
				);
			}
		}
	}

	afterPageLayout(fragment: HTMLElement) {


		if ( this.pageLastString === undefined )
		{
			this.pageLastString = {};
		}


		for (const name of Object.keys(this.stringSetSelectors)) {

			const set = this.stringSetSelectors[name];
			const value = set.value;
			const func = set.func;
			const selected = fragment.querySelectorAll(set.selector);

			// Get the last found string for the current identifier
			const stringPrevPage = ( name in this.pageLastString ) ? this.pageLastString[name] : "";

			let varFirst: string | undefined;
			let varLast: string | undefined;
			let varStart: string | undefined;
			let varFirstExcept: string | undefined;

			if(selected.length === 0){
				// if there is no sel. on the page
				varFirst = stringPrevPage;
				varLast = stringPrevPage;
				varStart = stringPrevPage;
				varFirstExcept = stringPrevPage;
			}else{

				// TODO: this is not using the iteration variable. Is that right?
				selected.forEach(() => {
					// push each content into the array to define in the variable the first and the last element of the page.
					if (func === "content") {
						this.pageLastString[name] = selected[selected.length - 1].textContent;
					}

					if (func === "attr") {
						this.pageLastString[name] = selected[selected.length - 1].getAttribute(value) || "";
					}

				});

				/* FIRST */

				if (func === "content") {
					varFirst = selected[0].textContent;
				}

				if (func === "attr") {
					varFirst = selected[0].getAttribute(value) || "";
				}


				/* LAST */

				if (func === "content") {
					varLast = selected[selected.length - 1].textContent;
				}

				if (func === "attr") {
					varLast = selected[selected.length - 1].getAttribute(value) || "";
				}


				/* START */

				// Hack to find if the sel. is the first elem of the page / find a better way
				const selTop = selected[0].getBoundingClientRect().top;
				const pageContent = selected[0].closest(".pagedjs_page_content");
				const pageContentTop = pageContent.getBoundingClientRect().top;

				if(selTop === pageContentTop){
					varStart = varFirst;
				}else{
					varStart = stringPrevPage;
				}

				/* FIRST EXCEPT */

				varFirstExcept = "";

			}

			fragment.style.setProperty(`--pagedjs-string-first-${name}`, `"${cleanPseudoContent(varFirst)}"`);
			fragment.style.setProperty(`--pagedjs-string-last-${name}`, `"${cleanPseudoContent(varLast)}"`);
			fragment.style.setProperty(`--pagedjs-string-start-${name}`, `"${cleanPseudoContent(varStart)}"`);
			fragment.style.setProperty(`--pagedjs-string-first-except-${name}`, `"${cleanPseudoContent(varFirstExcept)}"`);


		}
	}


}



export default StringSets;

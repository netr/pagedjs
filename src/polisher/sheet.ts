import csstree from "css-tree";
import type {
	Atrule,
	AttributeSelector,
	CssNode,
	Declaration,
	FunctionNode,
	Identifier,
	List,
	ListItem,
	PseudoElementSelector,
	Rule,
	Selector,
	StyleSheet,
	Value,
	Url,
} from "css-tree";
import { UUID } from "../utils/utils";
import Hook from "../utils/hook";

export interface RuleContext {
	ruleNode: Atrule | Rule;
	ruleItem: ListItem<CssNode>;
	rulelist: List<CssNode>;
}

export type SheetHooks = {
	onUrl: Hook<[Url, ListItem<CssNode>, List<CssNode>]>,
	onAtPage: Hook<[Atrule, ListItem<CssNode>, List<CssNode>]>,
	onAtMedia: Hook<[Atrule, ListItem<CssNode>, List<CssNode>]>,
	onRule: Hook<[Rule, ListItem<CssNode>, List<CssNode>]>,
	onDeclaration: Hook<[Declaration, ListItem<CssNode>, List<CssNode>, RuleContext]>,
	onContent: Hook<[FunctionNode, ListItem<CssNode>, List<CssNode>, { declarationNode: Declaration, dItem: ListItem<CssNode>, dList: List<CssNode> }, RuleContext]>,
	onSelector: Hook<[Selector, ListItem<CssNode>, List<CssNode>, RuleContext]>,
	onPseudoSelector: Hook<[PseudoElementSelector, ListItem<CssNode>, List<CssNode>, { selectNode: Selector, selectItem: ListItem<CssNode>, selectList: List<CssNode> }, RuleContext]>,
	onImport: Hook<[Atrule, ListItem<CssNode>, List<CssNode>]>,
	beforeTreeParse: Hook<[string, Sheet]>,
	beforeTreeWalk: Hook<[StyleSheet]>,
	afterTreeWalk: Hook<[StyleSheet, Sheet]>,
};

class Sheet {
	private readonly hooks: SheetHooks;
	private readonly url: URL;
	private _text?: string;
	private ast?: StyleSheet;
	private id?: string;

	public imported?: string[];

	// TODO: these seem unused and the type is uncertain.
	public width?: string | number;
	public height?: string | number;
	public orientation?: string | number;

	public constructor(url: string, hooks?: SheetHooks) {

		if (hooks) {
			this.hooks = hooks;
		} else {
			this.hooks = {
				onUrl: new Hook(this),
				onAtPage: new Hook(this),
				onAtMedia: new Hook(this),
				onRule: new Hook(this),
				onDeclaration: new Hook(this),
				onSelector: new Hook(this),
				onPseudoSelector: new Hook(this),

				onContent: new Hook(this),
				onImport: new Hook(this),

				beforeTreeParse: new Hook(this),
				beforeTreeWalk: new Hook(this),
				afterTreeWalk: new Hook(this),
			};
		}

		try {
			this.url = new URL(url, window.location.href);
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
		} catch (_e) {
			this.url = new URL(window.location.href);
		}
	}



	// parse
	public async parse(text: string) {
		this.text = text;

		await this.hooks.beforeTreeParse.trigger(this.text, this);

		// send to csstree
		this.ast = csstree.parse(this._text) as StyleSheet;

		await this.hooks.beforeTreeWalk.trigger(this.ast);

		// Replace urls
		this.replaceUrls(this.ast);

		// Scope
		this.id = UUID();
		// this.addScope(this.ast, this.uuid);

		// Replace IDs with data-id
		this.replaceIds(this.ast);

		this.imported = [];

		// Trigger Hooks
		this.urls(this.ast);
		this.rules(this.ast);
		this.atrules(this.ast);

		await this.hooks.afterTreeWalk.trigger(this.ast, this);

		// return ast
		return this.ast;
	}



	public insertRule(rule: Rule) {
		const inserted = this.ast.children.appendData(rule);

		this.declarations(rule);

		return inserted;
	}

	private urls(ast: CssNode) {
		csstree.walk(ast, {
			visit: "Url",
			enter: (node, item, list) => {
				this.hooks.onUrl.trigger(node, item, list);
			}
		});
	}

	private atrules(ast: CssNode) {
		csstree.walk(ast, {
			visit: "Atrule",
			enter: (node, item, list) => {
				const basename = csstree.keyword(node.name).basename;

				if (basename === "page") {
					this.hooks.onAtPage.trigger(node, item, list);
					this.declarations(node, item, list);
				}

				if (basename === "media") {
					this.hooks.onAtMedia.trigger(node, item, list);
					this.declarations(node, item, list);
				}

				if (basename === "import") {
					this.hooks.onImport.trigger(node, item, list);
					this.imports(node, item, list);
				}
			}
		});
	}


	private rules(ast: CssNode) {
		csstree.walk(ast, {
			visit: "Rule",
			enter: (ruleNode, ruleItem, rulelist) => {

				this.hooks.onRule.trigger(ruleNode, ruleItem, rulelist);
				this.declarations(ruleNode, ruleItem, rulelist);
				this.onSelector(ruleNode, ruleItem, rulelist);

			}
		});
	}

	private declarations(ruleNode: Atrule | Rule, ruleItem?: ListItem<CssNode>, rulelist?: List<CssNode>) {
		csstree.walk(ruleNode, {
			visit: "Declaration",
			enter: (declarationNode, dItem, dList) => {

				this.hooks.onDeclaration.trigger(declarationNode, dItem, dList, {ruleNode, ruleItem, rulelist});

				if (declarationNode.property === "content") {
					csstree.walk(declarationNode, {
						visit: "Function",
						enter: (funcNode, fItem, fList) => {
							this.hooks.onContent.trigger(funcNode, fItem, fList, {declarationNode, dItem, dList}, {ruleNode, ruleItem, rulelist});
						}
					});
				}

			}
		});
	}

	// add pseudo elements to parser
	private onSelector(ruleNode: Atrule | Rule, ruleItem: ListItem<CssNode>, rulelist: List<CssNode>) {
		csstree.walk(ruleNode, {
			visit: "Selector",
			enter: (selectNode, selectItem, selectList) => {
				this.hooks.onSelector.trigger(selectNode, selectItem, selectList, {ruleNode, ruleItem, rulelist});

				selectNode.children.forEach(node => {if (node.type === "PseudoElementSelector") {
					csstree.walk(node, {
						visit: "PseudoElementSelector",
						enter: (pseudoNode, pItem, pList) => {
							this.hooks.onPseudoSelector.trigger(pseudoNode, pItem, pList, {selectNode, selectItem, selectList}, {ruleNode, ruleItem, rulelist});
						}
					});
				}});
			}
		});
	}

	private replaceUrls(ast: CssNode) {
		csstree.walk(ast, {
			visit: "Url",
			enter: (node) => {
				const content = node.value.value;
				if ((node.value.type === "Raw" && content.startsWith("data:")) || (node.value.type === "String" && (content.startsWith("\"data:") || content.startsWith("'data:")))) {
					// data-uri should not be parsed using the URL interface.
				} else {
					const href = content.replace(/["']/g, "");
					const url = new URL(href, this.url);
					node.value.value = url.toString();
				}
			}
		});
	}

	private addScope(ast: CssNode, id: string) {
		// Get all selector lists
		// add an id
		csstree.walk(ast, {
			visit: "Selector",
			enter: (node) => {
				const children = node.children;
				children.prepend(children.createItem({
					type: "WhiteSpace",
					value: " "
				}));
				children.prepend(children.createItem({
					type: "IdSelector",
					name: id,
					loc: null,
				}));
			}
		});
	}

	private getNamedPageSelectors(ast: CssNode) {
		const namedPageSelectors = {};
		csstree.walk(ast, {
			visit: "Rule",
			enter: (node) => {
				csstree.walk(node, {
					visit: "Declaration",
					enter: (declaration) => {
						if (declaration.property === "page") {
							const value = (declaration.value as Value).children.first() as Identifier;
							const name = value.name;
							const selector = csstree.generate(node.prelude);
							namedPageSelectors[name] = {
								name: name,
								selector: selector
							};

							// dList.remove(dItem);

							// Add in page break
							declaration.property = "break-before";
							value.type = "Identifier";
							value.name = "always";

						}
					}
				});
			}
		});
		return namedPageSelectors;
	}

	private replaceIds(ast: CssNode) {
		csstree.walk(ast, {
			visit: "Rule",
			enter: (node) => {

				csstree.walk(node, {
					visit: "IdSelector",
					enter: (idNode) => {
						const attrNode = idNode as unknown as AttributeSelector;
						const name = idNode.name;
						attrNode.flags = null;
						attrNode.matcher = "=";
						attrNode.name = {type: "Identifier", loc: null, name: "data-id"};
						attrNode.type = "AttributeSelector";
						attrNode.value = {type: "String", loc: null, value: `"${name}"`};
					}
				});
			}
		});
	}

	private imports(node: CssNode, item: ListItem<CssNode>, list: List<CssNode>) {
		// console.log("import", node, item, list);
		const queries: string[] = [];
		csstree.walk(node, {
			visit: "MediaQuery",
			enter: (mqNode) => {
				csstree.walk(mqNode, {
					visit: "Identifier",
					enter: (identNode) => {
						queries.push(identNode.name);
					}
				});
			}
		});

		// Just basic media query support for now
		const shouldNotApply = queries.some((query, index) => {
			if (query === "not") {
				const q = queries[index + 1];
				return !(q === "screen" || q === "speech");
			} else {
				return (query === "screen" || query === "speech");
			}
		});

		if (shouldNotApply) {
			return;
		}

		csstree.walk(node, {
			visit: "String",
			enter: (urlNode) => {
				const href = urlNode.value.replace(/["']/g, "");
				const url = new URL(href, this.url);
				const value = url.toString();

				this.imported.push(value);

				// Remove the original
				list.remove(item);
			}
		});
	}

	public set text(t) {
		this._text = t;
	}

	public get text() {
		return this._text;
	}

	// generate string
	public toString(ast?: CssNode) {
		return csstree.generate(ast ?? this.ast);
	}
}

export default Sheet;

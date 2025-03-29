import csstree from "css-tree";

import Handler from "../handler";
import type { HooksInterface } from "../handler";
import type BreakToken from "../../chunker/breaktoken";
import type Chunker from "../../chunker/chunker";
import type Page from "../../chunker/page";
import type Polisher from "../../polisher/polisher";
import type Sheet from "../../polisher/sheet";
import pageSizes from "../../polisher/sizes";
import { findElement, rebuildAncestors } from "../../utils/dom";
import { CSSValueToString } from "../../utils/utils";

declare module "css-tree" {
	interface List<TData> {
		// The @types/css-tree@1.0.7 typing is wrong.
		insertData(data: TData, before?: ListItem<TData> | null): List<TData>;
	}
}

interface Dimension {
	value: string;
	unit: string;
}

interface PageSize {
	width: Dimension;
	height: Dimension;
	format: string;
	orientation?: "landscape" | "portrait";
	bleed?: Rect<Dimension>;
}

interface Rect<T = Dimension | ({} & object)> {
	top: T;
	right: T;
	left: T;
	bottom: T;
}

interface PageModel {
	selector: string;
	name?: string;
	psuedo?: string;
	nth?: string;
	marginalia: Record<string, csstree.Block>;
	size?: PageSize;
	width?: Dimension;
	height?: Dimension;
	format?: string;
	orientation?: PageSize["orientation"];
	bleed?: Rect<Dimension>;
	margin: Rect;
	padding: Rect;
	border: Rect<string | ({} & object)>;
	backgroundOrigin?: number;
	block?: csstree.Block | ({} & object),
	marks?: string[];
	notes?: Record<string, csstree.Block>;
	added: boolean;
}

interface Marginalia {
	page: PageModel;
	selector: string;
	block: csstree.Block;
	hasContent: boolean;
}

export interface AtPageEventMap {
	atpages(atpages: Record<string, PageModel>): void;
	size(size: PageSize): void;
}

class AtPage extends Handler<AtPageEventMap> implements HooksInterface<Chunker["hooks"] & Polisher["hooks"]> {
	private readonly pages: Record<string, PageModel> = {};
	private width?: Dimension;
	private height?: Dimension;
	private format?: string;
	private orientation?: PageSize["orientation"];
	private marginalia: Record<string, Marginalia> = {};

	private pageModel(selector: string): PageModel {
		return {
			selector: selector,
			name: undefined,
			psuedo: undefined,
			nth: undefined,
			marginalia: {},
			width: undefined,
			height: undefined,
			orientation: undefined,
			margin: {
				top: {},
				right: {},
				left: {},
				bottom: {}
			},
			padding: {
				top: {},
				right: {},
				left: {},
				bottom: {}
			},
			border: {
				top: {},
				right: {},
				left: {},
				bottom: {}
			},
			backgroundOrigin: undefined,
			block: {},
			marks: undefined,
			notes: undefined,
			added: false
		};
	}

	// Find and Remove @page rules
	onAtPage(node: csstree.Atrule, item: csstree.ListItem<csstree.CssNode>, list: csstree.List<csstree.CssNode>) {
		let page: PageModel | undefined;
		let marginalia: Record<string, csstree.Block> | undefined;
		let selector = "";
		let named: string | undefined;
		let psuedo: string | undefined;
		let nth: string | undefined;
		let needsMerge = false;

		if (node.prelude) {
			named = this.getTypeSelector(node);
			psuedo = this.getPsuedoSelector(node);
			nth = this.getNthSelector(node);
			selector = csstree.generate(node.prelude);
		} else {
			selector = "*";
		}

		if (selector in this.pages) {
			// this.pages[selector] = Object.assign(this.pages[selector], page);
			// console.log("after", selector, this.pages[selector]);

			// this.pages[selector].added = false;
			page = this.pages[selector];
			marginalia = this.replaceMarginalia(node);
			needsMerge = true;
			// Mark page for getting classes added again
			page.added = false;
		} else {
			page = this.pageModel(selector);
			marginalia = this.replaceMarginalia(node);
			this.pages[selector] = page;
		}

		page.name = named;
		page.psuedo = psuedo;
		page.nth = nth;

		if (needsMerge) {
			page.marginalia = Object.assign(page.marginalia, marginalia);
		} else {
			page.marginalia = marginalia;
		}

		const notes = this.replaceNotes(node);
		page.notes = notes;

		const declarations = this.replaceDeclarations(node);

		if (declarations.size) {
			page.size = declarations.size;
			page.width = declarations.size.width;
			page.height = declarations.size.height;
			page.orientation = declarations.size.orientation;
			page.format = declarations.size.format;
		}

		if (declarations.bleed && declarations.bleed[0] !== "auto") {
			switch (declarations.bleed.length) {
				case 4: // top right bottom left
					page.bleed = {
						top: declarations.bleed[0],
						right: declarations.bleed[1],
						bottom: declarations.bleed[2],
						left: declarations.bleed[3]
					};
					break;
				case 3: // top right bottom right
					page.bleed = {
						top: declarations.bleed[0],
						right: declarations.bleed[1],
						bottom: declarations.bleed[2],
						left: declarations.bleed[1]
					};
					break;
				case 2: // top right top right
					page.bleed = {
						top: declarations.bleed[0],
						right: declarations.bleed[1],
						bottom: declarations.bleed[0],
						left: declarations.bleed[1]
					};
					break;
				default:
					page.bleed = {
						top: declarations.bleed[0],
						right: declarations.bleed[0],
						bottom: declarations.bleed[0],
						left: declarations.bleed[0]
					};
			}
		}

		if (declarations.marks) {
			if (!declarations.bleed || declarations.bleed && declarations.bleed[0] === "auto") {
				// Spec say 6pt, but needs more space for marks
				page.bleed = {
					// TODO: these values were numbers.
					top: { value: "6", unit: "mm" },
					right: { value: "6", unit: "mm" },
					bottom: { value: "6", unit: "mm" },
					left: { value: "6", unit: "mm" }
				};
			}

			page.marks = declarations.marks;
		}

		if (declarations.margin) {
			page.margin = declarations.margin;
		}
		if (declarations.padding) {
			page.padding = declarations.padding;
		}

		if (declarations.border) {
			page.border = declarations.border;
		}

		if (declarations.marks) {
			page.marks = declarations.marks;
		}

		// TODO: base this decision on page.block.
		if (needsMerge) {
			(page.block as csstree.Block).children.appendList(node.block.children);
		} else {
			page.block = node.block;
		}

		// Remove the rule
		list.remove(item);
	}

	afterTreeWalk(ast: csstree.StyleSheet, sheet: Sheet) {
		const dirtyPage = "*" in this.pages && !this.pages["*"].added;

		this.addPageClasses(this.pages, ast, sheet);

		if (dirtyPage) {
			const width = this.pages["*"].width;
			const height = this.pages["*"].height;
			const format = this.pages["*"].format;
			const orientation = this.pages["*"].orientation;
			const bleed = this.pages["*"].bleed;
			const marks = this.pages["*"].marks;
			let bleedverso: Rect<Dimension> | undefined;
			let bleedrecto: Rect<Dimension> | undefined;

			if (":left" in this.pages) {
				bleedverso = this.pages[":left"].bleed;
			}

			if (":right" in this.pages) {
				bleedrecto = this.pages[":right"].bleed;
			}

			if ((width && height) &&
				(this.width !== width || this.height !== height)) {
				this.width = width;
				this.height = height;
				this.format = format;
				this.orientation = orientation;

				this.addRootVars(ast, width, height, orientation, bleed, bleedrecto, bleedverso, marks);
				this.addRootPage(ast, this.pages["*"].size, bleed, bleedrecto, bleedverso);

				this.emit("size", { width, height, orientation, format, bleed });
				this.emit("atpages", this.pages);
			}

		}
	}

	private getTypeSelector(ast: csstree.CssNode) {
		// Find page name
		let name: string | undefined;

		csstree.walk(ast, {
			visit: "TypeSelector",
			enter: (node) => {
				name = node.name;
			}
		});

		return name;
	}

	private getPsuedoSelector(ast: csstree.CssNode) {
		// Find if it has :left & :right & :black & :first
		let name: string | undefined;
		csstree.walk(ast, {
			visit: "PseudoClassSelector",
			enter: (node) => {
				if (node.name !== "nth") {
					name = node.name;
				}
			}
		});

		return name;
	}

	private getNthSelector(ast: csstree.CssNode) {
		// Find if it has :nth
		let nth: string | undefined;
		csstree.walk(ast, {
			visit: "PseudoClassSelector",
			enter: (node) => {
				if (node.name === "nth" && node.children) {
					const raw = node.children.first() as csstree.Raw;
					nth = raw.value;
				}
			}
		});

		return nth;
	}

	private replaceMarginalia(ast: csstree.Atrule) {
		const parsed: Record<string, csstree.Block> = {};
		const MARGINS = [
			"top-left-corner", "top-left", "top", "top-center", "top-right", "top-right-corner",
			"bottom-left-corner", "bottom-left", "bottom", "bottom-center", "bottom-right", "bottom-right-corner",
			"left-top", "left-middle", "left", "left-bottom", "top-right-corner",
			"right-top", "right-middle", "right", "right-bottom", "right-right-corner"
		];
		csstree.walk(ast.block, {
			visit: "Atrule",
			enter: (node, item, list) => {
				let name = node.name;
				if (MARGINS.includes(name)) {
					if (name === "top") {
						name = "top-center";
					}
					if (name === "right") {
						name = "right-middle";
					}
					if (name === "left") {
						name = "left-middle";
					}
					if (name === "bottom") {
						name = "bottom-center";
					}
					parsed[name] = node.block;
					list.remove(item);
				}
			}
		});

		return parsed;
	}

	private replaceNotes(ast: csstree.Atrule) {
		const parsed: Record<string, csstree.Block> = {};

		csstree.walk(ast.block, {
			visit: "Atrule",
			enter: (node, item, list) => {
				const name = node.name;
				if (name === "footnote") {
					parsed[name] = node.block;
					list.remove(item);
				}
			}
		});

		return parsed;
	}

	private replaceDeclarations(ast: csstree.Atrule) {
		const parsed: {
			marks?: string[];
			margin?: Rect;
			padding?: Rect;
			border?: Rect<string | ({} & object)>;
			size?: PageSize;
			bleed?: [("auto" | Dimension)?, ...Dimension[]];
		} = {};

		csstree.walk(ast.block, {
			visit: "Declaration",
			enter: (declaration, dItem, dList) => {
				const prop = csstree.property(declaration.property).name;
				// let value = declaration.value;

				if (prop === "marks") {
					parsed.marks = [];
					csstree.walk(declaration, {
						visit: "Identifier",
						enter: (ident) => {
							parsed.marks.push(ident.name);
						}
					});
					dList.remove(dItem);
				} else if (prop === "margin") {
					parsed.margin = this.getMargins(declaration);
					dList.remove(dItem);

				} else if (prop.indexOf("margin-") === 0) {
					const m = prop.substring("margin-".length);
					if (!parsed.margin) {
						parsed.margin = {
							top: {},
							right: {},
							left: {},
							bottom: {}
						};
					}
					parsed.margin[m] = (declaration.value as csstree.Value).children.first();
					dList.remove(dItem);

				} else if (prop === "padding") {
					parsed.padding = this.getPaddings(declaration.value as csstree.Value);
					dList.remove(dItem);

				} else if (prop.indexOf("padding-") === 0) {
					const p = prop.substring("padding-".length);
					if (!parsed.padding) {
						parsed.padding = {
							top: {},
							right: {},
							left: {},
							bottom: {}
						};
					}
					parsed.padding[p] = (declaration.value as csstree.Value).children.first();
					dList.remove(dItem);
				}

				else if (prop === "border") {
					if (!parsed.border) {
						parsed.border = {
							top: {},
							right: {},
							left: {},
							bottom: {}
						};
					}
					parsed.border.top = csstree.generate(declaration.value);
					parsed.border.right = csstree.generate(declaration.value);
					parsed.border.left = csstree.generate(declaration.value);
					parsed.border.bottom = csstree.generate(declaration.value);

					dList.remove(dItem);

				}

				else if (prop.indexOf("border-") === 0) {
					if (!parsed.border) {
						parsed.border = {
							top: {},
							right: {},
							left: {},
							bottom: {}
						};
					}
					const p = prop.substring("border-".length);

					parsed.border[p] = csstree.generate(declaration.value);
					dList.remove(dItem);

				}

				else if (prop === "size") {
					parsed.size = this.getSize(declaration);
					dList.remove(dItem);
				} else if (prop === "bleed") {
					parsed.bleed = [];

					csstree.walk(declaration, {
						enter: (subNode: csstree.CssNode) => {
							switch (subNode.type) {
								case "String": // bleed: "auto"
									if (subNode.value.indexOf("auto") > -1) {
										parsed.bleed.push("auto");
									}
									break;
								case "Dimension": // bleed: 1in 2in, bleed: 20px ect.
									parsed.bleed.push({
										value: subNode.value,
										unit: subNode.unit
									});
									break;
								case "Number":
									parsed.bleed.push({
										value: subNode.value,
										unit: "px"
									});
									break;
								default:
									// ignore
							}

						}
					});

					dList.remove(dItem);
				}

			}
		});

		return parsed;

	}

	private getSize(declaration: csstree.Declaration) {
		let width: Dimension | undefined;
		let height: Dimension | undefined;
		let orientation: PageSize["orientation"] | undefined;
		let format: string | undefined;

		// Get size: Xmm Ymm
		csstree.walk(declaration, {
			visit: "Dimension",
			enter: (node) => {
				const { value, unit } = node;
				if (!width) {
					width = { value, unit };
				} else if (!height) {
					height = { value, unit };
				}
			}
		});

		// Get size: "A4"
		csstree.walk(declaration, {
			visit: "String",
			enter: (node) => {
				const name = node.value.replace(/["|']/g, "");
				const s = pageSizes[name];
				if (s) {
					width = s.width;
					height = s.height;
				}
			}
		});

		// Get Format or Landscape or Portrait
		csstree.walk(declaration, {
			visit: "Identifier",
			enter: (node) => {
				const name = node.name;
				if (name === "landscape" || name === "portrait") {
					orientation = name;
				} else if (name !== "auto") {
					const s = pageSizes[name];
					if (s) {
						width = s.width;
						height = s.height;
					}
					format = name;
				}
			}
		});

		return {
			width,
			height,
			orientation,
			format
		};
	}

	private getMargins(declaration: csstree.Declaration) {
		const margins: Dimension[] = [];
		const margin: Rect = {
			top: {},
			right: {},
			left: {},
			bottom: {}
		};

		csstree.walk(declaration, {
			enter: (node: csstree.CssNode) => {
				switch (node.type) {
					case "Dimension": // margin: 1in 2in, margin: 20px, etc...
						margins.push(node);
						break;
					case "Number": // margin: 0
						margins.push({
							value: node.value,
							unit: "px"
						});
						break;
					default:
						// ignore
				}
			}
		});

		if (margins.length === 1) {
			for (const m in margin) {
				margin[m] = margins[0];
			}
		} else if (margins.length === 2) {
			margin.top = margins[0];
			margin.right = margins[1];
			margin.bottom = margins[0];
			margin.left = margins[1];
		} else if (margins.length === 3) {
			margin.top = margins[0];
			margin.right = margins[1];
			margin.bottom = margins[2];
			margin.left = margins[1];
		} else if (margins.length === 4) {
			margin.top = margins[0];
			margin.right = margins[1];
			margin.bottom = margins[2];
			margin.left = margins[3];
		}

		return margin;
	}

	private getPaddings(declaration: csstree.Value) {
		const paddings: Dimension[] = [];
		const padding: Rect = {
			top: {},
			right: {},
			left: {},
			bottom: {}
		};

		csstree.walk(declaration, {
			enter: (node: csstree.CssNode) => {
				switch (node.type) {
					case "Dimension": // padding: 1in 2in, padding: 20px, etc...
						paddings.push(node);
						break;
					case "Number": // padding: 0
						paddings.push({
							value: node.value,
							unit: "px"
						});
						break;
					default:
						// ignore
				}
			}
		});
		if (paddings.length === 1) {
			for (const p in padding) {
				padding[p] = paddings[0];
			}
		} else if (paddings.length === 2) {

			padding.top = paddings[0];
			padding.right = paddings[1];
			padding.bottom = paddings[0];
			padding.left = paddings[1];
		} else if (paddings.length === 3) {

			padding.top = paddings[0];
			padding.right = paddings[1];
			padding.bottom = paddings[2];
			padding.left = paddings[1];
		} else if (paddings.length === 4) {

			padding.top = paddings[0];
			padding.right = paddings[1];
			padding.bottom = paddings[2];
			padding.left = paddings[3];
		}
		return padding;
	}

	private addPageClasses(pages: Record<string, PageModel>, ast: csstree.StyleSheet, sheet: Sheet) {
		const children = ast.children as csstree.List<csstree.Rule>;

		// First add * page
		if ("*" in pages && !pages["*"].added) {
			const p = this.createPage(pages["*"], children, sheet);
			sheet.insertRule(p);
			pages["*"].added = true;
		}
		// Add :left & :right
		if (":left" in pages && !pages[":left"].added) {
			const left = this.createPage(pages[":left"], children, sheet);
			sheet.insertRule(left);
			pages[":left"].added = true;
		}
		if (":right" in pages && !pages[":right"].added) {
			const right = this.createPage(pages[":right"], children, sheet);
			sheet.insertRule(right);
			pages[":right"].added = true;
		}
		// Add :first & :blank
		if (":first" in pages && !pages[":first"].added) {
			const first = this.createPage(pages[":first"], children, sheet);
			sheet.insertRule(first);
			pages[":first"].added = true;
		}
		if (":blank" in pages && !pages[":blank"].added) {
			const blank = this.createPage(pages[":blank"], children, sheet);
			sheet.insertRule(blank);
			pages[":blank"].added = true;
		}
		// Add nth pages
		for (const pg in pages) {
			if (pages[pg].nth && !pages[pg].added) {
				const nth = this.createPage(pages[pg], children, sheet);
				sheet.insertRule(nth);
				pages[pg].added = true;
			}
		}

		// Add named pages
		for (const pg in pages) {
			if (pages[pg].name && !pages[pg].added) {
				const named = this.createPage(pages[pg], children, sheet);
				sheet.insertRule(named);
				pages[pg].added = true;
			}
		}

	}

	private createPage(page: PageModel, ruleList: csstree.List<csstree.Rule>, sheet: Sheet) {
		const selectors = this.selectorsForPage(page);
		const children = (page.block as csstree.Block).children.copy() as csstree.List<csstree.Declaration>;
		const block: csstree.Block = {
			type: "Block",
			children: children
		};


		const rule = this.createRule(selectors, block);

		this.addMarginVars(page.margin, children);
		this.addPaddingVars(page.padding, children);
		this.addBorderVars(page.border, children);


		if (page.width) {
			this.addDimensions(page.width, page.height, page.orientation, children);
		}

		if (page.marginalia) {
			this.addMarginaliaStyles(page, ruleList);
			this.addMarginaliaContent(page, sheet);
		}

		if (page.notes) {
			this.addNotesStyles(page.notes, page, ruleList);
		}

		return rule;
	}

	private addMarginVars(margin: Rect, list: csstree.List<csstree.Declaration>) {
		// variables for margins
		for (const m in margin) {
			if (typeof margin[m].value !== "undefined") {
				const value = margin[m].value + (margin[m].unit || "");
				const mVar = list.createItem({
					type: "Declaration",
					important: false,
					property: "--pagedjs-margin-" + m,
					value: {
						type: "Raw",
						value: value
					}
				});
				list.append(mVar);

			}
		}
	}

	private addPaddingVars(padding: Rect, list: csstree.List<csstree.Declaration>) {
		// variables for padding
		for (const p in padding) {

			if (typeof padding[p].value !== "undefined") {
				const value = padding[p].value + (padding[p].unit || "");
				const pVar = list.createItem({
					type: "Declaration",
					important: false,
					property: "--pagedjs-padding-" + p,
					value: {
						type: "Raw",
						value: value
					}
				});

				list.append(pVar);
			}

		}
	}

	private addBorderVars(border: Rect<string | ({} & object)>, list: csstree.List<csstree.Declaration>) {
		// variables for borders
		for (const name of Object.keys(border)) {
			const value = border[name];
			// value is an empty object when undefined
			if (typeof value === "string") {
				const borderItem = list.createItem({
					type: "Declaration",
					important: false,
					property: "--pagedjs-border-" + name,
					value: {
						type: "Raw",
						value
					}
				});
				list.append(borderItem);
			}
		}
	}

	private addDimensions(width: Dimension, height: Dimension, orientation: PageSize["orientation"], list: csstree.List<csstree.Declaration>) {
		let widthString = CSSValueToString(width);
		let heightString = CSSValueToString(height);

		if (orientation && orientation !== "portrait") {
			// reverse for orientation
			[widthString, heightString] = [heightString, widthString];
		}

		// width variable
		const wVar = this.createVariable("--pagedjs-pagebox-width", widthString);
		list.appendData(wVar);

		// height variable
		const hVar = this.createVariable("--pagedjs-pagebox-height", heightString);
		list.appendData(hVar);
	}

	private addMarginaliaStyles(page: PageModel, list: csstree.List<csstree.Rule>) {
		for (const loc in page.marginalia) {
			const block = csstree.clone(page.marginalia[loc]) as csstree.Block;
			let hasContent = false;

			if (block.children.isEmpty()) {
				continue;
			}

			csstree.walk(block, {
				visit: "Declaration",
				enter: (node, item, list) => {
					if (node.property === "content") {
						const value = node.value as csstree.Value;
						if (value.children && (value.children.first() as csstree.Identifier).name === "none") {
							hasContent = false;
						} else {
							hasContent = true;
						}
						list.remove(item);
					}
					if (node.property === "vertical-align") {
						csstree.walk(node, {
							visit: "Identifier",
							enter: (identNode) => {
								const name = identNode.name;
								if (name === "top") {
									identNode.name = "flex-start";
								} else if (name === "middle") {
									identNode.name = "center";
								} else if (name === "bottom") {
									identNode.name = "flex-end";
								}
							}
						});
						node.property = "align-items";
					}

					if (node.property === "width" &&
						(loc === "top-left" ||
							loc === "top-center" ||
							loc === "top-right" ||
							loc === "bottom-left" ||
							loc === "bottom-center" ||
							loc === "bottom-right")) {
						const c = csstree.clone(node) as csstree.Declaration;
						c.property = "max-width";
						list.appendData(c);
					}

					if (node.property === "height" &&
						(loc === "left-top" ||
							loc === "left-middle" ||
							loc === "left-bottom" ||
							loc === "right-top" ||
							loc === "right-middle" ||
							loc === "right-bottom")) {
						const c = csstree.clone(node) as csstree.Declaration;
						c.property = "max-height";
						list.appendData(c);
					}
				}
			});

			const marginSelectors = this.selectorsForPageMargin(page, loc);
			const marginRule = this.createRule(marginSelectors, block);

			list.appendData(marginRule);

			const sel = csstree.generate({
				type: "Selector",
				children: marginSelectors
			} satisfies csstree.Selector);

			this.marginalia[sel] = {
				page,
				selector: sel,
				block: page.marginalia[loc],
				hasContent
			};

		}
	}

	private addMarginaliaContent(page: PageModel, sheet: Sheet) {
		let displayNone = false;
		// Just content
		for (const loc in page.marginalia) {
			const content = csstree.clone(page.marginalia[loc]) as csstree.Block;
			csstree.walk(content, {
				visit: "Declaration",
				enter: (node, item, list) => {
					if (node.property !== "content") {
						list.remove(item);
					}

					const value = node.value as csstree.Value;
					if (value.children && (value.children.first() as csstree.Identifier).name === "none") {
						displayNone = true;
					}
				}
			});

			if (content.children.isEmpty()) {
				continue;
			}

			const displaySelectors = this.selectorsForPageMargin(page, loc);

			displaySelectors.insertData({
				type: "Combinator",
				name: ">"
			} satisfies csstree.Combinator);

			displaySelectors.insertData({
				type: "ClassSelector",
				name: "pagedjs_margin-content"
			} satisfies csstree.ClassSelector);

			displaySelectors.insertData({
				type: "Combinator",
				name: ">"
			} satisfies csstree.Combinator);

			displaySelectors.insertData({
				type: "TypeSelector",
				name: "*"
			} satisfies csstree.TypeSelector);

			let displayDeclaration: csstree.Declaration | undefined;
			if (displayNone) {
				displayDeclaration = this.createDeclaration("display", "none", false);
			} else {
				displayDeclaration = this.createDeclaration("display", "block", false);
			}

			const displayRule = this.createRule(displaySelectors, [displayDeclaration]);
			sheet.insertRule(displayRule);

			// insert content rule
			const contentSelectors = this.selectorsForPageMargin(page, loc);

			contentSelectors.insertData({
				type: "Combinator",
				name: ">"
			} satisfies csstree.Combinator);

			contentSelectors.insertData({
				type: "ClassSelector",
				name: "pagedjs_margin-content"
			} satisfies csstree.ClassSelector);

			contentSelectors.insertData({
				type: "PseudoElementSelector",
				name: "after",
				children: null
			} satisfies csstree.PseudoElementSelector);

			const contentRule = this.createRule(contentSelectors, content);
			sheet.insertRule(contentRule);
		}
	}

	private addRootVars(ast: csstree.StyleSheet, width: Dimension, height: Dimension, orientation: PageSize["orientation"], bleed: Rect<Dimension>, bleedrecto: Rect<Dimension>, bleedverso: Rect<Dimension>, marks: string[]) {
		const rules: csstree.Declaration[] = [];
		const selectors = new csstree.List<csstree.PseudoClassSelector>();
		selectors.insertData({
			type: "PseudoClassSelector",
			name: "root",
			children: null
		} satisfies csstree.PseudoClassSelector);

		let widthString: string | undefined, heightString: string | undefined;
		let widthStringRight: string | undefined, heightStringRight: string | undefined;
		let widthStringLeft: string | undefined, heightStringLeft: string | undefined;

		if (!bleed) {
			widthString = CSSValueToString(width);
			heightString = CSSValueToString(height);
			widthStringRight = CSSValueToString(width);
			heightStringRight = CSSValueToString(height);
			widthStringLeft = CSSValueToString(width);
			heightStringLeft = CSSValueToString(height);
		} else {
			widthString = `calc( ${CSSValueToString(width)} + ${CSSValueToString(bleed.left)} + ${CSSValueToString(bleed.right)} )`;
			heightString = `calc( ${CSSValueToString(height)} + ${CSSValueToString(bleed.top)} + ${CSSValueToString(bleed.bottom)} )`;

			widthStringRight = `calc( ${CSSValueToString(width)} + ${CSSValueToString(bleed.left)} + ${CSSValueToString(bleed.right)} )`;
			heightStringRight = `calc( ${CSSValueToString(height)} + ${CSSValueToString(bleed.top)} + ${CSSValueToString(bleed.bottom)} )`;

			widthStringLeft = `calc( ${CSSValueToString(width)} + ${CSSValueToString(bleed.left)} + ${CSSValueToString(bleed.right)} )`;
			heightStringLeft = `calc( ${CSSValueToString(height)} + ${CSSValueToString(bleed.top)} + ${CSSValueToString(bleed.bottom)} )`;

			const bleedTop = this.createVariable("--pagedjs-bleed-top", CSSValueToString(bleed.top));
			const bleedRight = this.createVariable("--pagedjs-bleed-right", CSSValueToString(bleed.right));
			const bleedBottom = this.createVariable("--pagedjs-bleed-bottom", CSSValueToString(bleed.bottom));
			const bleedLeft = this.createVariable("--pagedjs-bleed-left", CSSValueToString(bleed.left));

			let bleedTopRecto = this.createVariable("--pagedjs-bleed-right-top", CSSValueToString(bleed.top));
			let bleedRightRecto = this.createVariable("--pagedjs-bleed-right-right", CSSValueToString(bleed.right));
			let bleedBottomRecto = this.createVariable("--pagedjs-bleed-right-bottom", CSSValueToString(bleed.bottom));
			let bleedLeftRecto = this.createVariable("--pagedjs-bleed-right-left", CSSValueToString(bleed.left));

			let bleedTopVerso = this.createVariable("--pagedjs-bleed-left-top", CSSValueToString(bleed.top));
			let bleedRightVerso = this.createVariable("--pagedjs-bleed-left-right", CSSValueToString(bleed.right));
			let bleedBottomVerso = this.createVariable("--pagedjs-bleed-left-bottom", CSSValueToString(bleed.bottom));
			let bleedLeftVerso = this.createVariable("--pagedjs-bleed-left-left", CSSValueToString(bleed.left));

			if (bleedrecto) {
				bleedTopRecto = this.createVariable("--pagedjs-bleed-right-top", CSSValueToString(bleedrecto.top));
				bleedRightRecto = this.createVariable("--pagedjs-bleed-right-right", CSSValueToString(bleedrecto.right));
				bleedBottomRecto = this.createVariable("--pagedjs-bleed-right-bottom", CSSValueToString(bleedrecto.bottom));
				bleedLeftRecto = this.createVariable("--pagedjs-bleed-right-left", CSSValueToString(bleedrecto.left));

				widthStringRight = `calc( ${CSSValueToString(width)} + ${CSSValueToString(bleedrecto.left)} + ${CSSValueToString(bleedrecto.right)} )`;
				heightStringRight = `calc( ${CSSValueToString(height)} + ${CSSValueToString(bleedrecto.top)} + ${CSSValueToString(bleedrecto.bottom)} )`;
			}
			if (bleedverso) {
				bleedTopVerso = this.createVariable("--pagedjs-bleed-left-top", CSSValueToString(bleedverso.top));
				bleedRightVerso = this.createVariable("--pagedjs-bleed-left-right", CSSValueToString(bleedverso.right));
				bleedBottomVerso = this.createVariable("--pagedjs-bleed-left-bottom", CSSValueToString(bleedverso.bottom));
				bleedLeftVerso = this.createVariable("--pagedjs-bleed-left-left", CSSValueToString(bleedverso.left));

				widthStringLeft = `calc( ${CSSValueToString(width)} + ${CSSValueToString(bleedverso.left)} + ${CSSValueToString(bleedverso.right)} )`;
				heightStringLeft = `calc( ${CSSValueToString(height)} + ${CSSValueToString(bleedverso.top)} + ${CSSValueToString(bleedverso.bottom)} )`;
			}

			const pageWidthVar = this.createVariable("--pagedjs-width", CSSValueToString(width));
			const pageHeightVar = this.createVariable("--pagedjs-height", CSSValueToString(height));

			rules.push(
				bleedTop,
				bleedRight,
				bleedBottom,
				bleedLeft,
				bleedTopRecto,
				bleedRightRecto,
				bleedBottomRecto,
				bleedLeftRecto,
				bleedTopVerso,
				bleedRightVerso,
				bleedBottomVerso,
				bleedLeftVerso,
				pageWidthVar,
				pageHeightVar
			);
		}

		if (marks) {
			marks.forEach((mark) => {
				const markDisplay = this.createVariable("--pagedjs-mark-" + mark + "-display", "block");
				rules.push(markDisplay);
			});
		}

		// orientation variable
		if (orientation) {
			const oVar = this.createVariable("--pagedjs-orientation", orientation);
			rules.push(oVar);

			if (orientation !== "portrait") {
				// reverse for orientation
				[widthString, heightString] = [heightString, widthString];
				[widthStringRight, heightStringRight] = [heightStringRight, widthStringRight];
				[widthStringLeft, heightStringLeft] = [heightStringLeft, widthStringLeft];
			}
		}

		const wVar = this.createVariable("--pagedjs-width", widthString);
		const hVar = this.createVariable("--pagedjs-height", heightString);

		const wVarR = this.createVariable("--pagedjs-width-right", widthStringRight);
		const hVarR = this.createVariable("--pagedjs-height-right", heightStringRight);

		const wVarL = this.createVariable("--pagedjs-width-left", widthStringLeft);
		const hVarL = this.createVariable("--pagedjs-height-left", heightStringLeft);

		rules.push(wVar, hVar, wVarR, hVarR, wVarL, hVarL);

		const rule = this.createRule(selectors, rules);

		ast.children.appendData(rule);
	}


	private addNotesStyles(notes: Record<string, csstree.Block>, page: PageModel, list: csstree.List<csstree.Rule>) {

		for (const note in notes) {
			const selectors = this.selectorsForPage(page);

			selectors.insertData({
				type: "Combinator",
				name: " "
			} satisfies csstree.Combinator);

			selectors.insertData({
				type: "ClassSelector",
				name: "pagedjs_" + note + "_content"
			} satisfies csstree.ClassSelector);

			const notesRule = this.createRule(selectors, notes[note]);

			list.appendData(notesRule);
		}

	}

	/*
	@page {
		size: var(--pagedjs-width) var(--pagedjs-height);
		margin: 0;
		padding: 0;
	}
	*/
	private addRootPage(ast: csstree.StyleSheet, size: PageSize, bleed: Partial<Rect<Dimension>>, bleedrecto: Rect<Dimension>, bleedverso: Rect<Dimension>) {
		const { width, height, orientation, format } = size;
		const children = new csstree.List<csstree.CssNode>();
		const childrenLeft = new csstree.List<csstree.CssNode>();
		const childrenRight = new csstree.List<csstree.CssNode>();
		const dimensions = new csstree.List<csstree.CssNode>();
		const dimensionsLeft = new csstree.List<csstree.CssNode>();
		const dimensionsRight = new csstree.List<csstree.CssNode>();

		if (bleed) {
			const widthCalculations = new csstree.List<csstree.CssNode>();
			const heightCalculations = new csstree.List<csstree.CssNode>();

			// width
			widthCalculations.appendData({
				type: "Dimension",
				unit: width.unit,
				value: width.value
			} satisfies csstree.Dimension);

			widthCalculations.appendData({
				type: "WhiteSpace",
				value: " "
			} satisfies csstree.WhiteSpace);

			widthCalculations.appendData({
				type: "Operator",
				value: "+"
			} satisfies csstree.Operator);

			widthCalculations.appendData({
				type: "WhiteSpace",
				value: " "
			} satisfies csstree.WhiteSpace);

			widthCalculations.appendData({
				type: "Dimension",
				unit: bleed.left.unit,
				value: bleed.left.value
			} satisfies csstree.Dimension);

			widthCalculations.appendData({
				type: "WhiteSpace",
				value: " "
			} satisfies csstree.WhiteSpace);

			widthCalculations.appendData({
				type: "Operator",
				value: "+"
			} satisfies csstree.Operator);

			widthCalculations.appendData({
				type: "WhiteSpace",
				value: " "
			} satisfies csstree.WhiteSpace);

			widthCalculations.appendData({
				type: "Dimension",
				unit: bleed.right.unit,
				value: bleed.right.value
			} satisfies csstree.Dimension);

			// height
			heightCalculations.appendData({
				type: "Dimension",
				unit: height.unit,
				value: height.value
			} satisfies csstree.Dimension);

			heightCalculations.appendData({
				type: "WhiteSpace",
				value: " "
			} satisfies csstree.WhiteSpace);

			heightCalculations.appendData({
				type: "Operator",
				value: "+"
			} satisfies csstree.Operator);

			heightCalculations.appendData({
				type: "WhiteSpace",
				value: " "
			} satisfies csstree.WhiteSpace);

			heightCalculations.appendData({
				type: "Dimension",
				unit: bleed.top.unit,
				value: bleed.top.value
			} satisfies csstree.Dimension);

			heightCalculations.appendData({
				type: "WhiteSpace",
				value: " "
			} satisfies csstree.WhiteSpace);

			heightCalculations.appendData({
				type: "Operator",
				value: "+"
			} satisfies csstree.Operator);

			heightCalculations.appendData({
				type: "WhiteSpace",
				value: " "
			} satisfies csstree.WhiteSpace);

			heightCalculations.appendData({
				type: "Dimension",
				unit: bleed.bottom.unit,
				value: bleed.bottom.value
			} satisfies csstree.Dimension);

			dimensions.appendData({
				type: "Function",
				name: "calc",
				children: widthCalculations
			} satisfies csstree.FunctionNode);

			dimensions.appendData({
				type: "WhiteSpace",
				value: " "
			} satisfies csstree.WhiteSpace);

			dimensions.appendData({
				type: "Function",
				name: "calc",
				children: heightCalculations
			} satisfies csstree.FunctionNode);

		} else if (format) {
			dimensions.appendData({
				type: "Identifier",
				name: format
			});

			if (orientation) {
				dimensions.appendData({
					type: "WhiteSpace",
					value: " "
				} satisfies csstree.WhiteSpace);

				dimensions.appendData({
					type: "Identifier",
					name: orientation
				});
			}
		} else {
			dimensions.appendData({
				type: "Dimension",
				unit: width.unit,
				value: width.value
			} satisfies csstree.Dimension);

			dimensions.appendData({
				type: "WhiteSpace",
				value: " "
			} satisfies csstree.WhiteSpace);

			dimensions.appendData({
				type: "Dimension",
				unit: height.unit,
				value: height.value
			} satisfies csstree.Dimension);
		}

		children.appendData({
			type: "Declaration",
			important: false,
			property: "size",
			value: {
				type: "Value",
				children: dimensions
			}
		} satisfies csstree.Declaration);

		children.appendData({
			type: "Declaration",
			important: false,
			property: "margin",
			value: {
				type: "Value",
				children: new csstree.List<csstree.CssNode>().fromArray([{
					type: "Dimension",
					unit: "px",
					value: "0"
				} satisfies csstree.Dimension])
			}
		} satisfies csstree.Declaration);

		children.appendData({
			type: "Declaration",
			important: false,
			property: "padding",
			value: {
				type: "Value",
				children: new csstree.List<csstree.CssNode>().fromArray([{
					type: "Dimension",
					unit: "px",
					value: "0"
				} satisfies csstree.Dimension])
			}
		} satisfies csstree.Declaration);

		children.appendData({
			type: "Declaration",
			important: false,
			property: "padding",
			value: {
				type: "Value",
				children: new csstree.List<csstree.CssNode>().fromArray([{
					type: "Dimension",
					unit: "px",
					value: "0"
				} satisfies csstree.Dimension])
			}
		} satisfies csstree.Declaration);

		const rule = ast.children.createItem({
			type: "Atrule",
			prelude: null,
			name: "page",
			block: {
				type: "Block",
				children
			}
		} satisfies csstree.Atrule);

		ast.children.append(rule);

		if (bleedverso) {
			const widthCalculationsLeft = new csstree.List<csstree.CssNode>();
			const heightCalculationsLeft = new csstree.List<csstree.CssNode>();

			// width
			widthCalculationsLeft.appendData({
				type: "Dimension",
				unit: width.unit,
				value: width.value
			} satisfies csstree.Dimension);

			widthCalculationsLeft.appendData({
				type: "WhiteSpace",
				value: " "
			} satisfies csstree.WhiteSpace);

			widthCalculationsLeft.appendData({
				type: "Operator",
				value: "+"
			} satisfies csstree.Operator);

			widthCalculationsLeft.appendData({
				type: "WhiteSpace",
				value: " "
			} satisfies csstree.WhiteSpace);

			widthCalculationsLeft.appendData({
				type: "Dimension",
				unit: bleedverso.left.unit,
				value: bleedverso.left.value
			} satisfies csstree.Dimension);

			widthCalculationsLeft.appendData({
				type: "WhiteSpace",
				value: " "
			} satisfies csstree.WhiteSpace);

			widthCalculationsLeft.appendData({
				type: "Operator",
				value: "+"
			} satisfies csstree.Operator);

			widthCalculationsLeft.appendData({
				type: "WhiteSpace",
				value: " "
			} satisfies csstree.WhiteSpace);

			widthCalculationsLeft.appendData({
				type: "Dimension",
				unit: bleedverso.right.unit,
				value: bleedverso.right.value
			} satisfies csstree.Dimension);

			// height
			heightCalculationsLeft.appendData({
				type: "Dimension",
				unit: height.unit,
				value: height.value
			} satisfies csstree.Dimension);

			heightCalculationsLeft.appendData({
				type: "WhiteSpace",
				value: " "
			} satisfies csstree.WhiteSpace);

			heightCalculationsLeft.appendData({
				type: "Operator",
				value: "+"
			} satisfies csstree.Operator);

			heightCalculationsLeft.appendData({
				type: "WhiteSpace",
				value: " "
			} satisfies csstree.WhiteSpace);

			heightCalculationsLeft.appendData({
				type: "Dimension",
				unit: bleedverso.top.unit,
				value: bleedverso.top.value
			} satisfies csstree.Dimension);

			heightCalculationsLeft.appendData({
				type: "WhiteSpace",
				value: " "
			} satisfies csstree.WhiteSpace);

			heightCalculationsLeft.appendData({
				type: "Operator",
				value: "+"
			} satisfies csstree.Operator);

			heightCalculationsLeft.appendData({
				type: "WhiteSpace",
				value: " "
			} satisfies csstree.WhiteSpace);

			heightCalculationsLeft.appendData({
				type: "Dimension",
				unit: bleedverso.bottom.unit,
				value: bleedverso.bottom.value
			} satisfies csstree.Dimension);

			dimensionsLeft.appendData({
				type: "Function",
				name: "calc",
				children: widthCalculationsLeft
			} satisfies csstree.FunctionNode);

			dimensionsLeft.appendData({
				type: "WhiteSpace",
				value: " "
			} satisfies csstree.WhiteSpace);

			dimensionsLeft.appendData({
				type: "Function",
				name: "calc",
				children: heightCalculationsLeft
			} satisfies csstree.FunctionNode);

			childrenLeft.appendData({
				type: "Declaration",
				important: false,
				property: "size",
				value: {
					type: "Value",
					children: dimensionsLeft
				}
			} satisfies csstree.Declaration);

			const ruleLeft = ast.children.createItem({
				type: "Atrule",
				prelude: null,
				name: "page :left",
				block: {
					type: "Block",
					loc: null,
					children: childrenLeft
				}
			});

			ast.children.append(ruleLeft);

		}

		if (bleedrecto) {
			const widthCalculationsRight = new csstree.List<csstree.CssNode>();
			const heightCalculationsRight = new csstree.List<csstree.CssNode>();

			// width
			widthCalculationsRight.appendData({
				type: "Dimension",
				unit: width.unit,
				value: width.value
			} satisfies csstree.Dimension);

			widthCalculationsRight.appendData({
				type: "WhiteSpace",
				value: " "
			} satisfies csstree.WhiteSpace);

			widthCalculationsRight.appendData({
				type: "Operator",
				value: "+"
			} satisfies csstree.Operator);

			widthCalculationsRight.appendData({
				type: "WhiteSpace",
				value: " "
			} satisfies csstree.WhiteSpace);

			widthCalculationsRight.appendData({
				type: "Dimension",
				unit: bleedrecto.left.unit,
				value: bleedrecto.left.value
			} satisfies csstree.Dimension);

			widthCalculationsRight.appendData({
				type: "WhiteSpace",
				value: " "
			} satisfies csstree.WhiteSpace);

			widthCalculationsRight.appendData({
				type: "Operator",
				value: "+"
			} satisfies csstree.Operator);

			widthCalculationsRight.appendData({
				type: "WhiteSpace",
				value: " "
			} satisfies csstree.WhiteSpace);

			widthCalculationsRight.appendData({
				type: "Dimension",
				unit: bleedrecto.right.unit,
				value: bleedrecto.right.value
			} satisfies csstree.Dimension);

			// height
			heightCalculationsRight.appendData({
				type: "Dimension",
				unit: height.unit,
				value: height.value
			} satisfies csstree.Dimension);

			heightCalculationsRight.appendData({
				type: "WhiteSpace",
				value: " "
			} satisfies csstree.WhiteSpace);

			heightCalculationsRight.appendData({
				type: "Operator",
				value: "+"
			} satisfies csstree.Operator);

			heightCalculationsRight.appendData({
				type: "WhiteSpace",
				value: " "
			} satisfies csstree.WhiteSpace);

			heightCalculationsRight.appendData({
				type: "Dimension",
				unit: bleedrecto.top.unit,
				value: bleedrecto.top.value
			} satisfies csstree.Dimension);

			heightCalculationsRight.appendData({
				type: "WhiteSpace",
				value: " "
			} satisfies csstree.WhiteSpace);

			heightCalculationsRight.appendData({
				type: "Operator",
				value: "+"
			} satisfies csstree.Operator);

			heightCalculationsRight.appendData({
				type: "WhiteSpace",
				value: " "
			} satisfies csstree.WhiteSpace);

			heightCalculationsRight.appendData({
				type: "Dimension",
				unit: bleedrecto.bottom.unit,
				value: bleedrecto.bottom.value
			} satisfies csstree.Dimension);

			dimensionsRight.appendData({
				type: "Function",
				name: "calc",
				children: widthCalculationsRight
			} satisfies csstree.FunctionNode);

			dimensionsRight.appendData({
				type: "WhiteSpace",
				value: " "
			} satisfies csstree.WhiteSpace);

			dimensionsRight.appendData({
				type: "Function",
				name: "calc",
				children: heightCalculationsRight
			} satisfies csstree.FunctionNode);

			childrenRight.appendData({
				type: "Declaration",
				important: false,
				property: "size",
				value: {
					type: "Value",
					children: dimensionsRight
				}
			} satisfies csstree.Declaration);

			const ruleRight = ast.children.createItem({
				type: "Atrule",
				prelude: null,
				name: "page :right",
				block: {
					type: "Block",
					loc: null,
					children: childrenRight
				}
			} satisfies csstree.Atrule);

			ast.children.append(ruleRight);

		}
	}

	private getNth(nth: string): csstree.Nth {
		const n = nth.indexOf("n");
		const plus = nth.indexOf("+");
		const splitN = nth.split("n");
		const splitP = nth.split("+");
		let a = null;
		let b = null;
		if (n > -1) {
			a = splitN[0];
			if (plus > -1) {
				b = splitP[1];
			}
		} else {
			b = nth;
		}

		return {
			type: "Nth",
			selector: null,
			nth: {
				type: "AnPlusB",
				a,
				b
			}
		} satisfies csstree.Nth;
	}

	private addPageAttributes(page: Page, start: HTMLElement) {
		const namedPages = [start.dataset.page];

		for (const named of namedPages) {
			if (!named) {
				continue;
			}
			page.name = named;
			// TODO: Layout has similar code, but spells "pagedjs" as "pagejs".
			page.element.classList.add("pagedjs_named_page");
			page.element.classList.add("pagedjs_" + named + "_page");

			if (!start.dataset.splitFrom) {
				page.element.classList.add("pagedjs_" + named + "_first_page");
			}
		}
	}

	private getStartElement(content: HTMLElement | DocumentFragment | undefined, breakToken: BreakToken | undefined): HTMLElement | undefined {
		// If we have a breaktoken, we want the first node that will be added next.
		const node = (breakToken?.overflow[0]?.node ?? breakToken?.node) as HTMLElement | undefined;

		if (!content && !breakToken) {
			return undefined;
		}

		// No break
		if (!node) {
			return content.children[0] as HTMLElement | undefined;
		}

		if (breakToken && breakToken.node && breakToken.overflow[0]?.topLevel) {
			return findElement(breakToken.node as HTMLElement, content) as HTMLElement | undefined;
		}

		// Top level element
		if (node.nodeType === Node.ELEMENT_NODE && node.parentNode.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
			return node;
		}

		// Named page
		if (node.nodeType === Node.ELEMENT_NODE && node.dataset.page) {
			return node;
		}

		// Get top level Named parent
		const fragment = rebuildAncestors(node);
		const pages = fragment.querySelectorAll("[data-page]");

		if (pages.length) {
			return pages[pages.length - 1] as HTMLElement;
		} else {
			return fragment.children[0] as HTMLElement;
		}
	}

	beforePageLayout(page: Page, contents: HTMLElement | DocumentFragment | undefined, breakToken: BreakToken | undefined) {
		const start = this.getStartElement(contents, breakToken);
		if (start) {
			this.addPageAttributes(page, start);
		}
		// page.element.querySelector('.paged_area').style.color = red;
	}

	// TODO: this had page and contents swapped.
	afterPageLayout(contents: HTMLElement, _page: Page, _breakToken: BreakToken | undefined, chunker: Chunker) {
		const thisPage = chunker.pages[chunker.pages.length - 1];
		// If only footnotes were added, attribs should be like the previous page.
		const emptyBody = !thisPage.area.firstElementChild || !thisPage.area.firstElementChild.childElementCount || !thisPage.area.firstElementChild.firstElementChild.getBoundingClientRect().height;
		const emptyFootnotes = !thisPage.footnotesArea.firstElementChild.childElementCount || !thisPage.footnotesArea.firstElementChild.firstElementChild.getBoundingClientRect().height;

		if (emptyBody && !emptyFootnotes && chunker.pages.length > 1) {
			// Start element for the previous page.
			const prevBreakToken = chunker.pages[chunker.pages.length - 2].startToken;
			const start = this.getStartElement(contents, prevBreakToken);
			if (start) {
				this.addPageAttributes(thisPage, start);
			}
		}
	}

	finalizePage(_fragment: HTMLElement, page: Page) {
		for (const m in this.marginalia) {
			const margin = this.marginalia[m];
			const sels = m.split(" ");

			if (page.element.matches(sels[0]) && margin.hasContent) {
				const content = page.element.querySelector(sels[1]);
				content.classList.add("hasContent");
			}
		}

		// check center
		["top", "bottom"].forEach((loc) => {
			const marginGroup = page.element.querySelector<HTMLElement>(".pagedjs_margin-" + loc);
			const center = page.element.querySelector<HTMLElement>(".pagedjs_margin-" + loc + "-center");
			const left = page.element.querySelector<HTMLElement>(".pagedjs_margin-" + loc + "-left");
			const right = page.element.querySelector<HTMLElement>(".pagedjs_margin-" + loc + "-right");

			const centerContent = center.classList.contains("hasContent");
			const leftContent = left.classList.contains("hasContent");
			const rightContent = right.classList.contains("hasContent");

			let leftWidth: string | undefined;
			if (leftContent) {
				leftWidth = window.getComputedStyle(left)["max-width"];
			}

			let rightWidth: string | undefined;
			if (rightContent) {
				rightWidth = window.getComputedStyle(right)["max-width"];
			}

			let centerWidth: string | undefined;
			if (centerContent) {
				centerWidth = window.getComputedStyle(center)["max-width"];

				if (centerWidth === "none" || centerWidth === "auto") {
					if (!leftContent && !rightContent) {
						marginGroup.style["grid-template-columns"] = "0 1fr 0";
					} else if (leftContent) {
						if (!rightContent) {
							if (leftWidth !== "none" && leftWidth !== "auto") {
								marginGroup.style["grid-template-columns"] = leftWidth + " 1fr " + leftWidth;
							} else {
								marginGroup.style["grid-template-columns"] = "auto auto 1fr";
								left.style["white-space"] = "nowrap";
								center.style["white-space"] = "nowrap";
								const leftOuterWidth = left.offsetWidth;
								const centerOuterWidth = center.offsetWidth;
								const outerwidths = leftOuterWidth + centerOuterWidth;
								const newcenterWidth = centerOuterWidth * 100 / outerwidths;
								marginGroup.style["grid-template-columns"] = "minmax(16.66%, 1fr) minmax(33%, " + newcenterWidth + "%) minmax(16.66%, 1fr)";
								left.style["white-space"] = "normal";
								center.style["white-space"] = "normal";
							}
						} else {
							if (leftWidth !== "none" && leftWidth !== "auto") {
								if (rightWidth !== "none" && rightWidth !== "auto") {
									marginGroup.style["grid-template-columns"] = leftWidth + " 1fr " + rightWidth;
								} else {
									marginGroup.style["grid-template-columns"] = leftWidth + " 1fr " + leftWidth;
								}
							} else {
								if (rightWidth !== "none" && rightWidth !== "auto") {
									marginGroup.style["grid-template-columns"] = rightWidth + " 1fr " + rightWidth;
								} else {
									marginGroup.style["grid-template-columns"] = "auto auto 1fr";
									left.style["white-space"] = "nowrap";
									center.style["white-space"] = "nowrap";
									right.style["white-space"] = "nowrap";
									const leftOuterWidth = left.offsetWidth;
									const centerOuterWidth = center.offsetWidth;
									const rightOuterWidth = right.offsetWidth;
									const outerwidths = leftOuterWidth + centerOuterWidth + rightOuterWidth;
									const newcenterWidth = centerOuterWidth * 100 / outerwidths;
									if (newcenterWidth > 40) {
										marginGroup.style["grid-template-columns"] = "minmax(16.66%, 1fr) minmax(33%, " + newcenterWidth + "%) minmax(16.66%, 1fr)";
									} else {
										marginGroup.style["grid-template-columns"] = "repeat(3, 1fr)";
									}
									left.style["white-space"] = "normal";
									center.style["white-space"] = "normal";
									right.style["white-space"] = "normal";
								}
							}
						}
					} else {
						if (rightWidth !== "none" && rightWidth !== "auto") {
							marginGroup.style["grid-template-columns"] = rightWidth + " 1fr " + rightWidth;
						} else {
							marginGroup.style["grid-template-columns"] = "auto auto 1fr";
							right.style["white-space"] = "nowrap";
							center.style["white-space"] = "nowrap";
							const rightOuterWidth = right.offsetWidth;
							const centerOuterWidth = center.offsetWidth;
							const outerwidths = rightOuterWidth + centerOuterWidth;
							const newcenterWidth = centerOuterWidth * 100 / outerwidths;
							marginGroup.style["grid-template-columns"] = "minmax(16.66%, 1fr) minmax(33%, " + newcenterWidth + "%) minmax(16.66%, 1fr)";
							right.style["white-space"] = "normal";
							center.style["white-space"] = "normal";
						}
					}
				} else if (centerWidth !== "none" && centerWidth !== "auto") {
					if (leftContent && leftWidth !== "none" && leftWidth !== "auto") {
						marginGroup.style["grid-template-columns"] = leftWidth + " " + centerWidth + " 1fr";
					} else if (rightContent && rightWidth !== "none" && rightWidth !== "auto") {
						marginGroup.style["grid-template-columns"] = "1fr " + centerWidth + " " + rightWidth;
					} else {
						marginGroup.style["grid-template-columns"] = "1fr " + centerWidth + " 1fr";
					}

				}

			} else {
				if (leftContent) {
					if (!rightContent) {
						marginGroup.style["grid-template-columns"] = "1fr 0 0";
					} else {
						if (leftWidth !== "none" && leftWidth !== "auto") {
							if (rightWidth !== "none" && rightWidth !== "auto") {
								marginGroup.style["grid-template-columns"] = leftWidth + " 1fr " + rightWidth;
							} else {
								marginGroup.style["grid-template-columns"] = leftWidth + " 0 1fr";
							}
						} else {
							if (rightWidth !== "none" && rightWidth !== "auto") {
								marginGroup.style["grid-template-columns"] = "1fr 0 " + rightWidth;
							} else {
								marginGroup.style["grid-template-columns"] = "auto 1fr auto";
								left.style["white-space"] = "nowrap";
								right.style["white-space"] = "nowrap";
								const leftOuterWidth = left.offsetWidth;
								const rightOuterWidth = right.offsetWidth;
								const outerwidths = leftOuterWidth + rightOuterWidth;
								const newLeftWidth = leftOuterWidth * 100 / outerwidths;
								marginGroup.style["grid-template-columns"] = "minmax(16.66%, " + newLeftWidth + "%) 0 1fr";
								left.style["white-space"] = "normal";
								right.style["white-space"] = "normal";
							}
						}
					}
				} else {
					if (rightWidth !== "none" && rightWidth !== "auto") {
						marginGroup.style["grid-template-columns"] = "1fr 0 " + rightWidth;
					} else {
						marginGroup.style["grid-template-columns"] = "0 0 1fr";
					}
				}
			}
		});

		// check middle
		["left", "right"].forEach((loc) => {
			const middle = page.element.querySelector<HTMLElement>(".pagedjs_margin-" + loc + "-middle.hasContent");
			const marginGroup = page.element.querySelector<HTMLElement>(".pagedjs_margin-" + loc);
			const top = page.element.querySelector<HTMLElement>(".pagedjs_margin-" + loc + "-top");
			const bottom = page.element.querySelector<HTMLElement>(".pagedjs_margin-" + loc + "-bottom");
			const topContent = top.classList.contains("hasContent");
			const bottomContent = bottom.classList.contains("hasContent");

			let topHeight: string | undefined;
			if (topContent) {
				topHeight = window.getComputedStyle(top)["max-height"];
			}

			let bottomHeight: string | undefined;
			if (bottomContent) {
				bottomHeight = window.getComputedStyle(bottom)["max-height"];
			}

			let middleHeight: string | undefined;
			if (middle) {
				middleHeight = window.getComputedStyle(middle)["max-height"];

				if (middleHeight === "none" || middleHeight === "auto") {
					if (!topContent && !bottomContent) {
						marginGroup.style["grid-template-rows"] = "0 1fr 0";
					} else if (topContent) {
						if (!bottomContent) {
							if (topHeight !== "none" && topHeight !== "auto") {
								marginGroup.style["grid-template-rows"] = topHeight + " calc(100% - " + topHeight + "*2) " + topHeight;
							}
						} else {
							if (topHeight !== "none" && topHeight !== "auto") {
								if (bottomHeight !== "none" && bottomHeight !== "auto") {
									marginGroup.style["grid-template-rows"] = topHeight + " calc(100% - " + topHeight + " - " + bottomHeight + ") " + bottomHeight;
								} else {
									marginGroup.style["grid-template-rows"] = topHeight + " calc(100% - " + topHeight + "*2) " + topHeight;
								}
							} else {
								if (bottomHeight !== "none" && bottomHeight !== "auto") {
									marginGroup.style["grid-template-rows"] = bottomHeight + " calc(100% - " + bottomHeight + "*2) " + bottomHeight;
								}
							}
						}
					} else {
						if (bottomHeight !== "none" && bottomHeight !== "auto") {
							marginGroup.style["grid-template-rows"] = bottomHeight + " calc(100% - " + bottomHeight + "*2) " + bottomHeight;
						}
					}
				} else {
					if (topContent && topHeight !== "none" && topHeight !== "auto") {
						marginGroup.style["grid-template-rows"] = topHeight + " " + middleHeight + " calc(100% - (" + topHeight + " + " + middleHeight + "))";
					} else if (bottomContent && bottomHeight !== "none" && bottomHeight !== "auto") {
						marginGroup.style["grid-template-rows"] = "1fr " + middleHeight + " " + bottomHeight;
					} else {
						marginGroup.style["grid-template-rows"] = "calc((100% - " + middleHeight + ")/2) " + middleHeight + " calc((100% - " + middleHeight + ")/2)";
					}

				}

			} else {
				if (topContent) {
					if (!bottomContent) {
						marginGroup.style["grid-template-rows"] = "1fr 0 0";
					} else {
						if (topHeight !== "none" && topHeight !== "auto") {
							if (bottomHeight !== "none" && bottomHeight !== "auto") {
								marginGroup.style["grid-template-rows"] = topHeight + " 1fr " + bottomHeight;
							} else {
								marginGroup.style["grid-template-rows"] = topHeight + " 0 1fr";
							}
						} else {
							if (bottomHeight !== "none" && bottomHeight !== "auto") {
								marginGroup.style["grid-template-rows"] = "1fr 0 " + bottomHeight;
							} else {
								marginGroup.style["grid-template-rows"] = "1fr 0 1fr";
							}
						}
					}
				} else {
					if (bottomHeight !== "none" && bottomHeight !== "auto") {
						marginGroup.style["grid-template-rows"] = "1fr 0 " + bottomHeight;
					} else {
						marginGroup.style["grid-template-rows"] = "0 0 1fr";
					}
				}
			}



		});

	}

	// CSS Tree Helpers

	private selectorsForPage(page: PageModel) {
		const selectors = new csstree.List<csstree.CssNode>();

		selectors.insertData({
			type: "ClassSelector",
			name: "pagedjs_page"
		} satisfies csstree.ClassSelector);

		// Named page
		if (page.name) {
			selectors.insertData({
				type: "ClassSelector",
				name: "pagedjs_named_page"
			} satisfies csstree.ClassSelector);

			selectors.insertData({
				type: "ClassSelector",
				name: "pagedjs_" + page.name + "_page"
			} satisfies csstree.ClassSelector);
		}

		// PsuedoSelector
		if (page.psuedo && !(page.name && page.psuedo === "first")) {
			selectors.insertData({
				type: "ClassSelector",
				name: "pagedjs_" + page.psuedo + "_page"
			} satisfies csstree.ClassSelector);
		}

		if (page.name && page.psuedo === "first") {
			selectors.insertData({
				type: "ClassSelector",
				name: "pagedjs_" + page.name + "_" + page.psuedo + "_page"
			} satisfies csstree.ClassSelector);
		}

		// Nth
		if (page.nth) {
			const nthlist = new csstree.List<csstree.Nth>();
			const nth = this.getNth(page.nth);

			nthlist.insertData(nth);

			selectors.insertData({
				type: "PseudoClassSelector",
				name: "nth-of-type",
				children: nthlist
			} satisfies csstree.PseudoClassSelector);
		}

		return selectors;
	}

	private selectorsForPageMargin(page: PageModel, margin: string) {
		const selectors = this.selectorsForPage(page);

		selectors.insertData({
			type: "Combinator",
			name: " "
		} satisfies csstree.Combinator);

		selectors.insertData({
			type: "ClassSelector",
			name: "pagedjs_margin-" + margin
		} satisfies csstree.ClassSelector);

		return selectors;
	}

	private createDeclaration(property: string, value: string, important: boolean): csstree.Declaration {
		const children = new csstree.List<csstree.CssNode>();

		children.insertData({
			type: "Identifier",
			name: value
		} satisfies csstree.Identifier);

		return {
			type: "Declaration",
			important,
			property,
			value: {
				type: "Value",
				children
			}
		};
	}

	private createVariable(property: string, value: string): csstree.Declaration {
		return {
			type: "Declaration",
			important: false,
			property: property,
			value: {
				type: "Raw",
				value
			}
		};
	}

	private createCalculatedDimension(property: string, items: csstree.Dimension[], important: boolean, operator = "+") {
		const children = new csstree.List<csstree.CssNode>();
		const calculations = new csstree.List<csstree.CssNode>();

		items.forEach((item, index) => {
			calculations.appendData({
				type: "Dimension",
				unit: item.unit,
				value: item.value
			} satisfies csstree.Dimension);

			calculations.appendData({
				type: "WhiteSpace",
				value: " "
			} satisfies csstree.WhiteSpace);

			if (index + 1 < items.length) {
				calculations.appendData({
					type: "Operator",
					value: operator
				} satisfies csstree.Operator);

				calculations.appendData({
					type: "WhiteSpace",
					value: " "
				} satisfies csstree.WhiteSpace);
			}
		});

		children.insertData({
			type: "Function",
			name: "calc",
			children: calculations
		} satisfies csstree.FunctionNode);

		return {
			type: "Declaration",
			important: important,
			property: property,
			value: {
				type: "Value",
				children
			}
		} satisfies csstree.Declaration;
	}

	private createBlock(declarations: csstree.CssNode[]): csstree.Block {
		const block = new csstree.List<csstree.CssNode>();

		declarations.forEach((declaration) => {
			block.insertData(declaration);
		});

		return {
			type: "Block",
			children: block
		};
	}

	private createRule(selectors: csstree.List<csstree.CssNode>, block: csstree.Block | csstree.Declaration[]): csstree.Rule {
		const selectorList = new csstree.List<csstree.Selector>();
		selectorList.insertData({
			type: "Selector",
			children: selectors
		} satisfies csstree.Selector);

		if (Array.isArray(block)) {
			block = this.createBlock(block);
		}

		return {
			type: "Rule",
			prelude: {
				type: "SelectorList",
				children: selectorList
			},
			block
		};
	}

}

export default AtPage;

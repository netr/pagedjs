import csstree from "css-tree";

import Handler from "../handler";
import type { HooksInterface } from "../handler";
import type Chunker from "../../chunker/chunker";
import type Polisher from "../../polisher/polisher";

class PrintMedia extends Handler implements HooksInterface<Chunker["hooks"] & Polisher["hooks"]> {
	onAtMedia(node: csstree.Atrule, item: csstree.ListItem<csstree.CssNode>, list: csstree.List<csstree.CssNode>) {
		const media = this.getMediaName(node);
		let rules: csstree.List<csstree.CssNode> | undefined;
		if (media.includes("print")) {
			rules = node.block.children;

			// Append rules to the end of main rules list
			// TODO: this isn't working right, needs to check what is in the prelude
			/*
			rules.forEach((selectList) => {
				if (selectList.prelude) {
					selectList.prelude.children.forEach((rule) => {

						rule.children.prependData({
							type: "Combinator",
							name: " "
						});

						rule.children.prependData({
							type: "ClassSelector",
							name: "pagedjs_page"
						});
					});
				}
			});

			list.insertList(rules, item);
			*/

			// Append rules to the end of main rules list
			list.appendList(rules);

			// Remove rules from the @media block
			list.remove(item);
		} else if (!media.includes("all") && !media.includes("pagedjs-ignore")) {
			list.remove(item);
		}

	}

	private getMediaName(node: csstree.Atrule) {
		const media: string[] = [];

		if (typeof node.prelude === "undefined" ||
				node.prelude.type !== "AtrulePrelude" ) {
			return media;
		}

		csstree.walk(node.prelude, {
			visit: "Identifier",
			enter: (identNode) => {
				media.push(identNode.name);
			},
		});
		return media;
	}


}

export default PrintMedia;

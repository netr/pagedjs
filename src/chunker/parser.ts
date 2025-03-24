import {UUID} from "../utils/utils";

/**
 * Render a flow of text offscreen
 * @class
 */
class ContentParser {
	public dom: HTMLElement | DocumentFragment | undefined;

	public constructor(content: HTMLElement | DocumentFragment | string) {
		if (typeof content === "string") {
			this.dom = this.parse(content);
		} else {
			// handle dom
			this.dom = this.add(content);
		}
	}

	private parse(markup: string) {
		const range = document.createRange();
		const fragment = range.createContextualFragment(markup);

		this.addRefs(fragment);

		return fragment;
	}

	private add(contents: HTMLElement | DocumentFragment) {
		this.addRefs(contents);

		return contents;
	}

	private addRefs(content: DocumentFragment | HTMLElement) {
		const treeWalker = document.createTreeWalker(
			content,
			NodeFilter.SHOW_ELEMENT,
			null
		);

		let node = treeWalker.nextNode() as HTMLElement;
		while(node) {

			if (!node.hasAttribute("data-ref")) {
				const uuid = UUID();
				node.setAttribute("data-ref", uuid);
			}

			if (node.id) {
				node.setAttribute("data-id", node.id);
			}

			node = treeWalker.nextNode() as HTMLElement;
		}
	}

	destroy() {
		this.dom = undefined;
	}
}

export default ContentParser;

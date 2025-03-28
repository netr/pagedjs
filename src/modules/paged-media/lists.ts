import Handler from "../handler";
import type { HooksInterface } from "../handler";
import type Chunker from "../../chunker/chunker";
import type Polisher from "../../polisher/polisher";

class Lists extends Handler implements HooksInterface<Chunker["hooks"] & Polisher["hooks"]> {
	afterParsed(content: HTMLElement | DocumentFragment) {
		const orderedLists = content.querySelectorAll("ol");

		for (const list of orderedLists) {
			this.addDataNumbers(list);
		}
	}

	afterPageLayout(pageElement: HTMLElement) {
		const orderedLists = pageElement.getElementsByTagName("ol");
		for (const list of orderedLists) {
			if (list.firstElementChild) {
				list.start = parseInt((list.firstElementChild as HTMLLIElement).dataset.itemNum);
			}
		}
	}

	addDataNumbers(list: HTMLOListElement) {
		let start = 1;
		if (list.hasAttribute("start")) {
			start = parseInt(list.getAttribute("start"), 10);
			if (isNaN(start)) {
				start = 1;
			}
		}
		const items = list.children;
		for (let i = 0; i < items.length; i++) {
			items[i].setAttribute("data-item-num", String(i + start));
		}
	}

}

export default Lists;

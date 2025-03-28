import Handler from "../handler";
import type { HooksInterface } from "../handler";
import type Chunker from "../../chunker/chunker";
import type Polisher from "../../polisher/polisher";

class Splits extends Handler implements HooksInterface<Chunker["hooks"] & Polisher["hooks"]> {
	afterPageLayout(pageElement: HTMLElement) {
		const splits = Array.from(pageElement.querySelectorAll<HTMLElement>("[data-split-from]"));
		const pages = pageElement.parentNode as HTMLElement;
		const index = Array.prototype.indexOf.call(pages.children, pageElement);

		if (index === 0) {
			return;
		}

		const prevPage = pages.children[index - 1];

		let from: HTMLElement | undefined; // Capture the last from element
		splits.forEach((split) => {
			const ref = split.dataset.ref;
			from = prevPage.querySelector<HTMLElement>("[data-ref='"+ ref +"']");

			if (from) {
				from.dataset.splitTo = ref;

				if (!from.dataset.splitFrom) {
					from.dataset.splitOriginal = "true";
				}
			}
		});

		// Fix alignment on the deepest split element
		if (from) {
			this.handleAlignment(from);
		}
	}

	handleAlignment(node: HTMLElement) {
		const styles = window.getComputedStyle(node);
		const align = styles["text-align"];
		const alignLast = styles["text-align-last"];
		node.dataset.lastSplitElement = "true";
		if (align === "justify" && alignLast === "auto") {
			node.dataset.alignLastSplitElement = "justify";
		} else {
			node.dataset.alignLastSplitElement = alignLast;
		}
	}

}

export default Splits;

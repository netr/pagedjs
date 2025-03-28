import Handler from "../handler";
import type { HooksInterface } from "../handler";
import type Chunker from "../../chunker/chunker";
import type Polisher from "../../polisher/polisher";

class ScriptsFilter extends Handler implements HooksInterface<Chunker["hooks"] & Polisher["hooks"]> {
	filter(content: HTMLElement | DocumentFragment) {
		content.querySelectorAll("script").forEach(script => script.remove());
	}

}

export default ScriptsFilter;

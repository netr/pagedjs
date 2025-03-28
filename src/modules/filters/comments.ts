import Handler from "../handler";
import type { HooksInterface } from "../handler";
import type Chunker from "../../chunker/chunker";
import type Polisher from "../../polisher/polisher";
import {filterTree} from "../../utils/dom";

class CommentsFilter extends Handler implements HooksInterface<Chunker["hooks"] & Polisher["hooks"]> {
	filter(content: HTMLElement | DocumentFragment) {
		filterTree(content, null, NodeFilter.SHOW_COMMENT);
	}

}

export default CommentsFilter;

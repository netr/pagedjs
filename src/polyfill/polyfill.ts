import Previewer from "./previewer";
import type { PreviewChunker, PreviewerOptions } from "./previewer";
import * as Paged from "../index";

export interface PagedConfig {
	auto?: boolean;
	before?(): Promise<void> | void;
	after?(done: PreviewChunker | undefined): Promise<void> | void;
	content?: HTMLElement;
	stylesheets?: (string | Record<string, string>)[];
	renderTo?: HTMLElement;
	settings?: PreviewerOptions;
}

declare global {
	interface Window {
		PagedConfig: PagedConfig;
		Paged: typeof Paged;
	}
}

window.Paged = Paged;

const ready = new Promise(function(resolve) {
	if (document.readyState === "interactive" || document.readyState === "complete") {
		resolve(document.readyState);
		return;
	}

	document.onreadystatechange = function () {
		if (document.readyState === "interactive") {
			resolve(document.readyState);
		}
	};
});

const config: PagedConfig = window.PagedConfig ?? {
	auto: true,
};

const previewer = new Previewer(config.settings);

ready.then(async function () {
	await config.before?.();

	let done: PreviewChunker | undefined;
	if(config.auto !== false) {
		done = await previewer.preview(config.content, config.stylesheets, config.renderTo);
	}

	await config.after?.(done);
});

export default previewer;

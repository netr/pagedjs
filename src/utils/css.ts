export function cleanPseudoContent(el: string | null, trim = "\"' ") {
	if(el == null) return;
	return el
		.replace(new RegExp(`^[${trim}]+`), "")
		.replace(new RegExp(`[${trim}]+$`), "")
		.replace(/["']/g, match => {
			return "\\" + match;
		})
		.replace(/[\n]/g, "\\00000A");
}

export function cleanSelector(el: string | null) {
	if(el == null) return;
	return el
		.replace(new RegExp("::footnote-call", "g"), "")
		.replace(new RegExp("::footnote-marker", "g"), "");
}

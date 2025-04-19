export interface RequestOptions {
	method?: string;
	headers?: Record<string, string>;
	credentials?: "include";
	body?: Document | XMLHttpRequestBodyInit;
}

export default async function request(url: string, options: RequestOptions = {}) {
	return new Promise<Response>(function(resolve, reject) {
		const request = new XMLHttpRequest();

		request.open(options.method ?? "get", url, true);

		for (const i in options.headers) {
			request.setRequestHeader(i, options.headers[i]);
		}

		request.withCredentials = options.credentials === "include";

		request.onload = () => {
			// Chrome returns a status code of 0 for local files
			const status = request.status === 0 && url.startsWith("file://") ? 200 : request.status;
			if (status === 200) {
				resolve(new Response(request.responseText, {status}));
			} else {
				reject(new Response(request.responseText, {status}));
			}
		};

		request.onerror = reject;

		request.send(options.body ?? null);
	});
}

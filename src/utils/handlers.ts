import EventEmitter from "event-emitter";
import type { Emitter } from "event-emitter";
import pipe from "event-emitter/pipe";

import pagedMediaHandlers from "../modules/paged-media/index.js";
import generatedContentHandlers from "../modules/generated-content/index.js";
import filters from "../modules/filters/index.js";
import type Hook from "./hook";
import type Chunker from "../chunker/chunker";
import type Polisher from "../polisher/polisher";

export interface HandlerCaller {
	hooks?: Record<string, Hook>;
}

export interface HandlerConstructor<Handler extends Emitter = Emitter> {
	new(chunker: Chunker, polisher: Polisher, caller: HandlerCaller): Handler;
}

export const registeredHandlers: HandlerConstructor[] = [...pagedMediaHandlers, ...generatedContentHandlers, ...filters];

// Due to EventEmitter:
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class Handlers {
	public constructor(chunker: Chunker, polisher: Polisher, caller: HandlerCaller) {
		registeredHandlers.forEach((Handler) => {
			const handler = new Handler(chunker, polisher, caller);
			pipe(handler, this);
		});
	}
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unsafe-declaration-merging
export declare interface Handlers extends Emitter {}

EventEmitter(Handlers.prototype);

export function registerHandlers(...args: HandlerConstructor[]) {
	registeredHandlers.push(...args);
}

export function initializeHandlers(chunker: Chunker, polisher: Polisher, caller: HandlerCaller) {
	return new Handlers(chunker, polisher, caller);
}

import pagedMediaHandlers from "../modules/paged-media/index.js";
import generatedContentHandlers from "../modules/generated-content";
import filters from "../modules/filters/index.js";
import { EventEmitter } from "./event-emitter";
import type { EventMapBase } from "./event-emitter";
import { pipe } from "./event-emitter-pipe";
import type Hook from "./hook";
import type Chunker from "../chunker/chunker";
import type Polisher from "../polisher/polisher";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyHook = Hook<any[], any>;

export type NoHooks = {} & Record<string, AnyHook>;

export interface HandlerCaller<Hooks extends Record<string, AnyHook>> {
	hooks?: Hooks;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface HandlerConstructor<Handler extends EventEmitter<EventMapBase>, Hooks extends Record<string, AnyHook> = NoHooks> {
	new(chunker: Chunker, polisher: Polisher, caller: HandlerCaller<Hooks>): Handler;
}

export const registeredHandlers: HandlerConstructor<EventEmitter<EventMapBase>>[] = [...pagedMediaHandlers, ...generatedContentHandlers, ...filters];

export class Handlers<EventMap extends EventMapBase = {} & EventMapBase, Hooks extends Record<string, AnyHook> = NoHooks> extends EventEmitter<EventMap> {
	public constructor(chunker: Chunker, polisher: Polisher, caller: HandlerCaller<Hooks>) {
		super();

		registeredHandlers.forEach((Handler) => {
			const handler = new Handler(chunker, polisher, caller);
			pipe(handler, this);
		});
	}
}

export function registerHandlers(...args: HandlerConstructor<EventEmitter<EventMapBase>>[]) {
	registeredHandlers.push(...args);
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export function initializeHandlers<EventMap extends EventMapBase = {}, Hooks extends Record<string, AnyHook> = {}>(chunker: Chunker, polisher: Polisher, caller: HandlerCaller<Hooks>) {
	return new Handlers<EventMap>(chunker, polisher, caller);
}

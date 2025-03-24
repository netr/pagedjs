import EventEmitter from "event-emitter";
import type { Emitter } from "event-emitter";
import pipe from "event-emitter/pipe";

import pagedMediaHandlers from "../modules/paged-media/index.js";
import generatedContentHandlers from "../modules/generated-content/index.js";
import filters from "../modules/filters/index.js";
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
export interface HandlerConstructor<Handler extends Emitter = Emitter, Hooks extends Record<string, AnyHook> = {}> {
	new(chunker: Chunker, polisher: Polisher, caller: HandlerCaller<Hooks>): Handler;
}

export const registeredHandlers: HandlerConstructor[] = [...pagedMediaHandlers, ...generatedContentHandlers, ...filters];

// Due to EventEmitter (declaration-merging):
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging, @typescript-eslint/no-empty-object-type
export class Handlers<Hooks extends Record<string, AnyHook> = {}> {
	public constructor(chunker: Chunker, polisher: Polisher, caller: HandlerCaller<Hooks>) {
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

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export function initializeHandlers<Hooks extends Record<string, AnyHook> = {}>(chunker: Chunker, polisher: Polisher, caller: HandlerCaller<Hooks>) {
	return new Handlers(chunker, polisher, caller);
}

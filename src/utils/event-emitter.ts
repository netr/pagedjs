// Type-safe handling of EventEmitter.

import EventEmitter_ from "event-emitter";
import type { EventListener } from "event-emitter";

export type EventMapBase = Record<string, EventListener> | ({} & object);

/** Wraps EventEmitter as a Typescript class with a map of event types.
 *
 * ## Example
 *
 *    interface MyEventMap {
 *      doing(emitter: MyEmitter): void;
 *      done(result: boolean, emitter: MyEmitter): void;
 *    }
 *
 *    class MyEmitter extends EventEmitter<MyEventMap> {
 *      public doSomething() {
 *        this.emit("doing", this);
 *        this.emit("done", true, this);
 *      }
 *    }
 */
export class EventEmitter<EventMap extends EventMapBase> {
	public constructor() {
		EventEmitter_(this);
	}

	// @ts-expect-error implementation injected by EventEmitter_.
	public off<E extends string & keyof EventMap>(type: E, listener: EventMap[E]): void;

	// @ts-expect-error implementation injected by EventEmitter_.
	public on<E extends string & keyof EventMap>(type: E, listener: EventMap[E]): void;

	// @ts-expect-error implementation injected by EventEmitter_.
	public once<E extends string & keyof EventMap>(type: E, listener: EventMap[E]): void;

	// @ts-expect-error implementation injected by EventEmitter_.
	protected emit<E extends string & keyof EventMap>(type: E, ...args: Parameters<EventMap[E]>): void;
}

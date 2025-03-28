import type Chunker from "../chunker/chunker";
import type Polisher from "../polisher/polisher";
import { EventEmitter } from "../utils/event-emitter";
import type { EventMapBase } from "../utils/event-emitter";
import type { AnyHook, HandlerCaller, NoHooks } from "../utils/handlers";

export type HooksInterface<Hooks extends Record<string, AnyHook>> = {
	[K in keyof Hooks]?: Parameters<Hooks[K]["register"]>[0]
};

class Handler<EventMap extends EventMapBase = {} & EventMapBase, Hooks extends Record<string, AnyHook> = NoHooks> extends EventEmitter<EventMap> {
	public constructor(
		private readonly chunker: Chunker,
		private readonly polisher: Polisher,
		private readonly caller: HandlerCaller<Hooks>) {
		super();

		const hooks = {
			...(chunker && chunker.hooks),
			...(polisher && polisher.hooks),
			...(caller && caller.hooks),
		};

		for (const name in hooks) {
			if (name in this) {
				const hook = hooks[name];
				hook.register(this[name].bind(this));
			}
		}
	}
}

export default Handler;

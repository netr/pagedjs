import type { Emitter } from "event-emitter";
import pipe_ from "event-emitter/pipe";

import { EventEmitter, EventMapBase } from "./event-emitter";

export function pipe<SourceEventMap extends EventMapBase, TargetEventMap extends SourceEventMap>(source: EventEmitter<SourceEventMap>, target: EventEmitter<TargetEventMap>, emitMethodName?: string | symbol) {
	return pipe_(source as unknown as Emitter, target as unknown as Emitter, emitMethodName);
}

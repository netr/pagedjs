import type BreakToken from "./breaktoken";

/**
 * Render result.
 * @class
 */
class RenderResult {

	public constructor(breakToken: BreakToken);
	public constructor(breakToken: undefined, error: Error | string);
	public constructor(public readonly breakToken?: BreakToken, public readonly error?: Error | string) {}
}

export class OverflowContentError extends Error {
	public constructor(message: string, public readonly items: HTMLElement[]) {
		super(message);
	}
}

export default RenderResult;

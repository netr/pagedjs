/**
 * BreakToken
 * @class
 */
class BreakToken {
	private finished = false;
	private breakNeededAt: HTMLElement[] = [];

	public constructor(public readonly node: Text | HTMLElement, public readonly overflow: Overflow[] = []) {}

	equals(otherBreakToken: BreakToken) {
		if (this.node !== otherBreakToken.node) {
			return false;
		}

		if (otherBreakToken.overflow.length !== this.overflow.length) {
			return false;
		}

		for (const index in this.overflow) {
			if (!this.overflow[index].equals(otherBreakToken.overflow[index])) {
				return false;
			}
		}

		const otherQueue = otherBreakToken.getForcedBreakQueue();
		for (const index in this.breakNeededAt) {
			if (!this.breakNeededAt[index].isEqualNode(otherQueue[index])) {
				return false;
			}
		}

		return true;
	}

	public setFinished() {
		this.finished = true;
	}

	public isFinished() {
		return this.finished;
	}

	public addNeedsBreak(needsBreak: HTMLElement) {
		this.breakNeededAt.push(needsBreak);
	}

	public getNextNeedsBreak() {
		return this.breakNeededAt.shift();
	}

	public getForcedBreakQueue() {
		return this.breakNeededAt;
	}

	public setForcedBreakQueue(queue: HTMLElement[]) {
		return this.breakNeededAt = queue;
	}
}

export default BreakToken;

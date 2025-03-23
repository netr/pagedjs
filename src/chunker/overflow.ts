/**
 * Overflow
 * @class
 */
class Overflow {

	public constructor(
		public readonly node: Text | HTMLElement | DocumentFragment,
		public readonly offset: number,
		public readonly overflowHeight: number,
		public readonly range: Range,
		public readonly topLevel: boolean) {}

	equals(otherOffset: Overflow | undefined | null) {
		if (!otherOffset) {
			return false;
		}
		if (this["node"] && otherOffset["node"] &&
			this["node"] !== otherOffset["node"]) {
			return false;
		}
		if (this["offset"] && otherOffset["offset"] &&
			this["offset"] !== otherOffset["offset"]) {
			return false;
		}
		return true;
	}

}

export default Overflow;

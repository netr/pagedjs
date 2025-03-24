// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HookFunction<Args extends any[], Result = void, Context = any> = (this: Context, ...args: Args) => Result | Promise<Result>;

/**
 * Hooks allow for injecting functions that must all complete in order before finishing
 * They will execute in parallel but all must finish before continuing
 * Functions may return a promise if they are asycn.
 * From epubjs/src/utils/hooks
 * @example this.content = new Hook(this);
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
class Hook<Args extends any[], Result = void, Context = any> {
	private hooks: HookFunction<Args, Result>[] = [];

	public constructor(private readonly context: Context = this as unknown as Context) {}

	/**
	 * Adds functions to be run before a hook completes
	 * @example this.content.register(function(){...});
	 * @returns void
	 */
	public register(...funcs: (HookFunction<Args, Result> | HookFunction<Args, Result>[])[]) {
		for(const funcOrArray of funcs) {
			if (typeof funcOrArray === "function") {
				this.hooks.push(funcOrArray);
			} else {
				// unpack array
				this.hooks.push(...funcOrArray);
			}
		}
	}

	/**
	 * Triggers a hook to run all functions
	 * @example this.content.trigger(args).then(function(){...});
	 * @return results
	 */
	public trigger(...args: Args) {
		const context = this.context;

		return Promise.all(this.hooks.map(function(task): Result | Promise<Result> {
			return task.apply(context, args);
		}));
	}

	/**
   * Triggers a hook to run all functions synchronously
   * @return results
   */
	public triggerSync(...args: Args) {
		const context = this.context;
		const results: Result[] = [];

		this.hooks.forEach(function(task) {
			const executing: Result = task.apply(context, args);

			results.push(executing);
		});


		return results;
	}

	public list() {
		return this.hooks;
	}

	public clear() {
		this.hooks = [];
	}
}

export default Hook;

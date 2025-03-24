import { defer } from "./utils.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QueueTask<Args extends any[], Result = void, Context = any> = (this: Context, ...args: Args) => Result | Promise<Result>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QueuedItem<Args extends any[], Result = void, Context = any> = {
	task: QueueTask<Args, Result, Context>;
	args: Args;
	deferred: defer;
	promise: Promise<Result>;
} | {
	promise: Promise<Result>;
};

/**
 * Queue for handling tasks one at a time
 * @class
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
class Queue<Args extends any[], Result = void, Context = any> {
	private readonly tick: (fun: () => void) => void = requestAnimationFrame;
	private _q: QueuedItem<Args, Result, Context>[] = [];
	private running: Promise<Result> | boolean | undefined = false;
	private paused = false;
	private defered?: defer;

	public constructor(private readonly context: Context) {}

	/**
	 * Add an item to the queue
	 * @param task The function or Promise to wait for.
	 * @param args Arguments to task, if it's a function.
	 * @return the task's result.
	 */
	public enqueue<ThisResult extends Result>(task: QueueTask<Args, ThisResult, Context> | Promise<ThisResult>, ...args: Args): Promise<ThisResult> {
		let queued: QueuedItem<Args, ThisResult, Context> | undefined;

		if (typeof task === "function") {

			const deferred = new defer();

			queued = {
				task: task,
				args: args,
				deferred: deferred,
				promise: deferred.promise,
			};

		} else {
			// Task is a promise
			queued = {
				promise: task,
			};

		}

		this._q.push(queued);

		// Wait to start queue flush
		if (!this.paused && !this.running) {
			this.run();
		}

		return queued.promise;
	}

	/**
	 * Run one item
	 * @return the task's result or undefined.
	 */
	private async dequeue(): Promise<Result> {
		if (this._q.length && !this.paused) {
			const inwait = this._q.shift();
			if ("task" in inwait) {
				try {
					const result: Result = await inwait.task.apply(this.context, inwait.args);

					await inwait.deferred.resolve.call(this.context, result);
				} catch (err) {
					inwait.deferred.reject.call(this.context, err);
				}

				return inwait.deferred.promise;
			} else if (inwait.promise) {
				// Task is a promise
				return await inwait.promise;
			}

		} else {
			return undefined;
		}

	}

	// Run All Immediately
	private dump() {
		while (this._q.length) {
			this.dequeue();
		}
	}

	/**
	 * Run all tasks sequentially, at convince
	 * @return all run
	 */
	private run() {

		if (!this.running){
			this.running = true;
			this.defered = new defer();
		}

		this.tick.call(window, () => {

			if (this._q.length) {

				this.dequeue().then(() => this.run());

			} else {
				this.defered.resolve();
				this.running = undefined;
			}

		});

		// Unpause
		if (this.paused) {
			this.paused = false;
		}

		return this.defered.promise;
	}

	/**
	 * Flush all, as quickly as possible
	 * @return ran
	 */
	private flush() {

		if (this.running){
			return this.running;
		}

		if (this._q.length) {
			this.running = this.dequeue()
				.then(() => {
					this.running = undefined;
					return this.flush();
				});

			return this.running;
		}

	}

	/**
	 * Clear all items in wait
	 * @return void
	 */
	public clear() {
		this._q = [];
	}

	/**
	 * Get the number of tasks in the queue
	 * @return tasks
	 */
	public length() {
		return this._q.length;
	}

	/**
	 * Pause a running queue
	 * @return void
	 */
	public pause() {
		this.paused = true;
	}

	/**
	 * End the queue
	 * @return void
	 */
	public stop() {
		this._q = [];
		this.running = false;
		this.paused = true;
	}
}

export default Queue;

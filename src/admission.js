export class GateAdmissionController {
  #active = 0;

  constructor({ maximumConcurrent = 4, retryAfterMs = 1_000 } = {}) {
    if (!Number.isSafeInteger(maximumConcurrent) || maximumConcurrent < 1) throw new Error("invalid_maximum_concurrent");
    if (!Number.isSafeInteger(retryAfterMs) || retryAfterMs < 0) throw new Error("invalid_retry_after");
    this.maximumConcurrent = maximumConcurrent;
    this.retryAfterMs = retryAfterMs;
  }

  get active() {
    return this.#active;
  }

  async run(operation) {
    if (typeof operation !== "function") throw new TypeError("operation_function_required");
    if (this.#active >= this.maximumConcurrent) {
      return {
        admitted: false,
        reason: "over_capacity",
        retryAfterMs: this.retryAfterMs,
      };
    }
    this.#active += 1;
    try {
      return { admitted: true, value: await operation() };
    } finally {
      this.#active -= 1;
    }
  }
}

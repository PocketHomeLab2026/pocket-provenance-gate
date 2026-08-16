import test from "node:test";
import assert from "node:assert/strict";
import { GateAdmissionController } from "../src/admission.js";

test("the admission controller sheds overload without queueing or running it", async () => {
  const controller = new GateAdmissionController({ maximumConcurrent: 1, retryAfterMs: 250 });
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let overloadedOperationRan = false;
  const first = controller.run(async () => held);
  const overloaded = await controller.run(() => {
    overloadedOperationRan = true;
    return "must-not-run";
  });
  assert.deepEqual(overloaded, { admitted: false, reason: "over_capacity", retryAfterMs: 250 });
  assert.equal(overloadedOperationRan, false);
  release("finished");
  assert.deepEqual(await first, { admitted: true, value: "finished" });
  assert.equal(controller.active, 0);
});

test("operation failures release their concurrency slot", async () => {
  const controller = new GateAdmissionController({ maximumConcurrent: 1 });
  await assert.rejects(controller.run(() => { throw new Error("failed"); }), /failed/u);
  assert.equal(controller.active, 0);
  assert.deepEqual(await controller.run(() => "next"), { admitted: true, value: "next" });
});

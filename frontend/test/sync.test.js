import { test } from "node:test";
import assert from "node:assert/strict";
import { wordSchedule } from "../js/sync.js";

test("schedule has one slot per word", () => {
  assert.equal(wordSchedule(["one", "two", "three"], 3).length, 3);
});

test("schedule starts at zero and ends at duration", () => {
  const s = wordSchedule(["one", "two", "three"], 3);
  assert.equal(s[0].start, 0);
  assert.ok(Math.abs(s.at(-1).end - 3) < 1e-9);
});

test("schedule is monotonic and contiguous", () => {
  const s = wordSchedule(["alpha", "b", "gamma", "d"], 4);
  for (let i = 0; i < s.length; i++) {
    assert.ok(s[i].end >= s[i].start);
    if (i > 0) assert.ok(Math.abs(s[i].start - s[i - 1].end) < 1e-9);
  }
});

test("longer words get more time than shorter words", () => {
  const s = wordSchedule(["a", "elephant"], 2);
  assert.ok(s[1].end - s[1].start > s[0].end - s[0].start);
});

test("a sentence-final period adds extra dwell time", () => {
  const plain = wordSchedule(["cat", "cat"], 2);
  const ended = wordSchedule(["cat", "cat."], 2);
  assert.ok(ended[1].end - ended[1].start > plain[1].end - plain[1].start);
});

test("empty word list returns empty schedule", () => {
  assert.deepEqual(wordSchedule([], 3), []);
});

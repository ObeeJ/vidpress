import { test, expect } from "bun:test";
import { bytes, duration, ratio } from "./format";

test("bytes uses binary units with two decimals", () => {
  expect(bytes(0)).toBe("0 B");
  expect(bytes(1024)).toBe("1.00 KB");
  expect(bytes(1_331_691_945)).toBe("1.24 GB");
});

test("ratio returns a true minus sign and handles zero", () => {
  expect(ratio(1000, 120)).toBe("−88%");
  expect(ratio(0, 0)).toBe("-");
});

test("duration formats as m:ss", () => {
  expect(duration(138)).toBe("2:18");
  expect(duration(0)).toBe("0:00");
});

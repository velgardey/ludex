import { pollDelay } from "../src/sync/poll";
it("backs foreground errors off from 30 to 60 to 120 seconds", () => {
  expect(pollDelay(0)).toBe(30000);
  expect(pollDelay(1)).toBe(60000);
  expect(pollDelay(2)).toBe(120000);
  expect(pollDelay(9)).toBe(120000);
});
it("honors the API retry-after minimum", () => {
  expect(pollDelay(0, 180)).toBe(180000);
});

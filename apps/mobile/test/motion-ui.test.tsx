import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import * as Reanimated from "react-native-reanimated";
import { useLudex } from "../src/state";
import { MotionPressable } from "../src/ui";

jest.mock("../src/state", () => ({
  useLudex: jest.fn(),
}));

const useLudexMock = jest.mocked(useLudex);

test("enabling reduced motion resets an active press without animating release", () => {
  const value = { current: 1 };
  const sharedValue = {
    get: () => value.current,
    set: (next: number) => {
      value.current = next;
    },
  } as unknown as Reanimated.SharedValue<unknown>;
  jest.spyOn(Reanimated, "useSharedValue").mockReturnValue(sharedValue);
  const cancelAnimation = jest.spyOn(Reanimated, "cancelAnimation");
  const withTiming = jest.spyOn(Reanimated, "withTiming");
  useLudexMock.mockReturnValue({ reducedMotion: false } as ReturnType<
    typeof useLudex
  >);

  const screen = render(<MotionPressable testID="target">Save</MotionPressable>);
  fireEvent(screen.getByTestId("target"), "pressIn");
  expect(value.current).toBe(0.975);

  useLudexMock.mockReturnValue({ reducedMotion: true } as ReturnType<
    typeof useLudex
  >);
  screen.rerender(<MotionPressable testID="target">Save</MotionPressable>);
  expect(cancelAnimation.mock.calls[0]?.[0]).toBe(sharedValue);
  expect(value.current).toBe(1);

  fireEvent(screen.getByTestId("target"), "pressOut");
  expect(withTiming).toHaveBeenCalledTimes(1);
  expect(value.current).toBe(1);
});

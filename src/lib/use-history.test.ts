// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useHistory } from "@/lib/use-history";

describe("useHistory", () => {
  it("records updates and supports undo/redo", () => {
    const { result } = renderHook(() => useHistory<number[]>([]));

    act(() => result.current[1]([1]));
    act(() => result.current[1]([1, 2]));
    expect(result.current[0]).toEqual([1, 2]);
    expect(result.current[4]).toBe(true); // canUndo

    act(() => result.current[2]()); // undo
    expect(result.current[0]).toEqual([1]);
    expect(result.current[5]).toBe(true); // canRedo

    act(() => result.current[3]()); // redo
    expect(result.current[0]).toEqual([1, 2]);
  });

  it("a setState captured early (stale closure) still produces correct state", () => {
    const { result } = renderHook(() => useHistory<number>(0));
    const earlySetState = result.current[1];

    act(() => result.current[1](prev => prev + 1));
    act(() => result.current[1](prev => prev + 1));
    // The setState reference from the first render must see the latest state.
    act(() => earlySetState(prev => prev + 1));

    expect(result.current[0]).toBe(3);
  });

  it("concurrent setState calls in one batch don't lose updates", () => {
    const { result } = renderHook(() => useHistory<number[]>([]));

    act(() => {
      result.current[1](prev => [...prev, 1]);
      result.current[1](prev => [...prev, 2]);
    });

    expect(result.current[0]).toEqual([1, 2]);
    // Both updates recorded as separate undo steps.
    act(() => result.current[2]());
    expect(result.current[0]).toEqual([1]);
  });

  it("editing after undo discards the redo branch", () => {
    const { result } = renderHook(() => useHistory<string>("a"));

    act(() => result.current[1]("b"));
    act(() => result.current[1]("c"));
    act(() => result.current[2]()); // undo -> "b"
    act(() => result.current[1]("d"));

    expect(result.current[0]).toBe("d");
    expect(result.current[5]).toBe(false); // redo branch gone
    act(() => result.current[2]());
    expect(result.current[0]).toBe("b");
  });

  it("clone failure does not crash and still applies the update", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    type Circular = { name: string; self?: unknown };
    const { result } = renderHook(() => useHistory<Circular>({ name: "init" }));

    const circular: Circular = { name: "loop" };
    circular.self = circular; // JSON.stringify will throw

    act(() => result.current[1](circular));

    expect(result.current[0].name).toBe("loop");
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

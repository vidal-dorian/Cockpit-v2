import { vi } from "vitest";

/** Stubs window.matchMedia as a viewport of `width` px: it answers the min-width and max-width queries (jsdom has no layout). Reset it with vi.unstubAllGlobals(). */
export function stubWidth(width: number) {
  vi.stubGlobal("matchMedia", (query: string) => {
    const min = /\(min-width:\s*(\d+)px\)/.exec(query);
    const max = /\(max-width:\s*(\d+(?:\.\d+)?)px\)/.exec(query);
    return {
      media: query,
      matches:
        (!min || width >= Number(min[1])) && (!max || width <= Number(max[1])),
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    };
  });
}

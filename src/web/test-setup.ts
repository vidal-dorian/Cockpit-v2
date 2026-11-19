import { configure } from "@testing-library/react";

// The screens load through stubbed fetches and lazy chunks: on a busy machine running the whole suite
// they can take more than the default 1 s of findBy/waitFor.
configure({ asyncUtilTimeout: 5000 });

// React Flow measures its container with browser APIs jsdom lacks: the smallest stand-ins.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
globalThis.DOMMatrixReadOnly ??= class {
  m22 = 1;
} as unknown as typeof DOMMatrixReadOnly;

// jsdom has no showModal/close on <dialog> (decision 073's windows use them): the smallest stand-ins, in the jsdom files only.
const dialog = globalThis.HTMLDialogElement?.prototype;
if (dialog) {
  dialog.showModal ??= function showModal() {
    this.setAttribute("open", "");
  };
  dialog.close ??= function close() {
    this.removeAttribute("open");
  };
}

// jsdom has no scrollIntoView (decision 084 H: a card opened on a phone scrolls its panel into view).
if (globalThis.Element) Element.prototype.scrollIntoView ??= () => {};

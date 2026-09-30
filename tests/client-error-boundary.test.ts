import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ErrorFallback, PanelErrorBoundary } from "@/components/product/error-fallback";
import CabinetError from "@/app/app/error";

describe("ErrorFallback", () => {
  it("renders the Russian recoverable error copy with retry and reload", () => {
    const html = renderToStaticMarkup(createElement(ErrorFallback, { onRetry: () => {} }));
    expect(html).toContain("Что-то пошло не так");
    expect(html).toContain("Повторить");
    expect(html).toContain("Перезагрузить страницу");
    expect(html).toContain('role="alert"');
  });

  it("names the failed section for panel-level failures", () => {
    const html = renderToStaticMarkup(createElement(ErrorFallback, { onRetry: () => {}, section: "Рассылка" }));
    expect(html).toContain("«Рассылка»");
  });
});

describe("CabinetError (app/app/error.tsx)", () => {
  it("renders the fallback for a route-level error", () => {
    const html = renderToStaticMarkup(
      createElement(CabinetError, { error: new Error("boom"), reset: () => {} }),
    );
    expect(html).toContain("Что-то пошло не так");
  });
});

describe("PanelErrorBoundary", () => {
  it("switches to the failed state when a child throws", () => {
    expect(PanelErrorBoundary.getDerivedStateFromError()).toEqual({ failed: true });
  });

  it("renders the section fallback when failed and children otherwise", () => {
    const child = createElement("p", null, "panel");
    const boundary = new PanelErrorBoundary({ section: "Инвайтинг", children: child });
    expect(boundary.render()).toBe(child);

    boundary.state = { failed: true };
    const fallback = boundary.render() as ReactElement<{ section: string; onRetry: () => void }>;
    expect(isValidElement(fallback)).toBe(true);
    expect(fallback.type).toBe(ErrorFallback);
    expect(fallback.props.section).toBe("Инвайтинг");

    const setState = vi.spyOn(boundary, "setState").mockImplementation(() => {});
    fallback.props.onRetry();
    expect(setState).toHaveBeenCalledWith({ failed: false });
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { H2HChatTrigger, H2HRematchButton } from "./h2h-controls";

describe("H2HChatTrigger", () => {
  it("renders a labeled native button for pointer and touch input", () => {
    const markup = renderToStaticMarkup(
      <H2HChatTrigger onClick={() => undefined} />,
    );

    expect(markup).toContain("<button");
    expect(markup).toContain('type="button"');
    expect(markup).toContain('aria-label="Open game chat"');
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain(">Chat</span>");
    expect(markup).not.toContain("disabled");
  });

  it("exposes its disabled state while another mutation is pending", () => {
    const markup = renderToStaticMarkup(
      <H2HChatTrigger disabled onClick={() => undefined} />,
    );

    expect(markup).toContain("disabled");
  });
});

describe("H2HRematchButton", () => {
  it("renders the rematch action as an accessible native button", () => {
    const markup = renderToStaticMarkup(
      <H2HRematchButton onClick={() => undefined} />,
    );

    expect(markup).toContain('type="button"');
    expect(markup).toContain(">Rematch</button>");
    expect(markup).not.toContain("disabled");
  });

  it("announces and locks a pending rematch", () => {
    const markup = renderToStaticMarkup(
      <H2HRematchButton disabled pending onClick={() => undefined} />,
    );

    expect(markup).toContain("disabled");
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("Starting rematch…");
  });
});

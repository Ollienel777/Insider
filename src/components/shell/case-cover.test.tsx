import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CaseCover } from "./case-cover";
import { COVER_KEY, COVER_PRE_PAINT } from "./case-cover-script";

describe("the case file's cover", () => {
  it("renders no <script>: React never runs one a client component renders", () => {
    const html = renderToStaticMarkup(<CaseCover />);
    expect(html).toContain("data-case-cover");
    expect(html).not.toContain("<script");
  });

  it("its pre-paint script, which the root layout renders, reads the key the cover writes", () => {
    expect(COVER_PRE_PAINT).toContain(`sessionStorage.getItem("${COVER_KEY}")`);
    expect(COVER_PRE_PAINT).toContain("prefers-reduced-motion");
    expect(COVER_PRE_PAINT).toContain('dataset.coverDone="1"');
  });
});

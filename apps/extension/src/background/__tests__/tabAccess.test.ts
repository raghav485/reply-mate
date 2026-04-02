import { describe, expect, it } from "vitest";
import { classifyBridgeAccessError, classifyTabUrl } from "../tabAccess.js";

describe("tabAccess", () => {
  it("treats browser internal pages as unsupported", () => {
    const result = classifyTabUrl("chrome://newtab/");

    expect(result.supported).toBe(false);
    if (result.supported) {
      throw new Error("Expected browser internal page to be unsupported.");
    }
    expect(result.reason).toBe("unsupported_page");
    expect(result.message).toContain("browser internal pages");
  });

  it("treats regular web pages as supported", () => {
    const result = classifyTabUrl("https://app.clickup.com/t/123");

    expect(result).toEqual({
      supported: true,
      url: "https://app.clickup.com/t/123",
    });
  });

  it("normalizes host-permission bridge failures", () => {
    const result = classifyBridgeAccessError(
      "https://app.clickup.com/t/123",
      new Error(
        "Cannot access contents of the page. Extension manifest must request permission to access the respective host."
      )
    );

    expect(result).toEqual({
      reason: "bridge_unavailable",
      message: "ReplyMate could not access this website yet. Reload the tab and reopen the side panel.",
    });
  });
});

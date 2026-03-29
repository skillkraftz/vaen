import { describe, expect, it } from "vitest";
import { buildResendTags } from "./resend-tags";

describe("resend tags", () => {
  it("builds structured tags for webhook-ready correlation", () => {
    expect(buildResendTags({
      campaignId: "camp-1",
      prospectId: "pros-1",
      projectId: "proj-1",
      sendType: "sequence",
      sequenceStep: 2,
    })).toEqual([
      { name: "campaign_id", value: "camp-1" },
      { name: "prospect_id", value: "pros-1" },
      { name: "project_id", value: "proj-1" },
      { name: "send_type", value: "sequence" },
      { name: "sequence_step", value: "2" },
    ]);
  });

  it("omits null tags cleanly", () => {
    expect(buildResendTags({
      prospectId: "pros-1",
      sendType: "manual",
      campaignId: null,
      projectId: null,
      sequenceStep: null,
    })).toEqual([
      { name: "prospect_id", value: "pros-1" },
      { name: "send_type", value: "manual" },
    ]);
  });
});

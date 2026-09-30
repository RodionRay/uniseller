import { describe, expect, it } from "vitest";
import {
  WORKSPACE_ACTION_ACCESS,
  canRunWorkspaceAction,
  requiredAccessFor,
} from "@/lib/processes/workspace-access";
import { ALL_CRM_ACCESS, accessForRole, type WorkspaceContext } from "@/lib/staff-types";

const staff = (access: Partial<typeof ALL_CRM_ACCESS>): WorkspaceContext => ({
  userId: "u2",
  ownerId: "o1",
  isOwner: false,
  role: "operator",
  access: { ...accessForRole("viewer"), ...access },
});

describe("workspace action access", () => {
  it("owner may run any action, including unknown ones", () => {
    const owner: WorkspaceContext = {
      userId: "o1",
      ownerId: "o1",
      isOwner: true,
      role: "owner",
      access: ALL_CRM_ACCESS,
    };
    expect(canRunWorkspaceAction(owner, { action: "tick_mailing" })).toBe(true);
    expect(canRunWorkspaceAction(owner, { action: "something_new" })).toBe(true);
  });

  it("maps actions to the section key", () => {
    expect(requiredAccessFor({ action: "tick_mailing" })).toEqual(["mailing"]);
    expect(requiredAccessFor({ action: "check_proxies" })).toEqual(["proxies"]);
    expect(requiredAccessFor({ action: "save", kind: "account" })).toEqual(["accounts"]);
    expect(requiredAccessFor({ action: "delete", kind: "invite_task" })).toEqual(["invite"]);
  });

  it("denies staff without the section flag", () => {
    const viewer = staff({});
    expect(canRunWorkspaceAction(viewer, { action: "tick_mailing" })).toBe(false);
    expect(canRunWorkspaceAction(viewer, { action: "save", kind: "proxy" })).toBe(false);
    expect(canRunWorkspaceAction(viewer, { action: "mark_lead_viewed" })).toBe(true);
  });

  it("any listed key is enough", () => {
    const chatsOnly = staff({ leads: false, chats: true });
    expect(canRunWorkspaceAction(chatsOnly, { action: "send_lead_message" })).toBe(true);
    expect(canRunWorkspaceAction(chatsOnly, { action: "poll_dm_replies" })).toBe(true);
  });

  it("denies staff on unmapped actions and unknown kinds", () => {
    const all = staff({ ...ALL_CRM_ACCESS, staff: false });
    expect(canRunWorkspaceAction(all, { action: "something_new" })).toBe(false);
    expect(canRunWorkspaceAction(all, { action: "save", kind: "ai_guard" })).toBe(false);
  });

  it("covers every action the route handles", () => {
    const routeActions = [
      "draft", "check_proxy", "check_proxies", "check_account", "check_accounts",
      "reset_checking_accounts", "generate_account_about", "apply_account_profiles",
      "upload_account_photos", "join_group", "scan_group", "mark_lead_viewed",
      "set_lead_training_exclude", "bulk_set_lead_training_exclude", "rebuild_product",
      "train_from_hot", "train_from_ignored", "reject_lead_stopwords", "send_lead_message",
      "rescan_groups", "heal_dead_group_accounts", "import_catalog", "mark_auto_rescan",
      "enqueue_joins", "set_group_join_state", "assign_group_accounts",
      "heal_group_join_state", "preview_lead_core", "test_notify", "start_audience",
      "pause_audience", "tick_audience", "export_audience", "start_invite", "pause_invite",
      "tick_invite", "start_mailing", "pause_mailing", "refill_mailing_ai_pool",
      "tick_mailing", "poll_dm_replies",
    ];
    for (const action of routeActions) {
      expect(WORKSPACE_ACTION_ACCESS[action], action).toBeDefined();
    }
  });
});

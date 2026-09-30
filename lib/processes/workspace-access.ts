/**
 * Staff permission check for workspace POST actions: each action maps to the CRM
 * section keys (staff access flags) that allow it. Any listed key is sufficient.
 * Unmapped actions and kinds are owner-only (deny by default).
 */

import type { CrmAccessKey, WorkspaceContext } from "@/lib/staff-types";

type AccessRule = readonly CrmAccessKey[];

const GROUPS: AccessRule = ["groups"];
const LEADS: AccessRule = ["leads"];
const ACCOUNTS: AccessRule = ["accounts"];
const PROXIES: AccessRule = ["proxies"];
const AUDIENCE: AccessRule = ["audience"];
const INVITE: AccessRule = ["invite"];
const MAILING: AccessRule = ["mailing"];
const AI: AccessRule = ["ai", "settings"];

export const WORKSPACE_ACTION_ACCESS: Readonly<Record<string, AccessRule>> = {
  draft: LEADS,
  mark_lead_viewed: LEADS,
  set_lead_training_exclude: LEADS,
  bulk_set_lead_training_exclude: LEADS,
  reject_lead_stopwords: LEADS,
  send_lead_message: ["leads", "chats"],
  poll_dm_replies: ["chats", "mailing"],

  check_proxy: PROXIES,
  check_proxies: PROXIES,
  check_account: ACCOUNTS,
  check_accounts: ACCOUNTS,
  reset_checking_accounts: ["accounts", "proxies"],
  generate_account_about: ACCOUNTS,
  apply_account_profiles: ACCOUNTS,
  upload_account_photos: ACCOUNTS,

  join_group: GROUPS,
  scan_group: GROUPS,
  rescan_groups: GROUPS,
  heal_dead_group_accounts: GROUPS,
  import_catalog: GROUPS,
  mark_auto_rescan: GROUPS,
  enqueue_joins: GROUPS,
  set_group_join_state: GROUPS,
  assign_group_accounts: GROUPS,
  heal_group_join_state: GROUPS,

  rebuild_product: AI,
  train_from_hot: AI,
  train_from_ignored: AI,
  preview_lead_core: AI,
  test_notify: ["settings", "notifications"],

  start_audience: AUDIENCE,
  pause_audience: AUDIENCE,
  tick_audience: AUDIENCE,
  export_audience: AUDIENCE,
  start_invite: INVITE,
  pause_invite: INVITE,
  tick_invite: INVITE,
  start_mailing: MAILING,
  pause_mailing: MAILING,
  refill_mailing_ai_pool: MAILING,
  tick_mailing: MAILING,
};

/** save/delete are checked by the record kind they touch. */
export const WORKSPACE_KIND_ACCESS: Readonly<Record<string, AccessRule>> = {
  account: ACCOUNTS,
  proxy: PROXIES,
  group: GROUPS,
  lead: ["leads", "chats"],
  settings: AI,
  audience_task: AUDIENCE,
  audience_user: AUDIENCE,
  invite_task: INVITE,
  mailing_task: MAILING,
};

export type WorkspaceActionRequest = { action?: unknown; kind?: unknown };

/** Section keys that allow this request; null = owner-only. */
export function requiredAccessFor(req: WorkspaceActionRequest): AccessRule | null {
  const action = typeof req.action === "string" ? req.action : "";
  if (action === "save" || action === "delete") {
    const kind = typeof req.kind === "string" ? req.kind : "";
    return WORKSPACE_KIND_ACCESS[kind] ?? null;
  }
  return WORKSPACE_ACTION_ACCESS[action] ?? null;
}

export function canRunWorkspaceAction(
  ctx: Pick<WorkspaceContext, "isOwner" | "access">,
  req: WorkspaceActionRequest,
): boolean {
  if (ctx.isOwner) return true;
  const rule = requiredAccessFor(req);
  if (!rule) return false;
  return rule.some((key) => ctx.access[key] === true);
}

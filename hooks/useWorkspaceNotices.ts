"use client";

import { useSyncExternalStore } from "react";
import { loadNotices, subscribeNotices, type WorkspaceNotice } from "@/lib/workspace-notifications";

const NO_NOTICES: WorkspaceNotice[] = [];

/** loadNotices() returns a cached array, so it is a valid external-store snapshot. */
export function useWorkspaceNotices() {
  return useSyncExternalStore(subscribeNotices, loadNotices, () => NO_NOTICES);
}

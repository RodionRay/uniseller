import type { Metadata } from "next";
import { headers } from "next/headers";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headerList = await headers();
  const returnTo = headerList.get("x-uniseller-path") || "/app";
  await requireUser(returnTo);
  return children;
}

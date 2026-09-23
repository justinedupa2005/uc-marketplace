import { redirect } from "next/navigation";

import { requireActiveAdmin } from "@/lib/auth/authorization";

export default async function AdminPage() {
  await requireActiveAdmin("/admin");
  redirect("/admin/verifications");
}

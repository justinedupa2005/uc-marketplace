import { redirect } from "next/navigation";

export default async function LegacyListingDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string | string[]; updated?: string | string[] }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const forwarded = new URLSearchParams();

  if (query.created === "1") forwarded.set("created", "1");
  if (query.updated === "1") forwarded.set("updated", "1");

  const suffix = forwarded.size ? `?${forwarded.toString()}` : "";
  redirect(`/listing/${encodeURIComponent(id)}${suffix}`);
}

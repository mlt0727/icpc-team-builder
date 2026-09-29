import { TeamBoard } from "@/components/team-board";
export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <TeamBoard key={slug} slug={slug} />;
}

import { RemoveTracks } from "@/components/remove-tracks";

export default function RemovePage() {
  return (
    <main className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 fade-in">
        <RemoveTracks />
      </div>
    </main>
  );
}

export default function Loading() {
  return (
    <main className="grid min-h-[70vh] place-items-center px-6">
      <div className="text-center">
        <span className="mx-auto block size-8 animate-pulse rounded-full bg-accent/30 motion-reduce:animate-none" />
        <p className="mt-4 text-sm text-neutral-500">Checking the signal…</p>
      </div>
    </main>
  )
}

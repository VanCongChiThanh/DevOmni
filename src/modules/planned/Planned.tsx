export function Planned({ title }: { title: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <div className="text-base font-semibold text-fg">{title}</div>
        <div className="mt-1 text-fg-muted">Planned — coming in a later milestone.</div>
      </div>
    </div>
  );
}

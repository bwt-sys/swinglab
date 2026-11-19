export default function Section({
  title,
  children,
  aside,
}: {
  title: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <section className="border-b border-slate-800/80 px-5 py-4 last:border-b-0">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

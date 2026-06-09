export default function ConceptsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <main className="container main-content">{children}</main>;
}

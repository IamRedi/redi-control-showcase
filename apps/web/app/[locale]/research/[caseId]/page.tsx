import { CaseClient } from "./case-client";
export default async function CasePage({
  params,
}: {
  params: Promise<{ locale: string; caseId: string }>;
}) {
  const { caseId, locale } = await params;
  return (
    <main className="content-page research-page">
      <CaseClient caseId={caseId} locale={locale} />
    </main>
  );
}

import Link from "next/link";

import {
  workspaceOnboardingCopy,
  type WorkspaceLocale,
} from "./workspace-onboarding-contract";

export function WorkspaceOnboarding({
  locale,
  linkClassName,
}: {
  readonly locale: WorkspaceLocale;
  readonly linkClassName?: string;
}) {
  const text = workspaceOnboardingCopy(locale);
  return (
    <div className="workspace-onboarding">
      <strong>{text.title}</strong>
      <p>{text.body}</p>
      <Link className={linkClassName} href={`/${locale}/settings/workzones`}>
        {text.action} →
      </Link>
    </div>
  );
}

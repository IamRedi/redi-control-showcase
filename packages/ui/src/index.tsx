import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from "react";

export function Button({
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`rc-button ${className}`.trim()} {...props} />;
}

export function Card({
  children,
  title,
}: PropsWithChildren<{ title: string }>) {
  return (
    <section
      className="rc-card"
      aria-labelledby={`card-${title.replaceAll(" ", "-").toLowerCase()}`}
    >
      <h2 id={`card-${title.replaceAll(" ", "-").toLowerCase()}`}>{title}</h2>
      {children}
    </section>
  );
}

export function AppShell({
  navigation,
  children,
}: PropsWithChildren<{ navigation: ReactNode }>) {
  return (
    <div className="rc-shell">
      <aside className="rc-sidebar" aria-label="Primary navigation">
        <strong>REDI CONTROL</strong>
        {navigation}
      </aside>
      <main className="rc-main">{children}</main>
    </div>
  );
}

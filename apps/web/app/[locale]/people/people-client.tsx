"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { peopleRoleLabel, type PeopleCopy } from "./people-copy";

interface Member {
  readonly userId: string;
  readonly email: string;
  readonly roles: readonly string[];
  readonly joinedAt: string;
  readonly isCurrentUser: boolean;
}

export function PeopleClient({ copy }: { readonly copy: PeopleCopy }) {
  const [state, setState] = useState<
    | { readonly status: "loading" }
    | { readonly status: "error" }
    | { readonly status: "ready"; readonly members: readonly Member[] }
  >({ status: "loading" });
  const [invite, setInvite] = useState<
    | { readonly status: "idle" }
    | { readonly status: "sending" }
    | { readonly status: "sent" }
    | { readonly status: "error" }
  >({ status: "idle" });

  async function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const email = form.get("email");
    const role = form.get("role");
    const csrf = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith("redi_csrf="))
      ?.split("=")[1];
    setInvite({ status: "sending" });
    try {
      const response = await fetch("/api/memberships", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          ...(csrf ? { "x-csrf-token": decodeURIComponent(csrf) } : {}),
        },
        body: JSON.stringify({
          email: typeof email === "string" ? email : "",
          role: typeof role === "string" ? role : "",
        }),
      });
      if (!response.ok) throw new Error("invite_failed");
      formElement.reset();
      setInvite({ status: "sent" });
    } catch {
      setInvite({ status: "error" });
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/memberships", {
      credentials: "include",
      headers: { accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("membership_api_unavailable");
        const value = (await response.json()) as { members?: unknown };
        if (!Array.isArray(value.members)) throw new Error("invalid_members");
        setState({ status: "ready", members: value.members as Member[] });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setState({ status: "error" });
      });
    return () => controller.abort();
  }, []);

  if (state.status === "loading")
    return <p className="website-state">{copy.loading}</p>;
  if (state.status === "error")
    return <p className="website-state website-error">{copy.unavailable}</p>;
  return (
    <>
      <form
        className="member-invite"
        onSubmit={(event) => void submitInvite(event)}
      >
        <div>
          <p className="eyebrow">{copy.inviteEyebrow}</p>
          <h2>{copy.inviteTitle}</h2>
          <p>{copy.inviteBody}</p>
        </div>
        <label>
          {copy.email}
          <input
            name="email"
            type="email"
            required
            maxLength={320}
            autoComplete="email"
          />
        </label>
        <label>
          {copy.role}
          <select name="role" defaultValue="editor">
            <option value="editor">{copy.roles.editor}</option>
            <option value="approver">{copy.roles.approver}</option>
            <option value="analyst">{copy.roles.analyst}</option>
          </select>
        </label>
        <button type="submit" disabled={invite.status === "sending"}>
          {invite.status === "sending" ? copy.sending : copy.send}
        </button>
        <p
          aria-live="polite"
          className={invite.status === "error" ? "website-error" : ""}
        >
          {invite.status === "sent"
            ? copy.sent
            : invite.status === "error"
              ? copy.inviteError
              : ""}
        </p>
      </form>
      {state.members.length ? (
        <section className="people-grid" aria-live="polite">
          {state.members.map((member) => (
            <article className="people-card" key={member.userId}>
              <div>
                <strong>{member.email}</strong>
                {member.isCurrentUser ? <span>{copy.currentUser}</span> : null}
              </div>
              <ul>
                {member.roles.map((role) => (
                  <li key={role}>{peopleRoleLabel(copy, role)}</li>
                ))}
              </ul>
            </article>
          ))}
        </section>
      ) : (
        <p className="website-state">{copy.empty}</p>
      )}
    </>
  );
}

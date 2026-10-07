# Deepen Account credentials recovery

Status: resolved

## Problem Statement

An account holder needs a password reset to complete reliably through either an email link or an administrator-generated link.
Success must change the password, revoke existing sessions, and invalidate outstanding reset links for that account.

The current form action coordinates token selection, password replacement, session revocation, and cleanup of two token stores.
The token modules expose partial operations. The caller must know the transaction rules that make those operations one complete reset.
This makes future recovery changes harder to understand and verify.

The architecture review identified this ownership problem. It did not establish a production defect.

## Solution

Concentrate password reset completion in one Account credentials recovery module.
The form adapter validates the input and presents the existing result messages.
The recovery module owns hashing, token selection, the password change, and all reset completion work.

Account holders keep the same recovery links, form, validation, and sign-in behavior.
Administrators keep their existing recovery fallback.
The change improves locality by placing the completion rules in one implementation.
Its depth gives the form adapter leverage without knowledge of token storage or transaction order.

## User Stories

1. As an account holder with verified email and Account credentials, I want to use my emailed reset link, so that I can recover my account.
2. As an account holder without verified email, I want the administrator recovery fallback to remain available, so that I can recover my Account credentials.
3. As an administrator, I want existing reset links to remain valid until use or expiry, so that the refactor does not interrupt account recovery.
4. As an account holder, I want both link sources to use the same reset form, so that I do not need separate recovery instructions.
5. As an account holder, I want the existing password validation, so that the refactor does not change which passwords the form accepts.
6. As an account holder, I want mismatched password confirmation to stop the reset, so that a typing mistake does not change my password.
7. As an account holder, I want a successful reset to replace my existing password, so that I can sign in with the new password.
8. As an account holder, I want my previous password to stop working after a successful reset, so that the old credential no longer grants access.
9. As an account holder, I want existing sessions revoked after a successful reset, so that previously signed-in devices must sign in again.
10. As an account holder, I want a reset link to work only once, so that someone cannot reuse it after my reset.
11. As an account holder, I want all my outstanding reset links invalidated after success, so that another email or administrator link cannot change my password again.
12. As an account holder, I want reset links to retain their 15-minute expiry, so that recovery credentials remain short-lived.
13. As an account holder, I want an invalid or expired link to show the existing error, so that I know the reset did not complete.
14. As an account holder, I want an email verification link to remain separate from a reset link, so that each link authorizes only its intended operation.
15. As an account holder, I want email verification to keep working after the refactor, so that I can complete the existing verification process.
16. As an account holder who uses only Google or Discord, I want recovery to keep using my provider, so that a reset does not create Account credentials.
17. As an account holder with a linked provider and Account credentials, I want a password reset to preserve the linked provider, so that my other sign-in method remains available.
18. As an account holder, I want a password reset to preserve my username, email, and profile, so that recovery does not change my account identity.
19. As an account holder, I want recovery to preserve my Viewing access and Account suspension state, so that a password reset does not change access decisions.
20. As a Channel owner, I want recovery to preserve my Channel and Stream key, so that resetting Account credentials does not change publishing configuration.
21. As another account holder, I want someone else's reset to leave my password, sessions, and links unchanged, so that recovery remains account-specific.
22. As an account holder, I want a storage exception during reset completion to roll back the transaction, so that the reset does not partially commit.
23. As a maintainer, I want one module to own reset completion for both token sources, so that I can change the workflow in one place.
24. As a maintainer, I want tests through an existing caller interface with real SQLite, so that the tests verify complete behavior without depending on private helper calls.
25. As a maintainer, I want the current SMTP integration test retained, so that the refactor preserves the route from email delivery to password recovery.

## Implementation Decisions

- Treat this as a behavior-preserving refactor of password reset completion. Do not expand it into general account management.
- Give the Account credentials recovery module one completion operation. It accepts the submitted reset token and validated new password and reports success or an invalid reset outcome.
- Keep form parsing, confirmation validation, and user-facing messages in the existing form adapter. Remove its direct database access and token-source coordination.
- Move password hashing into the recovery module. Complete asynchronous hashing before opening the synchronous SQLite transaction, as the current workflow does.
- Make the recovery module own the transaction for token consumption, password replacement, session revocation, and reset-token cleanup.
- Preserve lookup order. Try the email reset token first, then the administrator reset token when the first source has no match.
- Preserve each source's existing validation. Email reset tokens require the reset purpose, an unexpired token, the current account email, and an active account. Administrator reset tokens require an unused, unexpired token. Do not add the email path's requirements to administrator recovery.
- Change only the existing local credential record selected by the current credential provider and issuer. Do not insert a credential record or change a linked provider record.
- After a successful password update, revoke every stored session for the target account. Invalidate outstanding reset tokens from both sources for that account.
- Keep email verification tokens separate from reset cleanup. Preserve email verification behavior when narrowing the existing email-token module.
- Preserve transaction rollback on thrown storage failures. Preserve existing unsuccessful outcomes when a token resolves to no matching local credential. Do not silently change token consumption in that case.
- Make reset-only token consumption an implementation detail of the recovery module. Keep token issuance, administrator authorization, audit recording, email delivery, and delivery throttling with their current owners.
- Reuse the existing SQLite adapter. Two token sources are real variation, but they do not require a generic token-source adapter framework.
- Keep the existing form result contract and unexpected-error behavior. Do not turn a database exception into an invalid-link result as part of this refactor.
- Keep the database schema, stored token format, expiry duration, password hashing algorithm, routes, and reset URLs unchanged.
- Update the maintained account access guide to identify the owner of reset completion. Keep the existing domain glossary terms and avoid a separate decision document.

## Testing Decisions

- Prefer one existing test seam: the reset form action. Call it with real form data and let it call the actual recovery implementation.
- Use a fresh local SQLite database with the real migrations for each independent case. Replace only the database acquisition seam, as existing account integration tests do.
- Use the actual password hashing and verification implementation. Test observable results and durable account state, not helper calls, SQL statement order, or private method names.
- The primary coverage exercises the form adapter and recovery module together. Do not duplicate the same matrix at a new lower seam.
- Retain the local SMTP receiver integration test. It already verifies email verification, reset delivery, single use, and the resulting password through the reset action.
- Keep token issuance and email verification coverage. The new completion tests supplement missing outcomes rather than replace independent delivery checks.
- Use the following acceptance cases:

| Case | Required result |
| --- | --- |
| Valid email reset link | The action succeeds. The new password verifies and the previous password does not. |
| Valid administrator reset link | The same completion behavior succeeds without imposing email verification. |
| Existing sessions and both reset-token sources | For each successful source, all target-account sessions and outstanding reset links become unusable. |
| Another account's sessions, credentials, and reset links | They remain unchanged after the target account resets. |
| Reused or expired reset link | The action returns the existing unsuccessful result and does not change the password or sessions. Test expiry at the deadline. |
| Invalid form or mismatched confirmation | The action returns its existing validation result without consuming a valid reset token. |
| Wrong token purpose, changed account email, or inactive account on the email path | The email reset path rejects the token under its existing rules. |
| Email verification token alongside reset tokens | A successful password reset leaves the verification token and verification state unchanged. The verification operation still works separately. |
| Provider-only account | Existing issuance rules reject recovery for that account. Completion never creates a local credential record. |
| Linked provider and existing local credential | Only the local password changes. The provider identity and account profile remain unchanged. |
| Valid token but no matching local credential | The action reports failure. Characterize and preserve the current token-consumption behavior. |
| Storage exception after the password write | The exception preserves existing error handling. SQLite rolls back the password, token consumption, and session changes. A retry can still use the token. |
| Successful reset with stored access and publishing state | Administrator approval, Channel approvals, Account suspension, Channel ownership, and Stream keys remain unchanged. |

- For rollback coverage, use a local SQLite failure mechanism, such as a temporary trigger that rejects session deletion. Do not mock the recovery implementation.
- Review the final dependency structure to confirm that the form adapter no longer knows the token stores or completion transaction. Passing behavior tests alone does not prove the architectural change.
- Run the affected account integration tests, lint, type checks, and the production build during implementation. Apply the repository's required verification workflow before delivery.
- No new browser suite is required for unchanged form markup. Keep existing browser coverage and extend it only if the implementation changes browser behavior.

## Out of Scope

- Changes to password policy, account eligibility, or the difference between email and administrator recovery.
- Provider recovery, password creation for provider-only accounts, or changes to account linking.
- Email templates, SMTP configuration, token issuance, delivery throttling, or new recovery notifications.
- Changes to the signed-in password-change workflow or the account management interface.
- A generic authentication framework, token-source plugin system, or database abstraction.
- Database migrations, route changes, a version bump, or release work.
- Changes to Viewing access, Streaming access, Account suspension, Channel management, Chat, Playback mode, or the Streaming contract.
- The other architecture review candidates.

## Further Notes

The user selected candidate 1 from the architecture review and requested a specification without an interview.
This spec is published to the local Markdown issue tracker with the `ready-for-agent` status.

The user confirmed the existing reset action with real SQLite as the primary test seam.

The current action already wraps reset completion in a transaction.
The refactor must move ownership of that transaction and its token rules together.
Moving only the action body while retaining partial reset operations as its public dependencies would add little depth.

One existing edge case needs careful characterization: a valid token can be consumed before a missing local credential causes an unsuccessful result.
That result does not throw, so it does not trigger transaction rollback.
Preserve this behavior for the refactor. Any policy correction requires separate scope.

The maintained [account access guide](../../docs/account-access.md) defines recovery behavior.
The [domain glossary](../../CONTEXT.md) defines Account credentials and the related access terms.
Use the [verification guide](../../docs/verification.md) for implementation checks.

## Comments

- 2026-10-07: Implemented by an Astra subagent at xhigh effort in `c9addaf`. The [implementation ticket](issues/01-centralize-reset-completion.md) records verification and review results. Delivered in [PR #3](https://github.com/tprjd/mediamtx-viewer/pull/3).

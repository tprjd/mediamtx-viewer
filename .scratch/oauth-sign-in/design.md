# Google and Discord sign-in

Status: approved, implemented, and verified

## Accepted decisions

- Add Google and Discord sign-in.
- Both providers can create site accounts while registration is open.
- New accounts require administrator approval before they receive Viewing access.
- Existing accounts can link Discord manually after site sign-in.
- Manual linking can use a provider email that differs from the site email.
- Manual linking preserves the site email and existing account data.
- Google automatically links to an existing account only when the email matches and Google confirms a verified Gmail or Google Workspace address.
- Google accounts that use external mailboxes require manual linking to an existing site account.
- Users who register through either provider need a display name, but no site username or password.
- Users can disconnect a provider only when another usable sign-in method remains.

## Behavior for implementation

| Situation | Result |
| --- | --- |
| An active account signs in through an already linked provider | Sign in to the same site account. |
| An unlinked Google identity has a matching, verified Gmail or Google Workspace email | Link to the existing site account. Apply its existing access status. |
| An unlinked Discord identity has the same email as an existing site account | Require site sign-in, then manual linking in Account settings. |
| An unlinked Google identity uses an external mailbox that matches an existing account | Require site sign-in, then manual linking in Account settings. |
| A provider identity has no existing site account and registration is open | Create a pending account with a display name. Require administrator approval for Viewing access. |
| A provider identity has no existing site account and registration is closed | Reject registration. |
| An existing active account signs in or links a provider while registration is closed | Allow the operation. The registration switch controls new accounts. |
| A pending or disabled account attempts provider sign-in | Apply the existing access restriction. Linking does not activate an account. |
| A signed-in user links a provider with a different email | Keep the site email and existing account data. Add the provider as a sign-in method. |
| A provider identity already belongs to another site account | Reject the link. Do not merge the site accounts. |
| A user disconnects a provider | Allow this only if another usable sign-in method remains. |

Existing account credentials remain available. Provider sign-in and linking preserve account identity, Viewing access, Streaming access, channel ownership, and Chat restrictions.

Account settings show the connected providers and the permitted link and disconnect actions. Accounts without a password do not show a password change form.

## Verification scope

- Exercise provider callbacks, automatic linking, and manual linking with controlled provider responses.
- Check verified Gmail and Workspace claims, external mailbox claims, and missing or unverified email data.
- Check that Discord never links automatically from an email match.
- Check registration closure at account creation and preserve pending and disabled account restrictions.
- Check that different-email linking preserves the site email and cannot take a provider identity from another site account.
- Check that disconnect cannot remove the final usable sign-in method, including concurrent disconnect requests.
- Check account controls for accounts with and without a password.
- Run the relevant repository checks before implementation delivery.

Provider application credentials and registered callback URLs are required for a live Google and Discord sign-in check. Record separately which checks use controlled responses and which use live providers.

## Baseline implementation findings

- `lib/auth/auth.ts` configures Better Auth 1.7.2 with username and password sign-in.
- Its registration hook protects `/sign-up/email` only. Provider registration needs the same registration policy.
- Its session creation hook rejects pending and disabled accounts.
- Existing password registrations do not verify the site email.
- Better Auth defaults `requireLocalEmailVerified` to true for automatic linking. Provider configuration alone does not enable the requested linking behavior.
- Better Auth's `trustedProviders` is not an exclusive list of providers allowed to link automatically. A verified provider email can also pass that check.
- Better Auth supports manual linking with different emails through `allowDifferentEmails`.
- The account page always shows a password change form. Provider accounts need appropriate account controls.

## Provider evidence

Discord exposes an email and its verification status when the application requests the email scope. Manual Discord linking is a product decision.

Source: [Discord user resource](https://docs.discord.com/developers/resources/user).

Google is authoritative for Gmail addresses and verified Google Workspace addresses identified by the `hd` claim. Google warns that external mailbox ownership can change after verification. For these addresses, Google recommends another ownership check.

Source: [Verify the Google ID token](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).

## Delivery state

The implementation adds provider configuration, callback policy, atomic disconnect, sign-in controls, and setup documentation. The maintained rules are in `docs/account-linking.md` and setup instructions are in `docs/provider-sign-in.md`.

The two review axes found no blocking issues. The optional UI handler naming finding was corrected.

The working tree already contained a change to `next-env.d.ts` before this task. It is excluded from delivery.

## Verification results

- All 648 tests passed across 77 source test files. The command excluded generated `.next-e2e/**` and `.next-e2e-chat/**` copies and used two workers.
- The focused provider callback and UI tests passed: 32 tests across two files.
- Source lint passed with `.data/**` excluded. The default lint command also checks an unrelated generated preview file that has an existing lint error.
- Type checking and the production build passed.
- Browser checks against an isolated production build covered password sign-in, provider controls, the Discord authorization redirect, provider-only account controls, and mobile layout.
- Google callback tests verified signed test tokens with controlled provider responses. Live Google and Discord sign-in still requires provider application credentials and registered callbacks, as described in `docs/provider-sign-in.md`.

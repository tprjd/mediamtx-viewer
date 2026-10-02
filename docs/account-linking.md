# Provider account rules

Google and Discord identities are additional sign-in methods for one site account. Linking preserves its site email, profile name, account credentials, Viewing access, Streaming access, channel ownership, and Chat restrictions.

## Registration and access

Both providers can create new accounts while registration is open. Provider registration requires an email verified by the provider. A new account uses the provider's display name and starts pending. It needs administrator approval for Viewing access. It has no site username or password.

The site checks registration at account creation, including when registration closes during the provider redirect. Closing registration does not block existing users from signing in or linking providers. Pending and disabled accounts cannot obtain an active session through a provider.

## Automatic and manual linking

Google automatically links a matching email only when its verified claims identify a Gmail address or a Google Workspace address with an `hd` claim. The site verifies the Google token's signature, issuer, audience, and expiry before it applies this rule. It matches email case without rewriting dots or plus suffixes.

Google accounts that use external mailboxes require manual linking when the email already belongs to a site account. Google explains that an external mailbox can change owners after verification in its [ID token verification guide](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).

Discord always requires manual linking to an existing site account, even when its email matches. An email collision does not create another account or merge accounts.

Manual linking requires an active site session at the start and on return from the provider. The session on return must belong to the original site account. The provider email can differ from the site email. A provider identity already linked to another site account cannot be transferred through this flow.

Subsequent sign-in uses the linked provider identity, not a fresh email match. The site retains its existing email if the provider email changes.

## Disconnect and recovery

Account settings allow disconnect only when another usable sign-in method remains. A configured linked provider counts as usable. Account credentials count only when the account has both a username and a password. A provider whose server configuration is absent does not count.

The disconnect check and deletion use one SQLite write transaction. Concurrent requests cannot remove the final method. Disconnect requires a recent site session, using Better Auth's session freshness limit, and produces a `provider_disconnected` audit record.

Accounts without a password do not show the password-change form. This feature does not add a password-creation or provider-recovery flow. Users can link a second provider before they lose access to the first.

## Better Auth integration

The application uses redirect-based OAuth for sign-in and manual linking. Direct client-supplied ID-token flows are rejected so they cannot skip callback policy checks.

Existing password registrations have unverified site emails. The accepted Google rule therefore uses Better Auth 1.7.2's `requireLocalEmailVerified: false`, with the Google-owned email restriction enforced by `validateUserInfo`. This preserves existing credentials when Google links. Administrator approval remains the site's admission control; it is not an email ownership check. The override accepts the risk that an approved account was registered with someone else's email.

This Better Auth option is deprecated. An authentication-library upgrade must preserve the approved linking behavior and run the provider callback tests before deployment. Setting `trustedProviders` alone does not implement this policy because Better Auth also permits linking based on a verified provider email.

See [provider setup](provider-sign-in.md) for configuration and live checks.

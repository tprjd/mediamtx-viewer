# Configure Google and Discord sign-in

For the account behavior, see [provider account rules](account-linking.md).

Set up either provider or both. Each provider appears on the sign-in and registration pages only when its client ID and secret are configured.

## Create provider credentials

1. In the [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an OAuth client with the Web application type.
2. Configure the Google consent screen for the people who will use the site. If the application is in testing, add those people as test users.
3. Register the Google callback URL shown below.
4. In the [Discord Developer Portal](https://discord.com/developers/applications), create or select an application.
5. Open its OAuth2 settings and register the Discord callback URL shown below.
6. Copy each application's client ID and client secret into the corresponding environment variables.

| Provider | Callback URL | Environment variables |
| --- | --- | --- |
| Google | `<BETTER_AUTH_URL>/api/auth/callback/google` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Discord | `<BETTER_AUTH_URL>/api/auth/callback/discord` | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` |

For local development, the Google callback is `http://localhost:3000/api/auth/callback/google`. Use the equivalent Discord path for Discord. Register the actual local port if it differs from 3000.

For production, use the public HTTPS origin. Callback URLs must match exactly. These credentials are separate from the Discord notification bot token.

The application requests Google's default `openid`, `email`, and `profile` scopes and Discord's `identify` and `email` scopes. No bot or server-membership permission is needed.

The provider setup follows the [Better Auth Google guide](https://better-auth.com/docs/authentication/google) and [Discord guide](https://better-auth.com/docs/authentication/discord).

## Install the credentials

For local development, save the four variables in `.env.local`, then restart Next.js. For local Compose, put them in the Compose environment file.

For managed Oracle deployment, edit the encrypted `deploy/oracle/secrets.enc/caddy.env.enc` with SOPS. Add the variables there so release preparation supplies them to the viewer container. Follow the existing [release and deployment process](managed-deployment.md). Keep plaintext secrets out of commits and command output.

Set both values for each provider. An incomplete pair disables that provider. Removing a provider's configuration can prevent users who rely on that provider from signing in. Add another usable method to those accounts first.

## Check the running site

1. Use an existing active account with a matching verified Gmail address to sign in with Google. Check that it retains its name, channel, and access.
2. Sign in to an existing account and link Discord from Account settings. Check that Discord then signs in to the same account.
3. Open registration and use a new provider identity. Check that the site reports pending approval.
4. Activate that account as an administrator, then sign in with the same provider again.
5. Close registration and check that existing accounts can still sign in.
6. Link a second sign-in method and disconnect one provider. Check that the remaining method works.

Automated callback tests use controlled provider responses and test Google signing keys. They do not replace this check with real provider applications.

# Owner setup

## Local owner launch

1. Run the platform start file.
2. Register the first account with `memphiscardcompany@gmail.com`.
3. Because that address is the default bootstrap administrator in the generated local configuration, the account receives the `admin` role.
4. Open **Me → Owner control room**.
5. Review users, data health, sources, consignments, and account-email delivery.

Local mode sets `MANEFLOW_EXPOSE_DEV_TOKENS=true`, allowing verification and recovery links to work without a live email provider. Never leave this enabled on the public server.

## Production owner configuration

Copy `.env.example` to `.env` on the production host and set:

- `PUBLIC_BASE_URL=https://mane.memphiscardcompany.com`
- `HOST=0.0.0.0`
- `MANEFLOW_DEMO_MODE=false` only after approved sales are present
- `MANEFLOW_ALLOW_GUEST_WRITES=false`
- `MANEFLOW_REQUIRE_EMAIL_VERIFICATION=true`
- `MANEFLOW_EXPOSE_DEV_TOKENS=false`
- unique long API, admin, and provider webhook secrets
- exact allowed browser origins
- transactional email webhook
- approved vision and marketplace credentials

Run `npm run doctor:strict` before opening public registration.

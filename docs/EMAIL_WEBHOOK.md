# Transactional email webhook

ManeFlow uses a provider-neutral outbound webhook so password recovery and email verification can connect to SendGrid, Postmark, Amazon SES, Resend, Mailgun, an automation platform, or an internal mail service without placing provider code in the client.

Configure:

```text
MANEFLOW_EMAIL_WEBHOOK_URL=https://your-secure-mail-worker.example/send
MANEFLOW_EMAIL_WEBHOOK_SECRET=long-random-secret
```

ManeFlow sends an HTTPS POST with JSON:

```json
{
  "type": "verify_email",
  "to": "collector@example.com",
  "subject": "Verify your ManeFlow email",
  "actionUrl": "https://mane.memphiscardcompany.com/#/account?verify=...",
  "expiresAt": "2026-07-08T12:00:00.000Z",
  "app": "ManeFlow"
}
```

The authorization header is `Bearer <MANEFLOW_EMAIL_WEBHOOK_SECRET>` when configured.

The receiving service must authenticate the request, send the message, avoid logging the single-use token, and return a 2xx response. ManeFlow records only operator-visible delivery status and retains a limited outbox history.

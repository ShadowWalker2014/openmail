# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| latest (main) | ✅ |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Email us at **[kai@1flow.ai](mailto:kai@1flow.ai)** with:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fixes (optional)

We will acknowledge your report within **48 hours** and provide a detailed response within **7 days** indicating next steps.

## Security Best Practices for Self-Hosters

- Always set a strong `BETTER_AUTH_SECRET` (32+ random characters)
- Use HTTPS in production — set proper `BETTER_AUTH_URL` and `WEB_URL` to `https://`
- Restrict database access — PostgreSQL should not be publicly exposed
- Rotate API keys regularly from the dashboard → Settings → API Keys
- Keep dependencies up to date — watch for Dependabot alerts on your fork

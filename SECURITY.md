# Security policy

## Supported releases

Only the latest `main` branch and the latest production deployment receive security fixes.

## Reporting a vulnerability

Do not open a public issue with credentials, child data, exploitable payloads, or a full proof of concept. Contact the project owner privately with:

- affected route, file, or deployment;
- impact and realistic abuse path;
- minimal reproduction using synthetic data;
- suggested mitigation, if known.

Rotate any exposed key immediately. Never include student speech, audio, access tokens, refresh tokens, reset tokens, or parent emails in a report.

## Response targets

- Acknowledge within 2 business days.
- Triage severity within 5 business days.
- Publish a fix or mitigation based on severity and exploitability.

## Scope

The API, web app, Docker deployment, GitHub Actions, AI provider integration, and stored student data are in scope. Third-party provider infrastructure is out of scope, but provider failures and data-transfer assumptions must be reported.

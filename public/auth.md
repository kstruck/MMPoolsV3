# March Melee Pools auth.md

This document is for autonomous agents acting on behalf of a March Melee Pools user.

## Agent audience

Agents may discover the public service-readiness API and its documentation. Agents must not create, access, modify, or submit a user's pool data unless the user is present and has completed sign-in through the March Melee Pools web application.

## Registration and provisioning

March Melee Pools does not currently offer an unattended agent-registration, credential-provisioning, or API-key endpoint. Do not probe or send requests to a guessed `/agent/auth` endpoint.

The only supported account-registration surface is the interactive web application at <https://www.marchmeleepools.com/>. A user may register there with either:

1. Google Sign-In.
2. Email and password, followed by email verification.

An agent may direct a user to this page, but must not collect the user's password, complete a registration form, or use browser automation to bypass the interactive consent and verification steps.

## Credentials and API use

The service does not issue bearer tokens, API keys, OAuth client credentials, or agent-scoped credentials for third-party use. Firebase Authentication sessions are browser-session credentials for the signed-in user and must not be extracted, shared with an agent, or used outside the application.

The public readiness endpoint requires no credential:

    GET https://us-central1-gridiron-gamble-uzuqo.cloudfunctions.net/readiness

Discover its machine-readable description at <https://www.marchmeleepools.com/.well-known/api-catalog>, the OpenAPI document at <https://www.marchmeleepools.com/api/openapi.json>, and human documentation at <https://www.marchmeleepools.com/api/docs.html>.

## OAuth metadata

OAuth Protected Resource Metadata and OAuth Authorization Server metadata are not published because this service does not operate an OAuth authorization server for agent registration. An agent must not infer OAuth endpoints, scopes, or registration methods from this document.

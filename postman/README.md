# AVORA API — Postman

Collections for the AVORA backend. Written for the frontend developer doing the integration.

## Setup

1. Import `robinkeyz.postman_environment.json` and select it (top-right dropdown).
2. Import the three collection files. Each one imports as a folder — drop them inside your existing AVORA collection.
3. Run **Auth → Login**. The test script stores the session token in `{{accessToken}}`, so every protected request works from then on.

Change `apiUrl` in the environment to point at staging or production. Nothing else needs editing.

## Base URL

```
http://localhost:7000/api/v1
```

Everything is under `/api/v1` except `GET /`, which is the server's health page.

## Response envelope

Every endpoint — success or failure — answers with the same wrapper:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "User logged in successfully",
  "data": { }
}
```

Read your payload from `data`. On failure `success` is `false` and `message` is already written for display — show it to the user as-is rather than inventing your own text.

List endpoints add `pagination` **beside** `data`, not inside it:

```json
{
  "success": true,
  "statusCode": 200,
  "pagination": { "page": 1, "limit": 10, "totalItem": 42, "totalPage": 5 },
  "data": [ ]
}
```

## Tokens

Two kinds, and they are not interchangeable.

| Kind | From | Lifetime | Used for |
|---|---|---|---|
| **Session token** | `POST /auth/login` | 7 days, or 30 with `isRememberMe: true` | every protected route |
| **Purpose token** | register / forget-password | 10 minutes | only the next step of that one flow |

Both travel the same way:

```
Authorization: Bearer <token>
```

Sending a session token where a purpose token is expected returns `401 Invalid token`. Purpose tokens are scoped to one flow, so a registration token cannot be used to reset a password.

### Session restore

The session token is a plain JWT, so keep it in `localStorage` and send it on every request. On app start call `GET /auth/me`: 200 means the token is still good, 401 means send the user back to login.

The server never trusts what is inside the token — it reloads the user from the database on every request. So a deleted or changed account takes effect immediately, without waiting for the token to expire.

## Sign-up flow

```
POST /users/register             -> { token }
        |                           6-digit OTP goes out by email
        v
POST /users/verify-email-otp     Bearer: that token, body { otp }
        |
        v
POST /auth/login                 -> { token, user }
```

Three things to know:

- **Register returns only `{ token }`** — no user object. That is deliberate: the email is sent *after* the response, so the call returns immediately instead of waiting several seconds for SMTP.
- **An unverified user cannot log in.** Login answers `403 Please verify your email before logging in.` Catch that status and send them to the OTP screen.
- **Re-registering an unverified email is allowed.** It refreshes the record, sends a new OTP and returns a new token. Only a *verified* email returns `409`. So an abandoned sign-up just restarts — no "email already taken" dead end.

The OTP is **6 digits**.

In development the OTP is also printed to the server terminal, so email is not needed while testing:

```
[OtpService] OTP for you@example.com: 123456
```

## Forget-password flow

```
POST /auth/forget-password       -> { token }     (step-1 token)
        v
POST /auth/verify-forget-otp     Bearer: step-1 token, body { otp }
        |                        -> { token }     (step-2 token — a different one)
        v
POST /auth/reset-password        Bearer: step-2 token
```

The token changes between step 2 and step 3. Using the step-1 token on reset-password fails with 401. The collection's test scripts save them as `{{forgetToken}}` and `{{resetToken}}` so the chain runs top to bottom.

OTPs are single use — a successful check deletes the row, so resubmitting the same code returns `404 OTP not found!`.

## Roles

`user.role` is **platform level only**:

| Value | Meaning |
|---|---|
| `user` | ordinary account |
| `superAdmin` | platform owner |

Commissioner, Co-Commissioner, Team Owner and Co-Owner are **per league**, not per account. The same person can be Commissioner in one league and Team Owner in another, so those roles never appear on the user object. They will arrive with the league endpoints.

## Errors worth handling

| Status | Where | message |
|---|---|---|
| 400 | any | validation failed — `message` names the field |
| 401 | login | `Invalid credentials` — same text for wrong email and wrong password, so nobody can probe which emails exist |
| 401 | protected routes | `No token provided or invalid format.` / `Invalid token!` |
| 403 | login | `Please verify your email before logging in.` |
| 403 | admin routes | `You are not authorized.` |
| 404 | by id | `User not found.` |
| 409 | register | `User with this email already exists` |

## CORS

The API allows the origins listed in `FRONTEND_URL` on the server, comma separated. Local development is `http://localhost:3090`.

A blocked origin shows up in the browser as a plain network failure with no status code — the request never leaves the browser. If `fetch` rejects but the API answers fine in Postman, it is CORS, not the server. Check the Console tab.

## Not built yet

League, Team, Roster, Draft, Trade and Free Agency endpoints do not exist yet. This covers authentication, users and the static pages only.

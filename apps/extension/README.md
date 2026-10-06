# Ludex Chrome / Edge capture pilot

Load this folder as an unpacked extension in developer mode. It captures the active tab only when pressed, optionally records visible video position/pause state, and sends an observation for review. It never infers episode completion, reads Netflix cookies, or observes Android streaming apps.

Use a scoped extension connection token issued by Ludex when the pairing flow is enabled. Until that flow is enabled, a local development session can exercise the endpoint; never distribute a production account session as an extension token. API host permission is requested on connection. Chrome local storage is not a secure vault; production pairing tokens must be narrow, revocable and short-lived.

No environment bundler is used by this pilot; `.env.example` is a reserved worksheet. The API URL is configured in the popup. Netflix automatic detection and browser-store publication are not validated by this capture-only implementation.

# api

The contract between the mobile app and the backend services, owned by neither.

`openapi.yaml` describes `services/cmd/platform`. Both sides generate their
types from it rather than hand-writing them twice.

Two rules the document enforces:

- **Every amount is a decimal string.** JSON numbers are floats on the receiving
  side and money is not.
- **Every refusal has a stable machine code** and, for policy denials, the limit
  that was hit and the value that hit it — so the app can say "you asked for
  200, the limit is 100" rather than "something went wrong".

The signer's API is a separate document when it arrives: it is a different
trust domain with a different audience, and merging the two would invite the
platform to depend on signer internals.

# api

The contract between the mobile app and the backend services, owned by neither.

Nothing here yet. When the first endpoint exists it goes in as an OpenAPI
document, and both sides generate their types from it rather than hand-writing
them twice.

The signer's API is a separate document when it arrives: it is a different trust
domain with a different audience, and merging the two would invite the platform
to depend on signer internals.

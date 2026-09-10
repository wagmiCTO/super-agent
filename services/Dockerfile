# The platform as one static binary. Build from the repository root's
# services/ directory: docker build -t tradeagent-platform services/
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/platform ./cmd/platform

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata && adduser -D -u 10001 app
USER app
COPY --from=build /out/platform /platform
# Railway and most hosts hand the port in PORT; the binary listens on it.
ENV PLATFORM_ADDR=""
ENTRYPOINT ["/platform"]

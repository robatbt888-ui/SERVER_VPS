FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY main.go ./
COPY web ./web
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/traffic-bridge-server .

FROM alpine:3.20
RUN addgroup -S app && adduser -S -G app app
WORKDIR /app
COPY --from=build /out/traffic-bridge-server /app/traffic-bridge-server
COPY scripts ./scripts
RUN mkdir -p /app/data && chown -R app:app /app
RUN chmod 0755 /app/scripts/*.sh && chown -R app:app /app/scripts
USER app
ENV PORT=2053
ENV STATE_FILE=/app/data/state.json
EXPOSE 2053
ENTRYPOINT ["/app/traffic-bridge-server"]
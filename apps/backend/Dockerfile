FROM golang:1.27.1-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /ludex ./cmd/ludex
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /ludex /ludex
ENV LUDEX_ENV=production LUDEX_HOST=0.0.0.0 PORT=4000
EXPOSE 4000
ENTRYPOINT ["/ludex"]
CMD ["serve"]

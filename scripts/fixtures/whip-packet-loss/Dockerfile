FROM golang:1.26-alpine3.24 AS build
RUN apk add --no-cache git gcc musl-dev
WORKDIR /src
RUN git clone --quiet --depth=1 --branch v5.6.4 https://github.com/bluenviron/gortsplib.git && \
    test "$(git -C gortsplib rev-parse HEAD)" = dde452c28bac66c4c5e03400d534ab26283ed8e6 && \
    git clone --quiet --depth=1 --branch v1.20.1 https://github.com/bluenviron/mediamtx.git && \
    test "$(git -C mediamtx rev-parse HEAD)" = 883194a19b7244355c9bc975c0574c9842733637
COPY gortsplib.patch mediamtx.patch /src/
RUN git -C gortsplib apply /src/gortsplib.patch && git -C mediamtx apply /src/mediamtx.patch
COPY packet_loss_test.go inbound_track_repair_test.go /src/mediamtx/internal/protocols/webrtc/
WORKDIR /src/mediamtx
RUN go mod edit -replace github.com/bluenviron/gortsplib/v5=../gortsplib && \
    cd ../gortsplib && go test -race ./pkg/rtpreceiver -count=1 -timeout=60s
RUN go test -race ./internal/protocols/webrtc \
    -run 'TestWorsePacketLoss|TestInboundVideoLateRepair|TestPeerConnectionRead$|TestPeerConnectionRecomputeSequenceNumber|TestPeerConnectionStripIncomingTWCC' \
    -count=1 -timeout=60s
RUN go generate ./... && \
    printf 'v1.20.1-whip-repair.1' > internal/core/VERSION && \
    CGO_ENABLED=0 go build -trimpath -o /out/mediamtx .

FROM scratch
ARG SOURCE_REVISION
LABEL org.opencontainers.image.source="https://github.com/tprjd/mediamtx-viewer" \
      org.opencontainers.image.revision="$SOURCE_REVISION" \
      org.opencontainers.image.version="1.20.1-whip-repair.1"
COPY --from=build /out/mediamtx /mediamtx
COPY --from=build /src/mediamtx/mediamtx.yml /src/mediamtx/LICENSE /
ENTRYPOINT ["/mediamtx"]

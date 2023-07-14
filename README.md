# How to write simple socket.io load test with K6

Currently at the time i wrote this (Jul 2023), K6 only has support for normal websocket connection.
So this is how it can be done using only k6/ws native library.

## Socket.io connection flow

```log
                    Handshake
                        │
                        │
             Connected to websocket
                        │
                        ├─────────────────→ Do nothing ────→ Websocket close after 10s
                        │
            Emit message with text `40` to
             ask for unique connection id
                        │
                        │
           Server response with unique `sid`
               Connection finished
```

## Socket.io ping-pong flow

```log
             Server send ping message
            with content is a text `2`
                        │
                        │
          Client must response with text `3`
```

import ws from "k6/ws";
import { fail, sleep } from "k6";
import { Counter } from "k6/metrics";
import { URL } from "https://jslib.k6.io/url/1.0.0/index.js";

const msgsSent = Counter("socketio_msgs_sent");

export const CommunicationType = Object.freeze({
  OPEN: "0",
  CLOSE: "1",
  PING: "2",
  PONG: "3",
  MESSAGE: "4",
});

export const ActionType = Object.freeze({
  CONNECT: "0",
  DISCONNECT: "1",
  EVENT: "2",
  ACK: "3",
  ERROR: "4",
});

const EVENT_LOOP_CYCLE_MS = 10;

export default class Client {
  /**
   * @param {string} uri
   */
  constructor(uri) {
    let parsedUri;
    try {
      parsedUri = new URL(uri);
    } catch (_) {
      return fail("Invalid URI");
    }

    const query = parsedUri.searchParams;
    if (!query.has("EIO")) {
      query.set("EIO", "4");
    }
    if (!query.has("transport")) {
      query.set("transport", "websocket");
    }

    this.uri = `${["https:", "wss:"].includes(parsedUri.prototol) ? "wss" : "ws"
      }://${parsedUri.host}${parsedUri.pathname
        .replace(/socket.io$/, "")
        .replace(/socket.io\/$/, "")
        .replace(/\/$/, "")}/socket.io/?${query.toString()}`;

    this.numberAckMsgs = 0;
    this.ackHandlers = {};
    this.eventListeners = {};
    this.events = [];
  }

  /**
   * Listen when original websocket open
   */
  onwsopen(handler) {
    if (this.connected) {
      return;
    }
    this._onwsopen = handler;
  }

  /**
   * Listen when original websocket closed
   */
  onwsclose(handler) {
    if (this.connected) {
      return;
    }
    this._onwsclose = handler;
  }

  /**
   * Listen when original websocket has error
   */
  onwserror(handler) {
    if (this.connected) {
      return;
    }
    this._onwserror = handler;
  }

  /**
   * Listen socket.io event
   */
  on(event, handler) {
    if (this.connected) {
      return;
    }
    this.eventListeners[event] = handler;
  }

  /**
   * @param {number} timeoutSeconds
   */
  setTimeout(timeoutSeconds) {
    if (this.connected) {
      return;
    }
    this.timeoutSeconds = timeoutSeconds;
  }

  /**
   * Start socketio session
   * @returns {import("k6/ws").Response}
   */
  connect() {
    ws.connect(this.uri, (socket) => {
      this.connected = true;
      this._socket = socket;

      if (this._onwsopen) {
        socket.on("open", this.onwsopen);
      }
      if (this._onwsclose) {
        socket.on("close", this.onwsclose);
      }
      if (this._onwserror) {
        socket.on("error", this.onwserror);
      }

      if (this.timeoutSeconds !== undefined) {
        socket.setTimeout(() => {
          this.close(true);
          fail(this.timeoutSeconds + " seconds passed. Closing the socket");
        }, this.timeoutSeconds * 1000);
      }

      socket.on("message", (msg) => {
        const code = msg.match(/^[^({|[)]*/)[0];
        const data = msg.replace(/^[^({|[)]*/, "");
        let parsedData;
        try {
          parsedData = JSON.parse(data);
        } catch (__) { }

        if (code[0]) {
          switch (code[0]) {
            case CommunicationType.OPEN: {
              // Response to server with code 40 to ask for unique connection id.
              socket.send("40");
              break;
            }

            case CommunicationType.PING: {
              // Reply ping-pong, or else connection will be closed
              socket.send(CommunicationType.PONG);
              break;
            }

            case CommunicationType.MESSAGE: {
              switch (code[1]) {
                case ActionType.CONNECT: {
                  // After sending code "40" to server, we receive response with unique sid
                  this.sid = parsedData.sid;
                  if (this.eventListeners["connect"]) {
                    this.eventListeners["connect"](parsedData || data);
                  }
                  break;
                }

                case ActionType.DISCONNECT: {
                  // Connection closed by server
                  if (this.eventListeners["disconnect"]) {
                    this.eventListeners["disconnect"]();
                  }
                  this.close(true);
                  break;
                }

                case ActionType.EVENT: {
                  // Reveice event from server
                  if (this.eventListeners[parsedData[0]]) {
                    this.eventListeners[parsedData[0]](parsedData[1]);
                  }
                  break;
                }

                case ActionType.ACK: {
                  if (code.length > 2) {
                    const ackHandlerNumber = code.slice(2);
                    if (this.ackHandlers[ackHandlerNumber]) {
                      this.ackHandlers[ackHandlerNumber](parsedData || data);
                    }
                    delete this.ackHandlers[ackHandlerNumber];
                  }
                  break;
                }

                case ActionType.ERROR: {
                  if (this.eventListeners["error"]) {
                    this.eventListeners["error"](data);
                  }
                  this.close(true);
                  fail("error: " + data);
                }

                default:
                  this.close(true);
                  fail("Unknown action type: " + code[1]);
              }
              break;
            }

            default:
              this.close(true);
              fail("Unknown communication type: " + code[0]);
          }
        }
      });

      socket.setInterval(() => {
        if (!this.events || !this.events.length) return;

        const event = this.events[0];
        if (typeof event === "function") {
          event();
          this.events.shift();
          return;
        }

        if (typeof event === "object") {
          if (event.sleep) {
            event.sleep -= EVENT_LOOP_CYCLE_MS / 1000;
            if (event.sleep <= 0) {
              this.events.shift();
            } else {
              this.events[0] = event;
            }
            sleep(EVENT_LOOP_CYCLE_MS / 1000);
            return;
          }

          if (event.close) {
            this.close(true);
            return;
          }
        }
      }, EVENT_LOOP_CYCLE_MS);
    });

    return this;
  }

  /**
   * @param {string} channel
   * @param {any} data
   * @param {Function} ack
   */
  emit(channel, data, ack) {
    this.events.push(() => {
      this._socket.send(
        `${CommunicationType.MESSAGE}${ActionType.EVENT}${ack ? this.numberAckMsgs : ""
        }${JSON.stringify([channel, data])}`
      );
      msgsSent.add(1);

      if (ack) {
        this.numberAckMsgs += 1;
        this.ackHandlers[this.numberAckMsgs] = ack;
      }
    });
  }

  sleep(ms) {
    this.events.push({ sleep: ms });
  }

  close(force = false) {
    if (!force) {
      this.events.push({ close: true });
      return;
    }

    if (!this.connected) {
      return;
    }
    this._socket.close();
    this.connected = false;
    this._socket = undefined;
    this.numberAckMsgs = 0;
    this.ackHandlers = {};
    this.eventListeners = {};
  }
}

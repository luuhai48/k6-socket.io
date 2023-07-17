import http from "k6/http";
import { check, fail, sleep } from "k6";
import Client from "./socketio.js";

const GET_OTP_URL = "http://localhost:4000/api/v2/otp";
const SOCKETIO_URL = "http://localhost:3000";

export let options = {
  summaryTrendStats: ["min", "med", "avg", "max", "p(90)", "p(95)", "p(99)"],
  stages: [
    { duration: "10s", target: 100 },

    { duration: "2m", target: 1000 },
    { duration: "2m", target: 1000 },

    { duration: "30s", target: 0 },
  ],
};

export default function() {
  const getOtpRequest = http.get(GET_OTP_URL);

  if (
    check(getOtpRequest, {
      "status is 200": (res) => res.status === 200,
    })
  ) {
    const json = getOtpRequest.json();
    const client = new Client(`${SOCKETIO_URL}/?otp=${json.otp}`);
    client.setTimeout(60);

    client.on("error", (err) => {
      fail(typeof err === "string" ? err : JSON.stringify(err));
    });

    client.on("disconnect", () => {
      console.log("disconnected");
    });

    client.on("connect", (data) => {
      console.log("Connected:" + JSON.stringify(data));

      sleep(1);

      client.emit("hello", {
        data: "abc",
      });
      sleep(3);
      client.emit("hello", {
        data: "abc",
      });
      client.emit("hello", {
        data: "abc",
      });
    });

    client.connect();
  } else {
    fail(
      "Failed to get OTP: " +
      getOtpRequest.error_code +
      " - " +
      getOtpRequest.error
    );
  }
}

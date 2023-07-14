import http from "k6/http";
import { check, fail, sleep } from "k6";
import {
  uuidv4,
  randomItem,
  randomIntBetween,
} from "https://jslib.k6.io/k6-utils/1.4.0/index.js";

import Client from "./socketio.js";

export let options = {
  summaryTrendStats: ["min", "med", "avg", "max", "p(90)", "p(95)", "p(99)"],
  stages: [
    { duration: "10s", target: 100 },

    { duration: "2m", target: 1000 },
    { duration: "2m", target: 1000 },

    { duration: "30s", target: 0 },
  ],
};

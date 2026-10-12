import axios from "axios";

const apiKey = process.env.OPEN_DATA_KEY;
const REQUEST_TIMEOUT_MS = 10 * 1000;

export const tfnswClient = axios.create({
  timeout: REQUEST_TIMEOUT_MS,
  headers: {
    Accept: "application/x-google-protobuf",
    ...(apiKey ? { Authorization: `apikey ${apiKey}` } : {}),
  },
});

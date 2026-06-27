import axios from "axios";

const apiKey = process.env.OPEN_DATA_KEY;

export const tfnswClient = axios.create({
  headers: {
    Accept: "application/x-google-protobuf",
    ...(apiKey ? { Authorization: `apikey ${apiKey}` } : {}),
  },
});

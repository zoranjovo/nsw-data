import axios from "axios";

const BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/api$/, "") ??
  "http://localhost:3000";

export interface HealthResponse {
  status: "ok" | "starting";
  buildHash: string;
}

export const getHealth = async (): Promise<HealthResponse> => {
  const response = await axios.get<HealthResponse>(`${BASE_URL}/health`);
  return response.data;
};

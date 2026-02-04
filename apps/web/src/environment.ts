import { z } from "zod";

const schema = z.object({
  VITE_API_BASE_URL: z.url(),
});

export const environment = schema.parse(import.meta.env);

import type { Locale } from "../shared/constants";
import type { UserDoc } from "./models";

declare global {
  namespace Express {
    interface Request {
      /** Authenticated user (set by the authenticate middleware). */
      user?: UserDoc;
      locale: Locale;
      requestId: string;
      /** Parsed and validated input (set by the validate middleware). */
      valid: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
    }
  }
}

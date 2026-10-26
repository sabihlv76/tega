import express from "express";
import { config } from "./config";
import {
  authenticate,
  cors,
  errorHandler,
  notFoundHandler,
  requestContext,
  requestLogger,
  securityHeaders,
} from "./middleware";
import { adminRouter } from "./routes/admin";
import { authRouter } from "./routes/auth";
import { filesRouter, webhooksRouter } from "./routes/files";
import { meRouter } from "./routes/me";
import { operatorRouter } from "./routes/operator";
import { publicRouter } from "./routes/public";
import { stationRouter } from "./routes/station";

/** Builds the Express application (also used directly by the integration tests). */
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy ? 1 : false);

  app.use(requestContext);
  app.use(securityHeaders);
  app.use(cors);
  app.use(requestLogger);

  // Webhooks need the raw body, so they are mounted before the JSON parser.
  app.use("/api/v1/webhooks", webhooksRouter);

  app.use(express.json({ limit: "200kb" }));
  app.use(express.urlencoded({ extended: false, limit: "200kb" }));
  app.use("/api/v1", authenticate);

  app.use("/api/v1", publicRouter);
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1", meRouter);
  app.use("/api/v1", operatorRouter);
  app.use("/api/v1", stationRouter);
  app.use("/api/v1", adminRouter);
  app.use("/api/v1", filesRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

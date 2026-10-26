import express, { Router } from "express";
import { Types } from "mongoose";
import { ApiError, notFound } from "../lib/errors";
import { errorFields, logger } from "../lib/logger";
import { requireAuth } from "../middleware";
import { FileModel } from "../models";
import { processWebhook } from "../services/payments/service";
import { readLocalObject, signedObjectUrl } from "../services/storage";
import { requireUser } from "./helpers";

export const filesRouter = Router();
filesRouter.use("/files", requireAuth);

/** Documents are private: admins, the uploading user and staff of the owning operator only. */
filesRouter.get("/files/:id", async (req, res) => {
  if (!Types.ObjectId.isValid(String(req.params.id))) throw notFound();
  const user = requireUser(req);
  const file = await FileModel.findById(req.params.id).lean();
  if (!file) throw notFound();
  const allowed =
    user.role === "admin" ||
    file.ownerId?.equals(user._id) ||
    (user.role === "operator" && file.operatorId && user.operatorId?.equals(file.operatorId));
  if (!allowed) throw new ApiError(403, "FORBIDDEN");
  if (file.driver === "s3") {
    res.redirect(signedObjectUrl(file.key, 300));
    return;
  }
  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Content-Disposition", `inline; filename="${file.filename.replace(/"/g, "")}"`);
  res.setHeader("Cache-Control", "private, max-age=300");
  const stream = readLocalObject(file.key);
  stream.on("error", (err) => {
    logger.error("File read failed", { id: req.params.id, ...errorFields(err) });
    if (!res.headersSent) res.status(404).end();
  });
  stream.pipe(res);
});

export const webhooksRouter = Router();

// Raw body so the original payload can be stored for reconciliation.
webhooksRouter.post("/payments/:provider", express.text({ type: "*/*", limit: "1mb" }), async (req, res) => {
  const provider = String(req.params.provider).toLowerCase();
  if (!["mtn", "airtel", "generic"].includes(provider)) throw notFound();
  await processWebhook(provider, typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}), req.headers["x-webhook-secret"] as string | undefined);
  res.json({ ok: true });
});

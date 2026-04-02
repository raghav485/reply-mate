import { createHmac, timingSafeEqual } from "node:crypto";
import { ProviderError } from "../core/errors.js";

export function createStripeWebhookSignature(input: {
  rawBody: Buffer;
  secret: string;
  timestamp: number | string;
}): string {
  return createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${input.rawBody.toString("utf8")}`)
    .digest("hex");
}

export function buildStripeWebhookSignatureHeader(input: {
  rawBody: Buffer;
  secret: string;
  timestamp?: number;
}): string {
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  const signature = createStripeWebhookSignature({
    rawBody: input.rawBody,
    secret: input.secret,
    timestamp,
  });
  return `t=${timestamp},v1=${signature}`;
}

export function verifyStripeWebhookSignature(input: {
  rawBody: Buffer;
  signatureHeader: string;
  secret: string;
}): void {
  const headerParts = Object.fromEntries(
    input.signatureHeader.split(",").map((segment) => {
      const [key, value] = segment.split("=", 2);
      return [key, value];
    })
  ) as Record<string, string | undefined>;
  const timestamp = headerParts.t;
  const signature = headerParts.v1;

  if (!timestamp || !signature) {
    throw new ProviderError({
      message: "Stripe webhook signature is missing.",
      errorCode: "BILLING_UNAVAILABLE",
      statusCode: 400,
      retryable: false,
    });
  }

  const expected = createStripeWebhookSignature({
    rawBody: input.rawBody,
    secret: input.secret,
    timestamp,
  });
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    throw new ProviderError({
      message: "Stripe webhook signature validation failed.",
      errorCode: "BILLING_UNAVAILABLE",
      statusCode: 400,
      retryable: false,
    });
  }
}

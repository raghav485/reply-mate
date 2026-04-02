import type { Logger } from "@replymate/contracts";
import type { EmailDeliveryAdapter, MagicLinkDelivery } from "./EmailDeliveryAdapter.js";

export class ConsoleEmailDeliveryAdapter implements EmailDeliveryAdapter {
  constructor(private readonly logger: Logger) {}

  async sendMagicLink(input: MagicLinkDelivery): Promise<void> {
    this.logger.info("magic_link_generated", {
      email: input.email,
      expiresAt: input.expiresAt,
      verificationUrl: input.verificationUrl,
    });
  }
}

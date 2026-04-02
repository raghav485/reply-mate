export type MagicLinkDelivery = {
  email: string;
  verificationUrl: string;
  expiresAt: string;
};

export interface EmailDeliveryAdapter {
  sendMagicLink(input: MagicLinkDelivery): Promise<void>;
}

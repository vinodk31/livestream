import "server-only";
import QRCode from "qrcode";
import { env } from "../env";

export function watchUrl(slug: string): string {
  return `${env.appUrl}/watch/${slug}`;
}

const QR_OPTIONS = { errorCorrectionLevel: "M", margin: 2 } as const;

export function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { ...QR_OPTIONS, type: "svg" });
}

export function qrPng(url: string, width = 1024): Promise<Buffer> {
  return QRCode.toBuffer(url, { ...QR_OPTIONS, type: "png", width });
}

import { ValidationError } from "./errors.js";

export type ParsedMultipartForm = {
  fields: Record<string, string>;
  file: {
    fieldName: string;
    fileName: string;
    mimeType: string;
    data: Buffer;
  } | null;
};

function readBoundary(contentType: string | undefined): string {
  if (!contentType) {
    throw new ValidationError("Missing multipart content type.", "CONTRACT_VERSION_MISMATCH");
  }

  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = match?.[1] || match?.[2];
  if (!boundary) {
    throw new ValidationError("Multipart boundary is missing.", "CONTRACT_VERSION_MISMATCH");
  }

  return boundary;
}

function parseContentDisposition(value: string): {
  name?: string;
  filename?: string;
} {
  const nameMatch = value.match(/name="([^"]+)"/i);
  const fileMatch = value.match(/filename="([^"]+)"/i);
  return {
    name: nameMatch?.[1],
    filename: fileMatch?.[1],
  };
}

export function parseMultipartFormData(
  contentType: string | undefined,
  body: Buffer
): ParsedMultipartForm {
  const boundary = readBoundary(contentType);
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const fields: Record<string, string> = {};
  let file: ParsedMultipartForm["file"] = null;

  let offset = body.indexOf(boundaryBuffer);
  while (offset !== -1) {
    let partStart = offset + boundaryBuffer.length;
    if (body[partStart] === 45 && body[partStart + 1] === 45) {
      break;
    }

    if (body[partStart] === 13 && body[partStart + 1] === 10) {
      partStart += 2;
    }

    const nextBoundary = body.indexOf(boundaryBuffer, partStart);
    if (nextBoundary === -1) {
      break;
    }

    const part = body.slice(partStart, nextBoundary - 2);
    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd === -1) {
      offset = nextBoundary;
      continue;
    }

    const headerText = part.slice(0, headerEnd).toString("utf8");
    const content = part.slice(headerEnd + 4);
    const headers = headerText.split("\r\n");

    let fieldName = "";
    let fileName = "";
    let mimeType = "application/octet-stream";

    for (const header of headers) {
      const [rawKey, ...rawRest] = header.split(":");
      const key = rawKey.toLowerCase();
      const value = rawRest.join(":").trim();

      if (key === "content-disposition") {
        const parsed = parseContentDisposition(value);
        fieldName = parsed.name || "";
        fileName = parsed.filename || "";
      } else if (key === "content-type") {
        mimeType = value || mimeType;
      }
    }

    if (!fieldName) {
      offset = nextBoundary;
      continue;
    }

    if (fileName) {
      file = {
        fieldName,
        fileName,
        mimeType,
        data: content,
      };
    } else {
      fields[fieldName] = content.toString("utf8");
    }

    offset = nextBoundary;
  }

  return { fields, file };
}

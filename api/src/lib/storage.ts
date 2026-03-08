import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let _s3: S3Client | null = null;

function getS3(): S3Client {
  if (!_s3) {
    _s3 = new S3Client({
      endpoint: process.env.AWS_ENDPOINT_URL,
      region: process.env.AWS_DEFAULT_REGION ?? "auto",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
      forcePathStyle: true, // required for Railway / non-AWS S3
    });
  }
  return _s3;
}

function getBucket(): string {
  const bucket = process.env.AWS_S3_BUCKET_NAME;
  if (!bucket) throw new Error("AWS_S3_BUCKET_NAME is not configured");
  return bucket;
}

export function isStorageConfigured(): boolean {
  return !!(
    process.env.AWS_ENDPOINT_URL &&
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_S3_BUCKET_NAME
  );
}

/** Generate a presigned PUT URL — client uploads directly to S3 */
export async function generateUploadUrl(key: string, contentType: string): Promise<string> {
  return getSignedUrl(
    getS3(),
    new PutObjectCommand({ Bucket: getBucket(), Key: key, ContentType: contentType }),
    { expiresIn: 300 }, // 5 minutes
  );
}

/** Upload a Buffer directly to S3 (server-side upload — for URL fetch and base64 flows) */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await getS3().send(new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
}

/** Proxy-stream an object from S3. Returns null if the key does not exist. */
export async function getObject(key: string): Promise<{ body: ReadableStream; contentType: string; contentLength: number } | null> {
  try {
    const res = await getS3().send(new GetObjectCommand({ Bucket: getBucket(), Key: key }));
    if (!res.Body) return null;
    return {
      body: res.Body.transformToWebStream(),
      contentType: res.ContentType ?? "application/octet-stream",
      contentLength: res.ContentLength ?? 0,
    };
  } catch (err: unknown) {
    // S3 throws NoSuchKey (or 404) when the object doesn't exist
    const code = (err as { Code?: string; name?: string })?.Code ?? (err as { name?: string })?.name;
    if (code === "NoSuchKey" || code === "NotFound") return null;
    throw err;
  }
}

/** Hard-delete an object from S3 */
export async function deleteObject(key: string): Promise<void> {
  await getS3().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: key }));
}

/** Check if an object exists in S3. Only returns false for true 404; throws on other errors. */
export async function objectExists(key: string): Promise<boolean> {
  try {
    await getS3().send(new HeadObjectCommand({ Bucket: getBucket(), Key: key }));
    return true;
  } catch (err: unknown) {
    const code = (err as { Code?: string; name?: string })?.Code ?? (err as { name?: string })?.name;
    if (code === "NotFound" || code === "NoSuchKey") return false;
    throw err; // credentials failure, network error, etc. should propagate
  }
}

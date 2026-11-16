import {
  GetObjectCommand,
  ListBucketsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-File-Name, Accept',
};

let cachedBucketName = null;

/**
 * Resolve o nome do bucket S3 de imagens de perfil:
 * 1) Lê a variável de ambiente BUCKET_NAME / PROFILE_BUCKET_NAME (se configurada)
 * 2) Caso contrário, procura automaticamente na conta AWS um bucket cujo nome contenha "profile"
 * 3) Fallback para "profile"
 */
async function resolveProfileBucketName() {
  const envBucket =
    process.env.BUCKET_NAME ||
    process.env.PROFILE_BUCKET_NAME ||
    process.env.S3_BUCKET_NAME;

  if (envBucket) {
    return envBucket.trim();
  }

  if (cachedBucketName) {
    return cachedBucketName;
  }

  try {
    const { Buckets } = await s3.send(new ListBucketsCommand({}));
    if (Array.isArray(Buckets) && Buckets.length > 0) {
      const exactMatch = Buckets.find((b) => b.Name?.toLowerCase() === 'profile');
      if (exactMatch?.Name) {
        cachedBucketName = exactMatch.Name;
        return cachedBucketName;
      }

      const partialMatch = Buckets.find((b) => b.Name?.toLowerCase().includes('profile'));
      if (partialMatch?.Name) {
        cachedBucketName = partialMatch.Name;
        return cachedBucketName;
      }
    }
  } catch (err) {
    console.warn('[RANDANDAN Profile Lambda] Não foi possível listar buckets, usando "profile":', err?.message || err);
  }

  return 'profile';
}

/**
 * Extrai e valida o usuário autenticado a partir do JWT do Amazon Cognito
 * (via Authorizer do API Gateway ou cabeçalho Authorization: Bearer <token>).
 */
function extractAuthenticatedUser(event) {
  // 1. Claims já validadas pelo JWT Authorizer (HTTP API v2) ou Cognito Authorizer (REST API v1)
  const authorizerClaims =
    event?.requestContext?.authorizer?.jwt?.claims ||
    event?.requestContext?.authorizer?.claims;

  if (authorizerClaims?.sub) {
    return {
      userId: String(authorizerClaims.sub),
      email: String(authorizerClaims.email || authorizerClaims['cognito:username'] || authorizerClaims.sub),
    };
  }

  // 2. Fallback: Decodifica o JWT do header Authorization: Bearer <token>
  const authHeader =
    event?.headers?.authorization ||
    event?.headers?.Authorization ||
    event?.queryStringParameters?.token ||
    '';

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token || token.split('.').length !== 3) {
    return null;
  }

  try {
    const payloadBase64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payloadJson = Buffer.from(payloadBase64, 'base64').toString('utf-8');
    const payload = JSON.parse(payloadJson);

    if (!payload?.sub) {
      return null;
    }

    // Verifica expiração do token JWT
    if (payload.exp && Date.now() >= Number(payload.exp) * 1000) {
      return null;
    }

    return {
      userId: String(payload.sub),
      email: String(payload.email || payload['cognito:username'] || payload.sub),
    };
  } catch {
    return null;
  }
}

/**
 * Verifica os magic bytes (assinatura binária) do buffer para garantir
 * que o arquivo enviado é exclusivamente uma imagem real (PNG, JPEG, GIF ou WEBP).
 */
function detectImageMimeFromMagicBytes(buffer) {
  if (!buffer || buffer.length < 12) {
    return null;
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // GIF: "GIF87a" ou "GIF89a"
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) {
    return 'image/gif';
  }

  // WEBP: "RIFF" .... "WEBP"
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

/**
 * Extrai o Buffer binário da imagem e seu Content-Type a partir do evento POST
 * (suporta envio binário direto via fetch, Data URL / Base64 em JSON ou texto).
 */
function parseIncomingImagePayload(event) {
  const rawContentType = (
    event?.headers?.['content-type'] ||
    event?.headers?.['Content-Type'] ||
    ''
  )
    .split(';')[0]
    .trim()
    .toLowerCase();

  const body = event?.body;
  if (!body) {
    throw new Error('Nenhum arquivo de imagem foi enviado no corpo da requisição.');
  }

  // Caso 1: JSON contendo { imageBase64 / image, contentType, fileName }
  if (rawContentType === 'application/json' || (typeof body === 'string' && body.trim().startsWith('{'))) {
    let parsed;
    try {
      parsed = typeof body === 'string' ? JSON.parse(body) : body;
    } catch {
      throw new Error('JSON inválido no envio da imagem.');
    }

    const rawBase64 = String(parsed.imageBase64 || parsed.image || parsed.data || '').trim();
    if (!rawBase64) {
      throw new Error('O campo "imageBase64" é obrigatório.');
    }

    let declaredMime = String(parsed.contentType || '').toLowerCase().trim();
    let base64Clean = rawBase64;

    const dataUrlMatch = rawBase64.match(/^data:([^;]+);base64,(.+)$/i);
    if (dataUrlMatch) {
      declaredMime = dataUrlMatch[1].toLowerCase().trim();
      base64Clean = dataUrlMatch[2];
    }

    const buffer = Buffer.from(base64Clean, 'base64');
    const magicMime = detectImageMimeFromMagicBytes(buffer);
    const finalMime = magicMime || declaredMime;

    if (!magicMime || !ALLOWED_IMAGE_MIME_TYPES.has(finalMime)) {
      throw new Error(
        'Arquivo inválido! Apenas arquivos de imagem (PNG, JPEG, WEBP ou GIF) são permitidos.',
      );
    }

    return {
      buffer,
      contentType: finalMime === 'image/jpg' ? 'image/jpeg' : finalMime,
      fileName: String(parsed.fileName || 'profile-avatar'),
    };
  }

  // Caso 2: Envio binário direto via fetch (body: file / Blob)
  const buffer = event.isBase64Encoded
    ? Buffer.from(body, 'base64')
    : Buffer.isBuffer(body)
      ? body
      : Buffer.from(body, 'binary');

  const magicMime = detectImageMimeFromMagicBytes(buffer);
  const finalMime = magicMime || rawContentType;

  if (!magicMime || !ALLOWED_IMAGE_MIME_TYPES.has(finalMime)) {
    throw new Error(
      'Arquivo inválido! Envie exclusivamente um arquivo de imagem válido (PNG, JPEG, WEBP ou GIF).',
    );
  }

  return {
    buffer,
    contentType: finalMime === 'image/jpg' ? 'image/jpeg' : finalMime,
    fileName:
      event?.headers?.['x-file-name'] ||
      event?.headers?.['X-File-Name'] ||
      'profile-avatar',
  };
}

export const handler = async (event) => {
  console.log('[RANDANDAN Profile Lambda] Evento recebido:', JSON.stringify({
    httpMethod: event?.httpMethod || event?.requestContext?.http?.method,
    path: event?.path || event?.rawPath,
    headers: event?.headers ? Object.keys(event.headers) : [],
    isBase64Encoded: event?.isBase64Encoded,
  }));

  const method = (
    event?.requestContext?.http?.method ||
    event?.httpMethod ||
    'GET'
  ).toUpperCase();

  // 1. Responde preflight CORS
  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
      body: '',
    };
  }

  // 2. Valida o token JWT do Cognito
  const user = extractAuthenticatedUser(event);
  if (!user) {
    return {
      statusCode: 401,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: 'Não autorizado. Token JWT do Amazon Cognito ausente ou inválido.',
      }),
    };
  }

  const bucketName = await resolveProfileBucketName();
  const objectKey = `profiles/${user.userId}/avatar`;

  try {
    // 3. Método POST /profile -> Recebe e processa exclusivamente arquivos de imagem e salva no S3
    if (method === 'POST') {
      const { buffer, contentType, fileName } = parseIncomingImagePayload(event);

      // Limite de 5 MB para imagem de perfil
      const maxBytes = 5 * 1024 * 1024;
      if (buffer.length > maxBytes) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            error: 'A imagem excede o tamanho máximo permitido de 5 MB.',
          }),
        };
      }

      const updatedAt = new Date().toISOString();

      await s3.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: objectKey,
          Body: buffer,
          ContentType: contentType,
          Metadata: {
            userid: user.userId,
            email: user.email,
            filename: String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_'),
            updatedat: updatedAt,
          },
        }),
      );

      console.log(
        `[RANDANDAN Profile Lambda] Imagem salva com sucesso em s3://${bucketName}/${objectKey} (${contentType}, ${buffer.length} bytes)`,
      );

      const base64DataUrl = `data:${contentType};base64,${buffer.toString('base64')}`;

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          message: 'Imagem de perfil enviada e processada com sucesso!',
          bucket: bucketName,
          key: objectKey,
          contentType,
          sizeBytes: buffer.length,
          updatedAt,
          imageUrl: base64DataUrl,
        }),
      };
    }

    // 4. Método GET /profile -> Lê a imagem de perfil do usuário no S3
    if (method === 'GET') {
      try {
        const s3Response = await s3.send(
          new GetObjectCommand({
            Bucket: bucketName,
            Key: objectKey,
          }),
        );

        const byteArray = await s3Response.Body.transformToByteArray();
        const buffer = Buffer.from(byteArray);
        const contentType = s3Response.ContentType || detectImageMimeFromMagicBytes(buffer) || 'image/jpeg';
        const base64String = buffer.toString('base64');

        // Se a requisição pedir imagem binária direta (?raw=1)
        if (event?.queryStringParameters?.raw === '1') {
          return {
            statusCode: 200,
            isBase64Encoded: true,
            headers: {
              ...CORS_HEADERS,
              'Content-Type': contentType,
              'Cache-Control': 'no-cache',
            },
            body: base64String,
          };
        }

        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            exists: true,
            bucket: bucketName,
            key: objectKey,
            contentType,
            sizeBytes: buffer.length,
            updatedAt: s3Response.Metadata?.updatedat || s3Response.LastModified?.toISOString() || null,
            imageUrl: `data:${contentType};base64,${base64String}`,
          }),
        };
      } catch (s3Err) {
        if (s3Err?.name === 'NoSuchKey' || s3Err?.$metadata?.httpStatusCode === 404) {
          return {
            statusCode: 404,
            headers: CORS_HEADERS,
            body: JSON.stringify({
              exists: false,
              message: 'Nenhuma imagem de perfil enviada ainda para este usuário.',
            }),
          };
        }
        throw s3Err;
      }
    }

    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: `Método ${method} não permitido na rota /profile.` }),
    };
  } catch (error) {
    console.error('[RANDANDAN Profile Lambda] Erro:', error);
    const statusCode = String(error?.message || '').includes('Arquivo inválido') ||
      String(error?.message || '').includes('Nenhum arquivo')
      ? 400
      : 500;

    return {
      statusCode,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Erro interno ao processar a imagem de perfil.',
      }),
    };
  }
};

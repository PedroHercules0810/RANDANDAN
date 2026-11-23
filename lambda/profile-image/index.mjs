import {
  DescribeTableCommand,
  DynamoDBClient,
  GetItemCommand,
  ListTablesCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import {
  GetObjectCommand,
  ListBucketsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const REGION = process.env.AWS_REGION || 'us-east-1';
const s3 = new S3Client({ region: REGION });
const dynamo = new DynamoDBClient({ region: REGION });

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-File-Name, Accept',
};

let cachedBucketName = null;
let cachedTableSchema = null;

/**
 * Descobre o nome do bucket S3 de imagens de perfil:
 * 1) Variável de ambiente BUCKET_NAME / PROFILE_BUCKET_NAME
 * 2) Busca automática na conta AWS por um bucket cujo nome contenha "profile"
 */
async function resolveProfileBucketName() {
  const envBucket =
    process.env.BUCKET_NAME ||
    process.env.PROFILE_BUCKET_NAME ||
    process.env.S3_BUCKET_NAME;

  if (envBucket) return envBucket.trim();
  if (cachedBucketName) return cachedBucketName;

  try {
    const { Buckets } = await s3.send(new ListBucketsCommand({}));
    if (Array.isArray(Buckets) && Buckets.length > 0) {
      const exactMatch = Buckets.find((b) => b.Name?.toLowerCase() === 'profile');
      if (exactMatch?.Name) return (cachedBucketName = exactMatch.Name);

      const partialMatch = Buckets.find((b) => b.Name?.toLowerCase().includes('profile'));
      if (partialMatch?.Name) return (cachedBucketName = partialMatch.Name);
    }
  } catch (err) {
    console.warn('[RANDANDAN Profile Lambda] Aviso ao listar buckets S3:', err?.message || err);
  }
  return 'profile';
}

/**
 * Descobre automaticamente a tabela do DynamoDB e o nome exato da sua Chave Principal (Partition Key)
 * usando ListTables + DescribeTable, ou lê DYNAMODB_TABLE_NAME se configurada.
 */
async function resolveDynamoTableSchema() {
  if (cachedTableSchema) {
    return cachedTableSchema;
  }

  let tableName =
    process.env.DYNAMODB_TABLE_NAME ||
    process.env.DYNAMODB_TABLE ||
    process.env.TABLE_NAME ||
    '';

  if (!tableName) {
    try {
      const { TableNames } = await dynamo.send(new ListTablesCommand({}));
      if (Array.isArray(TableNames) && TableNames.length > 0) {
        const preferred = TableNames.find((name) =>
          /profile|user|randandan|pilot|chat/i.test(name),
        );
        tableName = preferred || TableNames[0];
      }
    } catch (err) {
      console.warn('[RANDANDAN Profile Lambda] Aviso ao listar tabelas DynamoDB:', err?.message || err);
    }
  }

  if (!tableName) {
    tableName = 'profile';
  }

  let hashKeyName = process.env.DYNAMODB_PK_NAME || 'username';
  let rangeKeyName = null;
  let rangeKeyType = 'S';

  try {
    const { Table } = await dynamo.send(new DescribeTableCommand({ TableName: tableName }));
    const keySchema = Table?.KeySchema || [];
    const attrDefs = Table?.AttributeDefinitions || [];

    const hashEntry = keySchema.find((k) => k.KeyType === 'HASH');
    if (hashEntry?.AttributeName) {
      hashKeyName = hashEntry.AttributeName;
    }

    const rangeEntry = keySchema.find((k) => k.KeyType === 'RANGE');
    if (rangeEntry?.AttributeName) {
      rangeKeyName = rangeEntry.AttributeName;
      const def = attrDefs.find((a) => a.AttributeName === rangeKeyName);
      if (def?.AttributeType) {
        rangeKeyType = def.AttributeType;
      }
    }
  } catch (err) {
    console.warn(
      `[RANDANDAN Profile Lambda] Não foi possível descrever a tabela "${tableName}", usando chave padrão "${hashKeyName}":`,
      err?.message || err,
    );
  }

  cachedTableSchema = { tableName, hashKeyName, rangeKeyName, rangeKeyType };
  console.log('[RANDANDAN Profile Lambda] Schema DynamoDB resolvido:', JSON.stringify(cachedTableSchema));
  return cachedTableSchema;
}

function buildDynamoKey(schema, username) {
  const key = {
    [schema.hashKeyName]: { S: String(username) },
  };
  if (schema.rangeKeyName) {
    key[schema.rangeKeyName] =
      schema.rangeKeyType === 'N' ? { N: '0' } : { S: 'profile' };
  }
  return key;
}

/**
 * Converte a lista de mensagens do formato AttributeValue do DynamoDB para array JS.
 */
function parseDynamoMessages(listAttr) {
  if (!listAttr?.L || !Array.isArray(listAttr.L)) {
    return [];
  }

  return listAttr.L.map((item) => {
    const m = item?.M || {};
    return {
      id: m.id?.S || `msg-${Date.now()}`,
      role: m.role?.S || 'model',
      sender: m.sender?.S || '',
      text: m.text?.S || '',
      timestamp: m.timestamp?.S || '',
    };
  }).filter((msg) => msg.text);
}

/**
 * Converte um array de mensagens JS para o formato AttributeValue (L) do DynamoDB.
 */
function toDynamoMessagesList(messages) {
  return messages
    .filter((m) => m && m.text)
    .map((m) => ({
      M: {
        id: { S: String(m.id || `msg-${Date.now()}`) },
        role: { S: String(m.role || 'user') },
        sender: { S: String(m.sender || (m.role === 'model' ? 'Chefe de Box (Google Gemini)' : 'Piloto')) },
        text: { S: String(m.text) },
        timestamp: { S: String(m.timestamp || new Date().toISOString()) },
      },
    }));
}

/**
 * Extrai e valida o usuário autenticado a partir do JWT do Amazon Cognito
 * e resolve o "nome do usuário" (usado como chave principal no DynamoDB).
 */
function extractAuthenticatedUser(event, parsedBody = null) {
  const authorizerClaims =
    event?.requestContext?.authorizer?.jwt?.claims ||
    event?.requestContext?.authorizer?.claims ||
    {};

  const authHeader =
    event?.headers?.authorization ||
    event?.headers?.Authorization ||
    event?.queryStringParameters?.token ||
    '';

  let jwtClaims = {};
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (token && token.split('.').length === 3) {
    try {
      const payloadBase64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      jwtClaims = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf-8')) || {};
      if (jwtClaims.exp && Date.now() >= Number(jwtClaims.exp) * 1000) {
        return null;
      }
    } catch {
      // Ignora erro de parse se authorizerClaims já existir
    }
  }

  const claims = { ...jwtClaims, ...authorizerClaims };
  const sub = claims.sub;
  if (!sub) {
    return null;
  }

  const email = String(claims.email || claims['cognito:username'] || sub);
  const emailPrefix = email.includes('@') ? email.split('@')[0] : email;

  const explicitUsername =
    parsedBody?.username ||
    event?.queryStringParameters?.username ||
    '';

  const tokenDisplayName =
    claims.name ||
    claims.given_name ||
    claims.preferred_username ||
    claims.nickname ||
    emailPrefix;

  const username = String(explicitUsername || tokenDisplayName || sub).trim();

  return {
    userId: String(sub),
    username,
    email,
  };
}

function sanitizeS3Slug(name) {
  return (
    String(name)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'pilot'
  );
}

function detectImageMimeFromMagicBytes(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return 'image/gif';
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Extrai S3 bucket e key a partir de um link https://bucket.s3.region.amazonaws.com/key ou s3://bucket/key
 */
function parseS3Url(s3Url, defaultBucket) {
  if (!s3Url) return null;
  const trimmed = String(s3Url).trim();

  if (trimmed.startsWith('s3://')) {
    const withoutProto = trimmed.slice(5);
    const slashIdx = withoutProto.indexOf('/');
    if (slashIdx !== -1) {
      return {
        bucket: withoutProto.slice(0, slashIdx),
        key: decodeURIComponent(withoutProto.slice(slashIdx + 1)),
      };
    }
  }

  try {
    const url = new URL(trimmed);
    const hostParts = url.hostname.split('.');
    // Formato virtual-hosted: <bucket>.s3.<region>.amazonaws.com/<key>
    if (hostParts[1] === 's3' && hostParts[0]) {
      return {
        bucket: hostParts[0],
        key: decodeURIComponent(url.pathname.replace(/^\/+/, '')),
      };
    }
    // Formato path-style: s3.<region>.amazonaws.com/<bucket>/<key>
    if (hostParts[0] === 's3') {
      const pathParts = url.pathname.replace(/^\/+/, '').split('/');
      if (pathParts.length >= 2) {
        return {
          bucket: pathParts[0],
          key: decodeURIComponent(pathParts.slice(1).join('/')),
        };
      }
    }
  } catch {
    // Fallback abaixo
  }

  return { bucket: defaultBucket, key: trimmed };
}

function parseIncomingImagePayload(event, parsedJsonBody) {
  const rawContentType = (event?.headers?.['content-type'] || event?.headers?.['Content-Type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase();

  const body = event?.body;
  if (!body && !parsedJsonBody) {
    throw new Error('Nenhum arquivo de imagem foi enviado no corpo da requisição.');
  }

  if (parsedJsonBody) {
    const rawBase64 = String(
      parsedJsonBody.imageBase64 || parsedJsonBody.image || parsedJsonBody.data || '',
    ).trim();
    if (!rawBase64) {
      throw new Error('O campo "imageBase64" é obrigatório.');
    }

    let declaredMime = String(parsedJsonBody.contentType || '').toLowerCase().trim();
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
      fileName: String(parsedJsonBody.fileName || 'profile-avatar'),
    };
  }

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
    fileName: event?.headers?.['x-file-name'] || event?.headers?.['X-File-Name'] || 'profile-avatar',
  };
}

export const handler = async (event) => {
  const method = (event?.requestContext?.http?.method || event?.httpMethod || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  // Parse opcional de JSON caso seja POST
  let parsedJsonBody = null;
  if (method === 'POST' && event?.body) {
    if (typeof event.body === 'object' && !Buffer.isBuffer(event.body)) {
      parsedJsonBody = event.body;
    } else if (typeof event.body === 'string') {
      const rawStr = event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf-8')
        : event.body;
      if (rawStr.trim().startsWith('{')) {
        try {
          parsedJsonBody = JSON.parse(rawStr);
        } catch {
          parsedJsonBody = null;
        }
      }
    }
  }

  const user = extractAuthenticatedUser(event, parsedJsonBody);
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
  const tableSchema = await resolveDynamoTableSchema();
  const dynamoKey = buildDynamoKey(tableSchema, user.username);

  try {
    // =========================================================================
    // POST /profile
    // - Sub-ação 1: Sincronizar mensagens do chat com o agente de IA no DynamoDB
    // - Sub-ação 2: Upload de imagem de perfil no S3 + salvar link do S3 no DynamoDB
    // =========================================================================
    if (method === 'POST') {
      if (parsedJsonBody?.action === 'append_messages' && Array.isArray(parsedJsonBody.messages)) {
        const newDynamoMsgs = toDynamoMessagesList(parsedJsonBody.messages);
        const updatedAt = new Date().toISOString();

        const updateRes = await dynamo.send(
          new UpdateItemCommand({
            TableName: tableSchema.tableName,
            Key: dynamoKey,
            UpdateExpression:
              'SET messages = list_append(if_not_exists(messages, :empty_list), :new_msgs), updatedAt = :u, email = :e',
            ExpressionAttributeValues: {
              ':empty_list': { L: [] },
              ':new_msgs': { L: newDynamoMsgs },
              ':u': { S: updatedAt },
              ':e': { S: user.email },
            },
            ReturnValues: 'ALL_NEW',
          }),
        );

        const allMessages = parseDynamoMessages(updateRes.Attributes?.messages);
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            message: 'Mensagens salvas no DynamoDB com sucesso!',
            username: user.username,
            tableName: tableSchema.tableName,
            messages: allMessages,
          }),
        };
      }

      // Upload de imagem de perfil exclusivamente
      const { buffer, contentType, fileName } = parseIncomingImagePayload(event, parsedJsonBody);
      const maxBytes = 5 * 1024 * 1024;
      if (buffer.length > maxBytes) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'A imagem excede o tamanho máximo permitido de 5 MB.' }),
        };
      }

      const ext = MIME_TO_EXT[contentType] || 'png';
      const userSlug = sanitizeS3Slug(user.username);
      const objectKey = `profiles/${userSlug}/avatar.${ext}`;
      const s3Url = `https://${bucketName}.s3.${REGION}.amazonaws.com/${objectKey}`;
      const updatedAt = new Date().toISOString();

      // 1. Salva o arquivo de imagem no S3
      await s3.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: objectKey,
          Body: buffer,
          ContentType: contentType,
          Metadata: {
            username: userSlug,
            userid: user.userId,
            email: user.email,
            filename: String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_'),
            updatedat: updatedAt,
          },
        }),
      );

      // 2. Salva no DynamoDB (chave principal = nome do usuário, link do S3 da imagem e lista de mensagens)
      const dynamoUpdate = await dynamo.send(
        new UpdateItemCommand({
          TableName: tableSchema.tableName,
          Key: dynamoKey,
          UpdateExpression:
            'SET s3Url = :url, imageUrl = :url, s3Bucket = :b, s3Key = :k, contentType = :ct, updatedAt = :u, email = :e, userId = :uid, messages = if_not_exists(messages, :empty_list)',
          ExpressionAttributeValues: {
            ':url': { S: s3Url },
            ':b': { S: bucketName },
            ':k': { S: objectKey },
            ':ct': { S: contentType },
            ':u': { S: updatedAt },
            ':e': { S: user.email },
            ':uid': { S: user.userId },
            ':empty_list': { L: [] },
          },
          ReturnValues: 'ALL_NEW',
        }),
      );

      const savedMessages = parseDynamoMessages(dynamoUpdate.Attributes?.messages);

      console.log(
        `[RANDANDAN Profile Lambda] Imagem salva no S3 (${s3Url}) e registrada no DynamoDB (tabela=${tableSchema.tableName}, ${tableSchema.hashKeyName}="${user.username}")`,
      );

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          message: 'Imagem de perfil salva no S3 e vinculada ao seu usuário no DynamoDB!',
          username: user.username,
          tableName: tableSchema.tableName,
          partitionKey: tableSchema.hashKeyName,
          s3Url,
          bucket: bucketName,
          key: objectKey,
          contentType,
          sizeBytes: buffer.length,
          updatedAt,
          imageUrl: `data:${contentType};base64,${buffer.toString('base64')}`,
          messages: savedMessages,
        }),
      };
    }

    // =========================================================================
    // GET /profile
    // Busca no DynamoDB pelo nome do usuário:
    // - O link do S3 com a imagem do usuário (s3Url) e carrega os bytes da imagem no S3
    // - A lista de mensagens do usuário com o agente de IA (messages)
    // =========================================================================
    if (method === 'GET') {
      const dynamoRes = await dynamo.send(
        new GetItemCommand({
          TableName: tableSchema.tableName,
          Key: dynamoKey,
        }),
      );

      const item = dynamoRes.Item;
      const messages = parseDynamoMessages(item?.messages);
      const s3Url = item?.s3Url?.S || item?.imageUrl?.S || item?.profileImageUrl?.S || null;
      let targetBucket = item?.s3Bucket?.S || bucketName;
      let targetKey = item?.s3Key?.S || null;

      if (!targetKey && s3Url) {
        const parsedLoc = parseS3Url(s3Url, bucketName);
        if (parsedLoc) {
          targetBucket = parsedLoc.bucket;
          targetKey = parsedLoc.key;
        }
      }

      // Fallback para chave legada caso o usuário tenha enviado imagem antes de criar o item no DynamoDB
      if (!targetKey) {
        const userSlug = sanitizeS3Slug(user.username);
        targetKey = `profiles/${userSlug}/avatar.png`;
      }

      try {
        let s3Response;
        try {
          s3Response = await s3.send(
            new GetObjectCommand({
              Bucket: targetBucket,
              Key: targetKey,
            }),
          );
        } catch (firstErr) {
          // Tenta também a chave antiga por userId (`profiles/${user.userId}/avatar`) e migra para o DynamoDB!
          const legacyKey = `profiles/${user.userId}/avatar`;
          s3Response = await s3.send(
            new GetObjectCommand({
              Bucket: bucketName,
              Key: legacyKey,
            }),
          );
          targetBucket = bucketName;
          targetKey = legacyKey;
        }

        const byteArray = await s3Response.Body.transformToByteArray();
        const buffer = Buffer.from(byteArray);
        const contentType =
          item?.contentType?.S ||
          s3Response.ContentType ||
          detectImageMimeFromMagicBytes(buffer) ||
          'image/jpeg';
        const base64String = buffer.toString('base64');
        const resolvedS3Url =
          s3Url || `https://${targetBucket}.s3.${REGION}.amazonaws.com/${targetKey}`;

        // Se a imagem foi encontrada via chave legada mas ainda não estava salva no DynamoDB, salva agora
        if (!s3Url) {
          await dynamo
            .send(
              new UpdateItemCommand({
                TableName: tableSchema.tableName,
                Key: dynamoKey,
                UpdateExpression:
                  'SET s3Url = :url, imageUrl = :url, s3Bucket = :b, s3Key = :k, contentType = :ct, messages = if_not_exists(messages, :empty_list)',
                ExpressionAttributeValues: {
                  ':url': { S: resolvedS3Url },
                  ':b': { S: targetBucket },
                  ':k': { S: targetKey },
                  ':ct': { S: contentType },
                  ':empty_list': { L: [] },
                },
              }),
            )
            .catch(() => {});
        }

        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            exists: true,
            username: user.username,
            tableName: tableSchema.tableName,
            partitionKey: tableSchema.hashKeyName,
            s3Url: resolvedS3Url,
            bucket: targetBucket,
            key: targetKey,
            contentType,
            sizeBytes: buffer.length,
            updatedAt:
              item?.updatedAt?.S ||
              s3Response.Metadata?.updatedat ||
              s3Response.LastModified?.toISOString() ||
              null,
            imageUrl: `data:${contentType};base64,${base64String}`,
            messages,
          }),
        };
      } catch (s3Err) {
        if (s3Err?.name === 'NoSuchKey' || s3Err?.$metadata?.httpStatusCode === 404) {
          return {
            statusCode: 200,
            headers: CORS_HEADERS,
            body: JSON.stringify({
              exists: false,
              username: user.username,
              tableName: tableSchema.tableName,
              partitionKey: tableSchema.hashKeyName,
              s3Url: null,
              imageUrl: null,
              messages,
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
    const statusCode =
      String(error?.message || '').includes('Arquivo inválido') ||
      String(error?.message || '').includes('Nenhum arquivo')
        ? 400
        : 500;

    return {
      statusCode,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : 'Erro interno ao processar perfil no S3/DynamoDB.',
      }),
    };
  }
};
